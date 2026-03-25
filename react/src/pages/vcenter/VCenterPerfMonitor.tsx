import React from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGetJson } from "@/lib/api";
import type { PerfPoint, VCenterVMPerfResponse } from "./types";
import { cn } from "@/lib/utils";

function fmtAxisTime(iso: string): string {
  try {
    return format(new Date(iso), "M/d HH:mm", { locale: zhCN });
  } catch {
    return iso;
  }
}

function unitSuffix(unit: string | undefined): string {
  switch (unit) {
    case "percent":
      return "%";
    case "kiloBytesPerSecond":
      return " KB/s";
    case "megaBytesPerSecond":
      return " MB/s";
    default:
      return "";
  }
}

/** 合并双序列；任一侧有数据即可作为时间轴（避免仅读/写有数据时整图为空）。 */
function mergeDual(
  a: PerfPoint[] | null | undefined,
  b: PerfPoint[] | null | undefined,
  ka: string,
  kb: string
): Record<string, string | number>[] {
  if (!a?.length && !b?.length) return [];
  const base = a?.length ? a : b!;
  const primaryKey = a?.length ? ka : kb;
  const secondaryKey = a?.length ? kb : ka;
  const other = a?.length ? b : a;
  return base.map((p, i) => ({
    t: p.t,
    [primaryKey]: p.v,
    [secondaryKey]: other?.[i]?.v ?? 0,
  }));
}

const cpuCfg = {
  v: { label: "CPU", color: "hsl(221 83% 53%)" },
} satisfies ChartConfig;

const memCfg = {
  v: { label: "内存", color: "hsl(262 83% 58%)" },
} satisfies ChartConfig;

const diskCfg = {
  read: { label: "读", color: "hsl(199 89% 48%)" },
  write: { label: "写", color: "hsl(280 65% 52%)" },
} satisfies ChartConfig;

const netCfg = {
  rx: { label: "接收", color: "hsl(142 71% 42%)" },
  tx: { label: "发送", color: "hsl(24 95% 53%)" },
} satisfies ChartConfig;

function PerfCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50/90 to-white p-5 shadow-sm",
        className
      )}
    >
      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export const VCenterPerfMonitor: React.FC<{
  moref: string;
  /** 虚拟机（默认）或 ESXi 宿主机 */
  kind?: "vm" | "host";
}> = ({ moref, kind = "vm" }) => {
  const [days, setDays] = React.useState(7);

  const metricsPath =
    kind === "host"
      ? `/api/vcenter/hosts/${encodeURIComponent(moref)}/metrics?days=${days}`
      : `/api/vcenter/vms/${encodeURIComponent(moref)}/metrics?days=${days}`;

  const q = useQuery({
    queryKey: ["vcenter-perf", kind, moref, days],
    queryFn: () => apiGetJson<VCenterVMPerfResponse>(metricsPath),
    enabled: moref.length > 0,
  });

  const u = q.data?.units ?? {};
  const s = q.data?.series;

  const cpuPts = s?.cpu ?? [];
  const memPts = s?.memory ?? [];
  const diskData = mergeDual(s?.diskRead, s?.diskWrite, "read", "write");
  const netData = mergeDual(s?.netRx, s?.netTx, "rx", "tx");

  const allChartsEmpty =
    !!q.data &&
    cpuPts.length === 0 &&
    memPts.length === 0 &&
    diskData.length === 0 &&
    netData.length === 0;

  const pctTick = (unit: string | undefined) => (v: number) =>
    `${v.toFixed(0)}${unitSuffix(unit)}`;
  const rateTick = (unit: string | undefined) => (v: number) =>
    `${v.toFixed(0)}${unitSuffix(unit)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-800">
            历史性能（vCenter 统计）
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {kind === "host"
              ? "宿主机：磁盘/网络优先历史rollup；无有效数据时自动尝试 datastore 计数器与近 1 小时实时采样。"
              : "仅展示 CPU、内存、磁盘 IO、网络 IO；时间范围由 vCenter rollup 决定。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">最近</span>
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="天数" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} 天
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {q.data?.note ? (
        <p
          className={
            allChartsEmpty
              ? "rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950"
              : "rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-600"
          }
        >
          {q.data.note}
        </p>
      ) : null}

      {q.data?.missing && q.data.missing.length > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          部分计数器不可用：{q.data.missing.join(", ")}
        </p>
      ) : null}

      {q.data && (
        <div className="space-y-1">
          {q.data.diskNetRealtime && kind === "host" ? (
            <>
              <p className="font-mono text-[11px] text-slate-500">
                CPU/内存（历史）：{q.data.rangeFrom} — {q.data.rangeTo} · 间隔{" "}
                {q.data.intervalSec}s
              </p>
              <p className="font-mono text-[11px] text-sky-800">
                磁盘/网络（实时回退）：{q.data.diskNetRealtime.rangeFrom} —{" "}
                {q.data.diskNetRealtime.rangeTo} · 间隔{" "}
                {q.data.diskNetRealtime.intervalSec}s
              </p>
            </>
          ) : (
            <p className="font-mono text-[11px] text-slate-500">
              {q.data.rangeFrom} — {q.data.rangeTo} · 间隔 {q.data.intervalSec}s
            </p>
          )}
        </div>
      )}

      {q.isLoading && (
        <p className="text-sm text-slate-500">加载性能数据…</p>
      )}
      {q.error && (
        <p className="text-sm text-red-600">
          {(q.error as Error).message}
        </p>
      )}

      {q.data && !q.isLoading && (
        <div className="grid gap-5 lg:grid-cols-2">
          <PerfCard title="CPU" subtitle={`平均占用率（${unitSuffix(u.cpu) || "%"}）`}>
            {cpuPts.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                无数据
              </p>
            ) : (
              <ChartContainer config={cpuCfg} className="h-[220px] w-full">
                <LineChart
                  data={cpuPts}
                  margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="4 6"
                    vertical={false}
                    className="stroke-slate-200/80"
                  />
                  <XAxis
                    dataKey="t"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    tick={{ fontSize: 10, fill: "hsl(215 16% 42%)" }}
                    tickFormatter={fmtAxisTime}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tick={{ fontSize: 10 }}
                    tickFormatter={pctTick(u.cpu)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="var(--color-v)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </PerfCard>

          <PerfCard title="内存" subtitle={`平均占用率（${unitSuffix(u.memory) || "%"}）`}>
            {memPts.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                无数据
              </p>
            ) : (
              <ChartContainer config={memCfg} className="h-[220px] w-full">
                <LineChart
                  data={memPts}
                  margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="4 6"
                    vertical={false}
                    className="stroke-slate-200/80"
                  />
                  <XAxis
                    dataKey="t"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    tick={{ fontSize: 10 }}
                    tickFormatter={fmtAxisTime}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={pctTick(u.memory)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="var(--color-v)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </PerfCard>

          <PerfCard
            title="磁盘 IO"
            subtitle="读 / 写（vSphere 平均速率）"
            className="lg:col-span-2"
          >
            {diskData.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                无数据
              </p>
            ) : (
              <ChartContainer config={diskCfg} className="h-[240px] w-full">
                <LineChart
                  data={diskData}
                  margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="4 6"
                    vertical={false}
                    className="stroke-slate-200/80"
                  />
                  <XAxis
                    dataKey="t"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    tick={{ fontSize: 10 }}
                    tickFormatter={fmtAxisTime}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={rateTick(u.diskRead)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value) =>
                      value === "read"
                        ? "读"
                        : value === "write"
                          ? "写"
                          : value
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="read"
                    stroke="var(--color-read)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="write"
                    stroke="var(--color-write)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </PerfCard>

          <PerfCard
            title="网络 IO"
            subtitle="接收 / 发送（平均速率）"
            className="lg:col-span-2"
          >
            {netData.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                无数据
              </p>
            ) : (
              <ChartContainer config={netCfg} className="h-[240px] w-full">
                <LineChart
                  data={netData}
                  margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="4 6"
                    vertical={false}
                    className="stroke-slate-200/80"
                  />
                  <XAxis
                    dataKey="t"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    tick={{ fontSize: 10 }}
                    tickFormatter={fmtAxisTime}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={rateTick(u.netRx)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value) =>
                      value === "rx"
                        ? "接收"
                        : value === "tx"
                          ? "发送"
                          : value
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="rx"
                    stroke="var(--color-rx)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="tx"
                    stroke="var(--color-tx)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </PerfCard>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGetJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  VCenterVMRow,
  VCenterVMsPerfSnapshotResponse,
  VCenterVMsResponse,
} from "./types";
import { VCenterPercentBar } from "./VCenterPercentBar";

function vmDetailPath(moref: string): string {
  return `/cluster/vcenter/${encodeURIComponent(moref)}`;
}

function vmCpuPct(vm: VCenterVMRow): number | null {
  const on = vm.powerState === "poweredOn" || vm.powerState === "suspended";
  if (!on) return null;
  if ((vm.cpuCapacityMHz ?? 0) <= 0) return null;
  return vm.cpuUsagePercent ?? 0;
}

function vmMemPct(vm: VCenterVMRow): number | null {
  const on = vm.powerState === "poweredOn" || vm.powerState === "suspended";
  if (!on) return null;
  if ((vm.memoryMaxMB ?? 0) > 0) return vm.memoryUsagePercent ?? 0;
  if ((vm.memoryMB ?? 0) > 0) return vm.memoryUsagePercent ?? 0;
  return null;
}

function powerStateBadge(powerState: string | undefined) {
  const s = (powerState ?? "").toLowerCase();
  if (s === "poweredon") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 font-normal text-emerald-800"
      >
        运行中
      </Badge>
    );
  }
  if (s === "poweredoff") {
    return (
      <Badge variant="outline" className="border-slate-200 bg-slate-100 font-normal text-slate-700">
        已关机
      </Badge>
    );
  }
  if (s === "suspended") {
    return (
      <Badge
        variant="outline"
        className="border-amber-200 bg-amber-50 font-normal text-amber-900"
      >
        已挂起
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal">
      {powerState || "—"}
    </Badge>
  );
}

function memAllocMB(vm: VCenterVMRow): number {
  return (vm.memoryMaxMB ?? 0) > 0 ? vm.memoryMaxMB! : vm.memoryMB;
}

function formatSpec(vm: VCenterVMRow): string {
  const gib = vm.memoryMB > 0 ? (vm.memoryMB / 1024).toFixed(vm.memoryMB % 1024 === 0 ? 0 : 1) : "—";
  return `${vm.cpu} vCPU · ${gib} GiB`;
}

function vmPoweredOn(vm: VCenterVMRow): boolean {
  return (vm.powerState ?? "").toLowerCase() === "poweredon";
}

/** 与 VCenterPerfMonitor 单位展示一致 */
function fmtPerfRate(v: number | undefined, unit: string | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const u = unit ?? "";
  if (u === "megaBytesPerSecond") return `${v.toFixed(2)} MB/s`;
  return `${v.toFixed(1)} KB/s`;
}

const VCenterList: React.FC = () => {
  const [filter, setFilter] = useState("");

  const statusQ = useQuery({
    queryKey: ["vcenter-status"],
    queryFn: () =>
      apiGetJson<{ configured: boolean; vcenterUrlHint?: string }>(
        "/api/vcenter/status"
      ),
  });

  const vmsQ = useQuery({
    queryKey: ["vcenter-vms"],
    queryFn: () => apiGetJson<VCenterVMsResponse>("/api/vcenter/vms"),
    enabled: statusQ.data?.configured === true,
  });

  const perfQ = useQuery({
    queryKey: ["vcenter-vms-perf-snapshot"],
    queryFn: () =>
      apiGetJson<VCenterVMsPerfSnapshotResponse>("/api/vcenter/vms/perf-snapshot"),
    enabled:
      statusQ.data?.configured === true && (vmsQ.data?.vms?.length ?? 0) > 0,
    staleTime: 25_000,
    refetchInterval: 45_000,
  });

  const allVms = vmsQ.data?.vms ?? [];
  const perfRates = perfQ.data?.rates ?? {};

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allVms;
    return allVms.filter((vm) => {
      const name = (vm.name ?? "").toLowerCase();
      const id = (vm.moref ?? "").toLowerCase();
      const ip = (vm.ip ?? "").toLowerCase();
      const guest = (vm.guestId ?? "").toLowerCase();
      return (
        name.includes(q) ||
        id.includes(q) ||
        ip.includes(q) ||
        guest.includes(q)
      );
    });
  }, [allVms, filter]);

  const poweredOn = useMemo(
    () =>
      allVms.filter((v) => (v.powerState ?? "").toLowerCase() === "poweredon")
        .length,
    [allVms]
  );

  if (statusQ.isLoading) {
    return <p className="text-gray-500">加载中…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">
            云主机（虚拟机）
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            列表展示 vCenter 中的虚拟机；磁盘/网络 IO 与详情页「资源监控」同源（实时性能最新点）。名称可能含表情或长文本，请使用右侧「实例
            ID」或「详情」进入，不依赖名称链接。
          </p>
        </div>
        {allVms.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm">
            <span className="text-slate-500">共计</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {allVms.length}
            </span>
            <span className="text-slate-500">台</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">运行中</span>
            <span className="font-semibold tabular-nums text-emerald-700">
              {poweredOn}
            </span>
          </div>
        )}
      </div>

      {statusQ.data?.vcenterUrlHint && (
        <p className="text-sm text-slate-500">
          vCenter：{statusQ.data.vcenterUrlHint}
        </p>
      )}

      {vmsQ.isLoading && <p className="text-slate-500">加载虚拟机列表…</p>}
      {vmsQ.error && (
        <p className="text-red-600">{(vmsQ.error as Error).message}</p>
      )}

      {vmsQ.data && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="搜索名称、实例 ID、IP、GuestId…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-10 border-slate-200 bg-white pl-9"
                aria-label="筛选虚拟机"
              />
            </div>
            <p className="shrink-0 text-xs text-slate-500">
              显示{" "}
              <span className="font-medium tabular-nums text-slate-800">
                {filtered.length}
              </span>{" "}
              / {allVms.length} 台
            </p>
          </div>
          {perfQ.data?.probe?.moref ? (
            <p
              className="max-w-4xl text-xs leading-relaxed text-slate-500"
              title={perfQ.data?.note}
            >
              <span className="font-medium text-slate-600">IO 诊断（样例 {perfQ.data.probe.moref}）</span>
              {perfQ.data.probe.reason ? `：${perfQ.data.probe.reason}` : null}
              {perfQ.data.probe.chosen ? (
                <span className="ml-1 font-mono text-[11px] text-slate-400">
                  [{perfQ.data.probe.chosen}] 历史采样 {perfQ.data.probe.historicalSamples ?? "—"} · 实时采样{" "}
                  {perfQ.data.probe.realtimeSamples ?? "—"}
                </span>
              ) : null}
            </p>
          ) : null}

          {allVms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center text-sm text-slate-500">
              未发现虚拟机（或当前账号无权限）。
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-amber-50/40 px-6 py-10 text-center text-sm text-amber-950">
              无匹配结果，请调整搜索关键词。
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 bg-slate-50/95 hover:bg-slate-50/95">
                      <TableHead className="sticky top-0 z-10 min-w-[140px] max-w-[240px] bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        名称
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 whitespace-nowrap bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        实例 ID
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 whitespace-nowrap bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        电源
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 whitespace-nowrap bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        状态
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 min-w-[120px] bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        CPU
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 min-w-[120px] bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        内存
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 min-w-[108px] bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        磁盘 IO
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 min-w-[108px] bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        网络 IO
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 whitespace-nowrap bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        规格
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 min-w-[100px] max-w-[140px] bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        私网 IP
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 min-w-[100px] max-w-[160px] bg-slate-50/95 font-semibold text-slate-800 backdrop-blur-sm">
                        系统
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 w-[100px] bg-slate-50/95 text-right font-semibold text-slate-800 backdrop-blur-sm">
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((vm, i) => {
                      const pr = perfRates[vm.moref];
                      const on = vmPoweredOn(vm);
                      return (
                      <TableRow
                        key={vm.moref}
                        className={cn(
                          "border-slate-100",
                          i % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                        )}
                      >
                        <TableCell className="max-w-[240px] align-top">
                          <p
                            className="line-clamp-2 break-words text-sm font-medium leading-snug text-slate-900"
                            title={vm.name}
                          >
                            {vm.name || "（未命名）"}
                          </p>
                        </TableCell>
                        <TableCell className="align-top font-mono text-[11px] text-slate-600">
                          {vm.moref}
                        </TableCell>
                        <TableCell className="align-top">
                          {powerStateBadge(vm.powerState)}
                        </TableCell>
                        <TableCell className="align-top text-xs text-slate-600">
                          {vm.overallStatus ?? "—"}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="min-w-[110px] space-y-1">
                            <VCenterPercentBar value={vmCpuPct(vm)} />
                            <p className="whitespace-nowrap text-[11px] text-slate-500">
                              {vm.cpuUsageMHz ?? 0} / {vm.cpuCapacityMHz ?? 0}{" "}
                              MHz
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="min-w-[110px] space-y-1">
                            <VCenterPercentBar value={vmMemPct(vm)} />
                            <p className="whitespace-nowrap text-[11px] text-slate-500">
                              {vm.memoryUsageMB ?? 0} / {memAllocMB(vm)} MB
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-[11px] leading-snug text-slate-700">
                          {!on ? (
                            <span className="text-slate-400">—</span>
                          ) : perfQ.isLoading ? (
                            <span className="text-slate-400">…</span>
                          ) : perfQ.isError ? (
                            <span className="text-amber-700">加载失败</span>
                          ) : (
                            <span className="space-y-0.5">
                              <span className="block whitespace-nowrap">
                                读 {fmtPerfRate(pr?.diskRead, pr?.diskReadUnit)}
                              </span>
                              <span className="block whitespace-nowrap">
                                写 {fmtPerfRate(pr?.diskWrite, pr?.diskWriteUnit)}
                              </span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-[11px] leading-snug text-slate-700">
                          {!on ? (
                            <span className="text-slate-400">—</span>
                          ) : perfQ.isLoading ? (
                            <span className="text-slate-400">…</span>
                          ) : perfQ.isError ? (
                            <span className="text-amber-700">加载失败</span>
                          ) : (
                            <span className="space-y-0.5">
                              <span className="block whitespace-nowrap">
                                收 {fmtPerfRate(pr?.netRx, pr?.netRxUnit)}
                              </span>
                              <span className="block whitespace-nowrap">
                                发 {fmtPerfRate(pr?.netTx, pr?.netTxUnit)}
                              </span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap align-top text-xs text-slate-700">
                          {formatSpec(vm)}
                        </TableCell>
                        <TableCell className="max-w-[140px] align-top font-mono text-xs text-slate-700">
                          <span className="block truncate" title={vm.ip || ""}>
                            {vm.ip || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[160px] align-top text-xs text-slate-600">
                          <span className="line-clamp-2 break-all" title={vm.guestId}>
                            {vm.guestId || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Button variant="ghost" size="sm" className="h-8 gap-0.5 px-2" asChild>
                            <Link to={vmDetailPath(vm.moref)}>
                              详情
                              <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VCenterList;

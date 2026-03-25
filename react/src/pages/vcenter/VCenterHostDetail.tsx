import React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGetJson } from "@/lib/api";
import { VCenterPerfMonitor } from "./VCenterPerfMonitor";
import { VCenterPercentBar } from "./VCenterPercentBar";
import { formatBytes } from "./VCenterResourceCharts";
import type { VCenterHostDetailResponse } from "./types";

const VCenterHostDetail: React.FC = () => {
  const { moref = "" } = useParams<{ moref: string }>();
  const decoded = decodeURIComponent(moref);

  const detailQ = useQuery({
    queryKey: ["vcenter-host", decoded],
    queryFn: () =>
      apiGetJson<VCenterHostDetailResponse>(
        `/api/vcenter/hosts/${encodeURIComponent(decoded)}`
      ),
    enabled: decoded.length > 0,
  });

  const h = detailQ.data?.host;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLikeBack />
          <div className="min-w-0 flex-1">
            {h?.moref && (
              <p className="font-mono text-xs text-slate-500">主机 ID · {h.moref}</p>
            )}
            <h2 className="mt-0.5 break-words text-xl font-semibold leading-snug text-gray-900">
              {h?.name ?? "宿主机"}
            </h2>
            {h && (
              <p className="mt-1 text-xs text-slate-500">
                显示名称来自 vCenter；资源与监控以主机 ID 为准。
              </p>
            )}
          </div>
        </div>
      </div>

      {detailQ.isLoading && <p className="text-sm text-slate-500">加载中…</p>}
      {detailQ.error && (
        <p className="text-sm text-red-600">{(detailQ.error as Error).message}</p>
      )}

      {h && (
        <>
          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">资源概览</CardTitle>
              <CardDescription>
                QuickStats · {h.connectionState ?? "—"} · {h.overallStatus ?? "—"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-600">CPU</p>
                <div className="mt-2 space-y-1">
                  <VCenterPercentBar value={h.cpuUsagePercent ?? 0} />
                  <p className="text-[11px] text-slate-500">
                    {h.cpuUsageMHz ?? 0} / {h.cpuCapacityMHz ?? 0} MHz · {h.cpuCores ?? "—"} 核
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-600">内存</p>
                <div className="mt-2 space-y-1">
                  <VCenterPercentBar value={h.memoryUsagePercent ?? 0} />
                  <p className="text-[11px] text-slate-500">
                    {h.memoryUsageMB ?? 0} / {h.memoryTotalMB ?? 0} MB
                  </p>
                </div>
              </div>
              <div className="sm:col-span-2 text-xs text-slate-600">
                <p>
                  运行时间：{" "}
                  {(() => {
                    const up = h.uptimeSec ?? 0;
                    if (up <= 0) return "—";
                    const days = Math.floor(up / 86400);
                    const hrs = Math.floor((up % 86400) / 3600);
                    return days > 0 ? `${days} 天 ${hrs} 小时` : `${Math.floor(up / 60)} 分钟`;
                  })()}
                </p>
                {h.esxiVersion && (
                  <p className="mt-1 text-slate-500">{h.esxiVersion}</p>
                )}
                {(h.vendor || h.model) && (
                  <p className="mt-0.5 text-slate-500">
                    {[h.vendor, h.model].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {h.hardwareDetail && (
            <Card className="border-slate-200/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">硬件信息</CardTitle>
                <CardDescription>
                  来自 vCenter 采集的物理机 / SMBIOS（如 Dell 服务标签、序列号等）
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                <DetailKV
                  label="厂商 / 型号"
                  value={
                    [h.hardwareDetail.vendor, h.hardwareDetail.model]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
                <DetailKV label="序列号" value={h.hardwareDetail.serialNumber ?? "—"} />
                <DetailKV label="UUID" value={h.hardwareDetail.uuid ?? "—"} className="sm:col-span-2 font-mono text-xs" />
                <DetailKV
                  label="物理内存"
                  value={
                    h.hardwareDetail.memorySizeBytes
                      ? formatBytes(h.hardwareDetail.memorySizeBytes)
                      : "—"
                  }
                />
                <DetailKV
                  label="CPU（摘要）"
                  value={h.hardwareDetail.cpuModelSummary ?? "—"}
                />
                <DetailKV
                  label="CPU 插槽 / 核 / 线程"
                  value={
                    [
                      h.hardwareDetail.cpuPackagesCount != null
                        ? `${h.hardwareDetail.cpuPackagesCount} 插槽`
                        : "",
                      h.hardwareDetail.cpuCoresPhysical != null
                        ? `${h.hardwareDetail.cpuCoresPhysical} 核`
                        : "",
                      h.hardwareDetail.cpuThreads != null
                        ? `${h.hardwareDetail.cpuThreads} 线程`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
                {h.hardwareDetail.bios && (
                  <div className="sm:col-span-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                    <p className="text-xs font-medium text-slate-600">BIOS</p>
                    <p className="mt-1 text-xs text-slate-800">
                      {[h.hardwareDetail.bios.vendor, h.hardwareDetail.bios.biosVersion]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                    {h.hardwareDetail.bios.releaseDate && (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        发布日期：{h.hardwareDetail.bios.releaseDate}
                      </p>
                    )}
                  </div>
                )}
                {h.hardwareDetail.cpuPackages && h.hardwareDetail.cpuPackages.length > 0 && (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-slate-600">CPU 插槽详情</p>
                    <ul className="mt-2 space-y-1.5">
                      {h.hardwareDetail.cpuPackages.map((p) => (
                        <li
                          key={p.index}
                          className="rounded-md border border-slate-100 bg-white px-2 py-1.5 text-xs text-slate-800"
                        >
                          <span className="font-mono text-slate-500">#{p.index}</span>{" "}
                          {p.description || p.vendor || "—"}
                          {p.hz ? (
                            <span className="ml-2 text-slate-500">
                              {(p.hz / 1e9).toFixed(2)} GHz
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {h.hardwareDetail.otherIdentifyingInfo &&
                  h.hardwareDetail.otherIdentifyingInfo.length > 0 && (
                    <div className="sm:col-span-2">
                      <p className="text-xs font-medium text-slate-600">其它标识（含服务标签等）</p>
                      <ul className="mt-2 space-y-1">
                        {h.hardwareDetail.otherIdentifyingInfo.map((o, i) => (
                          <li key={i} className="font-mono text-[11px] text-slate-700">
                            <span className="text-slate-500">
                              {o.identifierType || "—"}:
                            </span>{" "}
                            {o.identifierValue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </CardContent>
            </Card>
          )}

          <div>
            <h3 className="mb-3 text-base font-semibold text-slate-900">监控</h3>
            <VCenterPerfMonitor moref={decoded} kind="host" />
          </div>
        </>
      )}
    </div>
  );
};

function DetailKV({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className={`mt-0.5 text-slate-900 ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function ButtonLikeBack() {
  return (
    <Link
      to="/cluster/vcenter/hosts"
      className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
    >
      <ArrowLeft className="h-4 w-4" />
      宿主机列表
    </Link>
  );
}

export default VCenterHostDetail;

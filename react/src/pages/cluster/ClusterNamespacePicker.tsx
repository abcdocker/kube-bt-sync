import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderOpen, RefreshCw, Search } from "lucide-react";
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
import {
  parseResourceSearchParam,
  RESOURCE_TAB_META,
  type ClusterScopedResource,
} from "./clusterNamespaceRoutes";

function resourceMeta(key: ClusterScopedResource) {
  return RESOURCE_TAB_META.find((x) => x.key === key)!;
}

export type NamespaceStatsRow = {
  namespace: string;
  podCount: number;
  deploymentCount: number;
  statefulSetCount: number;
  serviceCount: number;
  pvcCount: number;
  namespaceCreated?: string;
  latestObjectCreated?: string;
};

export type NamespaceStatsResponse = {
  computedAt: string;
  items: NamespaceStatsRow[];
};

/** 五类工作负载数量全为 0 的命名空间不在列表中展示 */
function rowHasWorkloadData(row: NamespaceStatsRow): boolean {
  return (
    row.podCount +
      row.deploymentCount +
      row.statefulSetCount +
      row.serviceCount +
      row.pvcCount >
    0
  );
}

function formatDateTime(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

const ClusterNamespacePicker: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resource = parseResourceSearchParam(searchParams.get("resource"));
  const meta = resourceMeta(resource);
  const [q, setQ] = useState("");

  const statsQ = useQuery({
    queryKey: ["k8s-namespaces-stats"],
    queryFn: () => apiGetJson<NamespaceStatsResponse>("/api/k8s/namespace-stats"),
  });

  const itemsWithData = useMemo(() => {
    return (statsQ.data?.items ?? []).filter(rowHasWorkloadData);
  }, [statsQ.data?.items]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return itemsWithData;
    return itemsWithData.filter((row) => row.namespace.toLowerCase().includes(s));
  }, [itemsWithData, q]);

  const hiddenEmptyCount = Math.max(
    0,
    (statsQ.data?.items.length ?? 0) - itemsWithData.length
  );

  const go = (namespace: string) => {
    navigate(
      `/cluster/ns/${encodeURIComponent(namespace)}/${encodeURIComponent(resource)}`
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">选择命名空间</h2>
        <p className="mt-1 text-sm text-slate-500">
          请先选择要查看的命名空间；进入后可切换{" "}
          <span className="font-medium text-slate-700">{meta.title}</span> 与同命名空间下的其他工作负载资源。
        </p>
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium text-blue-900">即将打开的资源类型</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-800">{meta.title}</span>
            <span className="mx-1.5 text-slate-400">·</span>
            {meta.detail}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            placeholder="筛选命名空间…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-10 rounded-lg border-slate-200 pl-9 font-mono text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {statsQ.data?.computedAt && (
            <p className="text-xs text-slate-500">
              数据更新时间（服务端统计）：
              <span className="ml-1 font-mono text-slate-700">
                {formatDateTime(statsQ.data.computedAt)}
              </span>
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void statsQ.refetch()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", statsQ.isFetching && "animate-spin")} />
            刷新统计
          </Button>
        </div>
      </div>

      {statsQ.isLoading && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center text-sm text-slate-500">
          加载命名空间与资源统计…
        </div>
      )}
      {statsQ.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {(statsQ.error as Error).message}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-5 py-3">
            <p className="text-sm font-semibold text-slate-800">集群命名空间</p>
            <p className="text-xs text-slate-500">
              共 {filtered.length} 个
              {q.trim()
                ? `（在 ${itemsWithData.length} 个有资源的命名空间中筛选）`
                : hiddenEmptyCount > 0
                  ? `（已隐藏 ${hiddenEmptyCount} 个五类资源数量均为 0 的命名空间）`
                  : ""}
              · Pod / Deployment / StatefulSet / Service / PVC 为命名空间内数量；时间为 metadata.creationTimestamp
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableHead className="min-w-[140px] whitespace-nowrap pl-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    命名空间
                  </TableHead>
                  <TableHead className="w-[72px] text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Pod
                  </TableHead>
                  <TableHead className="w-[72px] text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Deployment
                  </TableHead>
                  <TableHead className="w-[72px] text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    StatefulSet
                  </TableHead>
                  <TableHead className="w-[72px] text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Service
                  </TableHead>
                  <TableHead className="w-[72px] text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    PVC
                  </TableHead>
                  <TableHead className="min-w-[160px] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    NS 创建时间
                  </TableHead>
                  <TableHead className="min-w-[160px] pr-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    最新对象创建
                    <span className="mt-0.5 block font-normal normal-case text-[10px] text-slate-400">
                      （NS 与上述五类资源中最新 metadata.creationTimestamp）
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow
                    key={row.namespace}
                    className="cursor-pointer border-slate-100 transition-colors hover:bg-slate-50/90"
                    onClick={() => go(row.namespace)}
                  >
                    <TableCell className="pl-5 align-middle">
                      <span className="inline-flex items-center gap-2 font-mono text-sm font-medium text-slate-800">
                        <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />
                        {row.namespace}
                      </span>
                    </TableCell>
                    <TableCell className="text-right align-middle tabular-nums text-sm text-slate-800">
                      {row.podCount}
                    </TableCell>
                    <TableCell className="text-right align-middle tabular-nums text-sm text-slate-800">
                      {row.deploymentCount}
                    </TableCell>
                    <TableCell className="text-right align-middle tabular-nums text-sm text-slate-800">
                      {row.statefulSetCount}
                    </TableCell>
                    <TableCell className="text-right align-middle tabular-nums text-sm text-slate-800">
                      {row.serviceCount}
                    </TableCell>
                    <TableCell className="text-right align-middle tabular-nums text-sm text-slate-800">
                      {row.pvcCount}
                    </TableCell>
                    <TableCell className="align-middle text-xs text-slate-600">
                      {formatDateTime(row.namespaceCreated)}
                    </TableCell>
                    <TableCell className="pr-5 align-middle text-xs text-slate-600">
                      <span className="flex items-center justify-between gap-2">
                        {formatDateTime(row.latestObjectCreated)}
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {statsQ.data && filtered.length === 0 && !statsQ.isLoading && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {itemsWithData.length === 0 ? (
            <p>
              当前没有可展示的命名空间：Pod、Deployment、StatefulSet、Service、PVC
              数量均为 0 的命名空间已隐藏。
            </p>
          ) : (
            <p>无匹配命名空间</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ClusterNamespacePicker;

import React, { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, ChevronRight, FileText, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiDelete, apiGetJson, apiPostJson } from "@/lib/api";
import type { PodRow } from "./types";
import { parseAge } from "./parseAge";
import { podDetailHref, podPhaseBadgeClass } from "./podPhaseStyle";
import PodLogsSheet from "./PodLogsSheet";
import { cn } from "@/lib/utils";

const ClusterPods: React.FC = () => {
  const { namespace } = useParams<{ namespace: string }>();
  const [searchParams] = useSearchParams();
  const labelSelector = searchParams.get("labelSelector")?.trim() ?? "";
  const queryClient = useQueryClient();
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlMode, setYamlMode] = useState<"create" | "edit">("create");
  const [delTarget, setDelTarget] = useState<{ name: string } | null>(null);
  const [logTarget, setLogTarget] = useState<{ name: string; container: string } | null>(null);

  if (!namespace) return null;

  const podsQ = useQuery({
    queryKey: ["k8s-pods", namespace, labelSelector],
    queryFn: () => {
      const q = new URLSearchParams({ namespace });
      if (labelSelector) q.set("labelSelector", labelSelector);
      return apiGetJson<PodRow[]>(`/api/k8s/pods?${q.toString()}`);
    },
  });

  const applyMut = useMutation({
    mutationFn: (yamlContent: string) =>
      apiPostJson("/api/k8s/apply-yaml", { yamlContent }),
    onSuccess: () => {
      setYamlOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["k8s-pods"] });
      void queryClient.invalidateQueries({ queryKey: ["k8s-namespaces-stats"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) =>
      apiDelete(
        `/api/k8s/objects/pod/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
      ),
    onSuccess: () => {
      setDelTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["k8s-pods"] });
      void queryClient.invalidateQueries({ queryKey: ["k8s-namespaces-stats"] });
    },
  });

  const openCreateYaml = () => {
    setYamlMode("create");
    setYamlDraft("");
    setYamlOpen(true);
  };

  const openEditYaml = async (name: string) => {
    setYamlMode("edit");
    setYamlOpen(true);
    setYamlDraft("加载中…");
    try {
      const res = await apiGetJson<{ yaml: string }>(
        `/api/k8s/object-yaml?kind=${encodeURIComponent("Pod")}&namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`
      );
      setYamlDraft(res.yaml);
    } catch (e) {
      setYamlDraft(`# 加载失败: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">Pod</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">
            core/v1 Pod · 调度与生命周期
            {podsQ.data && podsQ.data.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {podsQ.data.length} 个
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {labelSelector && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
          <p>
            已按与 Deployment / StatefulSet 一致的{" "}
            <code className="rounded bg-amber-100/80 px-1.5 py-0.5 font-mono text-xs">
              labelSelector
            </code>{" "}
            筛选：<span className="font-mono text-xs">{labelSelector}</span>
          </p>
          <Button variant="outline" size="sm" className="border-amber-300" asChild>
            <Link to={`/cluster/ns/${encodeURIComponent(namespace)}/pods`}>显示全部 Pod</Link>
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="default" size="sm" className="h-10 gap-1.5" onClick={openCreateYaml}>
          <Plus className="h-3.5 w-3.5" />
          应用 YAML
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-10 gap-1.5 rounded-lg border-slate-200"
          onClick={() => void podsQ.refetch()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", podsQ.isFetching && "animate-spin")} />
          刷新
        </Button>
      </div>

      {podsQ.isLoading && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center text-sm text-slate-500">
          加载中…
        </div>
      )}
      {podsQ.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {(podsQ.error as Error).message}
        </div>
      )}

      {podsQ.data && podsQ.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          该命名空间下没有 Pod
        </div>
      )}

      {podsQ.data && podsQ.data.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3 sm:px-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pod 列表
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableHead className="min-w-[200px] pl-5 text-xs font-semibold text-slate-500">
                    名称
                  </TableHead>
                  <TableHead className="w-[112px] text-xs font-semibold text-slate-500">阶段</TableHead>
                  <TableHead className="min-w-[140px] text-xs font-semibold text-slate-500">节点</TableHead>
                  <TableHead className="w-[72px] text-xs font-semibold text-slate-500">重启</TableHead>
                  <TableHead className="w-[100px] text-xs font-semibold text-slate-500">Age</TableHead>
                  <TableHead className="min-w-[220px] pr-5 text-right text-xs font-semibold text-slate-500">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {podsQ.data.map((p, idx) => (
                  <TableRow
                    key={`${p.namespace}/${p.name}`}
                    className={cn(
                      "group border-slate-100 transition-colors",
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                      "hover:bg-blue-50/50"
                    )}
                  >
                    <TableCell className="py-3.5 pl-5 align-middle">
                      <Link
                        to={podDetailHref(p.namespace, p.name)}
                        className="flex items-start gap-2.5"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 transition-colors group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:ring-blue-100">
                          <Box className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 font-mono text-[13px] font-semibold text-slate-900 group-hover:text-blue-700">
                            {p.name}
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-400">metadata.name</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="align-middle">
                      <Badge
                        variant="outline"
                        className={cn("border font-medium", podPhaseBadgeClass(p.phase))}
                      >
                        {p.phase}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-middle">
                      <span className="font-mono text-[12px] leading-snug text-slate-700">{p.node}</span>
                    </TableCell>
                    <TableCell className="align-middle tabular-nums text-sm text-slate-800">
                      {p.restarts}
                    </TableCell>
                    <TableCell className="align-middle text-xs text-slate-500">{parseAge(p.age)}</TableCell>
                    <TableCell className="pr-5 text-right align-middle">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button variant="outline" size="sm" className="h-8 gap-1 border-slate-200 text-xs" asChild>
                          <Link to={podDetailHref(p.namespace, p.name)}>详情</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 border-slate-200 text-xs text-slate-800"
                          disabled={!p.firstContainer}
                          title={!p.firstContainer ? "无可用容器名" : "查看 stdout/stderr"}
                          onClick={() =>
                            p.firstContainer &&
                            setLogTarget({ name: p.name, container: p.firstContainer })
                          }
                        >
                          <FileText className="h-3.5 w-3.5" />
                          日志
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-slate-600"
                          onClick={() => void openEditYaml(p.name)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-red-600 hover:text-red-700"
                          onClick={() => setDelTarget({ name: p.name })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={yamlOpen} onOpenChange={setYamlOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{yamlMode === "create" ? "应用 YAML（创建或更新 Pod）" : "编辑 Pod YAML"}</DialogTitle>
          </DialogHeader>
          <Textarea
            className="min-h-[320px] font-mono text-xs"
            value={yamlDraft}
            onChange={(e) => setYamlDraft(e.target.value)}
            spellCheck={false}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="secondary" onClick={() => setYamlOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={applyMut.isPending}
              onClick={() => void applyMut.mutateAsync(yamlDraft)}
            >
              {applyMut.isPending ? "提交中…" : "提交应用"}
            </Button>
          </DialogFooter>
          {applyMut.isError && (
            <p className="text-sm text-red-600">{(applyMut.error as Error).message}</p>
          )}
        </DialogContent>
      </Dialog>

      {logTarget && (
        <PodLogsSheet
          key={`${namespace}/${logTarget.name}`}
          open
          onOpenChange={(o) => {
            if (!o) setLogTarget(null);
          }}
          namespace={namespace}
          podName={logTarget.name}
          container={logTarget.container}
        />
      )}

      <AlertDialog open={Boolean(delTarget)} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Pod？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {namespace}/{delTarget?.name}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => delTarget && void deleteMut.mutateAsync(delTarget.name)}
            >
              {deleteMut.isPending ? "删除中…" : "删除"}
            </Button>
          </AlertDialogFooter>
          {deleteMut.isError && (
            <p className="text-sm text-red-600">{(deleteMut.error as Error).message}</p>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClusterPods;

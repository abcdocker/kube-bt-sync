import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { parseAge } from "./parseAge";
import { cn } from "@/lib/utils";

export type K8sColumn = {
  key: string;
  header: string;
  mono?: boolean;
  /** 若为 age，按 RFC3339 转相对时间 */
  kind?: "text" | "age";
  format?: (row: Record<string, unknown>) => React.ReactNode;
};

export type ClusterK8sListPageProps = {
  title: string;
  description?: string;
  apiSuffix: string;
  queryKey: string;
  columns: K8sColumn[];
  /** 若指定，则固定该命名空间且不再显示命名空间输入框 */
  namespace?: string;
  /** 命名空间内页：YAML 应用、按名删除、按 selector 链到 Pod */
  enableCrud?: boolean;
  /** Deployment / StatefulSet：显示「关联 Pods」列（用 labelSelector 筛 Pod） */
  workloadPodsLink?: boolean;
};

const YAML_KIND: Record<string, string> = {
  deployments: "Deployment",
  statefulsets: "StatefulSet",
  services: "Service",
  pvcs: "PersistentVolumeClaim",
  configmaps: "ConfigMap",
};

const DELETE_KIND: Record<string, string> = {
  deployments: "deployment",
  statefulsets: "statefulset",
  services: "service",
  pvcs: "pvc",
  configmaps: "configmap",
};

function cellValue(
  row: Record<string, unknown>,
  col: K8sColumn
): React.ReactNode {
  if (col.format) return col.format(row);
  const v = row[col.key];
  if (v === undefined || v === null) return "—";
  if (col.kind === "age" && typeof v === "string") return parseAge(v);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

export const ClusterK8sListPage: React.FC<ClusterK8sListPageProps> = ({
  title,
  description,
  apiSuffix,
  queryKey,
  columns,
  namespace: namespaceFixed,
  enableCrud = false,
  workloadPodsLink = false,
}) => {
  const queryClient = useQueryClient();
  const [nsFilter, setNsFilter] = useState("");
  const effectiveNs = namespaceFixed?.trim() ?? nsFilter.trim();
  const displayColumns = useMemo(
    () =>
      namespaceFixed ? columns.filter((c) => c.key !== "namespace") : columns,
    [columns, namespaceFixed]
  );
  const dataQ = useQuery({
    queryKey: [queryKey, effectiveNs, namespaceFixed ?? ""],
    queryFn: () =>
      apiGetJson<Record<string, unknown>[]>(
        `/api/k8s/${apiSuffix}${effectiveNs ? `?namespace=${encodeURIComponent(effectiveNs)}` : ""}`
      ),
  });

  const yamlKind = YAML_KIND[apiSuffix];
  const deleteKind = DELETE_KIND[apiSuffix];
  const canCrud =
    Boolean(enableCrud && namespaceFixed && yamlKind && deleteKind);

  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlMode, setYamlMode] = useState<"create" | "edit">("create");

  const [delTarget, setDelTarget] = useState<{ name: string } | null>(null);

  const applyMut = useMutation({
    mutationFn: (yamlContent: string) =>
      apiPostJson<{ message?: string }>("/api/k8s/apply-yaml", { yamlContent }),
    onSuccess: () => {
      setYamlOpen(false);
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
      void queryClient.invalidateQueries({ queryKey: ["k8s-namespaces-stats"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: ({ name }: { name: string }) =>
      apiDelete(
        `/api/k8s/objects/${deleteKind}/${encodeURIComponent(namespaceFixed!)}/${encodeURIComponent(name)}`
      ),
    onSuccess: () => {
      setDelTarget(null);
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
      void queryClient.invalidateQueries({ queryKey: ["k8s-namespaces-stats"] });
    },
  });

  const openCreateYaml = () => {
    setYamlMode("create");
    setYamlDraft("");
    setYamlOpen(true);
  };

  const openEditYaml = async (name: string) => {
    if (!namespaceFixed || !yamlKind) return;
    setYamlMode("edit");
    setYamlOpen(true);
    setYamlDraft("加载中…");
    try {
      const res = await apiGetJson<{ yaml: string }>(
        `/api/k8s/object-yaml?kind=${encodeURIComponent(yamlKind)}&namespace=${encodeURIComponent(namespaceFixed)}&name=${encodeURIComponent(name)}`
      );
      setYamlDraft(res.yaml);
    } catch (e) {
      setYamlDraft(`# 加载失败: ${(e as Error).message}`);
    }
  };

  const showPodsCol = Boolean(
    workloadPodsLink && namespaceFixed && (apiSuffix === "deployments" || apiSuffix === "statefulsets")
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        {(description || (dataQ.data && dataQ.data.length > 0)) && (
          <p className="mt-1 text-sm text-gray-500">
            {description}
            {dataQ.data && dataQ.data.length > 0 ? (
              <>
                {description ? " · " : ""}共 {dataQ.data.length} 条
              </>
            ) : null}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        {!namespaceFixed && (
          <div className="flex flex-col gap-2 sm:max-w-md">
            <Label className="text-xs font-medium uppercase tracking-wide text-slate-500">命名空间</Label>
            <Input
              className="h-10 max-w-xs rounded-lg border-slate-200 font-mono text-sm"
              placeholder="留空 = 全集群"
              value={nsFilter}
              onChange={(e) => setNsFilter(e.target.value)}
            />
          </div>
        )}
        {namespaceFixed && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">当前命名空间</span>
            <p className="mt-0.5 font-mono text-slate-900">{namespaceFixed}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canCrud && (
            <Button type="button" variant="default" size="sm" className="h-10 gap-1.5" onClick={openCreateYaml}>
              <Plus className="h-3.5 w-3.5" />
              应用 YAML
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-10 gap-1.5"
            onClick={() => void dataQ.refetch()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", dataQ.isFetching && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      {dataQ.isLoading && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center text-sm text-slate-500">
          加载中…
        </div>
      )}
      {dataQ.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {(dataQ.error as Error).message}
        </div>
      )}

      {dataQ.data && dataQ.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
          当前过滤条件下没有资源
        </div>
      )}

      {dataQ.data && dataQ.data.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3 sm:px-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              资源列表
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-100 hover:bg-transparent">
                  {displayColumns.map((c) => (
                    <TableHead key={c.key} className="text-xs font-semibold text-slate-500">
                      {c.header}
                    </TableHead>
                  ))}
                  {showPodsCol && (
                    <TableHead className="min-w-[100px] text-xs font-semibold text-slate-500">
                      关联 Pods
                    </TableHead>
                  )}
                  {canCrud && (
                    <TableHead className="w-[140px] pr-4 text-right text-xs font-semibold text-slate-500">
                      操作
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataQ.data.map((row, idx) => {
                  const name = String(row.name ?? "");
                  const ls = typeof row.labelSelector === "string" ? row.labelSelector : "";
                  const podsHref =
                    showPodsCol && namespaceFixed && ls
                      ? {
                          pathname: `/cluster/ns/${encodeURIComponent(namespaceFixed)}/pods`,
                          search: `?labelSelector=${encodeURIComponent(ls)}`,
                        }
                      : null;
                  return (
                    <TableRow
                      key={`${String(row.namespace ?? idx)}-${String(row.name ?? idx)}-${idx}`}
                      className={cn(
                        "border-slate-100 transition-colors",
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                        "hover:bg-blue-50/40"
                      )}
                    >
                      {displayColumns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={cn(
                            "py-3 text-sm",
                            col.mono && "font-mono text-xs"
                          )}
                        >
                          {cellValue(row, col)}
                        </TableCell>
                      ))}
                      {showPodsCol && (
                        <TableCell className="align-middle">
                          {podsHref ? (
                            <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                              <Link to={podsHref}>
                                <Boxes className="h-3.5 w-3.5" />
                                Pods
                              </Link>
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                      )}
                      {canCrud && (
                        <TableCell className="pr-4 text-right align-middle">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => void openEditYaml(name)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span className="sr-only">YAML</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-red-600 hover:text-red-700"
                              onClick={() => setDelTarget({ name })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span className="sr-only">删除</span>
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={yamlOpen} onOpenChange={setYamlOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{yamlMode === "create" ? "应用 YAML（创建或更新）" : "编辑 YAML"}</DialogTitle>
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

      <AlertDialog open={Boolean(delTarget)} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除资源？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {namespaceFixed}/{delTarget?.name}，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => delTarget && void deleteMut.mutateAsync(delTarget)}
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

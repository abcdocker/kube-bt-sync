import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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
import type { SvcRow } from "./types";

const ClusterServices: React.FC = () => {
  const { namespace } = useParams<{ namespace: string }>();
  const queryClient = useQueryClient();
  if (!namespace) return null;

  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlMode, setYamlMode] = useState<"create" | "edit">("create");
  const [delName, setDelName] = useState<string | null>(null);

  const svcQ = useQuery({
    queryKey: ["k8s-services", namespace],
    queryFn: () =>
      apiGetJson<SvcRow[]>(
        `/api/k8s/services?namespace=${encodeURIComponent(namespace)}`
      ),
  });

  const applyMut = useMutation({
    mutationFn: (yamlContent: string) =>
      apiPostJson("/api/k8s/apply-yaml", { yamlContent }),
    onSuccess: () => {
      setYamlOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["k8s-services"] });
      void queryClient.invalidateQueries({ queryKey: ["k8s-namespaces-stats"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) =>
      apiDelete(
        `/api/k8s/objects/service/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
      ),
    onSuccess: () => {
      setDelName(null);
      void queryClient.invalidateQueries({ queryKey: ["k8s-services"] });
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
        `/api/k8s/object-yaml?kind=${encodeURIComponent("Service")}&namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`
      );
      setYamlDraft(res.yaml);
    } catch (e) {
      setYamlDraft(`# 加载失败: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Service</h2>
        <p className="text-sm text-slate-500">
          core/v1 Service · ClusterIP / NodePort / LoadBalancer · Endpoints 与端口映射
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="default" size="sm" className="h-9 gap-1.5" onClick={openCreateYaml}>
          <Plus className="h-3.5 w-3.5" />
          应用 YAML
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => void svcQ.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      {svcQ.isLoading && <p className="text-sm text-slate-500">加载中…</p>}
      {svcQ.error && <p className="text-sm text-red-600">{(svcQ.error as Error).message}</p>}
      {svcQ.data && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-5 py-3">
            <p className="text-sm font-semibold text-slate-800">Service 列表</p>
            <p className="text-xs text-slate-500">命名空间 {namespace} · 共 {svcQ.data.length} 条</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-100">
                  <TableHead className="min-w-[160px] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    名称（metadata.name）
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    类型（spec.type）
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Cluster IP（spec.clusterIP）
                  </TableHead>
                  <TableHead className="min-w-[220px] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    端口（spec.ports · name/port/protocol/targetPort）
                  </TableHead>
                  <TableHead className="w-[100px] pr-5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {svcQ.data.map((s) => (
                  <TableRow key={`${s.namespace}/${s.name}`} className="border-slate-100 hover:bg-slate-50/80">
                    <TableCell className="font-mono text-xs font-medium text-slate-900">{s.name}</TableCell>
                    <TableCell className="text-sm text-slate-700">{s.type}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-700">{s.clusterIP}</TableCell>
                    <TableCell className="text-xs text-slate-600">{s.ports.join(", ")}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => void openEditYaml(s.name)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-red-600"
                          onClick={() => setDelName(s.name)}
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
            <DialogTitle>{yamlMode === "create" ? "应用 YAML（创建或更新 Service）" : "编辑 YAML"}</DialogTitle>
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

      <AlertDialog open={Boolean(delName)} onOpenChange={(o) => !o && setDelName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Service？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {namespace}/{delName}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => delName && void deleteMut.mutateAsync(delName)}
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

export default ClusterServices;

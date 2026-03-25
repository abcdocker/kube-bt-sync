import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, FileText, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiDelete, apiGetJson } from "@/lib/api";
import { parseAge } from "./parseAge";
import { podPhaseBadgeClass } from "./podPhaseStyle";
import PodTerminalSheet from "./PodTerminalSheet";
import { YamlCodeBlock } from "@/components/YamlCodeBlock";
import PodLogsSheet from "./PodLogsSheet";
import { cn } from "@/lib/utils";

type PodEventRow = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
  age: string;
};

type PodDetail = {
  namespace: string;
  name: string;
  phase: string;
  node: string;
  restarts: number;
  age: string;
  containers: { name: string; image: string; init?: boolean }[];
  yaml: string;
  events?: PodEventRow[];
};

function podApiPath(namespace: string, name: string) {
  return `/api/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}

const ClusterPodDetail: React.FC = () => {
  const { namespace: nsParam, podName: nameParam } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [delOpen, setDelOpen] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [termContainer, setTermContainer] = useState<string | null>(null);
  const [logContainer, setLogContainer] = useState<string | null>(null);

  const namespace = nsParam ? decodeURIComponent(nsParam) : "";
  const name = nameParam ? decodeURIComponent(nameParam) : "";

  const detailQ = useQuery({
    queryKey: ["k8s-pod", namespace, name],
    queryFn: () => apiGetJson<PodDetail>(podApiPath(namespace, name)),
    enabled: Boolean(namespace && name),
  });

  const deleteMut = useMutation({
    mutationFn: () => apiDelete(podApiPath(namespace, name)),
    onSuccess: () => {
      setDelOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["k8s-pods"] });
      void queryClient.invalidateQueries({ queryKey: ["k8s-summary"] });
      void navigate(`/cluster/ns/${encodeURIComponent(namespace)}/pods`);
    },
  });

  const copyYaml = async () => {
    if (!detailQ.data?.yaml) return;
    try {
      await navigator.clipboard.writeText(detailQ.data.yaml);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!namespace || !name) {
    return <p className="text-sm text-red-600">无效的 Pod 路径</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1 text-gray-600" asChild>
          <Link to={`/cluster/ns/${encodeURIComponent(namespace)}/pods`}>
            <ArrowLeft className="h-4 w-4" />
            返回列表
          </Link>
        </Button>
        <span className="text-gray-300">|</span>
        <h2 className="text-lg font-semibold text-gray-900 font-mono">{namespace}</h2>
        <span className="text-gray-400">/</span>
        <h2 className="text-lg font-semibold text-gray-900 font-mono">{name}</h2>
      </div>

      {detailQ.isLoading && <p className="text-sm text-gray-500">加载中…</p>}
      {detailQ.error && (
        <p className="text-sm text-red-600">{(detailQ.error as Error).message}</p>
      )}

      {detailQ.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-slate-200/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>阶段</CardDescription>
                <CardTitle className="text-base">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2.5 py-0.5 text-sm font-medium",
                      podPhaseBadgeClass(detailQ.data.phase)
                    )}
                  >
                    {detailQ.data.phase}
                  </span>
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-slate-200/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>Node</CardDescription>
                <CardTitle className="font-mono text-sm">{detailQ.data.node}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-slate-200/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>重启次数</CardDescription>
                <CardTitle className="text-base">{detailQ.data.restarts}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-slate-200/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>创建</CardDescription>
                <CardTitle className="text-base">
                  {parseAge(detailQ.data.age)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-slate-500" />
                <CardTitle className="text-base">进入容器（终端）</CardTitle>
              </div>
              <CardDescription>
                在右侧抽屉中打开交互式 Shell（不离开本页）。亦可复制下方 kubectl 在本地执行。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detailQ.data.containers.length === 0 && (
                <p className="text-sm text-slate-500">暂无容器定义</p>
              )}
              {detailQ.data.containers.map((c) => (
                <div
                  key={c.name + (c.init ? "-init" : "")}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono font-medium text-slate-900">{c.name}</span>
                      {c.init && (
                        <Badge variant="secondary" className="text-[10px]">
                          init
                        </Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-1"
                        onClick={() => setLogContainer(c.name)}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        日志
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1"
                        onClick={() => setTermContainer(c.name)}
                      >
                        <Terminal className="h-3.5 w-3.5" />
                        终端
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500" title={c.image}>
                    {c.image}
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
                    {`kubectl exec -it -n ${namespace} ${name} -c ${c.name} -- /bin/sh`}
                  </pre>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Events</CardTitle>
              <CardDescription>与该 Pod 相关的集群事件（involvedObject）</CardDescription>
            </CardHeader>
            <CardContent>
              {!detailQ.data.events?.length ? (
                <p className="text-sm text-slate-500">暂无事件</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2 font-semibold">Type</th>
                        <th className="px-3 py-2 font-semibold">Reason</th>
                        <th className="px-3 py-2 font-semibold">Message</th>
                        <th className="px-3 py-2 font-semibold">Count</th>
                        <th className="px-3 py-2 font-semibold">Age</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailQ.data.events.map((ev, i) => (
                        <tr key={i} className="border-b border-slate-50 align-top">
                          <td className="px-3 py-2 font-mono text-xs">{ev.type || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{ev.reason || "—"}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">{ev.message}</td>
                          <td className="px-3 py-2 tabular-nums">{ev.count}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">
                            {ev.age ? parseAge(ev.age) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-base">Pod YAML</CardTitle>
                <CardDescription>只读；可复制后用于 kubectl apply -f</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={() => void copyYaml()}>
                  <Copy className="h-3.5 w-3.5" />
                  {copyOk ? "已复制" : "复制"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="gap-1"
                  onClick={() => setDelOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除 Pod
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <YamlCodeBlock value={detailQ.data.yaml} />
            </CardContent>
          </Card>
        </>
      )}

      <PodTerminalSheet
        open={termContainer !== null}
        onOpenChange={(o) => {
          if (!o) setTermContainer(null);
        }}
        namespace={namespace}
        podName={name}
        container={termContainer ?? ""}
      />

      {detailQ.data && logContainer !== null && (
        <PodLogsSheet
          key={`${name}-${logContainer}`}
          open
          onOpenChange={(o) => {
            if (!o) setLogContainer(null);
          }}
          namespace={namespace}
          podName={name}
          container={logContainer}
          containerOptions={detailQ.data.containers.map((c) => ({
            name: c.name,
            init: c.init,
          }))}
        />
      )}

      <AlertDialog
        open={delOpen}
        onOpenChange={(o) => {
          setDelOpen(o);
          if (o) deleteMut.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Pod？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 <span className="font-mono text-foreground">{namespace}/{name}</span>
              。若由工作负载管理，可能会自动重建。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            {deleteMut.isError && (
              <p className="mr-auto w-full text-left text-sm text-red-600">
                {(deleteMut.error as Error).message}
              </p>
            )}
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate()}
            >
              {deleteMut.isPending ? "删除中…" : "确认删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClusterPodDetail;

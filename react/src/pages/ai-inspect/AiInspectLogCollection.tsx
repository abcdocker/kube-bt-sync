import React, { useEffect, useState } from "react";
import { APP_CONFIG_QUERY_KEY } from "@/hooks/use-app-config";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Loader2, Save, ScrollText } from "lucide-react";
import { apiGetJson, apiPutJson } from "@/lib/api";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { VmLogShipperAssistant } from "./VmLogShipperAssistant";

type VmLogStatusHints = {
  configured?: boolean;
  baseUrlHint?: string;
  vmLogVectorDownloadConfigured?: boolean;
  vmLogVectorDownloadBaseUrlHint?: string;
};

/** AI 巡检：虚拟机 / 宝塔日志 → VictoriaLogs（Vector 采集助手） */
const AiInspectLogCollection: React.FC = () => {
  const { status } = useAuth();
  const isAdmin = status?.role === "admin";
  const qc = useQueryClient();
  const [vectorDownloadBaseUrl, setVectorDownloadBaseUrl] = useState("");
  const [vectorFieldDirty, setVectorFieldDirty] = useState(false);

  const statusQ = useQuery({
    queryKey: ["ops-vmlog-status"],
    queryFn: ({ signal }) => apiGetJson<VmLogStatusHints>("/api/ops/vmlog/status", { signal }),
  });
  const st = statusQ.data;

  const runtimeQ = useQuery({
    queryKey: ["settings-runtime", "log-collection-vector-download"],
    queryFn: ({ signal }) => apiGetJson<Record<string, unknown>>("/api/settings/runtime", { signal }),
    enabled: isAdmin,
  });

  useEffect(() => {
    if (!runtimeQ.data || vectorFieldDirty) return;
    setVectorDownloadBaseUrl(String(runtimeQ.data.vmLogVectorDownloadBaseUrl ?? "").trim());
  }, [runtimeQ.data, vectorFieldDirty]);

  const saveVectorDownloadMut = useMutation({
    mutationFn: async () => {
      const cur = await apiGetJson<Record<string, unknown>>("/api/settings/runtime");
      await apiPutJson("/api/settings/runtime", {
        ...cur,
        vmLogVectorDownloadBaseUrl: vectorDownloadBaseUrl.trim(),
      });
    },
    onSuccess: async () => {
      toast.success("已保存 Vector 下载基址");
      setVectorFieldDirty(false);
      await qc.invalidateQueries({ queryKey: ["ops-vmlog-status"] });
      await qc.invalidateQueries({ queryKey: ["runtime-status"] });
      await qc.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ["settings-runtime"] });
      await runtimeQ.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-white to-slate-50/80 px-6 py-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-900/80">AI 巡检 · 日志采集</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <HardDrive className="h-7 w-7 text-emerald-600" />
          虚拟机 / 宝塔 → VictoriaLogs
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          在 Linux 虚拟机或宝塔主机上安装 <strong>Vector</strong>，将文本日志推送到 VictoriaLogs；可在同页配置<strong>可选 OpenSearch 双写</strong>（应用中心部署的集群请用 NodePort 等虚拟机可达地址）。支持生成脚本、管理员后台 SSH 安装与任务进度回传。日志查询与分桶趋势见{" "}
          <Link className="font-medium text-emerald-800 underline-offset-2 hover:underline" to="/cluster/ai-inspect/logs">
            日志查询
          </Link>
          。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="border-emerald-200 bg-white/90" asChild>
            <Link to="/cluster/ai-inspect/logs" className="inline-flex items-center gap-1.5">
              <ScrollText className="h-4 w-4" />
              VictoriaLogs 日志查询
            </Link>
          </Button>
          <Button type="button" variant="outline" size="sm" className="border-emerald-200 bg-white/90" asChild>
            <Link to="/cluster/settings">Cluster Settings（VictoriaLogs）</Link>
          </Button>
        </div>
      </div>

      {isAdmin ? (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Vector 安装包下载源</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              若 GitHub / 公共代理在目标机网络不稳定，请在本页填写<strong>目录基址</strong>（如{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">https://d.frps.cn/file/kube-bt-sync</code>
              ，无尾斜杠）；若粘贴了完整{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">vector-版本-架构.tar.gz</code>
              链接，保存时会自动去掉文件名。安装脚本会<strong>优先</strong>从该地址拉取{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">vector-版本-架构.tar.gz</code>
              ，失败后再尝试内置镜像线与官方 release。文件名需与官方一致，例如{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">vector-0.36.1-x86_64-unknown-linux-gnu.tar.gz</code>。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {runtimeQ.isLoading ? (
              <div className="flex items-center gap-2 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载运行时配置…
              </div>
            ) : runtimeQ.isError ? (
              <p className="text-xs text-red-700">{(runtimeQ.error as Error).message}</p>
            ) : (
              <>
                <div className="max-w-2xl space-y-2">
                  <Label className="text-xs">vmLogVectorDownloadBaseUrl（可选）</Label>
                  <Input
                    className="font-mono text-xs"
                    placeholder="如 https://files.example.com/vector 或 http://10.0.0.8:8081/vector"
                    value={vectorDownloadBaseUrl}
                    onChange={(e) => {
                      setVectorFieldDirty(true);
                      setVectorDownloadBaseUrl(e.target.value);
                    }}
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={saveVectorDownloadMut.isPending || runtimeQ.isFetching}
                    onClick={() => saveVectorDownloadMut.mutate()}
                  >
                    {saveVectorDownloadMut.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    保存下载基址
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-slate-600" asChild>
                    <Link to="/account/settings#runtime-vmlog-vector-download">其它运行时项</Link>
                  </Button>
                </div>
                {!statusQ.isLoading && st?.vmLogVectorDownloadConfigured && st.vmLogVectorDownloadBaseUrlHint ? (
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    当前生效基址（脱敏）：{" "}
                    <code className="break-all rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[11px]">{st.vmLogVectorDownloadBaseUrlHint}</code>
                  </p>
                ) : !statusQ.isLoading && !st?.vmLogVectorDownloadConfigured ? (
                  <p className="text-[11px] text-slate-500">留空并保存则清除自定义基址，脚本将仅走内置镜像线与 GitHub。</p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <VmLogShipperAssistant />
    </div>
  );
};

export default AiInspectLogCollection;

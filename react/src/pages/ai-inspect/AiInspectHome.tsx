import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CollapsibleManual } from "@/components/CollapsibleManual";
import { apiGetJson, apiPostJson, apiPutJson, ApiHttpError } from "@/lib/api";
import { ArrowDown, ArrowRight, Bot, ChevronDown, ScrollText, Sparkles, UserRound } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type OpenClawK8sStatus = {
  phase?: string;
};

type OpenClawK8sStatusBatch = { statuses?: Record<string, OpenClawK8sStatus> };
import { useAuth } from "@/auth/auth-context";
import { toast } from "sonner";
import type { InspectReportFull } from "./InspectReportRich";

/** 巡检模型快捷填入（与 OpenClaw 应用中心预设、厂商 OpenAI 兼容 model 字段一致） */
const INSPECT_MODEL_QUICK_PRESETS: { id: string; model: string }[] = [
  { id: "glm-4.7", model: "glm-4.7" },
  { id: "minimax-m2.7", model: "MiniMax-M2.7" },
  { id: "minimax-m2.5", model: "MiniMax-M2.5" },
  { id: "qwen-turbo", model: "qwen-turbo" },
  { id: "kimi-8k", model: "moonshot-v1-8k" },
];

const OPS_OPENCLAW_SCENARIOS: { role: string; title: string; hint: string }[] = [
  { role: "inspect_summary", title: "巡检报告 · AI 总摘要", hint: "平台巡检完成后生成 Markdown 总评（与上方系统/用户模板一致，可用不同网关与模型）。" },
  { role: "inspect_probe", title: "巡检内 · 连通性探针（pong）", hint: "巡检流程中的大模型 ping；可与摘要使用不同 OpenClaw/模型。" },
  { role: "vmlog_analyze", title: "VictoriaLogs · 日志智能分析", hint: "日志查询页「OpenClaw 分析」与单行分析接口。" },
  { role: "cluster_advisory", title: "kube-system · 控制平面周期建议", hint: "Dashboard 控制面 AI 建议后台任务。" },
];

function emptyOpenClawProfile(): OpenClawEndpointForm {
  return {
    enabled: false,
    baseUrl: "",
    apiKeySet: false,
    model: "",
    systemPrompt: "",
    userTemplate: "",
    timeoutSec: 120,
    skipTlsVerify: false,
    endpointSource: "custom",
    appInstanceId: "",
  };
}

type OpenClawEndpointForm = {
  enabled: boolean;
  baseUrl: string;
  apiKeySet?: boolean;
  model: string;
  systemPrompt: string;
  userTemplate: string;
  timeoutSec: number;
  skipTlsVerify: boolean;
  endpointSource?: string;
  appInstanceId?: string;
};

type OpenClawGet = {
  openclaw: OpenClawEndpointForm;
  /** 分场景覆盖：inspect_summary / inspect_probe / vmlog_analyze / cluster_advisory */
  openclawProfiles?: Record<string, OpenClawEndpointForm>;
  ai: {
    dailyReportHour: number;
    dailyReportMinute: number;
    inspectK8s: boolean;
    inspectVCenter: boolean;
    inspectVCenterEvents: boolean;
    inspectPrometheus?: boolean;
    inspectPrometheusK8s: boolean;
    inspectPrometheusVcenter: boolean;
    inspectVmLog: boolean;
    inspectRedis: boolean;
    inspectSSH: boolean;
    inspectCloudVm: boolean;
    modelExtra: { temperature: number; maxTokens: number; topP: number; frequencyPenalty: number };
  };
};

type InspectRunTask = {
  taskId: string;
  phase: "pending" | "running" | "success" | "error";
  progress: number;
  stage?: string;
  message?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  /** 列表接口为减轻体积可能只返回 id，不含完整 report */
  reportId?: string;
  report?: InspectReportFull;
};

function inspectTaskPhaseStyle(phase: InspectRunTask["phase"]) {
  switch (phase) {
    case "success":
      return {
        card: "border-emerald-200/90 bg-emerald-50/35",
        badge: "bg-emerald-600 text-white",
        label: "已完成",
      };
    case "error":
      return {
        card: "border-red-200/90 bg-red-50/35",
        badge: "bg-red-600 text-white",
        label: "失败",
      };
    case "pending":
      return {
        card: "border-amber-200/90 bg-amber-50/40",
        badge: "bg-amber-600 text-white",
        label: "排队中",
      };
    default:
      return {
        card: "border-sky-200/90 bg-sky-50/45",
        badge: "bg-sky-600 text-white",
        label: "执行中",
      };
  }
}

const AiInspectHome: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { status } = useAuth();
  const isAdmin = status?.role === "admin";
  const q = useQuery({
    queryKey: ["ops-openclaw"],
    queryFn: ({ signal }) => apiGetJson<OpenClawGet>("/api/ops/openclaw", { signal }),
    enabled: isAdmin,
  });
  const [inspectTaskId, setInspectTaskId] = useState("");
  const inspectTaskQ = useQuery({
    queryKey: ["ops-inspect-task", inspectTaskId],
    queryFn: ({ signal }) => apiGetJson<InspectRunTask>(`/api/ops/inspect/tasks/${encodeURIComponent(inspectTaskId)}`, { signal }),
    enabled: isAdmin && !!inspectTaskId,
    refetchInterval: (q) => {
      const phase = q.state.data?.phase;
      return phase === "pending" || phase === "running" || !phase ? 1500 : false;
    },
    retry: 1,
  });
  const inspectTaskListQ = useQuery({
    queryKey: ["ops-inspect-task-list"],
    queryFn: ({ signal }) => apiGetJson<{ tasks: InspectRunTask[] }>("/api/ops/inspect/tasks?limit=8", { signal }),
    enabled: isAdmin,
    refetchInterval: 5000,
    retry: 1,
  });
  const ocInstQ = useQuery({
    queryKey: ["app-openclaw-instances"],
    queryFn: ({ signal }) =>
      apiGetJson<{ instances: { id: string; displayName: string; deploymentName: string; clusterV1BaseUrl: string }[] }>(
      "/api/app-center/openclaw/instances"
    , { signal }),
    enabled: isAdmin,
  });

  const ocK8sQ = useQuery({
    queryKey: ["app-openclaw-k8s-status"],
    queryFn: ({ signal }) => apiGetJson<OpenClawK8sStatusBatch>("/api/app-center/openclaw/instances/k8s-status", { signal }),
    enabled: isAdmin && Boolean(ocInstQ.data?.instances?.length),
    refetchInterval: isAdmin ? 30000 : false,
  });

  const [draft, setDraft] = useState<OpenClawGet | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [profileApiKeys, setProfileApiKeys] = useState<Record<string, string>>({});

  const openInspectReport = useCallback(
    (reportId: string) => {
      const id = reportId.trim();
      if (!id) return;
      navigate(`/cluster/ai-inspect/reports/platform?highlight=${encodeURIComponent(id)}`);
    },
    [navigate]
  );

  useEffect(() => {
    if (!q.data) return;
    const prof: Record<string, OpenClawEndpointForm> = {};
    for (const { role } of OPS_OPENCLAW_SCENARIOS) {
      const src = q.data.openclawProfiles?.[role];
      prof[role] = src
        ? {
            ...emptyOpenClawProfile(),
            ...src,
            endpointSource: src.endpointSource || (src.appInstanceId ? "appInstance" : "custom"),
          }
        : emptyOpenClawProfile();
    }
    setDraft({
      ...q.data,
      openclawProfiles: prof,
      openclaw: {
        ...q.data.openclaw,
        endpointSource:
          q.data.openclaw.endpointSource ||
          (q.data.openclaw.appInstanceId ? "appInstance" : "custom"),
      },
      ai: {
        ...q.data.ai,
        inspectVCenterEvents: q.data.ai.inspectVCenterEvents ?? false,
        inspectPrometheusK8s: q.data.ai.inspectPrometheusK8s ?? q.data.ai.inspectPrometheus ?? false,
        inspectPrometheusVcenter: q.data.ai.inspectPrometheusVcenter ?? q.data.ai.inspectPrometheus ?? false,
        inspectVmLog: q.data.ai.inspectVmLog ?? false,
      },
    });
    setProfileApiKeys({});
  }, [q.data]);

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPutJson("/api/ops/openclaw", body),
    onSuccess: () => {
      toast.success("已保存");
      void qc.invalidateQueries({ queryKey: ["ops-openclaw"] });
      setApiKey("");
      setProfileApiKeys({});
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const runMut = useMutation({
    mutationFn: () => apiPostJson<{ accepted?: boolean; taskId?: string; phase?: string; progress?: number; message?: string }>("/api/ops/inspect/run", {}),
    onSuccess: (res) => {
      if (!res.taskId) {
        toast.error(res.message || "巡检任务创建失败");
        return;
      }
      setInspectTaskId(res.taskId);
      toast.success(res.message || "巡检任务已创建，正在后台执行");
      void qc.invalidateQueries({ queryKey: ["ops-inspect-task-list"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  useEffect(() => {
    if (inspectTaskId || !inspectTaskListQ.data?.tasks?.length) return;
    setInspectTaskId(inspectTaskListQ.data.tasks[0].taskId);
  }, [inspectTaskId, inspectTaskListQ.data]);

  useEffect(() => {
    const task = inspectTaskQ.data;
    if (!task) return;
    if (task.phase === "success") {
      if (task.report) {
        qc.setQueryData<{ reports: InspectReportFull[] }>(["ops-inspect-reports"], (old) => {
          const cur = old?.reports ?? [];
          const rest = cur.filter((r) => r.id !== task.report!.id);
          return { reports: [task.report!, ...rest] };
        });
      }
      void qc.invalidateQueries({ queryKey: ["ops-inspect-reports"] });
    }
  }, [inspectTaskQ.data, qc]);

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-6 text-sm text-amber-950">
        AI 巡检配置与执行仅管理员可用。你可使用左侧「监控中心」查看基于 Prometheus 的监控图（只读）。
      </div>
    );
  }

  if (q.isLoading || !draft) {
    return <p className="text-sm text-slate-500">加载配置…</p>;
  }

  const putBody = () => {
    const src = draft.openclaw.endpointSource === "appInstance" ? "appInstance" : "custom";
    const openclawProfiles: Record<string, Record<string, unknown>> = {};
    for (const { role } of OPS_OPENCLAW_SCENARIOS) {
      const p = draft.openclawProfiles?.[role] ?? emptyOpenClawProfile();
      const psrc = p.endpointSource === "appInstance" ? "appInstance" : "custom";
      openclawProfiles[role] = {
        enabled: p.enabled,
        baseUrl: p.baseUrl,
        apiKey: psrc === "custom" ? profileApiKeys[role]?.trim() || undefined : undefined,
        model: psrc === "appInstance" ? "" : p.model,
        systemPrompt: p.systemPrompt,
        userTemplate: p.userTemplate,
        timeoutSec: p.timeoutSec || 120,
        skipTlsVerify: p.skipTlsVerify,
        endpointSource: psrc,
        appInstanceId: psrc === "appInstance" ? (p.appInstanceId || "").trim() : "",
      };
    }
    return {
      openclaw: {
        enabled: draft.openclaw.enabled,
        baseUrl: draft.openclaw.baseUrl,
        apiKey: src === "custom" ? apiKey.trim() || undefined : undefined,
        // 应用中心实例：模型由登记实例的预设/对话模型推导，服务端 Resolve 填充；勿写巡检页草稿
        model: src === "appInstance" ? "" : draft.openclaw.model,
        systemPrompt: draft.openclaw.systemPrompt,
        userTemplate: draft.openclaw.userTemplate,
        timeoutSec: draft.openclaw.timeoutSec || 120,
        skipTlsVerify: draft.openclaw.skipTlsVerify,
        endpointSource: src,
        appInstanceId: src === "appInstance" ? (draft.openclaw.appInstanceId || "").trim() : "",
      },
      openclawProfiles,
      ai: draft.ai,
    };
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">巡检配置</h1>
        <p className="mt-1 text-sm text-slate-600">
          对接 OpenAI 兼容接口（含自建网关 / OpenClaw 类服务），汇总 Kubernetes、vCenter、Prometheus、Redis、SSH、云主机等检查结果；支持定时每日报告。总览与模块摘要见{" "}
          <Link to="/cluster/ai-inspect/dashboard" className="font-medium text-sky-700 underline">
            Dashboard 总览
          </Link>
          。各类巡检与 AI 报告见{" "}
          <Link to="/cluster/ai-inspect/reports/platform" className="font-medium text-sky-700 underline">
            巡检报告
          </Link>
          。
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">OpenClaw / 对话接口</h2>
        <CollapsibleManual
          storageKey="ai-inspect.openclaw-config-manual"
          title="配置说明（填什么、怎么用）"
          variant="indigo"
          className="mt-3 space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-slate-800"
          titleClassName="text-indigo-950"
        >
          <ul className="list-inside list-disc space-y-1.5 text-[13px] leading-relaxed text-slate-700">
            <li>
              <strong>Base URL</strong>：OpenAI 兼容的 API 根地址（如官方{" "}
              <code className="rounded bg-white/80 px-1">https://api.openai.com/v1</code>、自建 vLLM、或 OpenClaw
              网关暴露的 <code className="rounded bg-white/80 px-1">…/v1</code>
              ）。须与网关文档中的「基础路径」一致，否则请求会 404。选用<strong>应用中心 OpenClaw</strong>时，平台会将{" "}
              <code className="rounded bg-white/80 px-1">MiniMax-M2.7</code> /{" "}
              <code className="rounded bg-white/80 px-1">MiniMax-M2.5</code> 等上游模型名放在{" "}
              <code className="rounded bg-white/80 px-1">x-openclaw-model</code>，body 使用{" "}
              <code className="rounded bg-white/80 px-1">openclaw/default</code>（符合 OpenClaw 网关约定）。
            </li>
            <li>
              <strong>OpenClaw 仍 404</strong>：官方默认关闭{" "}
              <code className="rounded bg-white/80 px-1">POST /v1/chat/completions</code>，须在 PVC 的{" "}
              <code className="rounded bg-white/80 px-1">openclaw.json</code> 中开启{" "}
              <code className="rounded bg-white/80 px-1">gateway.http.endpoints.chatCompletions.enabled</code>
              （kube-bt-sync 新部署的 ConfigMap 已默认开启；旧 PVC 需合并后滚动重启 Pod）。
            </li>
            <li>
              <strong>API Key</strong>：上述网关要求的密钥；若显示「已设置」则无需重复填写，留空表示沿用旧密钥。
            </li>
            <li>
              <strong>模型</strong>：与上游<strong>实际可用</strong>的 model 一致（如{" "}
              <code className="rounded bg-white/80 px-1">MiniMax-M2.7</code>、
              <code className="rounded bg-white/80 px-1">gpt-4o-mini</code>）。选用应用中心 MiniMax 预设时，请确认网关 Secret 中{" "}
              <code className="rounded bg-white/80 px-1">OPENAI_BASE_URL</code> 与密钥门户一致（常见{" "}
              <code className="rounded bg-white/80 px-1">https://api.minimaxi.com/v1</code> 或{" "}
              <code className="rounded bg-white/80 px-1">https://api.minimax.io/v1</code>
              ）；错域易出现 401 <code className="rounded bg-slate-100 px-0.5">invalid api key (2049)</code>
              。修改 Secret 后需滚动重启网关 Deployment。
            </li>
            <li>
              <strong>启用巡检后调用大模型</strong>：关闭时仍会做数据采集与报告，但不会请求 LLM；仅需要结构化 JSON 时可关。
            </li>
            <li>
              <strong>超时</strong>：单次调用大模型的上限（秒）；巡检数据量大时可适当加大。
            </li>
            <li>
              <strong>跳过 TLS 校验</strong>：仅在内网自签证书、且明确接受风险时开启。
            </li>
            <li>
              <strong>系统提示词 / 用户消息模板</strong>：控制大模型如何写巡检摘要；具体分工见本段<strong>下方图示</strong>（不写代码、不贴接口示例）。
            </li>
            <li>
              <strong>模型参数（temperature / max_tokens）</strong>：影响生成随机性与长度，按网关支持范围填写。
            </li>
          </ul>
          <p className="mt-2 border-t border-indigo-100/80 pt-2 text-[13px] font-medium text-slate-800">
            巡检会拉取哪些数据（需先在平台其它处就绪）
          </p>
          <ul className="list-inside list-disc space-y-1 text-[13px] leading-relaxed text-slate-700">
            <li>
              <strong>Kubernetes</strong>：依赖「集群」已连接；开关对应是否把 K8s 摘要纳入报告。
            </li>
            <li>
              <strong>vCenter</strong>：依赖 vCenter 连接与凭据；纳入虚拟机/宿主机侧巡检数据。
            </li>
            <li>
              <strong>Prometheus</strong>：依赖运行时{" "}
              <code className="rounded bg-white/80 px-1">prometheusUrlK8s</code> /{" "}
              <code className="rounded bg-white/80 px-1">prometheusUrlVcenter</code>
              （或兜底 <code className="rounded bg-white/80 px-1">prometheusUrl</code>
              ）。与平台同集群部署时，请填<strong>集群内可解析</strong>的根地址，例如{" "}
              <code className="rounded bg-white/80 px-1">http://prometheus-kube-prometheus-prometheus.monitoring.svc:9090</code>
              （按实际 Service 名称与命名空间调整）；勿填仅宿主机或浏览器可达、而平台 Pod 无法访问的地址。
            </li>
            <li>
              <strong>应用中心 Redis</strong>：依赖应用中心已登记的 Redis 实例。
            </li>
            <li>
              <strong>SSH 凭据存储</strong>：依赖 SSH 设置中已保存的条目。
            </li>
            <li>
              <strong>云主机</strong>：依赖云主机列表中的实例数据。
            </li>
          </ul>
          <p className="text-[12px] text-slate-600">
            下方「巡检范围」开关决定上述模块<strong>是否参与本次采集</strong>；未配置或不可达的模块会在报告里体现为异常或缺失。
          </p>
        </CollapsibleManual>
        <div className="mt-4 space-y-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3">
          <div className="space-y-2">
            <Label>巡检使用的 OpenClaw 来源</Label>
            <Select
              value={draft.openclaw.endpointSource === "appInstance" ? "appInstance" : "custom"}
              onValueChange={(v) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        openclaw: {
                          ...d.openclaw,
                          endpointSource: v,
                          appInstanceId: v === "appInstance" ? d.openclaw.appInstanceId : "",
                          // 切回集群内实例时不再使用巡检页上的远端模型字段，避免误保存旧值
                          model: v === "appInstance" ? "" : d.openclaw.model,
                        },
                      }
                    : d
                )
              }
            >
              <SelectTrigger className="max-w-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">手动填写 Base URL（任意远端 OpenAI 兼容地址）</SelectItem>
                <SelectItem value="appInstance">应用中心已登记的 OpenClaw（集群内 Service 地址）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.openclaw.endpointSource === "appInstance" ? (
            <div className="space-y-2">
              <Label>选择本地实例（仅运行中）</Label>
              {ocK8sQ.isLoading ? (
                <p className="text-xs text-slate-500">正在拉取各实例运行状态…</p>
              ) : null}
              {ocK8sQ.isError ? (
                <p className="text-xs text-amber-800">无法获取 OpenClaw 运行状态，请稍后刷新页面；就绪实例列表可能为空。</p>
              ) : null}
              <Select
                value={draft.openclaw.appInstanceId || ""}
                disabled={ocK8sQ.isLoading}
                onValueChange={(id) =>
                  setDraft((d) => {
                    if (!d) return d;
                    const row = ocInstQ.data?.instances?.find((x) => x.id === id);
                    return {
                      ...d,
                      openclaw: {
                        ...d.openclaw,
                        appInstanceId: id,
                        baseUrl: row?.clusterV1BaseUrl || d.openclaw.baseUrl,
                      },
                    };
                  })
                }
              >
                <SelectTrigger className="max-w-lg">
                  <SelectValue placeholder={ocK8sQ.isLoading ? "加载中…" : "选择实例"} />
                </SelectTrigger>
                <SelectContent>
                  {(ocInstQ.data?.instances ?? [])
                    .filter((x) => (ocK8sQ.data?.statuses?.[x.id]?.phase ?? "") === "ready")
                    .map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.displayName || x.deploymentName || x.id} · {x.clusterV1BaseUrl}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-slate-500">
                仅列出<strong>运行中</strong>（就绪）的 OpenClaw 实例作巡检工具；请在应用中心先部署并等待就绪。集群内地址供本 Dashboard Pod 访问；保存后即选用该实例（Token
                与模型由服务端按登记实例解析）。
              </p>
            </div>
          ) : null}
        </div>
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={draft.openclaw.enabled}
              onCheckedChange={(v) =>
                setDraft((d) => (d ? { ...d, openclaw: { ...d.openclaw, enabled: v } } : d))
              }
            />
            <Label>启用巡检后调用大模型生成摘要</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input
                value={draft.openclaw.baseUrl}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, openclaw: { ...d.openclaw, baseUrl: e.target.value } } : d
                  )
                }
                placeholder="https://api.openai.com/v1"
                disabled={draft.openclaw.endpointSource === "appInstance"}
              />
            </div>
            <div className="space-y-2">
              <Label>超时（秒）</Label>
              <Input
                type="number"
                value={draft.openclaw.timeoutSec || 120}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          openclaw: {
                            ...d.openclaw,
                            timeoutSec: parseInt(e.target.value, 10) || 120,
                          },
                        }
                      : d
                  )
                }
              />
            </div>
          </div>
          {draft.openclaw.endpointSource === "custom" ? (
            <Collapsible defaultOpen={false} className="rounded-lg border border-slate-200 bg-slate-50/90">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-100/80 [&[data-state=open]_svg]:rotate-180">
                <span>远端 OpenClaw / OpenAI 兼容：API Key 与模型（默认折叠）</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200" aria-hidden />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t border-slate-200 px-3 pb-3 pt-3">
                <p className="text-[12px] leading-relaxed text-slate-600">
                  仅在选择「手动填写 Base URL」时需要；密钥框为密码样式，不会在列表中明文展示。
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>API Key {draft.openclaw.apiKeySet ? "（已设置，留空保留）" : ""}</Label>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-… 或网关 Bearer"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>模型</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {INSPECT_MODEL_QUICK_PRESETS.map((p) => (
                        <Button
                          key={p.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() =>
                            setDraft((d) =>
                              d ? { ...d, openclaw: { ...d.openclaw, model: p.model } } : d
                            )
                          }
                        >
                          {p.model}
                        </Button>
                      ))}
                    </div>
                    <Input
                      value={draft.openclaw.model}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, openclaw: { ...d.openclaw, model: e.target.value } } : d
                        )
                      }
                      placeholder="如 MiniMax-M2.7、glm-4.7"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <p className="text-[12px] leading-relaxed text-slate-600">
              已选应用中心集群内实例时，网关 Token 与上游模型由实例登记信息解析，无需在本页填写 API Key 或模型。
            </p>
          )}
          <div className="flex items-center gap-3">
            <Switch
              checked={draft.openclaw.skipTlsVerify}
              onCheckedChange={(v) =>
                setDraft((d) => (d ? { ...d, openclaw: { ...d.openclaw, skipTlsVerify: v } } : d))
              }
            />
            <Label>跳过 TLS 校验（自签证书）</Label>
          </div>

          <div className="rounded-2xl border border-violet-200/90 bg-gradient-to-b from-violet-50/80 to-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-violet-950">
              <Sparkles className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
              系统提示词 vs 用户消息模板
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              每次「立即执行巡检」或定时出报告时，平台会向大模型发<strong>一轮对话</strong>：上面是模型的「长期人设」，下面是当次要它读的「任务说明 + 巡检结论素材」。
            </p>

            <div className="mt-4 flex flex-col items-stretch gap-0 sm:flex-row sm:items-stretch sm:gap-3">
              <div className="flex flex-1 flex-col rounded-xl border-2 border-violet-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                    <Bot className="h-4 w-4" aria-hidden />
                  </span>
                  系统提示词
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                  相当于给模型立的<strong>岗位说明</strong>：用中文还是英文、语气正式/口语、是否用 Markdown
                  标题列表、要不要先总评再分模块……{" "}
                  <span className="text-slate-800">这一段每次请求都会带上，内容一般不变。</span>
                </p>
              </div>

              <div className="flex flex-none items-center justify-center py-1 text-violet-400 sm:w-10 sm:py-0">
                <ArrowDown className="h-5 w-5 sm:hidden" aria-hidden />
                <ArrowRight className="hidden h-5 w-5 sm:block" aria-hidden />
              </div>

              <div className="flex flex-1 flex-col rounded-xl border-2 border-sky-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                    <UserRound className="h-4 w-4" aria-hidden />
                  </span>
                  用户消息模板
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                  相当于当次巡检的<strong>任务工单正文</strong>：你可以写「请根据下列巡检结果写摘要、给建议」等说明。平台会把当次采集到的
                  <strong>结构化巡检摘要</strong>（检查项状态、各模块标题等，由服务端自动生成）{" "}
                  <span className="whitespace-nowrap rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-950">
                    {"{{report}}"}
                  </span>{" "}
                  出现的位置<strong>整段替换</strong>成这份素材，再发给模型；因此模板里一般要留这个占位，否则模型看不到数据。
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50/90 px-3 py-3 text-center">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">发送顺序示意</span>
              <div className="flex flex-wrap items-center justify-center gap-2 text-[12px] text-slate-700">
                <span className="rounded-lg bg-violet-100 px-2.5 py-1 font-medium text-violet-900">系统提示词</span>
                <span className="text-slate-400">→</span>
                <span className="rounded-lg bg-sky-100 px-2.5 py-1 font-medium text-sky-900">用户消息（模板已替换占位）</span>
                <span className="text-slate-400">→</span>
                <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-medium text-emerald-900">模型生成巡检摘要</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-base">系统提示词</Label>
            <p className="text-[12px] leading-relaxed text-slate-500">
              填写模型的角色与输出规范（对应上图紫色卡片）。
            </p>
            <Textarea
              rows={3}
              value={draft.openclaw.systemPrompt}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, openclaw: { ...d.openclaw, systemPrompt: e.target.value } } : d
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base">用户消息模板</Label>
            <p className="text-[12px] leading-relaxed text-slate-500">
              填写当次任务说明；在需要插入巡检数据处保留占位{" "}
              <span className="rounded bg-amber-100 px-1 font-mono text-[11px] text-amber-950">{"{{report}}"}</span>（对应上图蓝色卡片）。
            </p>
            <Textarea
              rows={3}
              value={draft.openclaw.userTemplate}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, openclaw: { ...d.openclaw, userTemplate: e.target.value } } : d
                )
              }
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-200/80 bg-gradient-to-b from-violet-50/40 to-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">分场景 OpenClaw（可选）</h2>
        <p className="mt-1 text-sm text-slate-600">
          下列能力默认走上方「OpenClaw / 对话接口」；若需<strong>不同应用中心实例或远端模型</strong>，在对应折叠中开启并填写。保存时与主配置一并提交。
        </p>
        <div className="mt-4 space-y-3">
          {OPS_OPENCLAW_SCENARIOS.map(({ role, title, hint }) => {
            const p = draft.openclawProfiles?.[role] ?? emptyOpenClawProfile();
            const psrc = p.endpointSource === "appInstance" ? "appInstance" : "custom";
            const patchP = (patch: Partial<OpenClawEndpointForm>) =>
              setDraft((d) => {
                if (!d) return d;
                const base: Record<string, OpenClawEndpointForm> = { ...(d.openclawProfiles ?? {}) };
                for (const { role: r } of OPS_OPENCLAW_SCENARIOS) {
                  if (!base[r]) base[r] = emptyOpenClawProfile();
                }
                const cur = base[role] ?? emptyOpenClawProfile();
                return {
                  ...d,
                  openclawProfiles: { ...base, [role]: { ...cur, ...patch } },
                };
              });
            return (
              <Collapsible key={role} defaultOpen={false} className="rounded-lg border border-violet-100 bg-white/95 shadow-sm">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-violet-950 hover:bg-violet-50/80 [&[data-state=open]_svg]:rotate-180">
                  <span>
                    <span className="font-mono text-xs text-violet-700/90">{role}</span> · {title}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-violet-600 transition-transform duration-200" aria-hidden />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 border-t border-violet-100/80 px-3 pb-3 pt-2">
                  <p className="text-[12px] leading-relaxed text-slate-600">{hint}</p>
                  <div className="flex items-center gap-3">
                    <Switch checked={p.enabled} onCheckedChange={(v) => patchP({ enabled: v })} />
                    <Label>本场景使用独立端点（关闭则与默认一致）</Label>
                  </div>
                  {p.enabled ? (
                    <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50/60 p-3">
                      <div className="space-y-2">
                        <Label className="text-xs">来源</Label>
                        <Select
                          value={psrc}
                          onValueChange={(v) =>
                            patchP({
                              endpointSource: v,
                              appInstanceId: v === "appInstance" ? p.appInstanceId : "",
                            })
                          }
                        >
                          <SelectTrigger className="max-w-lg">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="custom">手动 Base URL</SelectItem>
                            <SelectItem value="appInstance">应用中心 OpenClaw 实例</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {psrc === "appInstance" ? (
                        <div className="space-y-2">
                          <Label className="text-xs">实例（就绪）</Label>
                          <Select
                            value={p.appInstanceId || ""}
                            disabled={ocK8sQ.isLoading}
                            onValueChange={(id) => {
                              const row = ocInstQ.data?.instances?.find((x) => x.id === id);
                              patchP({
                                appInstanceId: id,
                                baseUrl: row?.clusterV1BaseUrl || p.baseUrl,
                              });
                            }}
                          >
                            <SelectTrigger className="max-w-lg">
                              <SelectValue placeholder="选择实例" />
                            </SelectTrigger>
                            <SelectContent>
                              {(ocInstQ.data?.instances ?? [])
                                .filter((x) => (ocK8sQ.data?.statuses?.[x.id]?.phase ?? "") === "ready")
                                .map((x) => (
                                  <SelectItem key={x.id} value={x.id}>
                                    {x.displayName || x.deploymentName || x.id}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-xs">Base URL</Label>
                          <Input
                            value={p.baseUrl}
                            disabled={psrc === "appInstance"}
                            onChange={(e) => patchP({ baseUrl: e.target.value })}
                            placeholder="https://…/v1"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">超时（秒）</Label>
                          <Input
                            type="number"
                            value={p.timeoutSec || 120}
                            onChange={(e) => patchP({ timeoutSec: parseInt(e.target.value, 10) || 120 })}
                          />
                        </div>
                      </div>
                      {psrc === "custom" ? (
                        <Collapsible defaultOpen={false} className="rounded-md border border-slate-200 bg-white">
                          <CollapsibleTrigger className="flex w-full items-center justify-between px-2 py-2 text-left text-xs font-medium text-slate-800 [&[data-state=open]_svg]:rotate-180">
                            API Key 与模型
                            <ChevronDown className="h-3.5 w-3.5 text-slate-500 transition-transform" aria-hidden />
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-2 border-t border-slate-100 px-2 pb-2 pt-2">
                            <div className="space-y-1">
                              <Label className="text-xs">API Key {p.apiKeySet ? "（已设置，留空保留）" : ""}</Label>
                              <Input
                                type="password"
                                value={profileApiKeys[role] ?? ""}
                                onChange={(e) =>
                                  setProfileApiKeys((m) => ({
                                    ...m,
                                    [role]: e.target.value,
                                  }))
                                }
                                autoComplete="off"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">模型</Label>
                              <div className="flex flex-wrap gap-1">
                                {INSPECT_MODEL_QUICK_PRESETS.map((pr) => (
                                  <Button
                                    key={`${role}-${pr.id}`}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[11px]"
                                    onClick={() => patchP({ model: pr.model })}
                                  >
                                    {pr.model}
                                  </Button>
                                ))}
                              </div>
                              <Input value={p.model} onChange={(e) => patchP({ model: e.target.value })} />
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ) : (
                        <p className="text-[11px] text-slate-500">应用中心实例的 Token / 模型由服务端解析。</p>
                      )}
                      <div className="flex items-center gap-3">
                        <Switch checked={p.skipTlsVerify} onCheckedChange={(v) => patchP({ skipTlsVerify: v })} />
                        <Label className="text-xs">跳过 TLS 校验</Label>
                      </div>
                    </div>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">模型参数</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>temperature</Label>
            <Input
              type="number"
              step="0.1"
              value={draft.ai.modelExtra?.temperature ?? 0}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        ai: {
                          ...d.ai,
                          modelExtra: {
                            ...d.ai.modelExtra,
                            temperature: parseFloat(e.target.value) || 0,
                          },
                        },
                      }
                    : d
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label>max_tokens</Label>
            <Input
              type="number"
              value={draft.ai.modelExtra?.maxTokens ?? 2048}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        ai: {
                          ...d.ai,
                          modelExtra: {
                            ...d.ai.modelExtra,
                            maxTokens: parseInt(e.target.value, 10) || 2048,
                          },
                        },
                      }
                    : d
                )
              }
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">巡检范围与每日报告</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["inspectK8s", "Kubernetes API"],
              ["inspectVCenter", "vCenter"],
              ["inspectVCenterEvents", "vCenter VM 事件与宿主机告警"],
              ["inspectPrometheusK8s", "Prometheus（Kubernetes 数据源）"],
              ["inspectPrometheusVcenter", "Prometheus（vCenter 数据源）"],
              ["inspectVmLog", "VictoriaLogs / VM 日志"],
              ["inspectRedis", "应用中心 Redis 实例表"],
              ["inspectSSH", "SSH 凭据存储"],
              ["inspectCloudVm", "云主机实例表"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="flex items-center gap-3">
              <Switch
                checked={Boolean((draft.ai as unknown as Record<string, boolean>)[k])}
                onCheckedChange={(v) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          ai: { ...d.ai, [k]: v } as OpenClawGet["ai"],
                        }
                      : d
                  )
                }
              />
              <Label>{label}</Label>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium text-slate-900">本次巡检列表</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[13px] leading-relaxed">
            <li>Kubernetes：资源概览、近期事件、异常 Pod 日志摘录、问题类型/严重级别/建议处理</li>
            <li>vCenter：虚拟机清单与资源使用率摘要</li>
            <li>vCenter VM 事件与宿主机告警：过去 24h 的 VM 电源/配置变更事件 + 宿主机原生告警（黄色/红色）</li>
            <li>Prometheus（Kubernetes / vCenter）：分别做探活与基础可用性巡检</li>
            <li>VictoriaLogs / VM 日志：查询可达性、近 24 小时日志量、最近日志样本、已开启采集目标概览</li>
            <li>应用中心 Redis、云主机、SSH 凭据存储、OpenClaw 网关探针</li>
          </ul>
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label>每日报告时刻（中国时区 Asia/Shanghai）</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                max={23}
                className="w-20"
                value={draft.ai.dailyReportHour ?? 8}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          ai: { ...d.ai, dailyReportHour: parseInt(e.target.value, 10) || 0 },
                        }
                      : d
                  )
                }
              />
              <span className="py-2">:</span>
              <Input
                type="number"
                min={0}
                max={59}
                className="w-20"
                value={draft.ai.dailyReportMinute ?? 0}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          ai: { ...d.ai, dailyReportMinute: parseInt(e.target.value, 10) || 0 },
                        }
                      : d
                  )
                }
              />
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={() => saveMut.mutate(putBody())} disabled={saveMut.isPending}>
            保存配置
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
          >
            立即执行巡检
          </Button>
        </div>
        {inspectTaskQ.data ? (
          <div
            className={cn(
              "mt-6 space-y-3 rounded-xl border p-4",
              inspectTaskQ.data.phase === "success" && "border-emerald-200/90 bg-emerald-50/50",
              inspectTaskQ.data.phase === "error" && "border-red-200/90 bg-red-50/50",
              inspectTaskQ.data.phase === "pending" && "border-amber-200/90 bg-amber-50/50",
              (inspectTaskQ.data.phase === "running" || !inspectTaskQ.data.phase) && "border-sky-200/80 bg-sky-50/60"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    inspectTaskQ.data.phase === "success"
                      ? "text-emerald-950"
                      : inspectTaskQ.data.phase === "error"
                        ? "text-red-950"
                        : inspectTaskQ.data.phase === "pending"
                          ? "text-amber-950"
                          : "text-sky-950"
                  )}
                >
                  当前巡检任务进度
                </p>
                <p className="text-xs text-slate-600">
                  任务 {inspectTaskQ.data.taskId} · {inspectTaskQ.data.stage || "—"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white",
                    inspectTaskQ.data.phase === "success"
                      ? "bg-emerald-600"
                      : inspectTaskQ.data.phase === "error"
                        ? "bg-red-600"
                        : inspectTaskQ.data.phase === "pending"
                          ? "bg-amber-600"
                          : "bg-sky-600"
                  )}
                >
                  {inspectTaskQ.data.phase === "success"
                    ? "已完成"
                    : inspectTaskQ.data.phase === "error"
                      ? "失败"
                      : inspectTaskQ.data.phase === "pending"
                        ? "排队中"
                        : "执行中"}
                </span>
                {inspectTaskQ.data.phase === "success" &&
                (inspectTaskQ.data.reportId || inspectTaskQ.data.report?.id) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 border-emerald-300 bg-white text-[11px] text-emerald-900 hover:bg-emerald-50"
                    onClick={() =>
                      openInspectReport(inspectTaskQ.data!.reportId || inspectTaskQ.data!.report!.id)
                    }
                  >
                    <ScrollText className="mr-1 h-3.5 w-3.5" aria-hidden />
                    定位报告
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span>{inspectTaskQ.data.message || "巡检处理中…"}</span>
                <span className="font-mono">{inspectTaskQ.data.progress ?? 0}%</span>
              </div>
              <Progress value={inspectTaskQ.data.progress ?? 0} className="h-2 bg-sky-200/70" />
              <p className="text-[11px] text-slate-500">
                {inspectTaskQ.data.startedAt ? `开始：${inspectTaskQ.data.startedAt}` : ""}
                {inspectTaskQ.data.finishedAt ? ` · 结束：${inspectTaskQ.data.finishedAt}` : ""}
              </p>
            </div>
            {inspectTaskQ.data.error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">{inspectTaskQ.data.error}</p>
            ) : null}
          </div>
        ) : null}
        {inspectTaskListQ.data?.tasks?.length ? (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">最近巡检任务</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                点击任务可同步到上方进度卡片；已完成任务可打开「巡检报告」页并定位对应平台报告；失败任务可展开查看错误详情。
              </p>
            </div>
            <div className="space-y-2">
              {inspectTaskListQ.data.tasks.map((task) => {
                const vis = inspectTaskPhaseStyle(task.phase);
                const rid = task.reportId || task.report?.id;
                return (
                  <div
                    key={task.taskId}
                    className={cn("overflow-hidden rounded-lg border bg-white shadow-sm transition", vis.card)}
                  >
                    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-md text-left text-xs outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-sky-400"
                        onClick={() => setInspectTaskId(task.taskId)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">{task.message || task.stage || "巡检任务"}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", vis.badge)}>
                            {vis.label}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">{task.progress ?? 0}%</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-600">
                          {task.startedAt || "—"}
                          {task.finishedAt ? ` · ${task.finishedAt}` : ""}
                        </p>
                      </button>
                      {task.phase === "success" && rid ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 border-emerald-300 bg-white text-[11px] text-emerald-900 hover:bg-emerald-50 sm:self-center"
                          onClick={() => openInspectReport(rid)}
                        >
                          <ScrollText className="mr-1 h-3.5 w-3.5" aria-hidden />
                          定位报告
                        </Button>
                      ) : null}
                    </div>
                    {task.phase === "error" && task.error ? (
                      <Collapsible className="group border-t border-red-100/90 bg-red-50/20">
                        <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-medium text-red-900 hover:bg-red-50/60">
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                          查看错误详情
                        </CollapsibleTrigger>
                        <CollapsibleContent className="px-3 pb-3">
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-200 bg-white p-2 font-mono text-[11px] leading-relaxed text-red-950">
                            {task.error}
                          </pre>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

    </div>
  );
};

export default AiInspectHome;

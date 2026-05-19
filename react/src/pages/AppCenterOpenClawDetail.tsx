import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonCodeEditor } from "@/components/JsonCodeEditor";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiHttpError, apiGetJson, apiPostJson, apiPutJson } from "@/lib/api";
import { copyToClipboardSafe } from "@/lib/clipboard";
import { formatDateTimeShanghai } from "@/lib/datetime-cn";
import { OpenClawChat404RemedyPanel } from "@/components/OpenClawChat404Remedy";
import { OpenClawChat5xxRemedyPanel } from "@/components/OpenClawChat5xxRemedy";
import {
  formatOpenClawClusterChatProbeSnippet,
  formatOpenClawGatewayHealthInstanceLine,
  isOpenClawGatewayChatNoHttpStatus,
  normalizeOpenClawGatewayChatHttpStatus,
} from "@/lib/openclaw-gateway-health";
import { openClawChatAllowed } from "@/lib/openclaw-gateway-image";
import { cloudVmAppCenterCanWrite } from "@/lib/platform-permissions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OPENCLAW_BOOTSTRAP_PATH = "/cluster/apps/openclaw/bootstrap";
const DEPLOY_MODE_NOMATCH = "__oc_image_nomatch__";

/** 与列表页 / 后端目录一致；API 未返回时用于勾选与 dirty 判断 */
const OPENCLAW_PROMPT_PACKS_FALLBACK: { id: string; label: string; description?: string }[] = [
  { id: "k8s_execute_first", label: "集群查询：先工具后回答", description: "" },
  { id: "respond_with_concrete", label: "输出：先结论后解释", description: "" },
  { id: "ollama_tools_note", label: "Ollama：工具调用说明", description: "" },
];

type OpenClawBootstrapMode = {
  id: string;
  label: string;
  description?: string;
  image: string;
  initContainerImage?: string;
};

type OpenClawBootstrapResp = {
  bootstrapComplete: boolean;
  modes: OpenClawBootstrapMode[];
  defaultNamespace?: string;
  defaultRbacPreset?: string;
};

type InstanceRow = {
  id: string;
  displayName: string;
  namespace: string;
  deploymentName: string;
  serviceName: string;
  image: string;
  pvcClaimName?: string;
  modelPreset?: string;
  chatModel?: string;
  chatProxyCount?: number;
  chatProxyCountViewer?: number;
  upstreamCheckStatus?: string;
  upstreamCheckMessage?: string;
  upstreamCheckAt?: string;
  egressCloudVmId?: string;
  httpProxyUrl?: string;
  telegramEnabled?: boolean;
  googleOk?: boolean;
  googleCheckedAt?: string;
  hasTelegramToken?: boolean;
  rbacPreset?: string;
  rbacClusterRoleName?: string;
  clusterRoleBindingName?: string;
  toolsProfile?: string;
  promptPacks?: string[];
};

type OpenClawToolchainOptionsResp = {
  toolchains: { id: string; label: string; description?: string }[];
  promptPacks: { id: string; label: string; description?: string }[];
  ollamaModelRecommendations?: { id: string; note?: string }[];
};

type CloudVmListRow = {
  id: number;
  name: string;
  namespace: string;
  summary?: { installHysteria2?: boolean; hysteria2ClusterEndpoint?: string; hysteria2Port?: number };
};

type TelegramSettings = {
  mysqlRequired?: boolean;
  telegramEnabled?: boolean;
  googleOk?: boolean;
  googleCheckedAt?: string;
  hasTelegramToken?: boolean;
};

function defaultChatModelForPreset(preset: string): string {
  switch (preset) {
    case "glm-4.7":
      return "glm-4.7";
    case "minimax-m2.5":
      return "MiniMax-M2.5";
    case "minimax-m2.7":
      return "MiniMax-M2.7";
    case "openai":
      return "gpt-4o-mini";
    case "ollama":
      return "llama3.2";
    case "qwen-compatible":
      return "qwen-turbo";
    case "kimi":
      return "moonshot-v1-8k";
    default:
      return "";
  }
}

type OpenClawDetailK8sSt = {
  phase?: string;
  imageRolloutSynced?: boolean;
  imageRolloutMessage?: string;
  runningGatewayImage?: string;
  templateGatewayImage?: string;
  platformInitRevisionAligned?: boolean;
  platformInitRevisionExpected?: number;
  platformInitRevisionObserved?: number;
  platformInitRevisionHint?: string;
  /** 与集群内 ClusterRoleBinding / Deployment SA / SAR(list pods) 是否一致 */
  openclawRbacClientGoChecked?: boolean;
  openclawRbacClientGoFullyAligned?: boolean;
  openclawRbacClientGoHint?: string;
  openclawRbacExpectedClusterRole?: string;
  openclawRbacLiveClusterRoleName?: string;
  openclawRbacExpectedServiceAccount?: string;
  openclawRbacPodTemplateSA?: string;
  openclawRbacPodTemplateSAOk?: boolean;
  openclawRbacClusterRoleBindingFound?: boolean;
  openclawRbacBindingMatchesRegistration?: boolean;
  openclawRbacSARListPodsAllowed?: boolean;
  openclawRbacSARError?: string;
  openclawRbacSARReason?: string;
};

function effectiveOpenClawChatModel(row: Pick<InstanceRow, "chatModel" | "modelPreset">): string {
  const m = (row.chatModel ?? "").trim();
  if (m) return m;
  return defaultChatModelForPreset(row.modelPreset ?? "");
}

const FILE_TABS: { id: string; path: string; label: string; hint: string }[] = [
  {
    id: "json",
    path: "openclaw.json",
    label: "openclaw.json",
    hint: "网关主配置；保存前会校验 JSON 且必须包含 gateway 段。Control UI 若提示 origin not allowed，请在 gateway.controlUi 中设置 allowedOrigins（例如 [\"*\"]）；新 Pod 的 init 也会在该项为空时自动补全。保存后若网关未重读配置，请滚动重启 Deployment。Ollama 模型若遇「context too small / min 16000」，请把 models.providers 里对应条目的 contextWindow 调到 ≥16384（平台部署预设与 Pod init 会对 api=ollama 且小于 16000 的登记自动抬到 16384）。",
  },
  { id: "agents", path: "workspace/AGENTS.md", label: "AGENTS.md", hint: "工作区默认智能体说明。" },
  { id: "boot", path: "workspace/BOOT.md", label: "BOOT.md", hint: "启动/引导说明（自定义）。" },
  { id: "memory", path: "workspace/MEMORY.md", label: "MEMORY.md", hint: "长期记忆提示（自定义）。" },
  { id: "soul", path: "workspace/SOUL.md", label: "SOUL.md", hint: "人格/风格（自定义）。" },
];

type OpenClawApplyUpstreamRuntimeStep = { label: string; ok: boolean; detail?: string };
type OpenClawApplyUpstreamRuntimeResp = {
  ok?: boolean;
  steps?: OpenClawApplyUpstreamRuntimeStep[];
  restarted?: boolean;
  rolloutWaitOk?: boolean;
  rolloutWaitMessage?: string;
  upstreamOk?: boolean;
  upstreamMessage?: string;
  upstreamHttpStatus?: number;
  modelTried?: string;
  upstreamCheckedAt?: string;
};

function validateOpenClawJsonClient(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "内容不能为空";
  try {
    const o = JSON.parse(s) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return "根节点须为 JSON 对象";
    if (!("gateway" in (o as Record<string, unknown>))) return "缺少 gateway 段，网关无法正常启动";
    return null;
  } catch {
    return "不是合法 JSON";
  }
}

function OpenClawFilePanel(props: {
  instanceId: string;
  filePath: string;
  hint: string;
  tabId: string;
  canWrite: boolean;
  fetchEnabled: boolean;
}) {
  const { instanceId, filePath, hint, tabId, canWrite, fetchEnabled } = props;
  const qc = useQueryClient();
  const fileQ = useQuery({
    queryKey: ["app-openclaw-file", instanceId, filePath],
    queryFn: ({ signal }) =>
      apiGetJson<{ path: string; missing?: boolean; content?: string }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/file?path=${encodeURIComponent(filePath)}`
      , { signal }),
    enabled: Boolean(instanceId) && fetchEnabled,
  });

  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (fileQ.data?.missing) {
      setDraft("");
      return;
    }
    if (fileQ.data?.content != null) {
      setDraft(fileQ.data.content);
    }
  }, [fileQ.data?.content, fileQ.data?.missing, filePath]);

  const saveMut = useMutation({
    mutationFn: () =>
      apiPutJson(`/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/file`, {
        path: filePath,
        content: draft,
      }),
    onSuccess: () => {
      toast.success("已保存到 PVC（持久卷）");
      void qc.invalidateQueries({ queryKey: ["app-openclaw-file", instanceId, filePath] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const trySave = useCallback(() => {
    if (filePath === "openclaw.json") {
      const err = validateOpenClawJsonClient(draft);
      if (err) {
        toast.error(err);
        return;
      }
    }
    saveMut.mutate();
  }, [filePath, draft, saveMut]);

  return (
    <div className="space-y-3 outline-none">
      <p className="text-xs text-slate-500">{hint}</p>
      {fileQ.isFetching && !fileQ.data ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : fileQ.isError ? (
        <p className="text-sm text-red-600">{(fileQ.error as Error).message}</p>
      ) : (
        <>
          {filePath === "openclaw.json" ? (
            <>
              <span className="text-sm font-medium text-slate-700">内容（JSON 高亮）</span>
              <JsonCodeEditor
                value={draft}
                onChange={setDraft}
                readOnly={!canWrite || saveMut.isPending}
                height="min(480px, 60vh)"
                placeholder="// 加载中或为空"
              />
            </>
          ) : (
            <>
              <Label htmlFor={`oc-${tabId}`}>内容</Label>
            <Textarea
              id={`oc-${tabId}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canWrite || saveMut.isPending}
              className="min-h-[280px] font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
            </>
          )}
          {canWrite ? (
            <Button
              type="button"
              className="gap-1.5 bg-violet-600 hover:bg-violet-700"
              disabled={saveMut.isPending}
              onClick={trySave}
            >
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存
            </Button>
          ) : (
            <p className="text-xs text-slate-500">当前账号为只读，无法保存。</p>
          )}
        </>
      )}
    </div>
  );
}

const AppCenterOpenClawDetail: React.FC = () => {
  const { id: instanceId = "" } = useParams<{ id: string }>();
  const { status } = useAuth();
  const qc = useQueryClient();
  const canWrite = cloudVmAppCenterCanWrite(status?.role, status?.permissions);
  const isAdmin = status?.role === "admin";

  const bootstrapQ = useQuery({
    queryKey: ["app-openclaw-bootstrap"],
    queryFn: ({ signal }) => apiGetJson<OpenClawBootstrapResp>("/api/app-center/openclaw/bootstrap", { signal }),
    staleTime: 60_000,
  });
  const bootstrapModes = bootstrapQ.data?.modes ?? [];

  const [tab, setTab] = useState(FILE_TABS[0].id);
  const [topTab, setTopTab] = useState<"files" | "manage">("files");
  const [modelDraft, setModelDraft] = useState("");
  const [upstreamBaseDraft, setUpstreamBaseDraft] = useState("");
  const [upstreamKeyDraft, setUpstreamKeyDraft] = useState("");
  const [applyRuntimeOpen, setApplyRuntimeOpen] = useState(false);
  const [applyRuntimeResult, setApplyRuntimeResult] = useState<OpenClawApplyUpstreamRuntimeResp | null>(null);
  const [applyRuntimeError, setApplyRuntimeError] = useState<string | null>(null);
  const [egressVmDraft, setEgressVmDraft] = useState("");
  const [httpProxyDraft, setHttpProxyDraft] = useState("");
  const [tgTokenDraft, setTgTokenDraft] = useState("");
  const [tgEnabledDraft, setTgEnabledDraft] = useState(false);
  const [tgVerifyLast, setTgVerifyLast] = useState<{
    ok: boolean;
    detail?: string;
    botUsername?: string;
    steps?: string[];
    proxyUsed?: string;
  } | null>(null);
  const [imgDraft, setImgDraft] = useState("");
  const [detailDeployModeId, setDetailDeployModeId] = useState("");
  const [rbacDraft, setRbacDraft] = useState<"readonly" | "edit" | "admin">("readonly");
  const [toolsProfileManage, setToolsProfileManage] = useState<"minimal" | "coding" | "full">("full");
  const [promptPackManage, setPromptPackManage] = useState<Record<string, boolean>>({});

  const rbacPresetsQ = useQuery({
    queryKey: ["app-openclaw-rbac-presets"],
    queryFn: ({ signal }) =>
      apiGetJson<{
        presets: { id: string; label: string; description: string; clusterRoleName: string }[];
      }>("/api/app-center/openclaw/rbac-presets", { signal }),
    staleTime: 300_000,
    enabled: Boolean(instanceId) && topTab === "manage",
  });
  const rbacPresetRows = rbacPresetsQ.data?.presets ?? [
    { id: "readonly", label: "只读", description: "", clusterRoleName: "kube-bt-openclaw-readonly" },
    { id: "edit", label: "编辑", description: "", clusterRoleName: "kube-bt-openclaw-edit" },
    { id: "admin", label: "管理员", description: "", clusterRoleName: "kube-bt-openclaw-admin" },
  ];

  const toolchainOptsQ = useQuery({
    queryKey: ["openclaw-toolchain-options"],
    queryFn: ({ signal }) => apiGetJson<OpenClawToolchainOptionsResp>("/api/app-center/openclaw/toolchain-options", { signal }),
    staleTime: 300_000,
    enabled: Boolean(instanceId) && topTab === "manage",
  });

  const promptPackCatalog = useMemo(
    () =>
      toolchainOptsQ.data?.promptPacks?.length
        ? toolchainOptsQ.data.promptPacks
        : OPENCLAW_PROMPT_PACKS_FALLBACK,
    [toolchainOptsQ.data?.promptPacks]
  );

  const instQ = useQuery({
    queryKey: ["app-openclaw-instances"],
    queryFn: ({ signal }) => apiGetJson<{ instances: InstanceRow[] }>("/api/app-center/openclaw/instances", { signal }),
  });

  const row = useMemo(
    () => instQ.data?.instances?.find((x) => x.id === instanceId),
    [instQ.data?.instances, instanceId]
  );

  const applyRuntimeHasWork = useMemo(() => {
    if (!row) return false;
    if (upstreamBaseDraft.trim() !== "" || upstreamKeyDraft.trim() !== "") return true;
    const eff = effectiveOpenClawChatModel(row);
    const md = modelDraft.trim();
    const stored = (row.chatModel ?? "").trim();
    if (stored !== "" && md === "") return true;
    return md !== eff;
  }, [row, upstreamBaseDraft, upstreamKeyDraft, modelDraft]);

  const gwHealthQ = useQuery({
    queryKey: ["openclaw-gateway-service-health"],
    queryFn: ({ signal }) =>
      apiGetJson<{
        enabled?: boolean;
        lastCheckAt?: string;
        intervalSec?: number;
        healthChatTimeoutSec?: number;
        items?: Array<{
          id: string;
          displayName?: string;
          namespace?: string;
          deploymentName?: string;
          skipped?: boolean;
          clusterChatOk?: boolean;
          clusterChatMessage?: string;
          clusterChatHttpStatus?: number;
        }>;
      }>("/api/app-center/openclaw/gateway-service-health", { signal }),
    enabled: Boolean(instanceId) && Boolean(status?.loggedIn),
    refetchInterval: 90_000,
    staleTime: 45_000,
  });

  const gwHealthBadThis = useMemo(() => {
    const it = gwHealthQ.data?.items?.find((x) => x.id === instanceId);
    if (!it || it.skipped) return null;
    return it.clusterChatOk === false ? it : null;
  }, [gwHealthQ.data?.items, instanceId]);

  const gwChatHttpSt = useMemo(
    () => normalizeOpenClawGatewayChatHttpStatus(gwHealthBadThis?.clusterChatHttpStatus),
    [gwHealthBadThis?.clusterChatHttpStatus]
  );
  const gwChatIs404 = gwChatHttpSt === 404;
  const gwChatIs5xx = gwChatHttpSt != null && gwChatHttpSt >= 500 && gwChatHttpSt < 600;
  const gwChatIsTimeout = useMemo(() => {
    const m = (gwHealthBadThis?.clusterChatMessage ?? "").toLowerCase();
    return m.includes("超时") || m.includes("deadline") || m.includes("未完成");
  }, [gwHealthBadThis?.clusterChatMessage]);
  const gwChatNoHttpStatus = isOpenClawGatewayChatNoHttpStatus(gwHealthBadThis?.clusterChatHttpStatus);
  const gwChatIsTransportLayer = useMemo(() => {
    if (gwChatIs404 || gwChatIs5xx || gwChatIsTimeout) return false;
    return gwChatNoHttpStatus;
  }, [gwChatIs404, gwChatIs5xx, gwChatIsTimeout, gwChatNoHttpStatus]);

  const cloudVmQ = useQuery({
    queryKey: ["app-center-cloud-vm-instances", "openclaw-detail"],
    queryFn: ({ signal }) => apiGetJson<{ instances: CloudVmListRow[] }>("/api/app-center/cloud-vm/instances", { signal }),
    enabled: Boolean(instanceId) && topTab === "manage",
  });

  const hysteriaCloudVms = useMemo(() => {
    const list = cloudVmQ.data?.instances ?? [];
    return list.filter((x) => x.summary?.installHysteria2);
  }, [cloudVmQ.data?.instances]);

  const telegramQ = useQuery({
    queryKey: ["openclaw-telegram-settings", instanceId],
    queryFn: ({ signal }) =>
      apiGetJson<TelegramSettings>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/telegram-settings`
      , { signal }),
    enabled: Boolean(instanceId) && topTab === "manage",
  });

  useEffect(() => {
    if (!row) return;
    setEgressVmDraft((row.egressCloudVmId ?? "").trim());
    setHttpProxyDraft((row.httpProxyUrl ?? "").trim());
  }, [row?.id, row?.egressCloudVmId, row?.httpProxyUrl]);

  useEffect(() => {
    if (!row) return;
    const im = (row.image ?? "").trim();
    setImgDraft(im);
    const modes = bootstrapQ.data?.modes ?? [];
    if (modes.length) {
      const hit = modes.find((m) => m.image.trim() === im);
      setDetailDeployModeId(hit ? hit.id : DEPLOY_MODE_NOMATCH);
    }
  }, [row?.id, row?.image, bootstrapQ.data?.modes]);

  const k8sRolloutQ = useQuery({
    queryKey: ["app-openclaw-k8s-status"],
    queryFn: ({ signal }) =>
      apiGetJson<{ statuses?: Record<string, OpenClawDetailK8sSt> }>("/api/app-center/openclaw/instances/k8s-status", { signal }),
    enabled: Boolean(instanceId),
    refetchInterval: instanceId && topTab === "manage" ? 3500 : false,
  });

  const rolloutSt = instanceId ? k8sRolloutQ.data?.statuses?.[instanceId] : undefined;
  const listChatGate = openClawChatAllowed(rolloutSt);

  useEffect(() => {
    const t = telegramQ.data;
    if (!t || t.mysqlRequired) return;
    setTgEnabledDraft(!!t.telegramEnabled);
  }, [telegramQ.data?.telegramEnabled, telegramQ.data?.mysqlRequired]);

  useEffect(() => {
    if (!row) return;
    setModelDraft(effectiveOpenClawChatModel(row));
  }, [row?.id, row?.chatModel, row?.modelPreset]);

  useEffect(() => {
    if (!row) return;
    const p = (row.rbacPreset ?? "").trim().toLowerCase();
    if (p === "readonly" || p === "edit" || p === "admin") {
      setRbacDraft(p);
    } else {
      setRbacDraft("readonly");
    }
  }, [row?.id, row?.rbacPreset]);

  useEffect(() => {
    if (!row) return;
    const raw = (row.toolsProfile ?? "").trim().toLowerCase();
    if (raw === "minimal" || raw === "coding" || raw === "full") {
      setToolsProfileManage(raw);
    } else {
      setToolsProfileManage("full");
    }
    const next: Record<string, boolean> = {};
    for (const p of promptPackCatalog) next[p.id] = (row.promptPacks ?? []).includes(p.id);
    setPromptPackManage(next);
  }, [row?.id, row?.toolsProfile, row?.promptPacks, promptPackCatalog]);

  const effectiveRowRbac = (): "readonly" | "edit" | "admin" => {
    const p = (row?.rbacPreset ?? "").trim().toLowerCase();
    if (p === "edit" || p === "admin") return p;
    return "readonly";
  };

  const rbacPresetMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ ok?: boolean; gatewayRestart?: boolean }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/rbac-preset`,
        { preset: rbacDraft }
      ),
    onSuccess: (data) => {
      toast.success(
        data?.gatewayRestart
          ? "已更新集群权限，并已对齐网关 Pod 的 ServiceAccount、触发滚动重启（约 1～2 分钟后再试集群工具）"
          : "已更新集群权限绑定"
      );
      void qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      void qc.invalidateQueries({ queryKey: ["app-openclaw-k8s-status"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const toolchainApplyDirty = useMemo(() => {
    if (!row) return false;
    const raw = (row.toolsProfile ?? "").trim().toLowerCase();
    const effTp = raw === "minimal" || raw === "coding" || raw === "full" ? raw : "full";
    if (toolsProfileManage !== effTp) return true;
    for (const p of promptPackCatalog) {
      const want = (row.promptPacks ?? []).includes(p.id);
      if (!!promptPackManage[p.id] !== want) return true;
    }
    return false;
  }, [row, toolsProfileManage, promptPackManage, promptPackCatalog]);

  const applyToolchainMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ ok?: boolean }>(`/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/apply-toolchain-preset`, {
        toolsProfile: toolsProfileManage,
        promptPacks: Object.entries(promptPackManage)
          .filter(([, on]) => on)
          .map(([id]) => id),
      }),
    onSuccess: async () => {
      toast.success("已更新工具链与提示词，并已触发网关滚动重启");
      await qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      await qc.invalidateQueries({ queryKey: ["app-openclaw-k8s-status"] });
      await qc.invalidateQueries({ queryKey: ["app-openclaw-file", instanceId] });
      await qc.invalidateQueries({ queryKey: ["openclaw-gateway-service-health"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const applyUpstreamRuntimeMut = useMutation({
    mutationFn: () =>
      apiPostJson<OpenClawApplyUpstreamRuntimeResp>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/apply-upstream-runtime`,
        {
          chatModel: modelDraft.trim(),
          openaiBaseUrl: upstreamBaseDraft.trim(),
          openaiApiKey: upstreamKeyDraft.trim(),
        }
      ),
    onSuccess: async (data) => {
      setApplyRuntimeResult(data);
      setUpstreamKeyDraft("");
      await qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      await qc.invalidateQueries({ queryKey: ["app-openclaw-k8s-status"] });
      await qc.invalidateQueries({ queryKey: ["openclaw-gateway-service-health"] });
    },
    onError: (e) => {
      setApplyRuntimeError(e instanceof ApiHttpError ? e.serverMessage : String(e));
    },
  });

  const upstreamMut = useMutation({
    mutationFn: () =>
      apiGetJson<{ ok?: boolean; message?: string; httpStatus?: number }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/upstream-health`
      ),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      if (data.ok) toast.success(data.message || "上游大模型接口正常");
      else toast.error(data.message || "上游检测未通过（密钥失效、网络或模型名错误等）");
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const egressMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ ok?: boolean; effectiveHttpProxyUrl?: string }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/egress-proxy`,
        {
          httpProxyUrl: httpProxyDraft.trim(),
          egressCloudVmId: egressVmDraft.trim(),
        }
      ),
    onSuccess: (data) => {
      const eff = (data?.effectiveHttpProxyUrl ?? "").trim();
      toast.success(
        eff
          ? `已保存出站登记；网关与 openclaw.json 已对齐代理（生效: ${eff}）`
          : "已保存出站登记并更新网关代理（当前无自动推导的 hy2 代理 URL）"
      );
      void qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const googleCheckMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ ok?: boolean; detail?: string; checkedAt?: string }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/google-reachability-check`,
        egressVmDraft.trim() ? { cloudVmId: egressVmDraft.trim() } : {}
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["openclaw-telegram-settings", instanceId] });
      void qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      if (data.ok) toast.success(data.detail || "Google 检测通过（generate_204）");
      else toast.error(data.detail || "Google 检测未通过");
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const telegramSaveMut = useMutation({
    mutationFn: () =>
      apiPutJson(`/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/telegram-settings`, {
        telegramEnabled: tgEnabledDraft,
        telegramBotToken: tgTokenDraft.trim(),
      }),
    onSuccess: () => {
      toast.success("已保存 Telegram 设置（Token 存 MySQL）");
      setTgTokenDraft("");
      void qc.invalidateQueries({ queryKey: ["openclaw-telegram-settings", instanceId] });
      void qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const gatewayImageMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ ok?: boolean; image?: string }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/gateway-image`,
        { image: imgDraft.trim() }
      ),
    onSuccess: async () => {
      toast.success("已更新 Deployment 镜像与平台登记；Pod 重启完成后即可在列表使用「对话」");
      await qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      await qc.invalidateQueries({ queryKey: ["app-openclaw-k8s-status"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const telegramVerifyMut = useMutation({
    mutationFn: () =>
      apiPostJson<{
        ok?: boolean;
        detail?: string;
        botUsername?: string;
        botId?: number;
        steps?: string[];
        proxyUsed?: string;
      }>(`/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/telegram-verify`, {}),
    onSuccess: (data) => {
      setTgVerifyLast({
        ok: !!data.ok,
        detail: data.detail,
        botUsername: data.botUsername,
        steps: data.steps,
        proxyUsed: data.proxyUsed,
      });
      if (data.ok) toast.success(data.detail ? `Telegram: ${data.detail}` : "getMe 验证通过");
      else toast.error(data.detail || "getMe 验证失败");
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const telegramApplyMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ ok?: boolean; message?: string; httpProxyMerged?: boolean }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/apply-telegram-to-openclaw-json`,
        {}
      ),
    onSuccess: (data) => {
      toast.success(
        data.httpProxyMerged
          ? `${data.message || "已合并 Telegram"}，并已写入 env.HTTP(S)_PROXY`
          : data.message || "已合并 Telegram 到 openclaw.json"
      );
      void qc.invalidateQueries({ queryKey: ["app-openclaw-file", instanceId, "openclaw.json"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const copyGatewayToken = async () => {
    try {
      const r = await fetch(
        `${import.meta.env.VITE_API_BASE ?? ""}/api/app-center/openclaw/instances/${encodeURIComponent(instanceId)}/gateway-token`,
        { credentials: "same-origin" }
      );
      const j = (await r.json()) as { gatewayToken?: string; error?: string };
      if (!r.ok) throw new Error(j.error || "失败");
      if (j.gatewayToken) {
        await copyToClipboardSafe(j.gatewayToken);
        toast.success("网关 Token 已复制");
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  if (!instanceId) {
    return <p className="text-sm text-slate-500">缺少实例 ID</p>;
  }

  if (bootstrapQ.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载…
      </p>
    );
  }
  if (bootstrapQ.data && !bootstrapQ.data.bootstrapComplete) {
    if (isAdmin) {
      return <Navigate to={OPENCLAW_BOOTSTRAP_PATH} replace />;
    }
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        OpenClaw 部署模式尚未完成首次引导。请联系管理员打开{" "}
        <Link to={OPENCLAW_BOOTSTRAP_PATH} className="font-mono font-semibold underline">
          {OPENCLAW_BOOTSTRAP_PATH}
        </Link>
        。
      </div>
    );
  }

  const detailModeSelectValue =
    detailDeployModeId === DEPLOY_MODE_NOMATCH
      ? DEPLOY_MODE_NOMATCH
      : detailDeployModeId || bootstrapModes[0]?.id || "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" asChild>
          <Link to="/cluster/apps/openclaw">
            <ArrowLeft className="h-4 w-4" />
            返回列表
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-violet-600" />
          <h1 className="text-lg font-semibold text-slate-900">OpenClaw 详情</h1>
        </div>
      </div>

      {gwHealthQ.data?.enabled && gwHealthBadThis ? (
        <Alert variant="destructive" className="border-red-300 bg-red-50/90 text-red-950">
          <AlertTitle>本实例服务级探活失败</AlertTitle>
          <AlertDescription className="space-y-1 text-sm text-red-950/90">
            <p className="font-sans text-xs font-semibold text-red-950">
              {formatOpenClawGatewayHealthInstanceLine({
                id: gwHealthBadThis.id,
                displayName: (row?.displayName ?? gwHealthBadThis.displayName) || undefined,
                namespace: (row?.namespace ?? gwHealthBadThis.namespace) || undefined,
                deploymentName: (row?.deploymentName ?? gwHealthBadThis.deploymentName) || undefined,
              })}
            </p>
            <p>
              后台对集群内 chat/completions 的极简补全失败（
              {gwChatIsTransportLayer
                ? "未返回 HTTP 状态码，属连接/传输层问题"
                : `HTTP ${gwChatHttpSt ?? "—"}`}
              ）。
              {gwChatIs404
                ? " 多为网关未暴露 OpenAI 兼容 chat 路由（非 Base URL 拼写问题）；对话与 AI 巡检会失败或经平台呈现为上游错误。"
                : gwChatIs5xx
                  ? " 路由已通；5xx 多为网关调用上游大模型失败（密钥、模型名、网络/代理）。仅改 openclaw.json 里的跨域或 chat 开关通常无法消除此类 500。"
                  : gwChatIsTimeout
                    ? ` 在约 ${gwHealthQ.data?.healthChatTimeoutSec ?? 90}s 内未收到完整响应（网关或上游过慢、无响应）。请核对 Deployment Secret 的 OPENAI_API_KEY、OPENAI_BASE_URL、HTTP 代理与集群出站；可在 kube-bt-sync 提高环境变量 KUBEBT_OPENCLAW_GATEWAY_HEALTH_CHAT_TIMEOUT_SEC。与 openclaw.json 是否开启 chat 无直接关系。`
                    : gwChatIsTransportLayer
                      ? " 与「未开 chat 路由→404」或「上游大模型→5xx」不同，请优先看下方一句概要并排错网关 Pod。"
                      : " 对话与 AI 巡检可能返回同类错误。"}
            </p>
            <p className="text-sm font-semibold leading-snug text-red-950">
              {formatOpenClawClusterChatProbeSnippet(gwHealthBadThis.clusterChatMessage ?? "", 400)}
            </p>
            {gwChatIs404 ? (
              <OpenClawChat404RemedyPanel
                variant="amber"
                className="mt-3"
                instanceId={instanceId}
                showInstanceLink={false}
              />
            ) : null}
            {gwChatIs5xx ? <OpenClawChat5xxRemedyPanel className="mt-3 border-red-200/60 bg-white/80" /> : null}
            {gwHealthQ.data.lastCheckAt ? (
              <p className="text-xs text-red-900/80">
                最近巡检：{formatDateTimeShanghai(gwHealthQ.data.lastCheckAt)}（UTC：{gwHealthQ.data.lastCheckAt}）
              </p>
            ) : null}
            {canWrite ? (
              <p className="mt-3 border-t border-red-200/70 pt-3 text-[11px] leading-relaxed text-red-900/85">
                {gwChatIs5xx
                  ? "HTTP 5xx：请在集群内核对 Deployment Secret（如 OPENAI_API_KEY）、模型 ID、HTTP 代理与网关 Pod 日志；跨域与 chat 路由开关通常与此无关。"
                  : "可在「配置文件」中编辑 openclaw.json（如 allowedOrigins、chatCompletions、Ollama contextWindow），保存后视需要滚动重启 Deployment。"}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {instQ.isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      ) : !row ? (
        <p className="text-sm text-amber-700">未找到该实例，可能已删除。</p>
      ) : (
        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50">
            <CardTitle className="text-base">{row.displayName || row.deploymentName}</CardTitle>
            <CardDescription className="space-y-1 font-mono text-xs">
              <span className="block">
                {row.namespace}/{row.deploymentName} · svc {row.serviceName} · {row.image}
              </span>
              {row.pvcClaimName ? (
                <span className="block text-slate-500">PVC · {row.pvcClaimName}（每套网关独立持久卷）</span>
              ) : (
                <span className="block text-amber-700/90">
                  旧登记未记录 PVC 名：若与同命名空间多套网关并存，可能曾共用 openclaw-home-pvc；建议删除后按当前版本重建以隔离数据。
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Tabs value={topTab} onValueChange={(v) => setTopTab(v as "files" | "manage")}>
              <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
                <TabsTrigger value="files" className="text-xs sm:text-sm">
                  配置文件
                </TabsTrigger>
                <TabsTrigger value="manage" className="text-xs sm:text-sm">
                  管理配置
                </TabsTrigger>
              </TabsList>

              <TabsContent value="files" className="mt-0 space-y-4 outline-none">
                <p className="text-sm text-slate-600">
                  以下文件读写网关 Pod 内挂载的持久目录 <code className="rounded bg-slate-100 px-1">/home/node/.openclaw</code>
                  ，数据在 PVC 上，Pod 重启不丢失。init 仅在首次创建时从 ConfigMap 拷贝默认文件，之后以卷内内容为准。若修改{" "}
                  <code className="rounded bg-slate-100 px-1">openclaw.json</code> 后网关未热加载，请在集群中对该 Deployment 做一次滚动重启。
                </p>
                <div className="rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-sm text-amber-950">
                  <span className="block leading-relaxed">
                    浏览器打开 Control UI 若提示 <span className="font-mono text-xs">origin not allowed</span>
                    ：在 <code className="rounded bg-white/80 px-1">gateway.controlUi.allowedOrigins</code> 中写入可信来源（例如{" "}
                    <code className="rounded bg-white/80 px-1">[&quot;*&quot;]</code>）。新 Pod 的第二个 init 会在该项为空时自动补{" "}
                    <code className="rounded bg-white/80 px-1">[&quot;*&quot;]</code>；修改后若仍报错请滚动重启 Deployment。
                  </span>
                </div>
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList className="mb-4 h-auto flex-wrap justify-start gap-1">
                    {FILE_TABS.map((t) => (
                      <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm">
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {FILE_TABS.map((t) => (
                    <TabsContent key={t.id} value={t.id} className="mt-0">
                      <OpenClawFilePanel
                        instanceId={instanceId}
                        filePath={t.path}
                        hint={t.hint}
                        tabId={t.id}
                        canWrite={canWrite}
                        fetchEnabled={topTab === "files" && tab === t.id}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              </TabsContent>

              <TabsContent value="manage" className="mt-0 space-y-4 outline-none">
                {rolloutSt?.platformInitRevisionAligned === false ? (
                  <Alert variant="default" className="border-amber-300 bg-amber-50/90 text-amber-950">
                    <AlertTitle>Deployment 模板与当前平台不一致</AlertTitle>
                    <AlertDescription className="space-y-1 text-sm text-amber-950/90">
                      <p>
                        {rolloutSt.platformInitRevisionHint ??
                          "请在下方应用网关镜像或保存 RBAC/管理配置，以同步第二个 init 与平台修订标记并滚动 Pod。"}
                      </p>
                      {rolloutSt.platformInitRevisionExpected != null ? (
                        <p className="font-mono text-[11px] text-amber-900/90">
                          期望修订 {rolloutSt.platformInitRevisionExpected}
                          {rolloutSt.platformInitRevisionObserved != null
                            ? ` · 集群记录 ${rolloutSt.platformInitRevisionObserved}`
                            : ""}
                        </p>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {rolloutSt?.openclawRbacClientGoChecked === true && rolloutSt.openclawRbacClientGoFullyAligned === false ? (
                  <Alert variant="default" className="border-amber-300 bg-amber-50/95 text-amber-950">
                    <AlertTitle>网关 client-go 权限与登记不一致或未通过校验</AlertTitle>
                    <AlertDescription className="space-y-2 text-sm text-amber-950/95">
                      <p className="leading-relaxed">{rolloutSt.openclawRbacClientGoHint ?? "请核对下方 ClusterRoleBinding 与 Deployment 模板 ServiceAccount，并由管理员点击「应用至集群」。"}</p>
                      {rolloutSt.openclawRbacSARError ? (
                        <p className="rounded border border-amber-200/80 bg-white/80 px-2 py-1.5 font-mono text-[10px] text-amber-900">
                          SubjectAccessReview 未执行：{rolloutSt.openclawRbacSARError}（请为 kube-bt-sync 所用账号授予创建{" "}
                          <span className="whitespace-nowrap">authorization.k8s.io/subjectaccessreviews</span> 的权限，否则无法做模拟鉴权）
                        </p>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <p className="text-sm text-slate-600">
                  集中管理<strong>网关 Token</strong>、<strong>平台代连次数</strong>、<strong>上游 API（集群 Secret）</strong>与<strong>对话模型名</strong>
                  。在下方修改后通过<strong>应用并重启网关</strong>，平台会合并 Secret、更新登记、滚动重启 Deployment，并自动做一次上游探活（结果在弹窗中展示）。
                </p>
                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                  <Label className="text-xs font-semibold text-slate-800">集群 API 权限档</Label>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    网关 Pod 内 OpenClaw 通过 <strong>client-go</strong> 使用 in-cluster 凭据（Pod 的 ServiceAccount），与 kubectl 无关；有效权限仅来自{" "}
                    <strong>ClusterRoleBinding → ClusterRole</strong>。未在 ClusterRole 中声明的动词/资源由 API Server 直接拒绝。下方状态由平台周期性对照集群对象与{" "}
                    <span className="font-mono text-[10px]">SubjectAccessReview</span>（以该 SA 尝试 list 本命名空间 pods）得出。
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[220px] flex-1 space-y-1">
                      <Label className="text-xs text-slate-600">权限预设</Label>
                      <Select
                        value={rbacDraft}
                        onValueChange={(v) => setRbacDraft(v as "readonly" | "edit" | "admin")}
                        disabled={!isAdmin || rbacPresetMut.isPending}
                      >
                        <SelectTrigger className="h-auto min-h-10 py-2 text-left">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-[min(360px,55vh)]">
                          {rbacPresetRows.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="items-start py-2">
                              <span className="block text-sm font-medium">{p.label}</span>
                              {p.description ? (
                                <span className="mt-0.5 block text-[11px] text-slate-600">{p.description}</span>
                              ) : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {isAdmin ? (
                      <Button
                        type="button"
                        className="gap-1.5 bg-slate-800 hover:bg-slate-900"
                        disabled={rbacPresetMut.isPending || rbacDraft === effectiveRowRbac()}
                        onClick={() => rbacPresetMut.mutate()}
                      >
                        {rbacPresetMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        应用至集群
                      </Button>
                    ) : (
                      <p className="text-xs text-slate-500">仅管理员可调整绑定。</p>
                    )}
                  </div>
                  <div className="space-y-1 font-mono text-[10px] text-slate-500">
                    <p>
                      ClusterRole（权限定义，非 Binding 名）：{" "}
                      {row.rbacClusterRoleName ||
                        rbacPresetRows.find((p) => p.id === effectiveRowRbac())?.clusterRoleName ||
                        "—"}
                    </p>
                    <p>
                      ClusterRoleBinding（kubectl describe 用这个名）：{" "}
                      {row.clusterRoleBindingName || "—"}
                    </p>
                    {rolloutSt?.openclawRbacClientGoChecked ? (
                      <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50/80 px-2 py-2 text-[10px] leading-relaxed text-slate-700">
                        <p className="font-semibold text-slate-800">集群侧对齐（client-go）</p>
                        <p>
                          登记 ClusterRole：<span className="font-mono">{rolloutSt.openclawRbacExpectedClusterRole ?? "—"}</span> · 绑定中引用：{" "}
                          <span className="font-mono">{rolloutSt.openclawRbacLiveClusterRoleName ?? "—"}</span>
                        </p>
                        <p>
                          Binding 与登记一致：
                          {rolloutSt.openclawRbacBindingMatchesRegistration ? (
                            <span className="text-emerald-700"> 是</span>
                          ) : (
                            <span className="text-red-700"> 否</span>
                          )}
                          {rolloutSt.openclawRbacClusterRoleBindingFound === false ? <span className="text-red-700">（未找到 CRB）</span> : null}
                        </p>
                        <p>
                          Deployment 模板 SA：<span className="font-mono">{rolloutSt.openclawRbacPodTemplateSA || "—"}</span> · 期望：{" "}
                          <span className="font-mono">{rolloutSt.openclawRbacExpectedServiceAccount ?? "—"}</span>
                          {rolloutSt.openclawRbacPodTemplateSAOk ? (
                            <span className="text-emerald-700"> · 一致</span>
                          ) : (
                            <span className="text-red-700"> · 不一致</span>
                          )}
                        </p>
                        <p>
                          SAR list pods（本命名空间）：
                          {rolloutSt.openclawRbacSARError ? (
                            <span className="text-amber-800"> 未执行（见上方黄条）</span>
                          ) : rolloutSt.openclawRbacSARListPodsAllowed ? (
                            <span className="text-emerald-700"> 允许</span>
                          ) : (
                            <span className="text-red-700">
                              拒绝{rolloutSt.openclawRbacSARReason ? `（${rolloutSt.openclawRbacSARReason}）` : ""}
                            </span>
                          )}
                        </p>
                        <p className="text-slate-600">
                          总评：
                          {rolloutSt.openclawRbacClientGoFullyAligned ? (
                            <span className="font-medium text-emerald-800">已对齐</span>
                          ) : (
                            <span className="font-medium text-red-800">未对齐或校验不完整</span>
                          )}
                        </p>
                      </div>
                    ) : k8sRolloutQ.isFetching ? (
                      <p className="text-[10px] text-slate-500">正在拉取 RBAC 对齐状态…</p>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-3 rounded-xl border border-teal-200/80 bg-teal-50/30 p-4">
                  <Label className="text-xs font-semibold text-slate-800">工具链与提示词（写入 PVC 并重启）</Label>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    与创建向导一致：<strong>tools.profile</strong> 写入 <code className="rounded bg-white/80 px-0.5">openclaw.json</code>；勾选的提示词包合并进{" "}
                    <code className="rounded bg-white/80 px-0.5">workspace/SOUL.md</code> 与 <code className="rounded bg-white/80 px-0.5">AGENTS.md</code>（覆盖平台预置正文+附加段）。
                  </p>
                  <Select
                    value={toolsProfileManage}
                    onValueChange={(v) => setToolsProfileManage(v as "minimal" | "coding" | "full")}
                    disabled={!canWrite || applyToolchainMut.isPending}
                  >
                    <SelectTrigger className="h-auto min-h-10 py-2 text-left text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-[min(360px,55vh)]">
                      {(toolchainOptsQ.data?.toolchains ?? [
                        { id: "minimal", label: "轻量（minimal）", description: "" },
                        { id: "coding", label: "开发（coding）", description: "" },
                        { id: "full", label: "完整（full）", description: "" },
                      ]).map((t) => (
                        <SelectItem key={t.id} value={t.id} className="items-start py-2">
                          <span className="block text-sm font-medium">{t.label}</span>
                          {t.description ? (
                            <span className="mt-0.5 block text-[11px] text-slate-600">{t.description}</span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="space-y-2">
                    {promptPackCatalog.map((p) => (
                      <div key={p.id} className="flex items-start gap-2 rounded-md border border-teal-100/90 bg-white/70 px-2 py-2">
                        <Checkbox
                          id={`oc-detail-pack-${p.id}`}
                          checked={!!promptPackManage[p.id]}
                          onCheckedChange={(c) => setPromptPackManage((prev) => ({ ...prev, [p.id]: c === true }))}
                          disabled={!canWrite || applyToolchainMut.isPending}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <Label htmlFor={`oc-detail-pack-${p.id}`} className="cursor-pointer text-sm font-medium text-slate-800">
                            {p.label}
                          </Label>
                          {p.description ? (
                            <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{p.description}</p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  {canWrite ? (
                    <Button
                      type="button"
                      className="gap-1.5 bg-teal-700 hover:bg-teal-800"
                      disabled={applyToolchainMut.isPending || !toolchainApplyDirty}
                      onClick={() => applyToolchainMut.mutate()}
                    >
                      {applyToolchainMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      应用工具链与提示词
                    </Button>
                  ) : (
                    <p className="text-xs text-slate-500">只读账号不可修改。</p>
                  )}
                  {row.modelPreset === "ollama" && (toolchainOptsQ.data?.ollamaModelRecommendations?.length ?? 0) > 0 ? (
                    <div className="rounded-md border border-amber-200/80 bg-amber-50/60 px-2 py-2 text-[11px] text-amber-950">
                      <p className="font-medium">推荐开源 Ollama 模型</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {toolchainOptsQ.data!.ollamaModelRecommendations!.map((m) => (
                          <li key={m.id}>
                            <code className="rounded bg-white/80 px-0.5 font-mono text-[10px]">{m.id}</code>
                            {m.note ? ` — ${m.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-4 rounded-xl border border-violet-200/80 bg-violet-50/30 p-4">
                  {bootstrapModes.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-violet-200 bg-white/90 p-3">
                      <Label className="text-xs font-semibold text-slate-800">网关镜像（部署模式）</Label>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        镜像地址、Init 等仅在{" "}
                        <Link to={OPENCLAW_BOOTSTRAP_PATH} className="font-medium text-violet-800 underline">
                          OpenClaw 配置页
                        </Link>{" "}
                        维护。此处选择模式后得到待应用镜像，再点击下方按钮更新集群 Deployment 中{" "}
                        <code className="rounded bg-white/80 px-0.5">gateway</code> /{" "}
                        <code className="rounded bg-white/80 px-0.5">ensure-openclaw-platform-defaults</code>{" "}
                        （旧部署可能仍为 <code className="rounded bg-white/80 px-0.5">ensure-control-ui-origin</code>）并同步平台登记。
                      </p>
                      {detailDeployModeId === DEPLOY_MODE_NOMATCH ? (
                        <p className="rounded-md border border-amber-200 bg-amber-50/90 px-2 py-1.5 text-[11px] text-amber-950">
                          当前登记镜像不在模板列表中。请在配置页增加对应「部署模式」后，再在下拉中选择并应用。
                        </p>
                      ) : null}
                      <Select
                        value={detailModeSelectValue}
                        onValueChange={(id) => {
                          if (id === DEPLOY_MODE_NOMATCH) return;
                          setDetailDeployModeId(id);
                          const m = bootstrapModes.find((x) => x.id === id);
                          if (m) setImgDraft(m.image.trim());
                        }}
                      >
                        <SelectTrigger className="h-auto min-h-10 w-full py-2 text-left font-mono text-sm">
                          <SelectValue placeholder="选择模式" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-[min(360px,55vh)]">
                          {detailDeployModeId === DEPLOY_MODE_NOMATCH ? (
                            <SelectItem value={DEPLOY_MODE_NOMATCH} disabled className="opacity-100">
                              <span className="text-amber-900">（当前镜像未匹配模板）</span>
                            </SelectItem>
                          ) : null}
                          {bootstrapModes.map((m) => (
                            <SelectItem key={m.id} value={m.id} className="items-start py-2">
                              <span className="block text-sm font-medium text-slate-900">{m.label}</span>
                              {m.description ? (
                                <span className="mt-0.5 block text-[11px] text-slate-600">{m.description}</span>
                              ) : null}
                              <code className="mt-1 block max-w-[min(92vw,480px)] whitespace-normal break-all font-mono text-[10px] text-slate-500">
                                {m.image}
                              </code>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-2">
                        <p className="text-[11px] font-medium text-slate-700">待应用的网关镜像</p>
                        <code className="mt-1 block break-all font-mono text-xs text-slate-900">
                          {imgDraft.trim() || "—"}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-800">未加载到部署模式模板。</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {canWrite ? (
                      <Button
                        type="button"
                        className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                        disabled={
                          gatewayImageMut.isPending ||
                          !imgDraft.trim() ||
                          imgDraft.trim() === (row.image ?? "").trim()
                        }
                        onClick={() => gatewayImageMut.mutate()}
                      >
                        {gatewayImageMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        应用并触发重启
                      </Button>
                    ) : (
                      <p className="text-xs text-slate-500">只读账号不可切换镜像。</p>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-700">
                    <p>
                      <span className="font-medium">对话可用性：</span>{" "}
                      {listChatGate.ok ? (
                        <span className="text-emerald-800">当前可发起对话</span>
                      ) : (
                        <span className="text-amber-800">{listChatGate.reason}</span>
                      )}
                    </p>
                    {rolloutSt?.runningGatewayImage ? (
                      <p className="mt-1 font-mono text-[10px] text-slate-600">
                        Pod 镜像：{rolloutSt.runningGatewayImage}
                        {rolloutSt.templateGatewayImage
                          ? ` · Deployment 模板：${rolloutSt.templateGatewayImage}`
                          : ""}
                      </p>
                    ) : k8sRolloutQ.isFetching ? (
                      <p className="mt-1 text-[11px] text-slate-500">正在拉取集群状态…</p>
                    ) : null}
                  </div>
                </div>
                {row.upstreamCheckStatus === "fail" && (row.upstreamCheckMessage ?? "").trim() ? (
                  <div className="rounded-lg border border-red-200 bg-red-50/90 px-3 py-2.5 text-sm text-red-950">
                    <p className="font-medium">模型异常（最近一次上游检测失败）</p>
                    <p className="mt-1 text-xs leading-relaxed">{row.upstreamCheckMessage}</p>
                    {row.upstreamCheckAt ? (
                      <p className="mt-1 text-[11px] opacity-80">
                        检测时间 {formatDateTimeShanghai(row.upstreamCheckAt)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">当前生效模型名</span>
                    <p className="font-mono text-sm text-slate-900">
                      {effectiveOpenClawChatModel(row) || "（未指定）"}
                    </p>
                    <p className="text-[11px] text-slate-500">创建预设 {row.modelPreset ?? "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-slate-600">平台经本实例代连次数</span>
                    <p className="text-2xl font-semibold tabular-nums text-slate-900">{row.chatProxyCount ?? 0}</p>
                    <p className="text-sm tabular-nums text-slate-700">
                      其中只读账号（viewer）{" "}
                      <span className="font-semibold text-violet-800">{row.chatProxyCountViewer ?? 0}</span> 次
                    </p>
                    <p className="text-[11px] text-slate-500">
                      总计含所有已登录角色经本平台 OpenClaw 代连 /chat 的成功次数；viewer 单独累计，便于区分只读用户对话量（未登录或直连网关不计入）。
                    </p>
                  </div>
                </div>
                <div className="space-y-4 rounded-xl border border-violet-200/80 bg-violet-50/20 p-4">
                  <span className="text-sm font-medium text-slate-800">上游 API 与对话模型（应用后重启网关）</span>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    <code className="rounded bg-white/80 px-0.5">OPENAI_BASE_URL</code> /{" "}
                    <code className="rounded bg-white/80 px-0.5">OPENAI_API_KEY</code> 写入本实例命名空间内网关 Deployment 引用的 Secret；Ollama 预设时密钥写入{" "}
                    <code className="rounded bg-white/80 px-0.5">OLLAMA_API_KEY</code>。地址与密钥留空表示<strong>不修改</strong>该项。模型名会写入平台登记，供列表「对话」与巡检代连使用。
                  </p>
                  <div className="grid gap-3 sm:grid-cols-1">
                    <div className="space-y-1">
                      <Label htmlFor="oc-upstream-base" className="text-xs text-slate-600">
                        上游 API 根地址（可选）
                      </Label>
                      <Input
                        id="oc-upstream-base"
                        value={upstreamBaseDraft}
                        onChange={(e) => setUpstreamBaseDraft(e.target.value)}
                        className="font-mono text-sm"
                        placeholder="留空则不修改 Secret 中的 OPENAI_BASE_URL"
                        disabled={!canWrite || applyUpstreamRuntimeMut.isPending}
                        spellCheck={false}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="oc-upstream-key" className="text-xs text-slate-600">
                        API Key（可选）
                      </Label>
                      <Input
                        id="oc-upstream-key"
                        type="password"
                        autoComplete="new-password"
                        value={upstreamKeyDraft}
                        onChange={(e) => setUpstreamKeyDraft(e.target.value)}
                        className="font-mono text-sm"
                        placeholder="留空则不修改 Secret 中的密钥"
                        disabled={!canWrite || applyUpstreamRuntimeMut.isPending}
                        spellCheck={false}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="oc-model-draft" className="text-xs text-slate-600">
                        对话模型 ID（与上游 OpenAI 兼容接口一致）
                      </Label>
                      <Input
                        id="oc-model-draft"
                        value={modelDraft}
                        onChange={(e) => setModelDraft(e.target.value)}
                        className="font-mono text-sm"
                        disabled={!canWrite || applyUpstreamRuntimeMut.isPending}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  {canWrite ? (
                    <Button
                      type="button"
                      className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                      disabled={applyUpstreamRuntimeMut.isPending || !applyRuntimeHasWork}
                      onClick={() => {
                        if (!applyRuntimeHasWork) {
                          toast.info("请先填写新的 API 地址或密钥，或修改对话模型名");
                          return;
                        }
                        setApplyRuntimeResult(null);
                        setApplyRuntimeError(null);
                        setApplyRuntimeOpen(true);
                      }}
                    >
                      应用并重启网关…
                    </Button>
                  ) : (
                    <p className="text-xs text-slate-500">只读账号不可修改。</p>
                  )}
                </div>

                <Dialog
                  open={applyRuntimeOpen}
                  onOpenChange={(open) => {
                    if (open) {
                      setApplyRuntimeOpen(true);
                      return;
                    }
                    if (applyUpstreamRuntimeMut.isPending) return;
                    setApplyRuntimeOpen(false);
                    setApplyRuntimeResult(null);
                    setApplyRuntimeError(null);
                  }}
                >
                  <DialogContent
                    className="max-h-[min(90vh,520px)] overflow-y-auto sm:max-w-lg"
                    showCloseButton={!applyUpstreamRuntimeMut.isPending}
                  >
                    <DialogHeader>
                      <DialogTitle>
                        {applyUpstreamRuntimeMut.isPending
                          ? "正在应用"
                          : applyRuntimeResult || applyRuntimeError
                            ? "应用结果"
                            : "确认切换上游 API / 模型"}
                      </DialogTitle>
                      {applyUpstreamRuntimeMut.isPending ? (
                        <DialogDescription>
                          正在更新 Secret 与平台登记、滚动重启网关并探活，通常需 1～3 分钟，请勿关闭此窗口。
                        </DialogDescription>
                      ) : applyRuntimeResult || applyRuntimeError ? (
                        <DialogDescription className="sr-only">应用已完成，请查看下方步骤与探活结果。</DialogDescription>
                      ) : (
                        <DialogDescription>
                          确认后将写入已填写的配置（留空的 API 项不会改动），触发网关 Deployment
                          滚动重启，并在就绪后检测上游模型是否可用。
                        </DialogDescription>
                      )}
                    </DialogHeader>
                    {applyUpstreamRuntimeMut.isPending ? (
                      <div className="flex flex-col items-center gap-3 py-8">
                        <Loader2 className="h-10 w-10 animate-spin text-violet-600" />
                        <p className="text-center text-sm text-slate-600">
                          更新配置 · 滚动重启 · 等待就绪 · 上游探活
                        </p>
                      </div>
                    ) : applyRuntimeError ? (
                      <p className="text-sm text-red-700">{applyRuntimeError}</p>
                    ) : applyRuntimeResult ? (
                      <div className="space-y-3">
                        <ul className="space-y-2 text-sm text-slate-800">
                          {(applyRuntimeResult.steps ?? []).map((s, i) => (
                            <li key={i} className="flex gap-2">
                              {s.ok ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                              ) : (
                                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
                              )}
                              <span>
                                <span className="font-medium">{s.label}</span>
                                {s.detail ? (
                                  <span className="mt-0.5 block text-xs text-slate-600">{s.detail}</span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div
                          className={cn(
                            "rounded-lg border px-3 py-2.5 text-sm",
                            applyRuntimeResult.upstreamOk
                              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                              : "border-amber-200 bg-amber-50 text-amber-950"
                          )}
                        >
                          <p className="font-medium">
                            {applyRuntimeResult.upstreamOk ? "模型 / 上游探活正常" : "模型或上游探活未通过"}
                          </p>
                          {applyRuntimeResult.modelTried ? (
                            <p className="mt-1 font-mono text-xs">探活模型：{applyRuntimeResult.modelTried}</p>
                          ) : null}
                          {applyRuntimeResult.upstreamMessage ? (
                            <p className="mt-1 text-xs leading-relaxed">{applyRuntimeResult.upstreamMessage}</p>
                          ) : null}
                          {applyRuntimeResult.rolloutWaitOk === false && applyRuntimeResult.rolloutWaitMessage ? (
                            <p className="mt-2 text-xs text-amber-900">
                              就绪等待：{applyRuntimeResult.rolloutWaitMessage}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600">点击下方按钮开始；请勿重复提交。</p>
                    )}
                    <DialogFooter>
                      {!applyUpstreamRuntimeMut.isPending && (applyRuntimeResult || applyRuntimeError) ? (
                        <Button
                          type="button"
                          onClick={() => {
                            setApplyRuntimeOpen(false);
                            setApplyRuntimeResult(null);
                            setApplyRuntimeError(null);
                          }}
                        >
                          关闭
                        </Button>
                      ) : null}
                      {!applyUpstreamRuntimeMut.isPending && !applyRuntimeResult && !applyRuntimeError ? (
                        <>
                          <Button type="button" variant="outline" onClick={() => setApplyRuntimeOpen(false)}>
                            取消
                          </Button>
                          <Button
                            type="button"
                            className="bg-violet-600 hover:bg-violet-700"
                            onClick={() => applyUpstreamRuntimeMut.mutate()}
                          >
                            确认应用并重启
                          </Button>
                        </>
                      ) : null}
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <span className="text-sm font-medium text-slate-800">上游大模型检测</span>
                  <p className="text-xs text-slate-600">
                    读取本实例命名空间 Secret 中的 <code className="rounded bg-slate-100 px-1">OPENAI_BASE_URL</code> /{" "}
                    <code className="rounded bg-slate-100 px-1">OPENAI_API_KEY</code>，向 chat/completions 发极简请求（智谱 / MiniMax / Kimi / Ollama 等路径已适配）。与<strong>应用中心对话</strong>、<strong>AI 巡检</strong>（选用本实例时）优先走<strong>同一上游直连</strong>；仅当 Secret 缺项或直连失败时才回退经 OpenClaw 网关 Token。
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={upstreamMut.isPending}
                      onClick={() => upstreamMut.mutate()}
                    >
                      {upstreamMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      立即检测上游
                    </Button>
                    {row.upstreamCheckAt ? (
                      <span className="text-xs text-slate-500">
                        上次 {formatDateTimeShanghai(row.upstreamCheckAt)}
                        {row.upstreamCheckStatus === "ok" ? " · 正常" : row.upstreamCheckStatus === "fail" ? " · 失败" : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">尚未检测</span>
                    )}
                  </div>
                  {row.upstreamCheckStatus === "ok" && (row.upstreamCheckMessage ?? "").trim() ? (
                    <p className="text-xs text-emerald-800">{row.upstreamCheckMessage}</p>
                  ) : null}
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <span className="text-sm font-medium text-slate-800">网关 Token</span>
                  <p className="mt-1 text-xs text-slate-600">
                    供 Control Web UI、外部 HTTP 客户端作为 Bearer；与上游大模型厂商 API Key 不同。
                  </p>
                  {isAdmin ? (
                    <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => void copyGatewayToken()}>
                      <KeyRound className="h-4 w-4" />
                      <Copy className="h-4 w-4" />
                      复制完整 Token
                    </Button>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">仅管理员可复制网关 Token。</p>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-fuchsia-200/80 bg-fuchsia-50/30 p-4">
                  <span className="text-sm font-medium text-slate-800">出站云主机与 HTTP(S) 代理</span>
                  <p className="text-xs text-slate-600">
                    登记带 <strong>Hysteria2 客户端</strong> 的云主机后，保存时会自动推导 <code className="rounded bg-white/80 px-0.5">http://&lt;云主机&gt;-hy2.&lt;ns&gt;.svc.cluster.local:&lt;端口&gt;</code> 作为生效代理（若未手填代理
                    URL）。会写入网关 Deployment 的 <code className="rounded bg-white/80 px-0.5">HTTP_PROXY</code>，并尽量合并到 PVC 上 <code className="rounded bg-white/80 px-0.5">openclaw.json</code> 的{" "}
                    <code className="rounded bg-white/80 px-0.5">env</code>，便于 Telegram 等出站。
                  </p>
                  {canWrite ? (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">出站云主机</Label>
                        <Select
                          value={egressVmDraft.trim() ? egressVmDraft.trim() : "__none__"}
                          onValueChange={(v) => setEgressVmDraft(v === "__none__" ? "" : v)}
                          disabled={cloudVmQ.isLoading}
                        >
                          <SelectTrigger className="font-mono text-sm">
                            <SelectValue placeholder="不登记" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">不登记</SelectItem>
                            {hysteriaCloudVms.map((vm) => (
                              <SelectItem key={vm.id} value={String(vm.id)} className="font-mono text-xs">
                                #{vm.id} {vm.name} · {vm.namespace}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">HTTP(S) 代理 URL</Label>
                        <Input
                          value={httpProxyDraft}
                          onChange={(e) => setHttpProxyDraft(e.target.value)}
                          className="font-mono text-sm"
                          placeholder="http://…"
                          spellCheck={false}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-fuchsia-600 hover:bg-fuchsia-700"
                        disabled={egressMut.isPending}
                        onClick={() => egressMut.mutate()}
                      >
                        {egressMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        保存出站与代理
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">只读。</p>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <span className="text-sm font-medium text-slate-800">Google 可达性（Telegram 前置条件）</span>
                  <p className="text-xs text-slate-600">
                    在上方登记的云主机 Pod 内请求 Google <code className="rounded bg-slate-100 px-0.5">generate_204</code>。若该云主机<strong>勾选了 Hysteria2 客户端</strong>，检测会经{" "}
                    <code className="rounded bg-slate-100 px-0.5">curl -x http://127.0.0.1:端口</code> 走本机 hysteria 的 HTTP inbound（与向导里本地端口一致），不会直连 Google。仅当检测通过后，平台才允许开启「对接
                    Telegram」；结果写入 MySQL。
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canWrite || googleCheckMut.isPending || !egressVmDraft.trim()}
                      onClick={() => googleCheckMut.mutate()}
                    >
                      {googleCheckMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      运行检测
                    </Button>
                    {!egressVmDraft.trim() ? (
                      <span className="text-xs text-amber-800">请先选择出站云主机并保存。</span>
                    ) : telegramQ.data?.googleCheckedAt ? (
                      <span className="text-xs text-slate-500">
                        上次 {formatDateTimeShanghai(telegramQ.data.googleCheckedAt)}
                        {telegramQ.data.googleOk ? " · 通过" : " · 未通过"}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">尚未检测</span>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <span className="text-sm font-medium text-slate-800">对接 Telegram</span>
                  {telegramQ.data?.mysqlRequired ? (
                    <p className="text-xs text-amber-800">需要连接 MySQL 才可使用本平台托管的 Telegram Token 与检测记录。</p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-600">
                        Bot Token 加密存 MySQL；开启前须 Google 检测通过。保存后可「验证 getMe」确认与 Telegram API 连通（经生效代理），再「写入 openclaw.json」合并频道配置（并写入{" "}
                        <code className="rounded bg-slate-100 px-0.5">env.HTTP(S)_PROXY</code>）。
                      </p>
                      <div className="flex items-center gap-3">
                        <Switch
                          id="oc-tg-en"
                          checked={tgEnabledDraft}
                          disabled={
                            !canWrite ||
                            telegramSaveMut.isPending ||
                            !!telegramQ.data?.mysqlRequired ||
                            (!!telegramQ.data && !telegramQ.data.googleOk)
                          }
                          onCheckedChange={setTgEnabledDraft}
                        />
                        <Label htmlFor="oc-tg-en" className="text-sm">
                          开启 Telegram 对接
                          {!telegramQ.data?.googleOk ? (
                            <span className="ml-1 text-xs font-normal text-amber-800">（须先通过 Google 检测）</span>
                          ) : null}
                        </Label>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Bot Token{telegramQ.data?.hasTelegramToken ? "（留空表示不改变已存 Token）" : ""}</Label>
                        <Input
                          type="password"
                          value={tgTokenDraft}
                          onChange={(e) => setTgTokenDraft(e.target.value)}
                          autoComplete="off"
                          className="font-mono text-sm"
                          disabled={!canWrite}
                          placeholder="从 @BotFather 获取"
                        />
                      </div>
                      {canWrite ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="bg-violet-600 hover:bg-violet-700"
                            disabled={
                              telegramSaveMut.isPending ||
                              (tgEnabledDraft && !tgTokenDraft.trim() && !telegramQ.data?.hasTelegramToken)
                            }
                            onClick={() => telegramSaveMut.mutate()}
                          >
                            {telegramSaveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            保存 Telegram 设置
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={telegramVerifyMut.isPending || !telegramQ.data?.hasTelegramToken}
                            onClick={() => telegramVerifyMut.mutate()}
                          >
                            {telegramVerifyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            验证 getMe
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={telegramApplyMut.isPending || !telegramQ.data?.hasTelegramToken}
                            onClick={() => telegramApplyMut.mutate()}
                          >
                            {telegramApplyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            写入 openclaw.json
                          </Button>
                        </div>
                      ) : null}
                      {tgVerifyLast ? (
                        <div className="rounded-md border border-slate-200 bg-slate-50/90 p-2 text-[11px] leading-relaxed text-slate-700">
                          <p className={tgVerifyLast.ok ? "font-medium text-emerald-800" : "font-medium text-red-800"}>
                            {tgVerifyLast.ok ? "上次验证：通过" : "上次验证：失败"}
                            {tgVerifyLast.detail ? ` · ${tgVerifyLast.detail}` : ""}
                          </p>
                          {tgVerifyLast.botUsername ? (
                            <p className="mt-0.5 text-slate-600">Bot 用户名: @{tgVerifyLast.botUsername}</p>
                          ) : null}
                          {tgVerifyLast.proxyUsed ? (
                            <p className="mt-0.5 break-all font-mono text-[10px] text-slate-600">代理: {tgVerifyLast.proxyUsed}</p>
                          ) : null}
                          {tgVerifyLast.steps?.length ? (
                            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-slate-600">
                              {tgVerifyLast.steps.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ol>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AppCenterOpenClawDetail;

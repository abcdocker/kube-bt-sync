import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiGetJson, apiPostJson, ApiHttpError } from "@/lib/api";
import { formatDateTimeShanghai } from "@/lib/datetime-cn";
import { copyToClipboardSafe } from "@/lib/clipboard";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import {
  cloudVmAppCenterCanWrite,
  cloudVmHysteriaRevealAllowed,
} from "@/lib/platform-permissions";
import { cn } from "@/lib/utils";
import { openClawChatAllowed } from "@/lib/openclaw-gateway-image";
import { OpenClawChatMarkdown } from "@/components/OpenClawChatMarkdown";
import { OpenClawChat404RemedyPanel } from "@/components/OpenClawChat404Remedy";
import { OpenClawChat5xxRemedyPanel } from "@/components/OpenClawChat5xxRemedy";
import {
  formatOpenClawClusterChatProbeSnippet,
  formatOpenClawGatewayHealthInstanceLine,
  isOpenClawGatewayChat404,
  isOpenClawGatewayChat5xx,
  isOpenClawGatewayChatNoHttpStatus,
  OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC_DEFAULT,
} from "@/lib/openclaw-gateway-health";

const OPENCLAW_BOOTSTRAP_PATH = "/cluster/apps/openclaw/bootstrap";

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

const OPENCLAW_CHAT_STORAGE_PREFIX = "kubebt-openclaw-chat:v1";
const OPENCLAW_CHAT_MAX_MSGS = 80;

function loadOpenClawChatMessages(instanceId: string): { role: string; content: string }[] {
  if (!instanceId || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${OPENCLAW_CHAT_STORAGE_PREFIX}:${instanceId}`);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p
      .filter(
        (x) =>
          x &&
          typeof x === "object" &&
          typeof (x as { role?: unknown }).role === "string" &&
          typeof (x as { content?: unknown }).content === "string"
      )
      .map((x) => ({
        role: String((x as { role: string }).role),
        content: String((x as { content: string }).content),
      }))
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-OPENCLAW_CHAT_MAX_MSGS);
  } catch {
    return [];
  }
}

function saveOpenClawChatMessages(instanceId: string, msgs: { role: string; content: string }[]) {
  if (!instanceId || typeof localStorage === "undefined") return;
  try {
    const slice = msgs.slice(-OPENCLAW_CHAT_MAX_MSGS);
    localStorage.setItem(`${OPENCLAW_CHAT_STORAGE_PREFIX}:${instanceId}`, JSON.stringify(slice));
  } catch {
    /* 存储配额等 */
  }
}

function clearOpenClawChatStorage(instanceId: string) {
  if (!instanceId || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(`${OPENCLAW_CHAT_STORAGE_PREFIX}:${instanceId}`);
  } catch {
    /* ignore */
  }
}

type InstanceRow = {
  id: string;
  displayName: string;
  namespace: string;
  deploymentName: string;
  serviceName: string;
  image: string;
  gatewayPort: number;
  nodePort: number;
  modelPreset: string;
  chatModel?: string;
  chatProxyCount?: number;
  /** 会话角色为 viewer 时经平台代连 /chat 的累计次数 */
  chatProxyCountViewer?: number;
  upstreamCheckStatus?: string;
  upstreamCheckMessage?: string;
  upstreamCheckAt?: string;
  clusterV1BaseUrl: string;
  externalV1Url: string;
  nodeAccessIp: string;
  exposeMode?: string;
  ingressHost?: string;
  publicV1Url?: string;
  createdAt: string;
  gatewayTokenSet: boolean;
  gatewayTokenPreview?: string;
  egressCloudVmId?: string;
  httpProxyUrl?: string;
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
  summary?: {
    installHysteria2?: boolean;
    hysteria2ClusterEndpoint?: string;
    hysteria2Port?: number;
  };
};

type OpenClawK8sStatus = {
  k8sAvailable?: boolean;
  phase?: string;
  message?: string;
  deploymentFound?: boolean;
  readyReplicas?: number;
  desiredReplicas?: number;
  podPhase?: string;
  podName?: string;
  podReady?: boolean;
  templateGatewayImage?: string;
  runningGatewayImage?: string;
  imageRolloutSynced?: boolean;
  imageRolloutMessage?: string;
  /** 与平台当前二进制期望的 OpenClaw 第二个 init 模板修订是否一致 */
  platformInitRevisionAligned?: boolean;
  platformInitRevisionExpected?: number;
  platformInitRevisionObserved?: number;
  platformInitRevisionHint?: string;
};

type OpenClawK8sStatusBatch = { statuses?: Record<string, OpenClawK8sStatus> };

const PRESETS = [
  { id: "minimax-m2.7", label: "MiniMax M2.7（推荐 · 默认 Base URL）" },
  { id: "minimax-m2.5", label: "MiniMax M2.5" },
  { id: "openai", label: "OpenAI 官方（gpt-4o-mini · 默认 Base URL）" },
  { id: "glm-4.7", label: "智谱 GLM-4.7（OpenAI 兼容）" },
  { id: "ollama", label: "Ollama（本地 / 集群内 OpenAI 兼容端点）" },
  { id: "qwen-compatible", label: "通义千问兼容模式（DashScope OpenAI 兼容）" },
  { id: "kimi", label: "Kimi（Moonshot OpenAI 兼容）" },
  { id: "custom", label: "自定义（自填 Base URL）" },
] as const;

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

function effectiveOpenClawChatModel(row: Pick<InstanceRow, "chatModel" | "modelPreset">): string {
  const m = (row.chatModel ?? "").trim();
  if (m) return m;
  return defaultChatModelForPreset(row.modelPreset);
}

const STEPS = [
  { n: 1, title: "K8s 资源", desc: "命名空间、Deployment、Service、镜像" },
  { n: 2, title: "对外暴露", desc: "NodePort（随机）或 宝塔 Ingress" },
  { n: 3, title: "模型与密钥", desc: "预设、上游模型名、API Key、Base URL" },
] as const;

/** Select 占位；与集群真实 ns 名不冲突即可 */
const NS_SELECT_EMPTY = "__openclaw_ns_none__";
const NS_SELECT_CUSTOM = "__openclaw_ns_custom__";

const OPENCLAW_DEFAULT_DEPLOYMENT = "openclaw-gateway";

/** 仅四种文案：运行中、拉取镜像、启动成功、错误（不展示 Pod 名与调度说明） */
function openClawRunStatusBadge(st: OpenClawK8sStatus | undefined) {
  if (!st) {
    return (
      <Badge variant="outline" className="font-normal">
        —
      </Badge>
    );
  }
  const phase = st.phase;
  const podPhase = (st.podPhase ?? "").trim();

  if (phase === "ready") {
    return (
      <Badge className="border-0 bg-emerald-600 font-normal text-white hover:bg-emerald-600">
        运行中
      </Badge>
    );
  }
  if (phase === "error" || phase === "no_k8s" || phase === "missing") {
    return (
      <Badge variant="destructive" className="font-normal">
        错误
      </Badge>
    );
  }
  if (phase === "progress") {
    if (podPhase === "Failed") {
      return (
        <Badge variant="destructive" className="font-normal">
          错误
        </Badge>
      );
    }
    if (podPhase === "Running" && st.podReady === true) {
      return (
        <Badge className="border-0 bg-emerald-600 font-normal text-white hover:bg-emerald-600">
          运行中
        </Badge>
      );
    }
    if (podPhase === "Running" && st.podReady === false) {
      return (
        <Badge variant="secondary" className="font-normal text-slate-800">
          启动成功
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="font-normal text-amber-950">
        拉取镜像
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal">
      —
    </Badge>
  );
}

const AppCenterOpenClaw: React.FC = () => {
  const qc = useQueryClient();
  const { status } = useAuth();
  const perm = status?.permissions;
  const canWrite = cloudVmAppCenterCanWrite(status?.role, perm);
  const canRevealHyVm = cloudVmHysteriaRevealAllowed(status?.role, perm);
  const isAdmin = status?.role === "admin";

  const bootstrapQ = useQuery({
    queryKey: ["app-openclaw-bootstrap"],
    queryFn: ({ signal }) => apiGetJson<OpenClawBootstrapResp>("/api/app-center/openclaw/bootstrap", { signal }),
    staleTime: 60_000,
  });
  const bootstrapModes = bootstrapQ.data?.modes ?? [];

  const rbacPresetsQ = useQuery({
    queryKey: ["app-openclaw-rbac-presets"],
    queryFn: ({ signal }) =>
      apiGetJson<{
        presets: { id: string; label: string; description: string; clusterRoleName: string }[];
      }>("/api/app-center/openclaw/rbac-presets", { signal }),
    staleTime: 300_000,
  });

  const [mainTab, setMainTab] = useState<"list" | "create">("list");
  const [step, setStep] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<InstanceRow | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRow, setChatRow] = useState<InstanceRow | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ role: string; content: string }[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatViewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!chatOpen) return;
    const el = chatViewportRef.current;
    if (!el) return;
    const snap = () => {
      el.scrollTop = el.scrollHeight;
    };
    snap();
    requestAnimationFrame(snap);
  }, [chatOpen, chatMsgs, chatSending]);

  const nsQ = useQuery({
    queryKey: ["namespaces", "openclaw"],
    queryFn: ({ signal }) => apiGetJson<string[]>("/api/namespaces", { signal }),
  });
  /** 去空、trim、去重；避免空串等异常项导致 Radix Select 行为异常 */
  const nsOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of nsQ.data ?? []) {
      const s = String(raw ?? "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [nsQ.data]);

  const q = useQuery({
    queryKey: ["app-openclaw-instances"],
    queryFn: ({ signal }) => apiGetJson<{ instances: InstanceRow[] }>("/api/app-center/openclaw/instances", { signal }),
  });

  const rows = q.data?.instances ?? [];

  const k8sStatusQ = useQuery({
    queryKey: ["app-openclaw-k8s-status"],
    queryFn: ({ signal }) => apiGetJson<OpenClawK8sStatusBatch>("/api/app-center/openclaw/instances/k8s-status", { signal }),
    enabled: mainTab === "list",
    refetchInterval:
      mainTab === "list" && rows.length > 0 ? (chatOpen ? 3000 : 25000) : false,
  });

  const gwHealthQ = useQuery({
    queryKey: ["openclaw-gateway-service-health"],
    queryFn: ({ signal }) =>
      apiGetJson<{
        enabled?: boolean;
        workerDisabled?: boolean;
        lastCheckAt?: string;
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
        intervalSec?: number;
        healthChatTimeoutSec?: number;
      }>("/api/app-center/openclaw/gateway-service-health", { signal }),
    enabled: Boolean(status?.loggedIn) && mainTab === "list",
    refetchInterval: 90_000,
    staleTime: 45_000,
  });

  const gwHealthBadItems = useMemo(
    () => (gwHealthQ.data?.items ?? []).filter((x) => !x.skipped && x.clusterChatOk === false),
    [gwHealthQ.data?.items]
  );
  const gwHealthAny404 = useMemo(
    () => gwHealthBadItems.some((x) => isOpenClawGatewayChat404(x.clusterChatHttpStatus)),
    [gwHealthBadItems]
  );
  const gwHealthAny5xx = useMemo(
    () => gwHealthBadItems.some((x) => isOpenClawGatewayChat5xx(x.clusterChatHttpStatus)),
    [gwHealthBadItems]
  );

  const openClawInitRevisionIssues = useMemo(() => {
    const statuses = k8sStatusQ.data?.statuses ?? {};
    const rows = q.data?.instances ?? [];
    return rows
      .filter((r) => statuses[r.id]?.platformInitRevisionAligned === false)
      .map((r) => ({
        id: r.id,
        label: (r.displayName || r.deploymentName || r.id).trim(),
        hint: statuses[r.id]?.platformInitRevisionHint,
        expected: statuses[r.id]?.platformInitRevisionExpected,
        observed: statuses[r.id]?.platformInitRevisionObserved,
      }));
  }, [k8sStatusQ.data?.statuses, q.data?.instances]);

  const listRefreshing = q.isFetching || k8sStatusQ.isFetching;

  const chatSheetSt = chatRow ? k8sStatusQ.data?.statuses?.[chatRow.id] : undefined;
  const chatSheetGate = !chatRow ? { ok: true as const } : openClawChatAllowed(chatSheetSt);

  const refreshOpenClawList = () => {
    void q.refetch();
    void k8sStatusQ.refetch();
  };

  const probeMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(
        `${import.meta.env.VITE_API_BASE ?? ""}/api/app-center/openclaw/instances/${encodeURIComponent(id)}/gateway-probe`,
        { credentials: "same-origin" }
      );
      const j = (await r.json()) as { ok?: boolean; httpStatus?: number; urlTried?: string; message?: string; error?: string };
      if (!r.ok) throw new Error(j.error || "探针请求失败");
      return j;
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(
          `网关探针成功 · HTTP ${data.httpStatus ?? "—"} · ${(data.urlTried ?? "").slice(0, 120)}${(data.urlTried?.length ?? 0) > 120 ? "…" : ""}`
        );
      } else {
        toast.error(data.message || "网关不可达或返回错误");
      }
    },
    onError: (e) => toast.error(String(e)),
  });

  const [namespace, setNamespace] = useState("");
  const [deploymentName, setDeploymentName] = useState(OPENCLAW_DEFAULT_DEPLOYMENT);
  const [serviceName, setServiceName] = useState(OPENCLAW_DEFAULT_DEPLOYMENT);
  const [image, setImage] = useState("");
  /** init 容器：从 ConfigMap 拷贝到 PVC；可改为内网镜像（如 busybox 拉取失败时） */
  const [initContainerImage, setInitContainerImage] = useState("busybox:1.36");
  const [deployModeId, setDeployModeId] = useState("");
  const bootstrapModeInitRef = useRef(false);
  const nsPrefilledFromBootstrapRef = useRef(false);
  const [deployWait, setDeployWait] = useState<{
    id: string;
    token: string;
    exposeMode: "nodeport" | "ingress";
  } | null>(null);
  const [exposeMode, setExposeMode] = useState<"nodeport" | "ingress">("nodeport");
  const [ingressName, setIngressName] = useState("");
  const [ingressHost, setIngressHost] = useState("");
  const [ingressTlsScheme, setIngressTlsScheme] = useState<"https" | "http">("https");
  const [preset, setPreset] = useState<string>("minimax-m2.7");
  const [chatModel, setChatModel] = useState<string>(() => defaultChatModelForPreset("minimax-m2.7"));
  const [openaiKey, setOpenaiKey] = useState("");
  const [baseUrlOverride, setBaseUrlOverride] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  /** 出站检测 / Telegram 用：选已启用 Hysteria2 的云主机登记 ID */
  const [egressCloudVmId, setEgressCloudVmId] = useState("");
  const [httpProxyUrl, setHttpProxyUrl] = useState("");
  const [rbacDeployPreset, setRbacDeployPreset] = useState<"readonly" | "edit" | "admin">("readonly");
  const [toolsProfileDeploy, setToolsProfileDeploy] = useState<"minimal" | "coding" | "full">("full");
  const [promptPackSel, setPromptPackSel] = useState<Record<string, boolean>>({
    k8s_execute_first: true,
    respond_with_concrete: true,
    ollama_tools_note: false,
  });
  const [precheckResult, setPrecheckResult] = useState<{ ok: boolean; message: string } | null>(null);
  const rbacFromBootstrapRef = useRef(false);

  const cloudVmQ = useQuery({
    queryKey: ["app-center-cloud-vm-instances", "openclaw-wizard"],
    queryFn: ({ signal }) => apiGetJson<{ instances: CloudVmListRow[]; mysqlRequired?: boolean }>("/api/app-center/cloud-vm/instances", { signal }),
    enabled: canWrite && mainTab === "create",
  });

  const hysteriaCloudVms = useMemo(() => {
    const list = cloudVmQ.data?.instances ?? [];
    return list.filter((x) => x.summary?.installHysteria2);
  }, [cloudVmQ.data?.instances]);

  const toolchainOptsQ = useQuery({
    queryKey: ["openclaw-toolchain-options"],
    queryFn: ({ signal }) => apiGetJson<OpenClawToolchainOptionsResp>("/api/app-center/openclaw/toolchain-options", { signal }),
    staleTime: 300_000,
    enabled: canWrite && mainTab === "create",
  });

  const rbacPresetRows = rbacPresetsQ.data?.presets ?? [
    { id: "readonly", label: "只读", description: "", clusterRoleName: "" },
    { id: "edit", label: "编辑", description: "", clusterRoleName: "" },
    { id: "admin", label: "管理员", description: "", clusterRoleName: "" },
  ];
  const rbacPresetLabel = (id?: string) =>
    rbacPresetRows.find((p) => p.id === (id || "readonly"))?.label ?? (id || "readonly");

  const namespaceSelectValue = useMemo(() => {
    const t = namespace.trim();
    if (!t) return NS_SELECT_EMPTY;
    if (nsOptions.includes(t)) return t;
    return NS_SELECT_CUSTOM;
  }, [namespace, nsOptions]);

  useEffect(() => {
    if (!bootstrapQ.data || nsPrefilledFromBootstrapRef.current) return;
    const dn = bootstrapQ.data.defaultNamespace?.trim();
    if (!dn || namespace.trim()) return;
    setNamespace(dn);
    nsPrefilledFromBootstrapRef.current = true;
  }, [bootstrapQ.data, namespace]);

  useLayoutEffect(() => {
    if (bootstrapModeInitRef.current) return;
    const modes = bootstrapQ.data?.modes;
    if (!modes?.length) return;
    bootstrapModeInitRef.current = true;
    const first = modes[0];
    setDeployModeId(first.id);
    setImage(first.image.trim());
    const ini = first.initContainerImage?.trim();
    if (ini) setInitContainerImage(ini);
    else setInitContainerImage("busybox:1.36");
  }, [bootstrapQ.data]);

  useLayoutEffect(() => {
    if (rbacFromBootstrapRef.current || !bootstrapQ.data) return;
    const d = (bootstrapQ.data.defaultRbacPreset ?? "").trim().toLowerCase();
    if (d === "readonly" || d === "edit" || d === "admin") {
      setRbacDeployPreset(d);
    }
    rbacFromBootstrapRef.current = true;
  }, [bootstrapQ.data]);

  useEffect(() => {
    if (!deployWait) return;
    const snap = { ...deployWait };
    let stopped = false;
    let iv: ReturnType<typeof setInterval>;
    let to: ReturnType<typeof setTimeout>;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(iv);
      clearTimeout(to);
    };
    const run = async () => {
      if (stopped) return;
      try {
        const batch = await apiGetJson<OpenClawK8sStatusBatch>("/api/app-center/openclaw/instances/k8s-status");
        if (stopped) return;
        const st = batch.statuses?.[snap.id];
        if (st?.phase !== "ready") return;
        const base = import.meta.env.VITE_API_BASE ?? "";
        const r = await fetch(
          `${base}/api/app-center/openclaw/instances/${encodeURIComponent(snap.id)}/gateway-probe`,
          { credentials: "same-origin" }
        );
        const j = (await r.json()) as { ok?: boolean };
        if (stopped) return;
        if (j.ok) {
          toast.success(
            snap.exposeMode === "ingress"
              ? "部署成功，网关已可访问（Ingress）"
              : "部署成功，网关已可访问（NodePort）"
          );
          if (snap.token) {
            void copyToClipboardSafe(snap.token).then(
              () => toast.message("网关 Token 已复制到剪贴板"),
              () => toast.warning("Token 已就绪，剪贴板不可用，请到详情页手动复制")
            );
          }
          setDeployWait(null);
          stop();
        }
      } catch {
        /* 探针轮询忽略瞬时错误 */
      }
    };
    iv = setInterval(run, 3000);
    void run();
    to = setTimeout(() => {
      if (stopped) return;
      toast.warning(
        "OpenClaw 长时间未就绪或 HTTP 探针未通过。请在列表查看 Pod 状态；网关 Token 请在实例「详情 → 管理配置」中复制。"
      );
      setDeployWait(null);
      stop();
    }, 15 * 60 * 1000);
    return stop;
  }, [deployWait]);

  const dupInRegistry = useMemo(() => {
    const ns = namespace.trim();
    const dep = deploymentName.trim();
    if (!ns || !dep) return false;
    return rows.some(
      (r) =>
        r.namespace.trim().toLowerCase() === ns.toLowerCase() &&
        r.deploymentName.trim().toLowerCase() === dep.toLowerCase()
    );
  }, [rows, namespace, deploymentName]);

  const deployMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ instance: InstanceRow; gatewayToken: string }>("/api/app-center/openclaw/k8s-deploy", {
        namespace: namespace.trim(),
        deploymentName: deploymentName.trim(),
        serviceName: serviceName.trim(),
        nodePort: 0,
        exposeMode,
        ingressName: ingressName.trim(),
        ingressHost: ingressHost.trim(),
        ingressTlsScheme,
        image: image.trim(),
        initContainerImage: initContainerImage.trim(),
        modelPreset: preset,
        openaiApiKey: openaiKey.trim(),
        openaiBaseUrl: baseUrlOverride.trim(),
        geminiApiKey: geminiKey.trim(),
        displayName: displayName.trim() || deploymentName.trim(),
        chatModel: chatModel.trim() || defaultChatModelForPreset(preset),
        egressCloudVmId: egressCloudVmId.trim(),
        httpProxyUrl: httpProxyUrl.trim(),
        rbacPreset: rbacDeployPreset,
        toolsProfile: toolsProfileDeploy,
        promptPacks: Object.entries(promptPackSel)
          .filter(([, on]) => on)
          .map(([id]) => id),
      }),
    onSuccess: (data) => {
      setDeployWait({
        id: data.instance.id,
        token: data.gatewayToken ?? "",
        exposeMode,
      });
      setMainTab("list");
      setStep(1);
      void qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      void qc.invalidateQueries({ queryKey: ["app-openclaw-k8s-status"] });
      void qc.invalidateQueries({ queryKey: ["app-center-openclaw-instances"] });
    },
    onError: (e) => toast.error(e instanceof ApiHttpError ? e.serverMessage : String(e)),
  });

  const precheckMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ ok?: boolean; message?: string; error?: string; openaiBaseApplied?: string; chatModel?: string }>(
        "/api/app-center/openclaw/validate-upstream",
        {
          modelPreset: preset,
          openaiApiKey: openaiKey.trim(),
          openaiBaseUrl: baseUrlOverride.trim(),
          chatModel: chatModel.trim() || defaultChatModelForPreset(preset),
        }
      ),
    onSuccess: (data) => {
      const msg = data.message || "预检通过";
      setPrecheckResult({ ok: true, message: msg });
      toast.success(msg);
    },
    onError: (e) => {
      const msg = e instanceof ApiHttpError ? e.serverMessage : String(e);
      setPrecheckResult({ ok: false, message: msg });
      toast.error(msg);
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/app-center/openclaw/instances/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const j = (await r.json()) as {
        error?: string;
        ok?: boolean;
        k8sAttempted?: boolean;
        k8sWarnings?: string[];
        k8sSkippedShared?: boolean;
      };
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    },
    onSuccess: (data) => {
      if (!data.k8sAttempted) {
        toast.success("已移除平台登记（当前未连接 K8s，未删除集群内资源）");
      } else if (data.k8sSkippedShared) {
        toast.success("已删除实例；同命名空间仍有其他登记且本实例为旧版共享存储，已保留共享 PVC / Secret / ConfigMap / ServiceAccount");
      } else {
        toast.success("已从平台移除并删除集群内关联资源");
      }
      if (data.k8sAttempted && data.k8sWarnings && data.k8sWarnings.length > 0) {
        toast.message(data.k8sWarnings.join("；"), { duration: 8000 });
      }
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: ["app-openclaw-instances"] });
      void qc.invalidateQueries({ queryKey: ["app-openclaw-k8s-status"] });
      void qc.invalidateQueries({ queryKey: ["app-center-openclaw-instances"] });
      void qc.invalidateQueries({ queryKey: ["openclaw-gateway-service-health"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const step1Missing = (): string[] => {
    const m: string[] = [];
    if (!namespace.trim()) {
      m.push("命名空间（下拉中选已有项，或选「手动输入新命名空间…」后在输入框填写）");
    }
    if (!deploymentName.trim()) m.push("Deployment 名称");
    if (!serviceName.trim()) m.push("Service 名称");
    if (!image.trim()) m.push("容器镜像");
    return m;
  };
  const step1Ok = step1Missing().length === 0;
  const step2Ok = exposeMode === "nodeport" || (exposeMode === "ingress" && ingressHost.trim().length > 0);

  const goNext = () => {
    if (step === 1) {
      const miss = step1Missing();
      if (miss.length > 0) {
        toast.error(miss.length === 1 ? `请补充：${miss[0]}` : `请补充以下项：${miss.join("；")}`);
        return;
      }
    }
    if (step === 2 && !step2Ok) {
      toast.error("Ingress 模式需填写域名（Host）");
      return;
    }
    if (step < 3) setStep((s) => s + 1);
  };
  const goPrev = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  const openCreateTab = () => {
    setStep(1);
    setMainTab("create");
  };

  const submitDeploy = () => {
    const miss1 = step1Missing();
    if (miss1.length > 0) {
      toast.error(miss1.length === 1 ? `请补充：${miss1[0]}` : `请补充以下项：${miss1.join("；")}`);
      return;
    }
    if (dupInRegistry) {
      toast.error("该平台已登记相同的「命名空间 + Deployment」，请更换名称或先删除旧登记");
      return;
    }
    if (!step2Ok) {
      toast.error("Ingress 模式需填写域名（Host）");
      return;
    }
    deployMut.mutate();
  };

  const submitPrecheck = () => {
    const miss1 = step1Missing();
    if (miss1.length > 0) {
      toast.error(miss1.length === 1 ? `请补充：${miss1[0]}` : `请补充以下项：${miss1.join("；")}`);
      return;
    }
    precheckMut.mutate();
  };

  const submitOpenClawChat = async () => {
    if (!chatRow?.id || chatSending) return;
    const t = chatDraft.trim();
    if (!t) return;
    const next = [...chatMsgs, { role: "user", content: t }];
    setChatMsgs(next);
    setChatDraft("");
    setChatSending(true);
    try {
      const r = await apiPostJson<{ reply?: string }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(chatRow.id)}/chat`,
        { messages: next }
      );
      const merged = [
        ...next,
        { role: "assistant", content: (r.reply ?? "").trim() || "（无正文）" },
      ];
      setChatMsgs(merged);
      saveOpenClawChatMessages(chatRow.id, merged);
    } catch (err) {
      toast.error(err instanceof ApiHttpError ? err.serverMessage : String(err));
    } finally {
      setChatSending(false);
    }
  };

  const modeSelectValue = deployModeId || bootstrapModes[0]?.id || "";

  const onDeployModeChange = (id: string) => {
    setDeployModeId(id);
    const modes = bootstrapQ.data?.modes ?? [];
    const m = modes.find((x) => x.id === id);
    if (m) {
      setImage(m.image.trim());
      const ini = m.initContainerImage?.trim();
      if (ini) setInitContainerImage(ini);
      else setInitContainerImage("busybox:1.36");
    }
  };

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
        </Link>{" "}
        完成配置。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50/30 px-6 py-8 shadow-sm">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-800/90">应用中心 · OpenClaw</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900">
              <Bot className="h-7 w-7 text-violet-600" />
              OpenClaw 网关
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              向集群下发官方镜像、只读 ClusterRole 与网关 Token。支持 <strong>NodePort</strong>（端口由集群随机分配）或{" "}
              <strong>Ingress + 宝塔同步注解</strong>，填写域名后由宝塔面板反代。对接上游大模型默认 <strong>MiniMax M2.7</strong>，另可选智谱、<strong>Ollama</strong>、
              <strong>千问兼容</strong>、<strong>Kimi</strong> 等预设；<strong>AI 巡检</strong>请在「AI 巡检」页选用本处登记的实例（无需在列表同步）。
              在<strong>实例列表</strong>中可打开<strong>对话</strong>侧栏：由<strong>本平台后端</strong>代连集群内{" "}
              <code className="rounded bg-violet-100/80 px-1">/v1/chat/completions</code>。网关 Token 与模型切换见实例<strong>详情 → 管理配置</strong>。
              Control UI 若报 <strong>origin not allowed</strong>：在「详情 → 配置文件」编辑{" "}
              <code className="rounded bg-violet-100/80 px-1">openclaw.json</code> 中的 <code className="rounded bg-violet-100/80 px-1">gateway.controlUi.allowedOrigins</code>，保存后视需要滚动重启。
            </p>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="h-10 gap-1.5 bg-violet-600 hover:bg-violet-700"
                onClick={openCreateTab}
              >
                <Plus className="h-4 w-4" />
                创建实例
              </Button>
            </div>
          ) : null}
        </div>
        {isAdmin ? (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-violet-200/90 bg-white/90 px-4 py-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <div className="min-w-0">
                <p className="font-medium text-slate-900">部署模式模板（platform_kv）</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-600">
                  前台路径：<span className="text-violet-800">{OPENCLAW_BOOTSTRAP_PATH}</span>
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" asChild>
              <Link to={OPENCLAW_BOOTSTRAP_PATH}>打开配置页</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <Tabs
        value={canWrite ? mainTab : "list"}
        onValueChange={(v) => {
          if (!canWrite) return;
          setMainTab(v as "list" | "create");
          if (v === "create") setStep(1);
        }}
        className="w-full"
      >
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-slate-200/80 bg-slate-50/80 p-1 sm:w-auto">
          <TabsTrigger
            value="list"
            className="gap-1.5 rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <Bot className="h-4 w-4 shrink-0" />
            实例列表
          </TabsTrigger>
          {canWrite ? (
            <TabsTrigger
              value="create"
              className="gap-1.5 rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              <Plus className="h-4 w-4 shrink-0" />
              创建 OpenClaw
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="list" className="mt-4 space-y-4 outline-none">
          {openClawInitRevisionIssues.length > 0 ? (
            <Alert variant="default" className="border-amber-300 bg-amber-50/90 text-amber-950">
              <AlertTitle>OpenClaw 集群模板与当前平台版本不一致</AlertTitle>
              <AlertDescription className="space-y-2 text-sm text-amber-950/90">
                <p>
                  下列实例在 Deployment Pod 模板上缺少或落后于平台期望的 init 修订标记，可能导致旧版 PVC 补丁脚本、探活 404
                  等问题。请在对应<strong>详情</strong>中<strong>应用网关镜像</strong>或保存<strong>管理配置</strong>（RBAC）以同步模板并滚动
                  Pod。
                </p>
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  {openClawInitRevisionIssues.map((x) => (
                    <li key={x.id}>
                      <span className="font-medium">{x.label}</span>
                      {x.expected != null ? (
                        <span className="font-mono text-[11px]">
                          {" "}
                          · 期望修订 {x.expected}
                          {x.observed != null ? ` · 集群 ${x.observed}` : ""}
                        </span>
                      ) : null}
                      {x.hint ? <span className="mt-0.5 block text-amber-900/85">{x.hint}</span> : null}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {gwHealthQ.data?.enabled && gwHealthBadItems.length > 0 ? (
            <Alert variant="destructive" className="border-red-300 bg-red-50/90 text-red-950">
              <AlertTitle>OpenClaw 服务级探活异常</AlertTitle>
              <AlertDescription className="space-y-2 text-sm text-red-950/90">
                <p className="text-xs leading-relaxed">
                  用网关 Token 对 <code className="rounded bg-white/80 px-0.5 font-mono">/v1/chat/completions</code> 与{" "}
                  <code className="rounded bg-white/80 px-0.5 font-mono">/chat/completions</code> 做极简补全（与「对话」「AI
                  巡检」同源）。各实例<strong>下一行即报错类型</strong>：<span className="font-mono">404</span>→chat 路由未开；{" "}
                  <span className="font-mono">5xx</span>→上游大模型/密钥/出站；<strong>无 HTTP 状态</strong>→连接层（如{" "}
                  <span className="font-mono">EOF</span>、重置）；含「超时」可调{" "}
                  <code className="rounded bg-white/80 px-0.5 font-mono text-[10px]">
                    KUBEBT_OPENCLAW_GATEWAY_HEALTH_CHAT_TIMEOUT_SEC
                  </code>
                  （默认 {gwHealthQ.data.healthChatTimeoutSec ?? 90}s）。
                </p>
                <ul className="list-none space-y-3 text-xs">
                  {gwHealthBadItems.map((x) => (
                    <li key={x.id} className="rounded-lg border border-red-200/70 bg-white/60 px-2.5 py-2">
                      <p className="font-sans font-semibold text-red-950">{formatOpenClawGatewayHealthInstanceLine(x)}</p>
                      <p className="mt-1 text-[12px] font-semibold leading-snug text-red-950 break-words">
                        {isOpenClawGatewayChatNoHttpStatus(x.clusterChatHttpStatus)
                          ? "无 HTTP 状态 · 传输/连接"
                          : `HTTP ${x.clusterChatHttpStatus}`}{" "}
                        — {formatOpenClawClusterChatProbeSnippet(x.clusterChatMessage || "未知", 360)}
                      </p>
                      <Link
                        to={`/cluster/apps/openclaw/${encodeURIComponent(x.id)}`}
                        className="mt-2 inline-block text-[11px] font-medium text-violet-800 underline-offset-2 hover:underline"
                      >
                        打开实例详情（编辑 openclaw.json、上游检测）
                      </Link>
                    </li>
                  ))}
                </ul>
                {gwHealthQ.data.lastCheckAt ? (
                  <p className="text-xs text-red-900/85">
                    最近巡检：{formatDateTimeShanghai(gwHealthQ.data.lastCheckAt)}（UTC：{gwHealthQ.data.lastCheckAt}）
                    {gwHealthQ.data.workerDisabled
                      ? " · 后台探活已禁用（KUBEBT_OPENCLAW_GATEWAY_HEALTH_DISABLED）"
                      : ` · 约每 ${gwHealthQ.data.intervalSec ?? OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC_DEFAULT}s 自动执行 · 单次 chat 探活超时 ${gwHealthQ.data.healthChatTimeoutSec ?? 90}s`}
                  </p>
                ) : null}
                {gwHealthAny404 ? (
                  <OpenClawChat404RemedyPanel variant="amber" className="mt-2 border-amber-200 bg-amber-50/90" />
                ) : null}
                {gwHealthAny5xx ? <OpenClawChat5xxRemedyPanel className="mt-2" /> : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !delMut.isPending && setDeleteTarget(null)}>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>确认删除 OpenClaw 实例？</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3 text-sm text-slate-600">
                    <p>
                      第二道确认：将<strong className="text-slate-900">从平台移除登记</strong>，并删除本实例在集群中的{" "}
                      <strong className="text-slate-900">Deployment、Service、Ingress（若有）、ClusterRoleBinding</strong>
                      ，以及<strong className="text-slate-900">本实例专属</strong>的 PVC / Secret / ConfigMap / ServiceAccount（新部署按 Deployment 名隔离，互不影响）。若本实例为<strong>旧版登记</strong>且同命名空间内<strong>仍有其他 OpenClaw 登记</strong>，为避免误删共享卷，将<strong className="text-slate-900">不删除</strong> PVC / Secret / ConfigMap / ServiceAccount。
                    </p>
                    <p className="text-destructive">
                      此操作不可恢复。请确认节点与命名空间无误。
                    </p>
                    <p className="rounded-md bg-slate-100 px-2 py-1.5 font-mono text-xs text-slate-800">
                      {deleteTarget?.namespace}/{deleteTarget?.deploymentName}
                      <span className="block text-[10px] font-sans text-slate-500">Service {deleteTarget?.serviceName}</span>
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={delMut.isPending}>取消</AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={delMut.isPending || !deleteTarget}
                  className="gap-1.5"
                  onClick={() => {
                    if (!deleteTarget) return;
                    delMut.mutate(deleteTarget.id);
                  }}
                >
                  {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  确认删除
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={listRefreshing}
              onClick={() => refreshOpenClawList()}
            >
              <RefreshCw className={cn("h-4 w-4", listRefreshing && "animate-spin")} />
              刷新列表
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>显示名</TableHead>
                  <TableHead className="min-w-[140px]">K8s</TableHead>
                  <TableHead className="whitespace-nowrap text-xs">集群权限</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">运行状态</TableHead>
                  <TableHead>暴露</TableHead>
                  <TableHead className="whitespace-nowrap">创建时间</TableHead>
                  <TableHead className="min-w-[200px]">访问地址</TableHead>
                  <TableHead className="w-[240px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-slate-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-slate-500">
                      暂无登记
                      {canWrite ? "，可切换到「创建 OpenClaw」部署" : null}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const expose =
                      (row.exposeMode || "nodeport").toLowerCase() === "ingress"
                        ? row.publicV1Url || (row.ingressHost ? `https://${row.ingressHost}/v1` : "Ingress")
                        : row.nodePort > 0
                          ? `NodePort ${row.nodePort}`
                          : "NodePort …";
                    const access =
                      (row.exposeMode || "").toLowerCase() === "ingress" && row.publicV1Url
                        ? row.publicV1Url
                        : row.externalV1Url || row.clusterV1BaseUrl;
                    const st = k8sStatusQ.data?.statuses?.[row.id];
                    const chatGate = openClawChatAllowed(st);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-slate-900">
                          {row.displayName || row.deploymentName}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">
                          {row.namespace}/{row.deploymentName}
                          <div className="text-[10px] text-slate-400">svc {row.serviceName}</div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">{rbacPresetLabel(row.rbacPreset)}</TableCell>
                        <TableCell className="align-middle">
                          {k8sStatusQ.isLoading && !st ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          ) : (
                            openClawRunStatusBadge(st)
                          )}
                        </TableCell>
                        <TableCell>
                          {(row.exposeMode || "nodeport").toLowerCase() === "ingress" ? (
                            <Badge variant="secondary" className="font-normal">
                              Ingress
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal">
                              NodePort
                            </Badge>
                          )}
                          <div className="mt-1 text-[11px] text-slate-500">{expose}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-slate-700">
                          {formatDateTimeShanghai(row.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <code className="break-all text-[11px] text-slate-800">{access}</code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-1 h-7 px-2"
                            onClick={() =>
                              void copyToClipboardSafe(access).then(
                                () => toast.success("已复制"),
                                () => toast.error("复制失败，请手动选择地址栏文本")
                              )
                            }
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <Button type="button" size="sm" variant="outline" asChild>
                              <Link to={`/cluster/apps/openclaw/${row.id}`}>详情</Link>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="gap-1 bg-violet-600 hover:bg-violet-700"
                              title={
                                chatGate.ok
                                  ? "由平台代连网关 OpenAI 兼容接口，多轮对话"
                                  : chatGate.reason ?? "暂不可对话"
                              }
                              disabled={!chatGate.ok}
                              onClick={() => {
                                setChatRow(row);
                                setChatMsgs(loadOpenClawChatMessages(row.id));
                                setChatDraft("");
                                setChatOpen(true);
                              }}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              对话
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              title="从平台发起 HTTP 探针（优先 Ingress/NodePort）"
                              disabled={probeMut.isPending}
                              onClick={() => probeMut.mutate(row.id)}
                            >
                              {probeMut.isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Radio className="h-3.5 w-3.5" />
                              )}
                              探针
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteTarget(row)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {canWrite ? (
          <TabsContent value="create" className="mt-4 outline-none">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                <CardTitle className="text-base">创建 OpenClaw</CardTitle>
                <CardDescription>
                  与云主机相同的分步流程：资源名称须符合 DNS 标签规则；Secret 中变量名固定为 OPENAI_API_KEY / OPENAI_BASE_URL / GEMINI_API_KEY 等，由下方表单写入值。
                </CardDescription>
                <ol className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-4">
                  {STEPS.map((s) => (
                    <li
                      key={s.n}
                      className={cn(
                        "flex min-w-0 flex-1 items-start gap-3 rounded-lg border px-3 py-2.5 text-left sm:max-w-[220px]",
                        step === s.n
                          ? "border-violet-400 bg-violet-50/90"
                          : step > s.n
                            ? "border-emerald-200/80 bg-emerald-50/50"
                            : "border-slate-200 bg-white"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                          step === s.n
                            ? "bg-violet-600 text-white"
                            : step > s.n
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-200 text-slate-600"
                        )}
                      >
                        {s.n}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">{s.title}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{s.desc}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                {step === 1 && (
                  <div className="grid max-w-2xl gap-4">
                    {bootstrapModes.length > 0 ? (
                      <div className="space-y-2 rounded-lg border border-violet-200/90 bg-violet-50/50 p-3">
                        <Label>部署模式</Label>
                        <p className="text-[11px] leading-relaxed text-slate-600">
                          网关与 Init 镜像地址由管理员在「OpenClaw 配置页」维护；此处仅选择模式，不可改地址。
                        </p>
                        <Select value={modeSelectValue} onValueChange={onDeployModeChange}>
                          <SelectTrigger className="h-auto min-h-10 w-full py-2 text-left font-mono text-sm">
                            <SelectValue placeholder="选择部署模式" />
                          </SelectTrigger>
                          <SelectContent position="popper" className="max-h-[min(360px,55vh)]">
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
                        <p className="text-[11px] text-slate-600">
                          将使用的网关镜像{" "}
                          <code className="break-all rounded bg-white/90 px-1 font-mono text-[10px]">{image.trim() || "—"}</code>
                          <span className="mx-1">·</span>
                          Init{" "}
                          <code className="break-all rounded bg-white/90 px-1 font-mono text-[10px]">
                            {initContainerImage.trim() || "—"}
                          </code>
                        </p>
                        {isAdmin ? (
                          <p className="text-[11px] text-violet-900">
                            修改镜像或增加模式：{" "}
                            <Link to={OPENCLAW_BOOTSTRAP_PATH} className="font-medium underline">
                              打开配置页
                            </Link>
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500">需调整镜像请联系管理员在配置页修改模板。</p>
                        )}
                      </div>
                    ) : null}
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                      <Label>集群权限（网关 ServiceAccount）</Label>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        绑定平台预置 ClusterRole，控制 OpenClaw 网关对全集群 API 的访问范围。默认取自{" "}
                        <Link to={OPENCLAW_BOOTSTRAP_PATH} className="font-medium text-violet-800 underline">
                          配置页
                        </Link>{" "}
                        的「新建实例默认集群权限」，可在此改为本次部署专用。
                      </p>
                      <Select
                        value={rbacDeployPreset}
                        onValueChange={(v) => setRbacDeployPreset(v as "readonly" | "edit" | "admin")}
                      >
                        <SelectTrigger className="h-auto min-h-10 w-full py-2 text-left text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-[min(360px,55vh)]">
                          {rbacPresetRows.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="items-start py-2">
                              <span className="block text-sm font-medium text-slate-900">{p.label}</span>
                              {p.description ? (
                                <span className="mt-0.5 block text-[11px] text-slate-600">{p.description}</span>
                              ) : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>命名空间</Label>
                      {nsQ.isLoading ? (
                        <p className="text-sm text-slate-500">正在加载集群命名空间…</p>
                      ) : nsOptions.length > 0 ? (
                        <>
                          <Select
                            value={namespaceSelectValue}
                            onValueChange={(v) => {
                              if (v === NS_SELECT_EMPTY) {
                                setNamespace("");
                                return;
                              }
                              if (v === NS_SELECT_CUSTOM) {
                                if (nsOptions.includes(namespace.trim())) setNamespace("");
                                return;
                              }
                              setNamespace(v);
                            }}
                          >
                            <SelectTrigger className="h-9 w-full min-w-0 font-mono text-sm">
                              <SelectValue placeholder="请选择命名空间" />
                            </SelectTrigger>
                            <SelectContent position="popper" className="max-h-[min(280px,50vh)]">
                              <SelectItem value={NS_SELECT_EMPTY} className="text-slate-500">
                                请选择…
                              </SelectItem>
                              {nsOptions.map((ns) => (
                                <SelectItem key={ns} value={ns} className="font-mono text-sm">
                                  {ns}
                                </SelectItem>
                              ))}
                              <SelectItem value={NS_SELECT_CUSTOM}>手动输入新命名空间…</SelectItem>
                            </SelectContent>
                          </Select>
                          {namespaceSelectValue === NS_SELECT_CUSTOM ? (
                            <Input
                              value={namespace}
                              onChange={(e) => setNamespace(e.target.value)}
                              placeholder="例如 my-openclaw（不存在时将尝试创建）"
                              className="font-mono text-sm"
                              autoComplete="off"
                              autoFocus
                            />
                          ) : null}
                        </>
                      ) : (
                        <Input
                          value={namespace}
                          onChange={(e) => setNamespace(e.target.value)}
                          placeholder="当前集群无可用列表，请直接填写，例如 my-openclaw"
                          className="font-mono text-sm"
                          autoComplete="off"
                        />
                      )}
                      <p className="text-[11px] text-slate-500">
                        从下拉中点选已有命名空间；需新建时请选「手动输入…」后再填写。与{" "}
                        <code className="rounded bg-slate-100 px-0.5">kubectl get ns</code> 一致。
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Deployment 名称</Label>
                        <Input
                          value={deploymentName}
                          onChange={(e) => setDeploymentName(e.target.value)}
                          placeholder="例如 openclaw-gateway"
                          className="font-mono text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Service 名称</Label>
                        <Input
                          value={serviceName}
                          onChange={(e) => setServiceName(e.target.value)}
                          placeholder="例如 openclaw-gateway"
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="grid max-w-2xl gap-4">
                    <div className="space-y-2">
                      <Label>暴露方式</Label>
                      <Select value={exposeMode} onValueChange={(v) => setExposeMode(v as "nodeport" | "ingress")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nodeport">NodePort（端口由集群随机分配）</SelectItem>
                          <SelectItem value="ingress">Ingress + 宝塔同步（域名反代）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {exposeMode === "ingress" ? (
                      <>
                        <div className="space-y-2">
                          <Label>Ingress 名称（可空，默认 &lt;Deployment&gt;-ingress）</Label>
                          <Input
                            value={ingressName}
                            onChange={(e) => setIngressName(e.target.value)}
                            placeholder="例如 openclaw-gateway-ingress"
                            className="font-mono text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>域名（Ingress rules.host）</Label>
                          <Input
                            value={ingressHost}
                            onChange={(e) => setIngressHost(e.target.value)}
                            placeholder="例如 claw.example.com"
                            className="font-mono text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>对外 Base URL 协议（登记用）</Label>
                          <Select value={ingressTlsScheme} onValueChange={(v) => setIngressTlsScheme(v as "https" | "http")}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="https">https（推荐，宝塔证书终止）</SelectItem>
                              <SelectItem value="http">http</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>宝塔同步注解</Label>
                          <code className="block rounded bg-slate-100 px-2 py-1 text-xs">kube-bt-sync.io/baota-sync</code>
                          <p className="text-[11px] text-slate-500">
                            Service 为 ClusterIP；Ingress 路径 <code className="rounded bg-slate-100 px-0.5">/</code> 指向网关端口{" "}
                            18789。请确保宝塔侧已配置对应同步规则。
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-600">
                        将创建 NodePort 类型 Service，<strong>不指定 NodePort 字段</strong>，由 Kubernetes 在 30000–32767
                        内分配。外网访问示例为「节点访问 IP + 分配端口」；列表中展示分配结果。
                      </p>
                    )}
                  </div>
                )}

                {step === 3 && (
                  <div className="grid max-w-2xl gap-4">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>大模型预设</Label>
                      <Select
                        value={preset}
                        onValueChange={(v) => {
                          setPreset(v);
                          setChatModel(defaultChatModelForPreset(v));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRESETS.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3 sm:col-span-2 rounded-lg border border-teal-200/80 bg-teal-50/40 p-3">
                      <p className="text-sm font-medium text-slate-900">OpenClaw 工具链（tools.profile）</p>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        写入首次下发 ConfigMap 中的 <code className="rounded bg-white/70 px-0.5">openclaw.json</code>；与网关镜像能力需匹配。安装后可在<strong>详情 → 管理配置</strong>再次应用并滚动重启。
                      </p>
                      <Select
                        value={toolsProfileDeploy}
                        onValueChange={(v) => setToolsProfileDeploy(v as "minimal" | "coding" | "full")}
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
                      <p className="text-sm font-medium text-slate-900">提示词增强（勾选后写入 SOUL / AGENTS）</p>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        用于约束「先查集群再回答」「先给数据再给教程」等；与记忆模型无关，随 PVC 持久化。
                      </p>
                      <div className="space-y-2">
                        {(toolchainOptsQ.data?.promptPacks ?? [
                          { id: "k8s_execute_first", label: "集群查询：先工具后回答", description: "" },
                          { id: "respond_with_concrete", label: "输出：先结论后解释", description: "" },
                          { id: "ollama_tools_note", label: "Ollama：工具调用说明", description: "" },
                        ]).map((p) => (
                          <div key={p.id} className="flex items-start gap-2 rounded-md border border-teal-100/90 bg-white/70 px-2 py-2">
                            <Checkbox
                              id={`oc-pack-${p.id}`}
                              checked={!!promptPackSel[p.id]}
                              onCheckedChange={(c) =>
                                setPromptPackSel((prev) => ({ ...prev, [p.id]: c === true }))
                              }
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <Label htmlFor={`oc-pack-${p.id}`} className="cursor-pointer text-sm font-medium text-slate-800">
                                {p.label}
                              </Label>
                              {p.description ? (
                                <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{p.description}</p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      {preset === "ollama" && (toolchainOptsQ.data?.ollamaModelRecommendations?.length ?? 0) > 0 ? (
                        <div className="rounded-md border border-amber-200/80 bg-amber-50/60 px-2 py-2 text-[11px] text-amber-950">
                          <p className="font-medium">推荐开源 Ollama 模型（按需 pull）</p>
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
                    {preset === "glm-4.7" ? (
                      <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-950">
                        <strong>智谱 GLM</strong>：默认 <code className="rounded bg-white/80 px-1">OPENAI_BASE_URL</code> 为{" "}
                        <code className="rounded bg-white/80 px-1">https://open.bigmodel.cn/api/paas/v4</code>
                        ；密钥填智谱开放平台 API Key；模型名常用 <code className="rounded bg-white/80 px-1">glm-4.7</code>。
                      </p>
                    ) : null}
                    {(preset === "minimax-m2.5" || preset === "minimax-m2.7") ? (
                      <p className="rounded-lg border border-indigo-200/80 bg-indigo-50/70 px-3 py-2 text-sm text-indigo-950">
                        <strong>MiniMax</strong>：向导默认 <code className="rounded bg-white/80 px-1">OPENAI_BASE_URL</code> 为{" "}
                        <code className="rounded bg-white/80 px-1">https://api.minimaxi.com/v1</code>
                        （与 <a className="underline" href="https://platform.minimaxi.com/docs/api-reference/text-openai-api" target="_blank" rel="noreferrer">OpenAI 兼容文档</a>{" "}
                        一致）。若密钥在 <strong>platform.minimaxi.com</strong>（Token 套餐等）创建，勿填{" "}
                        <code className="rounded bg-white/80 px-1">api.minimax.io</code>，否则易 401{" "}
                        <code className="rounded bg-white/80 px-0.5">invalid api key (2049)</code>；仅 minimax.io 侧密钥可改用{" "}
                        <code className="rounded bg-white/80 px-1">https://api.minimax.io/v1</code>。M2.7 模型名{" "}
                        <code className="rounded bg-white/80 px-1">MiniMax-M2.7</code>；可选用{" "}
                        <code className="rounded bg-white/80 px-1">MiniMax-M2.7-highspeed</code>。
                      </p>
                    ) : null}
                    {preset === "openai" ? (
                      <p className="rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-sm text-slate-900">
                        <strong>OpenAI</strong>：默认 <code className="rounded bg-white/80 px-1">OPENAI_BASE_URL</code> 为{" "}
                        <code className="rounded bg-white/80 px-1">https://api.openai.com/v1</code>
                        ；密钥为 OpenAI API Key；默认模型 <code className="rounded bg-white/80 px-1">gpt-4o-mini</code>。
                      </p>
                    ) : null}
                    {preset === "ollama" ? (
                      <p className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-sm text-amber-950">
                        <strong>Ollama</strong>：默认 Base URL 为占位 <code className="rounded bg-white/80 px-1">127.0.0.1:11434</code>
                        ，Pod 内无法访问。请在下方「覆盖 OPENAI_BASE_URL」填写集群内地址，例如{" "}
                        <code className="rounded bg-white/80 px-1">http://ollama.default.svc.cluster.local:11434/v1</code>
                        。API Key 可留空。
                      </p>
                    ) : null}
                    {preset === "qwen-compatible" ? (
                      <p className="rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2 text-sm text-sky-950">
                        <strong>千问兼容模式</strong>：使用阿里云 DashScope OpenAI 兼容端点；密钥填控制台 API-Key，默认 Base URL 为官方兼容地址，可按地域覆盖。
                      </p>
                    ) : null}
                    {preset === "kimi" ? (
                      <p className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 text-sm text-violet-950">
                        <strong>Kimi（Moonshot）</strong>：填写 Moonshot 开放平台 API Key；默认 Base URL 为{" "}
                        <code className="rounded bg-white/80 px-1">https://api.moonshot.cn/v1</code>。
                      </p>
                    ) : null}
                    <div className="space-y-2 sm:col-span-2">
                      <Label>上游模型名（写入登记，请求 OpenAI 兼容接口时的 model）</Label>
                      <Input
                        value={chatModel}
                        onChange={(e) => setChatModel(e.target.value)}
                        className="font-mono text-sm"
                        placeholder={defaultChatModelForPreset(preset) || "例如 gpt-4o-mini"}
                      />
                      <p className="text-[11px] text-slate-500">
                        MiniMax M2.7 默认 <code className="rounded bg-slate-100 px-0.5">MiniMax-M2.7</code>；Ollama 填已 pull 名；千问填{" "}
                        <code className="rounded bg-slate-100 px-0.5">qwen-turbo</code> 等；留空则按预设默认值。
                      </p>
                      <p className="text-[11px] text-slate-500">
                        点击底部按钮时，平台会先用当前 <code className="rounded bg-slate-100 px-0.5">OPENAI_BASE_URL</code>、API Key 与该模型名做一次
                        极简 <code className="rounded bg-slate-100 px-0.5">chat/completions</code> 校验；仅对国内模型预设与 Ollama 强制校验，通过后才会真正创建集群资源。
                      </p>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>
                        OPENAI_API_KEY（写入 Secret）
                        {preset === "ollama"
                          ? " · 本地 Ollama 常可留空"
                          : preset === "qwen-compatible"
                            ? " · DashScope API Key"
                            : preset === "kimi"
                              ? " · Moonshot API Key"
                              : preset === "glm-4.7"
                                ? " · 智谱 / OpenAI 兼容密钥"
                                : preset === "minimax-m2.5" || preset === "minimax-m2.7"
                                  ? " · MiniMax API Key"
                                  : preset === "openai"
                                    ? " · OpenAI API Key"
                                    : " · 按上游要求"}
                      </Label>
                      <Input
                        type="password"
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        autoComplete="off"
                        placeholder="按厂商要求填写"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>
                        覆盖 OPENAI_BASE_URL（可选）
                        {preset === "ollama" ? " · Ollama 强烈建议填写集群内 /v1 根地址" : ""}
                      </Label>
                      <Input
                        value={baseUrlOverride}
                        onChange={(e) => setBaseUrlOverride(e.target.value)}
                        className="font-mono text-sm"
                        placeholder={
                          preset === "ollama"
                            ? "http://ollama.default.svc.cluster.local:11434/v1"
                            : "留空则使用预设默认或留空"
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>GEMINI_API_KEY（可选）</Label>
                      <Input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} autoComplete="off" />
                    </div>
                    {precheckResult ? (
                      <div
                        className={`space-y-1 rounded-lg border px-3 py-2 text-[11px] sm:col-span-2 ${
                          precheckResult.ok
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-red-200 bg-red-50 text-red-900"
                        }`}
                      >
                        <p className="font-medium">{precheckResult.ok ? "上游预检通过" : "上游预检失败"}</p>
                        <p className="break-words">{precheckResult.message}</p>
                      </div>
                    ) : null}
                    <div className="space-y-2 sm:col-span-2">
                      <Label>列表显示名称（可空，默认 Deployment 名）</Label>
                      <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="前台展示用" />
                    </div>
                    <div className="space-y-2 sm:col-span-2 rounded-lg border border-fuchsia-200/80 bg-fuchsia-50/40 px-3 py-3">
                      <p className="text-sm font-medium text-slate-800">出站与 HTTP(S) 代理（可选）</p>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        若云主机已装 <strong>Hysteria2 客户端</strong>，可在此登记其平台 ID，供「管理配置」中在 Pod 内做{" "}
                        <strong>Google 可达性</strong>检测；并在下方填写网关访问外网时使用的{" "}
                        <code className="rounded bg-white/80 px-0.5">HTTP_PROXY</code> /{" "}
                        <code className="rounded bg-white/80 px-0.5">HTTPS_PROXY</code>（如与 HY2 配套的 HTTP 代理地址，须集群内可解析）。
                      </p>
                      {cloudVmQ.isLoading ? (
                        <p className="text-xs text-slate-500">加载云主机列表…</p>
                      ) : cloudVmQ.data?.mysqlRequired ? (
                        <p className="text-xs text-amber-800">未连接 MySQL 时无法列出云主机，可手动在详情页填写出站 ID。</p>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-xs">出站云主机（仅列出已勾选 Hysteria2 客户端的实例）</Label>
                          <Select
                            value={egressCloudVmId.trim() ? egressCloudVmId.trim() : "__none__"}
                            onValueChange={(v) => setEgressCloudVmId(v === "__none__" ? "" : v)}
                          >
                            <SelectTrigger className="font-mono text-sm">
                              <SelectValue placeholder="不登记出站云主机" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">不登记</SelectItem>
                              {hysteriaCloudVms.map((vm) => (
                                <SelectItem key={vm.id} value={String(vm.id)} className="font-mono text-xs">
                                  #{vm.id} {vm.name} · {vm.namespace}
                                  {canRevealHyVm && vm.summary?.hysteria2ClusterEndpoint
                                    ? ` · ${vm.summary.hysteria2ClusterEndpoint}`
                                    : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {hysteriaCloudVms.length === 0 ? (
                            <p className="text-[11px] text-slate-500">
                              当前无带 Hysteria2 客户端的云主机，请先在「云主机」向导第 4 步启用并粘贴分享链接或填写客户端 YAML。
                            </p>
                          ) : null}
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label className="text-xs">HTTP(S) 代理 URL</Label>
                        <Input
                          value={httpProxyUrl}
                          onChange={(e) => setHttpProxyUrl(e.target.value)}
                          className="font-mono text-sm"
                          placeholder="例如 http://proxy.default.svc.cluster.local:3128"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={goPrev} disabled={step <= 1}>
                    <ChevronLeft className="h-4 w-4" />
                    上一步
                  </Button>
                  {step < 3 ? (
                    <Button type="button" size="sm" className="gap-1 bg-violet-600 hover:bg-violet-700" onClick={goNext}>
                      下一步
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={precheckMut.isPending || deployMut.isPending}
                        onClick={submitPrecheck}
                      >
                        {precheckMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {precheckMut.isPending ? "预检中…" : "立即预检"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="gap-2 bg-violet-600 hover:bg-violet-700"
                        disabled={deployMut.isPending || precheckMut.isPending}
                        onClick={submitDeploy}
                      >
                        {deployMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {deployMut.isPending ? "校验并部署中…" : "校验上游并部署到集群"}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <Sheet
        open={chatOpen}
        onOpenChange={(open) => {
          setChatOpen(open);
          if (!open) {
            setChatRow(null);
            setChatSending(false);
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full max-h-[100dvh] w-full min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <SheetHeader className="shrink-0 space-y-2 border-b border-slate-200 px-4 py-4 text-left">
            <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
              <SheetTitle className="text-base">与 OpenClaw 对话</SheetTitle>
              {chatRow ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-xs text-slate-600"
                  onClick={() => {
                    setChatMsgs([]);
                    clearOpenClawChatStorage(chatRow.id);
                    toast.success("已清空本机对话记录");
                  }}
                >
                  清空本地会话
                </Button>
              ) : null}
            </div>
            <SheetDescription className="text-xs leading-relaxed">
              {chatRow ? (
                <>
                  <span className="font-mono text-slate-700">
                    {chatRow.namespace}/{chatRow.deploymentName}
                  </span>
                  <span className="mt-1 block text-slate-500">
                    助手回复按 <strong>Markdown</strong>（含表格、列表、代码块）渲染。多轮消息保存在本浏览器{" "}
                    <span className="font-mono">localStorage</span>（按实例，最多 {OPENCLAW_CHAT_MAX_MSGS}{" "}
                    条）；换浏览器或清站点数据会丢失。当前选用模型{" "}
                    <span className="font-mono">{effectiveOpenClawChatModel(chatRow) || "（未指定）"}</span>
                    （预设 <span className="font-mono">{chatRow.modelPreset || "—"}</span>）。
                  </span>
                </>
              ) : (
                <span className="text-slate-500">经平台代连集群内 OpenClaw 网关对话。</span>
              )}
            </SheetDescription>
          </SheetHeader>
          {chatRow && !chatSheetGate.ok ? (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-950">
              <p className="font-medium">暂不可发送消息</p>
              <p className="mt-1">{chatSheetGate.reason}</p>
              {chatSheetSt?.runningGatewayImage ? (
                <p className="mt-1 font-mono text-[10px] text-amber-900/85">
                  当前 Pod 镜像：{chatSheetSt.runningGatewayImage}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-amber-900/70">
                平台登记镜像：<span className="font-mono">{chatRow.image}</span>
              </p>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={chatViewportRef}
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3"
            >
              <div className="space-y-3 pr-2">
              {chatMsgs.length === 0 ? (
                <p className="text-sm text-slate-500">
                  输入消息后发送，可与网关后的模型多轮问答（配置、排障、K8s 只读权限范围内的问题等）。
                </p>
              ) : null}
              {chatMsgs.map((m, i) => (
                <div
                  key={`${i}-${m.role}`}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words [overflow-wrap:anywhere]",
                      m.role === "user"
                        ? "bg-violet-600 text-white whitespace-pre-wrap"
                        : "border border-slate-200 bg-slate-50 text-slate-800"
                    )}
                  >
                    {m.role === "assistant" ? (
                      <OpenClawChatMarkdown source={m.content} />
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </div>
                </div>
              ))}
              {chatSending ? (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    等待网关回复…
                  </div>
                </div>
              ) : null}
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-slate-200 bg-background p-4">
            <Textarea
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
              disabled={!chatRow || chatSending || !chatSheetGate.ok}
              className="min-h-[88px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                void submitOpenClawChat();
              }}
            />
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="sm"
                className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                disabled={!chatRow?.id || chatSending || !chatDraft.trim() || !chatSheetGate.ok}
                onClick={() => void submitOpenClawChat()}
              >
                {chatSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                发送
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default AppCenterOpenClaw;

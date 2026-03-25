/**
 * 与 Go 服务同源部署时使用相对路径；本地 `vite` 开发时由 vite.config 代理 /api。
 * 如需跨域可设置 VITE_API_BASE=http://127.0.0.1:8080
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function maybeRedirectLogin(res: Response, path: string) {
  if (res.status !== 401) return;
  if (path.includes("/api/auth/login")) return;
  if (path.includes("/api/auth/status")) return;
  if (path.includes("/api/setup")) return;
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

export type SystemCheck = {
  baota: { status: string; url: string; msg: string };
  ddns: {
    status: string;
    host: string;
    ips: string[];
    msg: string;
    port443: boolean;
    httpsPort: string;
  };
  k8s: {
    metallbInstalled: boolean;
    ingressInstalled: boolean;
    nodeIP: string;
  };
};

export type SyncRoute = {
  namespace: string;
  name: string;
  domain: string;
  ddnsPort: string;
  createdAt: string;
  modifiedAt: string;
  version: string;
  scheme: string;
  status: string;
};

export type IngressRow = {
  namespace: string;
  name: string;
  hosts: string[];
  class: string;
  createdAt: string;
  managed: boolean;
};

export type SetupStatus = {
  initialized: boolean;
  dataDir: string;
  version: number;
};

export type AppConfig = {
  baotaUrl: string;
  ddnsHost: string;
  defaultPort: string;
  httpsPort: string;
  syncIntervalSec: number;
  /** 对应 BAOTA_HTTP_TIMEOUT_SEC */
  baotaHttpTimeoutSec?: number;
  /** 对应 BAOTA_TCP_PROBE_TIMEOUT_SEC（/api/system/check 仅 TCP 探活面板端口） */
  baotaTcpProbeTimeoutSec?: number;
  /** 对应 BAOTA_CHECK_MIN_INTERVAL_SEC（服务端探活缓存） */
  baotaCheckMinIntervalSec?: number;
  /** 对应 BAOTA_DISABLE_HTTP_KEEPALIVE */
  baotaDisableHttpKeepalive?: boolean;
  hasBaotaApiKey: boolean;
  /** 与 BAOTA_SKIP_TLS_VERIFY 一致，仅用于展示 */
  baotaSkipTlsVerify?: boolean;
  /** 证书夹证书名（BAOTA_SSL_CERT_NAME），用于宝塔 SetCertToSite */
  baotaSslCertName?: string;
  /** 是否启用登录（DASHBOARD_PASSWORD） */
  dashboardAuthEnabled?: boolean;
  /** 期望用户名（DASHBOARD_USER，默认 admin） */
  dashboardUser?: string;
  /** 会话天数（DASHBOARD_SESSION_DAYS） */
  dashboardSessionDays?: number;
  /** 监听地址（DASHBOARD_HTTP_ADDR，如 :8080） */
  dashboardListenAddr?: string;
  /** 是否已配置 Prometheus 地址（env 或进程内覆盖） */
  prometheusConfigured?: boolean;
  prometheusUrlHint?: string;
  prometheusTimeoutSec?: number;
  prometheusSkipTls?: boolean;
  prometheusHasBearer?: boolean;
  /** 已配置 VCENTER_URL / USER / PASSWORD */
  vcenterConfigured?: boolean;
  vcenterUrlHint?: string;
  /** 由 VCENTER_URL 解析出的 UI 根（不含 /sdk），用于拼接 wmks 静态资源 */
  vcenterUiOrigin?: string;
  /** Nginx 对外的 vSphere UI 根（VCENTER_UI_BASE_URL 或推导） */
  vcenterUiBaseUrl?: string;
  /** 典型登录入口：…/ui（先开此页完成 SSO 再开控制台） */
  vcenterUiLoginUrl?: string;
  /** 首选 wmks.min.js URL；未设 VCENTER_WMKS_SCRIPT_URL 时由服务端按 vCenter 常见路径推导 */
  vcenterWmksScriptUrl?: string;
  vcenterWmksCssUrl?: string;
  /** 多版本 vCenter 路径候选，前端可依次尝试加载 */
  vcenterWmksScriptUrlCandidates?: string[];
  vcenterWmksCssUrlCandidates?: string[];
  vcenterWmksScriptUrlFromEnv?: boolean;
  vcenterWmksCssUrlFromEnv?: boolean;
  vcenterVmSshConfigured?: boolean;
  /** 是否已写入 dataDir/runtime-config.json */
  setupInitialized?: boolean;
  /** 是否启用本地密码登录 */
  passwordLoginEnabled?: boolean;
  /** 是否配置 OIDC（Authentik 等） */
  oidcConfigured?: boolean;
  /** 持久化目录（K8s 中常挂载 PVC） */
  dataDir?: string;
  platformPublicUrl?: string;
  ingressBaotaSyncEnabled?: boolean;
  vcenterCacheTtlSec?: number;
  k8sConfigured?: boolean;
  redisConnected?: boolean;
  /** 为 true 且 Redis 可达时，runtime-config 与 platform_kv 会镜像到 Redis（无 TTL） */
  runtimeDualWriteRedis?: boolean;
  redisMirrorRuntimeKey?: string;
  redisMirrorPlatformKvKey?: string;
  mysqlDsnConfigured?: boolean;
  platformKvReady?: boolean;
};

/** 与后端 RuntimeSettings 对齐（用于设置页 PUT） */
export type RuntimeSettingsDTO = Record<string, unknown>;

/** 与 internal.AuditRecord 对齐 */
export type AuditRecord = {
  ts: string;
  action: string;
  ip?: string;
  user?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  detail?: string;
};

export type AuditLogsResponse = {
  logs: AuditRecord[];
  path: string;
};

/** GET /api/prometheus/discover */
export type PrometheusDiscoverCandidate = {
  id: string;
  namespace: string;
  name: string;
  port: number;
  portName?: string;
  baseUrl: string;
  reason: string;
};

export async function apiGetJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "same-origin" });
  maybeRedirectLogin(res, path);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${path}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGetText(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "same-origin" });
  maybeRedirectLogin(res, path);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.text();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  maybeRedirectLogin(res, path);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${path}: ${msg}`);
  }
}

export async function apiPostJson<TRes = unknown>(
  path: string,
  body: object
): Promise<TRes> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  maybeRedirectLogin(res, path);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${path}: ${msg}`);
  }
  return res.json() as Promise<TRes>;
}

export async function apiPutJson<TRes = unknown>(
  path: string,
  body: object
): Promise<TRes> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  maybeRedirectLogin(res, path);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${path}: ${msg}`);
  }
  return res.json() as Promise<TRes>;
}

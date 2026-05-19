/** 与 `internal/openclaw_gateway_health_worker.go` 默认探活间隔一致（API 未带 intervalSec 时前端展示兜底）。 */
export const OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC_DEFAULT = 600;

/** 后台巡检 JSON 中 clusterChatHttpStatus 在部分环境下可能为字符串，统一成数字再分支。 */
export function normalizeOpenClawGatewayChatHttpStatus(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isOpenClawGatewayChat404(status: unknown): boolean {
  return normalizeOpenClawGatewayChatHttpStatus(status) === 404;
}

export function isOpenClawGatewayChat5xx(status: unknown): boolean {
  const s = normalizeOpenClawGatewayChatHttpStatus(status);
  return s != null && s >= 500 && s < 600;
}

/** 巡检项中与后端 OpenClawGatewayHealthItem 对齐的字段子集 */
export type OpenClawGatewayHealthItemLike = {
  id: string;
  displayName?: string;
  namespace?: string;
  deploymentName?: string;
};

/**
 * 告警/列表里标明「是哪一套 OpenClaw」：列表显示名（或 Deployment）、K8s 位置、平台登记 id。
 */
export function formatOpenClawGatewayHealthInstanceLine(x: OpenClawGatewayHealthItemLike): string {
  const id = (x.id ?? "").trim() || "—";
  const dn = (x.displayName ?? "").trim();
  const dep = (x.deploymentName ?? "").trim();
  const ns = (x.namespace ?? "").trim();
  const title = dn || dep || id;
  const k8s = ns && dep ? `${ns}/${dep}` : ns || dep || "";
  if (k8s) {
    return `所属 OpenClaw：「${title}」· 集群 ${k8s} · 平台实例 id ${id}`;
  }
  return `所属 OpenClaw：「${title}」· 平台实例 id ${id}`;
}

/** 探活失败文案：压缩空白，限制长度（后端已用【标签】概括类型） */
export function formatOpenClawClusterChatProbeSnippet(raw: string, maxLen = 320): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "失败";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trimEnd()}…`;
}

/** 是否未拿到 HTTP 状态码（后端 omitempty 时 0 不会出现在 JSON，表现为 undefined） */
export function isOpenClawGatewayChatNoHttpStatus(status: unknown): boolean {
  if (status === null || status === undefined) return true;
  if (typeof status === "number" && Number.isFinite(status) && status === 0) return true;
  return false;
}

import React, { useEffect, useState } from "react";
import { useAppConfig } from "@/hooks/use-app-config";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { apiGetJson, apiPostJson, type AuditLogsResponse } from "@/lib/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { formatAuditTime, formatAuditTitle } from "@/lib/audit-display";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { OpenClawChat404RemedyPanel } from "@/components/OpenClawChat404Remedy";
import { OpenClawChatMarkdown } from "@/components/OpenClawChatMarkdown";
import { formatDateTimeShanghai } from "@/lib/datetime-cn";
import {
  formatOpenClawClusterChatProbeSnippet,
  formatOpenClawGatewayHealthInstanceLine,
  isOpenClawGatewayChatNoHttpStatus,
  OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC_DEFAULT,
} from "@/lib/openclaw-gateway-health";
import { menuItemVisible, moduleVisible } from "@/lib/platform-permissions";

type HostEgressNotification = {
  checkEnabled: boolean;
  currentIp: string;
  previousIp?: string;
  lastChangeAt?: string;
  lastCheckedAt?: string;
  unreadChange: boolean;
  securityLoginUnread?: boolean;
  securityLoginMessage?: string;
  securityLoginLastAt?: string;
  remoteLoginUnread?: boolean;
  remoteLoginMessage?: string;
  remoteLoginLastAt?: string;
  remoteLoginUser?: string;
  remoteLoginPreviousIp?: string;
  remoteLoginCurrentIp?: string;
  adminIpBanUnread?: boolean;
  adminIpBanMessage?: string;
  adminIpBanLastAt?: string;
  adminIpBanSourceIp?: string;
  adminIpBanUntil?: string;
};

type CloudVmSshSecurityEvent = {
  ts: string;
  namespace: string;
  podName: string;
  platformUser: string;
  sshUser: string;
  visitorIp: string;
  platformIp: string;
  message: string;
};

type OpenClawGwHealthItem = {
  id: string;
  displayName?: string;
  namespace?: string;
  deploymentName?: string;
  skipped?: boolean;
  skipReason?: string;
  k8sPhase?: string;
  clusterChatOk?: boolean;
  clusterChatMessage?: string;
  clusterChatHttpStatus?: number;
  httpProbeOk?: boolean;
  httpProbeMessage?: string;
};

/** 铃铛 + 右侧通知 Sheet（从 Header 拆出以控制单文件体积） */
const HeaderNotificationsSheet: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { status } = useAuth();
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [sshEventsReadTs, setSshEventsReadTs] = useState("");

  const cfgQ = useAppConfig();
  const cfg = cfgQ.data;
  const perm = cfg?.permissions;
  const navRole = status?.role;
  const isViewer = cfg?.dashboardRole === "viewer" || cfg?.viewer === true;
  const headerShowApp = menuItemVisible(perm, "appcenter", navRole, moduleVisible(perm, "appcenter"));
  const headerShowAiInspect = menuItemVisible(perm, "aiInspect", navRole, true);
  const showPlatformUsers =
    !isViewer && (status?.role === "admin" || cfg?.dashboardRole === "admin");

  const egressQ = useQuery({
    queryKey: ["host-egress-notification"],
    queryFn: ({ signal }) => apiGetJson<HostEgressNotification>("/api/host/egress-notification", { signal }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const securityLoginReadMut = useMutation({
    mutationFn: () => apiPostJson("/api/host/security-login-alert/read", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["host-egress-notification"] }),
  });
  const remoteLoginReadMut = useMutation({
    mutationFn: () => apiPostJson("/api/host/remote-login-alert/read", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["host-egress-notification"] }),
  });
  const adminIpBanReadMut = useMutation({
    mutationFn: () => apiPostJson("/api/host/admin-ip-ban-alert/read", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["host-egress-notification"] }),
  });

  const sshSecQ = useQuery({
    queryKey: ["cloud-vm-ssh-security-events"],
    queryFn: ({ signal }) =>
      apiGetJson<{ events: CloudVmSshSecurityEvent[] }>("/api/app-center/cloud-vm/ssh-security-events", {
        signal,
      }),
    enabled: Boolean(status?.loggedIn),
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  const openclawGwHealthQ = useQuery({
    queryKey: ["openclaw-gateway-service-health"],
    queryFn: ({ signal }) =>
      apiGetJson<{
        enabled?: boolean;
        workerDisabled?: boolean;
        lastCheckAt?: string;
        bellUnread?: boolean;
        items?: OpenClawGwHealthItem[];
        intervalSec?: number;
        healthChatTimeoutSec?: number;
      }>("/api/app-center/openclaw/gateway-service-health", { signal }),
    enabled: Boolean(status?.loggedIn) && (headerShowApp || headerShowAiInspect),
    refetchInterval: 90_000,
    staleTime: 45_000,
  });

  const openclawGwHealthReadMut = useMutation({
    mutationFn: () => apiPostJson("/api/app-center/openclaw/gateway-service-health/read", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["openclaw-gateway-service-health"] }),
  });

  const clusterAdvisoryQ = useQuery({
    queryKey: ["ops-cluster-advisory"],
    queryFn: ({ signal }) =>
      apiGetJson<{
        ok?: boolean;
        runId?: string;
        updatedAt?: string;
        rating?: string;
        markdown?: string;
        runError?: string;
        bellActive?: boolean;
      }>("/api/ops/cluster-advisory", { signal }),
    enabled: Boolean(status?.loggedIn) && headerShowAiInspect,
    refetchInterval: 90_000,
    staleTime: 45_000,
  });

  const clusterAdvisoryBellReadMut = useMutation({
    mutationFn: () => apiPostJson("/api/ops/cluster-advisory/dismiss-bell", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ops-cluster-advisory"] }),
  });

  const openclawGwHealthFailing =
    openclawGwHealthQ.data?.items?.filter((x) => !x.skipped && x.clusterChatOk === false) ?? [];
  const openclawGwHealthAny404 = openclawGwHealthFailing.some((x) => x.clusterChatHttpStatus === 404);
  const openclawGwHealthAllProbedOk =
    (openclawGwHealthQ.data?.items ?? []).length === 0 ||
    (openclawGwHealthQ.data?.items ?? []).every((x) => x.skipped || x.clusterChatOk === true);
  const openclawGwBellForUi =
    openclawGwHealthFailing.length > 0 ||
    (Boolean(openclawGwHealthQ.data?.bellUnread) && !openclawGwHealthAllProbedOk);

  useEffect(() => {
    setSshEventsReadTs(localStorage.getItem("kubebt-ssh-events-read-ts") || "");
  }, []);

  useEffect(() => {
    if (!notifyOpen) return;
    const first = sshSecQ.data?.events?.[0]?.ts;
    if (first) {
      localStorage.setItem("kubebt-ssh-events-read-ts", first);
      setSshEventsReadTs(first);
    }
  }, [notifyOpen, sshSecQ.data?.events]);

  const auditBellQ = useQuery({
    queryKey: ["audit-logs-bell"],
    queryFn: ({ signal }) => apiGetJson<AuditLogsResponse>("/api/audit/logs?limit=8", { signal }),
    enabled: notifyOpen && showPlatformUsers,
    staleTime: 20_000,
  });

  const egress = egressQ.data;
  const sshEvents = sshSecQ.data?.events ?? [];
  const sshBellUnread =
    sshEvents.length > 0 &&
    (!sshEventsReadTs || (sshEvents[0]?.ts && sshEvents[0].ts > sshEventsReadTs));

  const clusterAdvisoryBell =
    headerShowAiInspect &&
    Boolean(clusterAdvisoryQ.data?.bellActive) &&
    String(clusterAdvisoryQ.data?.rating || "").toLowerCase() === "critical";

  const bellHasUnread =
    (showPlatformUsers && Boolean(egress?.securityLoginUnread)) ||
    (showPlatformUsers && Boolean(egress?.remoteLoginUnread)) ||
    (showPlatformUsers && Boolean(egress?.adminIpBanUnread)) ||
    sshBellUnread ||
    openclawGwBellForUi ||
    clusterAdvisoryBell;

  return (
    <Sheet open={notifyOpen} onOpenChange={setNotifyOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative flex size-11 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="通知"
        >
          <Bell size={22} />
          {bellHasUnread ? (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"
              aria-hidden
            />
          ) : null}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>通知</SheetTitle>
          <p className="text-left text-xs text-muted-foreground">
            安全与登录摘要、应用中心 SSH 异常；出口 IP 摘要见下方（若已启用探测）。完整记录见「平台审计」。
          </p>
        </SheetHeader>
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
          {sshEvents.length > 0 ? (
            <div className="shrink-0 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm">
              <p className="font-medium text-amber-950">应用中心 · 云主机 SSH 密码失败</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
                以下记录为进程内缓存，服务重启后清空。含命名空间、Pod、平台用户、访问 IP、平台侧 IP。
              </p>
              <ul className="mt-2 max-h-[220px] space-y-2 overflow-y-auto text-[11px] leading-relaxed text-amber-950">
                {sshEvents.slice(0, 30).map((ev, i) => (
                  <li key={`${ev.ts}-${i}`} className="rounded-lg border border-amber-200/80 bg-white/80 px-2 py-1.5 font-mono">
                    <span className="text-slate-500">{new Date(ev.ts).toLocaleString()}</span>
                    <br />
                    ns {ev.namespace} · Pod {ev.podName || "—"}
                    <br />
                    平台用户 {ev.platformUser} · SSH {ev.sshUser} · 访问 {ev.visitorIp || "—"} · 平台{" "}
                    {ev.platformIp || "—"}
                    <br />
                    <span className="text-slate-700">{ev.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(headerShowApp || headerShowAiInspect) && openclawGwBellForUi ? (
            <div className="shrink-0 rounded-xl border border-violet-300 bg-violet-50 px-3 py-3 text-sm shadow-sm">
              <p className="font-semibold text-violet-950">OpenClaw 网关服务探活</p>
              <p className="mt-1 text-xs leading-relaxed text-violet-900/90">
                极简补全探活（与「对话」、AI 巡检同源）。列表里<strong>下一行即原因概括</strong>：
                <span className="font-mono">404</span>
                →路由；<span className="font-mono">5xx</span>→上游；无 HTTP→连接层；超时→可调{" "}
                <span className="font-mono">KUBEBT_OPENCLAW_GATEWAY_HEALTH_CHAT_TIMEOUT_SEC</span>（约{" "}
                {openclawGwHealthQ.data?.healthChatTimeoutSec ?? 90}s）。
              </p>
              {openclawGwHealthQ.data?.workerDisabled ? (
                <p className="mt-2 text-xs text-amber-900">
                  当前已设置 <span className="font-mono">KUBEBT_OPENCLAW_GATEWAY_HEALTH_DISABLED</span>
                  ，后台巡检已关闭；以下为进程内最后一次快照（若有）。
                </p>
              ) : null}
              {openclawGwHealthQ.data?.lastCheckAt ? (
                <p className="mt-2 text-[11px] text-violet-800/80">
                  最近巡检：{formatDateTimeShanghai(openclawGwHealthQ.data.lastCheckAt)}（UTC：{" "}
                  <span className="font-mono">{openclawGwHealthQ.data.lastCheckAt}</span>，约每{" "}
                  {openclawGwHealthQ.data.intervalSec ?? OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC_DEFAULT}s）
                </p>
              ) : (
                <p className="mt-2 text-xs text-violet-800/80">尚未完成首次巡检（启动约 20s 后跑第一次）。</p>
              )}
              <ul className="mt-2 max-h-[200px] space-y-2 overflow-y-auto text-[11px] leading-relaxed text-violet-950">
                {(openclawGwHealthFailing.length > 0
                  ? openclawGwHealthFailing
                  : (openclawGwHealthQ.data?.items ?? []).filter((x) => !x.skipped)
                ).map((x) => (
                  <li key={x.id} className="rounded-lg border border-violet-200/80 bg-white/90 px-2 py-1.5">
                    <span className="block font-sans text-[11px] font-semibold leading-snug text-slate-900">
                      {formatOpenClawGatewayHealthInstanceLine(x)}
                    </span>
                    {x.clusterChatOk === false ? (
                      <>
                        <br />
                        <span className="text-[10px] font-semibold leading-snug text-red-800">
                          {isOpenClawGatewayChatNoHttpStatus(x.clusterChatHttpStatus)
                            ? "无 HTTP · 传输/连接"
                            : `HTTP ${x.clusterChatHttpStatus}`}{" "}
                          · {formatOpenClawClusterChatProbeSnippet(x.clusterChatMessage || "失败", 300)}
                        </span>
                      </>
                    ) : (
                      <>
                        <br />
                        <span className="font-sans text-[10px] text-emerald-800">chat 探活正常</span>
                      </>
                    )}
                    {x.k8sPhase ? (
                      <>
                        <br />
                        <span className="text-slate-600">K8s 阶段：{x.k8sPhase}</span>
                      </>
                    ) : null}
                    {x.clusterChatOk === false ? (
                      <>
                        <br />
                        <Link
                          to={`/cluster/apps/openclaw/${encodeURIComponent(x.id)}`}
                          className="text-violet-700 underline-offset-2 hover:underline"
                        >
                          打开实例详情（编辑 openclaw.json）
                        </Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              {openclawGwHealthAny404 ? <OpenClawChat404RemedyPanel variant="violet" className="mt-3" /> : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 h-8 border-violet-200"
                disabled={openclawGwHealthReadMut.isPending}
                onClick={() => void openclawGwHealthReadMut.mutateAsync()}
              >
                已知晓（清除铃铛）
              </Button>
              <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0 text-xs" asChild>
                <Link to="/cluster/apps/openclaw">前往 OpenClaw 列表</Link>
              </Button>
            </div>
          ) : null}

          {headerShowAiInspect &&
          (clusterAdvisoryQ.data?.markdown ||
            clusterAdvisoryQ.data?.runError ||
            (clusterAdvisoryQ.data?.rating && clusterAdvisoryQ.data.rating !== "ok")) ? (
            <div className="shrink-0 rounded-xl border border-rose-300/90 bg-rose-50/95 px-3 py-3 text-sm shadow-sm">
              <p className="font-semibold text-rose-950">K8s 控制平面 · 周期 AI 建议</p>
              <p className="mt-1 text-[11px] leading-relaxed text-rose-900/90">
                后台约每 30 分钟抓取 <span className="font-mono">kube-system</span> 关键组件日志并由巡检 OpenClaw 汇总；与 VictoriaLogs
                明细互补。完整内容与确认见「AI 巡检 → 总览」。
              </p>
              {clusterAdvisoryQ.data?.updatedAt ? (
                <p className="mt-1 font-mono text-[10px] text-rose-800/80">
                  更新 {formatDateTimeShanghai(clusterAdvisoryQ.data.updatedAt)} · 评级{" "}
                  <span className="font-semibold uppercase">{clusterAdvisoryQ.data.rating || "—"}</span>
                </p>
              ) : null}
              {clusterAdvisoryQ.data?.runError ? (
                <p className="mt-2 text-xs text-red-800">{clusterAdvisoryQ.data.runError}</p>
              ) : null}
              {clusterAdvisoryQ.data?.markdown ? (
                <div className="mt-2 max-h-[220px] overflow-y-auto rounded-md border border-rose-200/80 bg-white/90 px-2 py-2 text-[11px] leading-relaxed text-slate-900">
                  <OpenClawChatMarkdown source={clusterAdvisoryQ.data.markdown} />
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" className="h-8 border-rose-200" asChild>
                  <Link to="/cluster/ai-inspect/dashboard">打开 AI 巡检总览</Link>
                </Button>
                {clusterAdvisoryBell ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-rose-300"
                    disabled={clusterAdvisoryBellReadMut.isPending}
                    onClick={() => void clusterAdvisoryBellReadMut.mutateAsync()}
                  >
                    已读（清除严重告警铃铛）
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showPlatformUsers && egress?.remoteLoginUnread ? (
            <div className="shrink-0 rounded-xl border border-red-300 bg-red-50 px-3 py-3 text-sm shadow-sm">
              <p className="font-semibold text-red-950">异地登录提醒</p>
              <p className="mt-1 text-xs leading-relaxed text-red-900">
                {egress.remoteLoginMessage?.trim() ||
                  `用户 ${egress.remoteLoginUser || "—"} 本次 IP 与上次成功登录不一致。`}
              </p>
              <div className="mt-2 space-y-0.5 font-mono text-[11px] text-red-950/90">
                <p>
                  上次：<span className="text-red-950">{egress.remoteLoginPreviousIp || "—"}</span>
                </p>
                <p>
                  本次：<span className="text-red-950">{egress.remoteLoginCurrentIp || "—"}</span>
                </p>
              </div>
              {egress.remoteLoginLastAt ? (
                <p className="mt-1 text-[11px] text-red-800/90">
                  {new Date(egress.remoteLoginLastAt).toLocaleString()}
                </p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 h-8 border-red-200"
                disabled={remoteLoginReadMut.isPending}
                onClick={() => void remoteLoginReadMut.mutateAsync()}
              >
                已知晓
              </Button>
            </div>
          ) : null}

          {showPlatformUsers && egress?.securityLoginUnread ? (
            <div className="shrink-0 rounded-xl border border-red-200 bg-red-50/90 px-3 py-3 text-sm">
              <p className="font-medium text-red-950">登录暴力尝试告警</p>
              <p className="mt-1 text-xs leading-relaxed text-red-900">
                {egress.securityLoginMessage?.trim() || "同一 IP 多次登录失败，请关注。"}
              </p>
              {egress.securityLoginLastAt ? (
                <p className="mt-1 text-[11px] text-red-800/80">
                  {new Date(egress.securityLoginLastAt).toLocaleString()}
                </p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 h-8"
                disabled={securityLoginReadMut.isPending}
                onClick={() => void securityLoginReadMut.mutateAsync()}
              >
                知道了
              </Button>
            </div>
          ) : null}

          {showPlatformUsers && egress?.adminIpBanUnread ? (
            <div className="shrink-0 rounded-xl border border-orange-300 bg-orange-50 px-3 py-3 text-sm">
              <p className="font-medium text-orange-950">admin 密码封禁 IP</p>
              <p className="mt-1 text-xs leading-relaxed text-orange-950">
                {egress.adminIpBanMessage?.trim() || "某 IP 因连续错误密码已被临时禁止登录。"}
              </p>
              {egress.adminIpBanUntil ? (
                <p className="mt-1 font-mono text-[11px] text-orange-900">
                  解禁不早于 {new Date(egress.adminIpBanUntil).toLocaleString()}
                </p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 h-8"
                disabled={adminIpBanReadMut.isPending}
                onClick={() => void adminIpBanReadMut.mutateAsync()}
              >
                知道了
              </Button>
            </div>
          ) : null}

          {showPlatformUsers ? (
            <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm">
              <p className="font-medium text-slate-900">平台审计</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                最近几条操作与下方「打开平台审计」全量联动（同一数据源）。
              </p>
              {auditBellQ.isLoading ? (
                <p className="mt-2 text-xs text-slate-500">加载最近记录…</p>
              ) : auditBellQ.isError ? (
                <p className="mt-2 text-xs text-red-600">{extractErrorMessage(auditBellQ.error)}</p>
              ) : auditBellQ.data && auditBellQ.data.logs.length > 0 ? (
                <ul className="mt-2 max-h-[200px] space-y-2 overflow-y-auto text-[11px] leading-snug">
                  {[...auditBellQ.data.logs].reverse().map((row, i) => (
                    <li key={`${row.ts}-${i}`} className="rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-1.5">
                      <span className="font-medium text-slate-900">{formatAuditTitle(row)}</span>
                      {row.detail ? <span className="mt-0.5 block text-slate-600">{row.detail}</span> : null}
                      <span className="mt-1 block text-slate-500">
                        {formatAuditTime(row.ts)}
                        {row.user ? ` · ${row.user}` : ""}
                        {row.ip ? ` · ${row.ip}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-500">暂无审计记录</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setNotifyOpen(false);
                    navigate("/account/audit");
                  }}
                >
                  打开平台审计
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setNotifyOpen(false);
                    navigate("/account/site-stats");
                  }}
                >
                  站点统计
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default HeaderNotificationsSheet;

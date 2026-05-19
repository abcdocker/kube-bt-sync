import React, { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  HardDrive,
  Loader2,
  RefreshCw,
  ScrollText,
  Settings2,
  Server,
  Sparkles,
} from "lucide-react";
import { apiGetJson, apiPostJson } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OpenClawChatMarkdown } from "@/components/OpenClawChatMarkdown";
import {
  formatLocalDateTime,
  type LogHealthStatus,
  type LogOverviewScope,
  type LogPriority,
  type VmLogOverviewItem,
  type VmLogOverviewRes,
  type VmLogStatus,
  VM_LOG_REFRESH_OPTIONS,
  VM_LOG_WINDOW_OPTIONS_ALL,
} from "./aiInspectLogs.model";

function statusLabel(status: LogHealthStatus): string {
  switch (status) {
    case "fail":
      return "异常";
    case "warn":
      return "告警";
    case "ok":
      return "正常";
    default:
      return "跳过";
  }
}

function priorityLabel(priority: LogPriority): string {
  switch (priority) {
    case "high":
      return "高优先级";
    case "medium":
      return "中优先级";
    case "low":
      return "低优先级";
    default:
      return "无需优先处理";
  }
}

function statusBadgeClass(status: LogHealthStatus): string {
  switch (status) {
    case "fail":
      return "border-red-200 bg-red-50 text-red-800";
    case "warn":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function priorityBadgeClass(priority: LogPriority): string {
  switch (priority) {
    case "high":
      return "border-red-200 bg-red-50 text-red-800";
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "low":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function scopeIcon(scope: LogOverviewScope) {
  switch (scope) {
    case "project_config":
      return <Settings2 className="h-4 w-4 text-cyan-600" />;
    case "pod":
      return <Server className="h-4 w-4 text-violet-600" />;
    case "nginx":
      return <ScrollText className="h-4 w-4 text-amber-600" />;
    default:
      return <HardDrive className="h-4 w-4 text-slate-600" />;
  }
}

function OverviewItemCard({
  item,
  onOpen,
}: {
  item: VmLogOverviewItem;
  onOpen: (scope: LogOverviewScope) => void;
}) {
  return (
    <Card className="border-slate-200/80 bg-white/95">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {scopeIcon(item.scope)}
              {item.label}
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">{item.priorityReason || "—"}</CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="outline" className={statusBadgeClass(item.status)}>
              {statusLabel(item.status)}
            </Badge>
            <Badge variant="outline" className={priorityBadgeClass(item.priority)}>
              {priorityLabel(item.priority)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] text-slate-500">匹配总数</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{item.totalCount.toLocaleString("zh-CN")}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] text-slate-500">错误数</p>
            <p className="mt-1 text-lg font-semibold text-red-700">{item.errorCount.toLocaleString("zh-CN")}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] text-slate-500">告警数</p>
            <p className="mt-1 text-lg font-semibold text-amber-700">{item.warnCount.toLocaleString("zh-CN")}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] text-slate-500">最近时间</p>
            <p className="mt-1 text-xs font-medium text-slate-800">{formatLocalDateTime(item.lastSeenAt || null)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">{item.hasError ? "当前范围存在需优先处理的异常日志。" : "当前范围未命中错误日志。"}</p>
          <Button type="button" size="sm" onClick={() => onOpen(item.scope)}>
            查看详情
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const AiInspectLogs: React.FC = () => {
  const navigate = useNavigate();
  const [windowMin, setWindowMin] = useState(1440);
  const [refreshSec, setRefreshSec] = useState(30);

  const statusQ = useQuery({
    queryKey: ["ops-vmlog-status"],
    queryFn: ({ signal }) => apiGetJson<VmLogStatus>("/api/ops/vmlog/status", { signal }),
  });

  const maxWindowMin = statusQ.data?.maxWindowMinutes ?? 180 * 24 * 60;
  const windowOptions = useMemo(() => {
    const opts = VM_LOG_WINDOW_OPTIONS_ALL.filter((o) => o.m <= maxWindowMin);
    if (opts.length > 0) return opts;
    const m = Math.max(15, maxWindowMin);
    return [{ m, label: `最近 ${m} 分钟` }];
  }, [maxWindowMin]);

  const overviewBody = useMemo(
    () => ({
      windowMinutes: windowMin > maxWindowMin ? maxWindowMin : windowMin,
      fetchLimit: windowMin >= 10080 ? 10000 : 6000,
    }),
    [maxWindowMin, windowMin]
  );

  const overviewQ = useQuery({
    queryKey: ["ops-vmlog-overview", overviewBody],
    queryFn: ({ signal }) => apiPostJson<VmLogOverviewRes>("/api/ops/vmlog/overview", overviewBody, { signal }),
    refetchInterval: refreshSec > 0 ? refreshSec * 1000 : false,
    refetchOnWindowFocus: true,
  });

  const clusterAdvisoryQ = useQuery({
    queryKey: ["ops-cluster-advisory"],
    queryFn: ({ signal }) =>
      apiGetJson<{ rating?: string; markdown?: string; runError?: string; updatedAt?: string }>(
        "/api/ops/cluster-advisory",
        { signal }
      ),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const openDetail = useCallback(
    (scope: LogOverviewScope) => {
      const qs = new URLSearchParams({ tab: scope, window: String(windowMin), page: "1" });
      navigate(`/cluster/ai-inspect/logs/detail?${qs.toString()}`);
    },
    [navigate, windowMin]
  );

  const onManualRefresh = useCallback(() => {
    void statusQ.refetch();
    void overviewQ.refetch();
  }, [overviewQ, statusQ]);

  const st = statusQ.data;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-cyan-200/80 bg-gradient-to-br from-cyan-50/90 via-white to-slate-50/80 px-6 py-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-900/80">AI 巡检 · 日志总览</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <ScrollText className="h-7 w-7 text-cyan-600" />
          VictoriaLogs 状态总览
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          在一个页面汇总项目配置、Pod、Nginx 与平台日志的状态、错误信号与处理优先级；点击任一范围进入分页明细与配置详情页。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="border-cyan-200 bg-white/90" asChild>
            <a href={st?.docsUrl || "https://docs.victoriametrics.com/victorialogs/"} target="_blank" rel="noreferrer">
              <BookOpen className="mr-1.5 h-4 w-4" />
              官方文档
            </a>
          </Button>
          <Button type="button" variant="outline" size="sm" className="border-cyan-200 bg-white/90" asChild>
            <a href={st?.helmChartsUrl || "https://github.com/VictoriaMetrics/helm-charts"} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Helm Charts
            </a>
          </Button>
          <Button type="button" variant="outline" size="sm" className="border-cyan-200 bg-white/90" asChild>
            <Link to="/cluster/settings">Cluster Settings（VictoriaLogs）</Link>
          </Button>
          <Button type="button" variant="outline" size="sm" className="border-cyan-200 bg-white/90" asChild>
            <Link to="/cluster/ai-inspect/log-collection" className="inline-flex items-center gap-1.5">
              <HardDrive className="h-4 w-4" />
              日志采集（Vector 助手）
            </Link>
          </Button>
        </div>
      </div>

      <Card className="border-violet-200/80 bg-gradient-to-br from-violet-50/50 via-white to-slate-50/80">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-violet-600" />
            AI 建议 · 控制平面（kube-system）
          </CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            与下方 VictoriaLogs 总览互补：平台周期抓取 apiserver/etcd 等日志并由 OpenClaw 输出集群级建议。完整内容、确认与铃铛在「AI 巡检
            → Dashboard」。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {clusterAdvisoryQ.data?.updatedAt ? <span className="font-mono">更新 {clusterAdvisoryQ.data.updatedAt}</span> : null}
            {clusterAdvisoryQ.data?.rating ? (
              <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold uppercase">
                {clusterAdvisoryQ.data.rating}
              </span>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="h-8" asChild>
              <Link to="/cluster/ai-inspect/dashboard">打开 Dashboard 总建议</Link>
            </Button>
          </div>
          {clusterAdvisoryQ.data?.runError ? (
            <p className="text-xs text-amber-800">{clusterAdvisoryQ.data.runError}</p>
          ) : null}
          {clusterAdvisoryQ.data?.markdown ? (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-[12px] leading-relaxed">
              <OpenClawChatMarkdown source={clusterAdvisoryQ.data.markdown} />
            </div>
          ) : (
            <p className="text-xs text-slate-500">尚无周期分析结果；请确认后台任务节点已启用且 AI 巡检 OpenClaw 已配置。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">查询窗口与刷新</CardTitle>
          <CardDescription>总览页会按当前时间窗评估 4 个范围的健康状态与优先级。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-700">时间范围</p>
              <Select value={String(windowMin)} onValueChange={(v) => setWindowMin(Number(v))}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {windowOptions.map((o) => (
                    <SelectItem key={o.m} value={String(o.m)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-700">自动刷新</p>
              <Select value={String(refreshSec)} onValueChange={(v) => setRefreshSec(Number(v))}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VM_LOG_REFRESH_OPTIONS.map((o) => (
                    <SelectItem key={o.sec} value={String(o.sec)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="button" variant="secondary" size="sm" disabled={overviewQ.isFetching} onClick={onManualRefresh}>
                {overviewQ.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                立即刷新
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Badge variant="outline" className={cn("border-slate-200 bg-slate-50 text-slate-700", st?.configured ? "" : "border-amber-200 bg-amber-50 text-amber-800")}>
              {st?.configured ? "VictoriaLogs 已配置" : "VictoriaLogs 未配置"}
            </Badge>
            {st?.configured && st.baseUrlHint ? <span className="font-mono">{st.baseUrlHint}</span> : null}
            {overviewQ.data?.refreshedAt ? <span>刷新于 {formatLocalDateTime(overviewQ.data.refreshedAt)}</span> : null}
            {overviewQ.data?.totalFetched != null ? <span>本次扫描 {overviewQ.data.totalFetched.toLocaleString("zh-CN")} 条</span> : null}
          </div>
        </CardContent>
      </Card>

      {overviewQ.isError ? (
        <Card className="border-red-200 bg-red-50/70">
          <CardContent className="py-6 text-sm text-red-700">{(overviewQ.error as Error).message}</CardContent>
        </Card>
      ) : overviewQ.isLoading && !overviewQ.data ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载日志总览…
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {(overviewQ.data?.items ?? []).map((item) => (
            <OverviewItemCard key={item.scope} item={item} onOpen={openDetail} />
          ))}
        </div>
      )}

      {overviewQ.data?.scanWarning || overviewQ.data?.truncated ? (
        <Card className="border-amber-200/80 bg-amber-50/70">
          <CardContent className="py-4 text-xs text-amber-900">
            {overviewQ.data.scanWarning ? `解析警告：${overviewQ.data.scanWarning}` : null}
            {overviewQ.data.scanWarning && overviewQ.data.truncated ? " · " : null}
            {overviewQ.data.truncated ? "查询结果达到当前拉取上限，概览可能为部分样本。" : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default AiInspectLogs;

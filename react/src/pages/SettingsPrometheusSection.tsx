import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  apiGetJson,
  apiPostJson,
  apiPutJson,
  type AppConfig,
  type PrometheusDiscoverCandidate,
} from "@/lib/api";

type PromStatus = {
  configured: boolean;
  urlHint: string;
  sourceEnv: boolean;
  sourceOverride: boolean;
};

type SettingsPrometheusSectionProps = {
  locale?: "zh" | "en";
};

const SettingsPrometheusSection: React.FC<SettingsPrometheusSectionProps> = ({
  locale = "zh",
}) => {
  const en = locale === "en";
  const queryClient = useQueryClient();
  const [promBase, setPromBase] = useState("");
  const [selectedDiscoverId, setSelectedDiscoverId] = useState<string>("");
  const [discoverScanDone, setDiscoverScanDone] = useState(false);
  const [promql, setPromql] = useState('up{job=~"kube-apiserver|apiserver"}');
  const [promResult, setPromResult] = useState<string | null>(null);
  const [promLoading, setPromLoading] = useState(false);
  const [promErr, setPromErr] = useState<string | null>(null);

  const cfgQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });

  const promStatusQ = useQuery({
    queryKey: ["prometheus-status"],
    queryFn: () => apiGetJson<PromStatus>("/api/prometheus/status"),
  });

  const discoverQ = useQuery({
    queryKey: ["prometheus-discover"],
    queryFn: () =>
      apiGetJson<{ candidates: PrometheusDiscoverCandidate[] }>("/api/prometheus/discover"),
    enabled: false,
  });

  const cfg = cfgQ.data;
  const k8sOk = cfg?.k8sConfigured === true;

  const runPrometheus = async (q?: string) => {
    const query = (q ?? promql).trim();
    if (!query) return;
    setPromLoading(true);
    setPromErr(null);
    setPromResult(null);
    try {
      const data = await apiGetJson<unknown>(
        `/api/prometheus/query?q=${encodeURIComponent(query)}`
      );
      setPromResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setPromErr((e as Error).message);
    } finally {
      setPromLoading(false);
    }
  };

  const savePrometheus = async () => {
    try {
      await apiPostJson("/api/prometheus/source", { baseUrl: promBase.trim() });
      setPromBase("");
      setSelectedDiscoverId("");
      void queryClient.invalidateQueries({ queryKey: ["prometheus-status"] });
      void queryClient.invalidateQueries({ queryKey: ["app-config"] });
      void queryClient.invalidateQueries({ queryKey: ["cluster-prometheus-snapshot"] });
      setPromErr(null);
    } catch (e) {
      setPromErr((e as Error).message);
    }
  };

  const persistPrometheusToRuntime = async () => {
    const url = promBase.trim();
    if (!url) return;
    try {
      const cur = await apiGetJson<Record<string, unknown>>("/api/settings/runtime");
      await apiPutJson("/api/settings/runtime", { ...cur, prometheusUrl: url });
      await apiPostJson("/api/prometheus/source", { baseUrl: url });
      void queryClient.invalidateQueries({ queryKey: ["prometheus-status"] });
      void queryClient.invalidateQueries({ queryKey: ["app-config"] });
      void queryClient.invalidateQueries({ queryKey: ["cluster-prometheus-snapshot"] });
      setPromErr(null);
    } catch (e) {
      setPromErr((e as Error).message);
    }
  };

  const clearPrometheus = async () => {
    try {
      await apiPostJson("/api/prometheus/source", { baseUrl: "" });
      void queryClient.invalidateQueries({ queryKey: ["prometheus-status"] });
      void queryClient.invalidateQueries({ queryKey: ["app-config"] });
    } catch (e) {
      setPromErr((e as Error).message);
    }
  };

  const runDiscover = () => {
    void discoverQ.refetch().then((res) => {
      setDiscoverScanDone(true);
      const first = res.data?.candidates?.[0];
      if (first) {
        setSelectedDiscoverId(first.id);
        setPromBase(first.baseUrl);
      } else {
        setSelectedDiscoverId("");
      }
    });
  };

  const presets = useMemo(
    () => [
      {
        label: en ? "up (targets)" : "up（组件存活）",
        q: "up",
      },
      {
        label: en ? "kube-apiserver request rate" : "kube-apiserver 请求速率",
        q: "sum(rate(apiserver_request_total[5m]))",
      },
      { label: "etcd leader", q: "etcd_server_has_leader" },
      {
        label: en ? "Pods by phase" : "Pod 按阶段",
        q: "sum by (phase) (kube_pod_status_phase)",
      },
      {
        label: en ? "Node Ready" : "Node Ready",
        q: 'kube_node_status_condition{condition="Ready",status="true"}',
      },
    ],
    [en]
  );

  const candidates = discoverQ.data?.candidates ?? [];

  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <h2 className="text-base font-bold text-gray-900">
          {en ? "Monitoring (Prometheus)" : "监控（Prometheus）"}
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          {en ? (
            <>
              Queries go through the backend. Base URL can be set via{" "}
              <code className="text-[11px]">PROMETHEUS_*</code> env or override below.
            </>
          ) : (
            <>
              经后端代理查询 Prometheus；地址可通过环境变量或下方覆盖（与上方 README 表中{" "}
              <code className="text-[11px]">PROMETHEUS_*</code> 一致）。
            </>
          )}
        </p>
      </div>
      <div className="space-y-6 p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{en ? "Prometheus endpoint" : "Prometheus 数据源"}</CardTitle>
              <CardDescription>
                {en ? (
                  <>
                    <code className="text-xs">PROMETHEUS_URL</code> from env takes precedence; you can
                    override for this process (may be lost on restart unless persisted).
                  </>
                ) : (
                  <>
                    环境变量 <code className="text-xs">PROMETHEUS_URL</code> 优先；此处可覆盖当前进程（重启后需重填或写
                    env）。
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600">
                {en ? "Status:" : "状态："}
                {promStatusQ.data?.configured ? (en ? " configured" : "已配置") : en ? " not set" : "未配置"}{" "}
                {promStatusQ.data?.urlHint ? `（${promStatusQ.data.urlHint}）` : ""}
              </p>
              {cfg?.prometheusHasBearer && (
                <p className="text-xs text-amber-700">
                  {en
                    ? "Bearer token enabled (PROMETHEUS_BEARER_TOKEN)"
                    : "已启用服务端 Bearer（PROMETHEUS_BEARER_TOKEN）"}
                </p>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm">
                    {en ? "Discover in cluster (Kubernetes Services)" : "集群内服务发现"}
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!k8sOk || discoverQ.isFetching}
                    onClick={() => runDiscover()}
                  >
                    {discoverQ.isFetching ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        {en ? "Scanning…" : "扫描中…"}
                      </>
                    ) : en ? (
                      "Scan cluster"
                    ) : (
                      "扫描 Service"
                    )}
                  </Button>
                </div>
                {!k8sOk && (
                  <p className="text-xs text-amber-800">
                    {en
                      ? "Connect Kubernetes first (Cluster settings → K8s)."
                      : "请先配置 Kubernetes 连接后再扫描。"}
                  </p>
                )}
                {discoverQ.isError && (
                  <p className="text-xs text-red-600">{(discoverQ.error as Error).message}</p>
                )}
                {candidates.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-600">
                      {en ? "Pick a candidate (HTTP base URL)" : "选择候选（HTTP 基址）"}
                    </Label>
                    <Select
                      value={selectedDiscoverId || undefined}
                      onValueChange={(id) => {
                        setSelectedDiscoverId(id);
                        const c = candidates.find((x) => x.id === id);
                        if (c) setPromBase(c.baseUrl);
                      }}
                    >
                      <SelectTrigger className="bg-white text-left font-mono text-xs">
                        <SelectValue placeholder={en ? "Select…" : "请选择…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="font-mono text-xs">
                            {c.namespace}/{c.name}:{c.port} — {c.baseUrl}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-gray-500">
                      {en ? "Heuristic match on name/port; verify TLS if needed." : "按名称与端口启发式匹配；若需 HTTPS 请手动改。"}
                    </p>
                  </div>
                )}
                {discoverScanDone && !discoverQ.isFetching && candidates.length === 0 && (
                  <p className="text-xs text-gray-500">
                    {en ? "No Prometheus-like Services found." : "未发现疑似 Prometheus 的 Service。"}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>
                  {en ? "Base URL (scheme + host + port)" : "自定义 Base URL（含协议与端口）"}
                </Label>
                <Input
                  placeholder="http://prometheus-k8s.monitoring.svc:9090"
                  className="font-mono text-xs"
                  value={promBase}
                  onChange={(e) => setPromBase(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void savePrometheus()}>
                  {en ? "Save URL (session)" : "保存地址（进程内）"}
                </Button>
                {cfg?.setupInitialized && (
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => void persistPrometheusToRuntime()}
                  >
                    {en ? "Save & persist (runtime-config)" : "保存并写入 runtime-config"}
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={() => void clearPrometheus()}>
                  {en ? "Clear override" : "清除覆盖"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PromQL</CardTitle>
              <CardDescription>
                {en ? (
                  <>
                    Proxied to <code className="text-xs">/api/v1/query</code>
                  </>
                ) : (
                  <>经后端代理到 <code className="text-xs">/api/v1/query</code></>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setPromql(p.q);
                      void runPrometheus(p.q);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <Textarea
                className="min-h-[100px] font-mono text-xs"
                value={promql}
                onChange={(e) => setPromql(e.target.value)}
              />
              <Button type="button" disabled={promLoading} onClick={() => void runPrometheus()}>
                {promLoading ? (en ? "Running…" : "查询中…") : en ? "Run" : "执行"}
              </Button>
              {promErr && <p className="text-sm text-red-600">{promErr}</p>}
              {promResult && (
                <pre className="max-h-[360px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                  {promResult}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPrometheusSection;

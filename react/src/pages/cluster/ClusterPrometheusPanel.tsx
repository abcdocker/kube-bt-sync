import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart3, Database, Gauge, Layers } from "lucide-react";
import { apiGetJson, type AppConfig } from "@/lib/api";
import StatCard from "@/components/StatCard";

function promInstantScalar(data: unknown): number | null {
  const d = data as {
    status?: string;
    data?: { result?: Array<{ value?: [number, string] }> };
  };
  if (d?.status !== "success") return null;
  const v = d?.data?.result?.[0]?.value?.[1];
  if (v == null) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function promQuery(q: string): Promise<number | null> {
  const data = await apiGetJson<unknown>(`/api/prometheus/query?q=${encodeURIComponent(q)}`);
  return promInstantScalar(data);
}

const ClusterPrometheusPanel: React.FC = () => {
  const cfgQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });

  const metricsQ = useQuery({
    queryKey: ["cluster-prometheus-snapshot"],
    queryFn: async () => {
      const queries: [string, string][] = [
        ["upSeries", "count(up)"],
        ["tsdbSeries", "prometheus_tsdb_head_series"],
        ["podsRunning", `sum(kube_pod_status_phase{phase="Running"})`],
        ["cpuCores", `sum(rate(container_cpu_usage_seconds_total{container!="POD",container!=""}[5m]))`],
      ];
      const out: Record<string, number | null> = {};
      await Promise.all(
        queries.map(async ([key, q]) => {
          try {
            out[key] = await promQuery(q);
          } catch {
            out[key] = null;
          }
        })
      );
      return out;
    },
    enabled: cfgQ.data?.prometheusConfigured === true,
    staleTime: 45_000,
    refetchInterval: 120_000,
  });

  if (cfgQ.isLoading || !cfgQ.data) {
    return null;
  }
  const cfg = cfgQ.data;
  if (!cfg.k8sConfigured) {
    return null;
  }

  if (!cfg.prometheusConfigured) {
    return (
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 px-5 py-4 text-sm text-amber-950">
        <p className="font-medium">未配置 Prometheus</p>
        <p className="mt-1 text-xs text-amber-900/90">
          在集群设置中通过服务发现或手动填写地址后，此处可展示集群指标快照。
        </p>
        <Link
          to="/cluster/settings"
          className="mt-2 inline-block text-sm font-semibold text-amber-950 underline underline-offset-2"
        >
          前往 Cluster settings → Monitoring
        </Link>
      </div>
    );
  }

  if (metricsQ.isLoading) {
    return <p className="text-sm text-gray-500">加载 Prometheus 指标…</p>;
  }

  if (metricsQ.isError) {
    return (
      <p className="text-sm text-red-600">
        {(metricsQ.error as Error).message}
        <Link to="/cluster/settings" className="ml-2 text-blue-600 underline">
          检查配置
        </Link>
      </p>
    );
  }

  const m = metricsQ.data ?? {};
  const fmt = (n: number | null | undefined) =>
    n == null || !Number.isFinite(n) ? "—" : n >= 1000 ? n.toFixed(0) : n.toFixed(2);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">Prometheus 指标</h2>
          <p className="text-xs text-gray-500">
            来自当前 Prometheus 数据源；需安装 kube-state-metrics 等才有部分 Pod 指标。
          </p>
        </div>
        <Link
          to="/cluster/settings"
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          数据源设置
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="up 序列（count(up)）" value={fmt(m.upSeries)} icon={Gauge} color="blue" />
        <StatCard title="TSDB 序列（自监控）" value={fmt(m.tsdbSeries)} icon={Database} color="purple" />
        <StatCard title="Running Pods" value={fmt(m.podsRunning)} icon={Layers} color="green" />
        <StatCard title="容器 CPU 用量（核）" value={fmt(m.cpuCores)} icon={BarChart3} color="orange" />
      </div>
    </div>
  );
};

export default ClusterPrometheusPanel;

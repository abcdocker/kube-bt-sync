import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Network, Server, Globe, Activity as ActivityIcon, BookOpen } from "lucide-react";
import StatCard from "../components/StatCard";
import { apiGetJson, type AppConfig, type IngressRow, type SyncRoute } from "../lib/api";
import { useSystemCheckQuery } from "@/hooks/use-system-check";

function parseTime(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

const Dashboard: React.FC = () => {
  const checkQ = useSystemCheckQuery();
  const routesQ = useQuery({
    queryKey: ["sync-routes"],
    queryFn: () => apiGetJson<SyncRoute[]>("/api/status"),
  });
  const allQ = useQuery({
    queryKey: ["all-ingresses"],
    queryFn: () => apiGetJson<IngressRow[]>("/api/ingresses"),
  });
  const cfgQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });

  const loading = checkQ.isLoading || routesQ.isLoading || allQ.isLoading;
  const err = checkQ.error || routesQ.error || allQ.error;

  const routes = routesQ.data ?? [];
  const allIng = allQ.data ?? [];
  const check = checkQ.data;
  const cfg = cfgQ.data;

  const totalIngress = allIng.length;
  const baotaLinked = routes.length;
  const managedDomains = new Set(routes.map((r) => r.domain).filter(Boolean)).size;
  const failedHint =
    check?.baota.status === "error" ? 1 : check?.ddns.status === "error" ? 1 : 0;

  const recent = [...routes]
    .sort(
      (a, b) =>
        parseTime(b.modifiedAt || b.createdAt) -
        parseTime(a.modifiedAt || a.createdAt)
    )
    .slice(0, 8);

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-slate-50 to-blue-50/80 p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
              <BookOpen size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">与 README 一致的工作流</h2>
              <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                在 Ingress 上添加注解{" "}
                <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-xs text-blue-800">
                  i4t.com/baota-sync: &quot;true&quot;
                </code>
                ，可选{" "}
                <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-xs text-blue-800">
                  i4t.com/ddns-port
                </code>{" "}
                覆盖默认入口端口；控制器按{" "}
                <code className="font-mono text-xs">{cfg?.syncIntervalSec ?? "—"}s</code>{" "}
                轮询并调用宝塔 API。完整说明见仓库 README。
              </p>
            </div>
          </div>
          <Link
            to="/ingress"
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700"
          >
            去发布 Ingress
          </Link>
        </div>
        {cfg && (
          <dl className="mt-4 grid gap-3 border-t border-blue-100/80 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-medium text-gray-500">DDNS_HOST</dt>
              <dd className="truncate font-mono text-sm text-gray-900" title={cfg.ddnsHost}>
                {cfg.ddnsHost}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">DEFAULT_PORT</dt>
              <dd className="font-mono text-sm text-gray-900">{cfg.defaultPort}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">SYNC_INTERVAL_SEC</dt>
              <dd className="font-mono text-sm text-gray-900">{cfg.syncIntervalSec}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">BAOTA_URL</dt>
              <dd className="truncate font-mono text-xs text-gray-800" title={cfg.baotaUrl}>
                {cfg.baotaUrl}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">Cluster Overview</h1>
        <p className="text-sm text-gray-500">
          数据来自 Kubernetes API 与探活接口（/api/ingresses、/api/status、/api/system/check）。
        </p>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {(err as Error).message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="集群 Ingress 总数"
          value={loading ? "—" : String(totalIngress)}
          trend=""
          trendUp={true}
          icon={Network}
          color="blue"
        />
        <StatCard
          title="已托管同步路由"
          value={loading ? "—" : String(baotaLinked)}
          trend=""
          trendUp={true}
          icon={Server}
          color="purple"
        />
        <StatCard
          title="托管域名数"
          value={loading ? "—" : String(managedDomains)}
          icon={Globe}
          color="green"
        />
        <StatCard
          title="异常项（宝塔/解析）"
          value={loading ? "—" : String(failedHint)}
          trend={check?.baota.status === "error" ? "宝塔" : ""}
          trendUp={false}
          icon={ActivityIcon}
          color="orange"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">最近托管路由</h2>
            <Link
              to="/ingress"
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              查看全部
            </Link>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">加载中...</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-gray-500">
              暂无带同步注解的 Ingress。请到「Ingress Rules」发布或应用 YAML。
            </p>
          ) : (
            <div className="space-y-4">
              {recent.map((item) => {
                const t = item.modifiedAt || item.createdAt;
                const rel =
                  t.length > 0
                    ? formatDistanceToNow(new Date(t), {
                        addSuffix: true,
                        locale: zhCN,
                      })
                    : "";
                const healthy = item.status === "已托管";
                return (
                  <div
                    key={`${item.namespace}/${item.name}`}
                    className="flex flex-col gap-3 rounded-xl border border-gray-50 p-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${healthy ? "bg-emerald-500" : "bg-orange-400"}`}
                      />
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">{item.name}</h4>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {item.namespace} · {item.domain} · {item.scheme?.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <span className="mb-1 block text-xs text-gray-400">{rel}</span>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          healthy
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-orange-50 text-orange-600"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <h2 className="mb-6 text-lg font-bold text-gray-900">运行状态</h2>

          <div className="space-y-5 text-sm">
            <div>
              <p className="mb-1 font-semibold text-gray-900">宝塔 API</p>
              <p className="break-all text-xs text-gray-500">{check?.baota.url ?? "—"}</p>
              <p className="mt-1 text-xs text-gray-600">{check?.baota.msg ?? "—"}</p>
            </div>
            <div>
              <p className="mb-1 font-semibold text-gray-900">DDNS / 穿透</p>
              <p className="text-xs text-gray-500">{check?.ddns.host ?? "—"}</p>
              <p className="mt-1 text-xs text-gray-600">{check?.ddns.msg ?? "—"}</p>
            </div>
            <div>
              <p className="mb-1 font-semibold text-gray-900">节点内网 IP</p>
              <p className="font-mono text-xs text-gray-800">{check?.k8s.nodeIP || "—"}</p>
            </div>
          </div>

          <Link
            to="/account/settings"
            className="mt-6 block w-full rounded-xl bg-[#F1F5F9] py-2.5 text-center text-sm font-semibold text-gray-700 transition-colors hover:bg-[#E2E8F0]"
          >
            账户与平台设置
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

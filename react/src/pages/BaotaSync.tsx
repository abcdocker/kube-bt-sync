import React from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Shield, Link as LinkIcon, Server } from "lucide-react";
import { apiGetJson, type SyncRoute } from "../lib/api";
import { useSystemCheckQuery } from "@/hooks/use-system-check";

const BaotaSync: React.FC = () => {
  const checkQ = useSystemCheckQuery();
  const routesQ = useQuery({
    queryKey: ["sync-routes"],
    queryFn: () => apiGetJson<SyncRoute[]>("/api/status"),
  });

  const check = checkQ.data;
  const routes = routesQ.data ?? [];
  const loading = checkQ.isLoading || routesQ.isLoading;
  const err = checkQ.error || routesQ.error;

  const baotaOk = check?.baota.status === "success";

  return (
    <div className="w-full max-w-[1920px]">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Baota Integration</h1>
          <p className="text-sm text-gray-500">
            宝塔连通性来自 <code className="text-xs bg-gray-100 px-1 rounded">/api/system/check</code>
            ；下方列表为已打注解并由同步器托管的 Ingress（
            <code className="text-xs bg-gray-100 px-1 rounded">/api/status</code>）。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void checkQ.refetch();
            void routesQ.refetch();
          }}
          className="flex items-center space-x-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-5 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
        >
          <RefreshCw size={18} />
          <span>刷新数据</span>
        </button>
      </div>

      {err && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {(err as Error).message}
        </div>
      )}

      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 mb-8 text-white shadow-md relative overflow-hidden flex items-center justify-between">
        <div className="absolute right-0 top-0 opacity-10 transform translate-x-1/4 -translate-y-1/4">
          <Server size={180} />
        </div>
        <div className="relative z-10">
          <h3 className="text-lg font-bold mb-1">
            {loading ? "加载中..." : baotaOk ? "宝塔 API 可访问" : "宝塔 API 异常"}
          </h3>
          <p className="text-blue-100 text-sm max-w-xl break-all">
            {check?.baota.msg ?? "—"}
          </p>
        </div>
        <div className="relative z-10 px-4 py-2 bg-white/20 rounded-lg backdrop-blur-sm border border-white/30 text-sm font-semibold">
          Node: {check?.k8s.nodeIP ?? "—"}
        </div>
      </div>

      <h3 className="text-lg font-bold text-gray-900 mb-4">已托管同步路由（K8s Ingress）</h3>
      {loading ? (
        <p className="text-sm text-gray-500">加载中...</p>
      ) : routes.length === 0 ? (
        <p className="text-sm text-gray-500">暂无带注解的 Ingress。</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {routes.map((site) => (
            <div
              key={`${site.namespace}/${site.name}`}
              className="bg-white border border-gray-200 rounded-xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:border-blue-300 transition-colors"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-bold text-gray-900 text-base">{site.domain}</h4>
                  <p className="text-xs text-gray-500 mt-1 font-mono">
                    {site.namespace}/{site.name} · DDNS 端口 {site.ddnsPort}
                  </p>
                </div>
                <span className="bg-blue-50 text-blue-600 px-2.5 py-1 rounded-md text-xs font-bold border border-blue-100 flex items-center">
                  <LinkIcon size={12} className="mr-1" /> {site.status}
                </span>
              </div>

              <div className="flex items-center space-x-4 mb-5">
                <div className="flex items-center space-x-1.5 text-sm">
                  <Shield
                    size={16}
                    className={site.scheme === "https" ? "text-emerald-500" : "text-gray-300"}
                  />
                  <span className="text-gray-700">
                    {site.scheme === "https" ? "TLS 已配置" : "HTTP"}
                  </span>
                </div>
                <div className="h-4 w-px bg-gray-200" />
                <div className="text-sm text-gray-600">
                  RV: <span className="font-semibold">{site.version}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BaotaSync;

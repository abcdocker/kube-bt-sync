import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGetJson, type AppConfig } from "@/lib/api";
import K8sConnectWizard from "./K8sConnectWizard";
import VCenterConnectWizard from "../vcenter/VCenterConnectWizard";

const ClusterLayout: React.FC = () => {
  const { pathname } = useLocation();
  /** 侧栏「vCenter / 虚拟机」菜单：仅在此区展示 vCenter 向导，不展示 K8s 向导 */
  const isVCenterSection = pathname.startsWith("/cluster/vcenter");
  /** 子页自带标题（如 Cluster / vCenter Settings）时不再重复「Kubernetes 集群」横幅 */
  const hideClusterIntro =
    pathname === "/cluster/settings" || pathname === "/cluster/vcenter/settings";

  const configQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });

  const k8sOk = configQ.data?.k8sConfigured === true;
  const vcOk = configQ.data?.vcenterConfigured === true;

  return (
    <div className="mx-auto max-w-[1600px] pb-12">
      {!hideClusterIntro && (
        <div className="mb-6">
          {isVCenterSection ? (
            <>
              <h1 className="mb-2 text-2xl font-bold text-gray-900">vSphere / vCenter</h1>
              <p className="text-sm text-gray-500">
                虚拟机列表与控制台；连接信息保存在「运行时配置」。未配置时将显示下方向导。
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-2 text-2xl font-bold text-gray-900">Kubernetes 集群</h1>
              <p className="text-sm text-gray-500">
                优先使用「系统设置 → 运行时配置」或下方向导；若初始化时未填 K8s，服务端会尝试与当前进程的{" "}
                <code className="text-xs">KUBECONFIG</code> / in-cluster 一致。
              </p>
            </>
          )}
        </div>
      )}
      {configQ.isLoading && <p className="text-sm text-gray-500">加载中…</p>}
      {configQ.error && (
        <p className="text-sm text-red-600">{(configQ.error as Error).message}</p>
      )}
      {!configQ.isLoading && configQ.data && isVCenterSection && !vcOk && <VCenterConnectWizard />}
      {!configQ.isLoading && configQ.data && isVCenterSection && vcOk && <Outlet />}
      {!configQ.isLoading && configQ.data && !isVCenterSection && !k8sOk && <K8sConnectWizard />}
      {!configQ.isLoading && configQ.data && !isVCenterSection && k8sOk && <Outlet />}
    </div>
  );
};

export default ClusterLayout;

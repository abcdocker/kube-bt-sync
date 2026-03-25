import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  LayoutGrid,
  Network,
  Server,
  Settings,
  Hexagon,
  Boxes,
  Activity as NodeActivityIcon,
  Layers,
  ListOrdered,
  Container as ContainerIcon,
  HardDrive,
  FileText,
  Globe,
  Monitor,
  Cpu,
} from "lucide-react";
import { apiGetJson, type AppConfig } from "@/lib/api";
import { useSystemCheckQuery } from "@/hooks/use-system-check";
import { WORKSPACE_STORAGE_KEY, type WorkspaceId } from "@/lib/workspace";
import { cn } from "@/lib/utils";

type SidebarWorkspace = WorkspaceId;

function readWorkspace(): SidebarWorkspace {
  try {
    const v = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (v === "vcenter" || v === "kubernetes") return v;
  } catch {
    /* ignore */
  }
  return "kubernetes";
}

/** 与 Ingress Rules 等主导航项一致 */
function navLinkClass(isActive: boolean) {
  return cn(
    "flex items-center space-x-3 rounded-xl px-4 py-3.5 text-sm font-medium transition-all duration-200",
    isActive
      ? "bg-blue-50 text-blue-700 shadow-[inset_4px_0_0_0_#2563eb]"
      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
  );
}

type K8sNavItem = {
  to: string | { pathname: string; search?: string };
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  nsResource?: "pods" | "deployments" | "statefulsets" | "services" | "pvcs" | "configmaps";
};

const k8sNavItems: K8sNavItem[] = [
  { to: "/cluster", label: "概览", icon: LayoutGrid },
  {
    to: { pathname: "/cluster/ns", search: "?resource=pods" },
    label: "Pods",
    icon: Boxes,
    nsResource: "pods",
  },
  {
    to: { pathname: "/cluster/ns", search: "?resource=deployments" },
    label: "Deployments",
    icon: Layers,
    nsResource: "deployments",
  },
  {
    to: { pathname: "/cluster/ns", search: "?resource=statefulsets" },
    label: "StatefulSets",
    icon: ListOrdered,
    nsResource: "statefulsets",
  },
  { to: "/cluster/daemonsets", label: "DaemonSets", icon: ContainerIcon },
  {
    to: { pathname: "/cluster/ns", search: "?resource=services" },
    label: "Services",
    icon: Network,
    nsResource: "services",
  },
  {
    to: { pathname: "/cluster/ns", search: "?resource=pvcs" },
    label: "PVC",
    icon: HardDrive,
    nsResource: "pvcs",
  },
  {
    to: { pathname: "/cluster/ns", search: "?resource=configmaps" },
    label: "ConfigMaps",
    icon: FileText,
    nsResource: "configmaps",
  },
  { to: "/cluster/nodes", label: "Nodes", icon: NodeActivityIcon },
];

function isWorkspaceResourceActive(
  resource: string,
  pathname: string,
  search: string
): boolean {
  const q = new URLSearchParams(search).get("resource") || "pods";
  if (pathname === "/cluster/ns" || pathname === "/cluster/ns/") {
    return q === resource;
  }
  const m = pathname.match(
    /^\/cluster\/ns\/[^/]+\/(pods|deployments|statefulsets|services|pvcs|configmaps)(?:\/|$)/
  );
  if (m) return m[1] === resource;
  return false;
}

function k8sItemActive(
  item: K8sNavItem,
  pathname: string,
  search: string
): boolean {
  if (item.nsResource) {
    return isWorkspaceResourceActive(item.nsResource, pathname, search);
  }
  const to = item.to;
  if (typeof to === "string") {
    if (to === "/cluster") {
      return pathname === "/cluster" || pathname === "/cluster/";
    }
    return pathname === to || pathname.startsWith(`${to}/`);
  }
  return false;
}

function k8sItemKey(item: K8sNavItem): string {
  const to = item.to;
  if (typeof to === "string") return to;
  return `${to.pathname}${to.search ?? ""}`;
}

/** 虚拟机列表/详情高亮；排除宿主机（含详情）与 vCenter 设置页 */
function isVcenterVmNavActive(pathname: string): boolean {
  if (pathname === "/cluster/vcenter") return true;
  if (
    pathname === "/cluster/vcenter/hosts" ||
    pathname.startsWith("/cluster/vcenter/hosts/") ||
    pathname === "/cluster/vcenter/settings"
  ) {
    return false;
  }
  return pathname.startsWith("/cluster/vcenter/");
}

const Sidebar: React.FC = () => {
  const location = useLocation();
  const [workspace, setWorkspace] = useState<SidebarWorkspace>(() => readWorkspace());

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace);
    } catch {
      /* ignore */
    }
  }, [workspace]);

  /** 从地址栏进入 /cluster/vcenter 时与侧栏工作区对齐 */
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith("/cluster/vcenter")) {
      setWorkspace("vcenter");
    } else if (path.startsWith("/cluster")) {
      setWorkspace("kubernetes");
    }
  }, [location.pathname]);

  const mainNavItems = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    { path: "/ingress", label: "Ingress Rules", icon: Globe },
    { path: "/baota", label: "Baota Sync", icon: Server },
  ];

  const checkQ = useSystemCheckQuery();
  const cfgQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });

  const check = checkQ.data;
  const cfg = cfgQ.data;
  const ok = check?.baota.status === "success";

  const isK8s = workspace === "kubernetes";
  const statusLoading = checkQ.isLoading || cfgQ.isLoading;

  return (
    <aside
      data-cmp="Sidebar"
      data-workspace={workspace}
      className="z-10 flex w-[260px] flex-shrink-0 flex-col border-r border-[#E2E8F0] bg-white"
    >
      <div className="border-b border-[#E2E8F0] px-3 py-3">
        <div className="flex w-full items-center gap-2 rounded-xl px-2 py-2">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-md transition-colors duration-300",
              isK8s
                ? "bg-blue-600 shadow-[0_4px_12px_rgba(37,99,235,0.35)]"
                : "bg-violet-600 shadow-[0_4px_12px_rgba(124,58,237,0.35)]"
            )}
          >
            {isK8s ? (
              <Hexagon className="text-white" size={24} strokeWidth={2.5} />
            ) : (
              <Monitor className="text-white" size={22} strokeWidth={2.25} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold leading-tight text-gray-900">
              Kube-BT-Sync
            </span>
            <span
              className={cn(
                "mt-0.5 block text-[11px] font-semibold uppercase tracking-wide transition-colors duration-300",
                isK8s ? "text-blue-600/90" : "text-violet-600/90"
              )}
            >
              {isK8s ? "Kubernetes" : "vCenter"}
            </span>
            <span className="mt-1 block text-[10px] leading-tight text-gray-400">
              工作区切换见顶部栏
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
        {mainNavItems.slice(0, 1).map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.path} to={item.path} className={navLinkClass(isActive)}>
              <Icon size={20} className={isActive ? "text-blue-600" : "text-gray-400"} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {isK8s ? (
          <>
            <div className="px-4 pb-1 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                集群
              </p>
            </div>
            {k8sNavItems.map((item) => {
              const isActive = k8sItemActive(item, location.pathname, location.search);
              const Icon = item.icon;
              return (
                <Link key={k8sItemKey(item)} to={item.to} className={navLinkClass(isActive)}>
                  <Icon size={20} className={isActive ? "text-blue-600" : "text-gray-400"} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </>
        ) : (
          <>
            <div className="px-4 pb-1 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                vCenter
              </p>
            </div>
            <Link
              to="/cluster/vcenter"
              className={navLinkClass(isVcenterVmNavActive(location.pathname))}
            >
              <Monitor
                size={20}
                className={
                  isVcenterVmNavActive(location.pathname) ? "text-violet-600" : "text-gray-400"
                }
              />
              <span>虚拟机</span>
            </Link>
            <Link
              to="/cluster/vcenter/hosts"
              className={navLinkClass(
                location.pathname === "/cluster/vcenter/hosts" ||
                  location.pathname.startsWith("/cluster/vcenter/hosts/")
              )}
            >
              <Cpu
                size={20}
                className={
                  location.pathname === "/cluster/vcenter/hosts" ||
                  location.pathname.startsWith("/cluster/vcenter/hosts/")
                    ? "text-violet-600"
                    : "text-gray-400"
                }
              />
              <span>宿主机</span>
            </Link>
          </>
        )}

        {mainNavItems.slice(1).map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.path} to={item.path} className={navLinkClass(isActive)}>
              <Icon size={20} className={isActive ? "text-blue-600" : "text-gray-400"} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        {isK8s && (
          <Link
            to="/cluster/settings"
            className={navLinkClass(location.pathname === "/cluster/settings")}
          >
            <Settings
              size={20}
              className={
                location.pathname === "/cluster/settings" ? "text-blue-600" : "text-gray-400"
              }
            />
            <span>Cluster Settings</span>
          </Link>
        )}
        {!isK8s && (
          <Link
            to="/cluster/vcenter/settings"
            className={navLinkClass(location.pathname === "/cluster/vcenter/settings")}
          >
            <Settings
              size={20}
              className={
                location.pathname === "/cluster/vcenter/settings"
                  ? "text-violet-600"
                  : "text-gray-400"
              }
            />
            <span>vCenter Settings</span>
          </Link>
        )}
      </nav>

      <div className="border-t border-[#E2E8F0] p-6">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="mb-2 text-xs font-semibold text-gray-900">运行状态</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  statusLoading ? "bg-slate-300" : cfg?.k8sConfigured ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span className="text-xs text-gray-600">
                {statusLoading
                  ? "Kubernetes …"
                  : cfg?.k8sConfigured
                    ? "Kubernetes 已配置"
                    : "Kubernetes 未配置"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  statusLoading ? "bg-slate-300" : cfg?.vcenterConfigured ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span className="text-xs text-gray-600">
                {statusLoading
                  ? "vCenter …"
                  : cfg?.vcenterConfigured
                    ? "vCenter 已配置"
                    : "vCenter 未配置"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  checkQ.isLoading ? "bg-slate-300" : ok ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span className="text-xs text-gray-600">
                {checkQ.isLoading
                  ? "宝塔 …"
                  : ok
                    ? "宝塔 可达"
                    : check?.baota.status === "error"
                      ? "宝塔 不可达"
                      : "宝塔 待检查"}
              </span>
            </div>
          </div>
          {cfg && (
            <p className="mt-2 truncate text-[11px] text-gray-500" title={cfg.ddnsHost}>
              DDNS: {cfg.ddnsHost}
            </p>
          )}
          {cfg && (
            <p className="text-[11px] text-gray-500">同步间隔: {cfg.syncIntervalSec}s</p>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

/** 与 Sidebar 中 localStorage 键一致，供需要时读取 */
export const WORKSPACE_STORAGE_KEY = "kube-bt-sidebar-workspace";

export type WorkspaceId = "kubernetes" | "vcenter";

export function workspaceFromPathname(pathname: string): WorkspaceId {
  if (pathname.startsWith("/cluster/vcenter")) return "vcenter";
  if (pathname.startsWith("/cluster")) return "kubernetes";
  return "kubernetes";
}

/** 命名空间工作流下的资源类型（与 URL 段一致） */
export type ClusterScopedResource =
  | "pods"
  | "deployments"
  | "statefulsets"
  | "services"
  | "pvcs"
  | "configmaps";

export const SCOPED_RESOURCE_KEYS: ClusterScopedResource[] = [
  "pods",
  "deployments",
  "statefulsets",
  "services",
  "pvcs",
  "configmaps",
];

export const RESOURCE_TAB_META: {
  key: ClusterScopedResource;
  /** 主标题 */
  title: string;
  /** API 与说明（尽量详细） */
  detail: string;
}[] = [
  {
    key: "pods",
    title: "Pod",
    detail: "core/v1 Pod · 最小调度单元 · 容器组",
  },
  {
    key: "deployments",
    title: "Deployment",
    detail: "apps/v1 Deployment · 无状态副本集 · 与 ReplicaSet / Pod 关联",
  },
  {
    key: "statefulsets",
    title: "StatefulSet",
    detail: "apps/v1 StatefulSet · 有状态副本集 · 稳定网络标识",
  },
  {
    key: "services",
    title: "Service",
    detail: "core/v1 Service · ClusterIP / NodePort / LB · 服务发现与负载均衡",
  },
  {
    key: "pvcs",
    title: "PVC",
    detail: "core/v1 PersistentVolumeClaim · 持久卷声明 · 存储请求",
  },
  {
    key: "configmaps",
    title: "ConfigMap",
    detail: "core/v1 ConfigMap · 非敏感配置 · data/binaryData",
  },
];

export function parseResourceSearchParam(v: string | null): ClusterScopedResource {
  if (v && SCOPED_RESOURCE_KEYS.includes(v as ClusterScopedResource)) {
    return v as ClusterScopedResource;
  }
  return "pods";
}

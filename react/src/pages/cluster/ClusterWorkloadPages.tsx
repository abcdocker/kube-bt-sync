import React from "react";
import { useParams } from "react-router-dom";
import { ClusterK8sListPage, type K8sColumn } from "./ClusterK8sListPage";

const ns: K8sColumn = { key: "namespace", header: "Namespace", mono: true };
const name: K8sColumn = { key: "name", header: "Name", mono: true };
const ready: K8sColumn = { key: "ready", header: "Ready（就绪/期望副本）" };
const age: K8sColumn = { key: "age", header: "Age（创建时间）", kind: "age" };

export const ClusterDeployments: React.FC = () => (
  <ClusterK8sListPage
    title="Deployments"
    description="apps/v1 Deployment"
    apiSuffix="deployments"
    queryKey="k8s-deployments"
    columns={[ns, name, ready, age]}
  />
);

export function ClusterDeploymentsScoped() {
  const { namespace } = useParams<{ namespace: string }>();
  if (!namespace) return null;
  return (
    <ClusterK8sListPage
      namespace={namespace}
      enableCrud
      workloadPodsLink
      title="Deployment"
      description="apps/v1 Deployment · 无状态副本集 · 与 ReplicaSet / Pod 通过 selector 关联"
      apiSuffix="deployments"
      queryKey="k8s-deployments"
      columns={[ns, name, ready, age]}
    />
  );
}

export const ClusterStatefulSets: React.FC = () => (
  <ClusterK8sListPage
    title="StatefulSets"
    description="apps/v1 StatefulSet"
    apiSuffix="statefulsets"
    queryKey="k8s-statefulsets"
    columns={[ns, name, ready, age]}
  />
);

export function ClusterStatefulSetsScoped() {
  const { namespace } = useParams<{ namespace: string }>();
  if (!namespace) return null;
  return (
    <ClusterK8sListPage
      namespace={namespace}
      enableCrud
      workloadPodsLink
      title="StatefulSet"
      description="apps/v1 StatefulSet · 有状态副本集 · 稳定网络标识与有序扩缩容"
      apiSuffix="statefulsets"
      queryKey="k8s-statefulsets"
      columns={[ns, name, ready, age]}
    />
  );
}

export const ClusterDaemonSets: React.FC = () => (
  <ClusterK8sListPage
    title="DaemonSets"
    description="apps/v1 DaemonSet"
    apiSuffix="daemonsets"
    queryKey="k8s-daemonsets"
    columns={[ns, name, ready, age]}
  />
);

const pvcCols: K8sColumn[] = [
  ns,
  {
    key: "name",
    header: "名称（PVC · metadata.name）",
    mono: true,
  },
  {
    key: "status",
    header: "阶段（status.phase）",
  },
  {
    key: "capacity",
    header: "容量（status.capacity）",
    mono: true,
  },
  {
    key: "accessModes",
    header: "访问模式（spec.accessModes）",
    format: (row) => {
      const v = row.accessModes;
      if (Array.isArray(v)) return v.join(", ");
      return "—";
    },
  },
  {
    key: "storageClass",
    header: "StorageClass（spec.storageClassName）",
    mono: true,
  },
  age,
];

export const ClusterPVCs: React.FC = () => (
  <ClusterK8sListPage
    title="PersistentVolumeClaims"
    description="core/v1 PersistentVolumeClaim"
    apiSuffix="pvcs"
    queryKey="k8s-pvcs"
    columns={pvcCols}
  />
);

export function ClusterPVCsScoped() {
  const { namespace } = useParams<{ namespace: string }>();
  if (!namespace) return null;
  return (
    <ClusterK8sListPage
      namespace={namespace}
      enableCrud
      title="PersistentVolumeClaim（PVC）"
      description="core/v1 PersistentVolumeClaim · 对持久卷的声明与绑定"
      apiSuffix="pvcs"
      queryKey="k8s-pvcs"
      columns={pvcCols}
    />
  );
}

const cmCols: K8sColumn[] = [
  ns,
  {
    key: "name",
    header: "名称（metadata.name）",
    mono: true,
  },
  {
    key: "keys",
    header: "键数量（data + binaryData 键名合计）",
  },
  age,
];

export const ClusterConfigMaps: React.FC = () => (
  <ClusterK8sListPage
    title="ConfigMaps"
    description="core/v1 ConfigMap（键数量含 binaryData）"
    apiSuffix="configmaps"
    queryKey="k8s-configmaps"
    columns={cmCols}
  />
);

export function ClusterConfigMapsScoped() {
  const { namespace } = useParams<{ namespace: string }>();
  if (!namespace) return null;
  return (
    <ClusterK8sListPage
      namespace={namespace}
      enableCrud
      title="ConfigMap"
      description="core/v1 ConfigMap · 非敏感配置 · data 与 binaryData"
      apiSuffix="configmaps"
      queryKey="k8s-configmaps"
      columns={cmCols}
    />
  );
}

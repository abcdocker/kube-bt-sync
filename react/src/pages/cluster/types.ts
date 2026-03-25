export type K8sSummary = {
  namespaceCount: number;
  podCount: number;
  serviceCount: number;
  nodeCount: number;
};

export type PodRow = {
  namespace: string;
  name: string;
  phase: string;
  node: string;
  restarts: number;
  age: string;
  /** 列表接口返回，用于快捷打开日志 */
  firstContainer?: string;
};

export type SvcRow = {
  namespace: string;
  name: string;
  type: string;
  clusterIP: string;
  ports: string[];
  age: string;
};

export type NodeRow = {
  name: string;
  ready: string;
  roles: string[];
  internalIP: string;
  kubelet: string;
  age: string;
};

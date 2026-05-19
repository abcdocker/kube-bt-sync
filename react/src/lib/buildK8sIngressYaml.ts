/** 与 PublishIngress / 集群 Ingress 创建向导共用的 Ingress YAML 生成逻辑 */

export type BuildK8sIngressYamlOpts = {
  name: string;
  namespace: string;
  domain: string;
  serviceName: string;
  port: number;
  enableBaotaSync: boolean;
  enableBaotaHttps: boolean;
  baotaSslCertName: string;
  syncAnnotation: "i4t" | "kube-bt";
  customDdnsPort: string;
  ddnsScheme: "http" | "https";
  /** 多宝塔实例 id */
  baotaTargetId?: string;
};

export function buildK8sIngressYaml(opts: BuildK8sIngressYamlOpts): string {
  if (!opts.enableBaotaSync) {
    return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${opts.name}
  namespace: ${opts.namespace}
  annotations:
    kubernetes.io/ingress.class: "nginx"
spec:
  ingressClassName: nginx
  rules:
  - host: ${opts.domain}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ${opts.serviceName}
            port:
              number: ${opts.port}
`;
  }
  const syncKey =
    opts.syncAnnotation === "i4t"
      ? "i4t.com/baota-sync"
      : "kube-bt-sync.io/baota-sync";
  const ddnsKube =
    opts.syncAnnotation === "kube-bt" && opts.customDdnsPort.trim() !== ""
      ? `    kube-bt-sync.io/ddns-port: "${opts.customDdnsPort.trim()}"\n`
      : "";
  const ddnsLegacy =
    opts.syncAnnotation === "i4t" && opts.customDdnsPort.trim() !== ""
      ? `    i4t.com/ddns-port: "${opts.customDdnsPort.trim()}"\n`
      : "";
  const ddnsSchemeKube =
    opts.syncAnnotation === "kube-bt" && opts.ddnsScheme === "https"
      ? '    kube-bt-sync.io/ddns-scheme: "https"\n'
      : "";
  const ddnsSchemeLegacy =
    opts.syncAnnotation === "i4t" && opts.ddnsScheme === "https"
      ? '    i4t.com/ddns-scheme: "https"\n'
      : "";
  const httpsKube =
    opts.syncAnnotation === "kube-bt" && opts.enableBaotaHttps
      ? '    kube-bt-sync.io/baota-https: "true"\n'
      : "";
  const httpsLegacy =
    opts.syncAnnotation === "i4t" && opts.enableBaotaHttps
      ? '    i4t.com/baota-https: "true"\n'
      : "";
  const certName = opts.baotaSslCertName.trim();
  const useCertName = opts.enableBaotaHttps && certName !== "";
  const certKube =
    opts.syncAnnotation === "kube-bt" && useCertName
      ? `    kube-bt-sync.io/baota-ssl-cert-name: "${certName}"\n`
      : "";
  const certLegacy =
    opts.syncAnnotation === "i4t" && useCertName
      ? `    i4t.com/baota-ssl-cert-name: "${certName}"\n`
      : "";
  const tid = (opts.baotaTargetId ?? "").trim().replace(/"/g, "");
  const targetKube =
    tid !== "" && opts.syncAnnotation === "kube-bt"
      ? `    kube-bt-sync.io/baota-target: "${tid}"\n`
      : "";
  const targetLegacy =
    tid !== "" && opts.syncAnnotation === "i4t" ? `    i4t.com/baota-target: "${tid}"\n` : "";
  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${opts.name}
  namespace: ${opts.namespace}
  annotations:
    kubernetes.io/ingress.class: "nginx"
    ${syncKey}: "true"
${targetLegacy}${targetKube}${ddnsLegacy}${ddnsKube}${ddnsSchemeLegacy}${ddnsSchemeKube}${httpsLegacy}${httpsKube}${certLegacy}${certKube}spec:
  ingressClassName: nginx
  rules:
  - host: ${opts.domain}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ${opts.serviceName}
            port:
              number: ${opts.port}
`;
}

export function defaultK8sIngressYamlExample(namespace = "default"): string {
  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  namespace: ${namespace}
  annotations:
    kubernetes.io/ingress.class: "nginx"
    i4t.com/baota-sync: "true"
spec:
  ingressClassName: nginx
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app-svc
            port:
              number: 80
`;
}

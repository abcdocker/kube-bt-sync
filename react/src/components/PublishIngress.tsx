import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiGetJson, apiPostJson, type AppConfig } from "@/lib/api";

type ServiceRow = { namespace: string; name: string; ports: number[] };

const defaultYaml = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  namespace: default
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

function buildIngressYaml(opts: {
  name: string;
  namespace: string;
  domain: string;
  serviceName: string;
  port: number;
  syncAnnotation: "i4t" | "kube-bt";
  customDdnsPort: string;
}): string {
  const syncKey =
    opts.syncAnnotation === "i4t"
      ? "i4t.com/baota-sync"
      : "kube-bt-sync.io/baota-sync";
  const ddns =
    opts.customDdnsPort.trim() !== ""
      ? `    i4t.com/ddns-port: "${opts.customDdnsPort.trim()}"\n`
      : "";
  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${opts.name}
  namespace: ${opts.namespace}
  annotations:
    kubernetes.io/ingress.class: "nginx"
    ${syncKey}: "true"
${ddns}spec:
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

interface PublishIngressProps {
  onApplied: () => void;
}

const PublishIngress: React.FC<PublishIngressProps> = ({ onApplied }) => {
  const queryClient = useQueryClient();
  const nsQ = useQuery({
    queryKey: ["namespaces"],
    queryFn: () => apiGetJson<string[]>("/api/namespaces"),
  });
  const svcQ = useQuery({
    queryKey: ["services"],
    queryFn: () => apiGetJson<ServiceRow[]>("/api/services"),
  });
  const cfgQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });

  const [namespace, setNamespace] = useState("default");
  const [ingressName, setIngressName] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [port, setPort] = useState<number>(80);
  const [domain, setDomain] = useState("");
  const [customDdnsPort, setCustomDdnsPort] = useState("");
  const [syncAnnotation, setSyncAnnotation] = useState<"i4t" | "kube-bt">("i4t");
  const [yamlText, setYamlText] = useState(defaultYaml);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingYaml, setPendingYaml] = useState("");
  const [pendingSummary, setPendingSummary] = useState("");

  const servicesInNs = useMemo(() => {
    const all = svcQ.data ?? [];
    return all.filter((s) => s.namespace === namespace);
  }, [svcQ.data, namespace]);

  useEffect(() => {
    if (!serviceName && servicesInNs.length > 0) {
      setServiceName(servicesInNs[0].name);
      const p = servicesInNs[0].ports[0];
      if (p) setPort(p);
    }
  }, [namespace, servicesInNs, serviceName]);

  useEffect(() => {
    const svc = servicesInNs.find((s) => s.name === serviceName);
    if (svc?.ports?.length) {
      setPort(svc.ports[0]);
    }
  }, [serviceName, servicesInNs]);

  const applyYaml = async (content: string) => {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await apiPostJson<{ message: string }>("/api/ingress/yaml", {
        yamlContent: content,
      });
      setMessage(res.message ?? "已应用");
      void queryClient.invalidateQueries({ queryKey: ["ingresses-all"] });
      onApplied();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || !serviceName) {
      setMessage("请填写域名并选择 Service");
      return;
    }
    const name =
      ingressName.trim() ||
      `${serviceName.replace(/[^a-zA-Z0-9-]/g, "-")}-ingress`.slice(0, 63);
    const yaml = buildIngressYaml({
      name,
      namespace,
      domain: domain.trim(),
      serviceName,
      port,
      syncAnnotation,
      customDdnsPort,
    });
    setPendingYaml(yaml);
    setPendingSummary(
      `命名空间 ${namespace} · Ingress ${name} · 域名 ${domain.trim()} · Service ${serviceName}:${port}`
    );
    setConfirmOpen(true);
  };

  const runConfirmedApply = () => {
    setConfirmOpen(false);
    void applyYaml(pendingYaml);
  };

  const defaultPortHint = cfgQ.data?.defaultPort ?? "38333";

  return (
    <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">暴露新服务到公网</h2>
          <p className="text-sm text-gray-500">
            与 README 一致：为 Ingress 打上{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">i4t.com/baota-sync: &quot;true&quot;</code>{" "}
            等注解后，控制器会同步宝塔反代。可选{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">i4t.com/ddns-port</code> 覆盖默认端口{" "}
            <span className="font-mono text-xs">{defaultPortHint}</span>。
            若需在宝塔启用 HTTPS，请在 YAML 模式中自行添加{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">baota-https</code> /{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">baota-ssl-cert-name</code> 等注解（见 README）。
          </p>
        </div>
      </div>

      <Tabs defaultValue="form" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="form">表单向导</TabsTrigger>
          <TabsTrigger value="yaml">YAML 模式</TabsTrigger>
        </TabsList>

        <TabsContent value="form">
          <form onSubmit={handleFormSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">命名空间</span>
              <select
                className="rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                value={namespace}
                onChange={(e) => {
                  setNamespace(e.target.value);
                  setServiceName("");
                }}
                disabled={nsQ.isLoading}
              >
                {(nsQ.data ?? []).map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">后端 Service</span>
              <select
                className="rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
              >
                <option value="">请选择</option>
                {servicesInNs.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">端口</span>
              <select
                className="rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                value={String(port)}
                onChange={(e) => setPort(Number(e.target.value))}
              >
                {(servicesInNs.find((s) => s.name === serviceName)?.ports ?? [80]).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="font-medium text-gray-700">访问域名 (rules.host)</span>
              <input
                className="rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
                placeholder="app.example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">Ingress 名称（可空）</span>
              <input
                className="rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
                placeholder="默认: &lt;service&gt;-ingress"
                value={ingressName}
                onChange={(e) => setIngressName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">自定义 DDNS 端口（可选）</span>
              <input
                className="rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
                placeholder={`默认使用全局 ${defaultPortHint}`}
                value={customDdnsPort}
                onChange={(e) => setCustomDdnsPort(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">同步注解键</span>
              <select
                className="rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                value={syncAnnotation}
                onChange={(e) =>
                  setSyncAnnotation(e.target.value === "kube-bt" ? "kube-bt" : "i4t")
                }
              >
                <option value="i4t">i4t.com/baota-sync（README 默认）</option>
                <option value="kube-bt">kube-bt-sync.io/baota-sync</option>
              </select>
            </label>

            <div className="flex items-end sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                {submitting ? "下发中…" : "生成并下发 Ingress"}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="yaml">
          <p className="mb-2 text-sm text-gray-500">
            直接粘贴完整 Ingress YAML，提交后由服务端 Apply 到集群（与 README「方式二」一致）。
          </p>
          <textarea
            className="mb-3 min-h-[280px] w-full rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-900"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
          />
          <Button
            type="button"
            disabled={submitting}
            onClick={() => {
              setPendingYaml(yamlText);
              setPendingSummary("YAML 模式：将按当前编辑框内容提交");
              setConfirmOpen(true);
            }}
          >
            {submitting ? "应用中…" : "应用 YAML"}
          </Button>
        </TabsContent>
      </Tabs>

      {message && (
        <p
          className={`mt-4 text-sm ${message.startsWith("YAML") || message.includes("成功") || message.includes("已应用") ? "text-emerald-700" : "text-red-600"}`}
        >
          {message}
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认下发到集群？</AlertDialogTitle>
            <AlertDialogDescription className="text-left text-gray-700">
              {pendingSummary}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button type="button" onClick={() => runConfirmedApply()}>
              确认下发
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PublishIngress;

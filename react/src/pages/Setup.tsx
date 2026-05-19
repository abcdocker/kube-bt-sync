import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Database, Hexagon, KeyRound, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { apiGetJson, apiPostJson, type SetupStatus } from "@/lib/api";

type K8sMode = "none" | "incluster" | "kubeconfig";

const Setup: React.FC = () => {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 必填：平台 URL、MySQL、Redis、加密、管理员
  const [platformPublicUrl, setPlatformPublicUrl] = useState("https://");
  const [mysqlHost, setMysqlHost] = useState("127.0.0.1");
  const [mysqlPort, setMysqlPort] = useState(3306);
  const [mysqlDatabase, setMysqlDatabase] = useState("");
  const [mysqlUser, setMysqlUser] = useState("");
  const [mysqlPassword, setMysqlPassword] = useState("");
  const [redisHost, setRedisHost] = useState("127.0.0.1");
  const [redisPort, setRedisPort] = useState(6379);
  const [redisPassword, setRedisPassword] = useState("");
  const [encryptionKey, setEncryptionKey] = useState("");
  const [dashboardUser, setDashboardUser] = useState("admin");
  const [dashboardPasswordPlain, setDashboardPasswordPlain] = useState("");
  const [dashboardSessionDays, setDashboardSessionDays] = useState(7);

  // 可选：Ingress↔宝塔
  const [ingressBaotaSync, setIngressBaotaSync] = useState(false);
  const [baotaUrl, setBaotaUrl] = useState("");
  const [baotaApiKey, setBaotaApiKey] = useState("");
  const [baotaSkipTls, setBaotaSkipTls] = useState(true);
  const [syncIntervalSec, setSyncIntervalSec] = useState(30);
  const [ddnsHost, setDdnsHost] = useState("home.i4t.com");
  const [defaultPort, setDefaultPort] = useState("38333");
  const [baotaSslCertName, setBaotaSslCertName] = useState("");
  const [baotaSslPemContent, setBaotaSslPemContent] = useState("");
  const [baotaSslKeyContent, setBaotaSslKeyContent] = useState("");

  // 可选：K8s
  const [k8sMode, setK8sMode] = useState<K8sMode>("none");
  const [kubeconfigYaml, setKubeconfigYaml] = useState("");

  // 可选：vCenter
  const [vcenterUrl, setVcenterUrl] = useState("");
  const [vcenterUser, setVcenterUser] = useState("");
  const [vcenterPassword, setVcenterPassword] = useState("");
  const [vcenterInsecure, setVcenterInsecure] = useState(true);
  const [vcenterCacheTtlSec, setVcenterCacheTtlSec] = useState(120);

  // 可选：SSH 持久化
  const [sshBackend, setSshBackend] = useState<"" | "file">("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await apiGetJson<SetupStatus>("/api/setup/status");
        if (!cancelled) setStatus(s);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const be = sshBackend.trim();
      if ((baotaSslPemContent.trim() === "") !== (baotaSslKeyContent.trim() === "")) {
        setErr("baotaSslPemContent 与 baotaSslKeyContent 必须同时填写");
        setSubmitting(false);
        return;
      }
      const k8s =
        k8sMode === "none"
          ? { mode: "none" as const, kubeconfigYaml: "" }
          : k8sMode === "incluster"
            ? { mode: "incluster" as const, kubeconfigYaml: "" }
            : { mode: "kubeconfig" as const, kubeconfigYaml: kubeconfigYaml };

      const body: Record<string, unknown> = {
        version: 1,
        platformPublicUrl: platformPublicUrl.trim(),
        mysqlHost: mysqlHost.trim(),
        mysqlPort,
        mysqlDatabase: mysqlDatabase.trim(),
        mysqlUser: mysqlUser.trim(),
        mysqlPassword,
        mysqlDsn: "",
        redisHost: redisHost.trim(),
        redisPort,
        redisAddr: "",
        redisPassword,
        redisDb: 0,
        redisKeyPrefix: "",
        encryptionKey: encryptionKey.trim(),
        ingressBaotaSyncEnabled: ingressBaotaSync,
        baotaUrl: baotaUrl.trim(),
        baotaApiKey: baotaApiKey.trim(),
        baotaSkipTlsVerify: baotaSkipTls,
        baotaDisableHttpKeepalive: true,
        baotaHttpTimeoutSec: 45,
        baotaTcpProbeTimeoutSec: 5,
        baotaCheckMinIntervalSec: 90,
        ddnsHost: ddnsHost.trim(),
        defaultPort: defaultPort.trim(),
        syncIntervalSec,
        baotaSslCertName: baotaSslCertName.trim(),
        baotaSslPemContent: baotaSslPemContent.trim(),
        baotaSslKeyContent: baotaSslKeyContent.trim(),
        dashboardUser: dashboardUser.trim(),
        dashboardSessionDays,
        dashboardCookieSecure: false,
        dashboardListenAddr: ":8080",
        prometheusUrl: "",
        prometheusTimeoutSec: 30,
        prometheusSkipTls: false,
        prometheusBearerToken: "",
        vcenterUrl: vcenterUrl.trim(),
        vcenterUser: vcenterUser.trim(),
        vcenterPassword,
        vcenterInsecure,
        vcenterWmksScriptUrl: "",
        vcenterWmksCssUrl: "",
        vcenterUiBaseUrl: "",
        vcenterConsoleHost: "",
        vcenterUiThumbprint: "",
        vcenterVmSshUser: "",
        vcenterVmSshPrivateKeyPath: "",
        vcenterVmSshPassword: "",
        vcenterVmSshKeyPassphrase: "",
        vcenterVmSshPort: 22,
        vcenterVmSshInsecureHostKey: true,
        vcenterCacheTtlSec,
        sshSettingsBackend: be,
        sshSettingsDir: "",
        k8s,
        dashboardPasswordPlain,
      };
      await apiPostJson("/api/setup", body);
      toast.success("初始化保存成功");
      await qc.invalidateQueries({ queryKey: ["setup-status"] });
      window.location.assign("/login");
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(`保存失败：${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        加载向导…
      </div>
    );
  }

  if (status?.initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <p className="text-slate-600">已初始化，正在跳转…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 py-10 px-4 font-sans">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg">
            <Hexagon className="text-white" size={32} strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">首次初始化</h1>
          <p className="max-w-xl text-sm text-slate-600">
            必填：平台 URL、MySQL、Redis、加密密钥、管理员账号。宝塔/Ingress 同步、K8s、vCenter
            可在后台「系统设置」中再开启。
            数据目录：{" "}
            <span className="font-mono text-xs">{status?.dataDir ?? "…"}</span>
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <KeyRound className="h-5 w-5 text-blue-600" />
                必填：平台与数据存储
              </CardTitle>
              <CardDescription>
                MySQL 与 Redis 用于平台元数据与 vCenter 列表缓存；加密密钥用于保护敏感字段。Redis
                仅需填写 IP、端口与密码（逻辑库固定为 0）。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>platformPublicUrl（浏览器访问本平台的根地址）</Label>
                <Input
                  value={platformPublicUrl}
                  onChange={(e) => setPlatformPublicUrl(e.target.value)}
                  required
                  placeholder="https://kube-bt.example.com"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>MySQL 地址</Label>
                  <Input
                    value={mysqlHost}
                    onChange={(e) => setMysqlHost(e.target.value)}
                    required
                    placeholder="127.0.0.1 或主机名"
                  />
                </div>
                <div className="space-y-2">
                  <Label>端口</Label>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={mysqlPort}
                    onChange={(e) => setMysqlPort(Number(e.target.value))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>库名</Label>
                  <Input
                    value={mysqlDatabase}
                    onChange={(e) => setMysqlDatabase(e.target.value)}
                    required
                    placeholder="database"
                  />
                </div>
                <div className="space-y-2">
                  <Label>用户</Label>
                  <Input
                    value={mysqlUser}
                    onChange={(e) => setMysqlUser(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>密码</Label>
                  <Input
                    type="password"
                    value={mysqlPassword}
                    onChange={(e) => setMysqlPassword(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Redis IP</Label>
                  <Input
                    value={redisHost}
                    onChange={(e) => setRedisHost(e.target.value)}
                    required
                    placeholder="127.0.0.1"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Redis 端口</Label>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={redisPort}
                    onChange={(e) => setRedisPort(Number(e.target.value))}
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Redis 密码（可选）</Label>
                  <Input
                    type="password"
                    value={redisPassword}
                    onChange={(e) => setRedisPassword(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>encryptionKey（至少 16 字符）</Label>
                <Input
                  value={encryptionKey}
                  onChange={(e) => setEncryptionKey(e.target.value)}
                  required
                  minLength={16}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>dashboardUser</Label>
                <Input value={dashboardUser} onChange={(e) => setDashboardUser(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>dashboardPasswordPlain（至少 8 位）</Label>
                <Input
                  type="password"
                  value={dashboardPasswordPlain}
                  onChange={(e) => setDashboardPasswordPlain(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label>dashboardSessionDays</Label>
                <Input
                  type="number"
                  min={1}
                  value={dashboardSessionDays}
                  onChange={(e) => setDashboardSessionDays(Number(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="h-5 w-5 text-amber-600" />
                可选：Ingress ↔ 宝塔同步
              </CardTitle>
              <CardDescription>默认关闭；开启后需填写宝塔 URL 与 API Key，并建议配置 K8s</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
                <Label className="cursor-pointer">ingressBaotaSyncEnabled</Label>
                <Switch checked={ingressBaotaSync} onCheckedChange={setIngressBaotaSync} />
              </div>
              <div className="space-y-2">
                <Label>baotaUrl</Label>
                <Input value={baotaUrl} onChange={(e) => setBaotaUrl(e.target.value)} placeholder="留空则不同步" />
              </div>
              <div className="space-y-2">
                <Label>baotaApiKey</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={baotaApiKey}
                  onChange={(e) => setBaotaApiKey(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <Label className="cursor-pointer">HTTPS 跳过 TLS</Label>
                <Switch checked={baotaSkipTls} onCheckedChange={setBaotaSkipTls} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>ddnsHost</Label>
                  <Input value={ddnsHost} onChange={(e) => setDdnsHost(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>defaultPort</Label>
                  <Input value={defaultPort} onChange={(e) => setDefaultPort(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>syncIntervalSec</Label>
                  <Input
                    type="number"
                    min={1}
                    value={syncIntervalSec}
                    onChange={(e) => setSyncIntervalSec(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>baotaSslCertName（可选，宝塔证书夹名称）</Label>
                <Input value={baotaSslCertName} onChange={(e) => setBaotaSslCertName(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>baotaSslPemContent（可选，PEM 证书内容）</Label>
                  <Textarea
                    className="min-h-[160px] font-mono text-xs"
                    value={baotaSslPemContent}
                    onChange={(e) => setBaotaSslPemContent(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                  />
                </div>
                <div className="space-y-2">
                  <Label>baotaSslKeyContent（可选，KEY 私钥内容）</Label>
                  <Textarea
                    className="min-h-[160px] font-mono text-xs"
                    value={baotaSslKeyContent}
                    onChange={(e) => setBaotaSslKeyContent(e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                PEM/KEY 需成对填写；内容会在服务端校验后加密保存到平台存储，不写入 Ingress 注解。若同时配置证书名与 PEM/KEY，平台已保存的 PEM/KEY 优先。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="h-5 w-5 text-emerald-600" />
                可选：Kubernetes
              </CardTitle>
              <CardDescription>选择「不连接集群」可稍后在设置中配置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>k8s.mode</Label>
                <Select value={k8sMode} onValueChange={(v) => setK8sMode(v as K8sMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不连接（稍后配置）</SelectItem>
                    <SelectItem value="incluster">incluster</SelectItem>
                    <SelectItem value="kubeconfig">kubeconfig</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {k8sMode === "kubeconfig" && (
                <div className="space-y-2">
                  <Label>kubeconfigYaml</Label>
                  <Textarea
                    className="min-h-[180px] font-mono text-xs"
                    value={kubeconfigYaml}
                    onChange={(e) => setKubeconfigYaml(e.target.value)}
                    required={k8sMode === "kubeconfig"}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5 text-violet-600" />
                可选：vCenter
              </CardTitle>
              <CardDescription>虚拟机列表会缓存在 Redis 中（TTL 可配），减少实时拉取</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>vcenterUrl</Label>
                <Input value={vcenterUrl} onChange={(e) => setVcenterUrl(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>vcenterUser</Label>
                  <Input value={vcenterUser} onChange={(e) => setVcenterUser(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>vcenterPassword</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={vcenterPassword}
                    onChange={(e) => setVcenterPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label className="cursor-pointer">跳过 TLS</Label>
                <Switch checked={vcenterInsecure} onCheckedChange={setVcenterInsecure} />
              </div>
              <div className="space-y-2">
                <Label>vcenterCacheTtlSec（Redis 缓存秒数）</Label>
                <Input
                  type="number"
                  min={10}
                  value={vcenterCacheTtlSec}
                  onChange={(e) => setVcenterCacheTtlSec(Number(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">可选：SSH 虚拟机凭据持久化</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={sshBackend || "none"}
                onValueChange={(v) => setSshBackend(v === "none" ? "" : "file")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不启用</SelectItem>
                  <SelectItem value="file">file（本地加密）</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {err}
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? "保存中…" : "保存并进入登录"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Setup;

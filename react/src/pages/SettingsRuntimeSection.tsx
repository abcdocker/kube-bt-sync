import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { apiGetJson, apiPutJson, type RuntimeSettingsDTO } from "@/lib/api";
import AccountPlatformSettingsBody from "@/pages/AccountPlatformSettingsBody";

export type SettingsRuntimeVariant = "full" | "k8s" | "vcenter" | "account";

type SettingsRuntimeSectionProps = {
  variant?: SettingsRuntimeVariant;
};

const SettingsRuntimeSection: React.FC<SettingsRuntimeSectionProps> = ({
  variant = "full",
}) => {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState<RuntimeSettingsDTO | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiGetJson<RuntimeSettingsDTO>("/api/settings/runtime");
      setForm(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setField = (key: string, value: unknown) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const onSave = async () => {
    if (!form) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const payload = { ...form } as Record<string, unknown>;
      const mh = String(payload.mysqlHost ?? "").trim();
      const mp = Number(payload.mysqlPort ?? 0);
      const mdb = String(payload.mysqlDatabase ?? "").trim();
      const mu = String(payload.mysqlUser ?? "").trim();
      if (mh && mp > 0 && mdb && mu) {
        payload.mysqlDsn = "";
      }
      const rh = String(payload.redisHost ?? "").trim();
      const rport = Number(payload.redisPort ?? 0);
      if (rh && rport > 0) {
        payload.redisAddr = "";
      }
      await apiPutJson("/api/settings/runtime", payload);
      setOk(variant === "k8s" ? "Saved and reloaded." : "已保存并重载配置");
      await queryClient.invalidateQueries({ queryKey: ["app-config"] });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {variant === "k8s" ? "Loading runtime settings…" : "加载运行时配置…"}
      </div>
    );
  }

  if (err && !form) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {err}
      </div>
    );
  }

  if (!form) return null;

  const v = variant;
  const showAccountFull = v === "full";
  const showK8s = v === "full" || v === "k8s";
  const showVCenter = v === "full" || v === "vcenter";
  const k8sMode = (form.k8s as { mode?: string } | undefined)?.mode ?? "none";
  const k8sKube = (form.k8s as { kubeconfigYaml?: string } | undefined)?.kubeconfigYaml ?? "";

  if (v === "account") {
    return (
      <AccountPlatformSettingsBody
        form={form}
        setField={setField}
        err={err}
        ok={ok}
        saving={saving}
        onSave={onSave}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
          <h2 className="text-base font-bold text-gray-900">
            {v === "k8s" && "Cluster connection"}
            {v === "vcenter" && "vCenter"}
            {v === "full" && "运行时配置（runtime-config.json）"}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {v === "full" &&
              "在此补充宝塔、K8s、vCenter；必填项（MySQL/Redis/平台 URL）须保持有效。Redis 仅需 IP、端口、密码；密钥类留空表示不修改原值。"}
            {v === "k8s" && "Use in-cluster credentials or paste kubeconfig. Applied after save."}
            {v === "vcenter" && "vCenter 与虚拟机 SSH 默认；保存后热重载。"}
          </p>
        </div>
        <div className="p-6 space-y-6 text-sm">
          {showAccountFull && (
            <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>platformPublicUrl</Label>
              <Input
                value={String(form.platformPublicUrl ?? "")}
                onChange={(e) => setField("platformPublicUrl", e.target.value)}
              />
            </div>
            {String(form.mysqlHost ?? "").trim() === "" &&
              String(form.mysqlDsn ?? "").trim() !== "" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-amber-800">当前 mysqlDsn（旧格式，请迁移到下方分字段后保存）</Label>
                  <Input
                    readOnly
                    className="font-mono text-xs bg-amber-50"
                    value={String(form.mysqlDsn ?? "")}
                  />
                </div>
              )}
            <div className="space-y-2 sm:col-span-2">
              <Label>MySQL 地址</Label>
              <Input
                value={String(form.mysqlHost ?? "")}
                onChange={(e) => setField("mysqlHost", e.target.value)}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="space-y-2">
              <Label>MySQL 端口</Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={Number(form.mysqlPort ?? 3306)}
                onChange={(e) => setField("mysqlPort", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>库名</Label>
              <Input
                value={String(form.mysqlDatabase ?? "")}
                onChange={(e) => setField("mysqlDatabase", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>用户</Label>
              <Input
                value={String(form.mysqlUser ?? "")}
                onChange={(e) => setField("mysqlUser", e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>MySQL 密码（留空或 *** 保留原值）</Label>
              <Input
                type="password"
                value={String(form.mysqlPassword ?? "")}
                onChange={(e) => setField("mysqlPassword", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Redis IP</Label>
              <Input
                value={String(form.redisHost ?? "")}
                onChange={(e) => setField("redisHost", e.target.value)}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="space-y-2">
              <Label>Redis 端口</Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={Number(form.redisPort ?? 6379)}
                onChange={(e) => setField("redisPort", Number(e.target.value))}
              />
            </div>
            {String(form.redisHost ?? "").trim() === "" &&
              String(form.redisAddr ?? "").trim() !== "" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-amber-800">当前 redisAddr（旧格式，请迁移到 IP+端口）</Label>
                  <Input
                    readOnly
                    className="font-mono text-xs bg-amber-50"
                    value={String(form.redisAddr ?? "")}
                  />
                </div>
              )}
            <div className="space-y-2 sm:col-span-2">
              <Label>Redis 密码（留空保留原值）</Label>
              <Input
                type="password"
                value={String(form.redisPassword ?? "")}
                onChange={(e) => setField("redisPassword", e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>encryptionKey（留空保留原值）</Label>
              <Input
                value={String(form.encryptionKey ?? "")}
                onChange={(e) => setField("encryptionKey", e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
            <span className="text-gray-700">Ingress ↔ 宝塔同步</span>
            <Switch
              checked={Boolean(form.ingressBaotaSyncEnabled)}
              onCheckedChange={(v) => setField("ingressBaotaSyncEnabled", v)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>baotaUrl</Label>
              <Input
                value={String(form.baotaUrl ?? "")}
                onChange={(e) => setField("baotaUrl", e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>baotaApiKey（留空保留）</Label>
              <Input
                type="password"
                value={String(form.baotaApiKey ?? "")}
                onChange={(e) => setField("baotaApiKey", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-gray-100 pt-6">
            <p className="text-sm font-semibold text-gray-900">控制台登录</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>dashboardUser</Label>
                <Input
                  value={String(form.dashboardUser ?? "")}
                  onChange={(e) => setField("dashboardUser", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>dashboardSessionDays</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={Number(form.dashboardSessionDays ?? 7)}
                  onChange={(e) => setField("dashboardSessionDays", Number(e.target.value))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>dashboardPassword（留空或 *** 保留）</Label>
                <Input
                  type="password"
                  value={String(form.dashboardPassword ?? "")}
                  onChange={(e) => setField("dashboardPassword", e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>dashboardSessionSecret（留空或 *** 保留）</Label>
                <Input
                  type="password"
                  value={String(form.dashboardSessionSecret ?? "")}
                  onChange={(e) => setField("dashboardSessionSecret", e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>dashboardListenAddr（如 :8080）</Label>
                <Input
                  value={String(form.dashboardListenAddr ?? "")}
                  onChange={(e) => setField("dashboardListenAddr", e.target.value)}
                  placeholder=":8080"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 sm:col-span-2">
                <span className="text-gray-700">dashboardCookieSecure（HTTPS）</span>
                <Switch
                  checked={Boolean(form.dashboardCookieSecure)}
                  onCheckedChange={(x) => setField("dashboardCookieSecure", x)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-gray-100 pt-6">
            <p className="text-sm font-semibold text-gray-900">OIDC（四项须同时填写或留空）</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>oidcIssuerUrl</Label>
                <Input
                  value={String(form.oidcIssuerUrl ?? "")}
                  onChange={(e) => setField("oidcIssuerUrl", e.target.value)}
                  placeholder="https://idp.example.com/application/o/kube-bt-sync/"
                />
              </div>
              <div className="space-y-2">
                <Label>oidcClientId</Label>
                <Input
                  value={String(form.oidcClientId ?? "")}
                  onChange={(e) => setField("oidcClientId", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>oidcClientSecret（留空或 *** 保留）</Label>
                <Input
                  type="password"
                  value={String(form.oidcClientSecret ?? "")}
                  onChange={(e) => setField("oidcClientSecret", e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>oidcRedirectUrl</Label>
                <Input
                  value={String(form.oidcRedirectUrl ?? "")}
                  onChange={(e) => setField("oidcRedirectUrl", e.target.value)}
                  placeholder="https://dashboard.example.com/api/auth/oidc/callback"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>oidcScopes（空格分隔，默认可留空使用服务端默认）</Label>
                <Input
                  value={String(form.oidcScopes ?? "")}
                  onChange={(e) => setField("oidcScopes", e.target.value)}
                  placeholder="openid profile email"
                />
              </div>
            </div>
          </div>
            </>
          )}
          {showK8s && (
          <>
          <div className="space-y-2">
            <Label>{v === "k8s" ? "Cluster mode" : "K8s 模式"}</Label>
            <Select
              value={k8sMode}
              onValueChange={(mode) =>
                setForm((prev) => ({
                  ...prev!,
                  k8s: {
                    ...(prev!.k8s as object),
                    mode,
                    kubeconfigYaml: mode === "kubeconfig" ? k8sKube : "",
                  },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="incluster">incluster</SelectItem>
                <SelectItem value="kubeconfig">kubeconfig</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {k8sMode === "kubeconfig" && (
            <div className="space-y-2">
              <Label>
                {v === "k8s"
                  ? "Kubeconfig YAML (*** if set; leave blank to keep existing)"
                  : "kubeconfigYaml（*** 表示已配置，留空保留）"}
              </Label>
              <Textarea
                className="min-h-[160px] font-mono text-xs"
                value={String((form.k8s as { kubeconfigYaml?: string })?.kubeconfigYaml ?? "")}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev!,
                    k8s: { ...(prev!.k8s as object), mode: "kubeconfig", kubeconfigYaml: e.target.value },
                  }))
                }
              />
            </div>
          )}
          </>
          )}
          {showVCenter && (
          <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>vcenterUrl</Label>
              <Input
                value={String(form.vcenterUrl ?? "")}
                onChange={(e) => setField("vcenterUrl", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>vcenterUser</Label>
              <Input
                value={String(form.vcenterUser ?? "")}
                onChange={(e) => setField("vcenterUser", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>vcenterPassword（留空保留）</Label>
              <Input
                type="password"
                value={String(form.vcenterPassword ?? "")}
                onChange={(e) => setField("vcenterPassword", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>vcenterCacheTtlSec</Label>
              <Input
                type="number"
                value={Number(form.vcenterCacheTtlSec ?? 120)}
                onChange={(e) => setField("vcenterCacheTtlSec", Number(e.target.value))}
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">虚拟机 SSH 终端（全局默认）</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                填写连接虚拟机的用户名与密码即可；端口固定为 22，凭据仅保存在服务端。若需私钥、其它端口或按虚拟机单独存凭据，请使用环境变量{" "}
                <code className="rounded bg-white px-1 text-[10px]">VCENTER_VM_SSH_*</code> 等配置。
              </p>
            </div>
            <div className="grid max-w-md gap-3">
              <div className="space-y-2">
                <Label>SSH 用户名</Label>
                <Input
                  value={String(form.vcenterVmSshUser ?? "")}
                  onChange={(e) => setField("vcenterVmSshUser", e.target.value)}
                  placeholder="如 root"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label>SSH 密码（留空或 *** 表示不修改已保存的密码）</Label>
                <Input
                  type="password"
                  value={String(form.vcenterVmSshPassword ?? "")}
                  onChange={(e) => setField("vcenterVmSshPassword", e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
          </>
          )}

          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">{err}</div>
          )}
          {ok && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
              {ok}
            </div>
          )}

          <Button type="button" onClick={() => void onSave()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {v === "k8s" ? "Saving…" : "保存中…"}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {v === "k8s" ? "Save" : "保存运行时配置"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsRuntimeSection;

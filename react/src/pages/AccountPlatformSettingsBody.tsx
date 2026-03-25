import React from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { RuntimeSettingsDTO } from "@/lib/api";

type Props = {
  form: RuntimeSettingsDTO;
  setField: (key: string, value: unknown) => void;
  err: string | null;
  ok: string | null;
  saving: boolean;
  onSave: () => void | Promise<void>;
};

/** 仅平台相关：多卡片拆分，不出现 Kubernetes / vCenter 分区标题 */
const AccountPlatformSettingsBody: React.FC<Props> = ({
  form,
  setField,
  err,
  ok,
  saving,
  onSave,
}) => {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">平台 URL</h2>
          <p className="mt-1 text-xs text-gray-500">对外访问基址（与业务路由、回调 URL 相关）</p>
        </div>
        <div className="p-6">
          <div className="space-y-2">
            <Label>platformPublicUrl</Label>
            <Input
              value={String(form.platformPublicUrl ?? "")}
              onChange={(e) => setField("platformPublicUrl", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">MySQL</h2>
          <p className="mt-1 text-xs text-gray-500">平台元数据存储；分字段填写后保存</p>
        </div>
        <div className="space-y-6 p-6 text-sm">
          {String(form.mysqlHost ?? "").trim() === "" &&
            String(form.mysqlDsn ?? "").trim() !== "" && (
              <div className="space-y-2">
                <Label className="text-amber-800">当前 mysqlDsn（旧格式，请迁移到下方分字段后保存）</Label>
                <Input
                  readOnly
                  className="bg-amber-50 font-mono text-xs"
                  value={String(form.mysqlDsn ?? "")}
                />
              </div>
            )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>主机</Label>
              <Input
                value={String(form.mysqlHost ?? "")}
                onChange={(e) => setField("mysqlHost", e.target.value)}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="space-y-2">
              <Label>端口</Label>
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
              <Label>密码（留空或 *** 保留原值）</Label>
              <Input
                type="password"
                value={String(form.mysqlPassword ?? "")}
                onChange={(e) => setField("mysqlPassword", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">Redis</h2>
          <p className="mt-1 text-xs text-gray-500">KV / 缓存；IP 与端口优先于旧版 redisAddr</p>
        </div>
        <div className="space-y-6 p-6 text-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>IP</Label>
              <Input
                value={String(form.redisHost ?? "")}
                onChange={(e) => setField("redisHost", e.target.value)}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="space-y-2">
              <Label>端口</Label>
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
                    className="bg-amber-50 font-mono text-xs"
                    value={String(form.redisAddr ?? "")}
                  />
                </div>
              )}
            <div className="space-y-2 sm:col-span-2">
              <Label>密码（留空保留原值）</Label>
              <Input
                type="password"
                value={String(form.redisPassword ?? "")}
                onChange={(e) => setField("redisPassword", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">加密</h2>
          <p className="mt-1 text-xs text-gray-500">SSH 凭据等敏感字段加密（留空保留原值）</p>
        </div>
        <div className="p-6">
          <div className="space-y-2">
            <Label>encryptionKey</Label>
            <Input
              value={String(form.encryptionKey ?? "")}
              onChange={(e) => setField("encryptionKey", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">Ingress 与宝塔</h2>
          <p className="mt-1 text-xs text-gray-500">同步开关与面板 API</p>
        </div>
        <div className="space-y-6 p-6 text-sm">
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
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">控制台登录</h2>
          <p className="mt-1 text-xs text-gray-500">本地账号、会话与监听地址</p>
        </div>
        <div className="space-y-4 p-6 text-sm">
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
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">OIDC</h2>
          <p className="mt-1 text-xs text-gray-500">四项须同时填写或全部留空；留空则沿用环境变量</p>
        </div>
        <div className="space-y-4 p-6 text-sm">
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
              <Label>oidcScopes（空格分隔，默认可留空）</Label>
              <Input
                value={String(form.oidcScopes ?? "")}
                onChange={(e) => setField("oidcScopes", e.target.value)}
                placeholder="openid profile email"
              />
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      )}
      {ok && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {ok}
        </div>
      )}

      <Button type="button" onClick={() => void onSave()} disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            保存中…
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            保存并重载
          </>
        )}
      </Button>
    </div>
  );
};

export default AccountPlatformSettingsBody;

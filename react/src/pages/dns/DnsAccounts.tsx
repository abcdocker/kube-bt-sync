import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, RefreshCw, Trash2, Pencil, CheckCircle, XCircle, CloudDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiDeleteJson, apiGetJson, apiPostJson, apiPutJson } from "@/lib/api";
import { useAuth } from "@/auth/auth-context";
import { toast } from "sonner";

type Account = {
  id: number;
  name: string;
  provider: string;
  remark: string;
  createdBy: string;
  createdAt: string;
};

const PROVIDERS = [
  { value: "cloudflare", label: "Cloudflare", fields: [{ key: "apiToken", label: "API Token", placeholder: "Bearer Token（推荐 Edit zone DNS 权限）" }] },
  { value: "aliyun", label: "阿里云 DNS", fields: [
    { key: "accessKeyId", label: "AccessKey ID", placeholder: "" },
    { key: "accessKeySecret", label: "AccessKey Secret", placeholder: "" },
  ]},
  { value: "tencent", label: "腾讯云 DNS", fields: [
    { key: "secretId", label: "SecretId", placeholder: "" },
    { key: "secretKey", label: "SecretKey", placeholder: "" },
  ]},
  { value: "dnspod", label: "DNSPod", fields: [
    { key: "secretId", label: "SecretId", placeholder: "" },
    { key: "secretKey", label: "SecretKey", placeholder: "" },
  ]},
  { value: "dnspod_token", label: "DNSPod Token", fields: [
    { key: "appId", label: "APPID", placeholder: "如：1252194796" },
    { key: "token", label: "Token", placeholder: "DNSPod 控制台生成的 Token" },
  ]},
  { value: "manual", label: "手动管理", fields: [] },
];

const PROVIDER_BADGE: Record<string, string> = {
  cloudflare: "bg-orange-50 text-orange-700",
  aliyun: "bg-blue-50 text-blue-700",
  tencent: "bg-cyan-50 text-cyan-700",
  dnspod: "bg-teal-50 text-teal-700",
  dnspod_token: "bg-teal-50 text-teal-700",
  manual: "bg-slate-50 text-slate-700",
};

function fmtErr(e: unknown) {
  return (e as Error).message ?? String(e);
}

type FormState = { name: string; provider: string; config: Record<string, string>; remark: string };
const defaultForm = (): FormState => ({ name: "", provider: "cloudflare", config: {}, remark: "" });

export default function DnsAccounts() {
  const { status: auth } = useAuth();
  const isViewer = auth?.role !== "admin";
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: ["dns-accounts"],
    queryFn: ({ signal }) => apiGetJson<{ accounts: Account[] }>("/api/dns/accounts", { signal }),
  });
  const accounts = listQ.data?.accounts ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editID, setEditID] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [deleteID, setDeleteID] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; ok: boolean; msg: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ id: number; msg: string } | null>(null);

  const providerDef = PROVIDERS.find((p) => p.value === form.provider) ?? PROVIDERS[0];

  const openCreate = () => {
    setEditID(null);
    setForm(defaultForm());
    setDialogOpen(true);
  };
  const openEdit = async (acc: Account) => {
    const data = await apiGetJson<{ config: Record<string, string> } & Account>(`/api/dns/accounts/${acc.id}`);
    setEditID(acc.id);
    setForm({ name: acc.name, provider: acc.provider, config: data.config ?? {}, remark: acc.remark });
    setDialogOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = { name: form.name, provider: form.provider, config: form.config, remark: form.remark };
      if (editID !== null) {
        return apiPutJson(`/api/dns/accounts/${editID}`, body);
      }
      return apiPostJson("/api/dns/accounts", body);
    },
    onSuccess: () => {
      toast.success(editID !== null ? "账号已更新" : "账号已创建");
      setDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ["dns-accounts"] });
    },
    onError: (e) => toast.error(fmtErr(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDeleteJson(`/api/dns/accounts/${id}`),
    onSuccess: () => {
      toast.success("账号已删除");
      setDeleteID(null);
      void qc.invalidateQueries({ queryKey: ["dns-accounts"] });
    },
    onError: (e) => toast.error(fmtErr(e)),
  });

  const testMut = useMutation({
    mutationFn: async (acc: Account) => {
      return apiPostJson<{ ok: boolean; message?: string; error?: string; recordCount?: number }>(
        `/api/dns/accounts/${acc.id}/test`, { domain: "" });
    },
    onSuccess: (r, acc) => {
      const msg = r.ok
        ? `连接成功${r.recordCount !== undefined ? `，获取到 ${r.recordCount} 条记录` : ""}`
        : r.error ?? "测试失败";
      setTestResult({ id: acc.id, ok: r.ok, msg });
    },
    onError: (e, acc) => setTestResult({ id: acc.id, ok: false, msg: fmtErr(e) }),
  });

  const syncDomainsMut = useMutation({
    mutationFn: async (acc: Account) =>
      apiPostJson<{ message: string; total: number; added: number }>(
        `/api/dns/accounts/${acc.id}/sync-domains`, {}),
    onSuccess: (r, acc) => {
      setSyncResult({ id: acc.id, msg: `已同步 ${r.total} 个域名，新增 ${r.added} 个` });
      void qc.invalidateQueries({ queryKey: ["dns-domains"] });
    },
    onError: (e, acc) => setSyncResult({ id: acc.id, msg: fmtErr(e) }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">服务商账号</h2>
          <p className="text-sm text-slate-500">管理 Cloudflare、阿里云、腾讯云等 DNS 服务商的 API 凭证</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["dns-accounts"] })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {!isViewer && (
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> 添加账号
            </Button>
          )}
        </div>
      </div>

      {listQ.isLoading && <p className="text-sm text-slate-500">加载中…</p>}
      {listQ.isError && <p className="text-sm text-red-600">{fmtErr(listQ.error)}</p>}

      {accounts.length === 0 && !listQ.isLoading && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-400">
          暂无服务商账号，点击「添加账号」开始接入
        </div>
      )}

      {accounts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>名称</TableHead>
                <TableHead>服务商</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>创建人</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell className="font-medium text-slate-800">{acc.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${PROVIDER_BADGE[acc.provider] ?? "bg-slate-50 text-slate-700"}`}>
                      {PROVIDERS.find((p) => p.value === acc.provider)?.label ?? acc.provider}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500 text-sm">{acc.remark || "—"}</TableCell>
                  <TableCell className="text-sm text-slate-500">{acc.createdBy || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {testResult?.id === acc.id && (
                        <span className={`mr-2 flex items-center gap-1 text-xs ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                          {testResult.ok
                            ? <CheckCircle className="h-3.5 w-3.5" />
                            : <XCircle className="h-3.5 w-3.5" />}
                          {testResult.msg}
                        </span>
                      )}
                      {syncResult?.id === acc.id && (
                        <span className="mr-2 text-xs text-blue-600">{syncResult.msg}</span>
                      )}
                      <Button
                        variant="outline" size="sm"
                        disabled={testMut.isPending}
                        onClick={() => testMut.mutate(acc)}
                      >
                        {testMut.isPending && testMut.variables?.id === acc.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : "测试连接"}
                      </Button>
                      {!isViewer && (
                        <Button
                          variant="outline" size="sm"
                          title="从服务商同步域名列表"
                          disabled={syncDomainsMut.isPending}
                          onClick={() => syncDomainsMut.mutate(acc)}
                        >
                          {syncDomainsMut.isPending && syncDomainsMut.variables?.id === acc.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <><CloudDownload className="h-3.5 w-3.5" /><span className="ml-1">同步域名</span></>}
                        </Button>
                      )}
                      {!isViewer && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => void openEdit(acc)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                            onClick={() => setDeleteID(acc.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {editID !== null ? "编辑服务商账号" : "添加服务商账号"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>账号名称</Label>
              <Input placeholder="eg. 我的 Cloudflare" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>服务商</Label>
              <Select value={form.provider}
                onValueChange={(v) => setForm((f) => ({ ...f, provider: v, config: {} }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {providerDef.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label>{field.label}</Label>
                <Input
                  type="password"
                  placeholder={field.placeholder}
                  value={form.config[field.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, [field.key]: e.target.value } }))}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Input placeholder="可选" value={form.remark}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name}>
              {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteID !== null} onOpenChange={(o) => !o && setDeleteID(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除服务商账号</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该账号下的域名将无法同步解析记录，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button variant="destructive" onClick={() => deleteID !== null && deleteMut.mutate(deleteID)}>
              {deleteMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

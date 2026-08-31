import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertCircle, Server, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiGetJson } from "@/lib/api";
import { CloudAuthGuide } from "./CloudAuthGuide";

function fmtErr(e: unknown) {
  return (e as Error).message ?? String(e);
}

type Account = { id: number; name: string; provider: string };

type CVMInstance = {
  InstanceId: string;
  InstanceName: string;
  InstanceType: string;
  InstanceState: string;
  CPU: number;
  Memory: number;
  PublicIpAddresses?: string[];
  PrivateIpAddresses?: string[];
  Zone: string;
  ImageName: string;
  CreatedTime: string;
  ExpiredTime: string;
};

export default function TencentCloudCVM() {
  const [accountId, setAccountId] = useState<string>("all");

  const accountsQ = useQuery({
    queryKey: ["dns-accounts"],
    queryFn: ({ signal }) => apiGetJson<{ accounts: Account[] }>("/api/dns/accounts", { signal }),
  });
  const tencentAccounts = (accountsQ.data?.accounts ?? []).filter((a) =>
    ["tencent", "tencentcloud", "dnspod"].includes(a.provider)
  );

  const cvmQ = useQuery({
    queryKey: ["tencent-cloud-cvm", accountId],
    queryFn: async ({ signal }) => {
      if (accountId === "all") {
        const all: (CVMInstance & { accountName: string })[] = [];
        for (const acc of tencentAccounts) {
          try {
            const res = await apiGetJson<{ instances: CVMInstance[] }>(
              `/api/tencent-cloud/cvm/instances?account_id=${acc.id}`,
              { signal }
            );
            for (const inst of res.instances ?? []) {
              all.push({ ...inst, accountName: acc.name });
            }
          } catch {
            /* ignore per-account errors in aggregate mode */
          }
        }
        return { instances: all };
      }
      const res = await apiGetJson<{ instances: CVMInstance[] }>(
        `/api/tencent-cloud/cvm/instances?account_id=${accountId}`,
        { signal }
      );
      const acc = tencentAccounts.find((a) => String(a.id) === accountId);
      return {
        instances: (res.instances ?? []).map((i) => ({ ...i, accountName: acc?.name ?? "" })),
      };
    },
    enabled: tencentAccounts.length > 0,
  });

  const instances = (cvmQ.data?.instances ?? []) as (CVMInstance & { accountName: string })[];

  const stateColor = (s: string) => {
    if (s === "RUNNING") return "bg-emerald-50 text-emerald-700";
    if (s === "STOPPED") return "bg-slate-50 text-slate-700";
    return "bg-amber-50 text-amber-700";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">云服务器 CVM</h2>
          <p className="text-sm text-slate-500">查看腾讯云云服务器实例信息</p>
        </div>
        <div className="w-56">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="选择账号" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部账号</SelectItem>
              {tencentAccounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <CloudAuthGuide provider="tencent" />

      {cvmQ.isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      )}
      {cvmQ.isError && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" /> {fmtErr(cvmQ.error)}
        </div>
      )}

      {instances.length === 0 && !cvmQ.isLoading && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-400">
          该账号下暂无云服务器实例
        </div>
      )}

      {instances.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>实例名称</TableHead>
                <TableHead>实例 ID</TableHead>
                {accountId === "all" && <TableHead>所属账号</TableHead>}
                <TableHead>状态</TableHead>
                <TableHead>公网 IP</TableHead>
                <TableHead>配置</TableHead>
                <TableHead>可用区</TableHead>
                <TableHead>系统</TableHead>
                <TableHead>到期时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instances.map((inst) => (
                <TableRow key={inst.InstanceId}>
                  <TableCell className="font-medium text-slate-800">{inst.InstanceName}</TableCell>
                  <TableCell className="text-xs text-slate-500">{inst.InstanceId}</TableCell>
                  {accountId === "all" && <TableCell className="text-sm text-slate-600">{inst.accountName}</TableCell>}
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${stateColor(inst.InstanceState)}`}>
                      {inst.InstanceState}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{inst.PublicIpAddresses?.join(", ") || "—"}</TableCell>
                  <TableCell className="text-sm text-slate-600">{inst.CPU}核 / {inst.Memory}GB</TableCell>
                  <TableCell className="text-sm text-slate-600">{inst.Zone}</TableCell>
                  <TableCell className="text-sm text-slate-600">{inst.ImageName || "—"}</TableCell>
                  <TableCell className="text-sm text-slate-600">{inst.ExpiredTime ? inst.ExpiredTime.replace("T", " ").slice(0, 19) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

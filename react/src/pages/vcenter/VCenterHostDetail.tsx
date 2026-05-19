import React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { apiGetJson } from "@/lib/api";
import type { VCenterHostDetailResponse } from "./types";
import { VCenterHostPrometheusDetail } from "./VCenterHostPrometheusDetail";

const VCenterHostDetail: React.FC = () => {
  const { moref = "" } = useParams<{ moref: string }>();
  const decoded = decodeURIComponent(moref);

  const detailQ = useQuery({
    queryKey: ["vcenter-host", decoded],
    queryFn: ({ signal }) =>
      apiGetJson<VCenterHostDetailResponse>(
        `/api/vcenter/hosts/${encodeURIComponent(decoded)}`,
        { signal }
      ),
    enabled: decoded.length > 0,
  });

  const h = detailQ.data?.host;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/cluster/vcenter/hosts"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          宿主机列表
        </Link>
      </div>

      {detailQ.isLoading && <p className="text-sm text-slate-500">加载中…</p>}
      {detailQ.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{(detailQ.error as Error).message}</p>
      )}

      {h?.name ? (
        <VCenterHostPrometheusDetail
          moref={decoded}
          hostName={h.name}
          managementVmkIp={h.managementVmkIp}
        />
      ) : null}
    </div>
  );
};

export default VCenterHostDetail;

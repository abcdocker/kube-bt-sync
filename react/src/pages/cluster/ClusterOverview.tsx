import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, Boxes, Layers, Network } from "lucide-react";
import { apiGetJson } from "@/lib/api";
import StatCard from "@/components/StatCard";
import ClusterPrometheusPanel from "./ClusterPrometheusPanel";
import type { K8sSummary } from "./types";

const ClusterOverview: React.FC = () => {
  const summaryQ = useQuery({
    queryKey: ["k8s-summary"],
    queryFn: () => apiGetJson<K8sSummary>("/api/k8s/summary"),
  });

  return (
    <>
      {summaryQ.isLoading && <p className="text-gray-500">加载中…</p>}
      {summaryQ.error && <p className="text-red-600">{(summaryQ.error as Error).message}</p>}
      {summaryQ.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Namespaces"
            value={String(summaryQ.data.namespaceCount)}
            icon={Layers}
            color="blue"
          />
          <StatCard
            title="Pods"
            value={String(summaryQ.data.podCount)}
            icon={Boxes}
            color="green"
          />
          <StatCard
            title="Services"
            value={String(summaryQ.data.serviceCount)}
            icon={Network}
            color="orange"
          />
          <StatCard
            title="Nodes"
            value={String(summaryQ.data.nodeCount)}
            icon={ActivityIcon}
            color="purple"
          />
        </div>
      )}
      <div className="mt-10">
        <ClusterPrometheusPanel />
      </div>
    </>
  );
};

export default ClusterOverview;

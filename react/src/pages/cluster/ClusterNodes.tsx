import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGetJson } from "@/lib/api";
import type { NodeRow } from "./types";

const ClusterNodes: React.FC = () => {
  const nodesQ = useQuery({
    queryKey: ["k8s-nodes"],
    queryFn: () => apiGetJson<NodeRow[]>("/api/k8s/nodes"),
  });

  return (
    <>
      {nodesQ.isLoading && <p className="text-gray-500">加载中…</p>}
      {nodesQ.error && <p className="text-red-600">{(nodesQ.error as Error).message}</p>}
      {nodesQ.data && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Ready</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Internal IP</TableHead>
                <TableHead>Kubelet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodesQ.data.map((n) => (
                <TableRow key={n.name}>
                  <TableCell className="font-mono text-xs">{n.name}</TableCell>
                  <TableCell>{n.ready}</TableCell>
                  <TableCell>{n.roles.join(", ")}</TableCell>
                  <TableCell className="font-mono text-xs">{n.internalIP}</TableCell>
                  <TableCell className="text-xs">{n.kubelet}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
};

export default ClusterNodes;

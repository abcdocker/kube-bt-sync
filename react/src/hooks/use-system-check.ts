import { useQuery } from "@tanstack/react-query";
import { apiGetJson, type SystemCheck } from "@/lib/api";

/** 与后端 BAOTA_CHECK_MIN_INTERVAL_SEC 配合，减少对宝塔 TCP 探活的重复拨号 */
const STALE_MS = 90_000;
const REFETCH_MS = 120_000;

export function useSystemCheckQuery() {
  return useQuery({
    queryKey: ["system-check"],
    queryFn: () => apiGetJson<SystemCheck>("/api/system/check"),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: false,
  });
}

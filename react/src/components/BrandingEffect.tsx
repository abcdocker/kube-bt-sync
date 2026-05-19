import { useEffect } from "react";
import { APP_CONFIG_QUERY_KEY } from "@/hooks/use-app-config";
import { useQuery } from "@tanstack/react-query";
import { apiGetJson, type AppConfig } from "@/lib/api";

/** 将平台名称、favicon 应用到 document（与 /api/config 同步） */
export default function BrandingEffect() {
  const { data: cfg } = useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: ({ signal }) => apiGetJson<AppConfig>("/api/config", { signal }),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const name = cfg?.platformDisplayName?.trim();
    document.title = name && name.length > 0 ? name : "Kube-BT-Sync";
  }, [cfg?.platformDisplayName]);

  useEffect(() => {
    const href = cfg?.platformFaviconUrl?.trim();
    if (!href) return;
    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [cfg?.platformFaviconUrl]);

  return null;
}

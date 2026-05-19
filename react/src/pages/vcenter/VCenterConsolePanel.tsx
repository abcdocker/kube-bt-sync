import React, { useMemo } from "react";
import { useAppConfig } from "@/hooks/use-app-config";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { apiGetJson, type AppConfig } from "@/lib/api";
import type { VCenterConsoleHtmlResponse, VCenterWebmksResponse } from "./types";

const VCenterConsolePanel: React.FC<{ moref: string }> = ({ moref }) => {
  const cfgQ = useAppConfig();

  const consoleHtmlQ = useQuery({
    queryKey: ["vcenter-console-html", moref],
    queryFn: ({ signal }) =>
      apiGetJson<VCenterConsoleHtmlResponse>(
        `/api/vcenter/vms/${encodeURIComponent(moref)}/console-html`
      , { signal }),
  });

  const webmksQ = useQuery({
    queryKey: ["vcenter-webmks", moref],
    queryFn: ({ signal }) =>
      apiGetJson<VCenterWebmksResponse>(
        `/api/vcenter/vms/${encodeURIComponent(moref)}/webmks`
      , { signal }),
  });

  const proxyWsUrl = useMemo(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/api/vcenter/vms/${encodeURIComponent(moref)}/console-ws`;
  }, [moref]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const cfg = cfgQ.data;
  const loginUrl = cfg?.vcenterUiLoginUrl ?? "";
  const consoleUrl = consoleHtmlQ.data?.url;
  const clientVmUrl = consoleHtmlQ.data?.vsphereClientUrl;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50/80 p-4 text-sm text-gray-800">
        <p className="font-medium text-gray-900">推荐：vSphere 官方网页控制台</p>
        <p className="mt-2 text-gray-700">
          <code className="rounded bg-white px-1 text-xs">webconsole.html</code> 的{" "}
          <code className="rounded bg-white px-1 text-xs">vmId</code> 须为完整 MoURN（
          <code className="rounded bg-white px-1 text-xs">
            urn:vmomi:VirtualMachine:vm-2041:&lt;instanceUuid&gt;
          </code>
          ），仅 <code className="rounded bg-white px-1 text-xs">vm-2041</code> 会报{" "}
          <strong>Input is required</strong>。另提供与客户端一致的摘要深链（需已登录 SSO）。
        </p>
        <p className="mt-2 text-gray-700">
          vCenter 通常下发{" "}
          <code className="rounded bg-white px-1 text-xs">
            Content-Security-Policy: frame-ancestors &apos;self&apos;
          </code>
          ，只允许 <strong>与 vCenter 同源</strong> 的页面嵌入，因此本面板（如 localhost 或其它域名）
          <strong> 无法在 iframe 里打开 </strong>
          vSphere，这是服务端安全策略，无法由本应用绕过。请一律使用下方「新窗口打开」。
        </p>
        <p className="mt-2 text-gray-700">
          使用 <strong>Nginx + SSO</strong> 时：先在新标签完成登录，再打开摘要或 webconsole 链接。
        </p>
      </div>

      {loginUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.open(loginUrl, "_blank", "noopener,noreferrer")}
          >
            1. 打开 vCenter 登录（SSO）
          </Button>
          <span className="text-xs text-gray-500">{loginUrl}</span>
        </div>
      )}

      {consoleHtmlQ.isLoading && (
        <p className="text-sm text-gray-500">正在生成控制台链接…</p>
      )}
      {consoleHtmlQ.error && (
        <p className="text-sm text-red-600">
          {(consoleHtmlQ.error as Error).message}
        </p>
      )}
      {consoleHtmlQ.data?.hint && (
        <p className="text-xs text-gray-600">{consoleHtmlQ.data.hint}</p>
      )}

      {clientVmUrl && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/90 p-4 text-sm">
          <p className="font-medium text-emerald-900">已登录 SSO 时（与本地一致）</p>
          <p className="mt-1 text-xs text-emerald-800">
            打开与 vSphere Client 地址栏相同的虚拟机摘要页，再在页面里操作控制台：
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="border-emerald-300 bg-white"
              onClick={() =>
                window.open(clientVmUrl, "_blank", "noopener,noreferrer")
              }
            >
              打开虚拟机摘要（Client 深链）
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(clientVmUrl)}
            >
              复制摘要链接
            </Button>
          </div>
        </div>
      )}

      {consoleUrl && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() =>
              window.open(consoleUrl, "_blank", "noopener,noreferrer")
            }
          >
            新窗口打开 webconsole.html（CloneSession）
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copy(consoleUrl)}
          >
            复制 webconsole 链接
          </Button>
        </div>
      )}

      <Accordion type="single" collapsible className="rounded-lg border border-gray-200">
        <AccordionItem value="adv">
          <AccordionTrigger className="px-4 text-sm">
            高级：WebMKS 直连 / 同源代理（可选）
          </AccordionTrigger>
          <AccordionContent className="space-y-3 px-4 pb-4 text-sm text-gray-600">
            <p>
              仅在需要排查或自建 WMKS 客户端时使用。同源 WebSocket：{" "}
              <code className="break-all rounded bg-gray-100 px-1 text-xs">
                {proxyWsUrl}
              </code>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copy(proxyWsUrl)}
              >
                复制代理地址
              </Button>
              {webmksQ.data?.wssUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(webmksQ.data.wssUrl)}
                >
                  复制直连 ESXi wssUrl
                </Button>
              )}
            </div>
            {webmksQ.data?.hint && (
              <p className="text-xs">{webmksQ.data.hint}</p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default VCenterConsolePanel;

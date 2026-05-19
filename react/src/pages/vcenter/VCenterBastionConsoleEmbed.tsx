import React, { useEffect, useRef, useState } from "react";
import { useAppConfig } from "@/hooks/use-app-config";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGetJson, type AppConfig, wsUrlForApiPath } from "@/lib/api";
import { bastionJqueryUrls } from "@/lib/assets-cdn";

type WmksLike = {
  connect: (url: string) => void;
  disconnect?: () => void;
  destroy?: () => void;
};

function loadStylesheetOnce(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sel = `script[src="${src}"]`;
    if (document.querySelector(sel)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(src));
    document.head.appendChild(s);
  });
}

function wmksCreateFactory():
  | ((id: string, o: Record<string, unknown>) => WmksLike)
  | undefined {
  const g = window as unknown as {
    WMKS?: { createWMKS?: (id: string, o: Record<string, unknown>) => WmksLike };
    VMwareWMKS?: { createWMKS?: (id: string, o: Record<string, unknown>) => WmksLike };
  };
  if (g.WMKS && typeof g.WMKS.createWMKS === "function") return g.WMKS.createWMKS;
  if (g.VMwareWMKS && typeof g.VMwareWMKS.createWMKS === "function") return g.VMwareWMKS.createWMKS;
  return undefined;
}

function jQueryWmksPlugin(): ((...args: unknown[]) => unknown) | undefined {
  const $ = (window as unknown as { jQuery?: { fn?: Record<string, unknown> } }).jQuery;
  const fn = $?.fn;
  if (!fn) return undefined;
  if (typeof fn.wmks === "function") return fn.wmks as (...args: unknown[]) => unknown;
  if (typeof fn.WMKS === "function") return fn.WMKS as (...args: unknown[]) => unknown;
  return undefined;
}

function wmksApiLikelyReady(): boolean {
  return Boolean(wmksCreateFactory() || jQueryWmksPlugin());
}

function tryCreateWmks(containerId: string, wsUrl: string): { inst: WmksLike; cleanup: () => void } | null {
  const create = wmksCreateFactory();
  if (create) {
    try {
      const inst = create(containerId, {});
      inst.connect(wsUrl);
      return {
        inst,
        cleanup: () => {
          try {
            inst.disconnect?.();
            inst.destroy?.();
          } catch {
            /* ignore */
          }
        },
      };
    } catch {
      /* fall through to jQuery */
    }
  }

  const $ = (window as unknown as { jQuery?: (sel: string) => unknown }).jQuery;
  if ($) {
    const $el = $(`#${containerId}`) as {
      wmks?: (...a: unknown[]) => void;
      WMKS?: (...a: unknown[]) => void;
    };
    const invoke = typeof $el.wmks === "function" ? $el.wmks.bind($el) : typeof $el.WMKS === "function" ? $el.WMKS.bind($el) : null;
    if (invoke) {
      try {
        invoke({});
        invoke("connect", wsUrl);
        return {
          inst: { connect: () => {} },
          cleanup: () => {
            try {
              invoke("disconnect");
            } catch {
              /* ignore */
            }
          },
        };
      } catch {
        return null;
      }
    }
  }

  return null;
}

function waitForWmksGlobals(maxMs: number, stepMs: number, cancelled: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (cancelled()) {
        resolve(false);
        return;
      }
      if (wmksApiLikelyReady()) {
        resolve(true);
        return;
      }
      if (performance.now() - start >= maxMs) {
        resolve(wmksApiLikelyReady());
        return;
      }
      window.setTimeout(tick, stepMs);
    };
    tick();
  });
}

/**
 * 全屏 WebMKS。HTML Console SDK 依赖 jQuery + jQuery UI 先于 wmks.min.js 加载。
 */
const VCenterBastionConsoleEmbed: React.FC = () => {
  const { moref = "" } = useParams<{ moref: string }>();
  const dec = decodeURIComponent(moref);
  const cfgQ = useAppConfig();
  const rootRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState("正在准备 WebMKS（加载 jQuery / WMKS）…");

  const wsUrl = wsUrlForApiPath(`/api/vcenter/vms/${encodeURIComponent(dec)}/console-ws`);

  useEffect(() => {
    if (!dec) {
      setMsg("缺少虚拟机 moRef。");
      return;
    }
    if (!cfgQ.data) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const run = async () => {
      const cfg = cfgQ.data;
      const jq = bastionJqueryUrls(cfg);
      try {
        loadStylesheetOnce(jq.jqueryUiCss);
        await loadScriptOnce(jq.jquery);
        await loadScriptOnce(jq.jqueryUiJs);
      } catch (e) {
        if (!cancelled) {
          setMsg(
            "加载 jQuery / jQuery UI 失败（可能被 CSP 拦截）。请在后台配置静态资源 CDN 并上传 edge/jquery* 文件，或允许访问默认脚本域名。"
          );
        }
        return;
      }

      const css = [cfg.vcenterWmksCssUrl, ...(cfg.vcenterWmksCssUrlCandidates ?? [])].filter(
        Boolean
      ) as string[];
      const js = [cfg.vcenterWmksScriptUrl, ...(cfg.vcenterWmksScriptUrlCandidates ?? [])].filter(
        Boolean
      ) as string[];

      for (const href of css) {
        try {
          loadStylesheetOnce(href);
        } catch {
          /* ignore */
        }
      }

      let loaded = false;
      for (const src of js) {
        try {
          await loadScriptOnce(src);
          loaded = true;
          break;
        } catch {
          /* try next */
        }
      }
      if (cancelled) return;
      if (!loaded) {
        setMsg("无法加载 WMKS 脚本，请配置 VCENTER_WMKS_SCRIPT_URL。");
        return;
      }

      const ready = await waitForWmksGlobals(4000, 40, () => cancelled);
      if (cancelled) return;
      if (!ready) {
        setMsg(
          "WMKS 脚本已加载，但仍未暴露 WMKS / VMwareWMKS.createWMKS 或 jQuery.wmks（部分版本延后挂载 API，可刷新重试；并确认与 vCenter 版本匹配的 wmks.min.js 且已加载 jQuery UI）。"
        );
        return;
      }

      const host = rootRef.current;
      if (!host) return;
      const id = "wmks-bastion-canvas";
      host.innerHTML = "";
      const inner = document.createElement("div");
      inner.id = id;
      inner.style.width = "100%";
      inner.style.height = "100%";
      host.appendChild(inner);

      let created: { inst: WmksLike; cleanup: () => void } | null = null;
      for (let attempt = 0; attempt < 8 && !created; attempt++) {
        if (attempt > 0) {
          await new Promise<void>((r) => {
            requestAnimationFrame(() => requestAnimationFrame(() => r()));
          });
        }
        created = tryCreateWmks(id, wsUrl);
      }
      if (!created) {
        setMsg(
          "WMKS API 已检测到，但创建实例失败（请确认 wmks.min.js 与 vCenter 版本一致，且 jQuery UI 在 WMKS 之前加载）。"
        );
        return;
      }
      cleanup = created.cleanup;
      setMsg("");
    };

    void run();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [cfgQ.data, dec, wsUrl]);

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      {msg ? (
        <div className="absolute inset-x-0 top-0 z-10 border-b border-amber-900/50 bg-amber-950/95 px-3 py-2 text-center text-xs text-amber-100">
          {msg}
        </div>
      ) : null}
      <div ref={rootRef} className="h-full w-full" />
    </div>
  );
};

export default VCenterBastionConsoleEmbed;

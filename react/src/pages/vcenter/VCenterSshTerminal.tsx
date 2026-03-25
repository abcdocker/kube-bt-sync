import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { apiGetJson, type AppConfig } from "@/lib/api";
import { kubeBtXtermOptions } from "@/lib/xtermShared";

function buildVCenterSshWsUrl(moref: string): string {
  const path = `/api/vcenter/vms/${encodeURIComponent(moref)}/ssh/ws`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

type VCenterSshTerminalProps = {
  moref: string;
  /** 展示用：vCenter 上报的 Guest 主 IP */
  guestIpHint?: string;
};

const VCenterSshTerminal: React.FC<VCenterSshTerminalProps> = ({
  moref,
  guestIpHint,
}) => {
  const cfgQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });

  const wrapRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">(
    "idle"
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const prev = disposeRef.current;
    prev?.();
    disposeRef.current = null;

    if (!started || !moref) {
      setStatus("idle");
      setErrMsg(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const el = wrapRef.current;
      if (!el || cancelled) return;

      const term = new XTerm(kubeBtXtermOptions);
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();

      setStatus("connecting");
      setErrMsg(null);

      const wsUrl = buildVCenterSshWsUrl(moref);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      const sendResize = () => {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };

      ws.onopen = () => {
        if (cancelled) return;
        setStatus("open");
        sendResize();
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (cancelled) return;
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        } else if (typeof ev.data === "string") {
          term.write(ev.data);
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setErrMsg("WebSocket 失败（请确认已登录面板，且服务端能访问虚拟机 Guest IP:SSH 端口）");
        setStatus("error");
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        term.write("\r\n\x1b[33m[连接已关闭]\x1b[0m\r\n");
      };

      const sub = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });

      const onWinResize = () => sendResize();
      window.addEventListener("resize", onWinResize);
      const ro = new ResizeObserver(() => sendResize());
      ro.observe(el);

      disposeRef.current = () => {
        window.removeEventListener("resize", onWinResize);
        ro.disconnect();
        sub.dispose();
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        term.dispose();
      };
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      disposeRef.current?.();
      disposeRef.current = null;
    };
  }, [started, moref]);

  const sshOk = cfgQ.data?.vcenterVmSshConfigured === true;

  return (
    <div className="space-y-3">
      {!sshOk && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">未启用 SSH 终端</p>
          <p className="mt-2 text-xs leading-relaxed">
            在服务端配置 SSH 用户名与密码即可（端口默认 22）。已初始化时可在{" "}
            <Link
              to="/cluster/vcenter/settings"
              className="font-medium text-amber-950 underline underline-offset-2"
            >
              vCenter 设置
            </Link>{" "}
            中填写「虚拟机 SSH 终端」；也可设置环境变量{" "}
            <code className="rounded bg-white px-1">VCENTER_VM_SSH_USER</code> 与{" "}
            <code className="rounded bg-white px-1">VCENTER_VM_SSH_PASSWORD</code>。
            本进程须能直连 Guest IP，凭据不经过浏览器。
          </p>
        </div>
      )}

      {sshOk && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
            <span>
              目标 IP 由 vCenter Guest 信息决定
              {guestIpHint ? (
                <>
                  ，当前上报：<span className="font-mono text-gray-900">{guestIpHint}</span>
                </>
              ) : (
                "（请确保已安装 Tools 并拿到 IP）"
              )}
            </span>
            <div className="flex gap-2">
              {!started ? (
                <Button type="button" size="sm" onClick={() => setStarted(true)}>
                  连接 SSH
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    disposeRef.current?.();
                    disposeRef.current = null;
                    setStarted(false);
                    setStatus("idle");
                    setErrMsg(null);
                  }}
                >
                  断开
                </Button>
              )}
            </div>
          </div>
          {started && (
            <p className="text-xs text-gray-500">
              {status === "connecting" && "正在连接…"}
              {status === "open" && "已连接 SSH"}
              {status === "closed" && "已断开"}
              {status === "error" && "连接出错"}
            </p>
          )}
          {errMsg && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errMsg}
            </div>
          )}
          {started && (
            <div
              ref={wrapRef}
              className="vc-ssh-xterm-host h-[420px] max-h-[min(560px,70vh)] min-h-[280px] w-full shrink-0 overflow-hidden rounded-lg border border-gray-800 bg-[#1e1e1e] p-2"
            />
          )}
        </>
      )}
    </div>
  );
};

export default VCenterSshTerminal;

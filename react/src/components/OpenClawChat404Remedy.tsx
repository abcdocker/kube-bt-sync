import React from "react";
import { Link } from "react-router-dom";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboardSafe } from "@/lib/clipboard";
import { CollapsibleManual } from "@/components/CollapsibleManual";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** 合并到 PVC openclaw.json 的最小段（勿整文件覆盖；与平台 ConfigMap 默认一致） */
export const OPENCLAW_CHAT_COMPLETIONS_MERGE_JSON = `{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}`;

type Props = {
  className?: string;
  /** 传入实例 id 时展示「打开本实例详情」链接（详情页自身请传 showInstanceLink={false}） */
  instanceId?: string;
  showInstanceLink?: boolean;
  variant?: "amber" | "violet";
};

/**
 * chat/completions 双路径均 404 时的固定处置说明（与 BOOT.md、后端 remediation 文案一致）。
 */
export function OpenClawChat404RemedyPanel({
  className,
  instanceId,
  showInstanceLink = true,
  variant = "amber",
}: Props) {
  const isViolet = variant === "violet";
  return (
    <CollapsibleManual
      storageKey={isViolet ? "openclaw.chat.404.violet" : "openclaw.chat.404.amber"}
      title="HTTP 404：OpenAI 兼容 chat 端点未开启"
      variant={isViolet ? "violet" : "amberSoft"}
      className={className}
      titleClassName={isViolet ? "text-violet-950" : "text-amber-950"}
    >
      <p className="opacity-95">
        平台已依次尝试 <span className="font-mono">/v1/chat/completions</span> 与{" "}
        <span className="font-mono">/chat/completions</span>
        仍 404 时，多为网关未暴露该路由（非 Base URL 拼写问题）。
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>
          在网关 PVC 的 <code className="rounded bg-white/70 px-1 font-mono">openclaw.json</code>{" "}
          中<strong>合并</strong>下方 JSON（勿整文件覆盖）。
        </li>
        <li>
          保存后对 Deployment <strong>滚动重启</strong>（网关未必热加载）。
        </li>
        <li>新部署的 ConfigMap 默认已含此开关；从旧版升上来或手写 PVC 时常缺。</li>
      </ol>
      <div className="relative mt-2">
        <pre
          className={cn(
            "max-h-40 overflow-auto rounded-md border p-2.5 pr-14 font-mono text-[10px] leading-relaxed",
            isViolet ? "border-violet-200/80 bg-white/90" : "border-amber-200/70 bg-white/90"
          )}
        >
          {OPENCLAW_CHAT_COMPLETIONS_MERGE_JSON}
        </pre>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={cn(
            "absolute right-2 top-2 h-7 gap-1 px-2 text-[10px]",
            isViolet && "border-violet-200 bg-white/90"
          )}
          onClick={() =>
            void copyToClipboardSafe(OPENCLAW_CHAT_COMPLETIONS_MERGE_JSON)
              .then(() => toast.success("已复制合并片段"))
              .catch(() => toast.error("复制失败"))
          }
        >
          <Copy className="h-3 w-3" />
          复制
        </Button>
      </div>
      <p className="mt-2 text-[10px] opacity-90">
        亦可在应用中心该实例<strong>详情 → 配置文件 → openclaw.json</strong> 中编辑；预置说明见同页{" "}
        <strong>BOOT.md</strong>「巡检 / 代连返回 404」节。
      </p>
      {showInstanceLink && instanceId ? (
        <p className="mt-1.5">
          <Button variant="link" className="h-auto p-0 text-[11px]" asChild>
            <Link to={`/cluster/apps/openclaw/${encodeURIComponent(instanceId)}`}>打开本实例详情</Link>
          </Button>
        </p>
      ) : null}
    </CollapsibleManual>
  );
}

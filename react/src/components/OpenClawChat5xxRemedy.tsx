import React from "react";
import { CollapsibleManual } from "@/components/CollapsibleManual";

type Props = {
  className?: string;
};

/**
 * chat/completions 返回 5xx / internal error 时的说明（与 404「未开路由」不同）。
 * 探活已命中网关，失败多在网关→上游厂商 API 这一段。
 */
export function OpenClawChat5xxRemedyPanel({ className }: Props) {
  return (
    <CollapsibleManual
      storageKey="openclaw.chat.5xx-remedy"
      title="HTTP 5xx / internal error：chat 路由已通，网关调上游失败"
      variant="slate"
      className={className}
      titleClassName="text-slate-950"
    >
      <p className="text-slate-800/95">
        平台能收到网关响应（非 404），说明{" "}
        <span className="font-mono">/v1/chat/completions</span> 或{" "}
        <span className="font-mono">/chat/completions</span> 已启用。仅合并{" "}
        <span className="font-mono">allowedOrigins</span> /{" "}
        <span className="font-mono">chatCompletions</span> 并滚动重启<strong>往往不能</strong>消除此类错误——根因在网关
        → 大模型（模型 ID、Provider、API Key、代理）。
      </p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-slate-800">
        <li>
          <strong>对照 Pod 日志</strong>（<span className="font-mono">kubectl logs</span>）：若出现{" "}
          <code className="rounded bg-white/90 px-1 font-mono text-[10px]">anthropic/MiniMax-M2.7</code> 与{" "}
          <code className="rounded bg-white/90 px-1 font-mono text-[10px]">model_not_found</code>
          ，说明网关把 MiniMax 误归到 <strong>Anthropic</strong> 供应商。MiniMax 应走{" "}
          <strong>OpenAI 兼容</strong>通道（Secret 里 <span className="font-mono">OPENAI_API_KEY</span> +{" "}
          <span className="font-mono">OPENAI_BASE_URL=https://api.minimaxi.com/v1</span>（Token 套餐密钥）或{" "}
          <span className="font-mono">https://api.minimax.io/v1</span>（须与密钥门户一致；错域常见 401 invalid api key 2049）
          ），并在 OpenClaw 的模型/回退配置中<strong>不要</strong>使用{" "}
          <span className="font-mono">anthropic/…</span> 前缀指向 MiniMax 模型名。
        </li>
        <li>
          若日志为{" "}
          <code className="rounded bg-white/90 px-1 font-mono text-[10px]">No API key found for provider &quot;anthropic&quot;</code>
          与 <span className="font-mono">auth-profiles.json</span>
          ：要么在网关内为 Anthropic 配置有效 API Key（<span className="font-mono">openclaw agents add …</span>
          或写入该 agent 目录下的 auth 配置），要么去掉/改掉<strong>回退模型</strong>（例如不要回退到{" "}
          <span className="font-mono">anthropic/claude-opus-4-6</span>
          ），使仅使用你已配 Key 的厂商（如仅 MiniMax）。
        </li>
        <li>
          MiniMax 若返回{" "}
          <code className="rounded bg-white/90 px-1 font-mono text-[10px]">1004</code> 且提示在{" "}
          <span className="font-mono">Authorization</span> 中带 Key：多为到 MiniMax 的请求<strong>未带</strong>
          <span className="font-mono">Bearer</span>（Secret 键名须为{" "}
          <span className="font-mono">OPENAI_API_KEY</span>、Pod 内非空），或 <span className="font-mono">HTTP(S)_PROXY</span>{" "}
          剥掉 <span className="font-mono">Authorization</span>。新版平台模板在启用代理时会为{" "}
          <span className="font-mono">api.minimaxi.com</span> 等设置 <span className="font-mono">NO_PROXY</span>；旧部署请补后重启。
        </li>
        <li>
          核对网关 Pod 环境变量中的厂商 API Key（如 <span className="font-mono">OPENAI_API_KEY</span> 等）是否有效、未轮换后未更新
          Secret、与所选厂商一致。
        </li>
        <li>
          在实例<strong>管理配置</strong>中「对话模型」与网关/openclaw 实际使用的模型 ID 一致；后台探活使用登记的模型（无则按预设，兜底为{" "}
          <span className="font-mono">MiniMax-M2.7</span>
          ）。模型名在厂商侧不存在时会表现为网关 5xx。
        </li>
        <li>
          确认网关 Pod 能访问厂商 API（出站网络、或已配置的 <span className="font-mono">HTTP(S)_PROXY</span> / 出站云主机）。
        </li>
        <li>
          修改 Secret、<span className="font-mono">openclaw.json</span> 或 agent 目录下{" "}
          <span className="font-mono">auth-profiles.json</span> 后应对 Deployment{" "}
          <strong>滚动重启</strong>，避免仍用旧进程内存配置。
        </li>
        <li>
          在节点上执行 <span className="font-mono">kubectl logs -n &lt;ns&gt; deploy/&lt;网关名&gt;</span>，查找{" "}
          <span className="font-mono">openai-compat</span>、<span className="font-mono">model-fallback</span>、
          <span className="font-mono">diagnostic</span> 等行（比平台摘要更准）。
        </li>
      </ol>
    </CollapsibleManual>
  );
}

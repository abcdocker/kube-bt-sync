import React, { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, Loader2 } from "lucide-react";
import { apiGetJson, apiGetText, apiPostJson, ApiHttpError } from "@/lib/api";

/** 按 Markdown 标题拆成段落，便于落库与后续统计整合（不增加 OpenClaw 调用次数）。 */
function splitMarkdownParagraphs(md: string): { heading: string; text: string }[] {
  const t = md.trim();
  if (!t) return [];
  const lines = t.split(/\n/);
  const out: { heading: string; text: string }[] = [];
  let curHead = "正文";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) out.push({ heading: curHead, text: body });
    buf = [];
  };
  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (m) {
      flush();
      curHead = m[2].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  if (out.length === 0) return [{ heading: "全文", text: t }];
  return out;
}
import { OpenClawChatMarkdown } from "@/components/OpenClawChatMarkdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { buildPodLogsApiPath } from "./podLogsApi";
import { buildKubernetesPodVmLogQuery, formatVmLogRowsForPrompt } from "./podRestartVmLog";

/** 与 `internal/app_openclaw_chat.go` 中 `openClawChatMaxContentRunes` 保持一致；整段 user message 总长不可超过。 */
const OPENCLAW_CHAT_MAX_CONTENT_RUNES = 24000;

function runeLen(s: string): number {
  return [...s].length;
}

/** 截断为至多 maxRunes 个 Unicode 标量（与 Go 侧 len([]rune(content)) 对齐），含截断说明后缀。 */
function clipLogByRunes(s: string, maxRunes: number): string {
  const t = s.trim();
  if (maxRunes < 32) return "…";
  const r = [...t];
  if (r.length <= maxRunes) return t;
  const suf = `\n…(截断，全文 ${r.length} 字)`;
  const sufN = runeLen(suf);
  const take = Math.max(0, maxRunes - sufN);
  return r.slice(0, take).join("") + suf;
}

function buildRestartChatMessage(opts: {
  namespace: string;
  podName: string;
  workContainer: string;
  restarts: number;
  prevLog: string;
  currLog: string;
  /** VictoriaLogs 行样本（已压缩）；空表示无命中 */
  vmLogSample: string;
  /** 查询失败等短说明；无则留空 */
  vmLogHint: string;
}): string {
  const instruction =
    "你是 Kubernetes 与进程排障助手。综合 **(A) 上轮 kubectl 日志**、**(B) 当前 kubectl 日志**、**(C) VictoriaLogs（VMLog）近窗入库** 判断反复重启或退出的**最可能原因**（如 OOM、heap、探针、配置、依赖网络等）。若 VMLog 与 kubectl 在时间线或错误形态上可互证，请点明。\n" +
    "输出 Markdown：\n" +
    "1) **结论**（1～2 句）\n" +
    "2) **证据**（引用关键行/错误类型，可区分 kubectl vs VMLog）\n" +
    "3) **建议**（可含 limits/requests、NODE_OPTIONS、镜像/配置与日志采集检查）\n" +
    "总长度控制在 40 行内，不要寒暄。\n\n";
  const meta =
    `Pod: ${opts.namespace}/${opts.podName}\n` +
    `容器: ${opts.workContainer}\n` +
    `工作容器重启合计（来自列表 API）: ${opts.restarts}\n\n`;
  const sep1 = "--- 上轮实例日志 (--previous) ---\n";
  const sep2 = "\n\n--- 当前实例日志尾部 ---\n";
  const sep3 = "\n\n--- VictoriaLogs（VMLog，近约 6 小时入库）---\n";
  const vmBody =
    opts.vmLogSample.trim().length > 0
      ? opts.vmLogSample.trim()
      : opts.vmLogHint.trim().length > 0
        ? `（VMLog：${opts.vmLogHint.trim()}）`
        : "（VMLog：本时段无命中或未配置 VictoriaLogs；仅依据上下 kubectl 节。）";
  const fixed = instruction + meta + sep1;
  const fixed2 = sep2;
  const fixed3 = sep3;
  const margin = 100;
  let logBudget =
    OPENCLAW_CHAT_MAX_CONTENT_RUNES - margin - runeLen(fixed) - runeLen(fixed2) - runeLen(fixed3);
  if (logBudget < 720) logBudget = 720;
  let prevMax = Math.floor(logBudget * 0.44);
  let currMax = Math.floor(logBudget * 0.32);
  let vmMax = logBudget - prevMax - currMax;
  for (let i = 0; i < 10; i++) {
    const prevPart = clipLogByRunes(opts.prevLog, prevMax);
    const currPart = clipLogByRunes(opts.currLog, currMax);
    const vmPart = clipLogByRunes(vmBody, vmMax);
    const body = fixed + prevPart + fixed2 + currPart + fixed3 + vmPart;
    if (runeLen(body) <= OPENCLAW_CHAT_MAX_CONTENT_RUNES - 20) return body;
    prevMax = Math.max(180, Math.floor(prevMax * 0.88));
    currMax = Math.max(180, Math.floor(currMax * 0.88));
    vmMax = Math.max(120, Math.floor(vmMax * 0.88));
  }
  const prevPart = clipLogByRunes(opts.prevLog, 200);
  const currPart = clipLogByRunes(opts.currLog, 200);
  const vmPart = clipLogByRunes(vmBody, 200);
  return fixed + prevPart + fixed2 + currPart + fixed3 + vmPart;
}

/** 发送前硬上限，低于后端 24000，避免 JS/Go rune 计数或 JSON 层差异仍触发超限。 */
const OPENCLAW_CHAT_SAFE_SEND_RUNES = 23200;

function enforceMaxChatRunes(body: string, maxRunes: number): string {
  if (runeLen(body) <= maxRunes) return body;
  const suf = "\n…(已达发送上限已截断)";
  const take = Math.max(0, maxRunes - runeLen(suf));
  return [...body].slice(0, take).join("") + suf;
}

type Step = "idle" | "fetch_prev" | "fetch_curr" | "fetch_vmlog" | "ai" | "done" | "error";

const PodRestartAiPanel: React.FC<{
  namespace: string;
  podName: string;
  restarts: number;
  primaryContainer: string;
}> = ({ namespace, podName, restarts, primaryContainer }) => {
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [statusLine, setStatusLine] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const workContainer = useMemo(() => primaryContainer.trim(), [primaryContainer]);
  const kubectlPrev = useMemo(
    () =>
      workContainer
        ? `kubectl logs -n ${namespace} ${podName} -c ${workContainer} --tail=2000 --previous`
        : `kubectl logs -n ${namespace} ${podName} --tail=2000 --previous`,
    [namespace, podName, workContainer]
  );

  const runAnalysis = useCallback(async () => {
    setErr(null);
    setReply(null);
    setProgress(5);
    setStatusLine("连接应用中心 OpenClaw…");
    try {
      const inst = await apiGetJson<{ instances?: { id: string }[] }>("/api/app-center/openclaw/instances");
      const id = inst.instances?.[0]?.id?.trim();
      if (!id) {
        setErr("未登记 OpenClaw 实例，请先在应用中心部署并登记网关。");
        setStep("error");
        setProgress(0);
        return;
      }
      if (!workContainer) {
        setErr("未找到工作容器名，无法拉取日志。");
        setStep("error");
        setProgress(0);
        return;
      }

      setStep("fetch_prev");
      setProgress(12);
      setStatusLine("拉取上轮容器日志（等价 kubectl logs --previous）…");
      let prevLog = "";
      try {
        prevLog = await apiGetText(buildPodLogsApiPath(namespace, podName, workContainer, 2000, true));
      } catch (e) {
        prevLog = `（拉取失败）${e instanceof Error ? e.message : String(e)}`;
      }

      setStep("fetch_curr");
      setProgress(28);
      setStatusLine("拉取当前实例日志尾部…");
      let currLog = "";
      try {
        currLog = await apiGetText(buildPodLogsApiPath(namespace, podName, workContainer, 800, false));
      } catch (e) {
        currLog = `（拉取失败）${e instanceof Error ? e.message : String(e)}`;
      }

      setStep("fetch_vmlog");
      setProgress(46);
      setStatusLine("查询 VictoriaLogs（VMLog）中与该 Pod 相关的入库日志…");
      let vmLogSample = "";
      let vmLogHint = "";
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 6 * 3600 * 1000);
        const q = buildKubernetesPodVmLogQuery(namespace, podName);
        const vl = await apiPostJson<{
          rows?: Record<string, unknown>[];
          truncated?: boolean;
          scanWarning?: string;
        }>("/api/ops/vmlog/query", {
          query: q,
          limit: 160,
          start: start.toISOString(),
          end: end.toISOString(),
        });
        const rows = vl.rows ?? [];
        vmLogSample = formatVmLogRowsForPrompt(rows, 130);
        if (rows.length === 0) {
          vmLogHint =
            "近 6 小时无命中（若已接入 VL，请确认采集链路写入 kubernetes.pod_name / kubernetes.namespace_name）";
        }
        if (vl.truncated || (vl.scanWarning && String(vl.scanWarning).trim())) {
          vmLogSample =
            (vmLogSample ? `${vmLogSample}\n` : "") +
            `(VL truncated=${Boolean(vl.truncated)} ${String(vl.scanWarning ?? "").trim()})`.trim();
        }
      } catch (e) {
        vmLogHint = e instanceof ApiHttpError ? e.serverMessage : String(e);
      }

      setStep("ai");
      setProgress(62);
      setStatusLine("调用 OpenClaw 分析中…");
      const body = enforceMaxChatRunes(
        buildRestartChatMessage({
          namespace,
          podName,
          workContainer,
          restarts,
          prevLog,
          currLog,
          vmLogSample,
          vmLogHint,
        }),
        OPENCLAW_CHAT_SAFE_SEND_RUNES
      );

      const r = await apiPostJson<{ reply?: string }>(
        `/api/app-center/openclaw/instances/${encodeURIComponent(id)}/chat`,
        { message: body }
      );
      const replyText = (r.reply ?? "").trim() || "—";
      setReply(replyText);
      setProgress(88);
      setStatusLine("保存分析报告（MySQL / Redis 统计）…");
      try {
        const paragraphs = splitMarkdownParagraphs(replyText);
        await apiPostJson<{ ok?: boolean; id?: number }>("/api/k8s/pod-restart-ai/reports", {
          kind: "pod_analysis",
          namespace,
          pod: podName,
          title: `重启分析 ${namespace}/${podName}`,
          body: replyText,
          paragraphs,
          meta: { restarts, primaryContainer: workContainer },
        });
      } catch (saveErr) {
        // 无 MySQL 时仅提示，不阻断展示结论
        console.warn(saveErr);
      }
      setProgress(100);
      setStatusLine("完成");
      setStep("done");
    } catch (e) {
      setErr(e instanceof ApiHttpError ? e.serverMessage : String(e));
      setStep("error");
      setProgress(0);
      setStatusLine("");
    }
  }, [namespace, podName, restarts, workContainer]);

  const busy = step !== "idle" && step !== "done" && step !== "error";

  return (
    <Card className="border-amber-200/80 bg-amber-50/30 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">重启诊断</CardTitle>
            <CardDescription className="space-y-1">
              <span>
                等价命令：
                <code className="rounded bg-white/80 px-1 font-mono text-[11px] dark:bg-slate-900/80">{kubectlPrev}</code>
              </span>
              <span className="block text-xs">
                分析时会合并 <strong>VictoriaLogs（VMLog）</strong> 近约 6 小时、与上述 Pod/命名空间匹配的入库行（需在集群设置中配置{" "}
                <code className="rounded px-0.5 font-mono text-[10px]">victoriaLogsUrl</code>）。完成后会尝试写入 MySQL（需 DSN）并刷新统计缓存；历史见{" "}
                <Link to="/cluster/ai-inspect/reports/pod" className="text-primary underline">
                  分析报告
                </Link>
                。
              </span>
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={busy || restarts < 1}
            onClick={() => void runAnalysis()}
            title={restarts < 1 ? "无重启记录时通常无 previous 日志" : undefined}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            AI 分析重启原因
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {restarts < 1 ? (
          <p className="text-xs text-muted-foreground">当前 Pod 工作容器重启合计为 0；若仍异常，请直接用各容器上的「日志」按钮查看。</p>
        ) : null}
        {busy || step === "done" ? (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">{statusLine || "…"}</p>
          </div>
        ) : null}
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        {reply ? (
          <div className="max-h-[min(60vh,480px)] overflow-y-auto rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <OpenClawChatMarkdown source={reply} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default PodRestartAiPanel;

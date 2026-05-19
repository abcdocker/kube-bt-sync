package internal

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	opsInspectTaskPhasePending = "pending"
	opsInspectTaskPhaseRunning = "running"
	opsInspectTaskPhaseSuccess = "success"
	opsInspectTaskPhaseError   = "error"
)

var opsInspectTaskStore sync.Map

type opsInspectTask struct {
	mu         sync.RWMutex
	ID         string
	Phase      string
	Progress   int
	Stage      string
	Message    string
	Error      string
	StartedAt  string
	FinishedAt string
	Report     *InspectionReport
}

func newOpsInspectTask() *opsInspectTask {
	return &opsInspectTask{
		ID:        uuid.New().String(),
		Phase:     opsInspectTaskPhasePending,
		Progress:  0,
		Stage:     "queued",
		Message:   "任务已创建，等待开始执行巡检",
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func (t *opsInspectTask) setProgress(progress int, stage, message string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	if progress > t.Progress {
		t.Progress = progress
	}
	if strings.TrimSpace(stage) != "" {
		t.Stage = strings.TrimSpace(stage)
	}
	if strings.TrimSpace(message) != "" {
		t.Message = strings.TrimSpace(message)
	}
	if t.Phase == opsInspectTaskPhasePending {
		t.Phase = opsInspectTaskPhaseRunning
	}
}

func (t *opsInspectTask) finishSuccess(rep InspectionReport) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Phase = opsInspectTaskPhaseSuccess
	t.Progress = 100
	t.Stage = "done"
	t.Message = "巡检已完成"
	t.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	t.Report = &rep
	t.Error = ""
}

func (t *opsInspectTask) finishError(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Phase = opsInspectTaskPhaseError
	if t.Progress < 5 {
		t.Progress = 5
	}
	t.Stage = "failed"
	t.Error = strings.TrimSpace(err.Error())
	if t.Error == "" {
		t.Error = "巡检失败"
	}
	t.Message = t.Error
	t.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
}

func (t *opsInspectTask) snapshot() map[string]any {
	t.mu.RLock()
	defer t.mu.RUnlock()
	out := map[string]any{
		"taskId":     t.ID,
		"phase":      t.Phase,
		"progress":   t.Progress,
		"stage":      t.Stage,
		"message":    t.Message,
		"startedAt":  t.StartedAt,
		"finishedAt": t.FinishedAt,
	}
	if t.Error != "" {
		out["error"] = t.Error
	}
	if t.Report != nil {
		out["report"] = t.Report
		if id := strings.TrimSpace(t.Report.ID); id != "" {
			out["reportId"] = id
		}
	}
	return out
}

// snapshotForList 与 snapshot 相同但省略完整 report，避免任务列表响应过大。
func (t *opsInspectTask) snapshotForList() map[string]any {
	snap := t.snapshot()
	delete(snap, "report")
	return snap
}

func opsInspectTaskGet(id string) (*opsInspectTask, bool) {
	v, ok := opsInspectTaskStore.Load(strings.TrimSpace(id))
	if !ok {
		return nil, false
	}
	t, ok := v.(*opsInspectTask)
	return t, ok
}

func opsInspectTaskList(limit int) []map[string]any {
	if limit <= 0 {
		limit = 10
	}
	type row struct {
		started time.Time
		data    map[string]any
	}
	items := make([]row, 0, limit)
	opsInspectTaskStore.Range(func(_, value any) bool {
		t, ok := value.(*opsInspectTask)
		if !ok || t == nil {
			return true
		}
		snap := t.snapshotForList()
		startedAt, _ := snap["startedAt"].(string)
		ts, _ := time.Parse(time.RFC3339Nano, startedAt)
		items = append(items, row{started: ts, data: snap})
		return true
	})
	sort.Slice(items, func(i, j int) bool { return items[i].started.After(items[j].started) })
	if len(items) > limit {
		items = items[:limit]
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, item.data)
	}
	return out
}

// RunPlatformInspection 聚合平台各模块健康摘要与分项 Markdown 报告。
func RunPlatformInspection(app *ServerApp, cfg Config, bundle OpsOpenClawBundle, onProgress func(progress int, stage, message string)) (InspectionReport, error) {
	_ = ResolveOpsOpenClawEndpoint(app, cfg, &bundle)
	ai := bundle.AI
	var items []InspectionReportItem
	okN, warnN, failN := 0, 0, 0
	reportProgress := func(progress int, stage, message string) {
		if onProgress != nil {
			onProgress(progress, stage, message)
		}
	}
	add := func(target, status, detail string) {
		items = append(items, InspectionReportItem{Target: target, Status: status, Detail: detail})
		switch status {
		case "ok":
			okN++
		case "warn":
			warnN++
		case "fail":
			failN++
		}
	}
	reportProgress(5, "基础检查", "开始巡检基础连通性")

	if ai.InspectK8s {
		if app.K8s() == nil {
			add("Kubernetes API", "fail", "未连接集群")
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			_, err := app.K8s().CoreV1().Namespaces().List(ctx, metav1.ListOptions{Limit: 1})
			cancel()
			if err != nil {
				add("Kubernetes API", "fail", err.Error())
			} else {
				add("Kubernetes API", "ok", "可访问 API")
			}
		}
	}

	if ai.InspectVCenter {
		if app.VCenter() == nil {
			add("vCenter", "warn", "未配置或未连接")
		} else {
			add("vCenter", "ok", "客户端已初始化")
		}
	}

	if ai.InspectVCenterEvents {
		if app.VCenter() == nil {
			add("vCenter VM事件与告警", "warn", "vCenter 未配置或未连接")
		} else {
			evs, _ := GetVCenterVMEvents(app.PlatformKV(), 0, 24)
			add("vCenter VM事件与告警", "ok", fmt.Sprintf("过去24h已记录 %d 条 VM 事件", len(evs)))
		}
	}

	if ai.InspectPrometheusK8s {
		_, hint := PrometheusPromQLInstantProbe(cfg, "k8s", "1")
		if hint != "" {
			add("Prometheus(k8s)", "warn", hint)
		} else {
			add("Prometheus(k8s)", "ok", "即时查询可用")
		}
	}

	if ai.InspectPrometheusVCenter {
		_, hint := PrometheusPromQLInstantProbe(cfg, "vcenter", "1")
		if hint != "" {
			add("Prometheus(vcenter)", "warn", hint)
		} else {
			add("Prometheus(vcenter)", "ok", "即时查询可用")
		}
	}

	if ai.InspectVMLog {
		base := normalizeVictoriaLogsBase(effectiveVictoriaLogsURL(app.Runtime(), cfg))
		if base == "" {
			add("VictoriaLogs / VM 日志", "warn", "未配置 victoriaLogsUrl")
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_, _, _, _, err := fetchVictoriaLogsNDJSON(ctx, cfg, base, "*", 1, "", "")
			cancel()
			if err != nil {
				add("VictoriaLogs / VM 日志", "warn", err.Error())
			} else {
				add("VictoriaLogs / VM 日志", "ok", "查询接口可用")
			}
		}
	}

	if ai.InspectRedis {
		db := app.MySQLDB()
		if db == nil {
			add("应用中心 Redis 实例表", "skip", "无 MySQL，跳过实例列表")
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
			defer cancel()
			var n int
			err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM kubebt_app_redis_instances`).Scan(&n)
			if err != nil {
				add("应用中心 Redis", "warn", err.Error())
			} else {
				add("应用中心 Redis", "ok", fmt.Sprintf("已登记 %d 个实例", n))
			}
		}
	}

	if ai.InspectSSH {
		st := app.SSHStore()
		if st == nil {
			add("SSH 凭据存储", "warn", "未初始化")
		} else {
			add("SSH 凭据存储", "ok", "后端已就绪")
		}
	}

	if ai.InspectCloudVm {
		db := app.MySQLDB()
		if db == nil {
			add("云主机实例表", "skip", "无 MySQL")
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
			defer cancel()
			var n int
			err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM kubebt_app_cloud_vm_instances`).Scan(&n)
			if err != nil {
				add("云主机", "warn", err.Error())
			} else {
				add("云主机", "ok", fmt.Sprintf("已登记 %d 台", n))
			}
		}
	}
	reportProgress(25, "汇总分项", "开始生成各模块巡检分项")

	// —— 深度分项（Markdown）——
	var sections []InspectionSection
	colCtx, colCancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer colCancel()

	reportProgress(35, "Kubernetes", "采集 Kubernetes 巡检数据")
	sections = append(sections, inspectCollectK8sSection(colCtx, app, cfg, ai))
	reportProgress(45, "vCenter", "采集 vCenter 巡检数据")
	sections = append(sections, inspectCollectVCenterSection(colCtx, app, ai))
	reportProgress(50, "vCenter 事件与告警", "采集 vCenter VM 事件与宿主机告警")
	sections = append(sections, inspectCollectVCenterEventsSection(colCtx, app, ai))
	reportProgress(55, "Prometheus", "采集 Prometheus 巡检数据")
	sections = append(sections, inspectCollectPrometheusSection(colCtx, app, cfg, ai))
	reportProgress(65, "日志巡检", "采集 VictoriaLogs / VM 日志巡检数据")
	sections = append(sections, inspectCollectVMLogSection(colCtx, app, cfg, ai))
	reportProgress(72, "Redis", "采集 Redis 巡检数据")
	sections = append(sections, inspectCollectRedisSection(colCtx, app, cfg, ai))
	reportProgress(78, "云主机", "采集云主机巡检数据")
	sections = append(sections, inspectCollectCloudVmSection(colCtx, app, ai))
	reportProgress(84, "OpenClaw", "采集 OpenClaw 网关状态")
	sections = append(sections, inspectCollectOpenClawSection(colCtx, app, cfg, ai))
	reportProgress(86, "Pod 关联", "读取整点异常 Pod 关联与重启分析缓存")
	sections = append(sections, InspectCollectK8sRestartCorrelationSection(app, ai))
	reportProgress(88, "SSH", "采集 SSH 凭据存储状态")
	sections = append(sections, inspectCollectSSHSection(app, ai))

	reportProgress(92, "模型探针", "执行大模型连通性探针")
	probeBundle := bundle
	if b2, err := opsOpenClawBundleForLLMRole(app, cfg, bundle, OpsOpenClawRoleInspectProbe); err == nil {
		probeBundle = b2
	}
	llmProbe := opsProbeOpenClawLLM(app, cfg, probeBundle)

	summary := fmt.Sprintf("巡检完成：正常 %d，警告 %d，异常 %d · 分项报告 %d 段", okN, warnN, failN, len(sections))
	if llmProbe != nil {
		if llmProbe.OK {
			summary += fmt.Sprintf(" · 大模型探针成功（%d ms）", llmProbe.LatencyMs)
		} else {
			summary += " · 大模型探针：" + opsTruncateStr(llmProbe.Message, 100)
		}
	}
	ts := NowBeijingRFC3339()
	modelLabel := strings.TrimSpace(probeBundle.OpenClaw.Model)
	if modelLabel == "" {
		modelLabel = "未指定"
	}
	summary += fmt.Sprintf(" · 巡检时间 %s · 选用模型 %s", ts, modelLabel)

	rep := InspectionReport{
		ID:        uuid.New().String(),
		CreatedAt: ts,
		Summary:   summary,
		Items:     items,
		Sections:  sections,
		LLMProbe:  llmProbe,
	}

	sumBundle := bundle
	if b2, err := opsOpenClawBundleForLLMRole(app, cfg, bundle, OpsOpenClawRoleInspectSummary); err == nil {
		sumBundle = b2
	}
	summaryLLMEnabled := openClawEnabledForRole(bundle, OpsOpenClawRoleInspectSummary)
	if summaryLLMEnabled && strings.TrimSpace(sumBundle.OpenClaw.BaseURL) != "" {
		reportProgress(96, "AI 摘要", "调用大模型生成巡检摘要")
		aiText, err := opsCallOpenClawSummary(app, cfg, sumBundle, rep)
		if err == nil && strings.TrimSpace(aiText) != "" {
			rep.AISummary = aiText
		} else if err != nil {
			short, detail := opsOpenClawFailureDiagnosis(app, sumBundle, err, sumBundle.OpenClaw.TimeoutSec)
			rep.AISummaryError = short
			rep.AISummaryErrorDetail = detail
		}
	}

	reportProgress(99, "保存报告", "保存巡检报告")
	_ = appendInspectReport(app.PlatformKV(), rep, 50)
	return rep, nil
}

// opsInspectReportForAI 控制发给大模型的 JSON 体积（不含各段完整 Markdown）。
func opsInspectReportForAI(rep InspectionReport) map[string]interface{} {
	secBrief := make([]map[string]string, 0, len(rep.Sections))
	for _, s := range rep.Sections {
		secBrief = append(secBrief, map[string]string{"id": s.ID, "title": s.Title, "status": s.Status})
	}
	out := map[string]interface{}{
		"summary":  rep.Summary,
		"items":    rep.Items,
		"sections": secBrief,
		"llmProbe": rep.LLMProbe,
	}
	return out
}

func opsOpenClawErrorLooksLikeTransportIssue(raw string) bool {
	low := strings.ToLower(strings.TrimSpace(raw))
	for _, needle := range []string{
		"connection refused",
		"no such host",
		"unexpected eof",
		"eof",
		"reset by peer",
		"broken pipe",
		"i/o timeout",
		"client.timeout",
		"context deadline exceeded",
		"deadline exceeded",
		"tls",
		"handshake",
		"certificate",
		"network is unreachable",
	} {
		if strings.Contains(low, needle) {
			return true
		}
	}
	return false
}

func opsOpenClawErrorLooksLikeModelIssue(raw string) bool {
	low := strings.ToLower(strings.TrimSpace(raw))
	for _, needle := range []string{
		"unknown model",
		"model_not_found",
		"model not found",
		"unsupported model",
		"no api key found for provider",
		"invalid api key",
		"invalid_api_key",
		"incorrect api key",
		"authentication",
		"unauthorized",
		"openai_api_key",
		"openai_base_url",
		"未配置 api key",
		"未配置 base url",
		"secret 中 openai_api_key",
		"secret 中 openai_base_url",
		"x-openclaw-model",
		"provider",
	} {
		if strings.Contains(low, needle) {
			return true
		}
	}
	return strings.Contains(low, "[上游模型接入层") && !opsOpenClawErrorLooksLikeTransportIssue(low)
}

func opsOpenClawFailureK8sHint(app *ServerApp, bundle OpsOpenClawBundle) (string, string) {
	if app == nil || app.K8s() == nil || app.PlatformKV() == nil {
		return "", ""
	}
	oc := bundle.OpenClaw
	if strings.TrimSpace(oc.EndpointSource) != "appInstance" || strings.TrimSpace(oc.AppInstanceID) == "" {
		return "", ""
	}
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		return "", ""
	}
	inst := findAppOpenClawInstance(list, oc.AppInstanceID)
	if inst == nil {
		return "", ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	st := openClawK8sStatus(ctx, app.K8s(), inst.Namespace, inst.DeploymentName, inst.Image)
	msg := strings.TrimSpace(fmt.Sprint(st["message"]))
	if synced, ok := st["imageRolloutSynced"].(bool); ok && !synced {
		return "更像 OpenClaw 网关 / Pod 未就绪或仍在切换。优先看 Deployment、Pod、Endpoints 和重启次数。", msg
	}
	switch strings.TrimSpace(fmt.Sprint(st["phase"])) {
	case "progress", "missing", "error":
		return "更像 OpenClaw 网关 / Pod 未就绪或资源问题。优先看 Deployment、Pod、Endpoints 和重启次数。", msg
	default:
		return "", ""
	}
}

func opsOpenClawFailureDiagnosis(app *ServerApp, bundle OpsOpenClawBundle, err error, timeoutSec int) (string, string) {
	if err == nil {
		return "", ""
	}
	raw := strings.TrimSpace(err.Error())
	if raw == "" {
		raw = "大模型调用失败"
	}
	if opsOpenClawErrorLooksLikeModelIssue(raw) {
		return "更像模型 / 上游配置问题，不是 Pod 挂了。优先检查模型名、provider、OPENAI_BASE_URL、API Key。", opsTruncateStr(raw, 900)
	}
	if short, k8sMsg := opsOpenClawFailureK8sHint(app, bundle); short != "" {
		detail := raw
		if k8sMsg != "" {
			detail = "K8s 状态：" + k8sMsg + "\n\n原始错误：" + raw
		}
		return short, opsTruncateStr(detail, 900)
	}
	if opsOpenClawErrorLooksLikeTransportIssue(raw) {
		if timeoutSec <= 0 {
			timeoutSec = 45
		}
		detail := strings.TrimSpace(openClawExplainHealthChatProbeError(err, time.Duration(timeoutSec)*time.Second))
		if detail == "" {
			detail = raw
		}
		return "更像 OpenClaw 网关 / Pod 未就绪或资源问题。优先看 Deployment、Pod、Endpoints 和重启次数。", opsTruncateStr(detail, 900)
	}
	return "更像模型 / 上游配置问题，不是 Pod 挂了。优先检查模型名、provider、OPENAI_BASE_URL、API Key。", opsTruncateStr(raw, 900)
}

func opsOpenClawChatAPI(cfg Config, app *ServerApp, oc OpenClawConfig, ai OpsAIInspectConfig, systemPrompt, userMsg string, timeoutSec int, maxTokensOverride int) (content string, latencyMs int64, err error) {
	if timeoutSec <= 0 {
		timeoutSec = 120
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	msgs := []openClawChatMsg{
		{Role: "system", Content: strings.TrimSpace(systemPrompt)},
		{Role: "user", Content: userMsg},
	}
	model := strings.TrimSpace(oc.Model)
	mt := maxTokensOverride
	if mt <= 0 {
		mt = ai.ModelExtra.MaxTokens
	}
	ext := map[string]interface{}{}
	if ai.ModelExtra.Temperature > 0 {
		ext["temperature"] = ai.ModelExtra.Temperature
	}
	if mt > 0 {
		ext["max_tokens"] = mt
	}

	var directErr error
	if app != nil && app.K8s() != nil && app.PlatformKV() != nil && strings.TrimSpace(oc.EndpointSource) == "appInstance" {
		id := strings.TrimSpace(oc.AppInstanceID)
		if id != "" {
			list, lerr := loadAppOpenClawInstances(app.PlatformKV())
			if lerr == nil {
				if inst := findAppOpenClawInstance(list, id); inst != nil {
					if model == "" {
						model = MapOpenClawInstanceGatewayModelRef(inst)
					}
					if model == "" {
						model = defaultOpenClawFallbackChatModelID
					}
					ub, uk, uerr := openClawReadUpstreamCredentials(ctx, app.K8s(), inst)
					if uerr == nil && ub != "" && uk != "" {
						t0 := time.Now()
						c, _, e := openClawPostDirectChatCompletions(ctx, ub, uk, model, msgs, ext, time.Duration(timeoutSec)*time.Second, oc.SkipTLSVerify)
						latencyMs = time.Since(t0).Milliseconds()
						if e == nil {
							return c, latencyMs, nil
						}
						directErr = e
					}
				}
			}
		}
	}

	key, err := opsEncryptionKey(cfg)
	if err != nil {
		if directErr != nil {
			return "", latencyMs, directErr
		}
		return "", 0, err
	}
	apiKey, _ := decryptSecret(key, oc.APIKeyEnc)
	if strings.TrimSpace(apiKey) == "" {
		if directErr != nil {
			return "", latencyMs, directErr
		}
		return "", 0, fmt.Errorf("未配置 API Key")
	}
	base := strings.TrimRight(strings.TrimSpace(oc.BaseURL), "/")
	if base == "" {
		if directErr != nil {
			return "", latencyMs, directErr
		}
		return "", 0, fmt.Errorf("未配置 Base URL")
	}
	body := map[string]interface{}{
		"model": oc.Model,
		"messages": []map[string]string{
			{"role": "system", "content": strings.TrimSpace(systemPrompt)},
			{"role": "user", "content": userMsg},
		},
	}
	if ai.ModelExtra.Temperature > 0 {
		body["temperature"] = ai.ModelExtra.Temperature
	}
	if mt > 0 {
		body["max_tokens"] = mt
	}
	xoHdr := ""
	if opsUseOpenClawGatewayModelRouting(oc) {
		bm, xo := openClawApplyGatewayModelRouting(strings.TrimSpace(oc.Model))
		body["model"] = bm
		xoHdr = xo
	}
	b, _ := json.Marshal(body)
	u := openClawOpenAIChatCompletionsURL(base)
	if u == "" {
		if directErr != nil {
			return "", latencyMs, directErr
		}
		return "", 0, fmt.Errorf("无法拼接 chat/completions URL（请检查巡检 OpenClaw Base URL，集群内网关应为 …:端口/v1）")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(b))
	if err != nil {
		if directErr != nil {
			return "", latencyMs, directErr
		}
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if strings.TrimSpace(xoHdr) != "" {
		req.Header.Set("x-openclaw-model", strings.TrimSpace(xoHdr))
	}
	tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: oc.SkipTLSVerify, MinVersion: tls.VersionTLS12}}
	cli := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second, Transport: tr}
	t0 := time.Now()
	resp, err := cli.Do(req)
	latencyMs = time.Since(t0).Milliseconds()
	if err != nil {
		gwNet := fmt.Errorf("[OpenClaw 网关] 请求失败（kube-bt-sync 无法连上集群内网关 Base URL，多为网络/DNS/TLS/超时）: %w", err)
		if directErr != nil {
			return "", latencyMs, fmt.Errorf("%v；随后经 OpenClaw 网关重试时：%v", directErr, gwNet)
		}
		return "", latencyMs, gwNet
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		if directErr != nil {
			return "", latencyMs, fmt.Errorf("%v；随后经 OpenClaw 网关重试时读取响应失败: %w", directErr, err)
		}
		return "", latencyMs, fmt.Errorf("[OpenClaw 网关] 读取响应体失败: %w", err)
	}
	if resp.StatusCode >= 400 {
		gw := fmt.Sprintf("[OpenClaw 网关] HTTP %d（平台向集群内网关 POST /v1/chat/completions 的响应；若为 5xx 且 body 为 internal error，多为网关封装了上游失败）: %s", resp.StatusCode, opsTruncateStr(string(raw), 400))
		if directErr != nil {
			return "", latencyMs, fmt.Errorf("%v；随后经 OpenClaw 网关转发仍失败：%s", directErr, gw)
		}
		return "", latencyMs, fmt.Errorf("%s", gw)
	}
	var wrap struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return "", latencyMs, fmt.Errorf("[OpenClaw 网关] 解析 chat/completions JSON 失败: %w", err)
	}
	if len(wrap.Choices) == 0 {
		return "", latencyMs, fmt.Errorf("[OpenClaw 网关] 响应中无 choices（HTTP 虽为 2xx 但结构异常）")
	}
	return strings.TrimSpace(wrap.Choices[0].Message.Content), latencyMs, nil
}

func opsCallOpenClawSummary(app *ServerApp, cfg Config, bundle OpsOpenClawBundle, rep InspectionReport) (string, error) {
	slim := opsInspectReportForAI(rep)
	reportJSON, _ := json.Marshal(slim)
	userMsg := strings.TrimSpace(bundle.OpenClaw.UserTemplate)
	if userMsg == "" {
		userMsg = "请根据以下巡检 JSON（含各分项状态摘要）输出**完整**中文巡检结论：先总评，再按模块给出建议，可使用 Markdown 标题与列表。\n{{report}}"
	}
	userMsg = strings.ReplaceAll(userMsg, "{{report}}", string(reportJSON))
	timeout := bundle.OpenClaw.TimeoutSec
	if timeout <= 0 {
		timeout = 120
	}
	text, _, err := opsOpenClawChatAPI(cfg, app, bundle.OpenClaw, bundle.AI, strings.TrimSpace(bundle.OpenClaw.SystemPrompt), userMsg, timeout, 0)
	return text, err
}

func opsProbeOpenClawLLM(app *ServerApp, cfg Config, bundle OpsOpenClawBundle) *InspectionLLMProbe {
	b := bundle
	_ = ResolveOpsOpenClawEndpoint(app, cfg, &b)
	key, err := opsEncryptionKey(cfg)
	if err != nil {
		return &InspectionLLMProbe{OK: false, Message: "无法读取 OpenClaw 凭据配置", Detail: err.Error()}
	}
	apiKey, _ := decryptSecret(key, b.OpenClaw.APIKeyEnc)
	base := strings.TrimRight(strings.TrimSpace(b.OpenClaw.BaseURL), "/")
	if base == "" || strings.TrimSpace(apiKey) == "" {
		return &InspectionLLMProbe{OK: false, Message: "未配置 Base URL 或 API Key，已跳过大模型探针", Detail: "请在 AI 巡检配置中填写 OpenClaw Base URL / API Key，或选择应用中心实例。"}
	}
	to := b.OpenClaw.TimeoutSec
	if to <= 0 {
		to = 45
	}
	if to > 90 {
		to = 90
	}
	user := "请只回复一小行：单词 pong（小写），不要其它内容。"
	sys := "你是 API 连通性测试，只输出所需单词。"
	content, ms, err := opsOpenClawChatAPI(cfg, app, b.OpenClaw, b.AI, sys, user, to, 32)
	preview := opsTruncateStr(content, 800)
	probe := &InspectionLLMProbe{
		Model:           b.OpenClaw.Model,
		LatencyMs:       ms,
		ResponsePreview: preview,
	}
	if err != nil {
		short, detail := opsOpenClawFailureDiagnosis(app, b, err, to)
		probe.Message = short
		probe.Detail = detail
		return probe
	}
	lower := strings.ToLower(strings.TrimSpace(content))
	if !strings.Contains(lower, "pong") {
		probe.Message = "HTTP 成功但模型回复中未包含 pong，请检查模型是否按指令输出或是否命中内容安全策略"
		return probe
	}
	probe.OK = true
	probe.Message = fmt.Sprintf("Chat Completions 正常，延迟约 %d ms", ms)
	return probe
}

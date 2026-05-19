package internal

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type openClawUpstreamTarget struct {
	baseURL string
	apiKey  string
	api     string
	model   string
}

func openClawOpenAIChatCompletionsURL(base string) string {
	bt := strings.TrimRight(strings.TrimSpace(base), "/")
	if bt == "" {
		return ""
	}
	if strings.HasSuffix(bt, "/v1") {
		return bt + "/chat/completions"
	}
	// 智谱 GLM OpenAI 兼容根路径为 .../v4，无 /v1 后缀
	if strings.Contains(bt, "open.bigmodel.cn") {
		return bt + "/chat/completions"
	}
	return bt + "/v1/chat/completions"
}

// openClawGatewayChat404RemediationZH 集群内 OpenClaw 在 POST chat/completions 返回 404 时的常见处置（探活/对话错误后缀）。
const openClawGatewayChat404RemediationZH = "常见：openclaw.json 未开启 gateway.http.endpoints.chatCompletions.enabled（合并后滚动重启）；或 ClusterV1BaseURL 与网关实际路径不一致。"

// openClawChatCompletionsURLCandidates 探活/对话用的候选 POST 地址；对集群内 OpenClaw 在首 URL 404 时可换另一拼法（根路径 /chat/completions 与 /v1/chat/completions）。
func openClawChatCompletionsURLCandidates(base string) []string {
	bt := strings.TrimRight(strings.TrimSpace(base), "/")
	if bt == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(u string) {
		if u == "" {
			return
		}
		if _, ok := seen[u]; ok {
			return
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	add(openClawOpenAIChatCompletionsURL(base))
	if shouldUseOpenClawGatewayHTTPContract(base) {
		stem := strings.TrimSuffix(bt, "/v1")
		if stem != bt {
			add(stem + "/chat/completions")
		} else {
			add(bt + "/chat/completions")
		}
	}
	return out
}

// shouldUseOpenClawGatewayHTTPContract 是否为集群内 OpenClaw 网关（须用 body model openclaw/default + x-openclaw-model）。
// 除默认端口 18789 外，也识别主机名含 openclaw 的 *.svc.cluster.local（例如经 Service 80 暴露的网关）。
func shouldUseOpenClawGatewayHTTPContract(baseURL string) bool {
	raw := strings.TrimSpace(baseURL)
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Host)
	if !strings.Contains(host, ".svc.cluster.local") {
		return false
	}
	if strings.Contains(host, ":18789") {
		return true
	}
	return strings.Contains(strings.ToLower(u.Hostname()), "openclaw")
}

// openClawQualifyGatewayUpstreamModel 生成 x-openclaw-model 请求头值。
// 新版 OpenClaw 会把「无厂商前缀」的模型名与 agent 默认供应商（常见为 anthropic）拼接，导致
// MiniMax-M2.7、gpt-4o-mini 等被误解析为 anthropic/MiniMax-M2.7 而 model_not_found。
// 规则：已含 provider/ 则原样返回；claude-* 归为 anthropic；其余默认 openai/（OpenAI 兼容上游，含 MiniMax、智谱兼容、千问兼容等）。
func openClawQualifyGatewayUpstreamModel(model string) string {
	m := strings.TrimSpace(model)
	if m == "" {
		return ""
	}
	if strings.Contains(m, "/") {
		return m
	}
	low := strings.ToLower(m)
	if strings.HasPrefix(low, "claude-") || strings.HasPrefix(low, "claude_") {
		return "anthropic/" + m
	}
	return "openai/" + m
}

type openClawGatewayRoutingCandidate struct {
	bodyModel string
	headerModel string
}

// openClawGatewayRoutingCandidates 兼容不同 OpenClaw 网关版本：
// 新版更偏向 x-openclaw-model=provider/model，旧版有时只接受原始模型名。
func openClawGatewayRoutingCandidates(model string) []openClawGatewayRoutingCandidate {
	m := strings.TrimSpace(model)
	if m == "" {
		return []openClawGatewayRoutingCandidate{{bodyModel: "openclaw/default"}}
	}
	low := strings.ToLower(m)
	if low == "openclaw" || strings.HasPrefix(low, "openclaw/") || strings.HasPrefix(low, "openclaw:") {
		return []openClawGatewayRoutingCandidate{{bodyModel: m}}
	}
	seen := map[string]struct{}{}
	var out []openClawGatewayRoutingCandidate
	add := func(bodyModel, headerModel string) {
		key := bodyModel + "\x00" + headerModel
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, openClawGatewayRoutingCandidate{bodyModel: bodyModel, headerModel: headerModel})
	}
	qualified := openClawQualifyGatewayUpstreamModel(m)
	add("openclaw/default", qualified)
	if qualified != m {
		add("openclaw/default", m)
	}
	return out
}

// openClawApplyGatewayModelRouting OpenClaw 将 JSON body 的 model 解释为 agent 目标；上游模型用 x-openclaw-model。
// 若用户已填 openclaw/… 或 openclaw:… 则原样返回（不传 x-openclaw-model，由网关 agent 默认决定上游）。
func openClawApplyGatewayModelRouting(model string) (bodyModel string, xOpenclawModel string) {
	cands := openClawGatewayRoutingCandidates(model)
	if len(cands) == 0 {
		return "openclaw/default", ""
	}
	return cands[0].bodyModel, cands[0].headerModel
}

func opsUseOpenClawGatewayModelRouting(oc OpenClawConfig) bool {
	if strings.TrimSpace(oc.EndpointSource) == "appInstance" {
		return true
	}
	return shouldUseOpenClawGatewayHTTPContract(oc.BaseURL)
}

// openClawReadUpstreamCredentials 读取网关 Deployment 同套 Secret 中的上游 OpenAI 兼容地址与密钥（与「检测上游」一致）。
func openClawReadUpstreamCredentials(ctx context.Context, k8s *kubernetes.Clientset, inst *AppOpenClawInstance) (baseURL, apiKey string, err error) {
	if k8s == nil || inst == nil {
		return "", "", fmt.Errorf("K8s 或未指定实例")
	}
	ns := strings.TrimSpace(inst.Namespace)
	secName := strings.TrimSpace(inst.SecretName)
	if secName == "" {
		secName = "openclaw-secrets"
	}
	sec, err := k8s.CoreV1().Secrets(ns).Get(ctx, secName, metav1.GetOptions{})
	if err != nil {
		return "", "", err
	}
	base := strings.TrimSpace(string(sec.Data["OPENAI_BASE_URL"]))
	key := strings.TrimSpace(string(sec.Data["OPENAI_API_KEY"]))
	return base, key, nil
}

func openClawReadUpstreamTarget(ctx context.Context, k8s *kubernetes.Clientset, inst *AppOpenClawInstance) (*openClawUpstreamTarget, error) {
	if k8s == nil || inst == nil {
		return nil, fmt.Errorf("K8s 或未指定实例")
	}
	ns := strings.TrimSpace(inst.Namespace)
	secName := strings.TrimSpace(inst.SecretName)
	if secName == "" {
		secName = "openclaw-secrets"
	}
	sec, err := k8s.CoreV1().Secrets(ns).Get(ctx, secName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	model := MapOpenClawInstanceChatModel(inst)
	if model == "" {
		model = defaultOpenClawFallbackChatModelID
	}
	switch strings.TrimSpace(inst.ModelPreset) {
	case "ollama":
		base := strings.TrimRight(strings.TrimSpace(string(sec.Data["OPENAI_BASE_URL"])), "/")
		base = strings.TrimSuffix(base, "/v1")
		key := strings.TrimSpace(string(sec.Data["OLLAMA_API_KEY"]))
		if key == "" {
			key = strings.TrimSpace(string(sec.Data["OPENAI_API_KEY"]))
		}
		return &openClawUpstreamTarget{baseURL: base, apiKey: key, api: "ollama", model: model}, nil
	default:
		base := strings.TrimSpace(string(sec.Data["OPENAI_BASE_URL"]))
		key := strings.TrimSpace(string(sec.Data["OPENAI_API_KEY"]))
		return &openClawUpstreamTarget{baseURL: base, apiKey: key, api: "openai-completions", model: model}, nil
	}
}

// openClawUpstreamChatPingOnce 不经网关，直连 Secret 中的 OPENAI_BASE_URL 发极简 chat/completions（与探活/上游检测同源）。
func openClawUpstreamChatPingOnce(ctx context.Context, baseURL, apiKey, model string, clientTimeout time.Duration) (httpStatus int, detail string) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return 0, "OPENAI_BASE_URL 为空"
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultOpenClawFallbackChatModelID
	}
	u := openClawOpenAIChatCompletionsURL(base)
	if u == "" {
		return 0, "无法拼接 chat/completions URL"
	}
	body := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": "ping"},
		},
		"max_tokens": 1,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, err.Error()
	}
	if clientTimeout <= 0 {
		clientTimeout = 25 * time.Second
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(raw))
	if err != nil {
		return 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	tr := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	cli := &http.Client{Timeout: clientTimeout, Transport: tr}
	resp, err := cli.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	st := resp.StatusCode
	if st < 400 {
		return st, ""
	}
	return st, truncateErrMessage(string(b), 500)
}

func openClawUpstreamOllamaPingOnce(ctx context.Context, baseURL, apiKey, model string, clientTimeout time.Duration) (httpStatus int, detail string) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return 0, "OLLAMA base URL 为空"
	}
	if clientTimeout <= 0 {
		clientTimeout = 25 * time.Second
	}
	body := map[string]interface{}{
		"model":    model,
		"messages": []map[string]string{{"role": "user", "content": "ping"}},
		"stream":   false,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, err.Error()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/chat", bytes.NewReader(raw))
	if err != nil {
		return 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	tr := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	cli := &http.Client{Timeout: clientTimeout, Transport: tr}
	resp, err := cli.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	st := resp.StatusCode
	if st < 400 {
		return st, ""
	}
	return st, truncateErrMessage(string(b), 500)
}

func openClawUpstreamPingTarget(ctx context.Context, target *openClawUpstreamTarget, clientTimeout time.Duration) (httpStatus int, detail string) {
	if target == nil {
		return 0, "未指定上游目标"
	}
	switch target.api {
	case "ollama":
		return openClawUpstreamOllamaPingOnce(ctx, target.baseURL, target.apiKey, target.model, clientTimeout)
	default:
		return openClawUpstreamChatPingOnce(ctx, target.baseURL, target.apiKey, target.model, clientTimeout)
	}
}

// openClawProbeUpstreamOpenAI 读取实例命名空间内 Secret 的 OPENAI_BASE_URL / OPENAI_API_KEY，向 /v1/chat/completions 发极简请求。
func openClawProbeUpstreamOpenAI(ctx context.Context, k8s *kubernetes.Clientset, inst *AppOpenClawInstance) (ok bool, detail string, httpStatus int) {
	if k8s == nil || inst == nil {
		return false, "K8s 或未指定实例", 0
	}
	target, err := openClawReadUpstreamTarget(ctx, k8s, inst)
	if err != nil {
		if apierrors.IsNotFound(err) {
			sn := strings.TrimSpace(inst.SecretName)
			if sn == "" {
				sn = "openclaw-secrets"
			}
			return false, "Secret 不存在: " + sn, 0
		}
		return false, err.Error(), 0
	}
	if target == nil || strings.TrimSpace(target.baseURL) == "" {
		return false, "Secret 中 OPENAI_BASE_URL 为空", 0
	}
	st, errDetail := openClawUpstreamPingTarget(ctx, target, 25*time.Second)
	if st == 0 {
		return false, errDetail, 0
	}
	if st < 400 {
		return true, "上游响应正常", st
	}
	return false, fmt.Sprintf("HTTP %d: %s", st, errDetail), st
}

// openClawProbeUpstreamAfterGatewayChat5xx 网关 chat 探活全模型 5xx 后调用：直连 Secret 上游并按与网关探活相同的模型列表重试，
// 用于区分「Secret/厂商侧不可用」与「仅网关 agent 路由错误（如 anthropic/ 误指 MiniMax）」。
func openClawProbeUpstreamAfterGatewayChat5xx(ctx context.Context, k8s *kubernetes.Clientset, inst *AppOpenClawInstance) (ok bool, summary string, httpStatus int) {
	if k8s == nil || inst == nil {
		return false, "K8s 或未指定实例", 0
	}
	target, err := openClawReadUpstreamTarget(ctx, k8s, inst)
	if err != nil {
		if apierrors.IsNotFound(err) {
			sn := strings.TrimSpace(inst.SecretName)
			if sn == "" {
				sn = "openclaw-secrets"
			}
			return false, "无法读取 Secret: " + sn + " 不存在", 0
		}
		return false, err.Error(), 0
	}
	if target == nil || strings.TrimSpace(target.baseURL) == "" {
		return false, "Secret 中 OPENAI_BASE_URL 为空", 0
	}
	if target.api != "ollama" && strings.TrimSpace(target.apiKey) == "" {
		return false, "Secret 中 OPENAI_API_KEY 为空", 0
	}
	primary := target.model
	models := openClawHealthPingModelCandidates(primary)
	var lastSt int
	var lastPiece string
	for _, m := range models {
		sub, cancel := context.WithTimeout(ctx, 16*time.Second)
		tryTarget := *target
		tryTarget.model = m
		st, errDetail := openClawUpstreamPingTarget(sub, &tryTarget, 14*time.Second)
		cancel()
		if st >= 200 && st < 400 {
			return true, fmt.Sprintf("直连上游成功（model=%s，HTTP %d）", m, st), st
		}
		if st == 0 {
			lastPiece = errDetail
			lastSt = 0
			continue
		}
		lastSt = st
		lastPiece = errDetail
	}
	tried := strings.Join(models, ", ")
	if lastSt == 0 {
		return false, fmt.Sprintf("直连上游均失败（已试 model: %s）：%s", tried, truncateErrMessage(lastPiece, 400)), 0
	}
	return false, fmt.Sprintf("直连上游均失败（已试 model: %s）：HTTP %d %s", tried, lastSt, truncateErrMessage(lastPiece, 400)), lastSt
}

func handleAppOpenClawUpstreamHealth(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	if app.K8s() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	inst := findAppOpenClawInstance(list, id)
	if inst == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "实例不存在"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 35*time.Second)
	defer cancel()
	ok, detail, st := openClawProbeUpstreamOpenAI(ctx, app.K8s(), inst)
	at := NowBeijingRFC3339()
	status := "fail"
	if ok {
		status = "ok"
	}
	_ = patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.UpstreamCheckStatus = status
		x.UpstreamCheckMessage = detail
		x.UpstreamCheckAt = at
	})
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{
		"ok":         ok,
		"message":    detail,
		"httpStatus": st,
		"checkedAt":  at,
		"modelTried": MapOpenClawInstanceChatModel(inst),
	})
}

type appOpenClawSetChatModelBody struct {
	ChatModel string `json:"chatModel"`
}

func handleAppOpenClawSetChatModel(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body appOpenClawSetChatModelBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m := strings.TrimSpace(body.ChatModel)
	if m == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chatModel 不能为空"})
		return
	}
	if err := patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.ChatModel = m
	}); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{"ok": true, "chatModel": m})
}

type appOpenClawApplyUpstreamRuntimeBody struct {
	ChatModel     string `json:"chatModel"`
	OpenAIBaseURL string `json:"openaiBaseUrl"`
	OpenAIAPIKey  string `json:"openaiApiKey"`
}

func openClawUpstreamSecretKeyForAPIKey(preset string) string {
	if strings.TrimSpace(preset) == "ollama" {
		return "OLLAMA_API_KEY"
	}
	return "OPENAI_API_KEY"
}

// handleAppOpenClawApplyUpstreamRuntime 合并更新平台 chatModel 登记、集群 Secret 中的上游 API，滚动重启网关并做上游探活。
func handleAppOpenClawApplyUpstreamRuntime(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	if app.K8s() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body appOpenClawApplyUpstreamRuntimeBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	inst := findAppOpenClawInstance(list, id)
	if inst == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "实例不存在"})
		return
	}

	ns := strings.TrimSpace(inst.Namespace)
	dep := strings.TrimSpace(inst.DeploymentName)
	if ns == "" || dep == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "实例缺少 namespace 或 deploymentName"})
		return
	}

	urlIn := strings.TrimSpace(body.OpenAIBaseURL)
	keyIn := strings.TrimSpace(body.OpenAIAPIKey)
	modelNeed, modelStore := openClawChatModelKVNeedsUpdate(inst, body.ChatModel)
	urlPatch := urlIn != ""
	keyPatch := keyIn != ""

	if !modelNeed && !urlPatch && !keyPatch {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有可应用的变更：请填写新的 API 地址、API Key，或调整对话模型名"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Minute)
	defer cancel()

	var steps []gin.H
	addStep := func(label string, ok bool, detail string) {
		h := gin.H{"label": label, "ok": ok}
		if strings.TrimSpace(detail) != "" {
			h["detail"] = strings.TrimSpace(detail)
		}
		steps = append(steps, h)
	}

	if modelNeed {
		if err := patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
			x.ChatModel = modelStore
		}); err != nil {
			RespondAPIError500(c, err.Error())
			return
		}
		mirrorPlatformKVIfDualWrite(app)
		addStep("更新平台模型登记", true, "")
	}

	secName := strings.TrimSpace(inst.SecretName)
	if secName == "" {
		secName = "openclaw-secrets"
	}

	if urlPatch || keyPatch {
		sec, err := app.K8s().CoreV1().Secrets(ns).Get(ctx, secName, metav1.GetOptions{})
		if err != nil {
			if apierrors.IsNotFound(err) {
				addStep("更新集群 Secret", false, "Secret 不存在: "+secName)
				c.JSON(http.StatusBadRequest, gin.H{"error": "Secret 不存在: " + secName, "steps": steps})
				return
			}
			RespondAPIError500(c, err.Error())
			return
		}
		if sec.Data == nil {
			sec.Data = map[string][]byte{}
		}
		if urlPatch {
			sec.Data["OPENAI_BASE_URL"] = []byte(urlIn)
		}
		if keyPatch {
			k := openClawUpstreamSecretKeyForAPIKey(inst.ModelPreset)
			sec.Data[k] = []byte(keyIn)
		}
		if _, err := app.K8s().CoreV1().Secrets(ns).Update(ctx, sec, metav1.UpdateOptions{}); err != nil {
			addStep("更新集群 Secret", false, err.Error())
			RespondAPIErrorMerged(c, http.StatusInternalServerError, err.Error(), gin.H{"steps": steps})
			return
		}
		addStep("更新集群 Secret（上游 API 地址 / 密钥）", true, "")
	}

	if err := openClawRolloutRestartDeployment(ctx, app.K8s(), ns, dep); err != nil {
		addStep("滚动重启网关 Deployment", false, err.Error())
		RespondAPIErrorMerged(c, http.StatusInternalServerError, err.Error(), gin.H{"steps": steps})
		return
	}
	addStep("触发滚动重启网关", true, "")

	rolloutErr := openClawWaitDeploymentRolloutReady(ctx, app.K8s(), ns, dep, 120*time.Second)
	rolloutOK := rolloutErr == nil
	var rolloutMsg string
	if rolloutErr != nil {
		rolloutMsg = rolloutErr.Error()
		addStep("等待 Deployment 就绪", false, rolloutMsg)
	} else {
		addStep("等待 Deployment 就绪", true, "")
	}

	list, err = loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIErrorMerged(c, http.StatusInternalServerError, err.Error(), gin.H{"steps": steps})
		return
	}
	inst = findAppOpenClawInstance(list, id)
	if inst == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "实例不存在", "steps": steps})
		return
	}

	probeCtx, probeCancel := context.WithTimeout(ctx, 32*time.Second)
	defer probeCancel()
	upOk, upDetail, upSt := openClawProbeUpstreamOpenAI(probeCtx, app.K8s(), inst)
	at := NowBeijingRFC3339()
	status := "fail"
	if upOk {
		status = "ok"
	}
	_ = patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.UpstreamCheckStatus = status
		x.UpstreamCheckMessage = upDetail
		x.UpstreamCheckAt = at
	})
	mirrorPlatformKVIfDualWrite(app)

	if upOk {
		addStep("上游模型探活", true, upDetail)
	} else {
		addStep("上游模型探活", false, upDetail)
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":                 true,
		"steps":              steps,
		"restarted":          true,
		"rolloutWaitOk":      rolloutOK,
		"rolloutWaitMessage": rolloutMsg,
		"upstreamOk":         upOk,
		"upstreamMessage":    upDetail,
		"upstreamHttpStatus": upSt,
		"modelTried":         MapOpenClawInstanceChatModel(inst),
		"upstreamCheckedAt":  at,
	})
}

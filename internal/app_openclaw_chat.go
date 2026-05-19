package internal

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	openClawChatMaxMessages     = 32
	openClawChatMaxContentRunes = 24000
	// 网关侧可能含多轮工具调用，需长于常见反代默认 60s；Ingress 请同步调大 proxy-read-timeout。
	openClawChatTimeout = 240 * time.Second
)

type openClawChatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type appOpenClawChatBody struct {
	Message  string            `json:"message"`
	Messages []openClawChatMsg `json:"messages"`
	Model    string            `json:"model"`
}

func openClawNormalizeChatMessages(body appOpenClawChatBody) ([]openClawChatMsg, error) {
	var out []openClawChatMsg
	if len(body.Messages) > 0 {
		out = make([]openClawChatMsg, 0, len(body.Messages))
		for _, m := range body.Messages {
			role := strings.ToLower(strings.TrimSpace(m.Role))
			content := strings.TrimSpace(m.Content)
			if role == "" || content == "" {
				continue
			}
			switch role {
			case "system", "user", "assistant":
			default:
				return nil, fmt.Errorf("非法 role: %s（仅支持 system、user、assistant）", m.Role)
			}
			out = append(out, openClawChatMsg{Role: role, Content: content})
		}
	} else {
		msg := strings.TrimSpace(body.Message)
		if msg == "" {
			return nil, fmt.Errorf("请提供 message 或 messages")
		}
		out = []openClawChatMsg{{Role: "user", Content: msg}}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("没有有效消息内容")
	}
	if len(out) > openClawChatMaxMessages {
		return nil, fmt.Errorf("消息条数过多（最多 %d 条）", openClawChatMaxMessages)
	}
	total := openClawChatMessagesTotalRunes(out)
	if total > openClawChatMaxContentRunes {
		out = clipOpenClawChatMessagesToMaxRunes(out, openClawChatMaxContentRunes)
		total = openClawChatMessagesTotalRunes(out)
		if total > openClawChatMaxContentRunes {
			return nil, fmt.Errorf("消息总长度超限（最多约 %d 字）", openClawChatMaxContentRunes)
		}
	}
	return out, nil
}

const openClawChatMsgTruncateSuffix = "\n…(内容过长，已由平台截断)"

func openClawChatMessagesTotalRunes(msgs []openClawChatMsg) int {
	n := 0
	for _, m := range msgs {
		n += len([]rune(m.Content))
	}
	return n
}

// clipOpenClawChatMessagesToMaxRunes 从最长的 user 消息（若无则任意最长）末尾裁减，直至总长 ≤ max，避免前端与 Go rune 计数细微差异导致 400。
func clipOpenClawChatMessagesToMaxRunes(msgs []openClawChatMsg, max int) []openClawChatMsg {
	out := append([]openClawChatMsg(nil), msgs...)
	suf := []rune(openClawChatMsgTruncateSuffix)
	for iter := 0; iter < 64 && openClawChatMessagesTotalRunes(out) > max; iter++ {
		total := openClawChatMessagesTotalRunes(out)
		drop := total - max + len(suf)
		if drop < 1 {
			drop = 1
		}
		idx := -1
		best := 0
		for i := len(out) - 1; i >= 0; i-- {
			if strings.ToLower(strings.TrimSpace(out[i].Role)) != "user" {
				continue
			}
			L := len([]rune(out[i].Content))
			if L > best {
				best = L
				idx = i
			}
		}
		if idx < 0 {
			for i := range out {
				L := len([]rune(out[i].Content))
				if L > best {
					best = L
					idx = i
				}
			}
		}
		if idx < 0 {
			break
		}
		r := []rune(out[idx].Content)
		if len(r) <= len(suf)+80 {
			out[idx].Content = string(suf)
			continue
		}
		keep := len(r) - drop
		if keep < 80 {
			keep = 80
		}
		if keep+len(suf) > len(r) {
			keep = len(r) - len(suf)
			if keep < 80 {
				out[idx].Content = string(suf)
				continue
			}
		}
		out[idx].Content = string(r[:keep]) + string(suf)
	}
	return out
}

func openClawRetryableChatTransportErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "eof") ||
		strings.Contains(s, "connection reset") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "write: broken pipe") ||
		strings.Contains(s, "read: connection reset") ||
		strings.Contains(s, "server closed idle connection")
}

// openClawPostChatCompletionsRaw POST 网关 chat/completions；对 EOF/连接重置等短暂错误自动重试（避免网关刚滚动或 idle 连接被掐断即失败）。
func openClawPostChatCompletionsRaw(ctx context.Context, u, bearer, xOpenclawModel string, raw []byte, clientTimeout time.Duration) (status int, body []byte, err error) {
	if clientTimeout <= 0 {
		clientTimeout = openClawChatTimeout
	}
	const maxAttempts = 3
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(120*attempt*attempt) * time.Millisecond
			select {
			case <-ctx.Done():
				return 0, nil, ctx.Err()
			case <-time.After(backoff):
			}
		}
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSpace(u), bytes.NewReader(raw))
		if reqErr != nil {
			return 0, nil, reqErr
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(bearer))
		// 避免复用半关闭长连接导致偶发 EOF（尤其集群内跨节点、网关滚动后）
		req.Close = true
		if strings.TrimSpace(xOpenclawModel) != "" {
			req.Header.Set("x-openclaw-model", strings.TrimSpace(xOpenclawModel))
		}
		tr := &http.Transport{
			TLSClientConfig:   &tls.Config{MinVersion: tls.VersionTLS12},
			DisableKeepAlives: true,
		}
		cli := &http.Client{Timeout: clientTimeout, Transport: tr}
		resp, doErr := cli.Do(req)
		if doErr != nil {
			if openClawRetryableChatTransportErr(doErr) && attempt+1 < maxAttempts {
				continue
			}
			return 0, nil, doErr
		}
		b, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		st := resp.StatusCode
		if readErr != nil {
			if openClawRetryableChatTransportErr(readErr) && attempt+1 < maxAttempts {
				continue
			}
			return st, b, readErr
		}
		return st, b, nil
	}
	return 0, nil, fmt.Errorf("openclaw POST 重试耗尽")
}

// openClawPostDirectChatCompletions 直连上游 OpenAI 兼容接口（与 Secret 中 OPENAI_BASE_URL / OPENAI_API_KEY 一致，不经 OpenClaw 网关 agent 路径）。
func openClawPostDirectChatCompletions(ctx context.Context, openAIBaseURL, apiKey, model string, messages []openClawChatMsg, ext map[string]interface{}, clientTimeout time.Duration, skipTLSVerify bool) (string, int, error) {
	base := strings.TrimRight(strings.TrimSpace(openAIBaseURL), "/")
	if base == "" || strings.TrimSpace(apiKey) == "" {
		return "", 0, fmt.Errorf("缺少上游 Base URL 或 API Key")
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultOpenClawFallbackChatModelID
	}
	u := openClawOpenAIChatCompletionsURL(base)
	if u == "" {
		return "", 0, fmt.Errorf("无法拼接上游 chat/completions URL")
	}
	payload := map[string]interface{}{
		"model":    model,
		"messages": messages,
	}
	for k, v := range ext {
		payload[k] = v
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(raw))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	if clientTimeout <= 0 {
		clientTimeout = openClawChatTimeout
	}
	tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: skipTLSVerify, MinVersion: tls.VersionTLS12}}
	cli := &http.Client{Timeout: clientTimeout, Transport: tr}
	resp, err := cli.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("[上游模型接入层·直连 Secret 中 OPENAI_BASE_URL] 请求失败（网络/DNS/TLS/超时等）: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", resp.StatusCode, fmt.Errorf("[上游模型接入层·直连] 读取响应体失败: %w", err)
	}
	if resp.StatusCode >= 400 {
		return "", resp.StatusCode, fmt.Errorf("[上游模型接入层·直连 OPENAI_BASE_URL，不经 OpenClaw 网关] HTTP %d: %s", resp.StatusCode, truncateErrMessage(string(body), 800))
	}
	var wrap struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return "", resp.StatusCode, fmt.Errorf("[上游模型接入层·直连] 解析 JSON 失败: %w", err)
	}
	if len(wrap.Choices) == 0 {
		return "", resp.StatusCode, fmt.Errorf("[上游模型接入层·直连] 响应中无 choices")
	}
	return strings.TrimSpace(wrap.Choices[0].Message.Content), resp.StatusCode, nil
}

func openClawPostChatCompletions(ctx context.Context, baseURL, bearer, model string, messages []openClawChatMsg) (string, int, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return "", 0, fmt.Errorf("缺少网关 Base URL")
	}
	if strings.TrimSpace(bearer) == "" {
		return "", 0, fmt.Errorf("缺少网关 Token")
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultOpenClawFallbackChatModelID
	}
	candidates := openClawChatCompletionsURLCandidates(baseURL)
	if len(candidates) == 0 {
		return "", 0, fmt.Errorf("无法拼接网关 chat/completions URL（请检查实例 ClusterV1BaseURL）")
	}
	routing := []openClawGatewayRoutingCandidate{{bodyModel: model}}
	if shouldUseOpenClawGatewayHTTPContract(base) {
		routing = openClawGatewayRoutingCandidates(model)
	}
	var tried404 []string
	for ri, route := range routing {
		payload := map[string]interface{}{
			"model":    route.bodyModel,
			"messages": messages,
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			return "", 0, err
		}
		tried404 = tried404[:0]
		for i, u := range candidates {
			st, body, err := openClawPostChatCompletionsRaw(ctx, u, bearer, route.headerModel, raw, openClawChatTimeout)
			if err != nil {
				return "", 0, err
			}
			if st == 404 && i+1 < len(candidates) {
				tried404 = append(tried404, u)
				continue
			}
			if st >= 400 {
				if st == 404 {
					msg := fmt.Sprintf("网关返回 404: %s", truncateErrMessage(string(body), 800))
					if len(tried404) > 0 {
						msg = fmt.Sprintf("已尝试 %s — %s", strings.Join(append(tried404, u), ", "), truncateErrMessage(string(body), 600))
					}
					return "", 404, fmt.Errorf("%s · %s", msg, openClawGatewayChat404RemediationZH)
				}
				if ri+1 < len(routing) && st >= 500 {
					break
				}
				return "", st, fmt.Errorf("网关返回 %d: %s", st, truncateErrMessage(string(body), 800))
			}
			var wrap struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
			}
			if err := json.Unmarshal(body, &wrap); err != nil {
				return "", st, fmt.Errorf("解析响应: %w", err)
			}
			if len(wrap.Choices) == 0 {
				return "", st, fmt.Errorf("网关未返回 choices")
			}
			return strings.TrimSpace(wrap.Choices[0].Message.Content), st, nil
		}
	}
	return "", 0, fmt.Errorf("无法完成网关补全")
}

// openClawGatewayHealthChatTimeoutDuration 后台探活与一键修复验证用；须覆盖网关→上游一轮极简补全。默认 90s；可通过 KUBEBT_OPENCLAW_GATEWAY_HEALTH_CHAT_TIMEOUT_SEC 调整（30–300）。
func openClawGatewayHealthChatTimeoutDuration() time.Duration {
	sec := 90
	if s := strings.TrimSpace(os.Getenv("KUBEBT_OPENCLAW_GATEWAY_HEALTH_CHAT_TIMEOUT_SEC")); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			if n < 30 {
				n = 30
			}
			if n > 300 {
				n = 300
			}
			sec = n
		}
	}
	return time.Duration(sec) * time.Second
}

// openClawHealthPingModelCandidates 探活用的模型尝试顺序：实例配置优先，其次常见 OpenAI 兼容 id。
// 解决平台默认或预设为 MiniMax/Qwen 等 id，而 Secret 实际指向 OpenAI 时网关返回 500 internal error 的误报。
func openClawHealthPingModelCandidates(primary string) []string {
	primary = strings.TrimSpace(primary)
	if primary == "" {
		primary = defaultOpenClawFallbackChatModelID
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		key := strings.ToLower(s)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, s)
	}
	add(primary)
	for _, fb := range []string{"gpt-4o-mini", "gpt-3.5-turbo"} {
		add(fb)
	}
	return out
}

func openClawExplainHealthChatProbeError(err error, timeout time.Duration) string {
	if err == nil {
		return ""
	}
	sec := int(timeout / time.Second)
	msg := err.Error()
	low := strings.ToLower(msg)
	deadline := errors.Is(err, context.DeadlineExceeded) || strings.Contains(low, "deadline exceeded") || strings.Contains(low, "context deadline exceeded")
	if deadline {
		return fmt.Sprintf("【超时】约 %ds 内未收到完整响应（网关或上游过慢、无响应）。请查 Secret 的 OPENAI_API_KEY、OPENAI_BASE_URL、代理与出站；可调环境变量 KUBEBT_OPENCLAW_GATEWAY_HEALTH_CHAT_TIMEOUT_SEC。详情：%s",
			sec, truncateErrMessage(msg, 260))
	}
	if strings.Contains(low, "connection refused") || strings.Contains(low, "no such host") {
		return fmt.Sprintf("【连不上】无法建立到网关的连接（拒绝连接或域名解析失败）。详情：%s", truncateErrMessage(msg, 280))
	}
	if strings.Contains(low, "i/o timeout") || strings.Contains(low, "client.timeout") {
		return fmt.Sprintf("【网络超时】与网关通信在等待阶段超时。请查 Service/Endpoints、网络策略与节点出站。详情：%s", truncateErrMessage(msg, 280))
	}
	// 未读到 HTTP 状态行：连接在对端提前关闭（常见于网关 panic/重启、无就绪后端、或连接被重置）
	if strings.Contains(msg, "EOF") || strings.Contains(low, "unexpected eof") {
		return "【连接提前结束·EOF】对端在返回完整 HTTP 响应前关闭了连接。常见：网关进程退出/重启、Pod 未就绪、Service 无 Endpoints、或到 18789 的 TCP 被重置。请 kubectl logs deployment/<网关名> -n <命名空间> 与 kubectl get endpoints。"
	}
	if strings.Contains(low, "connection reset by peer") || strings.Contains(low, "reset by peer") {
		return "【连接被重置】对端主动 RST。常见：网关崩溃、端口错、或中间设备断开长连接。请查网关 Pod 事件与日志。"
	}
	if strings.Contains(low, "broken pipe") {
		return "【连接已断开·broken pipe】写入时连接已被关闭。请查网关是否稳定、是否频繁重启。"
	}
	if strings.Contains(low, "tls") && (strings.Contains(low, "handshake") || strings.Contains(low, "certificate")) {
		return fmt.Sprintf("【TLS 错误】与网关 HTTPS 握手或证书校验失败。详情：%s", truncateErrMessage(msg, 220))
	}
	if strings.Contains(low, "use of closed network connection") {
		return "【连接已关闭】使用了已关闭的网络连接。请重试并查网关 Pod 是否重启。"
	}
	// 避免与 Post "http://..." 重复整段 URL
	return fmt.Sprintf("【传输错误·无有效 HTTP 响应】%s", truncateErrMessage(msg, 380))
}

// openClawGatewayHealthChatPing 与平台对话相同路径 POST chat/completions（含 openclaw/default 与 x-openclaw-model 路由），
// 使用 max_tokens=1 的极简请求，用于区分「Pod Running / GET 可达」与「补全链路实际可用」（如网关 500 internal error）。
// 对 HTTP 5xx 会按 openClawHealthPingModelCandidates 依次换模型重试（常见：实例 chatModel 与 Secret 上游厂商不一致）。
func openClawGatewayHealthChatPing(ctx context.Context, baseURL, bearer, model string) (httpStatus int, ok bool, detail string) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return 0, false, "缺少集群内 Base URL"
	}
	if strings.TrimSpace(bearer) == "" {
		return 0, false, "缺少网关 Token"
	}
	configuredModel := strings.TrimSpace(model)
	if configuredModel == "" {
		configuredModel = defaultOpenClawFallbackChatModelID
	}
	models := openClawHealthPingModelCandidates(configuredModel)
	candidates := openClawChatCompletionsURLCandidates(baseURL)
	if len(candidates) == 0 {
		return 0, false, "无法拼接 chat/completions URL"
	}
	timeout := openClawGatewayHealthChatTimeoutDuration()
	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var lastSt int
	var lastBody string
	var lastURL string

	for mi, tryModel := range models {
		routing := []openClawGatewayRoutingCandidate{{bodyModel: tryModel}}
		if shouldUseOpenClawGatewayHTTPContract(base) {
			routing = openClawGatewayRoutingCandidates(tryModel)
		}

		for ri, route := range routing {
			payload := map[string]interface{}{
				"model":       route.bodyModel,
				"messages":    []map[string]string{{"role": "user", "content": "kube-bt-sync health ping, reply OK"}},
				"max_tokens":  1,
				"temperature": 0,
			}
			raw, err := json.Marshal(payload)
			if err != nil {
				return 0, false, err.Error()
			}

			var tried404 []string
			for i, u := range candidates {
				lastURL = u
				st, body, err := openClawPostChatCompletionsRaw(pingCtx, u, bearer, route.headerModel, raw, timeout)
				if err != nil {
					return 0, false, openClawExplainHealthChatProbeError(err, timeout)
				}
				lastSt, lastBody = st, string(body)
				httpStatus = st
				if st == 404 && i+1 < len(candidates) {
					tried404 = append(tried404, u)
					continue
				}
				if st >= 400 && st < 500 {
					if st == 404 {
						parts := make([]string, 0, 3)
						if len(tried404) > 0 {
							parts = append(parts, "已尝试 "+strings.Join(append(tried404, u), ", "))
						}
						parts = append(parts, fmt.Sprintf("网关返回 404: %s", truncateErrMessage(string(body), 500)))
						parts = append(parts, openClawGatewayChat404RemediationZH)
						return st, false, strings.Join(parts, " · ")
					}
					// 4xx（除已处理的 404）：多为鉴权、配额、错误请求；换模型通常无效
					return st, false, fmt.Sprintf("网关返回 %d: %s", st, truncateErrMessage(string(body), 600))
				}
				if st >= 500 {
					break // 先换同模型的兼容路由，再换备用模型
				}
				var wrap struct {
					Choices []struct {
						Message struct {
							Content string `json:"content"`
						} `json:"message"`
					} `json:"choices"`
				}
				if err := json.Unmarshal(body, &wrap); err != nil {
					return st, false, fmt.Sprintf("解析响应: %v", err)
				}
				if len(wrap.Choices) == 0 {
					return st, false, "网关未返回 choices（补全链路异常）"
				}
				if mi > 0 {
					return st, true, fmt.Sprintf("探活已通过备用模型「%s」成功（实例当前配置「%s」在上游不可用；请在应用中心将「对话模型」改为与 Secret 中 OPENAI_BASE_URL 厂商一致的 model id）", tryModel, configuredModel)
				}
				if ri > 0 {
					return st, true, fmt.Sprintf("探活已通过兼容路由成功（实例当前模型「%s」在该网关版本下更适合使用原始模型名）。", tryModel)
				}
				return st, true, ""
			}
		}
	}

	msg := fmt.Sprintf("网关返回 %d: %s", lastSt, truncateErrMessage(lastBody, 600))
	if lastSt >= 500 && len(models) > 1 {
		msg += fmt.Sprintf(" · 已依次用模型 [%s] 探活均失败", strings.Join(models, ", "))
		msg += " · 请核对 Secret 的 OPENAI_API_KEY、OPENAI_BASE_URL、HTTP 代理与集群出站；并确认「对话模型」与上游厂商一致（例如 OpenAI 用 gpt-4o-mini，非 MiniMax id）"
	}
	if lastURL != "" {
		msg += " · URL " + lastURL
	}
	return lastSt, false, msg
}

func handleAppOpenClawChat(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body appOpenClawChatBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	msgs, err := openClawNormalizeChatMessages(body)
	if err != nil {
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
	if app.K8s() != nil {
		stCtx, stCancel := context.WithTimeout(c.Request.Context(), 6*time.Second)
		st := openClawK8sStatus(stCtx, app.K8s(), inst.Namespace, inst.DeploymentName, inst.Image)
		stCancel()
		if synced, ok := st["imageRolloutSynced"].(bool); ok && !synced {
			run, _ := st["runningGatewayImage"].(string)
			c.JSON(http.StatusConflict, gin.H{
				"error":               "网关镜像切换中或运行 Pod 尚未与平台登记一致，请待 Pod 就绪后再试",
				"registeredImage":     strings.TrimSpace(inst.Image),
				"runningGatewayImage": run,
			})
			return
		}
	}
	base := strings.TrimSpace(inst.ClusterV1BaseURL)
	if base == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "实例缺少集群内 Base URL，无法代发对话"})
		return
	}
	key, err := opsEncryptionKey(app.Cfg())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tok, err := decryptSecret(key, inst.GatewayTokenEnc)
	if err != nil || strings.TrimSpace(tok) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法读取网关 Token，请检查实例是否完整部署"})
		return
	}
	model := strings.TrimSpace(body.Model)
	if model == "" {
		model = MapOpenClawInstanceGatewayModelRef(inst)
	}
	if model == "" {
		model = "openclaw/default"
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), openClawChatTimeout+20*time.Second)
	defer cancel()
	// 仅走 OpenClaw 网关，以便工具链可用。网关失败时不再回退 Secret 直连上游：直连无工具，易表现为「只能给文档/命令建议」，与用户对应用中心对话的预期不符。
	reply, status, chatErr := openClawPostChatCompletions(ctx, base, tok, model, msgs)
	if chatErr != nil {
		errMsg := chatErr.Error()
		if status == 0 {
			if hint := openClawExplainHealthChatProbeError(chatErr, openClawChatTimeout); hint != "" {
				errMsg = hint + " 原始：" + truncateErrMessage(errMsg, 280)
			}
		}
		if status >= 400 {
			c.JSON(http.StatusBadGateway, gin.H{"error": errMsg, "httpStatus": status})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": errMsg})
		return
	}
	viewerChat := false
	if v, ok := c.Get("dashboardRole"); ok {
		if s, ok := v.(string); ok && s == DashboardRoleViewer {
			viewerChat = true
		}
	}
	_ = patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.ChatProxyCount++
		if viewerChat {
			x.ChatProxyCountViewer++
		}
	})
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{
		"reply":      reply,
		"model":      model,
		"httpStatus": status,
	})
}

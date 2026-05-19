package internal

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func registerAppOpenClawRoutes(api *gin.RouterGroup, app *ServerApp) {
	g := api.Group("/app-center/openclaw")
	g.GET("/gateway-service-health", func(c *gin.Context) { handleOpenClawGatewayServiceHealthGet(c, app) })
	g.POST("/gateway-service-health/read", func(c *gin.Context) { handleOpenClawGatewayServiceHealthRead(c, app) })
	g.GET("/image-catalog", func(c *gin.Context) { handleAppOpenClawImageCatalogGet(c, app) })
	g.PUT("/image-catalog", func(c *gin.Context) { handleAppOpenClawImageCatalogPut(c, app) })
	g.GET("/bootstrap", func(c *gin.Context) { handleAppOpenClawBootstrapGet(c, app) })
	g.PUT("/bootstrap", func(c *gin.Context) { handleAppOpenClawBootstrapPut(c, app) })
	g.GET("/rbac-presets", func(c *gin.Context) { handleAppOpenClawRBACPresetsGet(c, app) })
	g.GET("/toolchain-options", func(c *gin.Context) { handleAppOpenClawToolchainOptionsGet(c, app) })
	g.GET("/instances", func(c *gin.Context) { handleAppOpenClawList(c, app) })
	g.GET("/instances/k8s-status", func(c *gin.Context) { handleAppOpenClawK8sStatusBatch(c, app) })
	g.GET("/instances/:id/gateway-token", func(c *gin.Context) { handleAppOpenClawGatewayToken(c, app) })
	g.GET("/instances/:id/gateway-probe", func(c *gin.Context) { handleAppOpenClawGatewayProbe(c, app) })
	g.GET("/instances/:id/file", func(c *gin.Context) { handleAppOpenClawFileGet(c, app) })
	g.PUT("/instances/:id/file", func(c *gin.Context) { handleAppOpenClawFilePut(c, app) })
	g.POST("/instances/:id/chat", func(c *gin.Context) { handleAppOpenClawChat(c, app) })
	g.GET("/instances/:id/upstream-health", func(c *gin.Context) { handleAppOpenClawUpstreamHealth(c, app) })
	g.POST("/instances/:id/chat-model", func(c *gin.Context) { handleAppOpenClawSetChatModel(c, app) })
	g.POST("/instances/:id/apply-upstream-runtime", func(c *gin.Context) { handleAppOpenClawApplyUpstreamRuntime(c, app) })
	g.GET("/instances/:id/telegram-settings", func(c *gin.Context) { handleOpenClawTelegramSettingsGet(c, app) })
	g.PUT("/instances/:id/telegram-settings", func(c *gin.Context) { handleOpenClawTelegramSettingsPut(c, app) })
	g.POST("/instances/:id/google-reachability-check", func(c *gin.Context) { handleOpenClawGoogleReachabilityCheck(c, app) })
	g.POST("/instances/:id/apply-telegram-to-openclaw-json", func(c *gin.Context) { handleOpenClawApplyTelegramToJSON(c, app) })
	g.POST("/instances/:id/telegram-verify", func(c *gin.Context) { handleOpenClawTelegramVerify(c, app) })
	g.POST("/instances/:id/egress-proxy", func(c *gin.Context) { handleAppOpenClawPatchEgressProxy(c, app) })
	g.POST("/instances/:id/rbac-preset", func(c *gin.Context) { handleAppOpenClawInstanceRBACPreset(c, app) })
	g.POST("/instances/:id/apply-toolchain-preset", func(c *gin.Context) { handleAppOpenClawApplyToolchainPreset(c, app) })
	g.POST("/instances/:id/gateway-image", func(c *gin.Context) { handleAppOpenClawGatewayImage(c, app) })
	g.POST("/validate-upstream", func(c *gin.Context) { handleAppOpenClawValidateUpstream(c, app) })
	g.POST("/k8s-deploy", func(c *gin.Context) { handleAppOpenClawK8sDeploy(c, app) })
	g.POST("/instances/:id/sync-to-inspect", func(c *gin.Context) { handleAppOpenClawSyncInspect(c, app) })
	g.DELETE("/instances/:id", func(c *gin.Context) { handleAppOpenClawDelete(c, app) })
}

func handleAppOpenClawGatewayToken(c *gin.Context, app *ServerApp) {
	if getDashboardRoleFromGin(c) != DashboardRoleAdmin {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
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
	key, err := opsEncryptionKey(app.Cfg())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tok, err := decryptSecret(key, inst.GatewayTokenEnc)
	if err != nil || strings.TrimSpace(tok) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法解密 Token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"gatewayToken": strings.TrimSpace(tok)})
}

func handleAppOpenClawList(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	key, _ := opsEncryptionKey(app.Cfg())
	out := make([]gin.H, 0, len(list))
	for _, x := range list {
		nsTrim := strings.TrimSpace(x.Namespace)
		depTrim := strings.TrimSpace(x.DeploymentName)
		rbacID := NormalizeOpenClawRBACPreset(x.RBACPreset)
		h := gin.H{
			"id":                   x.ID,
			"displayName":          x.DisplayName,
			"namespace":            x.Namespace,
			"deploymentName":       x.DeploymentName,
			"serviceName":          x.ServiceName,
			"image":                x.Image,
			"gatewayPort":          x.GatewayPort,
			"nodePort":             x.NodePort,
			"modelPreset":          x.ModelPreset,
			"clusterV1BaseUrl":     x.ClusterV1BaseURL,
			"externalV1Url":        x.ExternalV1URL,
			"nodeAccessIp":         x.NodeAccessIP,
			"exposeMode":           x.ExposeMode,
			"ingressHost":          x.IngressHost,
			"ingressResourceName":  x.IngressResourceName,
			"publicV1Url":          x.PublicV1URL,
			"createdAt":            x.CreatedAt,
			"gatewayTokenSet":      strings.TrimSpace(x.GatewayTokenEnc) != "",
			"pvcClaimName":         x.PvcClaimName,
			"secretName":           x.SecretName,
			"configMapName":        x.ConfigMapName,
			"serviceAccountName":   x.ServiceAccountName,
			"chatModel":            x.ChatModel,
			"chatProxyCount":       x.ChatProxyCount,
			"chatProxyCountViewer": x.ChatProxyCountViewer,
			"upstreamCheckStatus":  x.UpstreamCheckStatus,
			"upstreamCheckMessage": x.UpstreamCheckMessage,
			"upstreamCheckAt":      x.UpstreamCheckAt,
			"egressCloudVmId":      x.EgressCloudVmID,
			"httpProxyUrl":         x.HttpProxyURL,
			"rbacPreset":           strings.TrimSpace(x.RBACPreset),
			"toolsProfile":         strings.TrimSpace(x.ToolsProfile),
			"promptPacks":          append([]string(nil), x.PromptPacks...),
			// 便于运维核对：ClusterRole 名（如 kube-bt-openclaw-admin）与 Binding 名（kube-bt-openclaw-<ns>-<dep>）不同，勿混用
			"rbacClusterRoleName":    OpenClawClusterRoleForPreset(rbacID),
			"clusterRoleBindingName": openClawClusterRoleBindingName(nsTrim, depTrim),
		}
		if db := app.MySQLDB(); db != nil {
			if en, gok, gat, htok, err := openClawTelegramSummary(db, x.ID); err == nil {
				h["telegramEnabled"] = en
				h["googleOk"] = gok
				h["googleCheckedAt"] = gat
				h["hasTelegramToken"] = htok
			}
		}
		if strings.TrimSpace(x.GatewayTokenEnc) != "" && key != nil {
			if tok, err := decryptSecret(key, x.GatewayTokenEnc); err == nil && strings.TrimSpace(tok) != "" {
				h["gatewayTokenPreview"] = maskSecretPreview(tok)
			}
		}
		out = append(out, h)
	}
	c.JSON(http.StatusOK, gin.H{"instances": out})
}

func maskSecretPreview(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 8 {
		return "****"
	}
	return s[:4] + "…" + s[len(s)-4:]
}

func handleAppOpenClawK8sStatusBatch(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	statuses := collectOpenClawK8sStatuses(ctx, app.K8s(), list)
	c.JSON(http.StatusOK, gin.H{"statuses": statuses})
}

func handleAppOpenClawGatewayProbe(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
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
	bearer := ""
	key, kerr := opsEncryptionKey(app.Cfg())
	if kerr == nil && key != nil && strings.TrimSpace(inst.GatewayTokenEnc) != "" {
		if tok, derr := decryptSecret(key, inst.GatewayTokenEnc); derr == nil {
			bearer = strings.TrimSpace(tok)
		}
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()
	res := openClawGatewayProbe(ctx, inst, bearer)
	c.JSON(http.StatusOK, res)
}

type appOpenClawDeployBody struct {
	Namespace           string `json:"namespace"`
	DeploymentName      string `json:"deploymentName"`
	ServiceName         string `json:"serviceName"`
	NodePort            int32  `json:"nodePort"`
	ExposeMode          string `json:"exposeMode"`
	IngressName         string `json:"ingressName"`
	IngressHost         string `json:"ingressHost"`
	IngressTLSScheme    string `json:"ingressTlsScheme"`
	BaotaSyncAnnotation string `json:"baotaSyncAnnotation"`
	Image               string `json:"image"`
	InitContainerImage  string `json:"initContainerImage"`
	OpenAIAPIKey        string `json:"openaiApiKey"`
	OpenAIBaseURL       string `json:"openaiBaseUrl"`
	GeminiAPIKey        string `json:"geminiApiKey"`
	ModelPreset         string `json:"modelPreset"`
	ChatModel           string `json:"chatModel"`
	DisplayName         string `json:"displayName"`
	HttpProxyURL        string `json:"httpProxyUrl"`
	EgressCloudVmID     string `json:"egressCloudVmId"`
	// RBACPreset 空则使用 bootstrap 的 defaultRbacPreset；非空须为 readonly | edit | admin
	RBACPreset string `json:"rbacPreset"`
	// ToolsProfile 空则 full；须为 minimal | coding | full
	ToolsProfile string `json:"toolsProfile"`
	// PromptPacks 可选提示词包 ID（安装时写入 ConfigMap 中 SOUL/AGENTS）
	PromptPacks []string `json:"promptPacks"`
}

func handleAppOpenClawK8sDeploy(c *gin.Context, app *ServerApp) {
	if app.K8s() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	var body appOpenClawDeployBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(body.ModelPreset) == "" {
		body.ModelPreset = "minimax-m2.7"
	}
	nsTrim := strings.TrimSpace(body.Namespace)
	depTrim := strings.TrimSpace(body.DeploymentName)
	existList, lerr := loadAppOpenClawInstances(app.PlatformKV())
	if lerr != nil {
		RespondAPIError500(c, lerr.Error())
		return
	}
	for _, x := range existList {
		if strings.EqualFold(strings.TrimSpace(x.Namespace), nsTrim) && strings.EqualFold(strings.TrimSpace(x.DeploymentName), depTrim) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "平台已登记相同「命名空间 + Deployment」的实例，请勿重复创建。可删除旧登记或更换名称后再部署。"})
			return
		}
	}
	rbacForDeploy := "readonly"
	if app.PlatformKV() != nil {
		ocBoot := loadOpenClawBootstrap(app.PlatformKV())
		if ocBoot != nil && strings.TrimSpace(ocBoot.DefaultRBACPreset) != "" {
			rbacForDeploy = NormalizeOpenClawRBACPreset(ocBoot.DefaultRBACPreset)
		}
	}
	if strings.TrimSpace(body.RBACPreset) != "" {
		p, ok := strictOpenClawRBACPreset(body.RBACPreset)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "rbacPreset 须为 readonly、edit 或 admin"})
			return
		}
		rbacForDeploy = p
	}
	boot := loadCloudVMBootstrap(app.PlatformKV())
	nodeIP := ""
	if boot != nil {
		nodeIP = firstNodeAccessIP(c.Request.Context(), app.K8s())
		if strings.TrimSpace(boot.DefaultAccessNodeName) != "" {
			if ip := nodeAccessIPForNodeName(c.Request.Context(), app.K8s(), boot.DefaultAccessNodeName); ip != "" {
				nodeIP = ip
			}
		}
	}
	httpProxyEff := OpenClawEffectiveHTTPProxyURL(c.Request.Context(), app, &AppOpenClawInstance{
		HttpProxyURL:    strings.TrimSpace(body.HttpProxyURL),
		EgressCloudVmID: strings.TrimSpace(body.EgressCloudVmID),
	})
	chatModelEff := strings.TrimSpace(body.ChatModel)
	if chatModelEff == "" {
		chatModelEff = mapModelPresetToAPI(body.ModelPreset)
	}
	openAIBaseApplied := presetToOpenAIBaseURL(body.ModelPreset, body.OpenAIBaseURL)
	if err := validateOpenClawCreateUpstream(c.Request.Context(), body.ModelPreset, openAIBaseApplied, strings.TrimSpace(body.OpenAIAPIKey), chatModelEff); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             err.Error(),
			"openaiBaseApplied": openAIBaseApplied,
			"chatModel":         chatModelEff,
		})
		return
	}
	toolsProf := NormalizeOpenClawToolsProfile(body.ToolsProfile)
	promptPacks := SanitizePromptPackIDs(body.PromptPacks)
	inst, gwPlain, err := ApplyOpenClawToCluster(c.Request.Context(), app.K8s(), nodeIP, OpenClawK8sDeployOpts{
		Namespace:           body.Namespace,
		DeploymentName:      body.DeploymentName,
		ServiceName:         body.ServiceName,
		NodePort:            body.NodePort,
		ExposeMode:          body.ExposeMode,
		IngressName:         body.IngressName,
		IngressHost:         body.IngressHost,
		IngressTLSScheme:    body.IngressTLSScheme,
		BaotaSyncAnnotation: body.BaotaSyncAnnotation,
		Image:               body.Image,
		InitContainerImage:  body.InitContainerImage,
		OpenAIAPIKey:        body.OpenAIAPIKey,
		OpenAIBaseURL:       openAIBaseApplied,
		GeminiAPIKey:        body.GeminiAPIKey,
		ModelPreset:         body.ModelPreset,
		ChatModel:           chatModelEff,
		HttpProxyURL:        httpProxyEff,
		RBACPreset:          rbacForDeploy,
		ToolsProfile:        toolsProf,
		PromptPacks:         promptPacks,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(body.DisplayName) != "" {
		inst.DisplayName = strings.TrimSpace(body.DisplayName)
	}
	inst.EgressCloudVmID = strings.TrimSpace(body.EgressCloudVmID)
	inst.HttpProxyURL = strings.TrimSpace(body.HttpProxyURL)
	key, err := opsEncryptionKey(app.Cfg())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	enc, err := encryptSecret(key, gwPlain)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	inst.GatewayTokenEnc = enc
	saved, err := appendAppOpenClawInstance(app.PlatformKV(), inst)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{
		"instance":          saved,
		"gatewayToken":      gwPlain,
		"openaiBaseApplied": openAIBaseApplied,
	})
}

func handleAppOpenClawValidateUpstream(c *gin.Context, app *ServerApp) {
	var body appOpenClawDeployBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(body.ModelPreset) == "" {
		body.ModelPreset = "minimax-m2.7"
	}
	chatModelEff := strings.TrimSpace(body.ChatModel)
	if chatModelEff == "" {
		chatModelEff = mapModelPresetToAPI(body.ModelPreset)
	}
	openAIBaseApplied := presetToOpenAIBaseURL(body.ModelPreset, body.OpenAIBaseURL)
	if err := validateOpenClawCreateUpstream(c.Request.Context(), body.ModelPreset, openAIBaseApplied, strings.TrimSpace(body.OpenAIAPIKey), chatModelEff); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"ok":                false,
			"error":             err.Error(),
			"openaiBaseApplied": openAIBaseApplied,
			"chatModel":         chatModelEff,
			"modelPreset":       body.ModelPreset,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":                true,
		"message":           fmt.Sprintf("预检通过：preset=%s · model=%s · base=%s", body.ModelPreset, chatModelEff, openAIBaseApplied),
		"openaiBaseApplied": openAIBaseApplied,
		"chatModel":         chatModelEff,
		"modelPreset":       body.ModelPreset,
	})
}

func shouldValidateOpenClawCreatePreset(preset string) bool {
	switch strings.TrimSpace(preset) {
	case "minimax-m2.5", "minimax-m2.7", "glm-4.7", "qwen-compatible", "kimi", "ollama":
		return true
	default:
		return false
	}
}

func validateOpenClawCreateUpstream(ctx context.Context, preset, baseURL, apiKey, chatModel string) error {
	preset = strings.TrimSpace(preset)
	if !shouldValidateOpenClawCreatePreset(preset) {
		return nil
	}
	baseURL = strings.TrimSpace(baseURL)
	chatModel = strings.TrimSpace(chatModel)
	if chatModel == "" {
		chatModel = mapModelPresetToAPI(preset)
	}
	if chatModel == "" {
		return fmt.Errorf("创建前校验失败：缺少上游模型名（chatModel）")
	}
	if baseURL == "" {
		return fmt.Errorf("创建前校验失败：缺少 OPENAI_BASE_URL")
	}
	if preset == "ollama" {
		if strings.Contains(baseURL, "127.0.0.1") || strings.Contains(baseURL, "localhost") {
			return fmt.Errorf("创建前校验失败：Ollama 预设必须填写可从 OpenClaw Pod 访问的 /v1 地址，不能使用 %s；例如 http://ollama.default.svc.cluster.local:11434/v1", baseURL)
		}
	} else if strings.TrimSpace(apiKey) == "" {
		return fmt.Errorf("创建前校验失败：预设 %s 需要填写 API Key", preset)
	}

	sub, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var st int
	var detail string
	if preset == "ollama" {
		k := strings.TrimSpace(apiKey)
		if k == "" {
			k = "ollama-local"
		}
		st, detail = openClawUpstreamOllamaPingOnce(sub, strings.TrimSuffix(baseURL, "/v1"), k, chatModel, 18*time.Second)
	} else {
		st, detail = openClawUpstreamChatPingOnce(sub, baseURL, strings.TrimSpace(apiKey), chatModel, 18*time.Second)
	}
	if st >= 200 && st < 400 {
		return nil
	}
	tip := ""
	switch preset {
	case "minimax-m2.5", "minimax-m2.7":
		if strings.Contains(detail, "2049") || strings.Contains(strings.ToLower(detail), "invalid api key") {
			tip = "；MiniMax 常见为密钥门户与 Base URL 不一致：platform.minimaxi.com 创建的 Key 请优先用 https://api.minimaxi.com/v1，旧 minimax.io 密钥再改 https://api.minimax.io/v1"
		}
	case "ollama":
		tip = "；请确认该模型已在 Ollama 侧 pull，并且 kube-bt-sync 进程可访问该 /v1 地址"
	case "glm-4.7":
		tip = "；智谱 GLM 兼容地址通常应为 https://open.bigmodel.cn/api/paas/v4"
	case "qwen-compatible":
		tip = "；千问兼容地址通常应为 https://dashscope.aliyuncs.com/compatible-mode/v1"
	case "kimi":
		tip = "；Kimi 兼容地址通常应为 https://api.moonshot.cn/v1"
	}
	if st == 0 {
		return fmt.Errorf("创建前校验失败：无法连接上游 API（preset=%s, model=%s, base=%s）：%s%s", preset, chatModel, baseURL, truncateErrMessage(detail, 500), tip)
	}
	return fmt.Errorf("创建前校验失败：上游 API 返回 HTTP %d（preset=%s, model=%s, base=%s）：%s%s", st, preset, chatModel, baseURL, truncateErrMessage(detail, 500), tip)
}

func presetToOpenAIBaseURL(preset, override string) string {
	if strings.TrimSpace(override) != "" {
		return strings.TrimSpace(override)
	}
	switch strings.TrimSpace(preset) {
	case "glm-4.7":
		return "https://open.bigmodel.cn/api/paas/v4"
	case "minimax-m2.5", "minimax-m2.7":
		// OpenAI 兼容：api.minimaxi.com 与 api.minimax.io 均为官方文档所列入口；在 platform.minimaxi.com（Token 套餐等）创建的 Key
		// 常需使用 api.minimaxi.com，否则易出现 HTTP 401 invalid api key (2049)。旧版仅 minimax.io 密钥时可手动改 Secret 为 https://api.minimax.io/v1
		return "https://api.minimaxi.com/v1"
	case "ollama":
		// 集群内需改为可解析地址，如 http://ollama.default.svc.cluster.local:11434/v1
		return "http://127.0.0.1:11434/v1"
	case "qwen-compatible":
		return "https://dashscope.aliyuncs.com/compatible-mode/v1"
	case "kimi":
		return "https://api.moonshot.cn/v1"
	case "openai":
		return "https://api.openai.com/v1"
	default:
		return ""
	}
}

func handleAppOpenClawSyncInspect(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
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
	bundle, err := loadOpsOpenClawBundle(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	key, err := opsEncryptionKey(app.Cfg())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	bundle.OpenClaw.EndpointSource = "appInstance"
	bundle.OpenClaw.AppInstanceID = inst.ID
	bundle.OpenClaw.BaseURL = strings.TrimSpace(inst.ClusterV1BaseURL)
	tok, err := decryptSecret(key, inst.GatewayTokenEnc)
	if err != nil || strings.TrimSpace(tok) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法读取网关 Token"})
		return
	}
	enc, err := encryptSecret(key, strings.TrimSpace(tok))
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	bundle.OpenClaw.APIKeyEnc = enc
	bundle.OpenClaw.Model = mapModelPresetToAPI(inst.ModelPreset)
	bundle.OpenClaw.Enabled = true
	if err := saveOpsOpenClawBundle(app.PlatformKV(), bundle); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{"message": "已同步到 AI 巡检 OpenClaw 配置"})
}

func handleAppOpenClawGatewayImage(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.K8s() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body struct {
		Image string `json:"image"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	img := strings.TrimSpace(body.Image)
	if img == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "镜像地址不能为空"})
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	if err := PatchOpenClawGatewayMainImage(ctx, app.K8s(), inst.Namespace, inst.DeploymentName, img); err != nil {
		RespondAPIError500(c, "更新网关镜像: "+err.Error())
		return
	}
	if err := patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.Image = img
	}); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{"ok": true, "image": img})
}

func handleAppOpenClawDelete(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
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
	var k8sWarnings []string
	k8sSkippedShared := false
	k8sAttempted := false
	if app.K8s() != nil {
		k8sAttempted = true
		skipShared := openClawDeleteSkipSharedPVC(inst, list, id)
		k8sSkippedShared = skipShared
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
		k8sWarnings = DeleteOpenClawK8sResources(ctx, app.K8s(), *inst, skipShared)
		cancel()
	} else {
		k8sWarnings = append(k8sWarnings, "K8s 未连接，仅移除平台登记")
	}
	if err := removeAppOpenClawInstance(app.PlatformKV(), id); err != nil {
		RespondAPIErrorMerged(c, http.StatusInternalServerError, err.Error(), gin.H{"k8sWarnings": k8sWarnings})
		return
	}
	openClawGatewayHealthEvictInstance(id)
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{
		"ok":               true,
		"k8sAttempted":     k8sAttempted,
		"k8sWarnings":      k8sWarnings,
		"k8sSkippedShared": k8sSkippedShared,
	})
}

// openClawDeleteSkipSharedPVC 仅当「旧版共享卷」且同命名空间仍有其他登记时跳过删 PVC/Secret 等。
func openClawDeleteSkipSharedPVC(inst *AppOpenClawInstance, list []AppOpenClawInstance, excludeID string) bool {
	if inst == nil {
		return false
	}
	if strings.TrimSpace(inst.PvcClaimName) != "" {
		return false
	}
	return otherOpenClawSameNamespace(list, excludeID, inst.Namespace)
}

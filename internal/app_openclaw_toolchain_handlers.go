package internal

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func handleAppOpenClawToolchainOptionsGet(c *gin.Context, _ *ServerApp) {
	c.JSON(http.StatusOK, gin.H{
		"toolchains":  OpenClawToolchainPresets(),
		"promptPacks": OpenClawPromptPacksCatalog(),
		"ollamaModelRecommendations": []gin.H{
			{"id": "qwen2.5:7b", "note": "通义千问 7B，工具与中文均衡，资源占用适中"},
			{"id": "qwen2.5:14b", "note": "能力更强，需更大显存；可配合 16k+ context 登记"},
			{"id": "llama3.1:8b", "note": "Meta 开源，英文与指令遵循较好"},
			{"id": "mistral:7b", "note": "Mistral 7B，通用对话"},
			{"id": "deepseek-r1:8b", "note": "推理向；若工具调用弱可换同系列其它体积"},
		},
	})
}

type openClawApplyToolchainBody struct {
	ToolsProfile string   `json:"toolsProfile"`
	PromptPacks  []string `json:"promptPacks"`
}

func handleAppOpenClawApplyToolchainPreset(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	if !GuardK8sREST(c, app.K8s(), app.K8sREST()) {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body openClawApplyToolchainBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tp, ok := strictOpenClawToolsProfile(body.ToolsProfile)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "toolsProfile 须为 minimal、coding 或 full"})
		return
	}
	packs := SanitizePromptPackIDs(body.PromptPacks)

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

	ctx, cancel := context.WithTimeout(c.Request.Context(), 150*time.Second)
	defer cancel()

	podName, err := openClawPickGatewayPod(ctx, app.K8s(), inst.Namespace, inst.DeploymentName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	raw, err := openClawReadFileFromPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, podName, openClawAbsPath("openclaw.json"))
	if err != nil {
		if errors.Is(err, errOpenClawFileMissing) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "PVC 上尚无 openclaw.json，请等待 init 完成"})
			return
		}
		RespondAPIError500(c, err.Error())
		return
	}
	mergedJSON, err := PatchOpenClawJSONToolsProfile(string(raw), tp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := openClawWriteFileToPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, podName, openClawAbsPath("openclaw.json"), []byte(mergedJSON)); err != nil {
		if msg, code := classifyPVCExecEnvironmentError(err, ""); code != "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg, "code": code})
			return
		}
		RespondAPIError500(c, err.Error())
		return
	}
	soul := OpenClawBuildSOULMarkdown(packs)
	agents := OpenClawBuildAGENTSMarkdown(packs)
	if err := openClawWriteFileToPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, podName, openClawAbsPath("workspace/SOUL.md"), []byte(soul)); err != nil {
		if msg, code := classifyPVCExecEnvironmentError(err, ""); code != "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg, "code": code})
			return
		}
		RespondAPIError500(c, err.Error())
		return
	}
	if err := openClawWriteFileToPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, podName, openClawAbsPath("workspace/AGENTS.md"), []byte(agents)); err != nil {
		if msg, code := classifyPVCExecEnvironmentError(err, ""); code != "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg, "code": code})
			return
		}
		RespondAPIError500(c, err.Error())
		return
	}

	if err := openClawRolloutRestartDeployment(ctx, app.K8s(), inst.Namespace, inst.DeploymentName); err != nil {
		RespondAPIError500(c, "已写入 PVC，但滚动重启失败: "+err.Error())
		return
	}
	_ = openClawWaitDeploymentRolloutReady(ctx, app.K8s(), inst.Namespace, inst.DeploymentName, 100*time.Second)

	if err := patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.ToolsProfile = tp
		x.PromptPacks = append([]string(nil), packs...)
	}); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	mirrorPlatformKVIfDualWrite(app)

	c.JSON(http.StatusOK, gin.H{
		"ok":              true,
		"toolsProfile":    tp,
		"promptPacks":     packs,
		"gatewayRestart": true,
	})
}

package internal

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// OpenClawGatewayHealthItem 单次后台巡检中某一实例的摘要（与对话同集群内 chat/completions 探活）。
type OpenClawGatewayHealthItem struct {
	ID                    string `json:"id"`
	DisplayName           string `json:"displayName"`
	Namespace             string `json:"namespace"`
	DeploymentName        string `json:"deploymentName"`
	Skipped               bool   `json:"skipped"`
	SkipReason            string `json:"skipReason,omitempty"`
	K8sPhase              string `json:"k8sPhase,omitempty"`
	HTTPProbeOk           bool   `json:"httpProbeOk"`
	HTTPProbeMessage      string `json:"httpProbeMessage,omitempty"`
	HTTPProbeURL          string `json:"httpProbeUrl,omitempty"`
	ClusterChatOk         bool   `json:"clusterChatOk"`
	ClusterChatMessage    string `json:"clusterChatMessage,omitempty"`
	ClusterChatHTTPStatus int    `json:"clusterChatHttpStatus,omitempty"`
}

type openClawGatewayHealthSnapshot struct {
	LastCheckAt time.Time
	Items       []OpenClawGatewayHealthItem
	BellUnread  bool
}

var (
	openClawHealthMu       sync.Mutex
	openClawHealthSnap     openClawGatewayHealthSnapshot
	openClawLastAllHealthy bool = true
)

// 默认 600s（10m）：降低对上游（如 MiniMax）的调用频率；可用 KUBEBT_OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC 覆盖，最小 60。
func openClawGatewayHealthInterval() time.Duration {
	sec := 600
	if s := strings.TrimSpace(os.Getenv("KUBEBT_OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 60 {
			sec = n
		}
	}
	return time.Duration(sec) * time.Second
}

func openClawGatewayHealthDisabled() bool {
	v := strings.TrimSpace(os.Getenv("KUBEBT_OPENCLAW_GATEWAY_HEALTH_DISABLED"))
	return v == "1" || strings.EqualFold(v, "true")
}

func runOpenClawGatewayHealthCheckOnce(app *ServerApp) {
	if openClawGatewayHealthDisabled() || app == nil || app.PlatformKV() == nil {
		return
	}
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		return
	}
	k8s := app.K8s()
	key, keyErr := opsEncryptionKey(app.Cfg())
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	items := make([]OpenClawGatewayHealthItem, 0, len(list))
	for _, inst := range list {
		it := OpenClawGatewayHealthItem{
			ID:             inst.ID,
			DisplayName:    inst.DisplayName,
			Namespace:      inst.Namespace,
			DeploymentName: inst.DeploymentName,
		}
		var k8sMsg string
		if k8s != nil {
			stCtx, stCancel := context.WithTimeout(ctx, 8*time.Second)
			st := openClawK8sStatus(stCtx, k8s, inst.Namespace, inst.DeploymentName, inst.Image)
			stCancel()
			if ph, ok := st["phase"].(string); ok {
				it.K8sPhase = ph
			}
			if m, ok := st["message"].(string); ok {
				k8sMsg = strings.TrimSpace(m)
			}
		}
		bearer := ""
		if keyErr == nil && key != nil && strings.TrimSpace(inst.GatewayTokenEnc) != "" {
			if tok, derr := decryptSecret(key, inst.GatewayTokenEnc); derr == nil {
				bearer = strings.TrimSpace(tok)
			}
		}
		baseCluster := strings.TrimSpace(inst.ClusterV1BaseURL)
		if baseCluster == "" || bearer == "" {
			it.Skipped = true
			if baseCluster == "" {
				it.SkipReason = "未配置集群内 Base URL"
			} else {
				it.SkipReason = "无法解密网关 Token"
			}
			items = append(items, it)
			continue
		}
		// Pod/Deployment 不在运行态时不做服务级探活，避免已删 Pod 仍沿用上一轮 chat 502/503 等文案
		if k8s != nil {
			ph := strings.TrimSpace(it.K8sPhase)
			if ph != "" && ph != "ready" {
				it.Skipped = true
				if k8sMsg != "" {
					it.SkipReason = "工作负载未就绪，跳过服务级探活（" + k8sMsg + "）"
				} else {
					it.SkipReason = "工作负载未就绪，跳过服务级探活"
				}
				items = append(items, it)
				continue
			}
		}
		hp := openClawGatewayProbe(ctx, &inst, bearer)
		if ok, _ := hp["ok"].(bool); ok {
			it.HTTPProbeOk = true
		}
		if m, _ := hp["message"].(string); m != "" {
			it.HTTPProbeMessage = m
		}
		if u, _ := hp["urlTried"].(string); u != "" {
			it.HTTPProbeURL = u
		}
		model := MapOpenClawInstanceGatewayModelRef(&inst)
		chatCtx, chatCancel := context.WithTimeout(ctx, openClawGatewayHealthChatTimeoutDuration()+5*time.Second)
		st, ok, msg := openClawGatewayHealthChatPing(chatCtx, baseCluster, bearer, model)
		chatCancel()
		it.ClusterChatHTTPStatus = st
		it.ClusterChatOk = ok
		it.ClusterChatMessage = msg
		// 网关全模型 5xx 时追加「直连 Secret 上游」结论，区分密钥/出站问题与纯网关路由问题
		if !ok && st >= http.StatusInternalServerError && st < 600 && k8s != nil {
			diagCtx, diagCancel := context.WithTimeout(ctx, 55*time.Second)
			uOK, uSum, _ := openClawProbeUpstreamAfterGatewayChat5xx(diagCtx, k8s, &inst)
			diagCancel()
			if uOK {
				it.ClusterChatMessage += " · 【直连诊断】" + uSum + "。结论：Secret 指向的上游可通，网关仍失败多为 openclaw 内模型路由/回退（如 anthropic/ 前缀、MiniMax 误走 Anthropic）或未配某厂商 Key；请 kubectl logs deploy/" + strings.TrimSpace(inst.DeploymentName) + "。"
			} else if strings.TrimSpace(uSum) != "" {
				it.ClusterChatMessage += " · 【直连诊断】" + uSum + "。结论：直连 Secret 上游也不通，请先修复 OPENAI_API_KEY、OPENAI_BASE_URL、模型 ID 与网关 Pod 出站。"
			}
		}
		items = append(items, it)
	}

	allProbedHealthy := true
	for i := range items {
		if items[i].Skipped {
			continue
		}
		if !items[i].ClusterChatOk {
			allProbedHealthy = false
			break
		}
	}
	if len(items) == 0 {
		allProbedHealthy = true
	}

	openClawHealthMu.Lock()
	if !allProbedHealthy && openClawLastAllHealthy {
		openClawHealthSnap.BellUnread = true
		var failLabels []string
		for _, it := range items {
			if it.Skipped || it.ClusterChatOk {
				continue
			}
			title := strings.TrimSpace(it.DisplayName)
			if title == "" {
				title = strings.TrimSpace(it.DeploymentName)
			}
			if title == "" {
				title = it.ID
			}
			ns := strings.TrimSpace(it.Namespace)
			dep := strings.TrimSpace(it.DeploymentName)
			var k8s string
			switch {
			case ns != "" && dep != "":
				k8s = ns + "/" + dep
			case ns != "":
				k8s = ns
			case dep != "":
				k8s = dep
			default:
				k8s = "—"
			}
			failLabels = append(failLabels, fmt.Sprintf("%q (%s id=%s)", title, k8s, it.ID))
		}
		if len(failLabels) > 0 {
			log.Printf("openclaw gateway health: 集群内 chat 探活由正常转为异常（已标记通知铃铛）— %s", strings.Join(failLabels, " · "))
		} else {
			log.Printf("openclaw gateway health: 集群内 chat 探活由正常转为异常（已标记通知铃铛）")
		}
	}
	if allProbedHealthy {
		openClawHealthSnap.BellUnread = false
		if !openClawLastAllHealthy {
			log.Printf("openclaw gateway health: 集群内 chat 探活已恢复正常（通知铃铛已自动清除）")
		}
	}
	openClawLastAllHealthy = allProbedHealthy
	openClawHealthSnap.LastCheckAt = time.Now().UTC()
	openClawHealthSnap.Items = items
	openClawHealthMu.Unlock()
}

// openClawGatewayHealthEvictInstance 在平台删除登记后立即从巡检快照中移除该实例，避免列表仍显示已删实例的探活异常。
func openClawGatewayHealthEvictInstance(removedID string) {
	removedID = strings.TrimSpace(removedID)
	if removedID == "" {
		return
	}
	openClawHealthMu.Lock()
	defer openClawHealthMu.Unlock()
	filtered := make([]OpenClawGatewayHealthItem, 0, len(openClawHealthSnap.Items))
	for _, it := range openClawHealthSnap.Items {
		if it.ID == removedID {
			continue
		}
		filtered = append(filtered, it)
	}
	openClawHealthSnap.Items = filtered
	hasBad := false
	for _, it := range filtered {
		if it.Skipped {
			continue
		}
		if !it.ClusterChatOk {
			hasBad = true
			break
		}
	}
	if len(filtered) == 0 {
		openClawLastAllHealthy = true
		openClawHealthSnap.BellUnread = false
		return
	}
	openClawLastAllHealthy = !hasBad
	if !hasBad {
		openClawHealthSnap.BellUnread = false
	}
}

// StartOpenClawGatewayHealthWatcher 定时对 OpenClaw 做集群内 chat/completions 级探活（与仅 GET 不同）。
func StartOpenClawGatewayHealthWatcher(app *ServerApp) {
	if openClawGatewayHealthDisabled() || app == nil {
		return
	}
	iv := openClawGatewayHealthInterval()
	log.Printf("openclaw gateway health: 已启动集群内 chat 探活，间隔 %v（KUBEBT_OPENCLAW_GATEWAY_HEALTH_INTERVAL_SEC 可覆盖，最小 60s）", iv)
	go func() {
		time.Sleep(20 * time.Second)
		runOpenClawGatewayHealthCheckOnce(app)
		t := time.NewTicker(iv)
		defer t.Stop()
		for range t.C {
			runOpenClawGatewayHealthCheckOnce(app)
		}
	}()
}

func handleOpenClawGatewayServiceHealthGet(c *gin.Context, app *ServerApp) {
	disabled := openClawGatewayHealthDisabled()
	if app.PlatformKV() == nil {
		c.JSON(http.StatusOK, gin.H{
			"enabled":         false,
			"workerDisabled":    disabled,
			"lastCheckAt":       "",
			"bellUnread":        false,
			"items":             []OpenClawGatewayHealthItem{},
			"hint":              "platform_kv 不可用",
			"intervalSec":          int(openClawGatewayHealthInterval() / time.Second),
			"healthChatTimeoutSec": int(openClawGatewayHealthChatTimeoutDuration() / time.Second),
		})
		return
	}
	openClawHealthMu.Lock()
	snap := openClawGatewayHealthSnapshot{
		LastCheckAt: openClawHealthSnap.LastCheckAt,
		Items:       append([]OpenClawGatewayHealthItem(nil), openClawHealthSnap.Items...),
		BellUnread:  openClawHealthSnap.BellUnread,
	}
	openClawHealthMu.Unlock()
	last := ""
	if !snap.LastCheckAt.IsZero() {
		last = snap.LastCheckAt.Format(time.RFC3339)
	}
	c.JSON(http.StatusOK, gin.H{
		"enabled":        true,
		"workerDisabled": disabled,
		"lastCheckAt":    last,
		"bellUnread":     snap.BellUnread,
		"items":          snap.Items,
		"intervalSec":          int(openClawGatewayHealthInterval() / time.Second),
		"healthChatTimeoutSec": int(openClawGatewayHealthChatTimeoutDuration() / time.Second),
	})
}

func handleOpenClawGatewayServiceHealthRead(c *gin.Context, app *ServerApp) {
	_ = app
	openClawHealthMu.Lock()
	openClawHealthSnap.BellUnread = false
	openClawHealthMu.Unlock()
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

package internal

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const kvKeyOpenClawBootstrap = "appcenter_openclaw_bootstrap_v1"

// OpenClawModePreset 部署模式一条（与云主机 bootstrap 镜像行类似）：用户只选模式，镜像由模板定。
type OpenClawModePreset struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Image       string `json:"image"`
	// InitContainerImage 可选；空则创建向导/详情仍用页面默认 busybox
	InitContainerImage string `json:"initContainerImage,omitempty"`
}

// OpenClawBootstrap 应用中心 OpenClaw 全局预设（platform_kv）。
type OpenClawBootstrap struct {
	BootstrapComplete bool                 `json:"bootstrapComplete"`
	Modes             []OpenClawModePreset `json:"modes"`
	DefaultNamespace  string               `json:"defaultNamespace,omitempty"`
	// DefaultRBACPreset 新建实例默认集群权限：readonly | edit | admin
	DefaultRBACPreset string `json:"defaultRbacPreset,omitempty"`
}

func defaultOpenClawBootstrap() *OpenClawBootstrap {
	return &OpenClawBootstrap{
		BootstrapComplete: false,
		DefaultNamespace:  "",
		DefaultRBACPreset: "readonly",
		Modes: []OpenClawModePreset{
			{
				ID:                 "full",
				Label:              "Full（完整能力）",
				Description:        "官方完整镜像（如 :main），工具链与能力最全",
				Image:              openClawDefaultImage,
				InitContainerImage: "busybox:1.36",
			},
			{
				ID:                 "slim",
				Label:              "Slim（轻量）",
				Description:        "精简镜像，更偏轻量对话",
				Image:              "ghcr.io/openclaw/openclaw:slim",
				InitContainerImage: "busybox:1.36",
			},
			{
				ID:                 "corp",
				Label:              "企业 / 自定义 Harbor",
				Description:        "在模板中改为内网 Harbor 地址与 tag（如 prod、latest）",
				Image:              "harbor.example.com/library/openclaw:main",
				InitContainerImage: "harbor.example.com/library/busybox:1.36",
			},
		},
	}
}

func loadOpenClawBootstrap(kv PlatformKV) *OpenClawBootstrap {
	def := defaultOpenClawBootstrap()
	if kv == nil {
		return def
	}
	raw, ok := kv.Get(kvKeyOpenClawBootstrap)
	if !ok || strings.TrimSpace(raw) == "" {
		return def
	}
	var b OpenClawBootstrap
	if err := json.Unmarshal([]byte(raw), &b); err != nil {
		return def
	}
	if len(b.Modes) == 0 {
		b.Modes = append([]OpenClawModePreset(nil), def.Modes...)
	}
	if strings.TrimSpace(b.DefaultRBACPreset) == "" {
		b.DefaultRBACPreset = "readonly"
	} else {
		b.DefaultRBACPreset = NormalizeOpenClawRBACPreset(b.DefaultRBACPreset)
	}
	return &b
}

func saveOpenClawBootstrap(kv PlatformKV, b *OpenClawBootstrap) error {
	if kv == nil || b == nil {
		return errors.New("platform_kv 不可用")
	}
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpenClawBootstrap, string(raw))
}

func handleAppOpenClawBootstrapGet(c *gin.Context, app *ServerApp) {
	b := loadOpenClawBootstrap(app.PlatformKV())
	c.JSON(http.StatusOK, gin.H{
		"bootstrapComplete": b.BootstrapComplete,
		"modes":             b.Modes,
		"defaultNamespace":  b.DefaultNamespace,
		"defaultRbacPreset": b.DefaultRBACPreset,
	})
}

func handleAppOpenClawBootstrapPut(c *gin.Context, app *ServerApp) {
	if getDashboardRoleFromGin(c) != DashboardRoleAdmin {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	var body OpenClawBootstrap
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(body.Modes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "至少配置一种部署模式"})
		return
	}
	if len(body.Modes) > 12 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模式数量过多（最多 12 条）"})
		return
	}
	for i := range body.Modes {
		body.Modes[i].ID = strings.TrimSpace(body.Modes[i].ID)
		body.Modes[i].Label = strings.TrimSpace(body.Modes[i].Label)
		body.Modes[i].Image = strings.TrimSpace(body.Modes[i].Image)
		body.Modes[i].InitContainerImage = strings.TrimSpace(body.Modes[i].InitContainerImage)
		body.Modes[i].Description = strings.TrimSpace(body.Modes[i].Description)
		if body.Modes[i].ID == "" || body.Modes[i].Image == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "每条模式须填写 id 与 image"})
			return
		}
		if body.Modes[i].Label == "" {
			body.Modes[i].Label = body.Modes[i].ID
		}
	}
	if dr := strings.TrimSpace(body.DefaultRBACPreset); dr != "" {
		if _, ok := strictOpenClawRBACPreset(dr); !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "defaultRbacPreset 须为 readonly、edit 或 admin"})
			return
		}
		body.DefaultRBACPreset = strings.ToLower(dr)
	} else {
		body.DefaultRBACPreset = "readonly"
	}
	body.BootstrapComplete = true
	if err := saveOpenClawBootstrap(app.PlatformKV(), &body); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

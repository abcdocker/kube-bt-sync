package internal

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func maskSecret(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return "***"
}

func handleGetRuntimeSettings(app *ServerApp) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !app.Initialized() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "尚未完成初始化"})
			return
		}
		rs := app.Runtime()
		if rs == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "未找到配置"})
			return
		}
		out := *rs
		out.DashboardPassword = maskSecret(out.DashboardPassword)
		out.VCenterPassword = maskSecret(out.VCenterPassword)
		out.BaotaAPIKey = maskSecret(out.BaotaAPIKey)
		out.RedisPassword = maskSecret(out.RedisPassword)
		out.MySQLPassword = maskSecret(out.MySQLPassword)
		out.EncryptionKey = maskSecret(out.EncryptionKey)
		out.VCenterVMSshPassword = maskSecret(out.VCenterVMSshPassword)
		out.VCenterVMSshKeyPassphrase = maskSecret(out.VCenterVMSshKeyPassphrase)
		out.OIDCClientSecret = maskSecret(out.OIDCClientSecret)
		if out.K8s != nil && strings.TrimSpace(out.K8s.KubeconfigYAML) != "" {
			out.K8s = &RuntimeK8s{Mode: out.K8s.Mode, KubeconfigYAML: "***"}
		}
		c.JSON(http.StatusOK, out)
	}
}

func handlePutRuntimeSettings(app *ServerApp) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body RuntimeSettings
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "JSON 无效: " + err.Error()})
			return
		}
		path := filepath.Join(app.DataDir(), runtimeConfigFileName)
		cur, err := LoadRuntimeSettings(path)
		if err != nil || cur == nil || !cur.Initialized {
			c.JSON(http.StatusBadRequest, gin.H{"error": "尚未完成初始化"})
			return
		}
		if body.K8s == nil && cur.K8s != nil {
			body.K8s = cur.K8s
		}
		body.Version = cur.Version
		body.Initialized = true
		// 与 GET 掩码一致：未改动时前端仍传 "***"，须恢复为磁盘上的真实值
		if strings.TrimSpace(body.DashboardPassword) == "" || body.DashboardPassword == "***" {
			body.DashboardPassword = cur.DashboardPassword
		}
		if strings.TrimSpace(body.VCenterPassword) == "" || body.VCenterPassword == "***" {
			body.VCenterPassword = cur.VCenterPassword
		}
		if strings.TrimSpace(body.BaotaAPIKey) == "" || body.BaotaAPIKey == "***" {
			body.BaotaAPIKey = cur.BaotaAPIKey
		}
		if strings.TrimSpace(body.RedisPassword) == "" || body.RedisPassword == "***" {
			body.RedisPassword = cur.RedisPassword
		}
		if strings.TrimSpace(body.MySQLPassword) == "" || body.MySQLPassword == "***" {
			body.MySQLPassword = cur.MySQLPassword
		}
		if strings.TrimSpace(body.EncryptionKey) == "" || body.EncryptionKey == "***" {
			body.EncryptionKey = cur.EncryptionKey
		}
		if strings.TrimSpace(body.VCenterVMSshPassword) == "" || body.VCenterVMSshPassword == "***" {
			body.VCenterVMSshPassword = cur.VCenterVMSshPassword
		}
		if strings.TrimSpace(body.VCenterVMSshKeyPassphrase) == "" || body.VCenterVMSshKeyPassphrase == "***" {
			body.VCenterVMSshKeyPassphrase = cur.VCenterVMSshKeyPassphrase
		}
		if strings.TrimSpace(body.OIDCClientSecret) == "" || body.OIDCClientSecret == "***" {
			body.OIDCClientSecret = cur.OIDCClientSecret
		}
		// 未使用私钥路径时不再保留历史口令（密码登录简化配置）
		if strings.TrimSpace(body.VCenterVMSshPrivateKeyPath) == "" {
			body.VCenterVMSshKeyPassphrase = ""
		}
		if body.K8s != nil {
			if strings.TrimSpace(body.K8s.KubeconfigYAML) == "" || body.K8s.KubeconfigYAML == "***" {
				if cur.K8s != nil {
					body.K8s.KubeconfigYAML = cur.K8s.KubeconfigYAML
				}
			}
		}
		env := LoadConfig()
		tmp := MergeRuntimeConfig(env, &body, app.DataDir())
		tmp = PrepareDashboardAuth(tmp)
		if err := tmp.Validate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := SaveRuntimeSettings(path, &body); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := app.Reload(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "message": "已保存并重载"})
	}
}

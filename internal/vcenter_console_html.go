package internal

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/vmware/govmomi"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/session"
	"github.com/vmware/govmomi/vim25/mo"
	"github.com/vmware/govmomi/vim25/types"
)

// EffectiveVCenterUIBaseURL 浏览器访问 vSphere UI 的根（Nginx 对外地址）；未设 VCENTER_UI_BASE_URL 时由 VCENTER_URL 推导。
func EffectiveVCenterUIBaseURL(c Config) string {
	if s := strings.TrimSpace(c.VCenterUIBaseURL); s != "" {
		return strings.TrimRight(s, "/")
	}
	return vcenterUIOriginFromURL(c.VCenterURL)
}

// vcenterUiLoginURL 典型 vSphere Client 入口（先登录 SSO 再开控制台，用于另开标签）。
func vcenterUiLoginURL(c Config) string {
	b := EffectiveVCenterUIBaseURL(c)
	if b == "" {
		return ""
	}
	return strings.TrimRight(b, "/") + "/ui"
}

// vmMoURN 与 vSphere Client 地址栏一致：urn:vmomi:VirtualMachine:vm-xxx:<instanceUuid>
func vmMoURN(morefValue, instanceUUID string) string {
	if instanceUUID == "" {
		return morefValue
	}
	return fmt.Sprintf("urn:vmomi:VirtualMachine:%s:%s", morefValue, instanceUUID)
}

// buildVCenterWebConsoleURL 生成 webconsole.html 链接；新版 UI 要求 vmId 为完整 MoURN，仅 vm-2041 会报「Input is required」。
// 同时返回与已登录 Client 一致的 /ui/app/vm;nav=.../summary 深链（依赖浏览器 SSO 会话，不依赖 CloneTicket）。
func buildVCenterWebConsoleURL(ctx context.Context, client *govmomi.Client, vm *object.VirtualMachine, cfg Config) (webConsoleURL string, vsphereClientURL string, err error) {
	base := EffectiveVCenterUIBaseURL(cfg)
	if base == "" {
		return "", "", fmt.Errorf("请配置 VCENTER_URL 或 VCENTER_UI_BASE_URL（Nginx 对外的 vSphere UI HTTPS 根地址）")
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", "", err
	}
	if u.Scheme == "" {
		u.Scheme = "https"
	}
	u.Path, u.RawQuery, u.Fragment = "", "", ""

	var moVM mo.VirtualMachine
	if err := vm.Properties(ctx, vm.Reference(), []string{"name", "summary.config"}, &moVM); err != nil {
		return "", "", fmt.Errorf("读取虚拟机属性: %w", err)
	}
	name := moVM.Name
	if name == "" {
		return "", "", fmt.Errorf("无法解析虚拟机名称")
	}
	instanceUUID := moVM.Summary.Config.InstanceUuid
	vmIDParam := vmMoURN(vm.Reference().Value, instanceUUID)

	// 已登录 vSphere Client 时的摘要页（与浏览器里复制的链接一致）
	if instanceUUID != "" {
		urn := vmMoURN(vm.Reference().Value, instanceUUID)
		vsphereClientURL = strings.TrimRight(base, "/") + "/ui/app/vm;nav=h/" + urn + "/summary"
	}

	sm := session.NewManager(client.Client)
	ticket, err := sm.AcquireCloneTicket(ctx)
	if err != nil {
		return "", vsphereClientURL, fmt.Errorf("AcquireCloneTicket: %w", err)
	}

	hostParam := strings.TrimSpace(cfg.VCenterConsoleHost)
	if hostParam == "" {
		hostParam = u.Hostname()
	}

	thumbprint := strings.TrimSpace(cfg.VCenterUIThumbprint)
	if thumbprint == "" {
		var info object.HostCertificateInfo
		tlsCfg := &tls.Config{
			InsecureSkipVerify: cfg.VCenterInsecure,
			ServerName:         u.Hostname(),
		}
		if err := info.FromURL(u, tlsCfg); err != nil {
			return "", vsphereClientURL, fmt.Errorf("探测 UI 证书指纹失败: %w（可设置 VCENTER_UI_THUMBPRINT）", err)
		}
		thumbprint = info.ThumbprintSHA1
	}

	out := *u
	out.Path = "/ui/webconsole.html"
	out.RawQuery = url.Values{
		"vmId":          []string{vmIDParam},
		"vmName":        []string{name},
		"serverGuid":    []string{client.ServiceContent.About.InstanceUuid},
		"host":          []string{hostParam},
		"sessionTicket": []string{ticket},
		"thumbprint":    []string{thumbprint},
	}.Encode()

	return out.String(), vsphereClientURL, nil
}

func handleVCenterVMConsoleHTMLURL(c *gin.Context, vc *vCenterClient, cfg Config, app *ServerApp) {
	if !vc.cfg.vCenterConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "vCenter 未配置"})
		return
	}
	moref := strings.TrimSpace(c.Param("moref"))
	if vcenterBastionAbortIfForbidden(c, app, moref) {
		return
	}
	ctx := c.Request.Context()
	var urlStr, clientURL string
	err := vc.WithClientRetry(ctx, func(client *govmomi.Client) error {
		vm := object.NewVirtualMachine(client.Client, types.ManagedObjectReference{Type: "VirtualMachine", Value: moref})
		var e error
		urlStr, clientURL, e = buildVCenterWebConsoleURL(ctx, client, vm, cfg)
		return e
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	hint := "webconsole：vmId 已使用 urn:vmomi:VirtualMachine:… 完整 URN（避免 Input is required）。CloneTicket 与 SSO 无关。"
	if clientURL != "" {
		hint += " vsphereClientUrl：需本机已登录同一 vCenter（SSO Cookie）；用于打开摘要页，再从 UI 打开控制台。"
	}
	c.JSON(http.StatusOK, gin.H{
		"url":              urlStr,
		"vsphereClientUrl": clientURL,
		"hint":             hint,
	})
}

package internal

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/vmware/govmomi"
)

// vCenter SOAP 客户端（进程内单例缓存；会话失效时 Reset 后重试）
type vCenterClient struct {
	mu     sync.Mutex
	cfg    Config
	client *govmomi.Client
}

func newVCenterClient(cfg Config) *vCenterClient {
	return &vCenterClient{cfg: cfg}
}

func (c Config) vCenterConfigured() bool {
	return strings.TrimSpace(c.VCenterURL) != "" &&
		strings.TrimSpace(c.VCenterUser) != "" &&
		c.VCenterPassword != ""
}

// vCenterVMSshConfigured 是否已配置页面 SSH 终端（用户 + 私钥或密码）。
func (c Config) vCenterVMSshConfigured() bool {
	if strings.TrimSpace(c.VCenterVMSshUser) == "" {
		return false
	}
	return strings.TrimSpace(c.VCenterVMSshPrivateKeyPath) != "" || c.VCenterVMSshPassword != ""
}

func (v *vCenterClient) Reset() {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.client == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	_ = v.client.Logout(ctx)
	cancel()
	v.client = nil
}

func (v *vCenterClient) getClient(ctx context.Context) (*govmomi.Client, error) {
	if !v.cfg.vCenterConfigured() {
		return nil, fmt.Errorf("未配置 vCenter（需 VCENTER_URL / VCENTER_USER / VCENTER_PASSWORD）")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.client != nil {
		return v.client, nil
	}
	u, err := vcenterSDKURL(v.cfg)
	if err != nil {
		return nil, err
	}
	c, err := govmomi.NewClient(ctx, u, v.cfg.VCenterInsecure)
	if err != nil {
		return nil, err
	}
	v.client = c
	return v.client, nil
}

func vcenterSDKURL(cfg Config) (*url.URL, error) {
	raw := strings.TrimSpace(cfg.VCenterURL)
	if raw == "" {
		return nil, fmt.Errorf("VCENTER_URL 为空")
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = "/sdk"
	}
	u.User = url.UserPassword(strings.TrimSpace(cfg.VCenterUser), cfg.VCenterPassword)
	return u, nil
}

package internal

import (
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// trustedNetsCache 与 Gin SetTrustedProxies 使用同一套 CIDR 字符串，供审计时判断「是否来自可信代理」。
type trustedNetsCache struct {
	mu   sync.Mutex
	raw  string
	nets []*net.IPNet
}

var auditTrustedNets trustedNetsCache

func parseTrustedProxyStrings(s string) ([]string, []*net.IPNet) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	parts := strings.Split(s, ",")
	outStr := make([]string, 0, len(parts))
	nets := make([]*net.IPNet, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		cidr := p
		if !strings.Contains(cidr, "/") {
			ip := net.ParseIP(cidr)
			if ip == nil {
				continue
			}
			if ip.To4() != nil {
				cidr += "/32"
			} else {
				cidr += "/128"
			}
		}
		_, n, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		outStr = append(outStr, cidr)
		nets = append(nets, n)
	}
	return outStr, nets
}

func trustedNetsForConfig(cfg Config) []*net.IPNet {
	s := strings.TrimSpace(cfg.DashboardTrustedProxies)
	auditTrustedNets.mu.Lock()
	defer auditTrustedNets.mu.Unlock()
	if s == auditTrustedNets.raw {
		return auditTrustedNets.nets
	}
	_, nets := parseTrustedProxyStrings(s)
	auditTrustedNets.raw = s
	auditTrustedNets.nets = nets
	return nets
}

func remoteTCPAddrIP(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		host = r.RemoteAddr
	}
	return net.ParseIP(host)
}

func ipInNets(ip net.IP, nets []*net.IPNet) bool {
	if ip == nil || len(nets) == 0 {
		return false
	}
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// parseSingleIPHeader 返回首个合法单 IP（CDN / 反代常用，不含逗号链）。
func parseSingleIPHeader(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	// 部分实现会写 "client, proxy"
	if i := strings.IndexByte(v, ','); i >= 0 {
		v = strings.TrimSpace(v[:i])
	}
	ip := net.ParseIP(v)
	if ip == nil {
		return ""
	}
	return ip.String()
}

// AuditClientIP 用于审计：在配置 DASHBOARD_TRUSTED_PROXIES 时信任 X-Forwarded-For（由 Gin 解析）；
// 当直连来源属于可信网段时，优先采用 CDN / 反代注入的头（避免仅依赖 XFF 链）。
func AuditClientIP(c *gin.Context, cfg Config) string {
	nets := trustedNetsForConfig(cfg)
	remote := remoteTCPAddrIP(c.Request)
	trusted := ipInNets(remote, nets)

	if trusted {
		// Cloudflare → 源站；仅在来自 CF 等可信跳时采用（需把对应出口网段写入 DASHBOARD_TRUSTED_PROXIES）
		if s := parseSingleIPHeader(c.GetHeader("CF-Connecting-IP")); s != "" {
			return s
		}
		// Akamai / Azure CDN 等
		if s := parseSingleIPHeader(c.GetHeader("True-Client-IP")); s != "" {
			return s
		}
	}
	// Gin 在 SetTrustedProxies 与 ForwardedByClientIP 下解析 X-Forwarded-For、X-Real-IP
	return c.ClientIP()
}

// configureGinTrustedProxies：gin.Default() 默认信任 0.0.0.0/0，易被伪造 XFF；此处默认改为不信任，仅当配置 env 后启用。
func configureGinTrustedProxies(r *gin.Engine, cfg Config) {
	list, _ := parseTrustedProxyStrings(cfg.DashboardTrustedProxies)
	if len(list) == 0 {
		if err := r.SetTrustedProxies(nil); err != nil {
			log.Printf("audit: SetTrustedProxies(nil): %v", err)
		}
		return
	}
	if err := r.SetTrustedProxies(list); err != nil {
		log.Printf("audit: DASHBOARD_TRUSTED_PROXIES 无效，将不信任代理: %v", err)
		_ = r.SetTrustedProxies(nil)
	}
}

func shouldPersistAuditPath(path string) bool {
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	switch path {
	case "/api/health", "/api/setup/status", "/api/auth/status",
		"/api/auth/login", "/api/auth/logout":
		return false
	default:
		return true
	}
}

func auditAccessLogMiddleware(app *ServerApp) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := app.Cfg()
		start := time.Now()
		c.Next()
		path := c.Request.URL.Path
		ip := AuditClientIP(c, cfg)
		ms := time.Since(start).Milliseconds()
		user := "-"
		if cfg.DashboardAuthEnabled() {
			if u, ok := sessionUserFromCookie(c, cfg); ok && strings.TrimSpace(u) != "" {
				user = u
			}
		}
		route := c.FullPath()
		if route == "" {
			route = path
		}
		if cfg.DashboardAccessLog {
			log.Printf("access ip=%s user=%s %s %s => %d %dms",
				ip, user, c.Request.Method, route, c.Writer.Status(), ms)
		}
		if shouldPersistAuditPath(path) {
			AppendAuditRecord(app.DataDir(), AuditRecord{
				Action:     "api",
				IP:         ip,
				User:       user,
				Method:     c.Request.Method,
				Path:       route,
				Status:     c.Writer.Status(),
				DurationMs: ms,
			})
		}
	}
}

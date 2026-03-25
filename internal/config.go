package internal

import (
<<<<<<< HEAD
	"errors"
	"os"
	"strconv"
	"strings"
=======
	"fmt"
	"os"
>>>>>>> d16bf5922f8c5e8a4fe187f8af50fc5f2eaa7661
	"time"
)

type Config struct {
<<<<<<< HEAD
	BaotaURL           string
	BaotaAPIKey        string
	BaotaSkipTLSVerify bool
	// 默认 true：公网面板下复用连接易陈旧，易导致「awaiting headers」挂满直至 Client.Timeout；设为 false 可省握手。
	BaotaDisableHTTPKeepAlive bool
	BaotaHTTPTimeout          time.Duration
	BaotaTCPProbeTimeout      time.Duration // /api/system/check 等对 BAOTA_URL 仅做 TCP 探活，不调用 HTTP API
	BaotaCheckMinInterval     time.Duration // 对宝塔 TCP 探活结果的最小缓存间隔；0 表示每次请求都拨号
	DDNSHost                  string
	DefaultPort               string
	BaotaSSLCertName          string // 证书夹中证书标识（目录名），用于 SetCertToSite；可被 Ingress 注解覆盖
	SyncInterval              time.Duration
	// Dashboard 登录（设置 DASHBOARD_PASSWORD 后启用；空密码表示不启用）
	DashboardUser          string
	DashboardPassword      string
	DashboardSessionSecret string
	DashboardSessionDays   int
	DashboardCookieSecure  bool // HTTPS 部署时建议 true
	// DashboardListenAddr 监听地址，如 :8080、:18080；默认 :8080。环境变量 DASHBOARD_HTTP_ADDR。
	DashboardListenAddr string
	// DASHBOARD_TRUSTED_PROXIES：逗号分隔的 CIDR 或单 IP（Ingress/CDN/反代出口网段），与 Gin 一致；仅当直连来源属于这些网段时才信任 X-Forwarded-For / X-Real-IP。空表示不信任任何代理（仅 RemoteAddr），避免公网直连时伪造 XFF。
	DashboardTrustedProxies string
	// DASHBOARD_ACCESS_LOG：是否记录访问日志（含解析后的客户端 IP，供审计）；默认 true。
	DashboardAccessLog          bool
	resolvedDashboardSessionKey []byte
	// Prometheus 可选：监控页代理查询（kube-prometheus 等）
	PrometheusURL         string
	PrometheusTimeout     time.Duration
	PrometheusSkipTLS     bool
	PrometheusBearerToken string
	// vCenter / vSphere（可选）：虚拟机与 WebMKS 控制台
	VCenterURL      string // 如 https://vcenter.example.com 或 https://vcenter/sdk
	VCenterUser     string
	VCenterPassword string
	VCenterInsecure bool // 跳过 TLS 校验（自签证书）
	// 可选：浏览器内嵌 WebMKS 时加载 VMware HTML Console SDK（需可访问的 URL）
	VCenterWmksScriptURL string
	VCenterWmksCssURL    string
	// 浏览器访问 vSphere UI 的对外根地址（Nginx 反代 / SSO 时用公网域名，可与 VCENTER_URL 不同）
	VCenterUIBaseURL string
	// webconsole.html 的 host 参数；空则使用 VCenterUIBaseURL 的 Hostname
	VCenterConsoleHost string
	// 可选：覆盖从 VCENTER_UI_BASE_URL 探测到的 SHA1 指纹（Nginx 与 vCenter 证书不一致时）
	VCenterUIThumbprint string
	// 虚拟机内 SSH（页面内终端）：凭据在服务端，连接 Guest IP；运行本进程的主机须能访问该 IP:端口
	VCenterVMSshUser            string
	VCenterVMSshPrivateKeyPath  string
	VCenterVMSshPassword        string
	VCenterVMSshKeyPassphrase   string // 加密私钥口令
	VCenterVMSshPort            int
	VCenterVMSshInsecureHostKey bool // true 时跳过 known_hosts 校验（内网常用）
	// SSH 凭据持久化（可选）：redis / mysql；与 KUBEBT_ENCRYPTION_KEY 配合加密密码与私钥
	SSHSettingsBackend SSHSettingsBackend
	EncryptionKey      string // KUBEBT_ENCRYPTION_KEY
	RedisAddr          string
	RedisPassword      string
	RedisDB            int
	RedisKeyPrefix     string
	// RedisMode：standalone（单机）| sentinel（哨兵）| cluster（集群）；轻量客户端仅连 redisHost:redisPort
	RedisMode           string
	RedisHost           string
	RedisPort           int
	RedisSentinelMaster string
	MySQLDSN            string
	MySQLHost           string
	MySQLPort           int
	MySQLDatabase       string
	MySQLUser           string
	MySQLPassword       string
	// SSH_SETTINGS_BACKEND=file 时存放每虚拟机 JSON 的目录（建议 0700）
	SSHSettingsDir string
	// 平台对外访问根 URL（如 https://sync.example.com），用于回调与展示
	PlatformPublicURL string
	// Ingress→宝塔同步：在后台开启后才轮询同步；未开启时不访问 K8s Ingress / 宝塔 API
	IngressBaotaSyncEnabled bool
	// vCenter 虚拟机列表在 Redis 中的缓存 TTL（秒）；0 表示默认 120
	VCenterCacheTTLSec int
	// KUBEBT_RUNTIME_DUAL_WRITE_REDIS：为 true 且能连接 Redis 时，将 runtime-config 与 platform_kv 全量镜像到 Redis（无过期时间），便于在 Redis/运维侧可见与灾备恢复。
	RuntimeDualWriteRedis bool
	// OIDC（如 Authentik）：与 DASHBOARD_PASSWORD 可并存；四项均配置则启用授权码登录
	OIDCIssuerURL    string
	OIDCClientID     string
	OIDCClientSecret string
	OIDCRedirectURL  string
	OIDCScopes       string // 空格分隔，默认 openid profile email
}

func LoadConfig() Config {
	baotaURL := getEnv("BAOTA_URL", "http://127.0.0.1:8888")
	timeoutSec := getEnvAsInt("BAOTA_HTTP_TIMEOUT_SEC", 45)
	if timeoutSec < 10 {
		timeoutSec = 10
	}
	if timeoutSec > 600 {
		timeoutSec = 600
	}
	checkMinSec := getEnvAsInt("BAOTA_CHECK_MIN_INTERVAL_SEC", 90)
	if checkMinSec < 0 {
		checkMinSec = 0
	}
	if checkMinSec > 3600 {
		checkMinSec = 3600
	}
	tcpProbeSec := getEnvAsInt("BAOTA_TCP_PROBE_TIMEOUT_SEC", 5)
	if tcpProbeSec < 1 {
		tcpProbeSec = 1
	}
	if tcpProbeSec > 120 {
		tcpProbeSec = 120
	}
	dashDays := getEnvAsInt("DASHBOARD_SESSION_DAYS", 7)
	if dashDays < 1 {
		dashDays = 1
	}
	if dashDays > 365 {
		dashDays = 365
	}
	promTimeoutSec := getEnvAsInt("PROMETHEUS_HTTP_TIMEOUT_SEC", 30)
	if promTimeoutSec < 5 {
		promTimeoutSec = 5
	}
	if promTimeoutSec > 300 {
		promTimeoutSec = 300
	}
	sshPort := getEnvAsInt("VCENTER_VM_SSH_PORT", 22)
	if sshPort <= 0 || sshPort > 65535 {
		sshPort = 22
	}
	cfg := Config{
		BaotaURL:                    baotaURL,
		BaotaAPIKey:                 getEnv("BAOTA_API_KEY", ""), // 必须配置
		BaotaSkipTLSVerify:          loadBaotaSkipTLSVerify(baotaURL),
		BaotaDisableHTTPKeepAlive:   loadBaotaDisableHTTPKeepAlive(),
		BaotaHTTPTimeout:            time.Duration(timeoutSec) * time.Second,
		BaotaTCPProbeTimeout:        time.Duration(tcpProbeSec) * time.Second,
		BaotaCheckMinInterval:       time.Duration(checkMinSec) * time.Second,
		DDNSHost:                    getEnv("DDNS_HOST", "home.i4t.com"),
		DefaultPort:                 getEnv("DEFAULT_PORT", "38333"),
		BaotaSSLCertName:            strings.TrimSpace(getEnv("BAOTA_SSL_CERT_NAME", "")),
		SyncInterval:                time.Duration(getEnvAsInt("SYNC_INTERVAL_SEC", 30)) * time.Second,
		DashboardUser:               getEnv("DASHBOARD_USER", "admin"),
		DashboardPassword:           strings.TrimSpace(os.Getenv("DASHBOARD_PASSWORD")),
		DashboardSessionSecret:      strings.TrimSpace(os.Getenv("DASHBOARD_SESSION_SECRET")),
		DashboardSessionDays:        dashDays,
		DashboardCookieSecure:       getEnvBool("DASHBOARD_COOKIE_SECURE", false),
		DashboardListenAddr:         normalizeDashboardListenAddr(getEnv("DASHBOARD_HTTP_ADDR", ":8080")),
		DashboardTrustedProxies:     strings.TrimSpace(getEnv("DASHBOARD_TRUSTED_PROXIES", "")),
		DashboardAccessLog:          getEnvBool("DASHBOARD_ACCESS_LOG", true),
		PrometheusURL:               strings.TrimSpace(getEnv("PROMETHEUS_URL", "")),
		PrometheusTimeout:           time.Duration(promTimeoutSec) * time.Second,
		PrometheusSkipTLS:           getEnvBool("PROMETHEUS_SKIP_TLS_VERIFY", false),
		PrometheusBearerToken:       strings.TrimSpace(os.Getenv("PROMETHEUS_BEARER_TOKEN")),
		VCenterURL:                  strings.TrimSpace(getEnv("VCENTER_URL", "")),
		VCenterUser:                 strings.TrimSpace(getEnv("VCENTER_USER", "")),
		VCenterPassword:             os.Getenv("VCENTER_PASSWORD"),
		VCenterInsecure:             getEnvBool("VCENTER_INSECURE", true),
		VCenterWmksScriptURL:        strings.TrimSpace(getEnv("VCENTER_WMKS_SCRIPT_URL", "")),
		VCenterWmksCssURL:           strings.TrimSpace(getEnv("VCENTER_WMKS_CSS_URL", "")),
		VCenterUIBaseURL:            strings.TrimSpace(getEnv("VCENTER_UI_BASE_URL", "")),
		VCenterConsoleHost:          strings.TrimSpace(getEnv("VCENTER_CONSOLE_HOST", "")),
		VCenterUIThumbprint:         strings.TrimSpace(getEnv("VCENTER_UI_THUMBPRINT", "")),
		VCenterVMSshUser:            strings.TrimSpace(getEnv("VCENTER_VM_SSH_USER", "")),
		VCenterVMSshPrivateKeyPath:  strings.TrimSpace(getEnv("VCENTER_VM_SSH_PRIVATE_KEY_PATH", "")),
		VCenterVMSshPassword:        os.Getenv("VCENTER_VM_SSH_PASSWORD"),
		VCenterVMSshKeyPassphrase:   os.Getenv("VCENTER_VM_SSH_KEY_PASSPHRASE"),
		VCenterVMSshPort:            sshPort,
		VCenterVMSshInsecureHostKey: getEnvBool("VCENTER_VM_SSH_INSECURE_HOST_KEY", true),
		SSHSettingsBackend:          SSHSettingsBackend(strings.ToLower(strings.TrimSpace(getEnv("SSH_SETTINGS_BACKEND", "")))),
		EncryptionKey:               strings.TrimSpace(os.Getenv("KUBEBT_ENCRYPTION_KEY")),
		RedisAddr:                   strings.TrimSpace(getEnv("REDIS_ADDR", "")),
		RedisPassword:               os.Getenv("REDIS_PASSWORD"),
		RedisDB:                     getEnvAsInt("REDIS_DB", 0),
		RedisKeyPrefix:              strings.TrimSpace(getEnv("REDIS_SSH_KEY_PREFIX", "")),
		RedisMode:                   strings.ToLower(strings.TrimSpace(getEnv("REDIS_MODE", "standalone"))),
		RedisHost:                   strings.TrimSpace(getEnv("REDIS_HOST", "")),
		RedisPort:                   getEnvAsInt("REDIS_PORT", 6379),
		RedisSentinelMaster:         strings.TrimSpace(getEnv("REDIS_SENTINEL_MASTER", "")),
		MySQLDSN:                    strings.TrimSpace(getEnv("MYSQL_DSN", "")),
		MySQLHost:                   strings.TrimSpace(getEnv("MYSQL_HOST", "")),
		MySQLPort:                   getEnvAsInt("MYSQL_PORT", 3306),
		MySQLDatabase:               strings.TrimSpace(getEnv("MYSQL_DATABASE", "")),
		MySQLUser:                   strings.TrimSpace(getEnv("MYSQL_USER", "")),
		MySQLPassword:               os.Getenv("MYSQL_PASSWORD"),
		SSHSettingsDir:              strings.TrimSpace(getEnv("SSH_SETTINGS_DIR", "")),
		PlatformPublicURL:           strings.TrimSpace(getEnv("PLATFORM_PUBLIC_URL", "")),
		IngressBaotaSyncEnabled:     getEnvBool("INGRESS_BAOTA_SYNC_ENABLED", false),
		VCenterCacheTTLSec:          getEnvAsInt("VCENTER_CACHE_TTL_SEC", 120),
		RuntimeDualWriteRedis:       getEnvBool("KUBEBT_RUNTIME_DUAL_WRITE_REDIS", true),
		OIDCIssuerURL:               strings.TrimSpace(getEnv("OIDC_ISSUER_URL", "")),
		OIDCClientID:                strings.TrimSpace(getEnv("OIDC_CLIENT_ID", "")),
		OIDCClientSecret:            strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET")),
		OIDCRedirectURL:             strings.TrimSpace(getEnv("OIDC_REDIRECT_URL", "")),
		OIDCScopes:                  strings.TrimSpace(getEnv("OIDC_SCOPES", "openid profile email")),
	}
	if strings.TrimSpace(cfg.RedisHost) != "" && cfg.RedisPort <= 0 {
		cfg.RedisPort = 6379
	}
	if strings.TrimSpace(cfg.MySQLHost) != "" && cfg.MySQLPort <= 0 {
		cfg.MySQLPort = 3306
	}
	FinalizeConnectionStrings(&cfg)
	return cfg
}

func normalizeDashboardListenAddr(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ":8080"
	}
	// 若只写端口如 18080，补全为 :18080
	if strings.HasPrefix(addr, ":") {
		return addr
	}
	if _, err := strconv.Atoi(addr); err == nil {
		return ":" + addr
	}
	return addr
}

// loadBaotaSkipTLSVerify：若显式设置 BAOTA_SKIP_TLS_VERIFY 则按其值；否则对 https:// 宝塔地址默认跳过校验（自签/内网 SAN 常见）。
// 若使用正规证书且需严格校验，请设置 BAOTA_SKIP_TLS_VERIFY=false。
// 未设置环境变量时默认禁用 keep-alive，减轻跨公网面板陈旧连接导致的超时。
func loadBaotaDisableHTTPKeepAlive() bool {
	_, ok := os.LookupEnv("BAOTA_DISABLE_HTTP_KEEPALIVE")
	if !ok {
		return true
	}
	return getEnvBool("BAOTA_DISABLE_HTTP_KEEPALIVE", true)
}

func loadBaotaSkipTLSVerify(baotaURL string) bool {
	raw, ok := os.LookupEnv("BAOTA_SKIP_TLS_VERIFY")
	if ok && strings.TrimSpace(raw) != "" {
		return getEnvBool("BAOTA_SKIP_TLS_VERIFY", false)
	}
	u := strings.TrimSpace(strings.ToLower(baotaURL))
	return strings.HasPrefix(u, "https://")
}

func (c Config) Validate() error {
	tmp := c
	FinalizeConnectionStrings(&tmp)
	if strings.TrimSpace(tmp.MySQLDSN) == "" {
		return errors.New("MySQL 未配置：请填写 MYSQL_DSN / mysqlDsn，或 mysqlHost、端口、库名、用户")
	}
	if strings.TrimSpace(tmp.RedisAddr) == "" {
		return errors.New("Redis 未配置：请填写 REDIS_ADDR / redisAddr，或 redisHost 与端口")
	}
	if strings.TrimSpace(c.PlatformPublicURL) == "" {
		return errors.New("平台对外 URL 不能为空（PLATFORM_PUBLIC_URL / platformPublicUrl）")
	}
	if c.SyncInterval < time.Second {
		return errors.New("SYNC_INTERVAL_SEC 必须 >= 1")
	}
	if c.IngressBaotaSyncEnabled {
		if strings.TrimSpace(c.BaotaURL) == "" || strings.TrimSpace(c.BaotaAPIKey) == "" {
			return errors.New("已开启 Ingress↔宝塔同步时，需填写宝塔 URL 与 API Key")
		}
	}
	be := strings.ToLower(string(c.SSHSettingsBackend))
	if be != "" && be != "redis" && be != "mysql" && be != "file" {
		return errors.New("SSH_SETTINGS_BACKEND 须为 file、redis、mysql 之一（或留空）")
	}
	if be != "" && strings.TrimSpace(c.EncryptionKey) == "" {
		return errors.New("启用 SSH 存储（SSH_SETTINGS_BACKEND）时必须设置 KUBEBT_ENCRYPTION_KEY")
	}
	if be == "file" && strings.TrimSpace(c.SSHSettingsDir) == "" {
		return errors.New("SSH_SETTINGS_BACKEND=file 时必须设置 SSH_SETTINGS_DIR（目录）")
	}
	if err := validateOIDCFields(c); err != nil {
		return err
	}
	return nil
}

func validateOIDCFields(c Config) error {
	i := strings.TrimSpace(c.OIDCIssuerURL)
	id := strings.TrimSpace(c.OIDCClientID)
	sec := strings.TrimSpace(c.OIDCClientSecret)
	red := strings.TrimSpace(c.OIDCRedirectURL)
	n := 0
	if i != "" {
		n++
	}
	if id != "" {
		n++
	}
	if sec != "" {
		n++
	}
	if red != "" {
		n++
	}
	if n == 0 || n == 4 {
		return nil
	}
	return errors.New("OIDC 须同时配置 OIDC_ISSUER_URL、OIDC_CLIENT_ID、OIDC_CLIENT_SECRET、OIDC_REDIRECT_URL（或四项均留空）")
=======
	BaotaURL     string
	BaotaAPIKey  string
	DDNSHost     string
	DefaultPort  string
	SyncInterval time.Duration
}

func LoadConfig() Config {
	return Config{
		BaotaURL:     getEnv("BAOTA_URL", "http://127.0.0.1:8888"),
		BaotaAPIKey:  getEnv("BAOTA_API_KEY", ""), // 必须配置
		DDNSHost:     getEnv("DDNS_HOST", "home.example.com"),
		DefaultPort:  getEnv("DEFAULT_PORT", "38333"),
		SyncInterval: time.Duration(getEnvAsInt("SYNC_INTERVAL_SEC", 30)) * time.Second,
	}
>>>>>>> d16bf5922f8c5e8a4fe187f8af50fc5f2eaa7661
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func getEnvAsInt(key string, fallback int) int {
	if value, exists := os.LookupEnv(key); exists {
<<<<<<< HEAD
		intVal, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return fallback
		}
		return intVal
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	s := strings.ToLower(strings.TrimSpace(v))
	switch s {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
=======
		var intVal int
		fmt.Sscanf(value, "%d", &intVal)
		return intVal
	}
	return fallback
}
>>>>>>> d16bf5922f8c5e8a4fe187f8af50fc5f2eaa7661

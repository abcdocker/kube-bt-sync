package internal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const runtimeConfigFileName = "runtime-config.json"

// RuntimeK8s 持久化 K8s 连接方式（Pod 内用 incluster；外部集群粘贴 kubeconfig 全文）。
type RuntimeK8s struct {
	Mode           string `json:"mode"` // incluster | kubeconfig
	KubeconfigYAML string `json:"kubeconfigYaml,omitempty"`
}

// RuntimeSettings 写入 dataDir/runtime-config.json；Initialized=true 后与 LoadConfig() 合并为进程配置。
type RuntimeSettings struct {
	Version     int  `json:"version"`
	Initialized bool `json:"initialized"`

	BaotaURL                  string `json:"baotaUrl"`
	BaotaAPIKey               string `json:"baotaApiKey"`
	BaotaSkipTLSVerify        *bool  `json:"baotaSkipTlsVerify,omitempty"`
	BaotaDisableHTTPKeepAlive *bool  `json:"baotaDisableHttpKeepalive,omitempty"`
	BaotaHTTPTimeoutSec       int    `json:"baotaHttpTimeoutSec"`
	BaotaTCPProbeTimeoutSec   int    `json:"baotaTcpProbeTimeoutSec"`
	BaotaCheckMinIntervalSec  int    `json:"baotaCheckMinIntervalSec"`
	DDNSHost                  string `json:"ddnsHost"`
	DefaultPort               string `json:"defaultPort"`
	BaotaSSLCertName          string `json:"baotaSslCertName"`
	SyncIntervalSec           int    `json:"syncIntervalSec"`

	DashboardUser          string `json:"dashboardUser"`
	DashboardPassword      string `json:"dashboardPassword,omitempty"` // bcrypt，由 POST /api/setup 写入
	DashboardSessionSecret string `json:"dashboardSessionSecret,omitempty"`
	DashboardSessionDays   int    `json:"dashboardSessionDays"`
	DashboardCookieSecure  bool   `json:"dashboardCookieSecure"`
	DashboardListenAddr    string `json:"dashboardListenAddr"`

	OIDCIssuerURL    string `json:"oidcIssuerUrl,omitempty"`
	OIDCClientID     string `json:"oidcClientId,omitempty"`
	OIDCClientSecret string `json:"oidcClientSecret,omitempty"`
	OIDCRedirectURL  string `json:"oidcRedirectUrl,omitempty"`
	OIDCScopes       string `json:"oidcScopes,omitempty"`

	PrometheusURL         string `json:"prometheusUrl"`
	PrometheusTimeoutSec    int    `json:"prometheusTimeoutSec"`
	PrometheusSkipTLS       bool   `json:"prometheusSkipTls"`
	PrometheusBearerToken string `json:"prometheusBearerToken,omitempty"`

	VCenterURL                  string `json:"vcenterUrl"`
	VCenterUser                 string `json:"vcenterUser"`
	VCenterPassword             string `json:"vcenterPassword,omitempty"`
	VCenterInsecure             bool   `json:"vcenterInsecure"`
	VCenterWmksScriptURL        string `json:"vcenterWmksScriptUrl"`
	VCenterWmksCssURL           string `json:"vcenterWmksCssUrl"`
	VCenterUIBaseURL            string `json:"vcenterUiBaseUrl"`
	VCenterConsoleHost          string `json:"vcenterConsoleHost"`
	VCenterUIThumbprint         string `json:"vcenterUiThumbprint"`
	VCenterVMSshUser            string `json:"vcenterVmSshUser"`
	VCenterVMSshPrivateKeyPath  string `json:"vcenterVmSshPrivateKeyPath"`
	VCenterVMSshPassword        string `json:"vcenterVmSshPassword,omitempty"`
	VCenterVMSshKeyPassphrase   string `json:"vcenterVmSshKeyPassphrase,omitempty"`
	VCenterVMSshPort            int    `json:"vcenterVmSshPort"`
	VCenterVMSshInsecureHostKey bool   `json:"vcenterVmSshInsecureHostKey"`

	SSHSettingsBackend string `json:"sshSettingsBackend"`
	EncryptionKey      string `json:"encryptionKey,omitempty"`
	RedisAddr          string `json:"redisAddr,omitempty"`
	RedisPassword      string `json:"redisPassword,omitempty"`
	RedisDB            int    `json:"redisDb"`
	RedisKeyPrefix     string `json:"redisKeyPrefix"`
	// RedisMode：standalone | sentinel | cluster（轻量客户端仅连接 redisHost:redisPort）
	RedisMode           string `json:"redisMode,omitempty"`
	RedisHost           string `json:"redisHost,omitempty"`
	RedisPort           int    `json:"redisPort,omitempty"`
	RedisSentinelMaster string `json:"redisSentinelMaster,omitempty"`
	MySQLDSN            string `json:"mysqlDsn,omitempty"`
	MySQLHost           string `json:"mysqlHost,omitempty"`
	MySQLPort           int    `json:"mysqlPort,omitempty"`
	MySQLDatabase       string `json:"mysqlDatabase,omitempty"`
	MySQLUser           string `json:"mysqlUser,omitempty"`
	MySQLPassword       string `json:"mysqlPassword,omitempty"`
	SSHSettingsDir      string `json:"sshSettingsDir"`

	// 平台对外 URL（必填项之一）
	PlatformPublicURL string `json:"platformPublicUrl"`
	// Ingress↔宝塔同步开关（默认 false，后台可开）
	IngressBaotaSyncEnabled bool `json:"ingressBaotaSyncEnabled"`
	// vCenter 虚拟机列表 Redis 缓存 TTL（秒）
	VCenterCacheTTLSec int `json:"vcenterCacheTtlSec"`

	K8s *RuntimeK8s `json:"k8s"`
}

// LoadRuntimeSettings 读取本地 JSON；不存在则返回未初始化空配置。
func LoadRuntimeSettings(path string) (*RuntimeSettings, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &RuntimeSettings{Version: 1}, nil
		}
		return nil, err
	}
	var rs RuntimeSettings
	if err := json.Unmarshal(b, &rs); err != nil {
		return nil, err
	}
	if rs.Version < 1 {
		rs.Version = 1
	}
	return &rs, nil
}

// SaveRuntimeSettings 原子写入（0600）。
func SaveRuntimeSettings(path string, rs *RuntimeSettings) error {
	if rs == nil {
		return errors.New("runtime settings 为空")
	}
	if rs.Version < 1 {
		rs.Version = 1
	}
	b, err := json.MarshalIndent(rs, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// MergeRuntimeConfig 将 env 加载的 Config 与持久化层合并；未初始化时仅返回 env。
func MergeRuntimeConfig(env Config, rs *RuntimeSettings, dataDir string) Config {
	if rs == nil || !rs.Initialized {
		return env
	}
	out := env

	out.BaotaURL = rs.BaotaURL
	out.BaotaAPIKey = rs.BaotaAPIKey
	if rs.BaotaSkipTLSVerify != nil {
		out.BaotaSkipTLSVerify = *rs.BaotaSkipTLSVerify
	} else if strings.TrimSpace(rs.BaotaURL) != "" {
		out.BaotaSkipTLSVerify = loadBaotaSkipTLSVerify(rs.BaotaURL)
	}
	if rs.BaotaDisableHTTPKeepAlive != nil {
		out.BaotaDisableHTTPKeepAlive = *rs.BaotaDisableHTTPKeepAlive
	}
	if rs.BaotaHTTPTimeoutSec > 0 {
		out.BaotaHTTPTimeout = time.Duration(rs.BaotaHTTPTimeoutSec) * time.Second
	}
	if rs.BaotaTCPProbeTimeoutSec > 0 {
		out.BaotaTCPProbeTimeout = time.Duration(rs.BaotaTCPProbeTimeoutSec) * time.Second
	}
	if rs.BaotaCheckMinIntervalSec >= 0 {
		out.BaotaCheckMinInterval = time.Duration(rs.BaotaCheckMinIntervalSec) * time.Second
	}
	if rs.DDNSHost != "" {
		out.DDNSHost = rs.DDNSHost
	}
	if rs.DefaultPort != "" {
		out.DefaultPort = rs.DefaultPort
	}
	if rs.BaotaSSLCertName != "" {
		out.BaotaSSLCertName = rs.BaotaSSLCertName
	}
	if rs.SyncIntervalSec > 0 {
		out.SyncInterval = time.Duration(rs.SyncIntervalSec) * time.Second
	}

	if rs.DashboardUser != "" {
		out.DashboardUser = rs.DashboardUser
	}
	if rs.DashboardPassword != "" {
		out.DashboardPassword = rs.DashboardPassword
	}
	if rs.DashboardSessionSecret != "" {
		out.DashboardSessionSecret = rs.DashboardSessionSecret
	}
	if rs.DashboardSessionDays > 0 {
		out.DashboardSessionDays = rs.DashboardSessionDays
	}
	out.DashboardCookieSecure = rs.DashboardCookieSecure
	if strings.TrimSpace(rs.DashboardListenAddr) != "" {
		out.DashboardListenAddr = normalizeDashboardListenAddr(rs.DashboardListenAddr)
	}
	if strings.TrimSpace(rs.OIDCIssuerURL) != "" {
		out.OIDCIssuerURL = strings.TrimSpace(rs.OIDCIssuerURL)
	}
	if strings.TrimSpace(rs.OIDCClientID) != "" {
		out.OIDCClientID = strings.TrimSpace(rs.OIDCClientID)
	}
	if strings.TrimSpace(rs.OIDCClientSecret) != "" {
		out.OIDCClientSecret = rs.OIDCClientSecret
	}
	if strings.TrimSpace(rs.OIDCRedirectURL) != "" {
		out.OIDCRedirectURL = strings.TrimSpace(rs.OIDCRedirectURL)
	}
	if strings.TrimSpace(rs.OIDCScopes) != "" {
		out.OIDCScopes = strings.TrimSpace(rs.OIDCScopes)
	}

	if rs.PrometheusURL != "" {
		out.PrometheusURL = rs.PrometheusURL
	}
	if rs.PrometheusTimeoutSec > 0 {
		out.PrometheusTimeout = time.Duration(rs.PrometheusTimeoutSec) * time.Second
	}
	out.PrometheusSkipTLS = rs.PrometheusSkipTLS
	if rs.PrometheusBearerToken != "" {
		out.PrometheusBearerToken = rs.PrometheusBearerToken
	}

	if rs.VCenterURL != "" {
		out.VCenterURL = rs.VCenterURL
	}
	if rs.VCenterUser != "" {
		out.VCenterUser = rs.VCenterUser
	}
	if rs.VCenterPassword != "" {
		out.VCenterPassword = rs.VCenterPassword
	}
	out.VCenterInsecure = rs.VCenterInsecure
	if rs.VCenterWmksScriptURL != "" {
		out.VCenterWmksScriptURL = rs.VCenterWmksScriptURL
	}
	if rs.VCenterWmksCssURL != "" {
		out.VCenterWmksCssURL = rs.VCenterWmksCssURL
	}
	if rs.VCenterUIBaseURL != "" {
		out.VCenterUIBaseURL = rs.VCenterUIBaseURL
	}
	if rs.VCenterConsoleHost != "" {
		out.VCenterConsoleHost = rs.VCenterConsoleHost
	}
	if rs.VCenterUIThumbprint != "" {
		out.VCenterUIThumbprint = rs.VCenterUIThumbprint
	}
	if rs.VCenterVMSshUser != "" {
		out.VCenterVMSshUser = rs.VCenterVMSshUser
	}
	if rs.VCenterVMSshPrivateKeyPath != "" {
		out.VCenterVMSshPrivateKeyPath = rs.VCenterVMSshPrivateKeyPath
	}
	if rs.VCenterVMSshPassword != "" {
		out.VCenterVMSshPassword = rs.VCenterVMSshPassword
	}
	if rs.VCenterVMSshKeyPassphrase != "" {
		out.VCenterVMSshKeyPassphrase = rs.VCenterVMSshKeyPassphrase
	}
	if rs.VCenterVMSshPort > 0 {
		out.VCenterVMSshPort = rs.VCenterVMSshPort
	}
	out.VCenterVMSshInsecureHostKey = rs.VCenterVMSshInsecureHostKey

	// 已初始化：与 SSH/Redis/MySQL 相关字段以文件为准（含空值，避免仍被宿主机环境变量覆盖）
	out.SSHSettingsBackend = SSHSettingsBackend(strings.ToLower(strings.TrimSpace(rs.SSHSettingsBackend)))
	out.EncryptionKey = rs.EncryptionKey
	if strings.TrimSpace(rs.RedisMode) != "" {
		out.RedisMode = strings.ToLower(strings.TrimSpace(rs.RedisMode))
	}
	out.RedisHost = strings.TrimSpace(rs.RedisHost)
	if rs.RedisPort > 0 {
		out.RedisPort = rs.RedisPort
	}
	out.RedisSentinelMaster = strings.TrimSpace(rs.RedisSentinelMaster)
	out.RedisAddr = rs.RedisAddr
	out.RedisPassword = rs.RedisPassword
	out.RedisDB = rs.RedisDB
	out.RedisKeyPrefix = rs.RedisKeyPrefix

	out.MySQLHost = strings.TrimSpace(rs.MySQLHost)
	if rs.MySQLPort > 0 {
		out.MySQLPort = rs.MySQLPort
	}
	out.MySQLDatabase = strings.TrimSpace(rs.MySQLDatabase)
	out.MySQLUser = strings.TrimSpace(rs.MySQLUser)
	out.MySQLPassword = rs.MySQLPassword
	out.MySQLDSN = rs.MySQLDSN
	out.SSHSettingsDir = rs.SSHSettingsDir

	if strings.TrimSpace(out.RedisHost) != "" && out.RedisPort <= 0 {
		out.RedisPort = 6379
	}
	if strings.TrimSpace(out.MySQLHost) != "" && out.MySQLPort <= 0 {
		out.MySQLPort = 3306
	}
	FinalizeConnectionStrings(&out)

	// file 后端默认子目录
	if out.SSHSettingsBackend == SSHBackendFile && strings.TrimSpace(out.SSHSettingsDir) == "" && dataDir != "" {
		out.SSHSettingsDir = filepath.Join(dataDir, "ssh-vm")
	}

	out.PlatformPublicURL = rs.PlatformPublicURL
	out.IngressBaotaSyncEnabled = rs.IngressBaotaSyncEnabled
	if rs.VCenterCacheTTLSec > 0 {
		out.VCenterCacheTTLSec = rs.VCenterCacheTTLSec
	}

	return out
}

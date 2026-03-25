package internal

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml" // K8s 官方 YAML 库
)

type YamlRequest struct {
	YamlContent string `json:"yamlContent" binding:"required"`
}

type DeleteIngressRequest struct {
	Namespace   string `json:"namespace" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Domain      string `json:"domain"`
	DeleteBaota bool   `json:"deleteBaota"`
}

func StartWebServer(app *ServerApp) {
	r := gin.New()
	r.Use(gin.Recovery())
	cfg := app.Cfg()
	configureGinTrustedProxies(r, cfg)
	r.Use(auditAccessLogMiddleware(app))

	// 无需登录：探活、初始化向导、登录态
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "service": "kube-bt-sync"})
	})
	r.GET("/api/setup/status", handleSetupStatus(app))
	r.POST("/api/setup", handleSetupSave(app))
	r.GET("/api/auth/status", func(c *gin.Context) { handleAuthStatus(c, app.Cfg()) })
	r.POST("/api/auth/login", func(c *gin.Context) { handleAuthLogin(c, app) })
	r.POST("/api/auth/logout", func(c *gin.Context) { handleAuthLogout(c, app) })
	r.GET("/api/auth/oidc/login", handleOIDCLogin(app))
	r.GET("/api/auth/oidc/callback", handleOIDCCallback(app))
	log.Println("Dashboard: GET /api/health、/api/setup/status、/api/auth/status、OIDC /api/auth/oidc/* 无需登录；未初始化时 POST /api/setup")

	api := r.Group("/api")
	api.Use(DashboardAuthMiddleware(app))
	{
		api.GET("/config", func(c *gin.Context) { handleGetConfig(c, app) })
		api.GET("/system/check", func(c *gin.Context) { handleSystemCheck(c, app.K8s(), app.Cfg()) })
		api.GET("/namespaces", func(c *gin.Context) { handleGetNamespaces(c, app.K8s()) })
		api.GET("/services", func(c *gin.Context) { handleGetServices(c, app.K8s()) })
		api.GET("/ingresses", func(c *gin.Context) { handleListAllIngresses(c, app.K8s()) })
		api.GET("/status", func(c *gin.Context) { handleGetStatus(c, app.K8s(), app.Cfg()) })
		api.GET("/ingress/raw", func(c *gin.Context) { handleGetIngressRaw(c, app.K8s()) })
		api.POST("/ingress/yaml", func(c *gin.Context) { handleApplyYaml(c, app.K8s()) })
		api.POST("/ingress/delete", func(c *gin.Context) { handleDeleteIngress(c, app.K8s(), app.Cfg()) })

		api.GET("/k8s/summary", func(c *gin.Context) { handleK8sSummary(c, app.K8s()) })
		api.GET("/k8s/pods/:namespace/:name/exec/ws", func(c *gin.Context) { handleK8sPodExecWS(c, app.K8s(), app.K8sREST()) })
		api.GET("/k8s/pods/:namespace/:name/logs", func(c *gin.Context) { handleK8sPodLogs(c, app.K8s()) })
		api.GET("/k8s/pods/:namespace/:name", func(c *gin.Context) { handleK8sPodGet(c, app.K8s()) })
		api.DELETE("/k8s/pods/:namespace/:name", func(c *gin.Context) { handleK8sPodDelete(c, app.K8s()) })
		api.GET("/k8s/pods", func(c *gin.Context) { handleK8sPods(c, app.K8s()) })
		api.GET("/k8s/services", func(c *gin.Context) { handleK8sServices(c, app.K8s()) })
		api.GET("/k8s/deployments", func(c *gin.Context) { handleK8sDeployments(c, app.K8s()) })
		api.GET("/k8s/statefulsets", func(c *gin.Context) { handleK8sStatefulSets(c, app.K8s()) })
		api.GET("/k8s/daemonsets", func(c *gin.Context) { handleK8sDaemonSets(c, app.K8s()) })
		api.GET("/k8s/pvcs", func(c *gin.Context) { handleK8sPVCs(c, app.K8s()) })
		api.GET("/k8s/configmaps", func(c *gin.Context) { handleK8sConfigMaps(c, app.K8s()) })
		api.GET("/k8s/nodes", func(c *gin.Context) { handleK8sNodes(c, app.K8s()) })
		api.GET("/k8s/namespaces/stats", func(c *gin.Context) { handleK8sNamespaceStats(c, app.K8s()) })
		api.GET("/k8s/namespace-stats", func(c *gin.Context) { handleK8sNamespaceStats(c, app.K8s()) })
		api.POST("/k8s/apply-yaml", func(c *gin.Context) { handleK8sApplyYamlGeneric(c, app.K8s()) })
		api.GET("/k8s/object-yaml", func(c *gin.Context) { handleK8sGetObjectYAML(c, app.K8s()) })
		api.DELETE("/k8s/objects/:kind/:namespace/:name", func(c *gin.Context) { handleK8sDeleteObject(c, app.K8s()) })

		api.GET("/settings/runtime", handleGetRuntimeSettings(app))
		api.PUT("/settings/runtime", handlePutRuntimeSettings(app))
		api.GET("/audit/logs", handleGetAuditLogs(app))
		api.GET("/prometheus/status", func(c *gin.Context) { handlePrometheusStatus(c, app.Cfg()) })
		api.GET("/prometheus/discover", func(c *gin.Context) { handlePrometheusDiscover(c, app.K8s()) })
		api.POST("/prometheus/source", func(c *gin.Context) { handlePrometheusSource(c, app.Cfg()) })
		api.GET("/prometheus/query", func(c *gin.Context) { handlePrometheusQuery(c, app.Cfg()) })
		api.GET("/prometheus/query_range", func(c *gin.Context) { handlePrometheusQueryRange(c, app.Cfg()) })

		registerVCenterRoutes(api, app)
	}
	log.Println("Dashboard: WebSocket /api/k8s/pods/.../exec/ws、/api/vcenter/vms/.../console-ws、/api/vcenter/vms/.../ssh/ws；GET/DELETE pods；GET summary、namespaces/stats、pods、deployments、statefulsets、daemonsets、pvcs、configmaps、services、nodes；GET/POST prometheus；vCenter API")

	registerFrontendRoutes(r)

	addr := strings.TrimSpace(cfg.DashboardListenAddr)
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
	}

	log.Printf("kube-bt-sync Dashboard 已启动，监听 %s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Web 服务启动失败: %v", err)
	}
}

// resolveReactDistDir 查找 Vite 构建产物：环境变量 DASHBOARD_STATIC_DIR、当前目录、可执行文件旁 react/dist。
func resolveReactDistDir() string {
	if v := strings.TrimSpace(os.Getenv("DASHBOARD_STATIC_DIR")); v != "" {
		return v
	}
	candidates := make([]string, 0, 8)
	candidates = append(candidates,
		filepath.Join("react", "dist"),
		filepath.Join("..", "react", "dist"),
	)
	if exe, err := os.Executable(); err == nil {
		exePath := exe
		if rp, err := filepath.EvalSymlinks(exe); err == nil {
			exePath = rp
		}
		exeDir := filepath.Dir(exePath)
		candidates = append([]string{
			filepath.Join(exeDir, "react", "dist"),
			filepath.Join(exeDir, "..", "react", "dist"),
		}, candidates...)
	}
	for _, p := range candidates {
		idx := filepath.Join(p, "index.html")
		if fileExists(idx) {
			if abs, err := filepath.Abs(p); err == nil {
				log.Printf("前端静态目录: %s", abs)
			}
			return p
		}
	}
	return filepath.Join("react", "dist")
}

func registerFrontendRoutes(r *gin.Engine) {
	reactDistDir := resolveReactDistDir()
	reactIndex := filepath.Join(reactDistDir, "index.html")

	// Prefer the React build output if available.
	if fileExists(reactIndex) {
		r.Static("/assets", filepath.Join(reactDistDir, "assets"))
		r.StaticFile("/favicon.ico", filepath.Join(reactDistDir, "favicon.ico"))
		r.StaticFile("/vite.svg", filepath.Join(reactDistDir, "vite.svg"))
		r.GET("/", func(c *gin.Context) { c.File(reactIndex) })
		r.NoRoute(func(c *gin.Context) {
			if strings.HasPrefix(c.Request.URL.Path, "/api/") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			c.File(reactIndex)
		})
		log.Println("前端模式: React dist（访问 / 与前端路由请使用本目录构建产物）")
		return
	}

	log.Printf("未找到 %s，回退到 templates/index.html；请执行: cd react && npm run build", reactIndex)
	// Fallback to server-rendered template if React dist not built.
	r.Delims("[[", "]]")
	r.LoadHTMLGlob("templates/*")
	r.GET("/", func(c *gin.Context) { c.HTML(http.StatusOK, "index.html", nil) })
	log.Println("前端模式: templates/index.html (未检测到 react/dist)")
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func handleGetStatus(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	if !GuardK8s(c, k8sClient) {
		return
	}
	ingresses, err := k8sClient.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询 Ingress 失败: " + err.Error()})
		return
	}
	result := make([]map[string]interface{}, 0)
	for _, ing := range ingresses.Items {
		if IsManagedIngress(ing.Annotations) {
			port := cfg.DefaultPort
			if cp, ok := ing.Annotations["i4t.com/ddns-port"]; ok && cp != "" {
				port = cp
			}
			domain := "N/A"
			if len(ing.Spec.Rules) > 0 {
				domain = ing.Spec.Rules[0].Host
			}

			scheme := "http"
			if len(ing.Spec.TLS) > 0 {
				scheme = "https"
			}

			result = append(result, map[string]interface{}{
				"namespace": ing.Namespace, "name": ing.Name, "domain": domain,
				"ddnsPort": port, "createdAt": ing.CreationTimestamp.Format("2006-01-02 15:04:05"),
				"modifiedAt": ing.CreationTimestamp.Format("2006-01-02 15:04:05"),
				"version":    ing.ResourceVersion,
				"scheme":     scheme,
				"status":     "已托管",
			})
		}
	}
	c.JSON(http.StatusOK, result)
}

// 处理前端发来的纯 YAML 字符串
func handleApplyYaml(c *gin.Context, k8sClient *kubernetes.Clientset) {
	if !GuardK8s(c, k8sClient) {
		return
	}
	var req YamlRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "参数解析失败: " + err.Error()})
		return
	}

	// 1. 将 YAML 解析为 K8s 的 Ingress 结构体
	var ingress networkingv1.Ingress
	if err := yaml.Unmarshal([]byte(req.YamlContent), &ingress); err != nil {
		c.JSON(400, gin.H{"error": "YAML 格式错误: " + err.Error()})
		return
	}

	if ingress.Namespace == "" {
		ingress.Namespace = "default"
	}

	// 2. 与 K8s API 交互 (获取现有的资源版本，以支持 Update)
	client := k8sClient.NetworkingV1().Ingresses(ingress.Namespace)
	existing, err := client.Get(context.TODO(), ingress.Name, metav1.GetOptions{})

	if err == nil {
		// 存在则更新，必须带上旧的 ResourceVersion
		ingress.ResourceVersion = existing.ResourceVersion
		_, err = client.Update(context.TODO(), &ingress, metav1.UpdateOptions{})
	} else if apierrors.IsNotFound(err) {
		// 不存在则创建
		_, err = client.Create(context.TODO(), &ingress, metav1.CreateOptions{})
	} else {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取现有资源失败: " + err.Error()})
		return
	}

	if err != nil {
		c.JSON(500, gin.H{"error": FriendlyIngressApplyError(err)})
		return
	}

	c.JSON(200, gin.H{"message": "YAML 资源已成功应用到 K8s 集群！"})
}

func handleGetNamespaces(c *gin.Context, k8sClient *kubernetes.Clientset) {
	if !GuardK8s(c, k8sClient) {
		return
	}
	namespaces, err := k8sClient.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询命名空间失败: " + err.Error()})
		return
	}
	items := make([]string, 0, len(namespaces.Items))
	for _, ns := range namespaces.Items {
		items = append(items, ns.Name)
	}
	sort.Strings(items)
	c.JSON(http.StatusOK, items)
}

func handleGetServices(c *gin.Context, k8sClient *kubernetes.Clientset) {
	if !GuardK8s(c, k8sClient) {
		return
	}
	services, err := k8sClient.CoreV1().Services("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询服务失败: " + err.Error()})
		return
	}
	result := make([]map[string]interface{}, 0, len(services.Items))
	for _, svc := range services.Items {
		ports := make([]int32, 0, len(svc.Spec.Ports))
		for _, p := range svc.Spec.Ports {
			ports = append(ports, p.Port)
		}
		result = append(result, map[string]interface{}{
			"namespace": svc.Namespace,
			"name":      svc.Name,
			"ports":     ports,
		})
	}
	c.JSON(http.StatusOK, result)
}

func handleGetConfig(c *gin.Context, app *ServerApp) {
	cfg := app.Cfg()
	sshStore := app.SSHStore()
	httpsPort := envOrDefault("HTTPS_PORT", "443")
	dashUser := strings.TrimSpace(cfg.DashboardUser)
	if dashUser == "" {
		dashUser = "admin"
	}
	dashDays := cfg.DashboardSessionDays
	if dashDays < 1 {
		dashDays = 7
	}
	c.JSON(http.StatusOK, gin.H{
		"baotaUrl":                  cfg.BaotaURL,
		"ddnsHost":                  cfg.DDNSHost,
		"defaultPort":               cfg.DefaultPort,
		"httpsPort":                 httpsPort,
		"syncIntervalSec":           int(cfg.SyncInterval.Seconds()),
		"baotaHttpTimeoutSec":       int(cfg.BaotaHTTPTimeout.Seconds()),
		"baotaTcpProbeTimeoutSec":   int(cfg.BaotaTCPProbeTimeout.Seconds()),
		"baotaDisableHttpKeepalive": cfg.BaotaDisableHTTPKeepAlive,
		"baotaCheckMinIntervalSec":  int(cfg.BaotaCheckMinInterval.Seconds()),
		"hasBaotaApiKey":            strings.TrimSpace(cfg.BaotaAPIKey) != "",
		"baotaSkipTlsVerify":        cfg.BaotaSkipTLSVerify,
		"baotaSslCertName":          cfg.BaotaSSLCertName,
		"dashboardAuthEnabled":      cfg.DashboardAuthEnabled(),
		"passwordLoginEnabled":      cfg.PasswordLoginEnabled(),
		"oidcConfigured":            cfg.OIDCConfigured(),
		"dashboardUser":             dashUser,
		"dashboardSessionDays":      dashDays,
		"dashboardListenAddr":       strings.TrimSpace(cfg.DashboardListenAddr),
		"prometheusConfigured":      GetEffectivePrometheusURL(cfg) != "",
		"prometheusUrlHint":         maskPrometheusURL(GetEffectivePrometheusURL(cfg)),
		"prometheusTimeoutSec":      int(cfg.PrometheusTimeout.Seconds()),
		"prometheusSkipTls":         cfg.PrometheusSkipTLS,
		"prometheusHasBearer":       strings.TrimSpace(cfg.PrometheusBearerToken) != "",
		"vcenterConfigured":         cfg.vCenterConfigured(),
		"vcenterUrlHint":            maskVCenterURL(cfg.VCenterURL),
		"vcenterUiOrigin":           vcenterUIOriginFromURL(cfg.VCenterURL),
		"vcenterUiBaseUrl":          EffectiveVCenterUIBaseURL(cfg),
		"vcenterUiLoginUrl":         vcenterUiLoginURL(cfg),
		// 未设置 WMKS 环境变量时，由 VCENTER_URL 推导常见路径；前端可按 candidates 依次尝试。
		"vcenterWmksScriptUrl":           EffectiveVCenterWmksScriptURL(cfg),
		"vcenterWmksCssUrl":              EffectiveVCenterWmksCssURL(cfg),
		"vcenterWmksScriptUrlCandidates": VCenterWmksScriptURLCandidates(cfg),
		"vcenterWmksCssUrlCandidates":    VCenterWmksCssURLCandidates(cfg),
		"vcenterWmksScriptUrlFromEnv":    strings.TrimSpace(cfg.VCenterWmksScriptURL) != "",
		"vcenterWmksCssUrlFromEnv":       strings.TrimSpace(cfg.VCenterWmksCssURL) != "",
		"vcenterVmSshConfigured":         vcenterSSHConfiguredForUI(cfg, sshStore),
		"sshSettingsBackend":             string(cfg.SSHSettingsBackend),
		"sshStoreEnabled":                sshStore != nil,
		"sshEncryptionReady": func() bool {
			_, err := sshEncryptionKey(cfg)
			return err == nil
		}(),
		"setupInitialized":        app.Initialized(),
		"dataDir":                 app.DataDir(),
		"platformPublicUrl":       cfg.PlatformPublicURL,
		"ingressBaotaSyncEnabled": cfg.IngressBaotaSyncEnabled,
		"vcenterCacheTtlSec":      cfg.VCenterCacheTTLSec,
		"k8sConfigured":           app.K8s() != nil,
		"redisConnected":          app.Redis() != nil,
		"runtimeDualWriteRedis":   cfg.RuntimeDualWriteRedis,
		"redisMirrorRuntimeKey":   redisRuntimeConfigKey(cfg),
		"redisMirrorPlatformKvKey": redisPlatformKVKey(cfg),
		"mysqlDsnConfigured":      strings.TrimSpace(cfg.MySQLDSN) != "",
		"platformKvReady":         app.PlatformKV() != nil,
	})
}

func vcenterSSHConfiguredForUI(cfg Config, sshStore SSHSettingsStore) bool {
	if cfg.vCenterVMSshConfigured() {
		return true
	}
	if sshStore == nil {
		return false
	}
	_, err := sshEncryptionKey(cfg)
	return err == nil
}

func handleListAllIngresses(c *gin.Context, k8sClient *kubernetes.Clientset) {
	if !GuardK8s(c, k8sClient) {
		return
	}
	ingresses, err := k8sClient.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询 Ingress 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(ingresses.Items))
	for _, ing := range ingresses.Items {
		hosts := make([]string, 0)
		for _, r := range ing.Spec.Rules {
			if r.Host != "" {
				hosts = append(hosts, r.Host)
			}
		}
		className := ""
		if ing.Spec.IngressClassName != nil {
			className = *ing.Spec.IngressClassName
		}
		if className == "" {
			className = ing.Annotations["kubernetes.io/ingress.class"]
		}
		out = append(out, map[string]interface{}{
			"namespace": ing.Namespace,
			"name":      ing.Name,
			"hosts":     hosts,
			"class":     className,
			"createdAt": ing.CreationTimestamp.Format(time.RFC3339),
			"managed":   IsManagedIngress(ing.Annotations),
		})
	}
	c.JSON(http.StatusOK, out)
}

func handleGetIngressRaw(c *gin.Context, k8sClient *kubernetes.Clientset) {
	if !GuardK8s(c, k8sClient) {
		return
	}
	ns := strings.TrimSpace(c.Query("ns"))
	name := strings.TrimSpace(c.Query("name"))
	if ns == "" || name == "" {
		c.String(http.StatusBadRequest, "缺少参数 ns 或 name")
		return
	}
	ingress, err := k8sClient.NetworkingV1().Ingresses(ns).Get(context.TODO(), name, metav1.GetOptions{})
	if err != nil {
		c.String(http.StatusInternalServerError, "获取 Ingress 失败: %v", err)
		return
	}
	data, err := yaml.Marshal(ingress)
	if err != nil {
		c.String(http.StatusInternalServerError, "序列化 YAML 失败: %v", err)
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", data)
}

func handleDeleteIngress(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	if !GuardK8s(c, k8sClient) {
		return
	}
	var req DeleteIngressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数解析失败: " + err.Error()})
		return
	}
	if err := k8sClient.NetworkingV1().Ingresses(req.Namespace).Delete(context.TODO(), req.Name, metav1.DeleteOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除 Ingress 失败: " + err.Error()})
		return
	}

	msg := "Ingress 删除成功"
	if req.DeleteBaota && strings.TrimSpace(req.Domain) != "" {
		if btErr := DeleteBaotaSiteAndProxy(cfg, req.Domain); btErr != nil {
			log.Printf("宝塔删除失败，将后台重试: %v", btErr)
			ScheduleBaotaDeleteRetry(cfg, req.Domain)
			msg = fmt.Sprintf("Ingress 已删除；宝塔清理失败（已排队重试）: %v", btErr)
		} else {
			msg = "Ingress 和宝塔站点均删除成功"
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": msg})
}

// 减轻对宝塔面板的 TCP 拨号频率：同一进程内短时复用探活结果（不调用 HTTP API）。
var baotaProbeCache struct {
	mu     sync.Mutex
	at     time.Time
	ok     bool
	errMsg string
	okMsg  string
}

func shouldRetryBaotaTCPProbe(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "timeout") || strings.Contains(s, "deadline") ||
		strings.Contains(s, "connection reset") || strings.Contains(s, "eof") ||
		strings.Contains(s, "reset by peer") || strings.Contains(s, "connection refused")
}

func probeBaotaTCPWithRetry(cfg Config) error {
	err := ProbeBaotaTCP(cfg)
	if err != nil && shouldRetryBaotaTCPProbe(err) {
		time.Sleep(time.Second)
		err = ProbeBaotaTCP(cfg)
	}
	return err
}

func probeBaotaForSystemCheck(cfg Config) (status string, msg string) {
	if strings.TrimSpace(cfg.BaotaURL) == "" {
		return "skipped", "未配置宝塔（可在设置中填写并开启 Ingress↔宝塔同步）"
	}
	okMsg := "TCP 可达（未调用宝塔 HTTP API）"
	if cfg.BaotaCheckMinInterval <= 0 {
		if err := probeBaotaTCPWithRetry(cfg); err != nil {
			return "error", err.Error()
		}
		return "success", okMsg
	}
	baotaProbeCache.mu.Lock()
	defer baotaProbeCache.mu.Unlock()
	if !baotaProbeCache.at.IsZero() && time.Since(baotaProbeCache.at) < cfg.BaotaCheckMinInterval {
		if baotaProbeCache.ok {
			return "success", baotaProbeCache.okMsg
		}
		return "error", baotaProbeCache.errMsg
	}
	err := probeBaotaTCPWithRetry(cfg)
	baotaProbeCache.at = time.Now()
	if err != nil {
		baotaProbeCache.ok = false
		baotaProbeCache.errMsg = err.Error()
		return "error", err.Error()
	}
	baotaProbeCache.ok = true
	baotaProbeCache.okMsg = okMsg
	baotaProbeCache.errMsg = ""
	return "success", okMsg
}

func handleSystemCheck(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	baotaStatus, baotaMsg := probeBaotaForSystemCheck(cfg)

	ddnsIPs, _ := net.LookupHost(cfg.DDNSHost)
	ddnsStatus := "success"
	ddnsMsg := fmt.Sprintf("默认端口(%s)检查通过", cfg.DefaultPort)
	if len(ddnsIPs) == 0 {
		ddnsStatus = "error"
		ddnsMsg = "域名解析失败"
	}

	if !isTCPReachable(cfg.DDNSHost, cfg.DefaultPort, 2*time.Second) {
		ddnsStatus = "warning"
		ddnsMsg = fmt.Sprintf("默认端口(%s)不可达", cfg.DefaultPort)
	}

	httpsPort := envOrDefault("HTTPS_PORT", "443")
	port443 := isTCPReachable(cfg.DDNSHost, httpsPort, 2*time.Second)

	metallbInstalled := false
	ingressInstalled := false
	nodeIP := ""
	if k8sClient != nil {
		metallbInstalled = DetectMetalLBNamespace(k8sClient)
		ingressInstalled = DetectIngressController(k8sClient)
		nodeIP = FirstNodeIPPreferInternal(k8sClient)
	}

	c.JSON(http.StatusOK, gin.H{
		"baota": gin.H{
			"status": baotaStatus,
			"url":    cfg.BaotaURL,
			"msg":    baotaMsg,
		},
		"ddns": gin.H{
			"status":    ddnsStatus,
			"host":      cfg.DDNSHost,
			"ips":       ddnsIPs,
			"msg":       ddnsMsg,
			"port443":   port443,
			"httpsPort": httpsPort,
		},
		"k8s": gin.H{
			"metallbInstalled": metallbInstalled,
			"ingressInstalled": ingressInstalled,
			"nodeIP":           nodeIP,
		},
	})
}

func isTCPReachable(host, port string, timeout time.Duration) bool {
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	if host == "" || port == "" {
		return false
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func envOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

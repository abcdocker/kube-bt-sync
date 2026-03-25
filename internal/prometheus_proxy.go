package internal

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	prometheusMu          sync.RWMutex
	prometheusURLOverride string
)

// GetEffectivePrometheusURL 进程内覆盖优先，否则用环境变量 PROMETHEUS_URL。
func GetEffectivePrometheusURL(cfg Config) string {
	prometheusMu.RLock()
	defer prometheusMu.RUnlock()
	if s := strings.TrimSpace(prometheusURLOverride); s != "" {
		return s
	}
	return strings.TrimSpace(cfg.PrometheusURL)
}

// SetPrometheusURLOverride 空字符串表示清除覆盖，恢复仅使用环境变量。
func SetPrometheusURLOverride(u string) {
	prometheusMu.Lock()
	defer prometheusMu.Unlock()
	prometheusURLOverride = strings.TrimSpace(u)
}

func maskPrometheusURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "(invalid)"
	}
	return u.Scheme + "://" + u.Host + "/…"
}

func validatePrometheusBaseURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("仅支持 http/https")
	}
	if u.Host == "" {
		return fmt.Errorf("缺少主机名")
	}
	return nil
}

func prometheusHTTPClient(cfg Config) *http.Client {
	t := cfg.PrometheusTimeout
	if t <= 0 {
		t = 30 * time.Second
	}
	tr := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: cfg.PrometheusSkipTLS,
			MinVersion:         tls.VersionTLS12,
		},
	}
	return &http.Client{Timeout: t, Transport: tr}
}

func handlePrometheusStatus(c *gin.Context, cfg Config) {
	prometheusMu.RLock()
	ov := prometheusURLOverride
	prometheusMu.RUnlock()
	u := GetEffectivePrometheusURL(cfg)
	c.JSON(http.StatusOK, gin.H{
		"configured":     u != "",
		"urlHint":        maskPrometheusURL(u),
		"sourceEnv":      strings.TrimSpace(cfg.PrometheusURL) != "",
		"sourceOverride": strings.TrimSpace(ov) != "",
	})
}

type prometheusSourceBody struct {
	BaseURL string `json:"baseUrl"`
}

func handlePrometheusSource(c *gin.Context, cfg Config) {
	var body prometheusSourceBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数无效"})
		return
	}
	raw := strings.TrimSpace(body.BaseURL)
	if raw == "" {
		SetPrometheusURLOverride("")
		c.JSON(http.StatusOK, gin.H{"message": "已清除自定义 Prometheus 地址，使用环境变量"})
		return
	}
	if err := validatePrometheusBaseURL(raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	SetPrometheusURLOverride(raw)
	c.JSON(http.StatusOK, gin.H{"message": "已保存 Prometheus 地址（仅当前进程有效，重启后请用环境变量或重新保存）"})
}

func handlePrometheusQuery(c *gin.Context, cfg Config) {
	base := GetEffectivePrometheusURL(cfg)
	if base == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 Prometheus：请设置环境变量 PROMETHEUS_URL 或在「集群 → 监控」保存地址"})
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少查询参数 q（PromQL）"})
		return
	}
	u, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 Prometheus 地址"})
		return
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/query"
	qv := url.Values{}
	qv.Set("query", q)
	u.RawQuery = qv.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tok := strings.TrimSpace(cfg.PrometheusBearerToken); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	resp, err := prometheusHTTPClient(cfg).Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "请求 Prometheus 失败: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if resp.StatusCode >= http.StatusBadRequest {
		c.JSON(resp.StatusCode, gin.H{"error": "Prometheus HTTP " + resp.Status, "body": string(body)})
		return
	}
	var parsed interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		c.Data(http.StatusOK, "application/json; charset=utf-8", body)
		return
	}
	c.JSON(http.StatusOK, parsed)
}

func handlePrometheusQueryRange(c *gin.Context, cfg Config) {
	base := GetEffectivePrometheusURL(cfg)
	if base == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 Prometheus"})
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	start := strings.TrimSpace(c.Query("start"))
	end := strings.TrimSpace(c.Query("end"))
	step := strings.TrimSpace(c.Query("step"))
	if q == "" || start == "" || end == "" || step == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "需要 q、start、end、step（Prometheus query_range）"})
		return
	}
	u, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 Prometheus 地址"})
		return
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/query_range"
	qv := url.Values{}
	qv.Set("query", q)
	qv.Set("start", start)
	qv.Set("end", end)
	qv.Set("step", step)
	u.RawQuery = qv.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if tok := strings.TrimSpace(cfg.PrometheusBearerToken); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := prometheusHTTPClient(cfg).Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "请求 Prometheus 失败: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if resp.StatusCode >= http.StatusBadRequest {
		c.JSON(resp.StatusCode, gin.H{"error": "Prometheus HTTP " + resp.Status, "body": string(body)})
		return
	}
	var parsed interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		c.Data(http.StatusOK, "application/json; charset=utf-8", body)
		return
	}
	c.JSON(http.StatusOK, parsed)
}

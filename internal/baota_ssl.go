package internal

import (
	"errors"
	"fmt"
	"strings"
)

// EnsureBaotaHTTPS 在宝塔站点上：1) 从证书夹部署证书 2) 开启强制 HTTP→HTTPS。
// certName 为面板「证书夹」目录名（与域名或泛域名对应，见 BAOTA_SSL_CERT_NAME）；override 非空时优先。
func EnsureBaotaHTTPS(cfg Config, domain, certNameOverride string) error {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return nil
	}
	certName := strings.TrimSpace(certNameOverride)
	if certName == "" {
		certName = strings.TrimSpace(cfg.BaotaSSLCertName)
	}
	if certName == "" {
		return errors.New("未配置证书名称：请设置环境变量 BAOTA_SSL_CERT_NAME，或注解 i4t.com/baota-ssl-cert-name")
	}
	_, err := CallBaotaAPI(cfg, "/ssl?action=SetCertToSite", map[string]string{
		"siteName": domain,
		"certName": certName,
	})
	if err != nil {
		return fmt.Errorf("部署证书夹证书(SetCertToSite): %w", err)
	}
	_, err = CallBaotaAPI(cfg, "/site?action=HttpToHttps", map[string]string{
		"siteName": domain,
	})
	if err != nil {
		return fmt.Errorf("强制 HTTPS(HttpToHttps): %w", err)
	}
	return nil
}

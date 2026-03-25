package internal

import "strings"

// IsManagedIngress 与 Web /status 筛选逻辑一致。
func IsManagedIngress(annotations map[string]string) bool {
	if annotations == nil {
		return false
	}
	return annotations["i4t.com/baota-sync"] == "true" || annotations["kube-bt-sync.io/baota-sync"] == "true"
}

// BaotaHTTPSFromAnnotations 是否为本站开启宝塔 HTTPS；certName 为空则使用全局 BAOTA_SSL_CERT_NAME。
func BaotaHTTPSFromAnnotations(annotations map[string]string) (enable bool, certName string) {
	if annotations == nil {
		return false, ""
	}
	enable = annotations["i4t.com/baota-https"] == "true" || annotations["kube-bt-sync.io/baota-https"] == "true"
	certName = strings.TrimSpace(annotations["i4t.com/baota-ssl-cert-name"])
	if certName == "" {
		certName = strings.TrimSpace(annotations["kube-bt-sync.io/baota-ssl-cert-name"])
	}
	return enable, certName
}

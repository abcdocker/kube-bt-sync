package internal

import "testing"

func TestBaotaHTTPSFromAnnotations(t *testing.T) {
	cfg := BaotaHTTPSFromAnnotations(map[string]string{
		"i4t.com/baota-https":          "true",
		"i4t.com/baota-ssl-cert-name":  "legacy-cert",
		"i4t.com/baota-ssl-pem-path":   "/legacy/site.pem",
		"i4t.com/baota-ssl-key-path":   "/legacy/site.key",
		"kube-bt-sync.io/baota-https":  "true",
		"kube-bt-sync.io/baota-ssl-cert-name": "modern-cert",
		"kube-bt-sync.io/baota-ssl-pem-path":  "/modern/site.pem",
		"kube-bt-sync.io/baota-ssl-key-path":  "/modern/site.key",
	})
	if !cfg.Enable {
		t.Fatal("expected https enabled")
	}
	if cfg.CertName != "legacy-cert" {
		t.Fatalf("cert name: got %q want legacy-cert", cfg.CertName)
	}
	if cfg.PemPath != "/legacy/site.pem" {
		t.Fatalf("pem path: got %q want legacy pem", cfg.PemPath)
	}
	if cfg.KeyPath != "/legacy/site.key" {
		t.Fatalf("key path: got %q want legacy key", cfg.KeyPath)
	}
}

func TestBaotaHTTPSFromAnnotations_ModernFallback(t *testing.T) {
	cfg := BaotaHTTPSFromAnnotations(map[string]string{
		"kube-bt-sync.io/baota-https":         "true",
		"kube-bt-sync.io/baota-ssl-cert-name": "modern-cert",
		"kube-bt-sync.io/baota-ssl-pem-path":  "/modern/site.pem",
		"kube-bt-sync.io/baota-ssl-key-path":  "/modern/site.key",
	})
	if !cfg.Enable {
		t.Fatal("expected https enabled")
	}
	if cfg.CertName != "modern-cert" {
		t.Fatalf("cert name: got %q want modern-cert", cfg.CertName)
	}
	if cfg.PemPath != "/modern/site.pem" || cfg.KeyPath != "/modern/site.key" {
		t.Fatalf("unexpected pem/key paths: %#v", cfg)
	}
}

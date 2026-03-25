package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ProxyTarget struct {
	Domain       string
	TargetURL    string
	BaotaHTTPS   bool
	BaotaSSLCert string // 覆盖全局 BAOTA_SSL_CERT_NAME，可为空
}

func StartSyncer(app *ServerApp) {
	log.Printf("同步引擎启动 (间隔: %v)...", app.Cfg().SyncInterval)
	for {
		cfg := app.Cfg()
		if !cfg.IngressBaotaSyncEnabled {
			<-time.After(cfg.SyncInterval)
			continue
		}
		k8s := app.K8s()
		if k8s != nil && strings.TrimSpace(cfg.BaotaURL) != "" && strings.TrimSpace(cfg.BaotaAPIKey) != "" {
			syncOnce(k8s, cfg)
		} else if cfg.IngressBaotaSyncEnabled {
			log.Printf("跳过 Ingress↔宝塔同步：K8s 或宝塔未配置完整")
		}
		<-time.After(cfg.SyncInterval)
	}
}

func syncOnce(clientset *kubernetes.Clientset, cfg Config) {
	ingresses, err := clientset.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		log.Printf("获取 Ingress 失败: %v", err)
		return
	}

	var targets []ProxyTarget
	for _, ing := range ingresses.Items {
		if !IsManagedIngress(ing.Annotations) {
			continue
		}
		targetPort := cfg.DefaultPort
		if customPort, hasCustom := ing.Annotations["i4t.com/ddns-port"]; hasCustom && customPort != "" {
			targetPort = customPort
		} else if customPort, hasCustom := ing.Annotations["kube-bt-sync.io/ddns-port"]; hasCustom && customPort != "" {
			targetPort = customPort
		}

		https, sslCert := BaotaHTTPSFromAnnotations(ing.Annotations)
		targetURL := fmt.Sprintf("http://%s:%s", cfg.DDNSHost, targetPort)
		for _, rule := range ing.Spec.Rules {
			if rule.Host != "" {
				targets = append(targets, ProxyTarget{
					Domain:       rule.Host,
					TargetURL:    targetURL,
					BaotaHTTPS:   https,
					BaotaSSLCert: sslCert,
				})
			}
		}
	}

	for _, target := range targets {
		ensureBaotaSiteAndProxy(cfg, target)
		if target.BaotaHTTPS {
			if err := EnsureBaotaHTTPS(cfg, target.Domain, target.BaotaSSLCert); err != nil {
				log.Printf("[%s] 宝塔 HTTPS: %v", target.Domain, err)
			}
		}
	}
}

func ensureBaotaSiteAndProxy(cfg Config, target ProxyTarget) {
	webnameMap := map[string]interface{}{"domain": target.Domain, "domainlist": []string{}, "count": 0}
	webnameJSON, _ := json.Marshal(webnameMap)

	_, err := CallBaotaAPI(cfg, "/site?action=AddSite", map[string]string{
		"webname": string(webnameJSON),
		"path":    "/www/wwwroot/" + target.Domain,
		"type_id": "0", "type": "PHP", "version": "00", "port": "80",
		"ps": "[kube-bt-sync]",
	})
	if err != nil && !IsBaotaAlreadyExists(err) {
		log.Printf("[%s] AddSite: %v", target.Domain, err)
	}

	proxyName := ProxyNameForDomain(target.Domain)
	_, err = CallBaotaAPI(cfg, "/proxy?action=CreateProxy", map[string]string{
		"proxysite": target.Domain,
		"proxyname": proxyName,
		"todomain":  target.TargetURL, "proxydir": "/", "type": "1",
		"tohost": "$host", "advanced": "0", "cache": "0", "cachetime": "1",
	})
	if err != nil && !IsBaotaAlreadyExists(err) {
		log.Printf("[%s] 反代下发异常: %v", target.Domain, err)
	}
}

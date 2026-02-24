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
	Domain    string
	TargetURL string
}

func StartSyncer(k8sClient *kubernetes.Clientset, cfg Config) {
	log.Printf("同步引擎启动 (间隔: %v)...", cfg.SyncInterval)
	for {
		syncOnce(k8sClient, cfg)
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
		if val, ok := ing.Annotations["i4t.com/baota-sync"]; ok && val == "true" {
			targetPort := cfg.DefaultPort
			if customPort, hasCustom := ing.Annotations["i4t.com/ddns-port"]; hasCustom && customPort != "" {
				targetPort = customPort
			}

			targetURL := fmt.Sprintf("http://%s:%s", cfg.DDNSHost, targetPort)
			for _, rule := range ing.Spec.Rules {
				if rule.Host != "" {
					targets = append(targets, ProxyTarget{Domain: rule.Host, TargetURL: targetURL})
				}
			}
		}
	}

	for _, target := range targets {
		ensureBaotaSiteAndProxy(cfg, target)
	}
}

func ensureBaotaSiteAndProxy(cfg Config, target ProxyTarget) {
	webnameMap := map[string]interface{}{"domain": target.Domain, "domainlist": []string{}, "count": 0}
	webnameJSON, _ := json.Marshal(webnameMap)
	
	CallBaotaAPI(cfg, "/site?action=AddSite", map[string]string{
		"webname": string(webnameJSON),
		"path":    "/www/wwwroot/" + target.Domain,
		"type_id": "0", "type": "PHP", "version": "00", "port": "80",
		"ps":      "[kube-bt-sync]", // 修改为新的标识
	})

	_, err := CallBaotaAPI(cfg, "/proxy?action=CreateProxy", map[string]string{
		"proxysite": target.Domain, "proxyname": "k8s-ingress-proxy",
		"todomain":  target.TargetURL, "proxydir": "/", "type": "1",
		"tohost":    "$host", "advanced": "0", "cache": "0", "cachetime": "1",
	})
	
	if err != nil && !strings.Contains(err.Error(), "已存在") {
		log.Printf("[%s] 反代下发异常: %v", target.Domain, err)
	}
}
package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ProxyTarget struct {
	Domain    string
	TargetURL string
}

var syncedCache = make(map[string]string)
var cacheMutex sync.RWMutex
var syncExecutionMutex sync.Mutex

func StartSyncer(k8sClient *kubernetes.Clientset, cfg Config) {
	log.Printf("同步引擎启动 (间隔: %v)...", cfg.SyncInterval)
	for {
		syncOnce(k8sClient, cfg)
		<-time.After(cfg.SyncInterval)
	}
}

func TriggerSync(k8sClient *kubernetes.Clientset, cfg Config) {
	go syncOnce(k8sClient, cfg)
}

func GetSyncStatus(domain string, expectedURL string) string {
	cacheMutex.RLock()
	defer cacheMutex.RUnlock()
	if cachedURL, ok := syncedCache[domain]; ok {
		if cachedURL == expectedURL {
			return "✅ 已同步"
		}
	}
	return "⏳ 同步中..."
}

func syncOnce(clientset *kubernetes.Clientset, cfg Config) {
	if !syncExecutionMutex.TryLock() {
		return 
	}
	defer syncExecutionMutex.Unlock()

	// 1. 获取宝塔所有存量站点，用于反向同步 (宝塔删除 -> 触发K8s删除)
	baotaSites := make(map[string]bool)
	baotaFetchSuccess := false
	resp, err := CallBaotaAPI(cfg, "/data?action=getData", map[string]string{"table": "sites", "limit": "1000"})
	if err == nil {
		var res map[string]interface{}
		if json.Unmarshal([]byte(resp), &res) == nil {
			if dataArr, ok := res["data"].([]interface{}); ok {
				baotaFetchSuccess = true
				for _, item := range dataArr {
					if site, ok := item.(map[string]interface{}); ok {
						if name, ok := site["name"].(string); ok {
							baotaSites[name] = true
						}
					}
				}
			}
		}
	}

	ingresses, err := clientset.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		log.Printf("获取 Ingress 失败: %v", err)
		return
	}

	var targets []ProxyTarget
	currentDomains := make(map[string]bool)

	for _, ing := range ingresses.Items {
		if val, ok := ing.Annotations["kube-bt-sync.io/baota-sync"]; ok && val == "true" {
			targetPort := cfg.DefaultPort
			if customPort, hasCustom := ing.Annotations["kube-bt-sync.io/ddns-port"]; hasCustom && customPort != "" {
				targetPort = customPort
			}

			targetURL := fmt.Sprintf("http://%s:%s", cfg.DDNSHost, targetPort)
			for _, rule := range ing.Spec.Rules {
				if rule.Host != "" {
					// 【核心升级】双向强一致性检测：之前同步成功过，但现在宝塔没这个站了！
					cacheMutex.RLock()
					_, existsInCache := syncedCache[rule.Host]
					cacheMutex.RUnlock()

					if existsInCache && baotaFetchSuccess && !baotaSites[rule.Host] {
						log.Printf("[%s] 🚨 检测到宝塔端已删除该站点，触发反向同步清理 K8s Ingress...", rule.Host)
						clientset.NetworkingV1().Ingresses(ing.Namespace).Delete(context.TODO(), ing.Name, metav1.DeleteOptions{})
						
						cacheMutex.Lock()
						delete(syncedCache, rule.Host)
						cacheMutex.Unlock()
						continue // 已经被删了，跳过本次处理
					}

					targets = append(targets, ProxyTarget{Domain: rule.Host, TargetURL: targetURL})
					currentDomains[rule.Host] = true
				}
			}
		}
	}

	for _, target := range targets {
		cacheMutex.RLock()
		cachedURL, exists := syncedCache[target.Domain]
		cacheMutex.RUnlock()

		if exists && cachedURL == target.TargetURL {
			continue 
		}

		success := ensureBaotaSiteAndProxy(cfg, target)
		if success {
			cacheMutex.Lock()
			syncedCache[target.Domain] = target.TargetURL
			cacheMutex.Unlock()
		} else {
			cacheMutex.Lock()
			delete(syncedCache, target.Domain)
			cacheMutex.Unlock()
		}
	}

	cacheMutex.Lock()
	for domain := range syncedCache {
		if !currentDomains[domain] {
			delete(syncedCache, domain)
		}
	}
	cacheMutex.Unlock()
}

func ensureBaotaSiteAndProxy(cfg Config, target ProxyTarget) bool {
	webnameMap := map[string]interface{}{"domain": target.Domain, "domainlist": []string{}, "count": 0}
	webnameJSON, _ := json.Marshal(webnameMap)

	CallBaotaAPI(cfg, "/site?action=AddSite", map[string]string{
		"webname": string(webnameJSON),
		"path":    "/www/wwwroot/" + target.Domain,
		"type_id": "0", "type": "PHP", "version": "00", "port": "80",
		"ps":      "[kube-bt-sync]",
	})

	resp, err := CallBaotaAPI(cfg, "/site?action=CreateProxy", map[string]string{
		"sitename":  target.Domain,
		"proxyname": "kube-bt-sync-proxy",
		"proxydir":  "/",
		"proxysite": target.TargetURL,
		"todomain":  "$host",
		"advanced":  "0",
		"cache":     "0",
		"cachetime": "1",
		"type":      "1",
		"subfilter": `[{"sub1":"","sub2":""},{"sub1":"","sub2":""},{"sub1":"","sub2":""}]`, 
	})

	if err != nil {
		log.Printf("[%s] 反代请求发送失败: %v", target.Domain, err)
		return false
	} else if strings.Contains(resp, "已存在") {
		return true
	} else if strings.Contains(resp, "错误") || strings.Contains(resp, "失败") || strings.Contains(resp, "error") {
		log.Printf("[%s] 宝塔API拒绝了反代请求: %s", target.Domain, resp)
		return false
	}

	log.Printf("[%s] 反向代理配置成功同步！目标: %s", target.Domain, target.TargetURL)
	return true
}

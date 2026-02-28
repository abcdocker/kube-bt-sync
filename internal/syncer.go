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
// 【新增】专门用于存放实时执行进度的缓存字典
var progressCache = make(map[string]string) 
var cacheMutex sync.RWMutex
var syncExecutionMutex sync.Mutex

var loopCount int64 = 0

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

// 【升级】状态查询逻辑：优先展示实时进度，如果没有进度再查是否已同步
func GetSyncStatus(domain string, expectedURL string) string {
	cacheMutex.RLock()
	defer cacheMutex.RUnlock()
	
	// 1. 如果有正在执行的进度，优先展示动态进度
	if progress, ok := progressCache[domain]; ok && progress != "" {
		return progress
	}
	
	// 2. 如果没有进度，说明执行完了，检查结果
	if cachedURL, ok := syncedCache[domain]; ok {
		if cachedURL == expectedURL {
			return "✅ 已同步"
		}
	}
	return "⏳ 等待处理队列中..."
}

// 辅助方法：快速更新并暴露进度
func updateProgress(domain string, msg string) {
	cacheMutex.Lock()
	if msg == "" {
		delete(progressCache, domain) // 清理进度
	} else {
		progressCache[domain] = msg
	}
	cacheMutex.Unlock()
}

func syncOnce(clientset *kubernetes.Clientset, cfg Config) {
	if !syncExecutionMutex.TryLock() { return }
	defer syncExecutionMutex.Unlock()

	loopCount++
	shouldDeepCheck := (loopCount == 1 || loopCount%10 == 0)

	baotaSites := make(map[string]bool)
	baotaFetchSuccess := false

	if shouldDeepCheck {
		resp, err := CallBaotaAPI(cfg, "/data?action=getData", map[string]string{"table": "sites", "limit": "1000"})
		if err == nil {
			var res map[string]interface{}
			if json.Unmarshal([]byte(resp), &res) == nil {
				if dataArr, ok := res["data"].([]interface{}); ok {
					baotaFetchSuccess = true
					for _, item := range dataArr {
						if site, ok := item.(map[string]interface{}); ok {
							if name, ok := site["name"].(string); ok { baotaSites[name] = true }
						}
					}
				}
			}
		}
	}

	ingresses, err := clientset.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	if err != nil { return }

	var targets []ProxyTarget
	currentDomains := make(map[string]bool)

	for _, ing := range ingresses.Items {
		if val, ok := ing.Annotations["kube-bt-sync.io/baota-sync"]; ok && val == "true" {
			targetPort := cfg.DefaultPort
			if customPort, hasCustom := ing.Annotations["kube-bt-sync.io/ddns-port"]; hasCustom && customPort != "" { targetPort = customPort }

			targetURL := fmt.Sprintf("http://%s:%s", cfg.DDNSHost, targetPort)
			for _, rule := range ing.Spec.Rules {
				if rule.Host != "" {
					cacheMutex.RLock()
					_, existsInCache := syncedCache[rule.Host]
					cacheMutex.RUnlock()

					if shouldDeepCheck && existsInCache && baotaFetchSuccess && !baotaSites[rule.Host] {
						updateProgress(rule.Host, "⏳ 宝塔端缺失，正在反向清理 K8s...")
						clientset.NetworkingV1().Ingresses(ing.Namespace).Delete(context.TODO(), ing.Name, metav1.DeleteOptions{})
						cacheMutex.Lock()
						delete(syncedCache, rule.Host)
						cacheMutex.Unlock()
						updateProgress(rule.Host, "") // 清除进度
						continue
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

		if exists && cachedURL == target.TargetURL { continue }

		// 【核心升级】执行带实时进度反馈的底层操作
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
		
		// 无论成功失败，结束时清空该域名的进度条显示
		updateProgress(target.Domain, "")
	}

	cacheMutex.Lock()
	for domain := range syncedCache {
		if !currentDomains[domain] { delete(syncedCache, domain) }
	}
	cacheMutex.Unlock()
}

func ensureBaotaSiteAndProxy(cfg Config, target ProxyTarget) bool {
	webnameMap := map[string]interface{}{"domain": target.Domain, "domainlist": []string{}, "count": 0}
	webnameJSON, _ := json.Marshal(webnameMap)

	// 👉 进度 1
	updateProgress(target.Domain, "⏳ [1/2] 正在调用 API 创建站点...")
	CallBaotaAPI(cfg, "/site?action=AddSite", map[string]string{
		"webname": string(webnameJSON),
		"path":    "/www/wwwroot/" + target.Domain,
		"type_id": "0", "type": "PHP", "version": "00", "port": "80",
		"ps":      "[kube-bt-sync]",
	})

	// 👉 进度 2：展示节流等待状态
	updateProgress(target.Domain, "⏳ 防抖缓冲中 (防止 Nginx 假死)...")
	time.Sleep(1500 * time.Millisecond)

	// 👉 进度 3
	updateProgress(target.Domain, "⏳ [2/2] 正在注入后端反向代理规则...")
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
		updateProgress(target.Domain, "❌ 反代请求发送失败")
		time.Sleep(2 * time.Second) // 停留两秒让用户看清报错
		return false
	} else if strings.Contains(resp, "错误") || strings.Contains(resp, "失败") || strings.Contains(resp, "error") {
		updateProgress(target.Domain, "❌ 宝塔 API 拒绝请求")
		time.Sleep(2 * time.Second)
		return false
	}

	// 👉 进度 4：收尾冷却期
	updateProgress(target.Domain, "⏳ 触发面板平滑重载 (冷却 3s)...")
	time.Sleep(3 * time.Second)

	return true
}

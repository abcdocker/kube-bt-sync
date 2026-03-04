package internal

import (
	"context"
	"log"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// StartIngressWatcher 启动纯事件驱动的监听器
func StartIngressWatcher(k8sClient *kubernetes.Clientset, cfg Config) {
	log.Println("👀 K8s 事件雷达已开启，正在静默监听 Ingress 变动...")

	for {
		// 监听所有 Namespace 下的 Ingress
		watcher, err := k8sClient.NetworkingV1().Ingresses("").Watch(context.TODO(), metav1.ListOptions{})
		if err != nil {
			log.Printf("❌ 监听 Ingress 失败，5秒后重试: %v\n", err)
			time.Sleep(5 * time.Second)
			continue
		}

		// 处理管道中源源不断涌来的事件
		for event := range watcher.ResultChan() {
			ing, ok := event.Object.(*networkingv1.Ingress)
			if !ok {
				continue
			}

			// 严格过滤：只处理带有我们特有 Annotation 的 Ingress
			if val, ok := ing.Annotations["kube-bt-sync.io/baota-sync"]; !ok || val != "true" {
				continue
			}

			switch event.Type {
			case "ADDED":
				log.Printf("✨ [事件拦截] 检测到新增 Ingress [%s/%s]，触发一次性同步...", ing.Namespace, ing.Name)
				TriggerSync(k8sClient, cfg)
			case "MODIFIED":
				log.Printf("🔄 [事件拦截] 检测到修改 Ingress [%s/%s]，触发一次性同步...", ing.Namespace, ing.Name)
				TriggerSync(k8sClient, cfg)
			case "DELETED":
				log.Printf("🗑️ [事件拦截] 检测到删除 Ingress [%s/%s]，已解除监控", ing.Namespace, ing.Name)
			}
		}

		// K8s API Server 可能会因为超时切断 Watch 连接，静默重连
		time.Sleep(2 * time.Second)
	}
}

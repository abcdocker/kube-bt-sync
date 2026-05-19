package internal

import (
	"context"
	"log"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StartIngressWatcher 启动纯事件驱动的监听器（main 中默认未调用，可自行 go StartIngressWatcher(ctx, app)）。
func StartIngressWatcher(ctx context.Context, app *ServerApp) {
	if app == nil || app.K8s() == nil {
		return
	}
	k8sClient := app.K8s()
	log.Println("ingress-watcher: K8s Ingress Watch 已启动")

	for {
		if ctx.Err() != nil {
			log.Println("ingress-watcher: 已停止")
			return
		}
		watcher, err := k8sClient.NetworkingV1().Ingresses("").Watch(ctx, metav1.ListOptions{})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("ingress-watcher: Watch 失败，5s 后重试: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		for {
			select {
			case <-ctx.Done():
				watcher.Stop()
				log.Println("ingress-watcher: 已停止")
				return
			case event, open := <-watcher.ResultChan():
				if !open {
					watcher.Stop()
					goto reconnect
				}
				ing, ingOK := event.Object.(*networkingv1.Ingress)
				if !ingOK {
					continue
				}

				if !IsManagedIngress(ing.Annotations) {
					continue
				}

				switch event.Type {
				case "ADDED":
					log.Printf("ingress-watcher: ADDED %s/%s，触发同步", ing.Namespace, ing.Name)
					TriggerSync(app)
				case "MODIFIED":
					log.Printf("ingress-watcher: MODIFIED %s/%s，触发同步", ing.Namespace, ing.Name)
					TriggerSync(app)
				case "DELETED":
					log.Printf("ingress-watcher: DELETED %s/%s", ing.Namespace, ing.Name)
				}
			}
		}
	reconnect:
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

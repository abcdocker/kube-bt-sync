package main

import (
	"log"
	"kube-bt-sync/internal" // 引用模块
)

func main() {
	log.Println(">>> 初始化 kube-bt-sync 环境...")
	cfg := internal.LoadConfig()

	log.Println(">>> 连接 K8s 集群...")
	k8sClient := internal.InitK8sClient()

	// 🌟 核心升级：废弃定时轮询，启动纯事件驱动的 K8s Watcher 雷达
	go internal.StartIngressWatcher(k8sClient, cfg)
	
	internal.StartWebServer(k8sClient, cfg)
}

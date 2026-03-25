package main

import (
	"kube-bt-sync/internal" // 引用模块
	"log"
)

func main() {
	log.Println(">>> 初始化 kube-bt-sync 环境...")
	app, err := internal.NewServerApp(internal.DataDirFromEnv())
	if err != nil {
		log.Fatalf("加载应用状态失败: %v", err)
	}
	if app.Initialized() {
		if err := app.Cfg().Validate(); err != nil {
			log.Fatalf("配置校验失败: %v", err)
		}
	} else {
		log.Printf(">>> 尚未完成向导初始化，请浏览器访问 /setup；数据目录: %s", app.DataDir())
	}
	if app.Cfg().BaotaSkipTLSVerify {
		log.Println(">>> 宝塔 API 使用 HTTPS 且已跳过 TLS 证书校验（自签/证书与 IP 不一致时可用；正规证书可设 BAOTA_SKIP_TLS_VERIFY=false）")
	}

	if app.K8s() == nil {
		log.Println(">>> K8s 客户端未就绪（未完成向导或集群不可达）")
	} else {
		log.Println(">>> K8s 客户端已连接")
	}

	go internal.StartSyncer(app)
	internal.StartWebServer(app)
}

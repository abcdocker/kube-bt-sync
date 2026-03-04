package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml"
)

type YamlRequest struct {
	YamlContent string `json:"yamlContent" binding:"required"`
}

type DeleteRequest struct {
	Namespace   string `json:"namespace" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Domain      string `json:"domain" binding:"required"`
	DeleteBaota bool   `json:"deleteBaota"`
}

func StartWebServer(k8sClient *kubernetes.Clientset, cfg Config) {
	r := gin.Default()

	authUser := os.Getenv("AUTH_USER")
	authPass := os.Getenv("AUTH_PASSWORD")
	if authUser != "" && authPass != "" {
		r.Use(gin.BasicAuth(gin.Accounts{authUser: authPass}))
		log.Printf("🔒 Web 控制台已开启安全认证")
	}

	r.Delims("[[", "]]")
	r.LoadHTMLGlob("templates/*")

	r.GET("/", func(c *gin.Context) { c.HTML(http.StatusOK, "index.html", nil) })

	api := r.Group("/api")
	{
		api.GET("/status", func(c *gin.Context) { handleGetStatus(c, k8sClient, cfg) })
		api.POST("/ingress/yaml", func(c *gin.Context) { handleApplyYaml(c, k8sClient, cfg) })
		api.POST("/ingress/delete", func(c *gin.Context) { handleDeleteIngress(c, k8sClient, cfg) })
		api.GET("/system/check", func(c *gin.Context) { handleSystemCheck(c, k8sClient, cfg) })
		api.GET("/namespaces", func(c *gin.Context) { handleGetNamespaces(c, k8sClient) })
		api.GET("/services", func(c *gin.Context) { handleGetServices(c, k8sClient) })
		api.GET("/ingress/raw", func(c *gin.Context) { handleGetRawIngress(c, k8sClient) })
	}

	log.Println("kube-bt-sync Dashboard 已启动，监听 :8080")
	r.Run(":8080")
}

func handleGetRawIngress(c *gin.Context, k8sClient *kubernetes.Clientset) {
	ns := c.Query("ns")
	name := c.Query("name")
	ing, err := k8sClient.NetworkingV1().Ingresses(ns).Get(context.TODO(), name, metav1.GetOptions{})
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }

	ing.ManagedFields = nil
	ing.Status = networkingv1.IngressStatus{}
	ing.ResourceVersion = ""
	ing.UID = ""
	ing.CreationTimestamp = metav1.Time{}
	ing.Generation = 0

	yamlData, err := yaml.Marshal(ing)
	if err != nil { c.JSON(500, gin.H{"error": "YAML 转换失败"}); return }
	c.String(200, string(yamlData))
}

func handleDeleteIngress(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	var req DeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil { c.JSON(400, gin.H{"error": "参数解析失败"}); return }

	if req.DeleteBaota {
		resp, err := CallBaotaAPI(cfg, "/data?action=getData", map[string]string{"table": "sites", "search": req.Domain})
		if err == nil {
			var siteData struct { Data []struct { Id int `json:"id"`; Name string `json:"name"` } `json:"data"` }
			if json.Unmarshal([]byte(resp), &siteData) == nil {
				for _, site := range siteData.Data {
					if site.Name == req.Domain {
						CallBaotaAPI(cfg, "/site?action=DeleteSite", map[string]string{"id": fmt.Sprintf("%d", site.Id), "webname": req.Domain})
						break
					}
				}
			}
		}
	}

	err := k8sClient.NetworkingV1().Ingresses(req.Namespace).Delete(context.TODO(), req.Name, metav1.DeleteOptions{})
	if err != nil { c.JSON(500, gin.H{"error": "删除 K8s Ingress 失败: " + err.Error()}); return }
	c.JSON(200, gin.H{"message": "路由删除成功！"})
}

func handleSystemCheck(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	baotaStatus, baotaMsg := "success", "连接成功"
	resp, err := CallBaotaAPI(cfg, "/system?action=GetSystemTotal", map[string]string{})
	if err != nil {
		baotaMsg, baotaStatus = "网络连通失败: "+err.Error(), "error"
	} else if strings.Contains(resp, "API校验失败") || strings.Contains(resp, "IP不在白名单") {
		baotaMsg, baotaStatus = "API 密钥错误或未加入白名单", "error"
	}

	ingressInstalled, metallbInstalled := false, false
	deployments, _ := k8sClient.AppsV1().Deployments("").List(context.TODO(), metav1.ListOptions{})
	for _, deploy := range deployments.Items {
		if strings.Contains(deploy.Name, "ingress-nginx") { ingressInstalled = true }
		if strings.Contains(deploy.Name, "metallb") { metallbInstalled = true }
	}
	daemonsets, _ := k8sClient.AppsV1().DaemonSets("").List(context.TODO(), metav1.ListOptions{})
	for _, ds := range daemonsets.Items {
		if strings.Contains(ds.Name, "ingress-nginx") { ingressInstalled = true }
		if strings.Contains(ds.Name, "metallb") { metallbInstalled = true }
	}

	var nodeIP string
	nodes, err := k8sClient.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{})
	if err == nil && len(nodes.Items) > 0 {
		for _, addr := range nodes.Items[0].Status.Addresses {
			if addr.Type == "InternalIP" { nodeIP = addr.Address; break }
		}
	}

	// 🌟 动态获取 HTTPS 端口，默认 443
	httpsPort := os.Getenv("HTTPS_PORT")
	if httpsPort == "" {
		httpsPort = "443"
	}

	ddnsStatus, ddnsMsg := "error", "未配置 DDNS 域名或解析失败"
	var resolvedIPs []string
	cleanDDNS := strings.Split(strings.TrimPrefix(strings.TrimPrefix(cfg.DDNSHost, "http://"), "https://"), ":")[0]
	port443Status := false 

	if cleanDDNS != "" {
		ips, err := net.LookupIP(cleanDDNS)
		if err == nil {
			for _, ip := range ips { if ipv4 := ip.To4(); ipv4 != nil { resolvedIPs = append(resolvedIPs, ipv4.String()) } }
			if len(resolvedIPs) > 0 {
				conn, dialErr := net.DialTimeout("tcp", fmt.Sprintf("%s:%s", cleanDDNS, cfg.DefaultPort), 2*time.Second)
				if dialErr == nil {
					conn.Close()
					ddnsStatus, ddnsMsg = "success", fmt.Sprintf("主穿透端口 (%s) 正常", cfg.DefaultPort)
				} else {
					ddnsStatus, ddnsMsg = "warning", fmt.Sprintf("解析生效，但 TCP 端口 %s 不通", cfg.DefaultPort)
				}
				
				// 🌟 使用动态获取的 HTTPS 端口进行探活
				conn443, err443 := net.DialTimeout("tcp", fmt.Sprintf("%s:%s", cleanDDNS, httpsPort), 2*time.Second)
				if err443 == nil {
					conn443.Close()
					port443Status = true
				}
			}
		}
	}

	c.JSON(200, gin.H{
		"baota": gin.H{"status": baotaStatus, "msg": baotaMsg, "url": cfg.BaotaURL},
		"k8s":   gin.H{"ingressInstalled": ingressInstalled, "metallbInstalled": metallbInstalled, "nodeIP": nodeIP},
		// 🌟 将 httpsPort 传递给前端
		"ddns":  gin.H{"status": ddnsStatus, "msg": ddnsMsg, "host": cfg.DDNSHost, "ips": resolvedIPs, "port443": port443Status, "httpsPort": httpsPort},
	})
}

func handleGetStatus(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	ingresses, _ := k8sClient.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	var result []map[string]interface{}
	for _, ing := range ingresses.Items {
		if val, ok := ing.Annotations["kube-bt-sync.io/baota-sync"]; ok && val == "true" {
			port := cfg.DefaultPort
			if cp, ok := ing.Annotations["kube-bt-sync.io/ddns-port"]; ok && cp != "" { port = cp }
			domain := "N/A"
			if len(ing.Spec.Rules) > 0 { domain = ing.Spec.Rules[0].Host }

			scheme := "http"
			if len(ing.Spec.TLS) > 0 { scheme = "https" }

			modifiedAt := ing.CreationTimestamp.Format("2006-01-02 15:04:05")
			if mod, ok := ing.Annotations["kube-bt-sync.io/last-modified"]; ok { modifiedAt = mod }

			result = append(result, map[string]interface{}{
				"namespace": ing.Namespace, "name": ing.Name, "domain": domain,
				"scheme": scheme, "ddnsPort": port, 
				"createdAt": ing.CreationTimestamp.Format("2006-01-02 15:04:05"),
				"modifiedAt": modifiedAt,
				"version": ing.ResourceVersion,
				"status": "🟢 已下发 (事件守护中)",
			})
		}
	}
	c.JSON(200, result)
}

func handleGetNamespaces(c *gin.Context, k8sClient *kubernetes.Clientset) {
	nsList, _ := k8sClient.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
	var result []string
	for _, ns := range nsList.Items { result = append(result, ns.Name) }
	c.JSON(200, result)
}

func handleGetServices(c *gin.Context, k8sClient *kubernetes.Clientset) {
	services, _ := k8sClient.CoreV1().Services("").List(context.TODO(), metav1.ListOptions{})
	var result []map[string]interface{}
	for _, svc := range services.Items {
		var ports []int32
		for _, p := range svc.Spec.Ports { ports = append(ports, p.Port) }
		ip := svc.Spec.ClusterIP
		if len(svc.Status.LoadBalancer.Ingress) > 0 { ip = svc.Status.LoadBalancer.Ingress[0].IP }
		result = append(result, map[string]interface{}{"name": svc.Name, "namespace": svc.Namespace, "ports": ports, "ip": ip})
	}
	c.JSON(200, result)
}

func handleApplyYaml(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	var req YamlRequest
	if err := c.ShouldBindJSON(&req); err != nil { c.JSON(400, gin.H{"error": "参数解析失败"}); return }

	var ingress networkingv1.Ingress
	if err := yaml.Unmarshal([]byte(req.YamlContent), &ingress); err != nil { c.JSON(400, gin.H{"error": "YAML 格式错误"}); return }
	if ingress.Namespace == "" { ingress.Namespace = "default" }

	if ingress.Annotations == nil { ingress.Annotations = make(map[string]string) }
	ingress.Annotations["kube-bt-sync.io/last-modified"] = time.Now().Format("2006-01-02 15:04:05")

	client := k8sClient.NetworkingV1().Ingresses(ingress.Namespace)
	existing, err := client.Get(context.TODO(), ingress.Name, metav1.GetOptions{})

	if err == nil {
		ingress.ResourceVersion = existing.ResourceVersion
		_, err = client.Update(context.TODO(), &ingress, metav1.UpdateOptions{})
	} else {
		_, err = client.Create(context.TODO(), &ingress, metav1.CreateOptions{})
	}

	if err != nil { c.JSON(500, gin.H{"error": "K8s 操作失败: " + err.Error()}); return }
	c.JSON(200, gin.H{"message": "配置下发/修改成功！事件监听器已接管同步..."})
}

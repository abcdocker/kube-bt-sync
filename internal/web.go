package internal

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml" // K8s 官方 YAML 库
)

type YamlRequest struct {
	YamlContent string `json:"yamlContent" binding:"required"`
}

func StartWebServer(k8sClient *kubernetes.Clientset, cfg Config) {
	r := gin.Default()
	r.LoadHTMLGlob("templates/*")

	r.GET("/", func(c *gin.Context) { c.HTML(http.StatusOK, "index.html", nil) })

	api := r.Group("/api")
	{
		api.GET("/status", func(c *gin.Context) { handleGetStatus(c, k8sClient, cfg) })
		api.POST("/ingress/yaml", func(c *gin.Context) { handleApplyYaml(c, k8sClient) })
	}

	log.Println("kube-bt-sync Dashboard 已启动，监听 :8080")
	r.Run(":8080")
}

func handleGetStatus(c *gin.Context, k8sClient *kubernetes.Clientset, cfg Config) {
	ingresses, _ := k8sClient.NetworkingV1().Ingresses("").List(context.TODO(), metav1.ListOptions{})
	var result []map[string]interface{}
	for _, ing := range ingresses.Items {
		if val, ok := ing.Annotations["i4t.com/baota-sync"]; ok && val == "true" {
			port := cfg.DefaultPort
			if cp, ok := ing.Annotations["i4t.com/ddns-port"]; ok && cp != "" { port = cp }
			domain := "N/A"
			if len(ing.Spec.Rules) > 0 { domain = ing.Spec.Rules[0].Host }
			
			result = append(result, map[string]interface{}{
				"namespace": ing.Namespace, "name": ing.Name, "domain": domain,
				"ddnsPort": port, "createdAt": ing.CreationTimestamp.Format("2006-01-02 15:04:05"),
				"status": "已托管",
			})
		}
	}
	c.JSON(200, result)
}

// 处理前端发来的纯 YAML 字符串
func handleApplyYaml(c *gin.Context, k8sClient *kubernetes.Clientset) {
	var req YamlRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "参数解析失败: " + err.Error()})
		return
	}

	// 1. 将 YAML 解析为 K8s 的 Ingress 结构体
	var ingress networkingv1.Ingress
	if err := yaml.Unmarshal([]byte(req.YamlContent), &ingress); err != nil {
		c.JSON(400, gin.H{"error": "YAML 格式错误: " + err.Error()})
		return
	}

	if ingress.Namespace == "" {
		ingress.Namespace = "default"
	}

	// 2. 与 K8s API 交互 (获取现有的资源版本，以支持 Update)
	client := k8sClient.NetworkingV1().Ingresses(ingress.Namespace)
	existing, err := client.Get(context.TODO(), ingress.Name, metav1.GetOptions{})
	
	if err == nil {
		// 存在则更新，必须带上旧的 ResourceVersion
		ingress.ResourceVersion = existing.ResourceVersion
		_, err = client.Update(context.TODO(), &ingress, metav1.UpdateOptions{})
	} else {
		// 不存在则创建
		_, err = client.Create(context.TODO(), &ingress, metav1.CreateOptions{})
	}

	if err != nil {
		c.JSON(500, gin.H{"error": "K8s 操作失败: " + err.Error()})
		return
	}

	c.JSON(200, gin.H{"message": "YAML 资源已成功应用到 K8s 集群！"})
}
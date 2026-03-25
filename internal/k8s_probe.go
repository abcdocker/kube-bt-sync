package internal

import (
	"context"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// DetectMetalLBNamespace 是否安装了 MetalLB：常见为 metallb-system，部分 chart 使用 metallb 等前缀。
func DetectMetalLBNamespace(k8sClient *kubernetes.Clientset) bool {
	list, err := k8sClient.CoreV1().Namespaces().List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return false
	}
	for _, n := range list.Items {
		name := n.Name
		if name == "metallb-system" || name == "metallb" {
			return true
		}
		if strings.HasPrefix(name, "metallb-") {
			return true
		}
	}
	return false
}

// DetectIngressController 是否可能存在 Ingress 实现：优先 IngressClass（通用），再扫常见控制器工作负载。
func DetectIngressController(k8sClient *kubernetes.Clientset) bool {
	if hasIngressClasses(k8sClient) {
		return true
	}
	if hasIngressLikeDaemonSet(k8sClient) {
		return true
	}
	if hasIngressLikeDeployment(k8sClient) {
		return true
	}
	return false
}

func hasIngressClasses(k8sClient *kubernetes.Clientset) bool {
	list, err := k8sClient.NetworkingV1().IngressClasses().List(context.TODO(), metav1.ListOptions{})
	return err == nil && len(list.Items) > 0
}

func hasIngressLikeDaemonSet(k8sClient *kubernetes.Clientset) bool {
	list, err := k8sClient.AppsV1().DaemonSets("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return false
	}
	for _, d := range list.Items {
		if workloadLooksLikeIngressController(d.Namespace, d.Name) {
			return true
		}
	}
	return false
}

func hasIngressLikeDeployment(k8sClient *kubernetes.Clientset) bool {
	list, err := k8sClient.AppsV1().Deployments("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return false
	}
	for _, d := range list.Items {
		if workloadLooksLikeIngressController(d.Namespace, d.Name) {
			return true
		}
	}
	return false
}

func workloadLooksLikeIngressController(namespace, name string) bool {
	ns := strings.ToLower(namespace)
	ln := strings.ToLower(name)
	// ingress-nginx 常见：Deployment 或 DaemonSet
	if ns == "ingress-nginx" && (strings.Contains(ln, "controller") || strings.Contains(ln, "nginx")) {
		return true
	}
	if strings.Contains(ln, "ingress-nginx") || strings.Contains(ln, "nginx-ingress") {
		return true
	}
	// 其他常见 Ingress / Gateway 控制器
	keywords := []string{
		"traefik", "haproxy-ingress", "haproxyingress", "kong", "kong-gateway",
		"contour", "emissary", "ambassador", "istio-ingress", "istio-gateway",
		"cilium-ingress", "gloo", "nginxinc", "openresty",
	}
	for _, k := range keywords {
		if strings.Contains(ln, k) {
			return true
		}
	}
	// 泛化：*ingress*controller*（避免误报过多：要求同时含 ingress 与 controller）
	if strings.Contains(ln, "ingress") && strings.Contains(ln, "controller") {
		return true
	}
	return false
}

// FirstNodeIPPreferInternal 展示用节点 IP：优先内网，无则外网。
func FirstNodeIPPreferInternal(k8sClient *kubernetes.Clientset) string {
	nodes, err := k8sClient.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{})
	if err != nil || len(nodes.Items) == 0 {
		return ""
	}
	for _, node := range nodes.Items {
		for _, addr := range node.Status.Addresses {
			if addr.Type == corev1.NodeInternalIP && addr.Address != "" {
				return addr.Address
			}
		}
	}
	for _, node := range nodes.Items {
		for _, addr := range node.Status.Addresses {
			if addr.Type == corev1.NodeExternalIP && addr.Address != "" {
				return addr.Address
			}
		}
	}
	return ""
}

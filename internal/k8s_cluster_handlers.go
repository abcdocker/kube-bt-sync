package internal

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/fields"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	sigyaml "sigs.k8s.io/yaml"
)

func handleK8sSummary(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ctx := context.TODO()
	nsList, err := k8s.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Namespace 失败: " + err.Error()})
		return
	}
	podList, err := k8s.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Pod 失败: " + err.Error()})
		return
	}
	svcList, err := k8s.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Service 失败: " + err.Error()})
		return
	}
	nodeList, err := k8s.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Node 失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"namespaceCount": len(nsList.Items),
		"podCount":       len(podList.Items),
		"serviceCount":   len(svcList.Items),
		"nodeCount":      len(nodeList.Items),
	})
}

func handleK8sPods(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Query("namespace")
	ls := strings.TrimSpace(c.Query("labelSelector"))
	ctx := context.TODO()
	opts := metav1.ListOptions{}
	if ls != "" {
		opts.LabelSelector = ls
	}
	var list *corev1.PodList
	var err error
	if ns != "" {
		list, err = k8s.CoreV1().Pods(ns).List(ctx, opts)
	} else {
		list, err = k8s.CoreV1().Pods("").List(ctx, opts)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Pod 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, p := range list.Items {
		restarts := int32(0)
		for _, cs := range p.Status.ContainerStatuses {
			restarts += cs.RestartCount
		}
		node := p.Spec.NodeName
		if node == "" {
			node = "—"
		}
		firstContainer := ""
		if len(p.Spec.Containers) > 0 {
			firstContainer = p.Spec.Containers[0].Name
		} else if len(p.Spec.InitContainers) > 0 {
			firstContainer = p.Spec.InitContainers[0].Name
		}
		out = append(out, map[string]interface{}{
			"namespace":       p.Namespace,
			"name":            p.Name,
			"phase":           string(p.Status.Phase),
			"node":            node,
			"restarts":        restarts,
			"age":             p.CreationTimestamp.Time.Format(time.RFC3339),
			"firstContainer":  firstContainer,
		})
	}
	c.JSON(http.StatusOK, out)
}

func handleK8sPodGet(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("name")
	ctx := context.TODO()
	pod, err := k8s.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Pod 不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取 Pod 失败: " + err.Error()})
		return
	}
	pod.ObjectMeta.ManagedFields = nil

	restarts := int32(0)
	for _, cs := range pod.Status.ContainerStatuses {
		restarts += cs.RestartCount
	}
	node := pod.Spec.NodeName
	if node == "" {
		node = "—"
	}

	containers := make([]gin.H, 0, len(pod.Spec.Containers)+len(pod.Spec.InitContainers))
	for _, ctn := range pod.Spec.InitContainers {
		containers = append(containers, gin.H{"name": ctn.Name, "image": ctn.Image, "init": true})
	}
	for _, ctn := range pod.Spec.Containers {
		containers = append(containers, gin.H{"name": ctn.Name, "image": ctn.Image, "init": false})
	}

	yamlBytes, err := sigyaml.Marshal(pod)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "序列化 YAML 失败: " + err.Error()})
		return
	}

	eventList, errEv := k8s.CoreV1().Events(ns).List(ctx, metav1.ListOptions{
		FieldSelector: fields.OneTermEqualSelector("involvedObject.uid", string(pod.UID)).String(),
	})
	if errEv != nil || eventList == nil || len(eventList.Items) == 0 {
		fs := fields.AndSelectors(
			fields.OneTermEqualSelector("involvedObject.kind", "Pod"),
			fields.OneTermEqualSelector("involvedObject.name", name),
		)
		eventList, _ = k8s.CoreV1().Events(ns).List(ctx, metav1.ListOptions{FieldSelector: fs.String()})
	}
	eventsOut := make([]gin.H, 0)
	if eventList != nil {
		sort.Slice(eventList.Items, func(i, j int) bool {
			return eventList.Items[i].LastTimestamp.After(eventList.Items[j].LastTimestamp.Time)
		})
		for _, ev := range eventList.Items {
			first := ""
			if !ev.FirstTimestamp.IsZero() {
				first = ev.FirstTimestamp.Time.Format(time.RFC3339)
			}
			last := ""
			if !ev.LastTimestamp.IsZero() {
				last = ev.LastTimestamp.Time.Format(time.RFC3339)
			}
			eventsOut = append(eventsOut, gin.H{
				"type":           ev.Type,
				"reason":         ev.Reason,
				"message":        ev.Message,
				"count":          ev.Count,
				"firstTimestamp": first,
				"lastTimestamp":  last,
				"age":            last,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"namespace":  pod.Namespace,
		"name":       pod.Name,
		"phase":      string(pod.Status.Phase),
		"node":       node,
		"restarts":   restarts,
		"age":        pod.CreationTimestamp.Time.Format(time.RFC3339),
		"containers": containers,
		"yaml":       string(yamlBytes),
		"events":     eventsOut,
	})
}

// handleK8sPodLogs 返回指定容器的 stdout/stderr 日志（Kubernetes PodLog）。
// GET /api/k8s/pods/:namespace/:name/logs?container=&tailLines=&previous=
// container 可省略：将使用 Pod 第一个工作容器（无则第一个 init 容器）。
func handleK8sPodLogs(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("name")
	container := strings.TrimSpace(c.Query("container"))
	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()

	if container == "" {
		pod, err := k8s.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			if apierrors.IsNotFound(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "Pod 不存在"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "读取 Pod 失败: " + err.Error()})
			return
		}
		if len(pod.Spec.Containers) > 0 {
			container = pod.Spec.Containers[0].Name
		} else if len(pod.Spec.InitContainers) > 0 {
			container = pod.Spec.InitContainers[0].Name
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Pod 无容器，无法取日志"})
			return
		}
	}

	tailLines := int64(500)
	if t := c.Query("tailLines"); t != "" {
		if n, err := strconv.ParseInt(t, 10, 64); err == nil && n > 0 && n <= 10000 {
			tailLines = n
		}
	}
	previous := c.Query("previous") == "true"
	follow := false
	opts := &corev1.PodLogOptions{
		Container: container,
		TailLines: &tailLines,
		Previous:  previous,
		Follow:    follow,
	}
	req := k8s.CoreV1().Pods(ns).GetLogs(name, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Pod 不存在或无法读取日志"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取日志失败: " + err.Error()})
		return
	}
	defer stream.Close()
	buf, err := io.ReadAll(stream)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取日志流失败: " + err.Error()})
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", buf)
}

func handleK8sPodDelete(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Param("namespace")
	name := c.Param("name")
	ctx := context.TODO()
	err := k8s.CoreV1().Pods(ns).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Pod 不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除 Pod 失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func handleK8sServices(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Query("namespace")
	ctx := context.TODO()
	var list *corev1.ServiceList
	var err error
	if ns != "" {
		list, err = k8s.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
	} else {
		list, err = k8s.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Service 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, s := range list.Items {
		ports := make([]string, 0, len(s.Spec.Ports))
		for _, p := range s.Spec.Ports {
			nm := p.Name
			if nm == "" {
				nm = "tcp"
			}
			ports = append(ports, fmt.Sprintf("%s:%d", nm, p.Port))
		}
		out = append(out, map[string]interface{}{
			"namespace": s.Namespace,
			"name":      s.Name,
			"type":      string(s.Spec.Type),
			"clusterIP": s.Spec.ClusterIP,
			"ports":     ports,
			"age":       s.CreationTimestamp.Time.Format(time.RFC3339),
		})
	}
	c.JSON(http.StatusOK, out)
}

func handleK8sNodes(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	list, err := k8s.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Node 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, n := range list.Items {
		ready := "Unknown"
		for _, c := range n.Status.Conditions {
			if c.Type == corev1.NodeReady {
				ready = string(c.Status)
				break
			}
		}
		roles := make([]string, 0)
		if _, ok := n.Labels["node-role.kubernetes.io/control-plane"]; ok {
			roles = append(roles, "control-plane")
		}
		if _, ok := n.Labels["node-role.kubernetes.io/master"]; ok {
			roles = append(roles, "master")
		}
		if len(roles) == 0 {
			roles = append(roles, "worker")
		}
		internalIP := ""
		for _, a := range n.Status.Addresses {
			if a.Type == corev1.NodeInternalIP {
				internalIP = a.Address
				break
			}
		}
		kubelet := n.Status.NodeInfo.KubeletVersion
		out = append(out, map[string]interface{}{
			"name":       n.Name,
			"ready":      ready,
			"roles":      roles,
			"internalIP": internalIP,
			"kubelet":    kubelet,
			"age":        n.CreationTimestamp.Time.Format(time.RFC3339),
		})
	}
	c.JSON(http.StatusOK, out)
}

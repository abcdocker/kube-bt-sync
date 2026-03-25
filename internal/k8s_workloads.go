package internal

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func handleK8sDeployments(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Query("namespace")
	ctx := context.TODO()
	var list *appsv1.DeploymentList
	var err error
	if ns != "" {
		list, err = k8s.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
	} else {
		list, err = k8s.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 Deployment 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, d := range list.Items {
		desired := int32(1)
		if d.Spec.Replicas != nil {
			desired = *d.Spec.Replicas
		}
		ready := d.Status.ReadyReplicas
		ls := ""
		if d.Spec.Selector != nil {
			ls = metav1.FormatLabelSelector(d.Spec.Selector)
		}
		out = append(out, map[string]interface{}{
			"namespace":       d.Namespace,
			"name":            d.Name,
			"ready":           fmt.Sprintf("%d/%d", ready, desired),
			"age":             d.CreationTimestamp.Time.Format(time.RFC3339),
			"labelSelector":   ls,
		})
	}
	c.JSON(http.StatusOK, out)
}

func handleK8sStatefulSets(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Query("namespace")
	ctx := context.TODO()
	var list *appsv1.StatefulSetList
	var err error
	if ns != "" {
		list, err = k8s.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{})
	} else {
		list, err = k8s.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 StatefulSet 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, s := range list.Items {
		desired := int32(1)
		if s.Spec.Replicas != nil {
			desired = *s.Spec.Replicas
		}
		ready := s.Status.ReadyReplicas
		ls := ""
		if s.Spec.Selector != nil {
			ls = metav1.FormatLabelSelector(s.Spec.Selector)
		}
		out = append(out, map[string]interface{}{
			"namespace":       s.Namespace,
			"name":            s.Name,
			"ready":           fmt.Sprintf("%d/%d", ready, desired),
			"age":             s.CreationTimestamp.Time.Format(time.RFC3339),
			"labelSelector":   ls,
		})
	}
	c.JSON(http.StatusOK, out)
}

func handleK8sDaemonSets(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Query("namespace")
	ctx := context.TODO()
	var list *appsv1.DaemonSetList
	var err error
	if ns != "" {
		list, err = k8s.AppsV1().DaemonSets(ns).List(ctx, metav1.ListOptions{})
	} else {
		list, err = k8s.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 DaemonSet 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, d := range list.Items {
		desired := d.Status.DesiredNumberScheduled
		ready := d.Status.NumberReady
		out = append(out, map[string]interface{}{
			"namespace": d.Namespace,
			"name":      d.Name,
			"ready":     fmt.Sprintf("%d/%d", ready, desired),
			"age":       d.CreationTimestamp.Time.Format(time.RFC3339),
		})
	}
	c.JSON(http.StatusOK, out)
}

func handleK8sPVCs(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Query("namespace")
	ctx := context.TODO()
	var list *corev1.PersistentVolumeClaimList
	var err error
	if ns != "" {
		list, err = k8s.CoreV1().PersistentVolumeClaims(ns).List(ctx, metav1.ListOptions{})
	} else {
		list, err = k8s.CoreV1().PersistentVolumeClaims("").List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 PVC 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, p := range list.Items {
		capacity := "—"
		if p.Status.Capacity != nil {
			if q, ok := p.Status.Capacity[corev1.ResourceStorage]; ok {
				capacity = q.String()
			}
		}
		modes := make([]string, 0, len(p.Spec.AccessModes))
		for _, m := range p.Spec.AccessModes {
			modes = append(modes, string(m))
		}
		sc := ""
		if p.Spec.StorageClassName != nil {
			sc = *p.Spec.StorageClassName
		}
		out = append(out, map[string]interface{}{
			"namespace":   p.Namespace,
			"name":        p.Name,
			"status":      string(p.Status.Phase),
			"capacity":    capacity,
			"accessModes": modes,
			"storageClass": sc,
			"age":         p.CreationTimestamp.Time.Format(time.RFC3339),
		})
	}
	c.JSON(http.StatusOK, out)
}

func handleK8sConfigMaps(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	ns := c.Query("namespace")
	ctx := context.TODO()
	var list *corev1.ConfigMapList
	var err error
	if ns != "" {
		list, err = k8s.CoreV1().ConfigMaps(ns).List(ctx, metav1.ListOptions{})
	} else {
		list, err = k8s.CoreV1().ConfigMaps("").List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "列出 ConfigMap 失败: " + err.Error()})
		return
	}
	out := make([]map[string]interface{}, 0, len(list.Items))
	for _, cm := range list.Items {
		keys := len(cm.Data) + len(cm.BinaryData)
		out = append(out, map[string]interface{}{
			"namespace": cm.Namespace,
			"name":      cm.Name,
			"keys":      keys,
			"age":       cm.CreationTimestamp.Time.Format(time.RFC3339),
		})
	}
	c.JSON(http.StatusOK, out)
}

package internal

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	sigyaml "sigs.k8s.io/yaml"
)

// POST /api/k8s/apply-yaml  body: { yamlContent: string } — 支持多文档 --- 分隔；支持 Deployment/StatefulSet/Pod/Service/PVC/ConfigMap
func handleK8sApplyYamlGeneric(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	var req YamlRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数解析失败: " + err.Error()})
		return
	}
	docs := splitYAMLDocuments(req.YamlContent)
	if len(docs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "YAML 为空"})
		return
	}
	ctx := context.TODO()
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		if err := applyOneKubernetesYAML(ctx, k8s, doc); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "YAML 已成功应用到集群"})
}

func splitYAMLDocuments(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, "\n---")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "---") {
			p = strings.TrimSpace(strings.TrimPrefix(p, "---"))
		}
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{s}
	}
	return out
}

func applyOneKubernetesYAML(ctx context.Context, k8s *kubernetes.Clientset, doc string) error {
	var meta struct {
		Kind string `json:"kind"`
	}
	if err := sigyaml.Unmarshal([]byte(doc), &meta); err != nil {
		return err
	}
	switch meta.Kind {
	case "Deployment":
		var o appsv1.Deployment
		if err := sigyaml.Unmarshal([]byte(doc), &o); err != nil {
			return err
		}
		if o.Namespace == "" {
			o.Namespace = "default"
		}
		cli := k8s.AppsV1().Deployments(o.Namespace)
		ex, err := cli.Get(ctx, o.Name, metav1.GetOptions{})
		if err == nil {
			o.ResourceVersion = ex.ResourceVersion
			_, err = cli.Update(ctx, &o, metav1.UpdateOptions{})
			return err
		}
		if apierrors.IsNotFound(err) {
			_, err = cli.Create(ctx, &o, metav1.CreateOptions{})
			return err
		}
		return err
	case "StatefulSet":
		var o appsv1.StatefulSet
		if err := sigyaml.Unmarshal([]byte(doc), &o); err != nil {
			return err
		}
		if o.Namespace == "" {
			o.Namespace = "default"
		}
		cli := k8s.AppsV1().StatefulSets(o.Namespace)
		ex, err := cli.Get(ctx, o.Name, metav1.GetOptions{})
		if err == nil {
			o.ResourceVersion = ex.ResourceVersion
			_, err = cli.Update(ctx, &o, metav1.UpdateOptions{})
			return err
		}
		if apierrors.IsNotFound(err) {
			_, err = cli.Create(ctx, &o, metav1.CreateOptions{})
			return err
		}
		return err
	case "Pod":
		var o corev1.Pod
		if err := sigyaml.Unmarshal([]byte(doc), &o); err != nil {
			return err
		}
		if o.Namespace == "" {
			o.Namespace = "default"
		}
		cli := k8s.CoreV1().Pods(o.Namespace)
		ex, err := cli.Get(ctx, o.Name, metav1.GetOptions{})
		if err == nil {
			o.ResourceVersion = ex.ResourceVersion
			_, err = cli.Update(ctx, &o, metav1.UpdateOptions{})
			return err
		}
		if apierrors.IsNotFound(err) {
			_, err = cli.Create(ctx, &o, metav1.CreateOptions{})
			return err
		}
		return err
	case "Service":
		var o corev1.Service
		if err := sigyaml.Unmarshal([]byte(doc), &o); err != nil {
			return err
		}
		if o.Namespace == "" {
			o.Namespace = "default"
		}
		cli := k8s.CoreV1().Services(o.Namespace)
		ex, err := cli.Get(ctx, o.Name, metav1.GetOptions{})
		if err == nil {
			o.ResourceVersion = ex.ResourceVersion
			_, err = cli.Update(ctx, &o, metav1.UpdateOptions{})
			return err
		}
		if apierrors.IsNotFound(err) {
			_, err = cli.Create(ctx, &o, metav1.CreateOptions{})
			return err
		}
		return err
	case "PersistentVolumeClaim":
		var o corev1.PersistentVolumeClaim
		if err := sigyaml.Unmarshal([]byte(doc), &o); err != nil {
			return err
		}
		if o.Namespace == "" {
			o.Namespace = "default"
		}
		cli := k8s.CoreV1().PersistentVolumeClaims(o.Namespace)
		ex, err := cli.Get(ctx, o.Name, metav1.GetOptions{})
		if err == nil {
			o.ResourceVersion = ex.ResourceVersion
			_, err = cli.Update(ctx, &o, metav1.UpdateOptions{})
			return err
		}
		if apierrors.IsNotFound(err) {
			_, err = cli.Create(ctx, &o, metav1.CreateOptions{})
			return err
		}
		return err
	case "ConfigMap":
		var o corev1.ConfigMap
		if err := sigyaml.Unmarshal([]byte(doc), &o); err != nil {
			return err
		}
		if o.Namespace == "" {
			o.Namespace = "default"
		}
		cli := k8s.CoreV1().ConfigMaps(o.Namespace)
		ex, err := cli.Get(ctx, o.Name, metav1.GetOptions{})
		if err == nil {
			o.ResourceVersion = ex.ResourceVersion
			_, err = cli.Update(ctx, &o, metav1.UpdateOptions{})
			return err
		}
		if apierrors.IsNotFound(err) {
			_, err = cli.Create(ctx, &o, metav1.CreateOptions{})
			return err
		}
		return err
	default:
		if meta.Kind == "" {
			return fmt.Errorf("无法识别 YAML kind（需要 Deployment/StatefulSet/Pod/Service/PersistentVolumeClaim/ConfigMap）")
		}
		return fmt.Errorf("暂不支持的 kind: %s", meta.Kind)
	}
}

// GET /api/k8s/object-yaml?kind=Deployment&namespace=&name=
func handleK8sGetObjectYAML(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	kind := strings.TrimSpace(c.Query("kind"))
	ns := strings.TrimSpace(c.Query("namespace"))
	name := strings.TrimSpace(c.Query("name"))
	if kind == "" || ns == "" || name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "需要 query: kind, namespace, name"})
		return
	}
	ctx := context.TODO()
	var (
		yamlBytes []byte
		err       error
	)
	switch kind {
	case "Deployment":
		o, e := k8s.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if e != nil {
			err = e
			break
		}
		o.ManagedFields = nil
		yamlBytes, err = sigyaml.Marshal(o)
	case "StatefulSet":
		o, e := k8s.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{})
		if e != nil {
			err = e
			break
		}
		o.ManagedFields = nil
		yamlBytes, err = sigyaml.Marshal(o)
	case "Pod":
		o, e := k8s.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
		if e != nil {
			err = e
			break
		}
		o.ManagedFields = nil
		yamlBytes, err = sigyaml.Marshal(o)
	case "Service":
		o, e := k8s.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
		if e != nil {
			err = e
			break
		}
		o.ManagedFields = nil
		yamlBytes, err = sigyaml.Marshal(o)
	case "PersistentVolumeClaim":
		o, e := k8s.CoreV1().PersistentVolumeClaims(ns).Get(ctx, name, metav1.GetOptions{})
		if e != nil {
			err = e
			break
		}
		o.ManagedFields = nil
		yamlBytes, err = sigyaml.Marshal(o)
	case "ConfigMap":
		o, e := k8s.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
		if e != nil {
			err = e
			break
		}
		o.ManagedFields = nil
		yamlBytes, err = sigyaml.Marshal(o)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的 kind: " + kind})
		return
	}
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "资源不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"yaml": string(yamlBytes)})
}

// DELETE /api/k8s/objects/:kind/:namespace/:name  kind: deployment|statefulset|pod|service|pvc|configmap
func handleK8sDeleteObject(c *gin.Context, k8s *kubernetes.Clientset) {
	if !GuardK8s(c, k8s) {
		return
	}
	kind := strings.ToLower(strings.TrimSpace(c.Param("kind")))
	ns := c.Param("namespace")
	name := c.Param("name")
	if ns == "" || name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "路径无效"})
		return
	}
	ctx := context.TODO()
	var err error
	switch kind {
	case "deployment":
		err = k8s.AppsV1().Deployments(ns).Delete(ctx, name, metav1.DeleteOptions{})
	case "statefulset":
		err = k8s.AppsV1().StatefulSets(ns).Delete(ctx, name, metav1.DeleteOptions{})
	case "pod":
		err = k8s.CoreV1().Pods(ns).Delete(ctx, name, metav1.DeleteOptions{})
	case "service":
		err = k8s.CoreV1().Services(ns).Delete(ctx, name, metav1.DeleteOptions{})
	case "pvc":
		err = k8s.CoreV1().PersistentVolumeClaims(ns).Delete(ctx, name, metav1.DeleteOptions{})
	case "configmap":
		err = k8s.CoreV1().ConfigMaps(ns).Delete(ctx, name, metav1.DeleteOptions{})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的 kind: " + kind})
		return
	}
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "资源不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

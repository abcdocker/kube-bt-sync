package internal

import (
	"context"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func openClawClusterRoleBindingName(ns, depName string) string {
	crb := fmt.Sprintf("kube-bt-openclaw-%s-%s", ns, depName)
	if len(crb) > 200 {
		crb = crb[:200]
	}
	return crb
}

// otherOpenClawSameNamespace 是否存在「其他」登记占用同一命名空间（共享 PVC/Secret 时不删）。
func otherOpenClawSameNamespace(list []AppOpenClawInstance, excludeID, ns string) bool {
	ns = strings.TrimSpace(ns)
	ex := strings.TrimSpace(excludeID)
	for _, x := range list {
		if strings.TrimSpace(x.ID) == ex {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(x.Namespace), ns) {
			return true
		}
	}
	return false
}

// DeleteOpenClawK8sResources 删除本实例关联的集群资源；skipSharedNSResources 为 true 时不删命名空间内固定名的 PVC/Secret/ConfigMap/SA。
func DeleteOpenClawK8sResources(ctx context.Context, k8s *kubernetes.Clientset, inst AppOpenClawInstance, skipSharedNSResources bool) []string {
	var warnings []string
	ns := strings.TrimSpace(inst.Namespace)
	dep := strings.TrimSpace(inst.DeploymentName)
	svc := strings.TrimSpace(inst.ServiceName)
	if k8s == nil {
		return []string{"K8s 未连接"}
	}
	if ns == "" || dep == "" || svc == "" {
		return []string{"实例缺少命名空间或资源名"}
	}
	prop := metav1.DeletePropagationForeground
	delOpts := metav1.DeleteOptions{PropagationPolicy: &prop}

	expose := strings.ToLower(strings.TrimSpace(inst.ExposeMode))
	ingName := strings.TrimSpace(inst.IngressResourceName)
	if ingName == "" && expose == "ingress" {
		ingName = dep + "-ingress"
	}
	if ingName != "" {
		if err := k8s.NetworkingV1().Ingresses(ns).Delete(ctx, ingName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			warnings = append(warnings, fmt.Sprintf("Ingress %s: %v", ingName, err))
		}
	}

	if err := k8s.CoreV1().Services(ns).Delete(ctx, svc, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		warnings = append(warnings, fmt.Sprintf("Service %s: %v", svc, err))
	}

	if err := k8s.AppsV1().Deployments(ns).Delete(ctx, dep, delOpts); err != nil && !apierrors.IsNotFound(err) {
		warnings = append(warnings, fmt.Sprintf("Deployment %s: %v", dep, err))
	}

	crb := openClawClusterRoleBindingName(ns, dep)
	if err := k8s.RbacV1().ClusterRoleBindings().Delete(ctx, crb, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		warnings = append(warnings, fmt.Sprintf("ClusterRoleBinding %s: %v", crb, err))
	}
	if err := k8s.RbacV1().RoleBindings(ns).Delete(ctx, crb, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		warnings = append(warnings, fmt.Sprintf("RoleBinding %s/%s: %v", ns, crb, err))
	}

	if skipSharedNSResources {
		return warnings
	}

	pvc := strings.TrimSpace(inst.PvcClaimName)
	if pvc == "" {
		pvc = "openclaw-home-pvc"
	}
	sec := strings.TrimSpace(inst.SecretName)
	if sec == "" {
		sec = "openclaw-secrets"
	}
	cm := strings.TrimSpace(inst.ConfigMapName)
	if cm == "" {
		cm = "openclaw-config"
	}
	sa := strings.TrimSpace(inst.ServiceAccountName)
	if sa == "" {
		sa = "openclaw"
	}

	type delOne struct {
		name string
		fn   func() error
	}
	for _, d := range []delOne{
		{"Secret " + sec, func() error { return k8s.CoreV1().Secrets(ns).Delete(ctx, sec, metav1.DeleteOptions{}) }},
		{"ConfigMap " + cm, func() error { return k8s.CoreV1().ConfigMaps(ns).Delete(ctx, cm, metav1.DeleteOptions{}) }},
		{"PVC " + pvc, func() error { return k8s.CoreV1().PersistentVolumeClaims(ns).Delete(ctx, pvc, metav1.DeleteOptions{}) }},
		{"ServiceAccount " + sa, func() error { return k8s.CoreV1().ServiceAccounts(ns).Delete(ctx, sa, metav1.DeleteOptions{}) }},
	} {
		if err := d.fn(); err != nil && !apierrors.IsNotFound(err) {
			warnings = append(warnings, fmt.Sprintf("%s: %v", d.name, err))
		}
	}

	return warnings
}

package internal

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	authorizationv1 "k8s.io/api/authorization/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// 平台预置 ClusterRole 名称（与实例 ClusterRoleBinding 的 roleRef 对应）。
const (
	OpenClawClusterRoleReadonly = "kube-bt-openclaw-readonly"
	OpenClawClusterRoleEdit     = "kube-bt-openclaw-edit"
	OpenClawClusterRoleAdmin    = "kube-bt-openclaw-admin"
)

// OpenClawRBACPresetMeta 供前端与 bootstrap 展示（GET /rbac-presets）。
type OpenClawRBACPresetMeta struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Description     string `json:"description"`
	ClusterRoleName string `json:"clusterRoleName"`
}

// OpenClawRBACPresets 固定列表；新增预设时在此与 ensure 逻辑同步扩展。
func OpenClawRBACPresets() []OpenClawRBACPresetMeta {
	return []OpenClawRBACPresetMeta{
		{
			ID:              "readonly",
			Label:           "只读",
			Description:     "网关 Pod 内 OpenClaw 使用 in-cluster client-go，身份为 Pod ServiceAccount；本档对应全集群 get/list/watch，不可改资源（推荐默认）",
			ClusterRoleName: OpenClawClusterRoleReadonly,
		},
		{
			ID:              "edit",
			Label:           "编辑",
			Description:     "同上 client-go 身份；在只读基础上增加 create、update、patch、delete、deletecollection（非 rbac 的 *，仍极强）",
			ClusterRoleName: OpenClawClusterRoleEdit,
		},
		{
			ID:              "admin",
			Label:           "管理员",
			Description:     "同上 client-go 身份；绑定 kube-bt-openclaw-admin（verbs * 于全部资源，与 cluster-admin 同级能力）。未授予则 API Server 直接拒绝，无 kubectl 也无法绕过",
			ClusterRoleName: OpenClawClusterRoleAdmin,
		},
	}
}

// NormalizeOpenClawRBACPreset 将请求值规范为 readonly | edit | admin。
func NormalizeOpenClawRBACPreset(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "admin", "cluster-admin":
		return "admin"
	case "edit", "editor", "writer":
		return "edit"
	default:
		return "readonly"
	}
}

// OpenClawClusterRoleForPreset 返回 K8s ClusterRole 对象名。
func OpenClawClusterRoleForPreset(preset string) string {
	switch NormalizeOpenClawRBACPreset(preset) {
	case "admin":
		return OpenClawClusterRoleAdmin
	case "edit":
		return OpenClawClusterRoleEdit
	default:
		return OpenClawClusterRoleReadonly
	}
}

// strictOpenClawRBACPreset 仅接受三档字面量（小写）；空串不算合法，由调用方走默认。
func strictOpenClawRBACPreset(raw string) (string, bool) {
	s := strings.ToLower(strings.TrimSpace(raw))
	switch s {
	case "readonly", "edit", "admin":
		return s, true
	default:
		return "", false
	}
}

func ensureOpenClawClusterRoleRules(ctx context.Context, k8s *kubernetes.Clientset, name string, rules []rbacv1.PolicyRule) error {
	if k8s == nil {
		return nil
	}
	_, err := k8s.RbacV1().ClusterRoles().Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:   name,
			Labels: map[string]string{"kube-bt-sync.io/openclaw": "true"},
		},
		Rules: rules,
	}
	_, err = k8s.RbacV1().ClusterRoles().Create(ctx, cr, metav1.CreateOptions{})
	return err
}

// EnsureOpenClawClusterRoles 确保三只预置 ClusterRole 存在（已存在则跳过）。
func EnsureOpenClawClusterRoles(ctx context.Context, k8s *kubernetes.Clientset) error {
	if k8s == nil {
		return nil
	}
	if err := ensureOpenClawClusterRoleRules(ctx, k8s, OpenClawClusterRoleReadonly, []rbacv1.PolicyRule{
		{APIGroups: []string{"*"}, Resources: []string{"*"}, Verbs: []string{"get", "list", "watch"}},
	}); err != nil {
		return err
	}
	if err := ensureOpenClawClusterRoleRules(ctx, k8s, OpenClawClusterRoleEdit, []rbacv1.PolicyRule{
		{APIGroups: []string{"*"}, Resources: []string{"*"}, Verbs: []string{"get", "list", "watch", "create", "update", "patch", "delete", "deletecollection"}},
	}); err != nil {
		return err
	}
	return ensureOpenClawClusterRoleRules(ctx, k8s, OpenClawClusterRoleAdmin, []rbacv1.PolicyRule{
		{APIGroups: []string{"*"}, Resources: []string{"*"}, Verbs: []string{"*"}},
	})
}

// ReconcileOpenClawRBACBinding 使用 ClusterRoleBinding 将网关 SA 绑定到预置 ClusterRole（readonly / edit / admin 均为集群范围）。
// rbacPreset 仅保留参数兼容；会先删除同名 RoleBinding（若集群上曾存在旧版「admin 仅命名空间」绑定），再确保 CRB。
func ReconcileOpenClawRBACBinding(ctx context.Context, k8s *kubernetes.Clientset, namespace, saName, bindingName, clusterRoleName, _ string) error {
	if k8s == nil {
		return nil
	}
	namespace = strings.TrimSpace(namespace)
	saName = strings.TrimSpace(saName)
	bindingName = strings.TrimSpace(bindingName)
	clusterRoleName = strings.TrimSpace(clusterRoleName)
	if namespace == "" || saName == "" || bindingName == "" || clusterRoleName == "" {
		return nil
	}
	if err := k8s.RbacV1().RoleBindings(namespace).Delete(ctx, bindingName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		return err
	}
	existing, err := k8s.RbacV1().ClusterRoleBindings().Get(ctx, bindingName, metav1.GetOptions{})
	if err == nil {
		refOK := existing.RoleRef.APIGroup == "rbac.authorization.k8s.io" &&
			existing.RoleRef.Kind == "ClusterRole" &&
			existing.RoleRef.Name == clusterRoleName
		subOK := len(existing.Subjects) == 1 &&
			existing.Subjects[0].Kind == "ServiceAccount" &&
			existing.Subjects[0].Name == saName &&
			existing.Subjects[0].Namespace == namespace
		if refOK && subOK {
			return nil
		}
		if delErr := k8s.RbacV1().ClusterRoleBindings().Delete(ctx, bindingName, metav1.DeleteOptions{}); delErr != nil && !apierrors.IsNotFound(delErr) {
			return delErr
		}
	} else if !apierrors.IsNotFound(err) {
		return err
	}
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:   bindingName,
			Labels: map[string]string{"kube-bt-sync.io/openclaw": "true"},
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     clusterRoleName,
		},
		Subjects: []rbacv1.Subject{
			{Kind: "ServiceAccount", Name: saName, Namespace: namespace},
		},
	}
	_, err = k8s.RbacV1().ClusterRoleBindings().Create(ctx, crb, metav1.CreateOptions{})
	return err
}

func handleAppOpenClawRBACPresetsGet(c *gin.Context, _ *ServerApp) {
	list := OpenClawRBACPresets()
	c.JSON(http.StatusOK, gin.H{"presets": list})
}

type openClawRbacPresetBody struct {
	Preset string `json:"preset"`
}

func handleAppOpenClawInstanceRBACPreset(c *gin.Context, app *ServerApp) {
	if getDashboardRoleFromGin(c) != DashboardRoleAdmin {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.K8s() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body openClawRbacPresetBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	preset, ok := strictOpenClawRBACPreset(body.Preset)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "preset 须为 readonly、edit 或 admin"})
		return
	}
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	inst := findAppOpenClawInstance(list, id)
	if inst == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "实例不存在"})
		return
	}
	ns := strings.TrimSpace(inst.Namespace)
	dep := strings.TrimSpace(inst.DeploymentName)
	sa := strings.TrimSpace(inst.ServiceAccountName)
	if sa == "" {
		sa = openClawServiceAccountName(dep)
	}
	crbName := openClawClusterRoleBindingName(ns, dep)
	roleName := OpenClawClusterRoleForPreset(preset)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	if err := EnsureOpenClawClusterRoles(ctx, app.K8s()); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := ReconcileOpenClawRBACBinding(ctx, app.K8s(), ns, sa, crbName, roleName, preset); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := ReconcileOpenClawGatewayDeploymentIdentity(ctx, app.K8s(), ns, dep, sa); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "已更新 ClusterRoleBinding，但未能对齐 Deployment 的 ServiceAccount 或触发网关重启: " + err.Error(),
		})
		return
	}
	if err := patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.RBACPreset = preset
		if strings.TrimSpace(x.ServiceAccountName) == "" {
			x.ServiceAccountName = sa
		}
	}); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{
		"ok":                     true,
		"rbacPreset":             preset,
		"clusterRoleName":        roleName,
		"clusterRoleBindingName": crbName,
		"gatewayRestart":         true,
	})
}

// openClawAnnotateRBACClientGoAlignment 核对「平台登记 RBAC 档」与集群内 Deployment 模板 SA、ClusterRoleBinding、以及 SA 对本命名空间 list pods 的 SubjectAccessReview 是否一致。
// OpenClaw 在网关 Pod 内通过 client-go 使用 in-cluster 凭据，有效权限仅来自绑定到该 SA 的 ClusterRole；与是否安装 kubectl 无关。
func openClawAnnotateRBACClientGoAlignment(ctx context.Context, k8s *kubernetes.Clientset, inst AppOpenClawInstance, st gin.H) {
	if k8s == nil {
		st["openclawRbacClientGoChecked"] = false
		st["openclawRbacClientGoHint"] = "K8s 未连接，无法核对网关 ServiceAccount 与 ClusterRoleBinding"
		return
	}
	ns := strings.TrimSpace(inst.Namespace)
	depName := strings.TrimSpace(inst.DeploymentName)
	if ns == "" || depName == "" {
		st["openclawRbacClientGoChecked"] = false
		st["openclawRbacClientGoHint"] = "登记缺少命名空间或 Deployment 名"
		return
	}
	saExpected := strings.TrimSpace(inst.ServiceAccountName)
	if saExpected == "" {
		saExpected = openClawServiceAccountName(depName)
	}
	expectedCR := OpenClawClusterRoleForPreset(NormalizeOpenClawRBACPreset(inst.RBACPreset))
	crbName := openClawClusterRoleBindingName(ns, depName)
	st["openclawRbacExpectedClusterRole"] = expectedCR
	st["openclawRbacExpectedServiceAccount"] = saExpected
	st["openclawRbacClusterRoleBindingName"] = crbName

	dep, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			st["openclawRbacClientGoChecked"] = true
			st["openclawRbacPodTemplateSA"] = ""
			st["openclawRbacPodTemplateSAOk"] = false
			st["openclawRbacClusterRoleBindingFound"] = false
			st["openclawRbacLiveClusterRoleName"] = ""
			st["openclawRbacBindingMatchesRegistration"] = false
			st["openclawRbacClientGoHint"] = "集群中未找到该 Deployment，无法核对 Pod 身份与 RBAC"
			openClawSubjectAccessReviewListPods(ctx, k8s, ns, saExpected, st)
			openClawApplyRBACFullyAlignedFlag(st, false, false)
			return
		}
		st["openclawRbacClientGoChecked"] = false
		st["openclawRbacClientGoHint"] = "读取 Deployment: " + err.Error()
		st["openclawRbacClientGoFullyAligned"] = false
		return
	}
	podSA := strings.TrimSpace(dep.Spec.Template.Spec.ServiceAccountName)
	if podSA == "" {
		podSA = strings.TrimSpace(dep.Spec.Template.Spec.DeprecatedServiceAccount)
	}
	st["openclawRbacPodTemplateSA"] = podSA
	saAligned := podSA == saExpected
	st["openclawRbacPodTemplateSAOk"] = saAligned

	crb, err := k8s.RbacV1().ClusterRoleBindings().Get(ctx, crbName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			st["openclawRbacClusterRoleBindingFound"] = false
			st["openclawRbacLiveClusterRoleName"] = ""
			st["openclawRbacBindingMatchesRegistration"] = false
			h := fmt.Sprintf("未找到 ClusterRoleBinding「%s」：网关 Pod 内 OpenClaw（client-go）使用的 ServiceAccount 未绑定到平台预置 ClusterRole，调用集群 API 会被 API Server 拒绝。", crbName)
			if !saAligned {
				h += fmt.Sprintf(" Deployment 模板 SA 为「%s」，与平台期望「%s」不一致。", podSA, saExpected)
			}
			st["openclawRbacClientGoHint"] = h
			openClawSubjectAccessReviewListPods(ctx, k8s, ns, saExpected, st)
			openClawApplyRBACFullyAlignedFlag(st, saAligned, false)
			st["openclawRbacClientGoChecked"] = true
			return
		}
		st["openclawRbacClientGoChecked"] = false
		st["openclawRbacClientGoHint"] = "读取 ClusterRoleBinding: " + err.Error()
		st["openclawRbacClientGoFullyAligned"] = false
		return
	}
	st["openclawRbacClusterRoleBindingFound"] = true
	liveRole := ""
	if crb.RoleRef.Kind == "ClusterRole" {
		liveRole = strings.TrimSpace(crb.RoleRef.Name)
	}
	st["openclawRbacLiveClusterRoleName"] = liveRole
	subjectOK := len(crb.Subjects) == 1 &&
		strings.EqualFold(strings.TrimSpace(crb.Subjects[0].Kind), "ServiceAccount") &&
		strings.TrimSpace(crb.Subjects[0].Name) == saExpected &&
		strings.TrimSpace(crb.Subjects[0].Namespace) == ns
	bindMatch := liveRole == expectedCR && subjectOK
	st["openclawRbacBindingMatchesRegistration"] = bindMatch

	var hintParts []string
	if !saAligned {
		hintParts = append(hintParts, fmt.Sprintf("Deployment 模板 ServiceAccount 为「%s」，平台期望网关使用「%s」；若不一致，Pod 内 client-go 身份与 ClusterRoleBinding 目标不符。", podSA, saExpected))
	}
	if !bindMatch {
		if liveRole != "" && liveRole != expectedCR {
			hintParts = append(hintParts, fmt.Sprintf("ClusterRoleBinding 当前引用 ClusterRole「%s」，与平台登记期望「%s」不一致；请在下方重新「应用至集群」。", liveRole, expectedCR))
		} else if !subjectOK {
			hintParts = append(hintParts, "ClusterRoleBinding 的 subject 与当前命名空间/ServiceAccount 不一致。")
		} else if liveRole == "" {
			hintParts = append(hintParts, "ClusterRoleBinding 的 roleRef 不是有效的 ClusterRole。")
		}
	}
	openClawSubjectAccessReviewListPods(ctx, k8s, ns, saExpected, st)
	if len(hintParts) == 0 {
		if openClawSARListPodsDenied(st) {
			st["openclawRbacClientGoHint"] = fmt.Sprintf("绑定与模板已对齐，但 SubjectAccessReview 表明 SA「%s」在命名空间「%s」仍无 list pods 权限；请检查 ClusterRole 是否被改动或存在其它策略拦截。", saExpected, ns)
		} else {
			st["openclawRbacClientGoHint"] = fmt.Sprintf("与平台登记一致：网关 Pod 以 ServiceAccount「%s」经 ClusterRole「%s」访问 API；OpenClaw 使用 client-go，未授权操作由 API Server 拒绝。", saExpected, expectedCR)
		}
	} else {
		h := strings.Join(hintParts, " ")
		if openClawSARListPodsDenied(st) {
			h += " SubjectAccessReview：list pods 亦为拒绝。"
		}
		st["openclawRbacClientGoHint"] = h
	}
	st["openclawRbacClientGoChecked"] = true
	openClawApplyRBACFullyAlignedFlag(st, saAligned, bindMatch)
}

func openClawSARListPodsDenied(st gin.H) bool {
	if _, ok := st["openclawRbacSARError"]; ok {
		return true
	}
	if v, ok := st["openclawRbacSARListPodsAllowed"].(bool); ok {
		return !v
	}
	return false
}

func openClawApplyRBACFullyAlignedFlag(st gin.H, saAligned, bindMatch bool) {
	sarOK := false
	sarComplete := false
	if _, bad := st["openclawRbacSARError"]; !bad {
		if v, ok := st["openclawRbacSARListPodsAllowed"].(bool); ok {
			sarComplete = true
			sarOK = v
		}
	}
	st["openclawRbacClientGoFullyAligned"] = saAligned && bindMatch && sarComplete && sarOK
}

func openClawSubjectAccessReviewListPods(ctx context.Context, k8s *kubernetes.Clientset, ns, saName string, st gin.H) {
	saName = strings.TrimSpace(saName)
	ns = strings.TrimSpace(ns)
	if k8s == nil || ns == "" || saName == "" {
		return
	}
	user := "system:serviceaccount:" + ns + ":" + saName
	sar := &authorizationv1.SubjectAccessReview{
		Spec: authorizationv1.SubjectAccessReviewSpec{
			User: user,
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Verb:      "list",
				Group:     "",
				Resource:  "pods",
				Namespace: ns,
			},
		},
	}
	resp, err := k8s.AuthorizationV1().SubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
	if err != nil {
		st["openclawRbacSARError"] = err.Error()
		return
	}
	st["openclawRbacSARListPodsAllowed"] = resp.Status.Allowed
	if !resp.Status.Allowed {
		if resp.Status.Reason != "" {
			st["openclawRbacSARReason"] = resp.Status.Reason
		}
		if resp.Status.EvaluationError != "" {
			st["openclawRbacSAREvaluationError"] = resp.Status.EvaluationError
		}
	}
}

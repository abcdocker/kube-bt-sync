package internal

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func openClawPickLatestPod(items []corev1.Pod) *corev1.Pod {
	if len(items) == 0 {
		return nil
	}
	best := 0
	for i := 1; i < len(items); i++ {
		if items[i].CreationTimestamp.After(items[best].CreationTimestamp.Time) {
			best = i
		}
	}
	return &items[best]
}

func openClawGatewayImageFromContainers(containers []corev1.Container) string {
	for _, c := range containers {
		if c.Name == "gateway" {
			return strings.TrimSpace(c.Image)
		}
	}
	return ""
}

// openClawAnnotateImageRollout 写入 template/running 镜像及是否与平台登记一致（供列表「对话」与代连校验）。
func openClawAnnotateImageRollout(h gin.H, registeredImage, templateGW, runGW string) {
	if templateGW != "" {
		h["templateGatewayImage"] = templateGW
	}
	if runGW != "" {
		h["runningGatewayImage"] = runGW
	}
	reg := strings.TrimSpace(registeredImage)
	run := strings.TrimSpace(runGW)
	phase, _ := h["phase"].(string)
	podReady, _ := h["podReady"].(bool)
	if reg == "" {
		h["imageRolloutSynced"] = true
		return
	}
	synced := phase == "ready" && podReady && run == reg
	h["imageRolloutSynced"] = synced
	if synced {
		return
	}
	if run != "" && run != reg {
		h["imageRolloutMessage"] = "运行 Pod 镜像与平台登记不一致（切换中或未拉取完成），待就绪且一致后可对话。"
	} else if phase == "progress" || phase == "missing" || phase == "error" {
		h["imageRolloutMessage"] = "网关尚未就绪或 Deployment 异常，请待 Pod 运行且镜像与登记一致。"
	}
}

// openClawK8sStatus 查询登记对应的 Deployment / Pod 概况（供列表展示）。
// registeredImage 为平台登记的期望网关镜像；空则视为不校验 rollout（imageRolloutSynced 恒为 true）。
func openClawK8sStatus(ctx context.Context, k8s *kubernetes.Clientset, ns, depName, registeredImage string) gin.H {
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	h := gin.H{
		"k8sAvailable": k8s != nil,
		"phase":        "no_k8s",
		"message":      "K8s 未连接",
	}
	if k8s == nil {
		openClawAnnotateImageRollout(h, registeredImage, "", "")
		return h
	}
	if ns == "" || depName == "" {
		h["phase"] = "error"
		h["message"] = "缺少命名空间或 Deployment 名"
		openClawAnnotateImageRollout(h, registeredImage, "", "")
		return h
	}
	dep, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			h["phase"] = "missing"
			h["deploymentFound"] = false
			h["message"] = "集群中未找到该 Deployment"
			openClawAnnotateImageRollout(h, registeredImage, "", "")
			return h
		}
		h["phase"] = "error"
		h["message"] = err.Error()
		openClawAnnotateImageRollout(h, registeredImage, "", "")
		return h
	}
	templateGW := openClawGatewayImageFromContainers(dep.Spec.Template.Spec.Containers)
	h["deploymentFound"] = true
	des := int32(1)
	if dep.Spec.Replicas != nil {
		des = *dep.Spec.Replicas
	}
	rdy := dep.Status.ReadyReplicas
	h["readyReplicas"] = rdy
	h["desiredReplicas"] = des

	ls := "app=" + depName
	pods, err := k8s.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: ls})
	if err != nil {
		h["phase"] = "error"
		h["message"] = "Pod 列表: " + err.Error()
		openClawAnnotateImageRollout(h, registeredImage, templateGW, "")
		return h
	}
	if len(pods.Items) == 0 {
		h["phase"] = "progress"
		h["podPhase"] = ""
		h["message"] = fmt.Sprintf("Deployment %d/%d，尚无 Pod（调度或拉镜像中）", rdy, des)
		openClawAnnotateImageRollout(h, registeredImage, templateGW, "")
		return h
	}
	p := openClawPickLatestPod(pods.Items)
	if p == nil {
		h["phase"] = "progress"
		h["podPhase"] = ""
		h["message"] = fmt.Sprintf("Deployment %d/%d，尚无 Pod（调度或拉镜像中）", rdy, des)
		openClawAnnotateImageRollout(h, registeredImage, templateGW, "")
		return h
	}
	runGW := openClawGatewayImageFromContainers(p.Spec.Containers)
	podReady := false
	for _, c := range p.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			podReady = true
			break
		}
	}
	ph := string(p.Status.Phase)
	h["podName"] = p.Name
	h["podPhase"] = ph
	h["podReady"] = podReady

	if rdy >= 1 && ph == string(corev1.PodRunning) && podReady {
		h["phase"] = "ready"
		h["message"] = "运行中（Deployment 与 Pod 就绪）"
		openClawAnnotateImageRollout(h, registeredImage, templateGW, runGW)
		return h
	}
	h["phase"] = "progress"
	h["message"] = fmt.Sprintf("Deployment %d/%d · Pod %s（%s）", rdy, des, p.Name, ph)
	if ph == string(corev1.PodPending) {
		h["message"] = fmt.Sprintf("Pod 调度/拉镜像中（%s）", p.Name)
	}
	openClawAnnotateImageRollout(h, registeredImage, templateGW, runGW)
	return h
}

func openClawProbeBaseURLs(inst *AppOpenClawInstance) []string {
	if inst == nil {
		return nil
	}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		for _, x := range out {
			if x == s {
				return
			}
		}
		out = append(out, s)
	}
	add(inst.PublicV1URL)
	add(inst.ExternalV1URL)
	add(inst.ClusterV1BaseURL)
	return out
}

func openClawProbeGETURLs(base string) []string {
	b := strings.TrimSuffix(strings.TrimSpace(base), "/")
	if b == "" {
		return nil
	}
	// OpenAI 兼容网关常见 GET；失败则退回 base 本身
	return []string{b + "/models", b}
}

// openClawGatewayProbe 从平台进程发起 HTTP 探测（优先公网/Ingress，再 NodePort，最后 cluster DNS）。
func openClawGatewayProbe(ctx context.Context, inst *AppOpenClawInstance, bearerToken string) gin.H {
	out := gin.H{"ok": false, "httpStatus": 0, "urlTried": "", "message": ""}
	cli := &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
			Proxy:           http.ProxyFromEnvironment,
		},
	}
	lastErr := ""
	for _, base := range openClawProbeBaseURLs(inst) {
		for _, u := range openClawProbeGETURLs(base) {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
			if err != nil {
				lastErr = err.Error()
				continue
			}
			if strings.TrimSpace(bearerToken) != "" {
				req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(bearerToken))
			}
			resp, err := cli.Do(req)
			if err != nil {
				lastErr = err.Error()
				out["urlTried"] = u
				continue
			}
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			out["httpStatus"] = resp.StatusCode
			out["urlTried"] = u
			// 5xx 视为未就绪；401/404 仍说明 HTTP 栈可达
			if resp.StatusCode < 500 {
				out["ok"] = true
				out["message"] = http.StatusText(resp.StatusCode)
				if resp.StatusCode == 401 {
					out["message"] = "HTTP 401（网关在线，需有效 Token）"
				}
				return out
			}
			lastErr = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
	}
	if ut, _ := out["urlTried"].(string); ut == "" {
		out["message"] = "未配置可探测的访问地址（公网 / NodePort / 集群内）"
	} else {
		out["message"] = lastErr
		if lastErr == "" {
			out["message"] = "无法建立可用 HTTP 响应"
		}
	}
	return out
}

func openClawAnnotatePlatformInitRevision(ctx context.Context, k8s *kubernetes.Clientset, ns, depName string, st gin.H) {
	st["platformInitRevisionExpected"] = OpenClawPlatformInitRevision
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	if k8s == nil || ns == "" || depName == "" {
		st["platformInitRevisionAligned"] = false
		st["platformInitRevisionHint"] = "K8s 未连接或缺少命名空间/Deployment 名"
		return
	}
	d, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		st["platformInitRevisionAligned"] = false
		st["platformInitRevisionHint"] = "无法读取 Deployment：" + err.Error()
		return
	}
	obs := 0
	if d.Spec.Template.Annotations != nil {
		if v := strings.TrimSpace(d.Spec.Template.Annotations[openClawInitRevisionAnnotationKey]); v != "" {
			if n, e := strconv.Atoi(v); e == nil {
				obs = n
				st["platformInitRevisionObserved"] = n
			}
		}
	}
	if obs == 0 {
		st["platformInitRevisionAligned"] = false
		st["platformInitRevisionHint"] = "Pod 模板缺少平台 init 修订标记（多为升级前创建的实例）：请在 OpenClaw 详情中「应用网关镜像」或调整 RBAC/管理配置以同步 Deployment，或删除后按当前平台版本重建。"
		return
	}
	st["platformInitRevisionAligned"] = obs == OpenClawPlatformInitRevision
	if obs != OpenClawPlatformInitRevision {
		st["platformInitRevisionHint"] = fmt.Sprintf("集群内模板修订为 %d，当前平台期望 %d；请同步 Deployment 模板（应用镜像或保存管理配置）后滚动 Pod。", obs, OpenClawPlatformInitRevision)
	}
}

func collectOpenClawK8sStatuses(ctx context.Context, k8s *kubernetes.Clientset, list []AppOpenClawInstance) map[string]gin.H {
	out := make(map[string]gin.H, len(list))
	if len(list) == 0 {
		return out
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	parent, cancel := context.WithTimeout(ctx, 18*time.Second)
	defer cancel()
	for _, x := range list {
		x := x
		wg.Add(1)
		go func() {
			defer wg.Done()
			sub, c2 := context.WithTimeout(parent, 8*time.Second)
			defer c2()
			st := openClawK8sStatus(sub, k8s, x.Namespace, x.DeploymentName, x.Image)
			openClawAnnotatePlatformInitRevision(sub, k8s, x.Namespace, x.DeploymentName, st)
			openClawAnnotateRBACClientGoAlignment(sub, k8s, x, st)
			mu.Lock()
			out[x.ID] = st
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
}

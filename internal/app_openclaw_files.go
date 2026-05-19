package internal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const (
	openClawHomeMount        = "/home/node/.openclaw"
	openClawFileMaxReadBytes = 4 * 1024 * 1024
	openClawFileMaxWrite     = 4 * 1024 * 1024
)

var openClawWorkspaceFileRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

// openClawSanitizeRelPath 仅允许 openclaw.json 或 workspace/ 下单层文件名（防路径穿越）。
func openClawSanitizeRelPath(p string) (string, error) {
	p = strings.TrimSpace(p)
	p = strings.Trim(p, "/")
	if p == "" {
		return "", errors.New("缺少 path")
	}
	if p == "openclaw.json" {
		return p, nil
	}
	if strings.HasPrefix(p, "workspace/") {
		rest := strings.TrimPrefix(p, "workspace/")
		if rest == "" || strings.Contains(rest, "/") || strings.Contains(rest, "..") {
			return "", errors.New("workspace 路径非法")
		}
		if !openClawWorkspaceFileRe.MatchString(rest) {
			return "", errors.New("workspace 文件名非法")
		}
		return "workspace/" + rest, nil
	}
	return "", errors.New("仅支持 openclaw.json 或 workspace/ 下文件")
}

func patchOpenClawAllowedOriginsIfEmpty(root map[string]interface{}) (changed bool) {
	gw, _ := root["gateway"].(map[string]interface{})
	if gw == nil {
		gw = make(map[string]interface{})
		root["gateway"] = gw
	}
	cui, _ := gw["controlUi"].(map[string]interface{})
	if cui == nil {
		cui = make(map[string]interface{})
		gw["controlUi"] = cui
	}
	orig, ok := cui["allowedOrigins"].([]interface{})
	if !ok || len(orig) == 0 {
		cui["allowedOrigins"] = []interface{}{"*"}
		if _, has := cui["enabled"]; !has {
			cui["enabled"] = true
		}
		return true
	}
	return false
}

func chatCompletionsEndpointEnabled(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

func patchOpenClawChatCompletionsIfDisabled(root map[string]interface{}) (changed bool) {
	gw, _ := root["gateway"].(map[string]interface{})
	if gw == nil {
		gw = make(map[string]interface{})
		root["gateway"] = gw
	}
	httpM, _ := gw["http"].(map[string]interface{})
	if httpM == nil {
		httpM = make(map[string]interface{})
		gw["http"] = httpM
	}
	eps, _ := httpM["endpoints"].(map[string]interface{})
	if eps == nil {
		eps = make(map[string]interface{})
		httpM["endpoints"] = eps
	}
	cc, _ := eps["chatCompletions"].(map[string]interface{})
	if cc == nil {
		cc = make(map[string]interface{})
		eps["chatCompletions"] = cc
	}
	if chatCompletionsEndpointEnabled(cc["enabled"]) {
		return false
	}
	cc["enabled"] = true
	return true
}

func openClawContextWindowAsFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// patchOpenClawOllamaContextWindowIfBelowMin 将 api=ollama 的 provider 下 models[].contextWindow 小于 16000 的条目抬到 16384（与 Pod init 脚本、部署预设一致）。
func patchOpenClawOllamaContextWindowIfBelowMin(root map[string]interface{}) (changed bool) {
	const minCtx = 16000.0
	const fixCtx = 16384.0
	modelsRoot, _ := root["models"].(map[string]interface{})
	if modelsRoot == nil {
		return false
	}
	provs, _ := modelsRoot["providers"].(map[string]interface{})
	if provs == nil {
		return false
	}
	for _, pv := range provs {
		p, ok := pv.(map[string]interface{})
		if !ok {
			continue
		}
		apiStr := strings.ToLower(strings.TrimSpace(fmt.Sprint(p["api"])))
		if apiStr != "ollama" {
			continue
		}
		arr, _ := p["models"].([]interface{})
		for _, mv := range arr {
			m, ok := mv.(map[string]interface{})
			if !ok {
				continue
			}
			cw, ok := openClawContextWindowAsFloat(m["contextWindow"])
			if !ok || cw >= minCtx {
				continue
			}
			m["contextWindow"] = fixCtx
			changed = true
		}
	}
	return
}

// openClawApplyBuiltInRemediations 合并平台内置项（与 ConfigMap / Pod init 语义一致）：跨域 allowedOrigins、chat 端点、Ollama contextWindow、移除无效的 agents.defaults.tools。
func openClawApplyBuiltInRemediations(raw string) (newJSON string, steps []string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil, errors.New("openclaw.json 为空")
	}
	var root map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return "", nil, err
	}
	if patchOpenClawAllowedOriginsIfEmpty(root) {
		steps = append(steps, "已补齐 gateway.controlUi.allowedOrigins 为 [\"*\"]（原缺失或为空）")
	}
	if patchOpenClawChatCompletionsIfDisabled(root) {
		steps = append(steps, "已开启 gateway.http.endpoints.chatCompletions.enabled（探活/对话 HTTP 404 常见项）")
	}
	if patchOpenClawOllamaContextWindowIfBelowMin(root) {
		steps = append(steps, "已将 models.providers 中 api=ollama 且 contextWindow<16000 的模型登记抬到 16384（避免嵌入式 agent min context 报错）")
	}
	if StripOpenClawLegacyAgentDefaultsTools(root) {
		steps = append(steps, "已移除 agents.defaults.tools（OpenClaw 仅允许根级 tools 与 agents.list[].tools）")
	}
	if OpenClawMergeElevatedWebchatForK8s(root) {
		steps = append(steps, "已补齐 tools.elevated（含 webchat allowFrom），避免 Control UI / webchat 下 exec 报 elevated unavailable")
	}
	if len(steps) == 0 {
		return raw, nil, nil
	}
	b, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return "", nil, err
	}
	s := string(b)
	if err := validateOpenClawConfigJSON(s); err != nil {
		return "", nil, err
	}
	return s, steps, nil
}

func validateOpenClawConfigJSON(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return errors.New("openclaw.json 不能为空")
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return fmt.Errorf("openclaw.json 不是合法 JSON: %w", err)
	}
	if _, ok := root["gateway"]; !ok {
		return errors.New("缺少 gateway 段，OpenClaw 网关无法正常启动")
	}
	return nil
}

func openClawPickGatewayPod(ctx context.Context, k8s *kubernetes.Clientset, ns, depName string) (string, error) {
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	if ns == "" || depName == "" {
		return "", errors.New("缺少命名空间或 Deployment")
	}
	ls := "app=" + depName
	pods, err := k8s.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: ls})
	if err != nil {
		return "", err
	}
	var runningFallback string
	for i := range pods.Items {
		p := &pods.Items[i]
		if p.Status.Phase != corev1.PodRunning {
			continue
		}
		if runningFallback == "" {
			runningFallback = p.Name
		}
		for _, cs := range p.Status.ContainerStatuses {
			if cs.Name == "gateway" && cs.Ready {
				return p.Name, nil
			}
		}
	}
	if runningFallback != "" {
		return runningFallback, nil
	}
	return "", errors.New("没有处于 Running 的网关 Pod，请等待调度与镜像拉取完成")
}

func openClawAbsPath(rel string) string {
	return path.Clean(openClawHomeMount + "/" + rel)
}

func openClawReadFileFromPod(
	ctx context.Context,
	k8s *kubernetes.Clientset,
	rc *rest.Config,
	ns, podName, absPath string,
) ([]byte, error) {
	readScript := fmt.Sprintf(`f=%s
if [ ! -f "$f" ]; then echo KUBEBT_MISSING; exit 0; fi
sz=$(stat -c '%%s' "$f" 2>/dev/null || echo 0)
if [ "$sz" -gt %d ]; then echo TOOBIG; exit 1; fi
base64 -w0 "$f" 2>/dev/null || base64 "$f" | tr -d '\n'
`, shellQuoteSingle(absPath), openClawFileMaxReadBytes)
	cmd := []string{"/bin/sh", "-c", readScript}
	stdout, stderr, err := k8sPodExecRun(ctx, k8s, rc, ns, podName, "gateway", cmd, nil)
	out := strings.TrimSpace(stdout.String())
	if out == "KUBEBT_MISSING" {
		return nil, errOpenClawFileMissing
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	if out == "TOOBIG" {
		return nil, fmt.Errorf("文件超过 %d 字节", openClawFileMaxReadBytes)
	}
	raw, err := base64.StdEncoding.DecodeString(out)
	if err != nil {
		return nil, fmt.Errorf("解码失败: %w", err)
	}
	return raw, nil
}

var errOpenClawFileMissing = errors.New("文件不存在")

func openClawWriteFileToPod(
	ctx context.Context,
	k8s *kubernetes.Clientset,
	rc *rest.Config,
	ns, podName, absPath string,
	body []byte,
) error {
	if len(body) > openClawFileMaxWrite {
		return fmt.Errorf("内容超过 %d 字节", openClawFileMaxWrite)
	}
	parent := path.Dir(absPath)
	mkdirCmd := []string{"/bin/sh", "-c", fmt.Sprintf(`mkdir -p %s`, shellQuoteSingle(parent))}
	if _, stderr, err := k8sPodExecRun(ctx, k8s, rc, ns, podName, "gateway", mkdirCmd, nil); err != nil {
		return fmt.Errorf("mkdir: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	cmd := []string{"/bin/sh", "-c", fmt.Sprintf(`cat > %s`, shellQuoteSingle(absPath))}
	stdin := bytes.NewReader(body)
	_, stderr, err := k8sPodExecRun(ctx, k8s, rc, ns, podName, "gateway", cmd, stdin)
	if err != nil {
		return fmt.Errorf("写入: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func appOpenClawFileReadAllowed(c *gin.Context) bool {
	if getDashboardRoleFromGin(c) == DashboardRoleAdmin {
		return true
	}
	eff := getEffectiveDashboardPermissionsFromGin(c)
	if eff.LegacyViewer {
		return false
	}
	return normalizeModuleAccess(eff.AppCenter) != ModuleAccessNone
}

func handleAppOpenClawFileGet(c *gin.Context, app *ServerApp) {
	if !appOpenClawFileReadAllowed(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	if !GuardK8sREST(c, app.K8s(), app.K8sREST()) {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	rel, err := openClawSanitizeRelPath(c.Query("path"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()
	podName, err := openClawPickGatewayPod(ctx, app.K8s(), inst.Namespace, inst.DeploymentName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	abs := openClawAbsPath(rel)
	raw, err := openClawReadFileFromPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, podName, abs)
	if err != nil {
		if errors.Is(err, errOpenClawFileMissing) {
			c.JSON(http.StatusOK, gin.H{"path": rel, "missing": true, "content": ""})
			return
		}
		if msg, code := classifyPVCExecEnvironmentError(err, ""); code != "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg, "code": code})
			return
		}
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"path":    rel,
		"missing": false,
		"content": string(raw),
	})
}

type appOpenClawFilePutBody struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func handleAppOpenClawFilePut(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	if !GuardK8sREST(c, app.K8s(), app.K8sREST()) {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body appOpenClawFilePutBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rel, err := openClawSanitizeRelPath(body.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rel == "openclaw.json" {
		if err := validateOpenClawConfigJSON(body.Content); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()
	podName, err := openClawPickGatewayPod(ctx, app.K8s(), inst.Namespace, inst.DeploymentName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	abs := openClawAbsPath(rel)
	if err := openClawWriteFileToPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, podName, abs, []byte(body.Content)); err != nil {
		if msg, code := classifyPVCExecEnvironmentError(err, ""); code != "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg, "code": code})
			return
		}
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "path": rel, "bytes": len(body.Content)})
}

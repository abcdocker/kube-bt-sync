package internal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
)

const (
	openClawGatewayPort = int32(18789)
	// Full（:main）含完整工具链；:slim 体积更小但能力受限（偏问答）。
	openClawDefaultImage = "ghcr.io/openclaw/openclaw:main"
	// OpenClawPlatformInitRevision 递增表示平台对第二个 init（PVC 默认项补丁）或模板有行为变更；与 Pod 模板注解对照。
	OpenClawPlatformInitRevision      = 2
	openClawInitRevisionAnnotationKey = "kube-bt-sync.io/openclaw-init-revision"
)

// OpenClawK8sDeployOpts 一键部署 OpenClaw 网关（NodePort 或 ClusterIP+Ingress + 预置 ClusterRole 绑定）。
type OpenClawK8sDeployOpts struct {
	Namespace      string
	DeploymentName string
	ServiceName    string
	NodePort       int32
	// ExposeMode：nodeport（0=集群随机分配 NodePort）| ingress（仅 ClusterIP，并创建 Ingress 走宝塔同步）
	ExposeMode          string
	IngressName         string
	IngressHost         string
	IngressTLSScheme    string // https | http，用于登记对外 Base URL
	BaotaSyncAnnotation string // i4t | kube-bt
	Image               string
	// InitContainerImage init 容器镜像（拷贝 ConfigMap 到 PVC）；空则 busybox:1.36，可改为内网镜像仓库
	InitContainerImage string
	OpenAIAPIKey       string
	OpenAIBaseURL      string
	GeminiAPIKey       string
	ModelPreset        string
	ChatModel          string // 上游模型名（Ollama/千问/Kimi 等）
	HttpProxyURL       string // 可选：网关访问上游 OpenAI 等使用的 HTTP(S) 代理
	// RBACPreset 网关 ServiceAccount 绑定的集群权限：readonly | edit | admin；空同 readonly
	RBACPreset string
	// ToolsProfile 写入 openclaw.json 的 tools.profile（minimal | coding | full）；空同 full
	ToolsProfile string
	// PromptPacks 勾选提示词包 ID，合并进 ConfigMap 中 SOUL.md / AGENTS.md
	PromptPacks []string
}

func randomGatewayToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func openClawGatewayModelRefForPreset(preset, chatModel string) string {
	model := strings.TrimSpace(chatModel)
	if model == "" {
		model = mapModelPresetToAPI(preset)
	}
	if model == "" {
		return ""
	}
	switch strings.TrimSpace(preset) {
	case "minimax-m2.5", "minimax-m2.7":
		return "minimax/" + model
	case "glm-4.7":
		return "zhipu/" + model
	case "qwen-compatible":
		return "qwen/" + model
	case "kimi":
		return "kimi/" + model
	case "ollama":
		return "ollama/" + model
	case "custom":
		return "custom-openai/" + model
	case "openai":
		return "openai/" + model
	default:
		if strings.Contains(model, "/") {
			return model
		}
		return "openai/" + model
	}
}

func openClawNormalizeProviderBaseURL(preset, base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return ""
	}
	switch strings.TrimSpace(preset) {
	case "ollama":
		return strings.TrimSuffix(base, "/v1")
	default:
		return base
	}
}

func openClawProviderConfigForPreset(preset, baseURL, chatModel string) (string, map[string]interface{}) {
	model := strings.TrimSpace(chatModel)
	if model == "" {
		model = mapModelPresetToAPI(preset)
	}
	if model == "" {
		return "", nil
	}
	baseURL = openClawNormalizeProviderBaseURL(preset, baseURL)
	buildModel := func(id string, reasoning bool, ctxWin, maxTok int) map[string]interface{} {
		return map[string]interface{}{
			"id":            id,
			"name":          id,
			"reasoning":     reasoning,
			"input":         []string{"text"},
			"contextWindow": ctxWin,
			"maxTokens":     maxTok,
			"cost": map[string]float64{
				"input":      0,
				"output":     0,
				"cacheRead":  0,
				"cacheWrite": 0,
			},
		}
	}
	switch strings.TrimSpace(preset) {
	case "minimax-m2.5", "minimax-m2.7":
		return "minimax", map[string]interface{}{
			"baseUrl": baseURL,
			"apiKey":  "${OPENAI_API_KEY}",
			"api":     "openai-completions",
			"models": []map[string]interface{}{
				buildModel(model, true, 200000, 8192),
				buildModel("MiniMax-M2.7", true, 200000, 8192),
				buildModel("MiniMax-M2.7-highspeed", true, 200000, 8192),
				buildModel("MiniMax-M2.5", true, 200000, 8192),
			},
		}
	case "glm-4.7":
		return "zhipu", map[string]interface{}{
			"baseUrl": baseURL,
			"apiKey":  "${OPENAI_API_KEY}",
			"api":     "openai-completions",
			"models":  []map[string]interface{}{buildModel(model, true, 128000, 8192)},
		}
	case "qwen-compatible":
		return "qwen", map[string]interface{}{
			"baseUrl": baseURL,
			"apiKey":  "${OPENAI_API_KEY}",
			"api":     "openai-completions",
			"models":  []map[string]interface{}{buildModel(model, false, 128000, 8192)},
		}
	case "kimi":
		return "kimi", map[string]interface{}{
			"baseUrl": baseURL,
			"apiKey":  "${OPENAI_API_KEY}",
			"api":     "openai-completions",
			"models":  []map[string]interface{}{buildModel(model, false, 128000, 8192)},
		}
	case "ollama":
		// OpenClaw 嵌入式 agent 常见下限 16000 tokens；Ollama 侧 qwen2.5:14b-16k 等实际多为 16k+，登记 16384 避免被拦。
		return "ollama", map[string]interface{}{
			"baseUrl": baseURL,
			"apiKey":  "${OLLAMA_API_KEY}",
			"api":     "ollama",
			"models":  []map[string]interface{}{buildModel(model, false, 16384, 81920)},
		}
	case "custom":
		return "custom-openai", map[string]interface{}{
			"baseUrl": baseURL,
			"apiKey":  "${OPENAI_API_KEY}",
			"api":     "openai-completions",
			"models":  []map[string]interface{}{buildModel(model, false, 128000, 8192)},
		}
	default:
		return "", nil
	}
}

func openClawConfigMapData(opts OpenClawK8sDeployOpts) map[string]string {
	tp := NormalizeOpenClawToolsProfile(opts.ToolsProfile)
	modelRef := openClawGatewayModelRefForPreset(opts.ModelPreset, opts.ChatModel)
	root := map[string]interface{}{
		"gateway": map[string]interface{}{
			"mode": "local",
			"bind": "lan",
			"port": 18789,
			"auth": map[string]interface{}{
				"mode": "token",
			},
			"http": map[string]interface{}{
				"endpoints": map[string]interface{}{
					"chatCompletions": map[string]interface{}{
						"enabled": true,
					},
				},
			},
			"controlUi": map[string]interface{}{
				"enabled":        true,
				"allowedOrigins": []string{"*"},
			},
		},
		"tools": map[string]interface{}{
			"profile":  tp,
			"elevated": openClawDefaultElevatedForWebchat(),
		},
		"agents": map[string]interface{}{
			"defaults": map[string]interface{}{
				"workspace": "~/.openclaw/workspace",
				"sandbox": map[string]interface{}{
					"mode": "off",
				},
			},
			"list": []map[string]interface{}{
				{
					"id":        "default",
					"name":      "OpenClaw Assistant",
					"workspace": "~/.openclaw/workspace",
					"sandbox": map[string]interface{}{
						"mode": "off",
					},
					"tools": map[string]interface{}{
						"profile":  tp,
						"elevated": openClawDefaultElevatedForWebchat(),
					},
				},
			},
		},
		"channels": map[string]interface{}{
			"defaults": map[string]interface{}{
				"groupPolicy": "allowlist",
			},
		},
		"cron": map[string]interface{}{
			"enabled": false,
		},
	}
	if defs, ok := root["agents"].(map[string]interface{})["defaults"].(map[string]interface{}); ok && modelRef != "" {
		defs["model"] = map[string]interface{}{
			"primary":   modelRef,
			"fallbacks": []string{},
		}
	}
	if list, ok := root["agents"].(map[string]interface{})["list"].([]map[string]interface{}); ok && len(list) > 0 && modelRef != "" {
		list[0]["model"] = map[string]interface{}{
			"primary":   modelRef,
			"fallbacks": []string{},
		}
	}
	if providerID, providerCfg := openClawProviderConfigForPreset(opts.ModelPreset, opts.OpenAIBaseURL, opts.ChatModel); providerCfg != nil && providerID != "" {
		root["models"] = map[string]interface{}{
			"mode": "merge",
			"providers": map[string]interface{}{
				providerID: providerCfg,
			},
		}
	}
	js, _ := json.MarshalIndent(root, "", "  ")
	// 基于官方 scripts/k8s/manifests/configmap.yaml，将 bind 改为 lan 以便 Service/NodePort 访问。
	// controlUi.allowedOrigins：网关 bind 为非 loopback 时，浏览器打开 Control UI 会校验 Origin，缺省会报
	// "origin not allowed"。NodePort 下来源为「任意节点 IP:端口」，Ingress 下为「https://域名」等，故默认放开 *；
	// 生产环境可在「详情」中改为仅列出可信来源（如 ["https://claw.example.com"]）。
	// 与官方文档一致：gateway.http.endpoints.chatCompletions.enabled 须为 true，否则 POST /v1/chat/completions 为 404。
	// tools.profile full + agents.defaults.sandbox off：集群 Pod 内无 Docker 沙箱；网关内 OpenClaw 通过 client-go 使用 Pod SA，与平台「管理员」RBAC（kube-bt-openclaw-admin）配合使用集群工具。
	bootMd := "# OpenClaw 使用说明（kube-bt-sync 预置）\n\n" +
		"## Control UI 提示 origin not allowed\n\n" +
		"在 **gateway.controlUi** 中设置 **allowedOrigins**（例如 [\"*\"] 或你的 https 域名）。\n" +
		"新部署的 ConfigMap 已默认写入；Pod 第二个 init 会在 PVC 上 **allowedOrigins 为空时** 自动补 `[\"*\"]`。修改后若仍报错请**滚动重启** Deployment。\n\n" +
		"## 巡检 / 代连返回 404（POST /v1/chat/completions）\n\n" +
		"OpenClaw 默认**关闭** OpenAI 兼容 HTTP 接口，须在 **gateway.http.endpoints.chatCompletions.enabled** 设为 **true**。\n" +
		"kube-bt-sync **新部署**的 ConfigMap 已默认开启；**Pod 启动时**第二个 init 会在 PVC 上自动补齐空的 `allowedOrigins` 与 `chatCompletions.enabled`。若仍 404，请在**应用中心 → 详情 → 配置文件**编辑 `openclaw.json` 后**滚动重启** Deployment。\n\n" +
		"## Ollama 模型 contextWindow 与「context too small / min 16000」\n\n" +
		"若网关日志提示 **Model context window too small**（例如登记为 8192 但嵌入式 agent 要求 ≥16000），请在 **models.providers.ollama.models** 里把对应条目的 **contextWindow** 调到 **16384** 或以上（与 `ollama ps` 的 CONTEXT 对齐）。平台**新部署**的 Ollama 预设已默认 16384；第二个 init 也会把已有 PVC 上 **api=ollama** 且 **contextWindow 小于 16000** 的条目自动抬到 16384。\n" +
		"若仍要放宽其它策略，请查阅你使用的 OpenClaw 版本文档（部分版本可在配置中调整 embedded 相关下限）。**换模型**：在 **agents.defaults.model.fallbacks** 中加入已在 `models.providers` 登记的其它 model id。\n\n" +
		"平台新部署会将预设模型直接写入 **agents.defaults.model.primary**，并按预设生成对应 **models.providers** 条目；国内模型与 Ollama 不再依赖默认 anthropic 回退。\n\n" +
		"## 应用中心「大模型预设」与 Secret（留空 Base URL 时）\n\n" +
		"创建向导**默认**为 **MiniMax M2.7**；切换预设时请同步填写对应厂商 API Key，必要时覆盖 `OPENAI_BASE_URL`。\n\n" +
		"| 预设 | 平台写入的 provider | Base URL（未覆盖时） | 默认 model（可改「上游模型名」） |\n" +
		"|------|-----------------------------|-----------------------------------|\n" +
		"| minimax-m2.7 | `minimax` | `https://api.minimaxi.com/v1` 或 `https://api.minimax.io/v1` | `MiniMax-M2.7`（可选 `MiniMax-M2.7-highspeed`） |\n" +
		"| minimax-m2.5 | `minimax` | 同上 | `MiniMax-M2.5` |\n" +
		"| openai | `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` 等 |\n" +
		"| glm-4.7 | `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7` |\n" +
		"| qwen-compatible | `qwen` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` 等 |\n" +
		"| kimi | `kimi` | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` 等 |\n" +
		"| ollama | `ollama` | 须自填集群内原生地址（**不要** `/v1`） | 填本集群已 pull 的模型名 |\n" +
		"| custom | 须自填 | 须自填 |\n\n" +
		"## openclaw message send 报 Channel is required\n\n" +
		"CLI 发消息**至少**要配置一种**对外通道**（Telegram、WhatsApp、Discord 等），否则会出现 *no configured channels detected*。\n" +
		"仅网关 + 模型 API **不等于**已配置消息通道。\n\n" +
		"示例（Telegram，需真实 Bot Token）：\n\n" +
		"```json\n" +
		"\"channels\": {\n" +
		"  \"telegram\": {\n" +
		"    \"enabled\": true,\n" +
		"    \"botToken\": \"YOUR_BOT_TOKEN\",\n" +
		"    \"dmPolicy\": \"pairing\"\n" +
		"  }\n" +
		"}\n" +
		"```\n\n" +
		"WhatsApp 需 Web 配对与 channels.whatsapp 等配置，见官方文档：https://docs.openclaw.ai/gateway/configuration-reference\n\n" +
		"配置写入 PVC 上的 openclaw.json 后，若网关未热加载，请对该 Deployment **滚动重启**。\n\n" +
		"## 多套网关数据隔离（kube-bt-sync）\n\n" +
		"平台按 Deployment 名创建独立 PVC（openclaw-home-<Deployment>）及同名前缀的 Secret/ConfigMap/ServiceAccount；同命名空间内多套 OpenClaw 的 SOUL.md、openclaw.json 等互不共用。旧环境若曾共用 openclaw-home-pvc，请删除后按当前版本重建以彻底分开。\n\n" +
		"## Control UI / webchat 下 exec 报 elevated unavailable\n\n" +
		"若日志含 **elevated is not available** 与 **runtime=direct**，须在 **openclaw.json** 根级 **tools.elevated.enabled: true**，并配置 **tools.elevated.allowFrom.webchat**（平台预置为 `[\"*\"]`，与 **agents.list[].tools.elevated** 同步）。修改后**滚动重启**网关 Deployment。\n\n" +
		"## 集群 API 权限（RBAC）与「Full + 管理员」\n\n" +
		"应用中心 **Full** 部署模式对应本预置 **openclaw.json**（`tools.profile: full`、默认 agent 关闭沙箱）。**管理员**档将网关 SA 绑定到平台 ClusterRole **`kube-bt-openclaw-admin`**（verbs `*` 于全部资源）；OpenClaw 在 Pod 内用 **client-go** 走 Kubernetes API，**未授权即由 API Server 拒绝**，与是否安装 kubectl 无关。该 ClusterRole 不是内置名 `cluster-admin`，但能力同级，请仅在可信环境使用。\n\n" +
		"网关 Pod 必须使用专用 ServiceAccount（名称规则：openclaw- 加上 Deployment 名），并由 ClusterRoleBinding 绑定到上述预置 ClusterRole。在**详情 → 管理配置**中调整权限档时，平台会更新绑定并**自动滚动重启** Deployment。若集群内 Deployment 仍为 default 等其它 ServiceAccount，仅更新绑定不会生效，需由平台对齐 Pod 身份或你在 YAML 中改 spec.template.spec.serviceAccountName。\n\n" +
		"## 对话里提示「没有权限」查集群 / 改资源\n\n" +
		"这与 **Kubernetes RBAC** 是两层事：ServiceAccount 经 ClusterRoleBinding 获得的权限决定 **client-go** 调用是否被 API Server 放行；OpenClaw 还要在 **openclaw.json** 里允许智能体使用工具。\n\n" +
		"请在 **openclaw.json** 根级加入 **`tools.profile`: `\"full\"`**（或至少 `\"coding\"` 以含 exec），并在 **`agents.defaults.sandbox`** 设 **`mode`: `\"off\"`**：平台 Pod 内通常**没有 Docker 沙箱**，默认沙箱策略会导致 exec 等工具不可用。工具档位只能写在**根级 `tools`** 或 **`agents.list[]` 单条 agent** 上，**不要**写在 `agents.defaults`（会触发配置校验错误）。\n\n" +
		"修改 PVC 上的 openclaw.json 后若未热加载，请对该 Deployment **滚动重启**。\n\n" +
		"## 人格与能力说明（预置）\n\n" +
		"首次启动时 init 会将 ConfigMap 中的 **workspace/SOUL.md**（中文人格与边界）、**workspace/AGENTS.md**（英文能力说明）、**BOOT.md** 拷入 PVC。若已存在则不会覆盖；要换新模板可删除对应文件后滚动重启 Pod，或直接在「详情 → 配置文件」编辑。\n"
	return map[string]string{
		"openclaw.json": strings.TrimSpace(string(js)),
		"AGENTS.md":     strings.TrimSpace(OpenClawBuildAGENTSMarkdown(opts.PromptPacks)),
		"SOUL.md":       strings.TrimSpace(OpenClawBuildSOULMarkdown(opts.PromptPacks)),
		"BOOT.md":       strings.TrimSpace(bootMd),
	}
}

// ApplyOpenClawToCluster 创建 Namespace、PVC、ConfigMap、Secret、SA、RBAC、Deployment、Service(NodePort)。
func ApplyOpenClawToCluster(ctx context.Context, k8s *kubernetes.Clientset, nodeAccessIP string, opts OpenClawK8sDeployOpts) (AppOpenClawInstance, string, error) {
	var zero AppOpenClawInstance
	ns := strings.TrimSpace(opts.Namespace)
	if ns == "" {
		return zero, "", fmt.Errorf("请填写命名空间")
	}
	depName := strings.TrimSpace(opts.DeploymentName)
	if depName == "" {
		return zero, "", fmt.Errorf("请填写 Deployment 名称（Kubernetes DNS 标签）")
	}
	svcName := strings.TrimSpace(opts.ServiceName)
	if svcName == "" {
		return zero, "", fmt.Errorf("请填写 Service 名称")
	}
	expose := strings.ToLower(strings.TrimSpace(opts.ExposeMode))
	if expose == "" {
		expose = "nodeport"
	}
	img := strings.TrimSpace(opts.Image)
	if img == "" {
		img = openClawDefaultImage
	}
	initImg := strings.TrimSpace(opts.InitContainerImage)
	if initImg == "" {
		initImg = "busybox:1.36"
	}
	if expose == "nodeport" {
		if err := ValidateOptionalK8sNodePort("nodePort", opts.NodePort); err != nil {
			return zero, "", err
		}
	}
	if err := ValidateK8sDeploymentName(depName); err != nil {
		return zero, "", err
	}
	if err := ValidateK8sDeploymentName(svcName); err != nil {
		return zero, "", err
	}

	gwToken := randomGatewayToken()
	if err := ensureNamespace(ctx, k8s, ns); err != nil {
		return zero, "", err
	}

	pvcClaim := openClawPVCClaimName(depName)
	cmName := openClawConfigMapObjectName(depName)
	secName := openClawSecretObjectName(depName)
	saName := openClawServiceAccountName(depName)

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pvcClaim,
			Namespace: ns,
			Labels:    map[string]string{"app": depName, "kube-bt-sync.io/openclaw": "true"},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources: corev1.ResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")},
			},
		},
	}
	if _, err := k8s.CoreV1().PersistentVolumeClaims(ns).Create(ctx, pvc, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return zero, "", err
	}

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      cmName,
			Namespace: ns,
			Labels:    map[string]string{"app": depName},
		},
		Data: openClawConfigMapData(opts),
	}
	if _, err := k8s.CoreV1().ConfigMaps(ns).Create(ctx, cm, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return zero, "", err
	}

	sd := map[string]string{
		"OPENCLAW_GATEWAY_TOKEN": gwToken,
	}
	if strings.TrimSpace(opts.OpenAIAPIKey) != "" {
		sd["OPENAI_API_KEY"] = strings.TrimSpace(opts.OpenAIAPIKey)
	}
	if strings.TrimSpace(opts.OpenAIBaseURL) != "" {
		sd["OPENAI_BASE_URL"] = strings.TrimSpace(opts.OpenAIBaseURL)
	}
	if strings.TrimSpace(opts.ModelPreset) == "ollama" {
		ollamaKey := strings.TrimSpace(opts.OpenAIAPIKey)
		if ollamaKey == "" {
			ollamaKey = "ollama-local"
		}
		sd["OLLAMA_API_KEY"] = ollamaKey
	}
	if strings.TrimSpace(opts.GeminiAPIKey) != "" {
		sd["GEMINI_API_KEY"] = strings.TrimSpace(opts.GeminiAPIKey)
	}
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secName,
			Namespace: ns,
			Labels:    map[string]string{"app": depName},
		},
		StringData: sd,
		Type:       corev1.SecretTypeOpaque,
	}
	if _, err := k8s.CoreV1().Secrets(ns).Create(ctx, sec, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return zero, "", err
	}

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      saName,
			Namespace: ns,
			Labels:    map[string]string{"app": depName},
		},
		AutomountServiceAccountToken: boolPtr(true),
	}
	if _, err := k8s.CoreV1().ServiceAccounts(ns).Create(ctx, sa, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return zero, "", err
	}
	rbacID := NormalizeOpenClawRBACPreset(opts.RBACPreset)
	roleName := OpenClawClusterRoleForPreset(rbacID)
	if err := EnsureOpenClawClusterRoles(ctx, k8s); err != nil {
		return zero, "", err
	}
	crbName := openClawClusterRoleBindingName(ns, depName)
	if err := ReconcileOpenClawRBACBinding(ctx, k8s, ns, saName, crbName, roleName, rbacID); err != nil {
		return zero, "", err
	}

	dep := openClawDeployment(ns, depName, img, initImg, pvcClaim, cmName, secName, saName, opts.HttpProxyURL)
	if _, err := k8s.AppsV1().Deployments(ns).Create(ctx, dep, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return zero, "", err
	}

	svcType := corev1.ServiceTypeNodePort
	if expose == "ingress" {
		svcType = corev1.ServiceTypeClusterIP
	}
	svcPort := corev1.ServicePort{
		Name:       "gateway",
		Port:       openClawGatewayPort,
		TargetPort: intstr.FromInt(int(openClawGatewayPort)),
		Protocol:   corev1.ProtocolTCP,
	}
	if expose == "nodeport" && opts.NodePort > 0 {
		svcPort.NodePort = opts.NodePort
	}
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      svcName,
			Namespace: ns,
			Labels:    map[string]string{"app": depName},
		},
		Spec: corev1.ServiceSpec{
			Type:     svcType,
			Selector: map[string]string{"app": depName},
			Ports:    []corev1.ServicePort{svcPort},
		},
	}
	svcObj, err := k8s.CoreV1().Services(ns).Create(ctx, svc, metav1.CreateOptions{})
	if err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return zero, "", err
		}
		svcObj, err = k8s.CoreV1().Services(ns).Get(ctx, svcName, metav1.GetOptions{})
		if err != nil {
			return zero, "", err
		}
	}
	var np int32
	if len(svcObj.Spec.Ports) > 0 {
		np = svcObj.Spec.Ports[0].NodePort
	}

	clusterBase := fmt.Sprintf("http://%s.%s.svc.cluster.local:%d/v1", svcName, ns, openClawGatewayPort)
	ext := ""
	if expose == "nodeport" && strings.TrimSpace(nodeAccessIP) != "" && np > 0 {
		ext = fmt.Sprintf("http://%s:%d/v1", strings.TrimSpace(nodeAccessIP), np)
	}

	publicV1 := ""
	ingHost := strings.TrimSpace(opts.IngressHost)
	ingResName := ""
	if expose == "ingress" && ingHost != "" {
		scheme := strings.ToLower(strings.TrimSpace(opts.IngressTLSScheme))
		if scheme != "http" {
			scheme = "https"
		}
		publicV1 = fmt.Sprintf("%s://%s/v1", scheme, ingHost)
		ingName := strings.TrimSpace(opts.IngressName)
		if ingName == "" {
			ingName = depName + "-ingress"
		}
		ingResName = ingName
		syncKey := "i4t.com/baota-sync"
		if strings.TrimSpace(opts.BaotaSyncAnnotation) == "kube-bt" {
			syncKey = "kube-bt-sync.io/baota-sync"
		}
		ic := "nginx"
		pt := networkingv1.PathTypePrefix
		ing := &networkingv1.Ingress{
			ObjectMeta: metav1.ObjectMeta{
				Name:      ingName,
				Namespace: ns,
				Labels:    map[string]string{"app": depName, "kube-bt-sync.io/openclaw": "true"},
				Annotations: map[string]string{
					"kubernetes.io/ingress.class": "nginx",
					syncKey:                       "true",
				},
			},
			Spec: networkingv1.IngressSpec{
				IngressClassName: &ic,
				Rules: []networkingv1.IngressRule{
					{
						Host: ingHost,
						IngressRuleValue: networkingv1.IngressRuleValue{
							HTTP: &networkingv1.HTTPIngressRuleValue{
								Paths: []networkingv1.HTTPIngressPath{
									{
										Path:     "/",
										PathType: &pt,
										Backend: networkingv1.IngressBackend{
											Service: &networkingv1.IngressServiceBackend{
												Name: svcName,
												Port: networkingv1.ServiceBackendPort{Number: openClawGatewayPort},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		}
		if _, err := k8s.NetworkingV1().Ingresses(ns).Create(ctx, ing, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
			return zero, "", fmt.Errorf("创建 Ingress: %w", err)
		}
	}

	inst := AppOpenClawInstance{
		DisplayName:         depName,
		Namespace:           ns,
		DeploymentName:      depName,
		ServiceName:         svcName,
		Image:               img,
		GatewayPort:         int(openClawGatewayPort),
		NodePort:            np,
		ModelPreset:         strings.TrimSpace(opts.ModelPreset),
		ClusterV1BaseURL:    clusterBase,
		ExternalV1URL:       ext,
		NodeAccessIP:        strings.TrimSpace(nodeAccessIP),
		ExposeMode:          expose,
		IngressHost:         ingHost,
		IngressResourceName: ingResName,
		PublicV1URL:         publicV1,
		CreatedAt:           NowBeijingRFC3339(),
		ChatModel:           strings.TrimSpace(opts.ChatModel),
		PvcClaimName:        pvcClaim,
		SecretName:          secName,
		ConfigMapName:       cmName,
		ServiceAccountName:  saName,
		RBACPreset:          rbacID,
		ToolsProfile:        NormalizeOpenClawToolsProfile(opts.ToolsProfile),
		PromptPacks:         append([]string(nil), SanitizePromptPackIDs(opts.PromptPacks)...),
	}
	return inst, gwToken, nil
}

func boolPtr(b bool) *bool { return &b }

// PatchOpenClawGatewayHTTPProxy 更新网关 Deployment 的 HTTP(S)_PROXY 环境变量（空字符串则清除代理相关项）。
func PatchOpenClawGatewayHTTPProxy(ctx context.Context, k8s *kubernetes.Clientset, ns, depName, httpProxy string) error {
	if k8s == nil {
		return fmt.Errorf("K8s 未连接")
	}
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	if ns == "" || depName == "" {
		return fmt.Errorf("命名空间或 Deployment 名为空")
	}
	dep, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		return err
	}
	for i := range dep.Spec.Template.Spec.Containers {
		if dep.Spec.Template.Spec.Containers[i].Name != "gateway" {
			continue
		}
		secName := ""
		for _, e := range dep.Spec.Template.Spec.Containers[i].Env {
			if e.Name == "OPENCLAW_GATEWAY_TOKEN" && e.ValueFrom != nil && e.ValueFrom.SecretKeyRef != nil {
				secName = strings.TrimSpace(e.ValueFrom.SecretKeyRef.Name)
				break
			}
		}
		if secName == "" {
			return fmt.Errorf("无法从 Deployment 解析网关 Secret 名")
		}
		dep.Spec.Template.Spec.Containers[i].Env = openClawGatewayEnv(secName, httpProxy)
		_, err = k8s.AppsV1().Deployments(ns).Update(ctx, dep, metav1.UpdateOptions{})
		return err
	}
	return fmt.Errorf("未找到 gateway 容器")
}

// syncOpenClawPlatformInitContainer 将第二个 init 对齐为当前平台版脚本（含 chatCompletions / Full 缺省补丁），镜像与 gateway 主容器一致。
func syncOpenClawPlatformInitContainer(dep *appsv1.Deployment) {
	if dep == nil {
		return
	}
	var gwImg string
	for i := range dep.Spec.Template.Spec.Containers {
		if dep.Spec.Template.Spec.Containers[i].Name == "gateway" {
			gwImg = strings.TrimSpace(dep.Spec.Template.Spec.Containers[i].Image)
			break
		}
	}
	if gwImg == "" {
		return
	}
	for i := range dep.Spec.Template.Spec.InitContainers {
		n := dep.Spec.Template.Spec.InitContainers[i].Name
		if n != "ensure-openclaw-platform-defaults" && n != "ensure-control-ui-origin" {
			continue
		}
		dep.Spec.Template.Spec.InitContainers[i].Name = "ensure-openclaw-platform-defaults"
		dep.Spec.Template.Spec.InitContainers[i].Image = gwImg
		dep.Spec.Template.Spec.InitContainers[i].Command = []string{"node", "-e", openClawEnsurePVCDefaultsJS}
		if dep.Spec.Template.ObjectMeta.Annotations == nil {
			dep.Spec.Template.ObjectMeta.Annotations = map[string]string{}
		}
		dep.Spec.Template.ObjectMeta.Annotations[openClawInitRevisionAnnotationKey] = strconv.Itoa(OpenClawPlatformInitRevision)
		return
	}
}

// PatchOpenClawGatewayMainImage 更新网关主容器与第二个 init（Node 补丁脚本，曾用名 ensure-control-ui-origin）的镜像，触发滚动/重建。
func PatchOpenClawGatewayMainImage(ctx context.Context, k8s *kubernetes.Clientset, ns, depName, image string) error {
	if k8s == nil {
		return fmt.Errorf("K8s 未连接")
	}
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	image = strings.TrimSpace(image)
	if ns == "" || depName == "" {
		return fmt.Errorf("命名空间或 Deployment 名为空")
	}
	if image == "" {
		return fmt.Errorf("镜像地址不能为空")
	}
	dep, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		return err
	}
	foundGateway := false
	for i := range dep.Spec.Template.Spec.Containers {
		if dep.Spec.Template.Spec.Containers[i].Name == "gateway" {
			dep.Spec.Template.Spec.Containers[i].Image = image
			foundGateway = true
		}
	}
	if !foundGateway {
		return fmt.Errorf("Deployment 中未找到 gateway 容器")
	}
	syncOpenClawPlatformInitContainer(dep)
	_, err = k8s.AppsV1().Deployments(ns).Update(ctx, dep, metav1.UpdateOptions{})
	return err
}

// ReconcileOpenClawGatewayDeploymentIdentity 将网关 Deployment 的 Pod 绑定到与 ClusterRoleBinding 一致的 ServiceAccount，
// 并刷新 kubectl.kubernetes.io/restartedAt 触发滚动/重建，使网关进程使用新的 in-cluster 身份（旧环境常见 Pod 仍为 default SA，仅改 CRB 不会生效）。
func ReconcileOpenClawGatewayDeploymentIdentity(ctx context.Context, k8s *kubernetes.Clientset, ns, depName, saName string) error {
	if k8s == nil {
		return fmt.Errorf("K8s 未连接")
	}
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	saName = strings.TrimSpace(saName)
	if ns == "" || depName == "" || saName == "" {
		return fmt.Errorf("命名空间、Deployment 或 ServiceAccount 名为空")
	}
	dep, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		return err
	}
	pod := &dep.Spec.Template.Spec
	pod.ServiceAccountName = saName
	pod.AutomountServiceAccountToken = boolPtr(true)
	syncOpenClawPlatformInitContainer(dep)
	if dep.Spec.Template.ObjectMeta.Annotations == nil {
		dep.Spec.Template.ObjectMeta.Annotations = map[string]string{}
	}
	// 与 kubectl rollout restart 相同注解，强制换新 Pod（OpenClaw 可能在启动时缓存 K8s client）
	dep.Spec.Template.ObjectMeta.Annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	_, err = k8s.AppsV1().Deployments(ns).Update(ctx, dep, metav1.UpdateOptions{})
	return err
}

// openClawRolloutRestartDeployment 通过 kubectl.kubernetes.io/restartedAt 触发滚动重启，使网关重读 PVC 上 openclaw.json 等。
func openClawRolloutRestartDeployment(ctx context.Context, k8s *kubernetes.Clientset, ns, depName string) error {
	if k8s == nil {
		return fmt.Errorf("K8s 未连接")
	}
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	if ns == "" || depName == "" {
		return fmt.Errorf("命名空间或 Deployment 名为空")
	}
	dep, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if dep.Spec.Template.ObjectMeta.Annotations == nil {
		dep.Spec.Template.ObjectMeta.Annotations = map[string]string{}
	}
	dep.Spec.Template.ObjectMeta.Annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	_, err = k8s.AppsV1().Deployments(ns).Update(ctx, dep, metav1.UpdateOptions{})
	return err
}

func openClawWaitDeploymentRolloutReady(ctx context.Context, k8s *kubernetes.Clientset, ns, depName string, maxWait time.Duration) error {
	if k8s == nil {
		return fmt.Errorf("K8s 未连接")
	}
	ns = strings.TrimSpace(ns)
	depName = strings.TrimSpace(depName)
	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		d, err := k8s.AppsV1().Deployments(ns).Get(ctx, depName, metav1.GetOptions{})
		if err != nil {
			return err
		}
		if deploymentRolloutLooksReady(d) {
			return nil
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("Deployment 在 %s 内仍未就绪", maxWait)
}

func openClawInitCopyScript() string {
	// 仅首次写入 PVC，避免 Pod 重启覆盖用户已持久化的 openclaw.json / workspace 文件
	return `set -e
mkdir -p /home/node/.openclaw/workspace
mkdir -p /home/node/.openclaw/workspace/.openclaw
if [ ! -f /home/node/.openclaw/openclaw.json ]; then
  cp /config/openclaw.json /home/node/.openclaw/openclaw.json
fi
if [ ! -f /home/node/.openclaw/workspace/AGENTS.md ]; then
  cp /config/AGENTS.md /home/node/.openclaw/workspace/AGENTS.md 2>/dev/null || true
fi
if [ ! -f /home/node/.openclaw/workspace/BOOT.md ]; then
  cp /config/BOOT.md /home/node/.openclaw/workspace/BOOT.md 2>/dev/null || true
fi
if [ ! -f /home/node/.openclaw/workspace/SOUL.md ]; then
  cp /config/SOUL.md /home/node/.openclaw/workspace/SOUL.md 2>/dev/null || true
fi
`
}

// openClawEnsurePVCDefaultsJS 在 init 中运行：补齐平台对话/探活依赖项（与 Full 预置及 openClawApplyBuiltInRemediations 语义对齐）。
// 1) controlUi.allowedOrigins  2) chatCompletions.enabled  3) tools.profile / sandbox / tools.elevated(webchat)  4) Ollama provider models.contextWindow<16000 → 16384
const openClawEnsurePVCDefaultsJS = `const fs=require('fs');const MINCTX=16000;const FIXCTX=16384;function patchOllamaCtx(j){let ch=false;try{const provs=j.models&&j.models.providers;if(!provs||typeof provs!=='object')return false;for(const k of Object.keys(provs)){const p=provs[k];if(!p||typeof p!=='object')continue;if(String(p.api||'').toLowerCase()!=='ollama')continue;const arr=p.models;if(!Array.isArray(arr))continue;for(const m of arr){if(!m||typeof m!=='object')continue;const c=Number(m.contextWindow);if(Number.isFinite(c)&&c<MINCTX){m.contextWindow=FIXCTX;ch=true;}}}}catch(e){}return ch;}function stripBadDefaultsTools(j){try{const d=j.agents&&j.agents.defaults;if(d&&typeof d==='object'&&d.tools!==undefined){delete d.tools;return true;}}catch(e){}return false;}function patchElevatedWebchat(j){let ch=false;try{function bump(t){if(!t||typeof t!=='object')return;t.elevated=t.elevated||{};if(t.elevated.enabled!==true){t.elevated.enabled=true;ch=true;}t.elevated.allowFrom=t.elevated.allowFrom||{};const wc=t.elevated.allowFrom.webchat;if(!Array.isArray(wc)||wc.length===0){t.elevated.allowFrom.webchat=['*'];ch=true;}}if(!j.tools)j.tools={};bump(j.tools);const lst=j.agents&&j.agents.list;if(Array.isArray(lst)){for(const it of lst){if(it&&typeof it==='object'){it.tools=it.tools||{};bump(it.tools);}}}}catch(e){}return ch;}const p='/home/node/.openclaw/openclaw.json';if(!fs.existsSync(p))process.exit(0);let j;try{j=JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){process.exit(0);}let w=false;j.gateway=j.gateway||{};j.gateway.controlUi=j.gateway.controlUi||{};const a=j.gateway.controlUi.allowedOrigins;if(!Array.isArray(a)||a.length===0){j.gateway.controlUi.allowedOrigins=['*'];if(j.gateway.controlUi.enabled===undefined)j.gateway.controlUi.enabled=true;w=true;}j.gateway.http=j.gateway.http||{};j.gateway.http.endpoints=j.gateway.http.endpoints||{};const cc=j.gateway.http.endpoints.chatCompletions=j.gateway.http.endpoints.chatCompletions||{};if(cc.enabled!==true){cc.enabled=true;w=true;}if(!j.tools)j.tools={};if(!('profile'in j.tools)||typeof j.tools.profile!=='string'||!String(j.tools.profile).trim()){j.tools.profile='full';w=true;}j.agents=j.agents||{};j.agents.defaults=j.agents.defaults||{};j.agents.defaults.sandbox=j.agents.defaults.sandbox||{};if(!('mode'in j.agents.defaults.sandbox)){j.agents.defaults.sandbox.mode='off';w=true;}if(stripBadDefaultsTools(j))w=true;if(patchElevatedWebchat(j))w=true;if(patchOllamaCtx(j))w=true;if(w)fs.writeFileSync(p,JSON.stringify(j,null,2));`

// openClawGatewayNoProxyLLMHosts 经 HTTP(S)_PROXY 访问公网时，部分代理会丢弃或改写 Authorization，MiniMax 易返回 1004（要求 Header 带 Key）。
// 对大模型厂商域名走直连，避免密钥未到上游。
const openClawGatewayNoProxyLLMHosts = "api.minimaxi.com,api.minimax.io,api.minimax.chat,api.openai.com,api.moonshot.cn,dashscope.aliyuncs.com,open.bigmodel.cn,generativelanguage.googleapis.com,api.anthropic.com"

func openClawGatewayEnv(secretName, httpProxy string) []corev1.EnvVar {
	env := []corev1.EnvVar{
		{Name: "HOME", Value: "/home/node"},
		{Name: "OPENCLAW_CONFIG_DIR", Value: "/home/node/.openclaw"},
		{Name: "NODE_ENV", Value: "production"},
		// 默认 V8 老生代约 ~1Gi，长连接 + 大 JSON/工具调用易触顶；与 gateway limits.memory=2Gi 对齐并留出堆外内存。
		{Name: "NODE_OPTIONS", Value: "--max-old-space-size=1536"},
		{Name: "OPENCLAW_GATEWAY_TOKEN", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: secretName}, Key: "OPENCLAW_GATEWAY_TOKEN"}}},
		{Name: "OPENAI_API_KEY", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: secretName}, Key: "OPENAI_API_KEY", Optional: boolPtr(true)}}},
		{Name: "OPENAI_BASE_URL", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: secretName}, Key: "OPENAI_BASE_URL", Optional: boolPtr(true)}}},
		{Name: "OLLAMA_API_KEY", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: secretName}, Key: "OLLAMA_API_KEY", Optional: boolPtr(true)}}},
		{Name: "GEMINI_API_KEY", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: secretName}, Key: "GEMINI_API_KEY", Optional: boolPtr(true)}}},
	}
	if p := strings.TrimSpace(httpProxy); p != "" {
		noProxy := "*.svc.cluster.local,*.cluster.local,127.0.0.1,localhost,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16," + openClawGatewayNoProxyLLMHosts
		env = append(env,
			corev1.EnvVar{Name: "HTTP_PROXY", Value: p},
			corev1.EnvVar{Name: "HTTPS_PROXY", Value: p},
			corev1.EnvVar{Name: "NO_PROXY", Value: noProxy},
		)
	}
	return env
}

func openClawDeployment(ns, depName, image, initImage, pvcClaim, configMapName, secretName, saName, httpProxy string) *appsv1.Deployment {
	lbl := map[string]string{"app": depName}
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      depName,
			Namespace: ns,
			Labels:    lbl,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: func() *int32 { v := int32(1); return &v }(),
			Selector: &metav1.LabelSelector{MatchLabels: lbl},
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: lbl,
					Annotations: map[string]string{
						openClawInitRevisionAnnotationKey: strconv.Itoa(OpenClawPlatformInitRevision),
					},
				},
				Spec: corev1.PodSpec{
					AutomountServiceAccountToken: boolPtr(true),
					ServiceAccountName:           saName,
					SecurityContext: &corev1.PodSecurityContext{
						FSGroup: func() *int64 { v := int64(1000); return &v }(),
					},
					InitContainers: []corev1.Container{
						{
							Name:    "init-config",
							Image:   initImage,
							Command: []string{"sh", "-c", openClawInitCopyScript()},
							SecurityContext: &corev1.SecurityContext{
								RunAsUser: func() *int64 { v := int64(1000); return &v }(),
							},
							VolumeMounts: []corev1.VolumeMount{
								{Name: "openclaw-home", MountPath: "/home/node/.openclaw"},
								{Name: "config", MountPath: "/config"},
							},
						},
						{
							Name:    "ensure-openclaw-platform-defaults",
							Image:   image,
							Command: []string{"node", "-e", openClawEnsurePVCDefaultsJS},
							SecurityContext: &corev1.SecurityContext{
								RunAsUser: func() *int64 { v := int64(1000); return &v }(),
							},
							VolumeMounts: []corev1.VolumeMount{
								{Name: "openclaw-home", MountPath: "/home/node/.openclaw"},
							},
						},
					},
					Containers: []corev1.Container{
						{
							Name:  "gateway",
							Image: image,
							Command: []string{
								"node", "/app/dist/index.js", "gateway", "run",
							},
							Ports: []corev1.ContainerPort{{Name: "gateway", ContainerPort: openClawGatewayPort, Protocol: corev1.ProtocolTCP}},
							Env:   openClawGatewayEnv(secretName, httpProxy),
							VolumeMounts: []corev1.VolumeMount{
								{Name: "openclaw-home", MountPath: "/home/node/.openclaw"},
								{Name: "tmp-volume", MountPath: "/tmp"},
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("512Mi"), corev1.ResourceCPU: resource.MustParse("250m")},
								Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2Gi"), corev1.ResourceCPU: resource.MustParse("1")},
							},
						},
					},
					Volumes: []corev1.Volume{
						{Name: "openclaw-home", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvcClaim}}},
						{Name: "config", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: configMapName}}}},
						{Name: "tmp-volume", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
					},
				},
			},
		},
	}
}

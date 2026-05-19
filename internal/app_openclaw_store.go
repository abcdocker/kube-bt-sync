package internal

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
)

const kvKeyAppOpenClawInstances = "kubebt_app_openclaw_instances_v1"

// AppOpenClawInstance 应用中心登记的 OpenClaw 网关（可多台；供页面访问与 AI 巡检选用）。
type AppOpenClawInstance struct {
	ID               string `json:"id"`
	DisplayName      string `json:"displayName"`
	Namespace        string `json:"namespace"`
	DeploymentName   string `json:"deploymentName"`
	ServiceName      string `json:"serviceName"`
	Image            string `json:"image"`
	GatewayPort      int    `json:"gatewayPort"`
	NodePort         int32  `json:"nodePort"`
	ModelPreset      string `json:"modelPreset"`
	GatewayTokenEnc  string `json:"gatewayTokenEnc"`
	ClusterV1BaseURL string `json:"clusterV1BaseURL"`
	ExternalV1URL    string `json:"externalV1Url"`
	NodeAccessIP     string `json:"nodeAccessIP,omitempty"`
	ExposeMode       string `json:"exposeMode,omitempty"` // nodeport | ingress
	IngressHost           string `json:"ingressHost,omitempty"`
	IngressResourceName   string `json:"ingressResourceName,omitempty"` // Ingress 对象名，删除时用；默认同 deployment + "-ingress"
	PublicV1URL           string `json:"publicV1Url,omitempty"`
	CreatedAt             string `json:"createdAt"`
	// 与 Deployment 绑定的 K8s 对象名（新部署必写）；旧数据为空时删除仍使用历史固定名 openclaw-home-pvc 等。
	PvcClaimName       string `json:"pvcClaimName,omitempty"`
	SecretName         string `json:"secretName,omitempty"`
	ConfigMapName      string `json:"configMapName,omitempty"`
	ServiceAccountName string `json:"serviceAccountName,omitempty"`
	// ChatModel 对话/巡检使用的上游模型名（Ollama 为 llama3.2 等；智谱/Minimax/Kimi 等为厂商 model id）；空则按 modelPreset 推断。
	ChatModel string `json:"chatModel,omitempty"`
	// ChatProxyCount 经本平台 POST …/chat 的累计次数（网关 Token 侧代理）。
	ChatProxyCount int64 `json:"chatProxyCount,omitempty"`
	// ChatProxyCountViewer 上述请求中 dashboard 角色为 viewer 的累计次数。
	ChatProxyCountViewer int64 `json:"chatProxyCountViewer,omitempty"`
	// UpstreamCheck* 最近一次「检测上游大模型」结果（读集群 Secret 直连 OPENAI_BASE_URL）。
	UpstreamCheckStatus   string `json:"upstreamCheckStatus,omitempty"` // ok | fail | ""
	UpstreamCheckMessage  string `json:"upstreamCheckMessage,omitempty"`
	UpstreamCheckAt       string `json:"upstreamCheckAt,omitempty"`
	// EgressCloudVmID 应用中心云主机 MySQL id（字符串），用于在 Pod 内做 Google 可达性检测等；Hysteria2 出站需配合 HttpProxyURL。
	EgressCloudVmID string `json:"egressCloudVmId,omitempty"`
	// HttpProxyURL 注入网关容器的 HTTP_PROXY/HTTPS_PROXY（如 http://云主机上 tinyproxy:3128）；直连 Hysteria 协议请用侧车或系统代理链。
	HttpProxyURL string `json:"httpProxyUrl,omitempty"`
	// RBACPreset 网关 SA 绑定的集群权限档：readonly | edit | admin（与 kube-bt-openclaw-* ClusterRole 对应）。
	RBACPreset string `json:"rbacPreset,omitempty"`
	// ToolsProfile 与 openclaw.json 中 tools.profile 一致：minimal | coding | full
	ToolsProfile string `json:"toolsProfile,omitempty"`
	// PromptPacks 已应用的提示词包 ID 列表（与 workspace SOUL/AGENTS 合并逻辑一致）
	PromptPacks []string `json:"promptPacks,omitempty"`
}

type appOpenClawInstancesPayload struct {
	Instances []AppOpenClawInstance `json:"instances"`
}

func loadAppOpenClawInstances(kv PlatformKV) ([]AppOpenClawInstance, error) {
	if kv == nil {
		return nil, errors.New("platform_kv 不可用")
	}
	raw, ok := kv.Get(kvKeyAppOpenClawInstances)
	if !ok || strings.TrimSpace(raw) == "" {
		return []AppOpenClawInstance{}, nil
	}
	var p appOpenClawInstancesPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return nil, err
	}
	if p.Instances == nil {
		return []AppOpenClawInstance{}, nil
	}
	return p.Instances, nil
}

func saveAppOpenClawInstances(kv PlatformKV, list []AppOpenClawInstance) error {
	if kv == nil {
		return errors.New("platform_kv 不可用")
	}
	b, err := json.Marshal(appOpenClawInstancesPayload{Instances: list})
	if err != nil {
		return err
	}
	return kv.Set(kvKeyAppOpenClawInstances, string(b))
}

func findAppOpenClawInstance(list []AppOpenClawInstance, id string) *AppOpenClawInstance {
	id = strings.TrimSpace(id)
	for i := range list {
		if list[i].ID == id {
			return &list[i]
		}
	}
	return nil
}

func appendAppOpenClawInstance(kv PlatformKV, inst AppOpenClawInstance) (AppOpenClawInstance, error) {
	list, err := loadAppOpenClawInstances(kv)
	if err != nil {
		return inst, err
	}
	if strings.TrimSpace(inst.ID) == "" {
		inst.ID = uuid.NewString()
	}
	list = append([]AppOpenClawInstance{inst}, list...)
	if err := saveAppOpenClawInstances(kv, list); err != nil {
		return inst, err
	}
	return inst, nil
}

func patchAppOpenClawInstance(kv PlatformKV, id string, mut func(*AppOpenClawInstance)) error {
	if kv == nil {
		return errors.New("platform_kv 不可用")
	}
	list, err := loadAppOpenClawInstances(kv)
	if err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	for i := range list {
		if list[i].ID == id {
			mut(&list[i])
			return saveAppOpenClawInstances(kv, list)
		}
	}
	return errors.New("实例不存在")
}

func removeAppOpenClawInstance(kv PlatformKV, id string) error {
	list, err := loadAppOpenClawInstances(kv)
	if err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	out := make([]AppOpenClawInstance, 0, len(list))
	for _, x := range list {
		if x.ID != id {
			out = append(out, x)
		}
	}
	return saveAppOpenClawInstances(kv, out)
}

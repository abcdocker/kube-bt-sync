package internal

import (
	"fmt"
	"strings"
)

// ResolveOpsOpenClawEndpoint 将「应用中心 OpenClaw」解析为实际 BaseURL + API Key（网关 Token）。
func ResolveOpsOpenClawEndpoint(app *ServerApp, cfg Config, b *OpsOpenClawBundle) error {
	if b == nil {
		return nil
	}
	src := strings.TrimSpace(b.OpenClaw.EndpointSource)
	if src != "appInstance" {
		return nil
	}
	id := strings.TrimSpace(b.OpenClaw.AppInstanceID)
	if id == "" {
		return fmt.Errorf("未选择应用中心 OpenClaw 实例")
	}
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		return err
	}
	inst := findAppOpenClawInstance(list, id)
	if inst == nil {
		return fmt.Errorf("OpenClaw 实例不存在")
	}
	key, err := opsEncryptionKey(cfg)
	if err != nil {
		return err
	}
	tok, err := decryptSecret(key, inst.GatewayTokenEnc)
	if err != nil || strings.TrimSpace(tok) == "" {
		return fmt.Errorf("无法解密网关 Token，请重新同步应用中心实例")
	}
	b.OpenClaw.BaseURL = strings.TrimSpace(inst.ClusterV1BaseURL)
	if b.OpenClaw.BaseURL == "" {
		return fmt.Errorf("实例缺少集群内 Base URL")
	}
	enc, err := encryptSecret(key, strings.TrimSpace(tok))
	if err != nil {
		return err
	}
	b.OpenClaw.APIKeyEnc = enc
	if strings.TrimSpace(b.OpenClaw.Model) == "" {
		b.OpenClaw.Model = MapOpenClawInstanceGatewayModelRef(inst)
	}
	return nil
}

// MapOpenClawInstanceChatModel 优先实例上保存的 chatModel，否则按 preset 给默认 model id。
func MapOpenClawInstanceChatModel(inst *AppOpenClawInstance) string {
	if inst == nil {
		return ""
	}
	if m := strings.TrimSpace(inst.ChatModel); m != "" {
		return m
	}
	if m := mapModelPresetToAPI(inst.ModelPreset); strings.TrimSpace(m) != "" {
		return m
	}
	return defaultOpenClawFallbackChatModelID
}

// openClawChatModelKVNeedsUpdate 判断是否需写入实例 chatModel 登记（避免「仅改 API 地址」时重复写入与当前 preset 默认相同的模型名）。
// newModel 来自表单：空表示恢复按 preset 推断（清除登记覆盖）。
func openClawChatModelKVNeedsUpdate(inst *AppOpenClawInstance, newModel string) (needsPatch bool, store string) {
	if inst == nil {
		return false, ""
	}
	newModel = strings.TrimSpace(newModel)
	st := strings.TrimSpace(inst.ChatModel)
	if newModel == "" {
		if st != "" {
			return true, ""
		}
		return false, ""
	}
	if st == newModel {
		return false, ""
	}
	if st == "" && newModel == MapOpenClawInstanceChatModel(inst) {
		return false, ""
	}
	return true, newModel
}

func MapOpenClawInstanceGatewayModelRef(inst *AppOpenClawInstance) string {
	if inst == nil {
		return ""
	}
	return openClawGatewayModelRefForPreset(strings.TrimSpace(inst.ModelPreset), MapOpenClawInstanceChatModel(inst))
}

func mapModelPresetToAPI(preset string) string {
	switch strings.TrimSpace(preset) {
	case "glm-4.7":
		return "glm-4.7"
	case "minimax-m2.5":
		return "MiniMax-M2.5"
	case "minimax-m2.7":
		return "MiniMax-M2.7"
	case "openai":
		return "gpt-4o-mini"
	case "ollama":
		return "llama3.2"
	case "qwen-compatible":
		return "qwen-turbo"
	case "kimi":
		return "moonshot-v1-8k"
	default:
		return preset
	}
}

// defaultOpenClawFallbackChatModelID 与创建向导默认预设 minimax-m2.7 对齐；无 chatModel 且 preset 未映射时的兜底。
// 探活会对 5xx 自动尝试 gpt-4o-mini / gpt-3.5-turbo，减轻「Secret 指向 OpenAI 但实例仍为 MiniMax id」时的误报。
const defaultOpenClawFallbackChatModelID = "MiniMax-M2.7"

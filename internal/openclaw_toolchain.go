package internal

import (
	"encoding/json"
	"errors"
	"strings"
)

// OpenClaw 工具链：根级 tools.profile；可按需在 agents.list[].tools 上按 agent 覆盖。
// agents.defaults 下不得包含 tools（当前 schema 会报 Unrecognized key）。
const (
	OpenClawToolsProfileMinimal = "minimal"
	OpenClawToolsProfileCoding  = "coding"
	OpenClawToolsProfileFull     = "full"
)

// 可选提示词片段 ID（写入 workspace/SOUL.md、AGENTS.md 的追加段）。
const (
	OpenClawPromptPackK8sExecuteFirst     = "k8s_execute_first"
	OpenClawPromptPackRespondWithConcrete = "respond_with_concrete"
	OpenClawPromptPackOllamaToolsNote     = "ollama_tools_note"
)

// OpenClawToolchainPresetMeta 供 GET /toolchain-options 与前端向导展示。
type OpenClawToolchainPresetMeta struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// OpenClawPromptPackMeta 可选提示词包（用户勾选后合并进 SOUL/AGENTS）。
type OpenClawPromptPackMeta struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// OpenClawToolchainPresets 固定列表；与 openClawConfigMapData 中写入的 profile 字面量一致。
func OpenClawToolchainPresets() []OpenClawToolchainPresetMeta {
	return []OpenClawToolchainPresetMeta{
		{
			ID:          OpenClawToolsProfileMinimal,
			Label:       "轻量（minimal）",
			Description: "工具面最小，偏问答与轻量集成；集群只读场景可省资源。",
		},
		{
			ID:          OpenClawToolsProfileCoding,
			Label:       "开发（coding）",
			Description: "含常用开发与执行类工具；适合脚本、仓库、中等强度集群只读。",
		},
		{
			ID:          OpenClawToolsProfileFull,
			Label:       "完整（full）",
			Description: "与官方 Full 镜像一致的全量工具链；需配合 RBAC 与 sandbox off。",
		},
	}
}

// OpenClawPromptPacksCatalog 可选提示词包说明（安装与详情中勾选）。
func OpenClawPromptPacksCatalog() []OpenClawPromptPackMeta {
	return []OpenClawPromptPackMeta{
		{
			ID:          OpenClawPromptPackK8sExecuteFirst,
			Label:       "集群查询：先工具后回答",
			Description: "禁止向用户索要 apiserver URL / Bearer token；问节点、Pod、命名空间等须用环境内 K8s 能力取数后再答，无权限则说明原因。",
		},
		{
			ID:          OpenClawPromptPackRespondWithConcrete,
			Label:       "输出：先结论后解释",
			Description: "优先给出数字、列表、资源名；避免用大段「操作教程」代替结论。",
		},
		{
			ID:          OpenClawPromptPackOllamaToolsNote,
			Label:       "Ollama：工具调用说明",
			Description: "提醒本地模型可能对 function calling 较弱；仍须优先尝试工具，失败时如实说明。",
		},
	}
}

// NormalizeOpenClawToolsProfile 规范为 minimal | coding | full；未知或空为 full（与历史部署一致）。
func NormalizeOpenClawToolsProfile(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case OpenClawToolsProfileMinimal:
		return OpenClawToolsProfileMinimal
	case OpenClawToolsProfileCoding:
		return OpenClawToolsProfileCoding
	case OpenClawToolsProfileFull, "":
		return OpenClawToolsProfileFull
	default:
		return OpenClawToolsProfileFull
	}
}

func strictOpenClawToolsProfile(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case OpenClawToolsProfileMinimal, OpenClawToolsProfileCoding, OpenClawToolsProfileFull:
		return strings.ToLower(strings.TrimSpace(raw)), true
	default:
		return "", false
	}
}

// SanitizePromptPackIDs 去重并仅保留平台已定义的包 ID。
func SanitizePromptPackIDs(in []string) []string {
	allowed := map[string]struct{}{
		OpenClawPromptPackK8sExecuteFirst:     {},
		OpenClawPromptPackRespondWithConcrete: {},
		OpenClawPromptPackOllamaToolsNote:     {},
	}
	seen := map[string]struct{}{}
	var out []string
	for _, x := range in {
		id := strings.TrimSpace(x)
		if id == "" {
			continue
		}
		if _, ok := allowed[id]; !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// openClawDefaultElevatedForWebchat 与 K8s 预置 openclaw.json 一致：启用 elevated 并为 webchat 放行（通配 *）。
func openClawDefaultElevatedForWebchat() map[string]interface{} {
	return map[string]interface{}{
		"enabled": true,
		"allowFrom": map[string]interface{}{
			"webchat": []interface{}{"*"},
		},
	}
}

// OpenClawMergeElevatedWebchatForK8s 补齐 tools.elevated（及 agents.list[].tools.elevated），供 Control UI / webchat 在 runtime=direct 下通过 exec 门闸。
// 见 https://docs.openclaw.ai/tools/elevated — 即使 sandbox=off，网关仍可能校验 elevated.enabled 与 allowFrom。
func OpenClawMergeElevatedWebchatForK8s(root map[string]interface{}) bool {
	ensureElevated := func(tools map[string]interface{}) bool {
		var ch bool
		el, _ := tools["elevated"].(map[string]interface{})
		if el == nil {
			el = map[string]interface{}{}
			tools["elevated"] = el
			ch = true
		}
		if ev, ok := el["enabled"].(bool); !ok || !ev {
			el["enabled"] = true
			ch = true
		}
		af, _ := el["allowFrom"].(map[string]interface{})
		if af == nil {
			af = map[string]interface{}{}
			el["allowFrom"] = af
			ch = true
		}
		wc, ok := af["webchat"].([]interface{})
		if !ok || len(wc) == 0 {
			af["webchat"] = []interface{}{"*"}
			ch = true
		}
		return ch
	}
	var changed bool
	t, ok := root["tools"].(map[string]interface{})
	if !ok || t == nil {
		t = map[string]interface{}{"profile": OpenClawToolsProfileFull}
		root["tools"] = t
		changed = true
	}
	if ensureElevated(t) {
		changed = true
	}
	ag, ok := root["agents"].(map[string]interface{})
	if !ok {
		return changed
	}
	list, ok := ag["list"].([]interface{})
	if !ok {
		return changed
	}
	for _, it := range list {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		tm, _ := m["tools"].(map[string]interface{})
		if tm == nil {
			tm = map[string]interface{}{}
			m["tools"] = tm
			changed = true
		}
		if ensureElevated(tm) {
			changed = true
		}
	}
	return changed
}

// StripOpenClawLegacyAgentDefaultsTools 删除 agents.defaults.tools（旧版平台误写；OpenClaw 校验会失败）。
func StripOpenClawLegacyAgentDefaultsTools(root map[string]interface{}) bool {
	ag, ok := root["agents"].(map[string]interface{})
	if !ok {
		return false
	}
	defs, ok := ag["defaults"].(map[string]interface{})
	if !ok {
		return false
	}
	if _, has := defs["tools"]; !has {
		return false
	}
	delete(defs, "tools")
	return true
}

func openClawApplyToolsProfileToRoot(root map[string]interface{}, profile string) {
	profile = NormalizeOpenClawToolsProfile(profile)
	if t, ok := root["tools"].(map[string]interface{}); ok {
		t["profile"] = profile
	} else {
		root["tools"] = map[string]interface{}{"profile": profile}
	}
	StripOpenClawLegacyAgentDefaultsTools(root)
	if ag, ok := root["agents"].(map[string]interface{}); ok {
		if list, ok := ag["list"].([]interface{}); ok {
			for _, it := range list {
				m, ok := it.(map[string]interface{})
				if !ok {
					continue
				}
				tu, _ := m["tools"].(map[string]interface{})
				if tu == nil {
					tu = map[string]interface{}{}
				}
				tu["profile"] = profile
				m["tools"] = tu
			}
		}
	}
	OpenClawMergeElevatedWebchatForK8s(root)
}

// PatchOpenClawJSONToolsProfile 更新 openclaw.json 根级与 agents.list[].tools.profile，并移除无效的 agents.defaults.tools。
func PatchOpenClawJSONToolsProfile(rawJSON, profile string) (string, error) {
	rawJSON = strings.TrimSpace(rawJSON)
	if rawJSON == "" {
		return "", errors.New("openclaw.json 为空")
	}
	var root map[string]interface{}
	if err := json.Unmarshal([]byte(rawJSON), &root); err != nil {
		return "", err
	}
	openClawApplyToolsProfileToRoot(root, profile)
	b, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return "", err
	}
	s := string(b)
	if err := validateOpenClawConfigJSON(s); err != nil {
		return "", err
	}
	return s, nil
}

// OpenClawBuildSOULMarkdown 平台基础 SOUL + 勾选提示词包追加段。
func OpenClawBuildSOULMarkdown(packIDs []string) string {
	base := strings.TrimSpace(openClawDefaultSOULMd)
	packs := SanitizePromptPackIDs(packIDs)
	if len(packs) == 0 {
		return base
	}
	var b strings.Builder
	b.WriteString(base)
	b.WriteString("\n\n---\n\n## 应用中心附加规则（用户勾选）\n\n")
	for _, id := range packs {
		switch id {
		case OpenClawPromptPackK8sExecuteFirst:
			b.WriteString("### 集群查询（必选行为）\n\n")
			b.WriteString("若用户询问 Kubernetes 资源（**节点数量、Pod 列表、命名空间、事件**等），你必须通过环境内可用的 **K8s 工具或等价 API** 获取**真实数据**后再作答。\n\n")
			b.WriteString("- **禁止**要求用户提供 Kubernetes API 服务器 URL、Bearer token、kubeconfig 片段，或让用户「自己去 Web 控制台点菜单」代替给出结果。\n")
			b.WriteString("- 若工具不可用、返回 403 或超时：如实说明原因（例如 RBAC 只读、tools.profile 过低、**tools.elevated** 未放行 webchat、网关未走工具链），**禁止编造**节点数或 Pod 名。\n\n")
		case OpenClawPromptPackRespondWithConcrete:
			b.WriteString("### 输出格式\n\n")
			b.WriteString("**先**给出用户要的**结论与数据**（数字、表格、`kubectl` 风格列表均可），**再**视需要给一句简短解释；不要以大段通用运维教程替代答案。\n\n")
		case OpenClawPromptPackOllamaToolsNote:
			b.WriteString("### 与 Ollama 协同\n\n")
			b.WriteString("若上游为 **Ollama** 等本地模型，可能对 **function calling / 工具**支持较弱；你仍须**优先尝试**发起工具调用。若多次无法触发工具，应明确告知「当前模型可能未正确走工具协议」，并建议用户在应用中心更换更擅长工具的模型或检查网关日志，而不是假装已执行命令。\n\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// OpenClawBuildAGENTSMarkdown 平台基础 AGENTS + 勾选提示词包英文追加段。
func OpenClawBuildAGENTSMarkdown(packIDs []string) string {
	base := strings.TrimSpace(openClawDefaultAgentsMd)
	packs := SanitizePromptPackIDs(packIDs)
	if len(packs) == 0 {
		return base
	}
	var b strings.Builder
	b.WriteString(base)
	b.WriteString("\n\n---\n\n## App-center add-on rules (user-selected)\n\n")
	for _, id := range packs {
		switch id {
		case OpenClawPromptPackK8sExecuteFirst:
			b.WriteString("### Kubernetes queries\n\n")
			b.WriteString("For questions about **nodes, pods, namespaces, events**, you **must** use available in-cluster Kubernetes capabilities to fetch **real data** before answering.\n\n")
			b.WriteString("- **Do not** ask the user for apiserver URLs, bearer tokens, or kubeconfig.\n")
			b.WriteString("- **Do not** tell the user to click around in a web UI instead of answering.\n")
			b.WriteString("- If tools are denied (403) or unavailable, state the reason; **never fabricate** counts or resource names.\n\n")
		case OpenClawPromptPackRespondWithConcrete:
			b.WriteString("### Answer shape\n\n")
			b.WriteString("Lead with **the data** (numbers, lists, resource names). Add a short explanation only if needed. Avoid long generic how-to text as a substitute for results.\n\n")
		case OpenClawPromptPackOllamaToolsNote:
			b.WriteString("### Ollama / local models\n\n")
			b.WriteString("Local models may be weak at tool calling; still **try tools first**. If tool calls clearly never happen, say so honestly and suggest checking gateway logs or switching models.\n\n")
		}
	}
	return strings.TrimSpace(b.String())
}

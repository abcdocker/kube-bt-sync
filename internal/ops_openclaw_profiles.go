package internal

import "strings"

// 分场景 OpenClaw：未配置或「未启用独立端点」时回退到顶层 openclaw。
const (
	OpsOpenClawRoleInspectSummary     = "inspect_summary"     // 平台巡检最终 AI 摘要
	OpsOpenClawRoleInspectProbe       = "inspect_probe"       // 巡检内大模型连通性 pong 探针
	OpsOpenClawRoleVmLogAnalyze       = "vmlog_analyze"       // VictoriaLogs 日志智能分析
	OpsOpenClawRoleClusterAdvisory    = "cluster_advisory"    // kube-system 控制平面周期建议
)

func openClawProfileIsActive(p OpenClawConfig) bool {
	if strings.TrimSpace(p.EndpointSource) == "appInstance" && strings.TrimSpace(p.AppInstanceID) != "" {
		return true
	}
	return strings.TrimSpace(p.BaseURL) != ""
}

// effectiveOpenClawForRole 返回用于该场景的 OpenClaw 配置（完整结构，未 Resolve）。
func effectiveOpenClawForRole(bundle OpsOpenClawBundle, role string) OpenClawConfig {
	if bundle.OpenClawProfiles == nil {
		return bundle.OpenClaw
	}
	p, ok := bundle.OpenClawProfiles[role]
	if !ok || !openClawProfileIsActive(p) {
		return bundle.OpenClaw
	}
	return p
}

// openClawEnabledForRole 某场景是否应调用大模型：若该场景配置了独立端点，以该配置的 Enabled 为准，否则以顶层为准。
func openClawEnabledForRole(bundle OpsOpenClawBundle, role string) bool {
	if bundle.OpenClawProfiles != nil {
		if p, ok := bundle.OpenClawProfiles[role]; ok && openClawProfileIsActive(p) {
			return p.Enabled
		}
	}
	return bundle.OpenClaw.Enabled
}

// opsOpenClawBundleForLLMRole 拷贝 bundle 并将 OpenClaw 换为指定场景配置后做 Resolve（应用中心实例时填充 BaseURL/API Key）。
func opsOpenClawBundleForLLMRole(app *ServerApp, cfg Config, bundle OpsOpenClawBundle, role string) (OpsOpenClawBundle, error) {
	out := bundle
	out.OpenClaw = effectiveOpenClawForRole(bundle, role)
	if err := ResolveOpsOpenClawEndpoint(app, cfg, &out); err != nil {
		return out, err
	}
	return out, nil
}

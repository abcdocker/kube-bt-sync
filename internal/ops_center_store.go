package internal

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	kvKeyOpsOpenClaw       = "kubebt_ops_openclaw_v1"
	kvKeyOpsGrafanaMeta    = "kubebt_ops_grafana_meta_v1"
	kvKeyOpsAlertCenter    = "kubebt_ops_alert_center_v1"
	kvKeyOpsAlertState     = "kubebt_ops_alert_state_v1"
	kvKeyOpsInspectReports   = "kubebt_ops_inspect_reports_v1"
	kvKeyOpsInspectCron      = "kubebt_ops_inspect_cron_v1"
	kvKeyOpsMonitoringPanels = "kubebt_ops_monitoring_panels_v1"
)

// OpenClawConfig OpenClaw / 兼容 OpenAI 接口的巡检对话端点。
type OpenClawConfig struct {
	Enabled       bool   `json:"enabled"`
	BaseURL       string `json:"baseUrl"`       // 如 https://api.openai.com/v1 或自建网关
	APIKeyEnc     string `json:"apiKeyEnc"`     // AES 加密
	Model         string `json:"model"`         // 默认模型
	SystemPrompt  string `json:"systemPrompt"`  // 系统提示
	UserTemplate  string `json:"userTemplate"`  // 用户消息模板，{{report}} 占位
	TimeoutSec    int    `json:"timeoutSec"`
	SkipTLSVerify bool   `json:"skipTlsVerify"`
	// EndpointSource：custom=使用 BaseURL；appInstance=使用应用中心登记的 OpenClaw（填 AppInstanceID）。
	EndpointSource string `json:"endpointSource"`
	AppInstanceID  string `json:"appInstanceId"`
}

// OpsAIModelExtra 模型相关扩展（温度、最大 token 等）。
type OpsAIModelExtra struct {
	Temperature     float64 `json:"temperature"`
	MaxTokens       int     `json:"maxTokens"`
	TopP            float64 `json:"topP"`
	FrequencyPenalty float64 `json:"frequencyPenalty"`
}

// OpsAIInspectConfig 巡检与调度。
type OpsAIInspectConfig struct {
	DailyReportHour   int  `json:"dailyReportHour"`   // 0-23，默认 8；调度按 Asia/Shanghai
	DailyReportMinute int  `json:"dailyReportMinute"` // 0-59；与 DailyReportHour 同为东八区
	InspectK8s        bool `json:"inspectK8s"`
	InspectVCenter    bool `json:"inspectVCenter"`
	InspectVCenterEvents bool `json:"inspectVCenterEvents"` // vCenter VM 事件与告警巡检
	InspectPrometheus bool `json:"inspectPrometheus,omitempty"` // 兼容旧配置：读到后会同步到 k8s / vcenter 两项
	InspectPrometheusK8s bool `json:"inspectPrometheusK8s"`
	InspectPrometheusVCenter bool `json:"inspectPrometheusVcenter"`
	InspectVMLog       bool `json:"inspectVmLog"`
	InspectRedis      bool `json:"inspectRedis"`
	InspectSSH        bool `json:"inspectSSH"`
	InspectCloudVm    bool `json:"inspectCloudVm"`
	ModelExtra        OpsAIModelExtra `json:"modelExtra"`
}

func normalizeOpsAIInspectConfig(ai *OpsAIInspectConfig) {
	if ai == nil {
		return
	}
	if ai.InspectPrometheus && !ai.InspectPrometheusK8s && !ai.InspectPrometheusVCenter {
		ai.InspectPrometheusK8s = true
		ai.InspectPrometheusVCenter = true
	}
}

// OpsOpenClawBundle 合并保存。
type OpsOpenClawBundle struct {
	OpenClaw OpenClawConfig `json:"openclaw"`
	// OpenClawProfiles 可选：按场景覆盖 OpenClaw（键见 OpsOpenClawRole*）；未配置或未填写 Base URL / 应用中心实例时回退到 OpenClaw。
	OpenClawProfiles map[string]OpenClawConfig `json:"openclawProfiles,omitempty"`
	AI               OpsAIInspectConfig        `json:"ai"`
}

type grafanaDashboardRef struct {
	UID   string `json:"uid"`
	Title string `json:"title"`
	URI   string `json:"uri"`
}

// OpsMonitoringCustomPanel 监控中心自定义图（PromQL 直连 Prometheus，不经 Grafana）。
type OpsMonitoringCustomPanel struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Category  string   `json:"category"`
	PromQL    string   `json:"promql"`
	Scope     string   `json:"scope"` // k8s | vcenter | inherit（inherit 表示跟随页面所选数据源）
	Display   string   `json:"display"` // single | matrix
	LabelKeys []string `json:"labelKeys,omitempty"`
}

type opsMonitoringPanelsPayload struct {
	Panels []OpsMonitoringCustomPanel `json:"panels"`
}

// OpsGrafanaMeta 同步索引（完整 JSON 在 dataDir/ops_grafana/<uid>.json）。
type OpsGrafanaMeta struct {
	BaseURL       string                `json:"baseUrl"`
	AuthMode      string                `json:"authMode"` // basic（默认）| api_token（Grafana API Token / Service Account，Bearer）
	User          string                `json:"user"`
	PasswordEnc   string                `json:"passwordEnc"` // basic 时为密码；api_token 时为 token 密文
	SkipTLSVerify bool                  `json:"skipTlsVerify"`
	LastSyncAt    string                `json:"lastSyncAt"`
	LastSyncErr   string                `json:"lastSyncErr"`
	Dashboards    []grafanaDashboardRef `json:"dashboards"`
}

// OpsAlertRule Prometheus 风格即时查询告警。
type OpsAlertRule struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Enabled     bool              `json:"enabled"`
	Scope       string            `json:"scope"` // k8s | vcenter | cloud
	PromQL      string            `json:"promql"`
	Compare     string            `json:"compare"` // gt gte lt lte eq neq
	Threshold   float64           `json:"threshold"`
	ForSeconds  int               `json:"forSeconds"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
}

// OpsAlertChannel 告警媒介。
type OpsAlertChannel struct {
	ID         string `json:"id"`
	Type       string `json:"type"` // email | wecom | wecom_app
	// email
	SMTPHost    string `json:"smtpHost"`
	SMTPPort    int    `json:"smtpPort"`
	SMTPUser    string `json:"smtpUser"`
	SMTPPassEnc string `json:"smtpPassEnc"`
	FromAddr    string `json:"fromAddr"`
	ToAddrs     string `json:"toAddrs"` // 逗号分隔
	UseTLS      bool   `json:"useTls"`
	// wecom 群机器人 webhook
	WeComWebhook string `json:"wecomWebhook"`
	// wecom_app 企业微信「自建应用」API（非 webhook）
	WeComCorpID       string `json:"wecomCorpId"`
	WeComAgentID      int    `json:"wecomAgentId"`
	WeComCorpSecretEnc string `json:"wecomCorpSecretEnc"`
	WeComToUser       string `json:"wecomToUser"` // 多个 userid 用 | 分隔，或 @all
}

// OpsAlertSilence 告警抑制（标签全匹配则静默至 Until）。
type OpsAlertSilence struct {
	ID       string            `json:"id"`
	Matchers map[string]string `json:"matchers"`
	Until    string            `json:"until"` // RFC3339
	Comment  string            `json:"comment"`
}

// OpsAlertCenterBundle 告警中心配置。
type OpsAlertCenterBundle struct {
	Rules      []OpsAlertRule    `json:"rules"`
	Channels   []OpsAlertChannel `json:"channels"`
	ChannelIDs []string          `json:"channelIds"` // 启用的通道 id
	Silences   []OpsAlertSilence `json:"silences"`
	// Alertmanager webhook 验签（密文）；由 POST /api/ops/alerts/alertmanager-webhook/regenerate 写入。
	AlertmanagerWebhookTokenEnc string `json:"alertmanagerWebhookTokenEnc,omitempty"`
	// 为 true 时，Alertmanager 推送除写入「最近通知」外，还会按 channelIds 调用邮箱/企微等通道。
	AlertmanagerForwardToChannels bool `json:"alertmanagerForwardToChannels,omitempty"`
}

// OpsAlertPendingState 规则待触发计时（内存+KV 简化：仅存 pendingSince key）。
type OpsAlertPendingState struct {
	PendingSince map[string]int64 `json:"pendingSince"` // ruleId -> unix
	LastFiring   map[string]bool    `json:"lastFiring"`
	LastNotifyAt map[string]int64   `json:"lastNotifyAt"`
}

// InspectionReportItem 一项检查结果。
type InspectionReportItem struct {
	Target   string `json:"target"`
	Status   string `json:"status"` // ok | warn | fail | skip
	Detail   string `json:"detail"`
	Duration string `json:"duration,omitempty"`
}

// InspectionSection 分项详情（Markdown，供前端折叠渲染）。
type InspectionSection struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Status   string `json:"status"` // ok | warn | fail | skip
	Markdown string `json:"markdown"`
}

// InspectionLLMProbe OpenClaw / OpenAI 兼容接口连通性与模型响应探针。
type InspectionLLMProbe struct {
	OK              bool   `json:"ok"`
	Model           string `json:"model,omitempty"`
	Message         string `json:"message"`
	Detail          string `json:"detail,omitempty"`
	ResponsePreview string `json:"responsePreview,omitempty"`
	LatencyMs       int64  `json:"latencyMs,omitempty"`
}

// InspectionReport 巡检报告。
type InspectionReport struct {
	ID                   string                 `json:"id"`
	CreatedAt            string                 `json:"createdAt"`
	Summary              string                 `json:"summary"`
	Items                []InspectionReportItem `json:"items"`
	AISummary            string                 `json:"aiSummary,omitempty"`
	AISummaryError       string                 `json:"aiSummaryError,omitempty"`
	AISummaryErrorDetail string                 `json:"aiSummaryErrorDetail,omitempty"`
	Sections             []InspectionSection    `json:"sections,omitempty"`
	LLMProbe             *InspectionLLMProbe    `json:"llmProbe,omitempty"`
}

type inspectReportsPayload struct {
	Reports []InspectionReport `json:"reports"`
}

func loadOpsOpenClawBundle(kv PlatformKV) (OpsOpenClawBundle, error) {
	var out OpsOpenClawBundle
	if kv == nil {
		return out, errors.New("kv nil")
	}
	raw, ok := kv.Get(kvKeyOpsOpenClaw)
	if !ok || strings.TrimSpace(raw) == "" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return out, err
	}
	normalizeOpsAIInspectConfig(&out.AI)
	return out, nil
}

func saveOpsOpenClawBundle(kv PlatformKV, b OpsOpenClawBundle) error {
	if kv == nil {
		return errors.New("kv nil")
	}
	normalizeOpsAIInspectConfig(&b.AI)
	b.AI.InspectPrometheus = false
	js, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpsOpenClaw, string(js))
}

func loadOpsGrafanaMeta(kv PlatformKV) (OpsGrafanaMeta, error) {
	var out OpsGrafanaMeta
	if kv == nil {
		return out, errors.New("kv nil")
	}
	raw, ok := kv.Get(kvKeyOpsGrafanaMeta)
	if !ok || strings.TrimSpace(raw) == "" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return out, err
	}
	return out, nil
}

func saveOpsGrafanaMeta(kv PlatformKV, m OpsGrafanaMeta) error {
	if kv == nil {
		return errors.New("kv nil")
	}
	js, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpsGrafanaMeta, string(js))
}

func loadOpsMonitoringCustomPanels(kv PlatformKV) ([]OpsMonitoringCustomPanel, error) {
	if kv == nil {
		return nil, errors.New("kv nil")
	}
	raw, ok := kv.Get(kvKeyOpsMonitoringPanels)
	if !ok || strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var p opsMonitoringPanelsPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return nil, err
	}
	return p.Panels, nil
}

func saveOpsMonitoringCustomPanels(kv PlatformKV, panels []OpsMonitoringCustomPanel) error {
	if kv == nil {
		return errors.New("kv nil")
	}
	js, err := json.Marshal(opsMonitoringPanelsPayload{Panels: panels})
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpsMonitoringPanels, string(js))
}

func loadOpsAlertCenter(kv PlatformKV) (OpsAlertCenterBundle, error) {
	var out OpsAlertCenterBundle
	if kv == nil {
		return out, errors.New("kv nil")
	}
	raw, ok := kv.Get(kvKeyOpsAlertCenter)
	if !ok || strings.TrimSpace(raw) == "" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return out, err
	}
	return out, nil
}

func saveOpsAlertCenter(kv PlatformKV, b OpsAlertCenterBundle) error {
	if kv == nil {
		return errors.New("kv nil")
	}
	js, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpsAlertCenter, string(js))
}

func loadOpsAlertState(kv PlatformKV) (OpsAlertPendingState, error) {
	var out OpsAlertPendingState
	if kv == nil {
		return out, errors.New("kv nil")
	}
	raw, ok := kv.Get(kvKeyOpsAlertState)
	if !ok || strings.TrimSpace(raw) == "" {
		out.PendingSince = map[string]int64{}
		out.LastFiring = map[string]bool{}
		out.LastNotifyAt = map[string]int64{}
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return out, err
	}
	if out.PendingSince == nil {
		out.PendingSince = map[string]int64{}
	}
	if out.LastFiring == nil {
		out.LastFiring = map[string]bool{}
	}
	if out.LastNotifyAt == nil {
		out.LastNotifyAt = map[string]int64{}
	}
	return out, nil
}

func saveOpsAlertState(kv PlatformKV, s OpsAlertPendingState) error {
	if kv == nil {
		return errors.New("kv nil")
	}
	js, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpsAlertState, string(js))
}

func loadInspectReports(kv PlatformKV) ([]InspectionReport, error) {
	if kv == nil {
		return nil, errors.New("kv nil")
	}
	raw, ok := kv.Get(kvKeyOpsInspectReports)
	if !ok || strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var p inspectReportsPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return nil, err
	}
	return p.Reports, nil
}

func appendInspectReport(kv PlatformKV, rep InspectionReport, max int) error {
	if kv == nil {
		return errors.New("kv nil")
	}
	list, err := loadInspectReports(kv)
	if err != nil {
		return err
	}
	if max <= 0 {
		max = 50
	}
	out := append([]InspectionReport{rep}, list...)
	if len(out) > max {
		out = out[:max]
	}
	js, err := json.Marshal(inspectReportsPayload{Reports: out})
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpsInspectReports, string(js))
}

func opsEncryptionKey(cfg Config) ([]byte, error) {
	return totpEncryptionKey(cfg)
}

func opsNowRFC3339() string {
	return time.Now().In(BeijingLocation()).Format(time.RFC3339Nano)
}

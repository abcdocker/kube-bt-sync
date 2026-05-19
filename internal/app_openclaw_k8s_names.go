package internal

import "strings"

// 以下资源名与 Deployment 名绑定，使同一命名空间内多套 OpenClaw 各自 PVC/Secret/ConfigMap/SA，互不影响。
// 旧登记未填 PvcClaimName 等字段时，删除逻辑仍回退到历史固定名 openclaw-home-pvc 等。

func openClawPVCClaimName(depName string) string {
	return "openclaw-home-" + strings.TrimSpace(depName)
}

func openClawSecretObjectName(depName string) string {
	return "openclaw-secrets-" + strings.TrimSpace(depName)
}

func openClawConfigMapObjectName(depName string) string {
	return "openclaw-config-" + strings.TrimSpace(depName)
}

func openClawServiceAccountName(depName string) string {
	return "openclaw-" + strings.TrimSpace(depName)
}

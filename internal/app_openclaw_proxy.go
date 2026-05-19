package internal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// OpenClawEffectiveHTTPProxyURL 解析网关实际使用的 HTTP(S) 代理：优先实例登记的 httpProxyUrl；若为空且登记了带 Hysteria2 的出站云主机，则返回该云主机 hy2 ClusterIP 端点（http://…）。
func OpenClawEffectiveHTTPProxyURL(ctx context.Context, app *ServerApp, inst *AppOpenClawInstance) string {
	if inst == nil {
		return ""
	}
	if p := strings.TrimSpace(inst.HttpProxyURL); p != "" {
		return p
	}
	vmID := strings.TrimSpace(inst.EgressCloudVmID)
	if vmID == "" {
		return ""
	}
	db := app.MySQLDB()
	if db == nil {
		return ""
	}
	u, err := hysteriaHTTPProxyURLFromCloudVMID(ctx, db, vmID)
	if err != nil || u == "" {
		return ""
	}
	return u
}

func hysteriaHTTPProxyURLFromCloudVMID(ctx context.Context, db *sql.DB, vmIDStr string) (string, error) {
	var cfgj, ns string
	err := db.QueryRowContext(ctx, `SELECT namespace, config_json FROM kubebt_app_cloud_vm_instances WHERE id=?`, strings.TrimSpace(vmIDStr)).Scan(&ns, &cfgj)
	if err != nil {
		return "", err
	}
	var st CloudVMStored
	if err := json.Unmarshal([]byte(cfgj), &st); err != nil {
		return "", err
	}
	if !st.Software.InstallHysteria2 || strings.TrimSpace(st.Software.Hysteria2ConfigYAML) == "" {
		return "", fmt.Errorf("云主机未启用 Hysteria2 客户端")
	}
	if strings.TrimSpace(st.DeploymentName) == "" {
		return "", fmt.Errorf("云主机缺少 Deployment 名")
	}
	host := CloudVMHysteria2ClusterEndpoint(ns, st.DeploymentName, st.Software.Hysteria2ListenPort)
	if host == "" {
		return "", fmt.Errorf("无法解析 hy2 端点")
	}
	return "http://" + host, nil
}

// OpenClawMergeHTTPProxyIntoJSONObject 在 openclaw.json 根级维护 env.HTTP_PROXY / env.HTTPS_PROXY（与 Deployment 环境变量双写，便于部分通道/子进程读取）。
func OpenClawMergeHTTPProxyIntoJSONObject(root map[string]interface{}, proxy string) {
	if root == nil {
		return
	}
	proxy = strings.TrimSpace(proxy)
	env, _ := root["env"].(map[string]interface{})
	if proxy == "" {
		if env == nil {
			return
		}
		delete(env, "HTTP_PROXY")
		delete(env, "HTTPS_PROXY")
		if len(env) == 0 {
			delete(root, "env")
		}
		return
	}
	if env == nil {
		env = make(map[string]interface{})
		root["env"] = env
	}
	env["HTTP_PROXY"] = proxy
	env["HTTPS_PROXY"] = proxy
}

func openClawPodMergeHTTPProxyIntoJSON(ctx context.Context, k8s *kubernetes.Clientset, rc *rest.Config, ns, pod, proxy string) error {
	abs := openClawAbsPath("openclaw.json")
	raw, err := openClawReadFileFromPod(ctx, k8s, rc, ns, pod, abs)
	if err != nil {
		if errors.Is(err, errOpenClawFileMissing) {
			return fmt.Errorf("PVC 上尚无 openclaw.json，请等待 init 完成")
		}
		return err
	}
	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return fmt.Errorf("openclaw.json 解析失败: %w", err)
	}
	OpenClawMergeHTTPProxyIntoJSONObject(root, proxy)
	out, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return err
	}
	if err := validateOpenClawConfigJSON(string(out)); err != nil {
		return err
	}
	return openClawWriteFileToPod(ctx, k8s, rc, ns, pod, abs, out)
}

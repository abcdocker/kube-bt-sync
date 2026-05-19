package internal

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func openClawTelegramSummary(db *sql.DB, instanceID string) (enabled, googleOK bool, googleAt string, hasToken bool, err error) {
	if db == nil {
		return false, false, "", false, nil
	}
	var tok sql.NullString
	var enI, gokI int
	err = db.QueryRow(`SELECT telegram_enabled, google_ok, google_checked_at, telegram_bot_token_enc FROM kubebt_openclaw_instance_secrets WHERE openclaw_instance_id=?`,
		strings.TrimSpace(instanceID)).Scan(&enI, &gokI, &googleAt, &tok)
	if err == sql.ErrNoRows {
		return false, false, "", false, nil
	}
	if err != nil {
		return false, false, "", false, err
	}
	return enI != 0, gokI != 0, googleAt, tok.Valid && strings.TrimSpace(tok.String) != "", nil
}

func upsertOpenClawTelegramGoogle(db *sql.DB, instanceID string, googleOK bool, checkedAt string) error {
	if db == nil {
		return fmt.Errorf("需要 MySQL")
	}
	gi := 0
	if googleOK {
		gi = 1
	}
	_, err := db.Exec(`INSERT INTO kubebt_openclaw_instance_secrets (openclaw_instance_id, google_ok, google_checked_at) VALUES (?,?,?)
ON DUPLICATE KEY UPDATE google_ok=VALUES(google_ok), google_checked_at=VALUES(google_checked_at)`,
		strings.TrimSpace(instanceID), gi, strings.TrimSpace(checkedAt))
	return err
}

func upsertOpenClawTelegramSettings(db *sql.DB, instanceID string, enabled bool, tokenPlain string, key []byte) error {
	if db == nil {
		return fmt.Errorf("需要 MySQL")
	}
	id := strings.TrimSpace(instanceID)
	e := 0
	if enabled {
		e = 1
	}
	var enc *string
	if strings.TrimSpace(tokenPlain) != "" {
		s, err := encryptSecret(key, strings.TrimSpace(tokenPlain))
		if err != nil {
			return err
		}
		enc = &s
	}
	if enc != nil {
		_, err := db.Exec(`INSERT INTO kubebt_openclaw_instance_secrets (openclaw_instance_id, telegram_enabled, telegram_bot_token_enc) VALUES (?,?,?)
ON DUPLICATE KEY UPDATE telegram_enabled=VALUES(telegram_enabled), telegram_bot_token_enc=VALUES(telegram_bot_token_enc)`,
			id, e, *enc)
		return err
	}
	_, err := db.Exec(`INSERT INTO kubebt_openclaw_instance_secrets (openclaw_instance_id, telegram_enabled) VALUES (?,?)
ON DUPLICATE KEY UPDATE telegram_enabled=VALUES(telegram_enabled)`, id, e)
	return err
}

func loadOpenClawTelegramTokenPlain(db *sql.DB, instanceID string, key []byte) (string, error) {
	if db == nil {
		return "", fmt.Errorf("需要 MySQL")
	}
	var enc sql.NullString
	err := db.QueryRow(`SELECT telegram_bot_token_enc FROM kubebt_openclaw_instance_secrets WHERE openclaw_instance_id=?`, strings.TrimSpace(instanceID)).Scan(&enc)
	if err == sql.ErrNoRows || !enc.Valid {
		return "", fmt.Errorf("未保存 Telegram Token")
	}
	if err != nil {
		return "", err
	}
	return decryptSecret(key, enc.String)
}

func handleOpenClawTelegramSettingsGet(c *gin.Context, app *ServerApp) {
	db := app.MySQLDB()
	if db == nil {
		c.JSON(http.StatusOK, gin.H{"mysqlRequired": true})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	en, gok, gat, htok, err := openClawTelegramSummary(db, id)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"telegramEnabled":    en,
		"googleOk":         gok,
		"googleCheckedAt":    gat,
		"hasTelegramToken": htok,
	})
}

func handleOpenClawTelegramSettingsPut(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	db := app.MySQLDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "需要 MySQL"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body struct {
		TelegramEnabled    bool   `json:"telegramEnabled"`
		TelegramBotToken   string `json:"telegramBotToken"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.TelegramEnabled {
		_, gok, _, _, err := openClawTelegramSummary(db, id)
		if err != nil {
			RespondAPIError500(c, err.Error())
			return
		}
		if !gok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "须先在所选云主机 Pod 内通过 Google 可达性检测后，方可开启 Telegram 对接"})
			return
		}
	}
	key, err := opsEncryptionKey(app.Cfg())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := upsertOpenClawTelegramSettings(db, id, body.TelegramEnabled, body.TelegramBotToken, key); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func handleOpenClawGoogleReachabilityCheck(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.K8s() == nil || app.K8sREST() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	db := app.MySQLDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "需要 MySQL"})
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	ocID := strings.TrimSpace(c.Param("id"))
	list, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	inst := findAppOpenClawInstance(list, ocID)
	if inst == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "OpenClaw 实例不存在"})
		return
	}
	var body struct {
		CloudVmID string `json:"cloudVmId"`
	}
	_ = c.ShouldBindJSON(&body)
	vmIDStr := strings.TrimSpace(body.CloudVmID)
	if vmIDStr == "" {
		vmIDStr = strings.TrimSpace(inst.EgressCloudVmID)
	}
	if vmIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 cloudVmId 或在登记中填写 egressCloudVmId（含 Hysteria2 客户端的云主机）"})
		return
	}
	vmID, err := strconv.ParseInt(vmIDStr, 10, 64)
	if err != nil || vmID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cloudVmId 无效"})
		return
	}
	var cfgj, ns string
	err = db.QueryRow(`SELECT namespace, config_json FROM kubebt_app_cloud_vm_instances WHERE id=?`, vmID).Scan(&ns, &cfgj)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "云主机不存在"})
		return
	}
	var st CloudVMStored
	if err := json.Unmarshal([]byte(cfgj), &st); err != nil || strings.TrimSpace(st.DeploymentName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "云主机配置无效"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	ok, detail := CloudVMExecGoogle204Check(ctx, app.K8s(), app.K8sREST(), ns, st.DeploymentName, st.Software)
	at := NowBeijingRFC3339()
	_ = upsertOpenClawTelegramGoogle(db, ocID, ok, at)
	c.JSON(http.StatusOK, gin.H{"ok": ok, "detail": detail, "checkedAt": at})
}

func handleOpenClawApplyTelegramToJSON(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.K8s() == nil || app.K8sREST() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	db := app.MySQLDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "需要 MySQL"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
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
	key, err := opsEncryptionKey(app.Cfg())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tok, err := loadOpenClawTelegramTokenPlain(db, id, key)
	if err != nil || strings.TrimSpace(tok) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先在 MySQL 中保存 Telegram Bot Token"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()
	pod, err := openClawPickGatewayPod(ctx, app.K8s(), inst.Namespace, inst.DeploymentName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	raw, err := openClawReadFileFromPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, pod, "/home/node/.openclaw/openclaw.json")
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "openclaw.json 解析失败"})
		return
	}
	ch, _ := root["channels"].(map[string]interface{})
	if ch == nil {
		ch = make(map[string]interface{})
		root["channels"] = ch
	}
	ch["telegram"] = map[string]interface{}{
		"enabled":    true,
		"botToken":   strings.TrimSpace(tok),
		"dmPolicy":   "pairing",
	}
	out, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	if err := openClawWriteFileToPod(ctx, app.K8s(), app.K8sREST(), inst.Namespace, pod, "/home/node/.openclaw/openclaw.json", out); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	eff := OpenClawEffectiveHTTPProxyURL(ctx, app, inst)
	if eff != "" && app.K8sREST() != nil {
		_ = openClawPodMergeHTTPProxyIntoJSON(ctx, app.K8s(), app.K8sREST(), inst.Namespace, pod, eff)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "已写入 PVC 上 openclaw.json；若网关未热加载请滚动重启 Deployment", "httpProxyMerged": eff != ""})
}

// telegramBotGetMe 调用 Telegram Bot API getMe；proxyURL 为空则直连（平台 Pod 需能访问 api.telegram.org）。
func telegramBotGetMe(ctx context.Context, botToken, proxyURL string) (apiOK bool, username string, botID int64, detail string, steps []string) {
	steps = append(steps, "已读取 Bot Token")
	tok := strings.TrimSpace(botToken)
	if tok == "" {
		detail = "Token 为空"
		return
	}
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL != "" {
		steps = append(steps, "将经 HTTP 代理请求 Telegram: "+proxyURL)
	} else {
		steps = append(steps, "未配置代理，直连 api.telegram.org")
	}
	tr := &http.Transport{}
	if proxyURL != "" {
		u, err := url.Parse(proxyURL)
		if err != nil {
			detail = "代理 URL 无效: " + err.Error()
			return
		}
		tr.Proxy = http.ProxyURL(u)
	}
	client := &http.Client{Transport: tr, Timeout: 28 * time.Second}
	reqURL := "https://api.telegram.org/bot" + tok + "/getMe"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		detail = err.Error()
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		detail = "请求失败: " + err.Error()
		steps = append(steps, "HTTP 请求出错")
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	steps = append(steps, fmt.Sprintf("HTTP %d", resp.StatusCode))
	var wrap struct {
		OK     bool `json:"ok"`
		Result struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"result"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		s := strings.TrimSpace(string(body))
		if len(s) > 200 {
			s = s[:200] + "…"
		}
		detail = "响应非 JSON: " + s
		return
	}
	if !wrap.OK {
		if wrap.Description != "" {
			detail = wrap.Description
		} else {
			detail = strings.TrimSpace(string(body))
			if len(detail) > 400 {
				detail = detail[:400] + "…"
			}
		}
		steps = append(steps, "Telegram 返回 ok=false")
		return
	}
	apiOK = true
	username = strings.TrimSpace(wrap.Result.Username)
	botID = wrap.Result.ID
	steps = append(steps, "getMe 成功")
	if username != "" {
		detail = "@" + username
	} else {
		detail = fmt.Sprintf("bot id=%d", botID)
	}
	return
}

func handleOpenClawTelegramVerify(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	db := app.MySQLDB()
	if db == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "需要 MySQL"})
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
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
	key, err := opsEncryptionKey(app.Cfg())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tok, err := loadOpenClawTelegramTokenPlain(db, id, key)
	if err != nil || strings.TrimSpace(tok) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先在 MySQL 中保存 Telegram Bot Token"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 35*time.Second)
	defer cancel()
	eff := OpenClawEffectiveHTTPProxyURL(ctx, app, inst)
	ok, user, bid, detail, steps := telegramBotGetMe(ctx, tok, eff)
	c.JSON(http.StatusOK, gin.H{
		"ok":           ok,
		"detail":       detail,
		"botUsername":  user,
		"botId":        bid,
		"steps":        steps,
		"proxyUsed":    eff,
	})
}

func handleAppOpenClawPatchEgressProxy(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.K8s() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "K8s 未连接"})
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	var body struct {
		HttpProxyURL    string  `json:"httpProxyUrl"`
		EgressCloudVmID *string `json:"egressCloudVmId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
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
	proxy := strings.TrimSpace(body.HttpProxyURL)
	if err := patchAppOpenClawInstance(app.PlatformKV(), id, func(x *AppOpenClawInstance) {
		x.HttpProxyURL = proxy
		if body.EgressCloudVmID != nil {
			x.EgressCloudVmID = strings.TrimSpace(*body.EgressCloudVmID)
		}
	}); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	list2, err := loadAppOpenClawInstances(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	inst2 := findAppOpenClawInstance(list2, id)
	if inst2 == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "实例不存在"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()
	eff := OpenClawEffectiveHTTPProxyURL(ctx, app, inst2)
	if err := PatchOpenClawGatewayHTTPProxy(ctx, app.K8s(), inst2.Namespace, inst2.DeploymentName, eff); err != nil {
		RespondAPIError500(c, "更新 Deployment 环境变量: " + err.Error())
		return
	}
	if app.K8sREST() != nil {
		if pod, err := openClawPickGatewayPod(ctx, app.K8s(), inst2.Namespace, inst2.DeploymentName); err == nil {
			_ = openClawPodMergeHTTPProxyIntoJSON(ctx, app.K8s(), app.K8sREST(), inst2.Namespace, pod, eff)
		}
	}
	mirrorPlatformKVIfDualWrite(app)
	c.JSON(http.StatusOK, gin.H{"ok": true, "effectiveHttpProxyUrl": eff})
}

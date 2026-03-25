package internal

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

const sessionCookieName = "kbts_session"

// PrepareDashboardAuth 在启用登录时解析或生成会话 HMAC 密钥。
func PrepareDashboardAuth(cfg Config) Config {
	if !cfg.DashboardAuthEnabled() {
		return cfg
	}
	if len(cfg.resolvedDashboardSessionKey) > 0 {
		return cfg
	}
	sec := strings.TrimSpace(cfg.DashboardSessionSecret)
	if sec != "" {
		cfg.resolvedDashboardSessionKey = []byte(sec)
		return cfg
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Printf(">>> 警告: 生成 DASHBOARD_SESSION_SECRET 失败: %v，将使用固定弱密钥（请设置环境变量）", err)
		cfg.resolvedDashboardSessionKey = []byte("kube-bt-sync-dev-only-change-me")
		return cfg
	}
	cfg.resolvedDashboardSessionKey = []byte(hex.EncodeToString(b))
	log.Println(">>> 警告: 已启用 Dashboard 登录但未设置 DASHBOARD_SESSION_SECRET，已生成临时会话密钥（重启后需重新登录；多副本请显式配置密钥）")
	return cfg
}

// PasswordLoginEnabled 本地用户名密码（DASHBOARD_PASSWORD）是否可用。
func (c Config) PasswordLoginEnabled() bool {
	return strings.TrimSpace(c.DashboardPassword) != ""
}

// OIDCConfigured 是否已完整配置 OIDC（如 Authentik 授权码流程）。
func (c Config) OIDCConfigured() bool {
	return strings.TrimSpace(c.OIDCIssuerURL) != "" &&
		strings.TrimSpace(c.OIDCClientID) != "" &&
		strings.TrimSpace(c.OIDCClientSecret) != "" &&
		strings.TrimSpace(c.OIDCRedirectURL) != ""
}

// DashboardAuthEnabled：本地密码和/或 OIDC 任一启用即要求登录。
func (c Config) DashboardAuthEnabled() bool {
	return c.PasswordLoginEnabled() || c.OIDCConfigured()
}

func (c Config) sessionMaxAge() time.Duration {
	d := c.DashboardSessionDays
	if d < 1 {
		d = 7
	}
	if d > 365 {
		d = 365
	}
	return time.Duration(d) * 24 * time.Hour
}

func dashboardUsernameMatch(got, want string) bool {
	got = strings.TrimSpace(got)
	want = strings.TrimSpace(want)
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func dashboardPasswordOk(cfg Config, password string) bool {
	stored := strings.TrimSpace(cfg.DashboardPassword)
	if stored == "" {
		return false
	}
	if strings.HasPrefix(stored, "$2a$") || strings.HasPrefix(stored, "$2b$") || strings.HasPrefix(stored, "$2y$") {
		return bcrypt.CompareHashAndPassword([]byte(stored), []byte(password)) == nil
	}
	if len(password) != len(stored) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(password), []byte(stored)) == 1
}

func mintSessionToken(user string, expUnix int64, key []byte) string {
	payload := fmt.Sprintf("%s|%d", user, expUnix)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	sig := mac.Sum(nil)
	pb := base64.RawURLEncoding.EncodeToString([]byte(payload))
	sb := base64.RawURLEncoding.EncodeToString(sig)
	return pb + "." + sb
}

func verifySessionToken(token string, key []byte) (user string, err error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return "", errors.New("invalid token")
	}
	payloadBytes, err1 := base64.RawURLEncoding.DecodeString(parts[0])
	sigBytes, err2 := base64.RawURLEncoding.DecodeString(parts[1])
	if err1 != nil || err2 != nil {
		return "", errors.New("invalid token")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write(payloadBytes)
	expectedSig := mac.Sum(nil)
	if subtle.ConstantTimeCompare(sigBytes, expectedSig) != 1 {
		return "", errors.New("invalid signature")
	}
	payload := string(payloadBytes)
	idx := strings.LastIndex(payload, "|")
	if idx < 0 {
		return "", errors.New("invalid payload")
	}
	user = payload[:idx]
	expStr := payload[idx+1:]
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return "", errors.New("invalid expiry")
	}
	if time.Now().Unix() > exp {
		return "", errors.New("expired")
	}
	if strings.TrimSpace(user) == "" {
		return "", errors.New("empty user")
	}
	return user, nil
}

func sessionUserFromCookie(c *gin.Context, cfg Config) (string, bool) {
	if !cfg.DashboardAuthEnabled() {
		u := strings.TrimSpace(cfg.DashboardUser)
		if u == "" {
			u = "admin"
		}
		return u, true
	}
	key := cfg.resolvedDashboardSessionKey
	if len(key) == 0 {
		return "", false
	}
	cookie, err := c.Cookie(sessionCookieName)
	if err != nil || cookie == "" {
		return "", false
	}
	user, err := verifySessionToken(cookie, key)
	if err != nil {
		return "", false
	}
	return user, true
}

// DashboardAuthMiddleware 未启用登录时直接放行；每次请求读取 app 当前配置（支持初始化后重载）。
func DashboardAuthMiddleware(app *ServerApp) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := app.Cfg()
		if !cfg.DashboardAuthEnabled() {
			c.Next()
			return
		}
		_, ok := sessionUserFromCookie(c, cfg)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "未登录或会话已过期"})
			return
		}
		c.Next()
	}
}

func handleAuthStatus(c *gin.Context, cfg Config) {
	expect := strings.TrimSpace(cfg.DashboardUser)
	if expect == "" {
		expect = "admin"
	}
	if !cfg.DashboardAuthEnabled() {
		c.JSON(http.StatusOK, gin.H{
			"authRequired":          false,
			"loggedIn":              true,
			"username":              "",
			"dashboardUsernameHint": expect,
			"passwordLogin":         false,
			"oidcLogin":             false,
		})
		return
	}
	user, ok := sessionUserFromCookie(c, cfg)
	c.JSON(http.StatusOK, gin.H{
		"authRequired":          true,
		"loggedIn":              ok,
		"username":              user,
		"dashboardUsernameHint": expect,
		"passwordLogin":         cfg.PasswordLoginEnabled(),
		"oidcLogin":             cfg.OIDCConfigured(),
	})
}

type loginBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func handleAuthLogin(c *gin.Context, app *ServerApp) {
	cfg := app.Cfg()
	if !cfg.DashboardAuthEnabled() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未启用登录（请配置 DASHBOARD_PASSWORD 或 OIDC）"})
		return
	}
	if !cfg.PasswordLoginEnabled() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未启用本地密码登录，请使用 OIDC 登录"})
		return
	}
	var body loginBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数无效"})
		return
	}
	expectUser := strings.TrimSpace(cfg.DashboardUser)
	if expectUser == "" {
		expectUser = "admin"
	}
	ip := AuditClientIP(c, cfg)
	if !dashboardUsernameMatch(body.Username, expectUser) {
		log.Printf("audit login fail user=%s ip=%s reason=username", strings.TrimSpace(body.Username), ip)
		AppendAuditRecord(app.DataDir(), AuditRecord{
			Action: "login_fail",
			IP:     ip,
			User:   strings.TrimSpace(body.Username),
			Method: c.Request.Method,
			Path:   c.Request.URL.Path,
			Status: http.StatusUnauthorized,
			Detail: "username",
		})
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}
	if !dashboardPasswordOk(cfg, body.Password) {
		log.Printf("audit login fail user=%s ip=%s reason=password", expectUser, ip)
		AppendAuditRecord(app.DataDir(), AuditRecord{
			Action: "login_fail",
			IP:     ip,
			User:   expectUser,
			Method: c.Request.Method,
			Path:   c.Request.URL.Path,
			Status: http.StatusUnauthorized,
			Detail: "password",
		})
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}
	key := cfg.resolvedDashboardSessionKey
	if len(key) == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务端会话密钥未初始化"})
		return
	}
	exp := time.Now().Add(cfg.sessionMaxAge()).Unix()
	token := mintSessionToken(expectUser, exp, key)
	maxAgeSec := int(cfg.sessionMaxAge().Seconds())
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAgeSec,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cfg.DashboardCookieSecure,
	})
	log.Printf("audit login ok user=%s ip=%s", expectUser, ip)
	AppendAuditRecord(app.DataDir(), AuditRecord{
		Action: "login_ok",
		IP:     ip,
		User:   expectUser,
		Method: c.Request.Method,
		Path:   c.Request.URL.Path,
		Status: http.StatusOK,
		Detail: "password",
	})
	c.JSON(http.StatusOK, gin.H{"message": "登录成功"})
}

func handleAuthLogout(c *gin.Context, app *ServerApp) {
	cfg := app.Cfg()
	ip := AuditClientIP(c, cfg)
	if cfg.DashboardAuthEnabled() {
		if u, ok := sessionUserFromCookie(c, cfg); ok {
			log.Printf("audit logout user=%s ip=%s", u, ip)
			AppendAuditRecord(app.DataDir(), AuditRecord{
				Action: "logout",
				IP:     ip,
				User:   u,
				Method: c.Request.Method,
				Path:   c.Request.URL.Path,
				Status: http.StatusOK,
			})
		}
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cfg.DashboardCookieSecure,
	})
	c.JSON(http.StatusOK, gin.H{"message": "已退出"})
}

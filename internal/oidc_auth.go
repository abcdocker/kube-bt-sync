package internal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
)

const (
	oidcStateCookie = "oidc_state"
	oidcNonceCookie = "oidc_nonce"
)

func oidcScopesFromConfig(cfg Config) []string {
	s := strings.TrimSpace(cfg.OIDCScopes)
	if s == "" {
		return []string{oidc.ScopeOpenID, "profile", "email"}
	}
	return strings.Fields(s)
}

func oidcClaimsToUsername(claims map[string]interface{}) string {
	if v, ok := claims["email"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := claims["preferred_username"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := claims["name"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := claims["sub"].(string); ok && strings.TrimSpace(v) != "" {
		return "oidc:" + strings.TrimSpace(v)
	}
	return "oidc:unknown"
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}

func clearOIDCCookies(w http.ResponseWriter, cfg Config) {
	sec := cfg.DashboardCookieSecure
	http.SetCookie(w, &http.Cookie{Name: oidcStateCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: sec})
	http.SetCookie(w, &http.Cookie{Name: oidcNonceCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: sec})
}

func redirectLoginError(c *gin.Context, cfg Config, msg string) {
	clearOIDCCookies(c.Writer, cfg)
	c.Redirect(http.StatusFound, "/login?error="+url.QueryEscape(msg))
}

func handleOIDCLogin(app *ServerApp) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := app.Cfg()
		if !cfg.OIDCConfigured() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 OIDC（OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URL）"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()
		issuer := strings.TrimSpace(cfg.OIDCIssuerURL)
		provider, err := oidc.NewProvider(ctx, issuer)
		if err != nil {
			log.Printf("oidc: NewProvider: %v", err)
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OIDC 发现失败，请检查 OIDC_ISSUER_URL"})
			return
		}
		oauth2Config := oauth2.Config{
			ClientID:     strings.TrimSpace(cfg.OIDCClientID),
			ClientSecret: strings.TrimSpace(cfg.OIDCClientSecret),
			RedirectURL:  strings.TrimSpace(cfg.OIDCRedirectURL),
			Endpoint:     provider.Endpoint(),
			Scopes:       oidcScopesFromConfig(cfg),
		}
		state := randomHex(16)
		nonce := randomHex(16)
		if state == "" || nonce == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 state 失败"})
			return
		}
		maxAge := 600
		sec := cfg.DashboardCookieSecure
		http.SetCookie(c.Writer, &http.Cookie{Name: oidcStateCookie, Value: state, Path: "/", MaxAge: maxAge, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: sec})
		http.SetCookie(c.Writer, &http.Cookie{Name: oidcNonceCookie, Value: nonce, Path: "/", MaxAge: maxAge, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: sec})
		authURL := oauth2Config.AuthCodeURL(state, oauth2.SetAuthURLParam("nonce", nonce))
		c.Redirect(http.StatusFound, authURL)
	}
}

func handleOIDCCallback(app *ServerApp) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := app.Cfg()
		if !cfg.OIDCConfigured() {
			redirectLoginError(c, cfg, "OIDC 未配置")
			return
		}
		if errMsg := c.Query("error"); errMsg != "" {
			desc := c.Query("error_description")
			msg := errMsg
			if desc != "" {
				msg = errMsg + ": " + desc
			}
			redirectLoginError(c, cfg, msg)
			return
		}
		code := strings.TrimSpace(c.Query("code"))
		stateQ := strings.TrimSpace(c.Query("state"))
		if code == "" || stateQ == "" {
			redirectLoginError(c, cfg, "缺少 code 或 state")
			return
		}
		stateCookie, err := c.Cookie(oidcStateCookie)
		if err != nil || stateCookie == "" || stateQ != stateCookie {
			redirectLoginError(c, cfg, "无效的 state（CSRF）")
			return
		}
		nonceCookie, err := c.Cookie(oidcNonceCookie)
		if err != nil || nonceCookie == "" {
			redirectLoginError(c, cfg, "缺少 nonce")
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
		defer cancel()
		issuer := strings.TrimSpace(cfg.OIDCIssuerURL)
		provider, err := oidc.NewProvider(ctx, issuer)
		if err != nil {
			log.Printf("oidc callback: NewProvider: %v", err)
			redirectLoginError(c, cfg, "OIDC 发现失败")
			return
		}
		oauth2Config := oauth2.Config{
			ClientID:     strings.TrimSpace(cfg.OIDCClientID),
			ClientSecret: strings.TrimSpace(cfg.OIDCClientSecret),
			RedirectURL:  strings.TrimSpace(cfg.OIDCRedirectURL),
			Endpoint:     provider.Endpoint(),
			Scopes:       oidcScopesFromConfig(cfg),
		}
		oauth2Token, err := oauth2Config.Exchange(ctx, code)
		if err != nil {
			log.Printf("oidc: Exchange: %v", err)
			redirectLoginError(c, cfg, "换取令牌失败")
			return
		}
		rawIDToken, _ := oauth2Token.Extra("id_token").(string)
		if strings.TrimSpace(rawIDToken) == "" {
			redirectLoginError(c, cfg, "响应中无 id_token")
			return
		}
		verifier := provider.Verifier(&oidc.Config{ClientID: oauth2Config.ClientID})
		idToken, err := verifier.Verify(ctx, rawIDToken)
		if err != nil {
			log.Printf("oidc: Verify id_token: %v", err)
			redirectLoginError(c, cfg, "ID Token 校验失败")
			return
		}
		// go-oidc 的 Verify 不校验 nonce，需自行比对（见 oidc/example/idtoken）
		if idToken.Nonce != nonceCookie {
			log.Printf("oidc: nonce mismatch: id_token=%q cookie=%q", idToken.Nonce, nonceCookie)
			redirectLoginError(c, cfg, "nonce 不匹配")
			return
		}
		var claims map[string]interface{}
		if err := idToken.Claims(&claims); err != nil {
			redirectLoginError(c, cfg, "解析声明失败")
			return
		}
		username := oidcClaimsToUsername(claims)
		key := cfg.resolvedDashboardSessionKey
		if len(key) == 0 {
			redirectLoginError(c, cfg, "服务端会话密钥未初始化")
			return
		}
		exp := time.Now().Add(cfg.sessionMaxAge()).Unix()
		sess := mintSessionToken(username, exp, key)
		maxAgeSec := int(cfg.sessionMaxAge().Seconds())
		clearOIDCCookies(c.Writer, cfg)
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     sessionCookieName,
			Value:    sess,
			Path:     "/",
			MaxAge:   maxAgeSec,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   cfg.DashboardCookieSecure,
		})
		log.Printf("audit login ok user=%s ip=%s method=oidc", username, AuditClientIP(c, cfg))
		c.Redirect(http.StatusFound, "/")
	}
}

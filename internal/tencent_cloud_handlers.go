package internal

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func registerTencentCloudAppCenterRoutes(api *gin.RouterGroup, app *ServerApp) {
	g := api.Group("/tencent-cloud")

	// Accounts (read from dns_accounts, provider = tencent/tencentcloud/dnspod)
	g.GET("/accounts", func(c *gin.Context) { handleTencentCloudAccountList(c, app) })
	g.POST("/verify-credentials", func(c *gin.Context) { handleTencentCloudVerifyCredentials(c) })

	// Lighthouse
	g.GET("/lighthouse/instances", func(c *gin.Context) { handleTencentCloudLighthouseInstances(c, app) })

	// CDN
	g.GET("/cdn/metrics", func(c *gin.Context) { handleTencentCloudCDNMetrics(c, app) })
	g.GET("/cdn/domains", func(c *gin.Context) { handleTencentCloudCDNDomains(c, app) })

	// CVM
	g.GET("/cvm/instances", func(c *gin.Context) { handleTencentCloudCVMInstances(c, app) })

	// CAM
	g.GET("/cam/keys", func(c *gin.Context) { handleTencentCloudCAMKeys(c, app) })
	g.GET("/cam/appid", func(c *gin.Context) { handleTencentCloudCAMAppId(c, app) })

	// Overview
	g.GET("/overview", func(c *gin.Context) { handleTencentCloudOverview(c, app) })

	// COS
	g.GET("/cos/buckets", func(c *gin.Context) { handleTencentCloudCOSBuckets(c, app) })
	g.GET("/cos/objects", func(c *gin.Context) { handleTencentCloudCOSObjects(c, app) })
	g.GET("/cos/objects/download", func(c *gin.Context) { handleTencentCloudCOSDownload(c, app) })
	g.POST("/cos/objects", func(c *gin.Context) { handleTencentCloudCOSUpload(c, app) })
	g.DELETE("/cos/objects", func(c *gin.Context) { handleTencentCloudCOSDelete(c, app) })
}

// isTencentProvider 判断是否为腾讯云 DNS 账户
type isTencentProvider = bool

func tencentProviderCheck(provider string) isTencentProvider {
	switch strings.ToLower(provider) {
	case "tencent", "tencentcloud", "dnspod":
		return true
	}
	return false
}

// tencentCloudAccountFromQuery 从 dns_accounts 查询腾讯云账户并创建客户端
func tencentCloudAccountFromQueryDNS(c *gin.Context, app *ServerApp) (*DnsAccount, *tencentCloudClient, bool) {
	db := dnsRequireMySQL(c, app)
	if db == nil {
		return nil, nil, false
	}
	s := c.Query("account_id")
	id, err := strconv.Atoi(s)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 account_id"})
		return nil, nil, false
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	acc, err := dnsAccountGet(ctx, db, id)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "账号不存在"})
		return nil, nil, false
	}
	if err != nil {
		RespondAPIError500(c, err.Error())
		return nil, nil, false
	}
	if !tencentProviderCheck(acc.Provider) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该账号不是腾讯云账号"})
		return nil, nil, false
	}
	var cfg map[string]string
	_ = json.Unmarshal([]byte(acc.ConfigJSON), &cfg)
	secretID := cfg["secretId"]
	secretKey := cfg["secretKey"]
	if secretID == "" || secretKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该腾讯云账号缺少 SecretId 或 SecretKey"})
		return nil, nil, false
	}
	client := newTencentCloudClient(secretID, secretKey)
	return acc, client, true
}

// handleTencentCloudAccountList 返回 dns_accounts 中的腾讯云账户
func handleTencentCloudAccountList(c *gin.Context, app *ServerApp) {
	db := dnsRequireMySQL(c, app)
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	list, err := dnsAccountList(ctx, db)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	var out []DnsAccount
	for _, a := range list {
		if tencentProviderCheck(a.Provider) {
			out = append(out, a)
		}
	}
	if out == nil {
		out = []DnsAccount{}
	}
	c.JSON(http.StatusOK, gin.H{"accounts": out})
}

// ─── Lighthouse ───

func handleTencentCloudLighthouseInstances(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	instances, err := client.ListLighthouseInstances(ctx)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"instances": instances})
}

// ─── CDN ───

func handleTencentCloudCDNDomains(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	domains, err := client.ListCDNDomains(ctx)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"domains": domains})
}

func handleTencentCloudCDNMetrics(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	startTime := c.Query("start")
	endTime := c.Query("end")
	domain := c.Query("domain")
	if startTime == "" || endTime == "" {
		now := time.Now()
		endTime = now.Format("2006-01-02 15:04:05")
		startTime = now.Add(-24 * time.Hour).Format("2006-01-02 15:04:05")
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	metrics, err := client.GetCDNMetrics(ctx, startTime, endTime, domain)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error(), "start": startTime, "end": endTime, "domain": domain})
		return
	}
	c.JSON(http.StatusOK, metrics)
}

// ─── COS ───

func handleTencentCloudCOSBuckets(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	result, err := client.COSListBuckets(ctx)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"buckets": result.Buckets})
}

func handleTencentCloudCOSObjects(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	bucketHost := c.Query("bucket")
	region := c.Query("region")
	prefix := c.Query("prefix")
	continuationToken := c.Query("continuation_token")
	if bucketHost == "" || region == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bucket 和 region 必填"})
		return
	}
	maxKeys, _ := strconv.Atoi(c.Query("max_keys"))
	if maxKeys <= 0 {
		maxKeys = 1000
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	result, err := client.COSListObjects(ctx, bucketHost, region, prefix, continuationToken, maxKeys)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"name":                  result.Name,
		"prefix":                result.Prefix,
		"isTruncated":           result.IsTruncated,
		"nextContinuationToken": result.NextContinuationToken,
		"contents":              result.Contents,
	})
}

func handleTencentCloudCOSDownload(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	bucketHost := c.Query("bucket")
	region := c.Query("region")
	objectKey := c.Query("key")
	mode := c.Query("mode") // "redirect" (presigned) or "proxy"
	if bucketHost == "" || region == "" || objectKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bucket、region 和 key 必填"})
		return
	}
	if mode == "redirect" {
		url := client.COSPresignedGetURL(bucketHost, region, objectKey, 15*time.Minute)
		c.Redirect(http.StatusTemporaryRedirect, url)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	data, err := client.COSGetObject(ctx, bucketHost, region, objectKey)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.Data(http.StatusOK, "application/octet-stream", data)
}

func handleTencentCloudCOSUpload(c *gin.Context, app *ServerApp) {
	if dnsWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	bucketHost := c.Query("bucket")
	region := c.Query("region")
	objectKey := c.Query("key")
	if bucketHost == "" || region == "" || objectKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bucket、region 和 key 必填"})
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取上传内容失败"})
		return
	}
	contentType := c.GetHeader("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if err := client.COSPutObject(bucketHost, region, objectKey, body, contentType); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "上传成功"})
}

func handleTencentCloudCOSDelete(c *gin.Context, app *ServerApp) {
	if dnsWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	bucketHost := c.Query("bucket")
	region := c.Query("region")
	objectKey := c.Query("key")
	if bucketHost == "" || region == "" || objectKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bucket、region 和 key 必填"})
		return
	}
	if err := client.COSDeleteObject(bucketHost, region, objectKey); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// ─── CVM ───

func handleTencentCloudCVMInstances(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	instances, err := client.ListCVMInstances(ctx)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"instances": instances})
}

// ─── CAM ───

func handleTencentCloudCAMKeys(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	keys, err := client.ListCAMAccessKeys(ctx)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"keys": keys})
}

func handleTencentCloudCAMAppId(c *gin.Context, app *ServerApp) {
	_, client, ok := tencentCloudAccountFromQueryDNS(c, app)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	appId, err := client.GetUserAppId(ctx)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"appId": appId})
}

// ─── Overview ───

type tencentAccountOverview struct {
	AccountID       int    `json:"accountId"`
	AccountName     string `json:"accountName"`
	AppId           string `json:"appId"`
	CVMCount        int    `json:"cvmCount"`
	LighthouseCount int    `json:"lighthouseCount"`
	COSBucketCount  int    `json:"cosBucketCount"`
	CDNDomainCount  int    `json:"cdnDomainCount"`
	CAMKeyCount     int    `json:"camKeyCount"`
}

func handleTencentCloudOverview(c *gin.Context, app *ServerApp) {
	db := dnsRequireMySQL(c, app)
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	list, err := dnsAccountList(ctx, db)
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	var accounts []DnsAccount
	for _, a := range list {
		if tencentProviderCheck(a.Provider) {
			accounts = append(accounts, a)
		}
	}
	if accounts == nil {
		accounts = []DnsAccount{}
	}

	// 并行获取每个账号的概览数据
	results := make([]tencentAccountOverview, 0, len(accounts))
	for _, acc := range accounts {
		var cfg map[string]string
		_ = json.Unmarshal([]byte(acc.ConfigJSON), &cfg)
		secretID := cfg["secretId"]
		secretKey := cfg["secretKey"]
		if secretID == "" || secretKey == "" {
			results = append(results, tencentAccountOverview{
				AccountID: acc.ID, AccountName: acc.Name,
			})
			continue
		}
		client := newTencentCloudClient(secretID, secretKey)
		ov := tencentAccountOverview{AccountID: acc.ID, AccountName: acc.Name}

		// APPID
		appIdCtx, appIdCancel := context.WithTimeout(ctx, 10*time.Second)
		if appId, err := client.GetUserAppId(appIdCtx); err == nil {
			ov.AppId = appId
		}
		appIdCancel()

		// Lighthouse
		lhCtx, lhCancel := context.WithTimeout(ctx, 15*time.Second)
		if lh, err := client.ListLighthouseInstances(lhCtx); err == nil {
			ov.LighthouseCount = len(lh)
		}
		lhCancel()

		// CVM
		cvmCtx, cvmCancel := context.WithTimeout(ctx, 15*time.Second)
		if cvm, err := client.ListCVMInstances(cvmCtx); err == nil {
			ov.CVMCount = len(cvm)
		}
		cvmCancel()

		// COS Buckets
		cosCtx, cosCancel := context.WithTimeout(ctx, 15*time.Second)
		if cosR, err := client.COSListBuckets(cosCtx); err == nil {
			ov.COSBucketCount = len(cosR.Buckets)
		}
		cosCancel()

		// CDN Domains
		cdnCtx, cdnCancel := context.WithTimeout(ctx, 15*time.Second)
		if cdnR, err := client.ListCDNDomains(cdnCtx); err == nil {
			ov.CDNDomainCount = len(cdnR)
		}
		cdnCancel()

		// CAM Keys
		camCtx, camCancel := context.WithTimeout(ctx, 15*time.Second)
		if camR, err := client.ListCAMAccessKeys(camCtx); err == nil {
			ov.CAMKeyCount = len(camR)
		}
		camCancel()

		results = append(results, ov)
	}

	c.JSON(http.StatusOK, gin.H{"accounts": results})
}

// handleTencentCloudVerifyCredentials 验证腾讯云原始凭证
func handleTencentCloudVerifyCredentials(c *gin.Context) {
	var body struct {
		SecretID  string `json:"secretId" binding:"required"`
		SecretKey string `json:"secretKey" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	appID, err := testTencentCredentials(ctx, body.SecretID, body.SecretKey)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "凭证验证通过", "appId": appID})
}

// testTencentCredentials 验证腾讯云 SecretId/SecretKey 是否可用，同时返回 APPID
func testTencentCredentials(ctx context.Context, secretID, secretKey string) (string, error) {
	client := newTencentCloudClient(secretID, secretKey)
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	appID, err := client.GetUserAppId(ctx)
	if err != nil {
		return "", err
	}
	return appID, nil
}

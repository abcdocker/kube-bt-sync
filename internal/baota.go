package internal

import (
	"crypto/md5"
	"crypto/tls" // 【新增】用于配置 TLS 证书忽略
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func CallBaotaAPI(cfg Config, apiPath string, params map[string]string) (string, error) {
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	md5Key := fmt.Sprintf("%x", md5.Sum([]byte(cfg.BaotaAPIKey)))
	requestToken := fmt.Sprintf("%x", md5.Sum([]byte(timestamp+md5Key)))

	data := url.Values{}
	data.Set("request_time", timestamp)
	data.Set("request_token", requestToken)
	for k, v := range params {
		data.Set(k, v)
	}

	// 【优化】处理用户填写的 URL 尾部可能自带斜杠，导致拼接出双斜杠的问题
	baseURL := strings.TrimRight(cfg.BaotaURL, "/")
	if !strings.HasPrefix(apiPath, "/") {
		apiPath = "/" + apiPath
	}
	fullURL := baseURL + apiPath

	req, err := http.NewRequest("POST", fullURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Add("Content-Type", "application/x-www-form-urlencoded")

	// 【核心修复】自定义 Transport，设置 InsecureSkipVerify 为 true，跳过自签名证书校验
	customTransport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}

	// 将自定义的 Transport 挂载到 Client 上
	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: customTransport,
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(bodyBytes), nil
}

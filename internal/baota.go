package internal

import (
	"crypto/md5"
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

	req, err := http.NewRequest("POST", cfg.BaotaURL+apiPath, strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Add("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
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
package internal

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	BaotaURL     string
	BaotaAPIKey  string
	DDNSHost     string
	DefaultPort  string
	SyncInterval time.Duration
}

func LoadConfig() Config {
	return Config{
		BaotaURL:     getEnv("BAOTA_URL", "http://127.0.0.1:8888"),
		BaotaAPIKey:  getEnv("BAOTA_API_KEY", ""), // 必须配置
		DDNSHost:     getEnv("DDNS_HOST", "home.example.com"),
		DefaultPort:  getEnv("DEFAULT_PORT", "38333"),
		SyncInterval: time.Duration(getEnvAsInt("SYNC_INTERVAL_SEC", 30)) * time.Second,
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func getEnvAsInt(key string, fallback int) int {
	if value, exists := os.LookupEnv(key); exists {
		var intVal int
		fmt.Sscanf(value, "%d", &intVal)
		return intVal
	}
	return fallback
}
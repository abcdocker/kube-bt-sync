package internal

import (
	"context"
	"encoding/json"
	"strings"
)

func redisRuntimeConfigKey(cfg Config) string {
	p := strings.TrimSpace(cfg.RedisKeyPrefix)
	if p == "" {
		p = "kubebt:"
	} else if !strings.HasSuffix(p, ":") {
		p += ":"
	}
	return p + "runtime-config"
}

func redisPlatformKVKey(cfg Config) string {
	p := strings.TrimSpace(cfg.RedisKeyPrefix)
	if p == "" {
		p = "kubebt:"
	} else if !strings.HasSuffix(p, ":") {
		p += ":"
	}
	return p + "platform-kv"
}

// MirrorRuntimeSettingsToRedis 将完整运行时配置写入 Redis（无 TTL）。
func MirrorRuntimeSettingsToRedis(ctx context.Context, r *RedisLight, cfg Config, rs *RuntimeSettings) error {
	if r == nil || rs == nil {
		return nil
	}
	b, err := json.MarshalIndent(rs, "", "  ")
	if err != nil {
		return err
	}
	return r.SetPersist(ctx, redisRuntimeConfigKey(cfg), b)
}

// LoadRuntimeSettingsFromRedis 从 Redis 读取运行时配置（用于灾备恢复）。
func LoadRuntimeSettingsFromRedis(ctx context.Context, r *RedisLight, cfg Config) (*RuntimeSettings, error) {
	s, err := r.Get(ctx, redisRuntimeConfigKey(cfg))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var rs RuntimeSettings
	if err := json.Unmarshal([]byte(s), &rs); err != nil {
		return nil, err
	}
	return &rs, nil
}

// MirrorPlatformKVToRedis 将 platform_kv 全量镜像到 Redis。
func MirrorPlatformKVToRedis(ctx context.Context, r *RedisLight, cfg Config, data map[string]string) error {
	if r == nil || data == nil {
		return nil
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return r.SetPersist(ctx, redisPlatformKVKey(cfg), b)
}

// LoadPlatformKVFromRedis 从 Redis 读取 platform_kv 映射。
func LoadPlatformKVFromRedis(ctx context.Context, r *RedisLight, cfg Config) (map[string]string, error) {
	s, err := r.Get(ctx, redisPlatformKVKey(cfg))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, err
	}
	return m, nil
}

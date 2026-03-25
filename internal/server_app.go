package internal

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// ServerApp 进程内配置与依赖（支持 Reload 后热更新）。
type ServerApp struct {
	mu sync.RWMutex

	dataDir string

	cfg       Config
	k8s       *kubernetes.Clientset
	k8sREST   *rest.Config
	sshStore  SSHSettingsStore
	vc        *vCenterClient
	redis     *RedisLight
	platformKV *PlatformKVFile
	initialized bool
	runtime   *RuntimeSettings
}

// DataDirFromEnv 仅数据目录可走环境变量（K8s 挂载 PVC 时常用 KUBEBT_DATA_DIR=/data）。
func DataDirFromEnv() string {
	d := strings.TrimSpace(os.Getenv("KUBEBT_DATA_DIR"))
	if d == "" {
		return "./data"
	}
	return d
}

// NewServerApp 从 dataDir/runtime-config.json 合并配置并初始化 K8s / vCenter / SSH 存储。
func NewServerApp(dataDir string) (*ServerApp, error) {
	if dataDir == "" {
		dataDir = "./data"
	}
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0700); err != nil {
		return nil, err
	}
	s := &ServerApp{dataDir: abs}
	if err := s.Reload(); err != nil {
		return nil, err
	}
	return s, nil
}

// Reload 重新读盘并替换内存态（POST /api/setup 成功后调用）。
func (s *ServerApp) Reload() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.dataDir, runtimeConfigFileName)
	rs, err := LoadRuntimeSettings(path)
	if err != nil {
		return err
	}
	env := LoadConfig()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	preMerge := MergeRuntimeConfig(env, rs, s.dataDir)
	if (rs == nil || !rs.Initialized) && preMerge.RuntimeDualWriteRedis && strings.TrimSpace(preMerge.RedisAddr) != "" {
		if rdb, err := dialRedisLight(preMerge); err == nil && rdb != nil {
			if rs2, err := LoadRuntimeSettingsFromRedis(ctx, rdb, preMerge); err != nil {
				log.Printf("Redis 读取 runtime-config 备份: %v", err)
			} else if rs2 != nil && rs2.Initialized {
				log.Printf("持久化: 从 Redis 恢复 runtime-config 到本地文件")
				rs = rs2
				if err := SaveRuntimeSettings(path, rs); err != nil {
					log.Printf("警告: 将 Redis 配置写回文件失败: %v", err)
				}
			}
			_ = rdb.Close()
		}
	}

	cfg := MergeRuntimeConfig(env, rs, s.dataDir)
	cfg = PrepareDashboardAuth(cfg)

	k8s, k8sREST, err := InitK8sForApp(rs)
	if err != nil {
		log.Printf("K8s 初始化: %v", err)
		k8s, k8sREST = nil, nil
	}
	// 初始化向导未填 K8s（none/跳过）时，与本地 kubectl 对齐：尝试 KUBECONFIG 或 Pod 内 in-cluster
	if k8s == nil && rs != nil && rs.Initialized && K8sRuntimeSkipped(rs) {
		if cs, cfg2, err2 := TryK8sFromEnv(); err2 == nil {
			k8s, k8sREST = cs, cfg2
			log.Println("K8s: 已使用进程环境连接（KUBECONFIG / in-cluster），runtime 未配置集群")
		}
	}

	sshStore, errSSH := OpenSSHSettingsStore(cfg)
	if errSSH != nil {
		log.Printf("警告: SSH 凭据存储初始化失败: %v", errSSH)
		sshStore = nil
	}

	vc := newVCenterClient(cfg)

	s.redis = nil
	if rdb, err := dialRedisLight(cfg); err != nil {
		log.Printf("Redis 连接: %v", err)
	} else {
		s.redis = rdb
	}
	s.platformKV = nil
	if kv, err := newPlatformKVFile(s.dataDir); err != nil {
		log.Printf("平台 KV 文件: %v", err)
	} else {
		s.platformKV = kv
		if s.redis != nil && cfg.RuntimeDualWriteRedis {
			if snap := kv.Snapshot(); len(snap) == 0 {
				if m, err := LoadPlatformKVFromRedis(ctx, s.redis, cfg); err != nil {
					log.Printf("Redis 读取 platform_kv 备份: %v", err)
				} else if m != nil && len(m) > 0 {
					log.Printf("持久化: 从 Redis 恢复 platform_kv 到本地文件")
					for k, v := range m {
						if err := kv.Set(k, v); err != nil {
							log.Printf("警告: 恢复 platform_kv[%s] 失败: %v", k, err)
						}
					}
				}
			}
			if err := MirrorPlatformKVToRedis(ctx, s.redis, cfg, kv.Snapshot()); err != nil {
				log.Printf("警告: platform_kv 镜像到 Redis 失败: %v", err)
			}
		}
	}

	if s.redis != nil && cfg.RuntimeDualWriteRedis && rs != nil && rs.Initialized {
		if err := MirrorRuntimeSettingsToRedis(ctx, s.redis, cfg, rs); err != nil {
			log.Printf("警告: runtime-config 镜像到 Redis 失败: %v", err)
		}
	}

	s.cfg = cfg
	s.k8s = k8s
	s.k8sREST = k8sREST
	s.sshStore = sshStore
	s.vc = vc
	s.runtime = rs
	s.initialized = rs != nil && rs.Initialized
	return nil
}

func (s *ServerApp) Cfg() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *ServerApp) K8s() *kubernetes.Clientset {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.k8s
}

func (s *ServerApp) K8sREST() *rest.Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.k8sREST
}

func (s *ServerApp) SSHStore() SSHSettingsStore {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sshStore
}

func (s *ServerApp) VCenter() *vCenterClient {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.vc
}

func (s *ServerApp) Initialized() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.initialized
}

func (s *ServerApp) DataDir() string {
	return s.dataDir
}

func (s *ServerApp) Runtime() *RuntimeSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.runtime
}

func (s *ServerApp) Redis() *RedisLight {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.redis
}

func (s *ServerApp) PlatformKV() *PlatformKVFile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.platformKV
}

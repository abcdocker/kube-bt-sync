<p align="center">
  <h1 align="center">Kube-BT-Sync</h1>
  <p align="center">
    面向自建 Kubernetes 与家庭宽带的 <strong>Ingress ↔ 宝塔面板</strong> 同步与 Web 控制台
  </p>
  <p align="center">
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <img src="https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go" alt="Go">
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React">
    <img src="https://img.shields.io/badge/Kubernetes-1.28+-326CE5?logo=kubernetes" alt="Kubernetes">
  </p>
</p>

---

## 📖 简介

**Kube-BT-Sync** 是一个面向 Homelab / 自建集群的边缘网关同步中心。它在 Kubernetes 集群内部监听 Ingress 变化，自动将路由规则同步到公网宝塔面板（或任意 Nginx）；同时提供一个内置的 React Web 控制台，支持：

- **Kubernetes** 资源可视化管理（Pods、Nodes、Services、工作负载、RBAC 等）
- **宝塔面板** 对接与 HTTPS 证书管理
- **应用中心**（Redis、Kafka、OpenSearch、云主机）一键部署与纳管
- **vCenter / 公有云** 虚拟机列表、WebMKS 控制台与 SSH 终端
- **可观测性** Prometheus / VictoriaMetrics / VictoriaLogs 统一查询入口
- **文档中心** Markdown 知识库与附件管理

## 🚀 核心功能

| 模块 | 说明 |
| :--- | :--- |
| **工作台** | 首页汇总，支持 Kubernetes、vCenter、宝塔、应用中心、文档等多工作区切换 |
| **Kubernetes** | 集群概览、按命名空间浏览资源、Pods 日志/终端、Nodes、Services、工作负载、RBAC 只读视图 |
| **宝塔** | Ingress 列表、与宝塔 Nginx 的自动同步、SSL 证书设置 |
| **应用中心** | Redis / Kafka / OpenSearch / 云主机 的模板化部署与生命周期管理 |
| **vCenter / 公有云** | 虚拟机资产、WebMKS 控制台、SSH 终端、云主机纳管（需配置 vCenter 或 SSH 凭据） |
| **可观测性** | 集群/虚拟机/公有云监控统一查询、日志检索（VictoriaLogs）、巡检报告 |
| **账户与权限** | 本地登录、TOTP 双因素认证、OIDC（Authentik 等）、平台用户与角色管理 |
| **文档中心** | Markdown 编辑器、分类与标签、附件存储（本地或腾讯云 COS） |

## 🏗️ 技术栈

### 后端

| 技术 | 用途 |
| :--- | :--- |
| [Go 1.25+](https://go.dev/) | 主服务语言 |
| [Gin](https://github.com/gin-gonic/gin) | HTTP Web 框架 |
| [client-go](https://github.com/kubernetes/client-go) | Kubernetes API 交互 |
| [MySQL](https://github.com/go-sql-driver/mysql) | 业务持久化（用户、审计、应用实例、文档等） |
| [Redis](https://github.com/redis/go-redis) | 缓存、会话、运行时配置镜像 |
| [go-oidc](https://github.com/coreos/go-oidc) | OIDC / OAuth2 认证 |
| [govmomi](https://github.com/vmware/govmomi) | vSphere / vCenter 集成 |
| [franz-go](https://github.com/twmb/franz-go) | Kafka Admin 客户端 |
| [x/crypto](https://golang.org/x/crypto) | SSH / SFTP / 加密存储 |

### 前端

| 技术 | 用途 |
| :--- | :--- |
| [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | UI 框架 |
| [Vite](https://vitejs.dev/) | 构建工具 |
| [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) | 样式与组件基础 |
| [shadcn/ui](https://ui.shadcn.com/) 风格 | 组件设计体系 |
| [TanStack Query](https://tanstack.com/query) | 服务端状态管理 |
| [React Router v7](https://reactrouter.com/) | 路由 |
| [XTerm.js](https://xtermjs.org/) | Web SSH 终端 |
| [Recharts](https://recharts.org/) | 图表 |
| [ByteMD](https://github.com/bytedance/bytemd) | Markdown 编辑器 |
| [Excalidraw](https://excalidraw.com/) | 白板绘图 |

## 📦 快速开始

### 前置要求

- Kubernetes 集群（1.28+）
- 集群内可访问的 **MySQL** 与 **Redis**
- （可选）宝塔面板（用于 Ingress 同步）
- （可选）vCenter（用于虚拟机管理）

### 方式一：一键部署（推荐）

```bash
kubectl apply -f deploy/kube-bt-sync-all.yaml
```

清单包含：Namespace、RBAC、PVC（5Gi）、Deployment、ClusterIP Service、**NodePort 32080**。

1. 等待 Pod Running：`kubectl -n kube-bt-sync get pod,pvc`
2. 浏览器访问 `http://<任意节点IP>:32080/setup` 完成向导
3. （可选）配置 Ingress + HTTPS：`kubectl apply -f deploy/ingress.yaml`

> 若私有仓库需登录拉取镜像，参考 `deploy/kube-bt-sync-all.yaml` 文件头注释创建 `docker-registry` Secret。

### 方式二：Helm

```bash
helm install kube-bt-sync ./charts/kube-bt-sync \
  --namespace kube-bt-sync --create-namespace \
  --set app.image.repository=your-registry/kube-bt-sync \
  --set app.image.tag=latest
```

### 方式三：本地开发

```bash
# 一键启动后端 + 构建前端
./run.sh

# 前端独立开发（热更新）
cd react && npm ci && npm run dev
```

默认监听 `http://127.0.0.1:8080/`；若 8080 被占用，脚本会自动改用其他端口。

## ⚙️ 关键环境变量

完整解析见 `internal/config.go` 中 `LoadConfig()`。

| 变量 | 说明 | 示例 |
| :--- | :--- | :--- |
| `DASHBOARD_HTTP_ADDR` | 监听地址 | `:8080` |
| `DASHBOARD_PASSWORD` | Web 登录密码（空则禁用本地登录） | 来自 Secret |
| `DASHBOARD_SESSION_SECRET` | 会话签名密钥（**多副本必填**） | 随机 64 位 hex |
| `DASHBOARD_COOKIE_SECURE` | HTTPS 时设为 `true` | `true` |
| `DASHBOARD_TRUSTED_PROXIES` | 可信代理 CIDR | `10.0.0.0/8,172.16.0.0/12` |
| `BAOTA_URL` / `BAOTA_API_KEY` | 宝塔 API 地址与密钥 | — |
| `VCENTER_URL` / `VCENTER_USER` / `VCENTER_PASSWORD` | vCenter 连接信息 | — |
| `MYSQL_DSN` 或 `MYSQL_HOST` 系列 | MySQL 连接 | — |
| `REDIS_ADDR` / `REDIS_PASSWORD` | Redis 连接 | — |
| `KUBEBT_DATA_DIR` | 数据目录（建议挂载 PVC） | `/data` |
| `KUBEBT_ENCRYPTION_KEY` | 加密 SSH/SFTP 等敏感信息的密钥 | 随机长串 |
| `OIDC_ISSUER_URL` 等 | OIDC 配置（四项同时配置才生效） | — |
| `KUBEBT_ENABLE_BACKGROUND_JOBS` | 是否启用后台同步/巡检 | `true` |

更多变量（Prometheus、Harbor、COS、TOTP、性能模式等）请参考源码 `internal/config.go` 注释或部署清单中的示例。

## 🔒 安全建议

- **敏感配置**（密码、API Key）请使用 Kubernetes `Secret` 注入，**不要**直接写入镜像或 ConfigMap。
- **多副本**时务必显式设置 `DASHBOARD_SESSION_SECRET`，并确保仅 1 个 Pod 的 `KUBEBT_ENABLE_BACKGROUND_JOBS=true`。
- 生产环境建议通过 **Ingress + HTTPS** 暴露，设置 `DASHBOARD_COOKIE_SECURE=true`。
- 配置可信代理 `DASHBOARD_TRUSTED_PROXIES` 以正确获取客户端真实 IP；裸机/公网直连时保持默认（不信任 XFF）。
- 详细安全策略与漏洞报告方式见 [SECURITY.md](./SECURITY.md)。

## 🏗️ 镜像构建

```bash
# 单架构
docker build -t your-registry/kube-bt-sync:latest .

# 多架构（Buildx）
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/kube-bt-sync:latest --push .
```

构建特性：
- 多阶段构建，最终镜像不含 Node/npm
- 运行时基于 `distroless/static-debian12:nonroot`（无 shell，攻击面小）
- 静态链接，`-trimpath`、`-ldflags="-s -w"` 去除符号表
- 镜像内无 `curl`/`wget`，健康检查请使用 HTTP 探针 `/api/health`

## 🧩 接管存量 Ingress

为已有 Ingress 打上注解即可被纳管：

```bash
kubectl annotate ingress <name> -n <namespace> i4t.com/baota-sync="true"
```

如需宝塔侧同时启用 HTTPS，可增加：

```yaml
annotations:
  i4t.com/baota-sync: "true"
  i4t.com/baota-https: "true"
  i4t.com/baota-ssl-cert-name: "example-cert"
```

## 📁 配置持久化说明

| 数据类型 | 存储位置 | 说明 |
| :--- | :--- | :--- |
| **核心运行时配置** | `dataDir/runtime-config.json`（PVC） | 宝塔、vCenter、MySQL/Redis 连接等 |
| **平台 KV** | `dataDir/platform_kv.json`（PVC）+ 可选 Redis 镜像 | 侧边栏菜单、登录安全状态等 |
| **业务数据** | MySQL | 用户、审计日志、Redis/Kafka/CloudVM 实例、文档中心等 |
| **SSH 凭据** | `dataDir/ssh-settings/`（PVC，推荐）或预留 MySQL | 私钥与密码（经 `KUBEBT_ENCRYPTION_KEY` 加密） |
| **审计与日志** | 本地文件（PVC）+ MySQL `kubebt_audit_log` | 访问日志与操作审计 |

> **权威配置仍以 PVC 文件为准**，Redis 双写为灾备镜像。启动时若本地未初始化，可尝试从 Redis 拉回。

## 🤝 贡献

欢迎 Issue 和 Pull Request！请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📄 许可证

[MIT License](./LICENSE)

---

> **免责声明**：本项目主要面向 Homelab 与自建基础设施场景。生产环境使用前请充分评估安全与可靠性需求。

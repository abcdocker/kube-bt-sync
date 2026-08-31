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

## 🆕 近期更新（2026-06-29）

### 日志中心与采集

- 日志查询页按 Kubernetes 容器、虚拟机、平台服务等来源分类，支持时间、级别、命名空间、Pod、主机和指定字段组合检索。
- 单条日志使用字段弹窗展示，可复制字段、按字段继续过滤，并对当前日志或查询结果发起 AI 分析。
- 新增日志源发现与字段元数据接口，查询逻辑从页面组件中拆分，便于后续接入新系统。
- AI 分析前会对密码、Token、Cookie、Authorization 等敏感字段脱敏；采集接入示例见 [`docs/log-collection.md`](./docs/log-collection.md)。

### vSphere 控制台重构

- 虚拟机详情页内置 noVNC 控制台，可直接操作虚拟机屏幕、键盘并发送 `Ctrl+Alt+Del`，支持独立窗口、全屏与重新建立会话。
- 浏览器只连接 kube-bt-sync 的同源 WebSocket；平台后端通过 vCenter SDK 获取一次性 WebMKS ticket，再从集群内部连接 ESXi，全程不跳转 vCenter、SSO，也不依赖 SSH、Guest IP 或 VMware Tools。
- WebMKS 上游连接按 VMware 协议协商 `binary` 子协议，并将 RFB 数据帧透明转发给 noVNC。
- 新增 `VCENTER_CONSOLE_HOST` / 运行时“ESXi 控制台地址”，用于 Pod 无法解析 ticket 中 ESXi 主机名时指定可达的 IP、主机名或 `host:port`。
- 旧的 `VCENTER_CONSOLE_PROXY_URL` 已废弃并被忽略，避免 `/ui/webmks` 再次触发 vCenter SSO 登录页或跨域错误。
- 控制台错误信息会隐藏 ticket 等敏感内容，并保留上游 HTTP 状态，方便区分 DNS、网络、证书和 WebSocket 握手问题。

### 云平台、稳定性与安全

- 补齐腾讯云、七牛云和又拍云 API 客户端及管理页面，统一云平台认证配置说明。
- 后台任务增加 Kubernetes Lease 选主，部署清单补充 PDB、资源限制与所需 RBAC，支持多副本安全运行。
- 健康检查拆分为 `/livez` 与 `/readyz`；审计日志改为异步队列，降低请求链路阻塞。
- SSH 主机指纹校验、TLS 默认策略、登录限流和日志敏感字段处理进一步收紧。

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

### 复刻范围与前置要求

- **本地完整环境（推荐首次体验）**：Docker Engine / Docker Desktop + Docker Compose v2。Compose 会从源码构建平台，并启动 MySQL 8.4 与 Redis 7.4。
- **Kubernetes 部署**：Kubernetes 1.28+、可用的 StorageClass，以及集群内可访问的 MySQL 和 Redis。K8s 清单不会代为部署数据库。
- **可选集成**：宝塔、vCenter、Prometheus、VictoriaMetrics 等都需要你自己可访问的实例和凭据，不属于默认复刻环境。

### 方式一：Docker Compose 本地完整环境（推荐）

在 Ubuntu 24.04 服务器上首次部署时，先安装 Docker、Compose v2 和 Git：

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

`usermod` 后退出 SSH 并重新登录，使 `docker` 组权限生效。然后克隆目标分支：

```bash
git clone --branch codex/open-source-sanitization --single-branch \
  https://github.com/abcdocker/kube-bt-sync.git
cd kube-bt-sync
```

```bash
# 仅在首次启动时执行：生成随机密码和会话/加密密钥到 .env
bash scripts/init-compose-env.sh

# 验证配置并启动平台、MySQL、Redis
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

默认访问 `http://127.0.0.1:18081/setup`。生成的 `.env` 已被 Git 忽略；请妥善保管，不要提交。停止服务使用 `docker compose down`；如需连同数据卷一起删除，显式执行 `docker compose down -v`。

默认只监听回环地址。如需从局域网访问服务器，在首次启动前修改 `.env`：

```dotenv
KUBEBT_BIND_ADDRESS=0.0.0.0
PLATFORM_PUBLIC_URL=http://<服务器IP>:18081
```

然后访问 `http://<服务器IP>:18081/setup`。不要将该 HTTP 端口直接暴露到公网；生产环境应使用防火墙、反向代理和 HTTPS。

初始化脚本只会把随机凭据写入 `.env`，不会在 `docker compose up` 日志中打印。`docker compose config --quiet` 也不会显示配置；请注意，不带 `--quiet` 的 `docker compose config` 会展开变量并可能在终端显示密码。

Compose 容器之间使用以下连接信息：

| 服务 | 容器内地址 | 用户 / 数据库 | 密码变量 |
|---|---|---|---|
| MySQL | `mysql:3306` | `MYSQL_USER` / `MYSQL_DATABASE`（默认均为 `kube_bt_sync`） | `MYSQL_PASSWORD` |
| MySQL root | `mysql:3306` | `root` | `MYSQL_ROOT_PASSWORD` |
| Redis | `redis:6379` | 无用户名 | `REDIS_PASSWORD` |

MySQL 和 Redis 默认不映射到宿主机端口，仅供 Compose 网络内的平台容器访问。首次打开 `/setup` 时，向导会自动读取 `.env` 注入的非敏感连接信息；数据库密码、Redis 密码和 `KUBEBT_ENCRYPTION_KEY` 不会返回浏览器，保存时由服务端直接沿用。用户只需确认连接配置并设置平台管理员密码；如需使用外部 MySQL/Redis，可关闭向导中的“使用运行环境配置”后手动填写。

如果国内网络拉取 Docker Hub 或 `gcr.io` 超时，可在 `/etc/docker/daemon.json` 中合并信任的 Docker Hub 镜像加速地址（不要覆盖已有配置），重启 Docker，并在 `.env` 中设置：

```dotenv
BASE_RUNTIME=gcr.m.daocloud.io/distroless/static-debian12:nonroot
GOPROXY=https://goproxy.cn,direct
```

镜像映射用法可参考 [DaoCloud public-image-mirror](https://github.com/DaoCloud/public-image-mirror)。第三方镜像服务应按组织的供应链安全策略评估后使用。

Compose 默认不挂载主机 kubeconfig。首次进入 `/setup` 可先选择“不连接 Kubernetes”；如需管理真实集群，请在向导中填入专用、最小权限的 kubeconfig。

### 方式二：Kubernetes Release 清单

每次 GitHub Release 会附带 `kube-bt-sync-all.yaml`，其镜像地址会自动替换为发布该 Release 的 `ghcr.io/<owner>/<repository>:<tag>`。

```bash
# 将 <owner>/<repository> 替换为你实际使用的公开仓库
kubectl apply -f \
  https://github.com/<owner>/<repository>/releases/latest/download/kube-bt-sync-all.yaml

kubectl -n kube-bt-sync rollout status deployment/kube-bt-sync
kubectl -n kube-bt-sync get pod,pvc
```

浏览器访问 `http://<任意节点IP>:32080/setup`。如 PVC 长时间处于 `Pending`，先用 `kubectl get storageclass` 确认默认 StorageClass，或下载清单后填写 `storageClassName`再 apply。

源码中的 `deploy/kube-bt-sync-all.yaml` 是通用模板，默认镜像仅适用于同名公开组织。Fork 或改名仓库请优先使用 Release 附件，或在部署前替换镜像地址。

MySQL、Redis 和平台公网 URL 可在 `/setup` 向导填写，也可在部署前根据 [`deploy/secret-example.yaml`](./deploy/secret-example.yaml) 创建 `kube-bt-sync-secrets`。真实 Secret 文件不要保存在仓库内。

### 方式三：Helm

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add metallb https://metallb.github.io/metallb
helm dependency build ./charts/kube-bt-sync

helm install kube-bt-sync ./charts/kube-bt-sync \
  --namespace kube-bt-sync --create-namespace \
  --set-string app.image.repository=ghcr.io/<owner>/<repository> \
  --set-string app.image.tag=<tag>
```

如集群没有默认 StorageClass，额外传入 `--set-string persistence.storageClass=<storage-class>`。Helm 默认创建 ClusterIP Service，安装后使用：

```bash
kubectl port-forward -n kube-bt-sync svc/kube-bt-sync-svc 8080:8080
# 打开 http://127.0.0.1:8080/setup
```

### 方式四：单应用本地开发

```bash
# 使用 Docker 构建并启动单个应用容器，不会启动 MySQL / Redis
./run.sh local

# 前端独立开发（热更新）
cd react && npm ci && npm run dev
```

`run.sh local` 默认访问地址为 `http://127.0.0.1:18081/`；若 18081 被占用，脚本会改用 18082。该模式只适合已经在 `.env.test` 中准备好外部 MySQL / Redis 的开发者；首次复刻请优先使用 Compose。

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
| `VCENTER_INSECURE` | 仅自签环境临时跳过 vCenter TLS 校验（默认 `false`） | `false` |
| `VCENTER_CONSOLE_HOST` | Pod 可访问的 ESXi WebMKS 地址；ticket 主机名无法解析时设置 | `192.168.21.101` |
| `VCENTER_VM_SSH_HOST_KEY_FINGERPRINT` | SSH 安全模式固定的主机指纹 | `SHA256:...` |
| `MYSQL_DSN` 或 `MYSQL_HOST` 系列 | MySQL 连接 | — |
| `REDIS_ADDR` / `REDIS_PASSWORD` | Redis 连接 | — |
| `KUBEBT_DATA_DIR` | 数据目录（建议挂载 PVC） | `/data` |
| `KUBEBT_ENCRYPTION_KEY` | 加密 SSH/SFTP 等敏感信息的密钥 | 随机长串 |
| `OIDC_ISSUER_URL` 等 | OIDC 配置（四项同时配置才生效） | — |
| `KUBEBT_ENABLE_BACKGROUND_JOBS` | 是否启用后台同步/巡检 | `true` |
| `KUBEBT_LEADER_ELECTION` | 多副本后台任务 Lease 选主（默认 `true`） | `true` |

更多变量（Prometheus、Harbor、COS、TOTP、性能模式等）请参考源码 `internal/config.go` 注释或部署清单中的示例。

## 🔒 安全建议

- **敏感配置**（密码、API Key）请使用 Kubernetes `Secret` 注入，**不要**直接写入镜像或 ConfigMap。
- **多副本**时务必显式设置 `DASHBOARD_SESSION_SECRET`；后台任务通过 Kubernetes Lease 自动选主。使用 PVC 时需 ReadWriteMany，或关闭本地持久化并使用 MySQL/Redis。
- 生产环境建议通过 **Ingress + HTTPS** 暴露，设置 `DASHBOARD_COOKIE_SECURE=true`。
- 非回环访问不再默认授予匿名管理员；必须配置本地密码或 OIDC。`KUBEBT_ALLOW_UNAUTHENTICATED_ADMIN=true` 仅用于明确接受风险的临时兼容。
- 宝塔、vCenter 与 SSH 主机密钥校验默认均为安全模式；自签证书应导入可信 CA，不要长期使用 skip/insecure 开关。
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
- 镜像内无 `curl`/`wget`；存活探针使用 `/livez`，就绪探针使用 `/readyz`

## 🖥️ vSphere 原生控制台

虚拟机详情默认打开“vSphere 原生控制台”。前端使用 noVNC，后端通过 `AcquireTicket(webmks)` 获取一次性票据，并在同源 WebSocket `/api/vcenter/vms/:moref/console-ws` 内代理 ESXi 的 RFB 数据。

- 浏览器只访问 kube-bt-sync，不会直接请求 vCenter、ESXi 或 SSO 域名。
- 运行 kube-bt-sync 的 Pod/主机必须能够访问 ESXi WebMKS 端口（默认 443）。
- 若 ticket 返回的 ESXi 主机名在容器内无法解析，请在运行时设置中填写“ESXi 控制台地址”，或设置 `VCENTER_CONSOLE_HOST=192.168.21.101`。只填写主机时会沿用 ticket 端口，也可填写 `host:port`。
- 不要再配置 `/ui/webmks/{moid}` 一类 vCenter 页面地址；`VCENTER_CONSOLE_PROXY_URL` 已废弃，平台会忽略该值。
- 虚拟机必须已开机；点击黑色控制台区域后即可输入。操作系统登录仍由虚拟机自身负责。
- 若 vCenter 使用自签证书，推荐把 CA 加入运行环境信任链；只在临时排障时设置 `VCENTER_INSECURE=true`。

连接链路：

```text
浏览器 noVNC
  └─ wss://<平台>/api/vcenter/vms/<moref>/console-ws
       ├─ vCenter SDK: AcquireTicket(webmks)
       └─ wss://<ESXi>/ticket/<一次性票据>  [binary / RFB]
```

## 🧩 接管存量 Ingress

为已有 Ingress 打上注解即可被纳管：

```bash
kubectl annotate ingress <name> -n <namespace> kube-bt-sync.io/baota-sync="true"
```

如需宝塔侧同时启用 HTTPS，可增加：

```yaml
annotations:
  kube-bt-sync.io/baota-sync: "true"
  kube-bt-sync.io/baota-https: "true"
  kube-bt-sync.io/baota-ssl-cert-name: "example-cert"
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

# 🚀 Kube-BT-Sync 边缘网关同步工具

![K8s Version](https://img.shields.io/badge/Kubernetes-1.20+-blue.svg)
![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

**Kube-BT-Sync** 是一款专为 **HomeLab (家庭数据中心) / 边缘节点** 设计的轻量级云原生网关同步工具。它能够将家庭内网 Kubernetes 集群的服务暴露需求，实时、自动地同步到具有公网 IP 的宝塔 (Baota) 面板上，实现内外网流量的完美穿透与接管。

> **作者：** [abcdocker (i4t.com)](https://i4t.com)

---

## ✨ 核心特性

- 🕸️ **云边协同组网**：公网宝塔面板处理 HTTPS 与 WAF 防护，后端流量精准穿透至家庭 K8s 节点。
- 🖥️ **高颜值 Web 控制台**：提供三足鼎立的大盘监控（宝塔状态、K8s 设施、DDNS 状态）。
- 🖱️ **可视化向导 + 极客模式**：支持全图形化点选下发 Ingress（智能联动获取 Namespace/Service/Port），也支持纯 YAML 高级下发。
- 🔒 **一键 HTTPS 注入**：UI 面板提供拨动开关，下发时自动生成 K8s 标准 TLS 证书配置块。
- 📡 **智能雷达探测**：自动识别 `MetalLB` 和 `Ingress-Nginx` 的部署状态（全面兼容 Deployment / DaemonSet 裸机模式）。
- 🔄 **状态防闪烁轮询**：路由表状态自动后台静默刷新，包含高并发防击穿内存 TTL 缓存。
- 📖 **小白级路由指引**：自动抓取物理节点 (Node) 的真实局域网 IP，动态生成“路由器 NAT 映射作业表”。

---

## 🗺️ 架构与流量链路

外网用户访问您的业务域名时，流量流经如下路径：
1. **外网访客** ➜ 访问公网域名 `https://app.i4t.com`
2. **云端宝塔面板** ➜ 接收请求，通过反向代理将流量打向您家庭宽带的 DDNS 地址和高端口 (例: `home.i4t.com:38333`)
3. **家庭主路由器 (NAT)** ➜ 接收到 `38333` 端口流量，转发至 K8s 物理节点的 `80/443` 端口
4. **K8s Ingress 控制器** ➜ Nginx 接收流量，根据 Ingress 规则路由给具体的业务 Pod

---

## 🚀 快速部署

### 1. 准备工作
- 一台具有公网 IP 并安装了宝塔面板的云服务器。
- 在宝塔面板中开启 API 功能，并将 K8s 所在环境的公网出口 IP 加入白名单。
- 准备好一个家庭宽带的 DDNS 域名（如 `home.i4t.com`）。

### 2. 部署到 Kubernetes (二选一)

本项目支持 **Helm 一键部署 (推荐)** 和 **纯 YAML 部署** 两种方式：

#### 方案 A：使用 Helm 部署 (🔥 推荐)
Helm 方式支持全自动配置 RBAC 权限与资源管理。请进入仓库根目录，修改 `charts/kube-bt-sync/values.yaml` 中的对应变量，然后执行：
```bash
# 安装并创建 tools 命名空间
helm install edge-gateway charts/kube-bt-sync -n tools --create-namespace
```

#### 方案 B：使用纯 YAML 部署
如果您没有安装 Helm，可以直接下载并编辑 `deploy.yaml`，将其中的环境变量（宝塔 URL、API Key、DDNS 等）替换为您自己的真实信息，然后执行：
```bash
kubectl apply -f deploy.yaml
```

### 3. 访问控制台
部署成功后，通过任意 K8s 节点的局域网 IP 和 `31080` 端口访问 Web 控制台：
- **地址**: `http://<任意 Node IP>:31080`
- **默认账号**: `admin`
- **默认密码**: `i4t123456`

---

## 🎯 如何接管存量 Ingress

如果您在部署 Kube-BT-Sync 之前，集群中已经存在跑着的业务 Ingress，**完全不需要删除重建！**

Kube-BT-Sync 的核心逻辑是监听包含特定 `Annotations` (注解) 的 Ingress。您只需为现有的 Ingress 打上同步标签，工具就会瞬间接管它，并将其同步到公网宝塔面板上。

执行以下命令即可一键接入（请替换为您自己的 `Ingress 名称` 和 `命名空间`）：
```bash
kubectl annotate ingress <你的存量Ingress名称> -n <命名空间> kube-bt-sync.io/baota-sync="true"
```
*(操作完成后，刷新您的 Web 控制台，该路由就会出现在“已同步的路由规则”列表中。)*

---

## ⚙️ 环境变量配置说明

在 Deployment 中，支持以下环境变量配置：

| 变量名 | 必填 | 说明 | 示例值 |
| :--- | :---: | :--- | :--- |
| `AUTH_USER` | 是 | Web 控制台的 Basic Auth 登录账号 | `admin` |
| `AUTH_PASSWORD` | 是 | Web 控制台的登录密码 | `i4t123456` |
| `BAOTA_URL` | 是 | 宝塔面板 API 接口地址 (带协议和端口) | `http://110.x.x.x:8888` |
| `BAOTA_API_KEY` | 是 | 宝塔面板生成的 API 密钥 | `faEZ9s7Z5J6cIFv...` |
| `DDNS_HOST` | 是 | 家庭宽带绑定的动态域名 | `home.i4t.com` |
| `DEFAULT_PORT`| 是 | 映射到宝塔的反代默认接收端口 | `38333` |

---

## 🛠️ 路由器 NAT 映射配置 (必做)

为了让流量闭环，您必须在家庭主路由器（或光猫）的“端口映射/虚拟服务器”中添加如下规则：

* **外部端口**：`38333` (需与环境变量 `DEFAULT_PORT` 保持一致)
* **内部 IP 地址**：填写您的 K8s Ingress 所在节点的局域网 IP (系统控制台页面会自动探测并显示此 IP)。
* **内部端口**：`80` (或 443，取决于您的 Ingress 配置方式)
* **协议类型**：`TCP`

> 💡 **提示**: 登录 Kube-BT-Sync 的 Web 页面，首页会为您动态生成准确的路由器配置指南，直接“抄作业”即可！

---

## 📄 协议

本项目基于 [MIT License](LICENSE) 协议开源。

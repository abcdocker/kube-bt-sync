# 🚀 Kube-BT-Sync 边缘网关同步工具

![K8s Version](https://img.shields.io/badge/Kubernetes-1.20+-blue.svg)
![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

**Kube-BT-Sync** 是一款专为 **HomeLab (家庭数据中心) / 边缘节点** 设计的轻量级云原生网关同步工具。它能够将家庭内网 Kubernetes 集群的服务暴露需求，实时、自动地同步到具有公网 IP 的宝塔 (Baota) 面板上，实现内外网流量的完美穿透与接管。

> **作者：** [abcdocker (i4t.com)](https://i4t.com)

---

## ✨ 核心特性升级

- 🕸️ **云边协同组网**：公网宝塔面板处理 HTTPS 与 WAF 防护，后端流量精准穿透至家庭 K8s 节点。
- 🖥️ **高颜值 Web 控制台**：提供大盘监控，**前端原生支持自定义 HTTPS 端口全链路探活探测**。
- 🖱️ **配置可视化与在线编辑**：
  - **可视化向导**：智能联动获取 Namespace/Service/Port。
  - **在线编辑与查看**：一键提取存量 Ingress 纯净 YAML，支持页面直接修改覆盖。
  - **版本审计**：追踪路由 K8s ResourceVersion 变更记录，精确显示创建时间和修改时间。
- 🔒 **一键原生 SSL/HTTPS 支持**：申请 Ingress 界面提供 SSL 开启开关，自动注入标准 TLS 证书块，无缝对接 Let's Encrypt。
- 📡 **智能雷达探测**：自动识别 `MetalLB` 和 `Ingress-Nginx` 的部署状态（兼容 DaemonSet 裸机模式）。
- 🔄 **事件驱动极速同步**：废弃高频轮询，全面拥抱 K8s Native Watcher (事件驱动)，精准捕捉配置变动，宝塔 API 零压迫。

---

## 🗺️ 架构与流量链路

外网用户访问您的业务域名时，流量流经如下路径：
1. **外网访客** ➜ 访问公网域名 `https://app.i4t.com`
2. **云端宝塔面板** ➜ 接收请求，通过反向代理将流量打向您家庭宽带的 DDNS 地址和高端口 (例: `home.i4t.com:38333`)
3. **家庭主路由器 (NAT)** ➜ 接收到流量，转发至 K8s 物理节点的 `80/443` 端口
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
请进入仓库根目录，修改 `charts/kube-bt-sync/values.yaml` 中的对应变量，然后执行：
```bash
helm install edge-gateway charts/kube-bt-sync -n tools --create-namespace
```

#### 方案 B：使用纯 YAML 部署
直接下载并编辑 `deploy.yaml`，将其中的环境变量替换为您自己的真实信息，然后执行：
```bash
kubectl apply -f deploy.yaml
```

### 3. 访问控制台
部署成功后，通过任意 K8s 节点的局域网 IP 和 `31080` 端口访问 Web 控制台。

---

## 🎯 如何接管与编辑存量 Ingress

如果您在部署 Kube-BT-Sync 之前，集群中已经存在跑着的业务 Ingress，**完全不需要删除重建！**
只需执行以下命令，工具就会瞬间接管并在 UI 面板中展现其创建与修改记录：
```bash
kubectl annotate ingress <你的存量Ingress名称> -n <命名空间> kube-bt-sync.io/baota-sync="true"
```
接入后，您可以直接在 Web 页面点击 **“📝 编辑”**，即可进入 YAML 极客模式安全地修改并覆盖它。

---

## ⚙️ 环境变量配置说明

| 变量名 | 必填 | 说明 | 示例值 |
| :--- | :---: | :--- | :--- |
| `AUTH_USER` | 是 | Web 控制台登录账号 | `admin` |
| `AUTH_PASSWORD` | 是 | Web 控制台登录密码 | `i4t123456` |
| `BAOTA_URL` | 是 | 宝塔面板 API 接口地址 | `http://110.x.x.x:8888` |
| `BAOTA_API_KEY` | 是 | 宝塔面板 API 密钥 | `faEZ...` |
| `DDNS_HOST` | 是 | 家庭宽带绑定的动态域名 | `home.i4t.com` |
| `DEFAULT_PORT`| 是 | 宝塔反代接收默认端口 | `38333` |
| `HTTPS_PORT`| 否 | **(新增)** 自定义外网直连 HTTPS 端口，默认 443 | `44333` |

---

## 🛠️ 路由器 NAT 映射配置 (极度重要)

为保障内外网流量精准穿透以及 HTTPS 证书验证，请在您的主路由器中配置 **两组** 端口映射规则 (指向 K8s 物理节点)：

* **【规则 1 - 宝塔反代专用】**
  * 外部端口：`38333` (对应 `DEFAULT_PORT`) ➜ 内部端口：`80` 
* **【规则 2 - HTTPS 证书签发/直连】**
  * 外部端口：`443` (对应 `HTTPS_PORT` 变量) ➜ 内部端口：`443` (标准 HTTPS 流量与内部组件 ACME 验证必需)

> 💡 **提示**: 登录 Kube-BT-Sync 控制台，首页的“家庭边缘节点”模块会自动探测您的 HTTPS 端口连通状态。

---

## ⚠️ 常见问题避坑指南 (FAQ)

### Q1: 页面访问报 `ERR_TOO_MANY_REDIRECTS` (308 重定向死循环)？
当外网宝塔 Nginx 卸载了 HTTPS 证书，用纯 HTTP 将请求转发给家庭内网的 K8s Ingress 时，由于内网 Ingress 也配置了 TLS，K8s 会默认将 HTTP 请求强制重定向回 HTTPS，导致死循环。

**解决方案：**
Kube-BT-Sync 控制台生成的 Ingress 已默认添加防重定向注解。对于手工编写的 Ingress，请务必加上：
```yaml
annotations:
  nginx.ingress.kubernetes.io/ssl-redirect: "false"
```

---

## 📄 协议

本项目基于 [MIT License](LICENSE) 协议开源。

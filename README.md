# 🚀 kube-bt-sync (K8s 边缘网关同步中心)

![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=for-the-badge&logo=go)
![Kubernetes](https://img.shields.io/badge/Kubernetes-Compatible-326ce5?style=for-the-badge&logo=kubernetes)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**kube-bt-sync** 是一款专为 HomeLab 和自建 Kubernetes 集群打造的自动化边缘网关同步工具。

它通过监听集群中的 Ingress，自动将路由同步至公网宝塔面板（Nginx），**解决家庭宽带 80/443 被封、需带端口访问**的问题。内置 **React + Vite** Web 控制台，支持 Ingress 管理、集群资源浏览、可选 vCenter 集成等。

---

## ✨ 核心特性

- 🕸️ **云边协同组网**：公网宝塔面板处理 HTTPS 与 WAF 防护，后端流量精准穿透至家庭 K8s 节点。
- 🖥️ **高颜值 Web 控制台**：提供大盘监控，前端原生支持自定义 HTTPS 端口全链路探活探测。
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
2. **云端宝塔面板** ➜ 接收请求，通过反向代理将流量打向家庭宽带的 DDNS 地址和高端口 (例: `home.i4t.com:38333`)
3. **家庭主路由器 (NAT)** ➜ 接收到流量，转发至 K8s 物理节点的 `80/443` 端口
4. **K8s Ingress 控制器** ➜ Nginx 接收流量，根据 Ingress 规则路由给具体的业务 Pod

---

## 🐳 构建镜像

```bash
docker build -t your-registry/kube-bt-sync:latest .
```

多架构示例（需 Docker Buildx）：

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/kube-bt-sync:latest --push .
```

---

## ☸️ 部署到 Kubernetes

### 方式一：Helm (推荐)

```bash
helm install kube-bt-sync ./charts/kube-bt-sync \
  --namespace kube-bt-sync --create-namespace \
  --set image.repository=your-registry/kube-bt-sync \
  --set image.tag=latest
```

### 方式二：Kustomize

```bash
kubectl apply -k deploy/
```

---

## 🎯 如何接管存量 Ingress

如果您在部署 Kube-BT-Sync 之前，集群中已经存在跑着的业务 Ingress，**完全不需要删除重建！**

只需执行以下命令，工具就会瞬间接管并在 UI 面板中展现其创建与修改记录：

```bash
kubectl annotate ingress <你的存量Ingress名称> -n <命名空间> i4t.com/baota-sync="true"
```

接入后，您可以直接在 Web 页面点击 **"📝 编辑"**，即可进入 YAML 极客模式安全地修改并覆盖它。

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
| `HTTPS_PORT`| 否 | 自定义外网直连 HTTPS 端口，默认 443 | `44333` |

---

## 🛠️ 路由器 NAT 映射配置 (极度重要)

为保障内外网流量精准穿透以及 HTTPS 证书验证，请在您的主路由器中配置 **两组** 端口映射规则 (指向 K8s 物理节点)：

* **【规则 1 - 宝塔反代专用】**
  * 外部端口：`38333` (对应 `DEFAULT_PORT`) ➜ 内部端口：`80` 
* **【规则 2 - HTTPS 证书签发/直连】**
  * 外部端口：`443` (对应 `HTTPS_PORT` 变量) ➜ 内部端口：`443` (标准 HTTPS 流量与内部组件 ACME 验证必需)

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

## 🤝 贡献与 License

欢迎 Issue / PR。若对你有帮助，请给个 ⭐。

MIT License.
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

您只需为现有的 Ingress 打上同步标签，工具就会瞬间接管它，并将其同步到公网宝塔面板上：
```bash
kubectl annotate ingress <你的存量Ingress名称> -n <命名空间> kube-bt-sync.io/baota-sync="true"
```

---

## ⚠️ 常见问题避坑指南 (FAQ)

### Q1: 页面访问报 `ERR_TOO_MANY_REDIRECTS` (308 重定向死循环)？
这是“云边协同架构”中最容易踩的坑。当外网宝塔 Nginx 卸载了 HTTPS 证书，用纯 HTTP 将请求转发给家庭内网的 K8s Ingress 时，由于内网 Ingress 也配置了 TLS，K8s 会默认将 HTTP 请求强制重定向回 HTTPS，导致死循环。

**解决方案：**
Kube-BT-Sync 控制台生成的 Ingress 已默认添加防重定向注解。对于手工编写的 Ingress，请务必加上：
```yaml
annotations:
  nginx.ingress.kubernetes.io/ssl-redirect: "false"
```

### Q2: WebSocket 服务 (如终端、实时日志) 无法连接？
宝塔面板默认的反向代理配置可能在转发链路中丢失 `Upgrade` 头或错误处理 `Connection` 变量，导致 WebSocket 降级失败。

**标准外部 Nginx 配置文件参考（针对反代节点）：**
```nginx
location ^~ / {
    proxy_pass http://<您的DDNS域名>:<映射端口>;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header REMOTE-HOST $remote_addr;
    
    # 关键：欺骗内部 K8s，告知已在外部承载 HTTPS
    proxy_set_header X-Forwarded-Proto $scheme;

    # 关键：硬编码维持 WebSocket 长连接
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

## ⚙️ 环境变量配置说明

| 变量名 | 必填 | 说明 | 示例值 |
| :--- | :---: | :--- | :--- |
| `AUTH_USER` | 是 | Web 控制台的 Basic Auth 登录账号 | `admin` |
| `AUTH_PASSWORD` | 是 | Web 控制台的登录密码 | `i4t123456` |
| `BAOTA_URL` | 是 | 宝塔面板 API 接口地址 (带协议和端口) | `http://110.x.x.x:8888` |
| `BAOTA_API_KEY` | 是 | 宝塔面板生成的 API 密钥 | `faEZ9s7Z5J6cIFv...` |
| `DDNS_HOST` | 是 | 家庭宽带绑定的动态域名 | `home.i4t.com` |
| `DEFAULT_PORT`| 是 | 映射到宝塔的反代默认接收端口 | `38333` |

---

## 📄 协议

本项目基于 [MIT License](LICENSE) 协议开源。

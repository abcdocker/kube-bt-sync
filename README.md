# 🚀 kube-bt-sync (K8s 边缘网关同步中心)

![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=for-the-badge&logo=go)
![Kubernetes](https://img.shields.io/badge/Kubernetes-Compatible-326ce5?style=for-the-badge&logo=kubernetes)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**kube-bt-sync** 是一款专为 HomeLab 玩家和自建 Kubernetes 集群打造的自动化边缘网关同步工具。

它通过监听 K8s 集群中的 Ingress 资源，自动将路由配置同步至云端具备公网 IP 的宝塔面板（Nginx），从而**优雅、无感地解决家庭宽带 80/443 端口被运营商封禁的痛点**。让你彻底告别带端口号的丑陋 URL，实现纯正的公网 Web 访问体验！

---

## 💡 为什么需要它？ (痛点分析)

在国内搭建 HomeLab K8s 集群，通常面临以下困境：
1. **宽带端口封禁**：家庭宽带的公网 IP 必定封禁 `80` 和 `443` 端口，外部访问必须携带尾巴（如 `http://app.i4t.com:38333`）。
2. **割裂的配置体验**：为了去掉端口号，通常需要买一台轻量云服务器做反向代理。但每次在 K8s 里部署新服务，都要**手动去云服务器面板配置一次反代**，极其繁琐，违背了云原生“基础设施即代码 (IaC)”的理念。

**kube-bt-sync 完美解决了这个问题！** 你只需要在 K8s 中像往常一样创建 Ingress，只需加上一个专属 Annotation，剩下的跨网反代配置、域名绑定，全部由它自动完成！

## 🏗️ 架构设计

```mermaid
graph TD
    User((互联网用户)) -->|访问 [https://app.i4t.com](https://app.i4t.com) \n 标准 443 端口| Baota[云服务器 \n 宝塔 Nginx (自动解密 SSL)]
    
    subgraph "公网环境"
        Baota -->|自动配置的的反向代理 \n 携带真实 Host 头| DDNS[家庭 DDNS 域名 \n 例如: home.i4t.com:38333]
    end
    
    subgraph "HomeLab 局域网"
        DDNS -->|端口映射 38333| Router[家用路由器]
        Router -->|转发至集群入口| Ingress[Ingress-Nginx Controller \n (NodePort: 38333)]
        Ingress -->|根据 Host 自动路由| Service[业务 Pod]
    end

    Watcher((kube-bt-sync \n Controller)) -.->|1. 监听带有特定 Annotation 的 Ingress| Ingress
    Watcher -.->|2. 调用 API 自动创建站点与反代| Baota
```

## ✨ 核心特性

* 🤖 **全自动化同步**：基于 K8s Informer 机制监听 Ingress，秒级同步至宝塔面板。
* 🌐 **智能 Host 透传**：自动配置 Nginx 反向代理参数，精准透传 `$host` 和 `$remote_addr`，确保 K8s Ingress 路由匹配 100% 准确。
* 🖥️ **内置高颜值 Web UI**：集成了 Vue 3 + Element Plus 的可视化控制台，支持大盘状态总览。
* 🛠️ **表单 / YAML 双模驱动**：Web 界面不仅支持新手友好的“填表模式”，还集成了极客专属的“YAML 实时编辑模式”。
* 🪶 **极致轻量**：Go 语言编写，纯二进制文件不到 20MB，极低 CPU/内存占用。

---

## 🚀 快速开始

### 1. 准备工作
* 一台安装了 **宝塔面板** 的云服务器（拥有固定公网 IP 和 80/443 端口权限）。
* 并在宝塔面板的 **面板设置 -> API 接口** 中开启 API，记录下 `API 密钥`，并将你的 K8s 集群出口 IP（或 `0.0.0.0`）加入白名单。
* 一套能够正常运行的 Kubernetes 集群。

### 2. K8s 一键部署

修改项目中 `deploy/deploy.yaml` 的环境变量（`env` 部分）：

```yaml
        env:
        - name: BAOTA_URL
          value: "http://你的云服务器IP:宝塔面板端口"
        - name: BAOTA_API_KEY
          value: "你的宝塔API_KEY"
        - name: DDNS_HOST
          value: "home.i4t.com" # 你家庭宽带的动态域名
        - name: DEFAULT_PORT
          value: "38333" # 路由器映射给 K8s Ingress 的入口端口
```

执行部署：
```bash
kubectl apply -f deploy/deploy.yaml
```

### 3. 访问控制台
部署成功后，通过浏览器访问 K8s 集群任意节点的 NodePort (默认 `32080`) 即可进入可视化仪表盘：
`http://<k8s-node-ip>:32080`

---

## 📖 使用指南

### 方式一：通过 Web UI 发布服务 (推荐)
打开 `kube-bt-sync` 控制台，点击 **“+ 暴露新服务”**，填写业务域名和后端 Service 名称，点击下发即可！引擎将在后台自动完成 K8s Ingress 的创建和云端宝塔反向代理的配置。

### 方式二：云原生声明式发布 (YAML)
你可以完全忽略 Web UI，继续使用 GitOps 或纯 YAML 管理你的基础设施。只需在标准的 Ingress 配置中加入专属注解：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    kubernetes.io/ingress.class: "nginx"
    # 【核心】打上此标签，控制器才会将其同步至宝塔
    [i4t.com/baota-sync](https://i4t.com/baota-sync): "true"         
    # 【可选】覆盖全局默认的 38333 端口，走自定义通道
    [i4t.com/ddns-port](https://i4t.com/ddns-port): "48888"         
spec:
  rules:
  - host: app.i4t.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app-svc
            port:
              number: 80
```
`kube-bt-sync` 会自动捕获到此 YAML 的应用，并将 `app.i4t.com` 同步配置到远端云服务器！

---

## ⚙️ 环境变量参考

| 变量名 | 必填 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `BAOTA_URL` | 是 | `http://127.0.0.1:8888` | 宝塔面板的完整访问地址 |
| `BAOTA_API_KEY` | 是 | 无 | 宝塔面板 API 接口密钥 |
| `DDNS_HOST` | 是 | `home.i4t.com` | 家庭局域网对外暴露的 DDNS 域名 |
| `DEFAULT_PORT` | 否 | `38333` | 路由器向 K8s Ingress 映射的默认公网端口 |
| `SYNC_INTERVAL_SEC` | 否 | `30` | 引擎自动轮询对比的时间间隔（秒） |

---

## 🤝 贡献与支持
欢迎提交 Pull Request 或发起 Issue！如果你觉得这个工具让你的 HomeLab 体验变得更好，请给我一个 ⭐ Star！

## 📄 License
MIT License. 自由折腾，探索无限！

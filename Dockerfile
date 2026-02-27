# 第一阶段：编译环境 (注意末尾的 AS builder)
FROM docker.xuanyuan.run/library/golang:1.25.6 AS builder
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOPROXY=https://goproxy.cn,direct
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -ldflags="-s -w" -o kube-bt-sync main.go

# 第二阶段：运行环境 (建议 alpine 也加上你的镜像源代理)
FROM docker.xuanyuan.run/library/alpine:latest
# 替换 alpine 的 apk 源为国内阿里云源，加速构建
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk --no-cache add ca-certificates tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=builder /build/kube-bt-sync /app/
COPY templates /app/templates/
CMD ["/app/kube-bt-sync"]

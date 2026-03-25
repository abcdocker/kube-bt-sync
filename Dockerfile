<<<<<<< HEAD
# 前端构建（产物供 Go embed / 静态目录加载）
FROM node:20-alpine AS frontend
WORKDIR /app
COPY react/package.json react/package-lock.json ./
RUN npm ci
COPY react/ ./
RUN npm run build

FROM golang:alpine AS builder
ENV CGO_ENABLED=0 GOOS=linux GOTOOLCHAIN=auto
ARG TARGETARCH=amd64
ARG TARGETOS=linux
=======
FROM docker.xuanyuan.run/library/golang:1.25.6 AS builder
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOPROXY=https://goproxy.cn,direct
>>>>>>> d16bf5922f8c5e8a4fe187f8af50fc5f2eaa7661
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
<<<<<<< HEAD
COPY --from=frontend /app/dist ./react/dist
RUN GOARCH=${TARGETARCH} GOOS=${TARGETOS} go build -ldflags="-s -w" -o kube-bt-sync .

FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata wget \
    && addgroup -g 65532 -S appgroup && adduser -u 65532 -S appuser -G appgroup
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=builder /build/kube-bt-sync /app/kube-bt-sync
COPY --from=builder /build/react/dist /app/react/dist
COPY templates /app/templates/
RUN chown -R appuser:appgroup /app
USER appuser:appgroup
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/api/health || exit 1
=======
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
>>>>>>> d16bf5922f8c5e8a4fe187f8af50fc5f2eaa7661
CMD ["/app/kube-bt-sync"]

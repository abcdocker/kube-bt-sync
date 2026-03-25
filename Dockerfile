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
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
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
CMD ["/app/kube-bt-sync"]

#!/usr/bin/env bash
# kube-bt-sync：本地构建 / Harbor 推送 / 本地运行容器。完整说明见：./run.sh -h
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
kube-bt-sync — 构建与发布脚本（中文说明）

用法
  ./run                  与 ./run.sh 相同
  ./run.sh               无参数：默认流程（见下）
  ./run.sh -h            显示本说明
  ./run.sh --help        同上
  ./run.sh help          同上
  ./run.sh local         本机原生架构快速构建并启动容器（不经过 Harbor 流程）
  ./run.sh dev           与 local 相同

默认流程（无参数）
  1. 使用 docker buildx 构建 linux/amd64 镜像（与 Harbor / x86 服务器一致，可在 Apple 芯片 Mac 上交叉构建）。
  2. 将镜像加载到本机 Docker（--load）。
  3. 打包完成后，在终端交互询问下一步（非交互环境默认只推送 Harbor）：
       1 — 推送到 Harbor 镜像仓库（集群镜像请自行 kubectl set image / 改 YAML）
       2 — 仅用当前镜像在本地启动容器（Apple 芯片上为 amd64 仿真运行，略慢但与生产一致）
       3 — 先推送 Harbor，再本地启动容器

镜像 Tag（自动生成）
  格式：YYYYMMDD-HHMMSS-<git 短提交>
  若需固定 Tag，可设置环境变量 KUBEBT_IMAGE_TAG。

环境变量（可选）
  KUBEBT_HARBOR_IMAGE       镜像仓库路径（不含 tag）
                            默认：your-registry/kube-bt-sync
  KUBEBT_IMAGE_TAG          覆盖自动生成的镜像 Tag
  KUBEBT_LOCAL_IMAGE        local 模式下的本地镜像名（默认 kube-bt-sync:local）
  KUBEBT_LOCAL_CONTAINER    容器名（默认 kube-bt-sync-dev）
  KUBEBT_LOCAL_BIND_PORT    宿主机端口（默认 18081，占用时可能改用 18082）

前置条件
  · 已安装并运行 Docker（含 buildx）。
  · 选择推送 Harbor 前，请先执行：docker login <Harbor 域名>
  · 若存在 .env.test，本地运行时会作为 --env-file 注入容器。

数据目录
  项目下 data/ 会挂载到容器 /app/data。

示例
  ./run -h
  ./run
  ./run local
  KUBEBT_IMAGE_TAG=v1.0.0-test ./run.sh
EOF
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo ">>> 错误: 未找到 docker"
    exit 1
  fi
}

# 使用已打好的镜像启动本地容器（与 Harbor 相同 amd64 层，Mac 上由 Docker 仿真运行）
run_container_from_image() {
  local IMAGE="$1"
  local CONTAINER="${KUBEBT_LOCAL_CONTAINER:-kube-bt-sync-dev}"
  local HOST_PORT="${KUBEBT_LOCAL_BIND_PORT:-18081}"

  if [[ "${HOST_PORT}" == "18081" ]]; then
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:18081 -sTCP:LISTEN >/dev/null 2>&1; then
      echo ">>> 警告: 18081 已占用，改用 18082（或设 KUBEBT_LOCAL_BIND_PORT）"
      HOST_PORT=18082
    fi
  fi

  mkdir -p "${ROOT}/data"

  echo ">>> 移除旧容器 ${CONTAINER}（若存在）…"
  docker rm -f "${CONTAINER}" 2>/dev/null || true

  local run_args=(
    -d
    --name "${CONTAINER}"
    --restart unless-stopped
    -p "${HOST_PORT}:8080"
    -e TZ=Asia/Shanghai
    -v "${ROOT}/data:/app/data"
  )

  if [[ -f "${ROOT}/.env.test" ]]; then
    echo ">>> 注入: ${ROOT}/.env.test"
    run_args+=(--env-file "${ROOT}/.env.test")
  fi

  run_args+=(-e "DASHBOARD_HTTP_ADDR=:8080")

  echo ">>> 启动容器 ${CONTAINER}（镜像 ${IMAGE}）…"
  docker run "${run_args[@]}" "${IMAGE}"

  echo ">>> 本地访问: http://127.0.0.1:${HOST_PORT}/"
}

# 默认：amd64 打包 → 交互选择推送 / 本地 / 二者
main_pack_then_choose() {
  require_docker

  local REGISTRY="${KUBEBT_HARBOR_IMAGE:-your-registry/kube-bt-sync}"
  local SHORT_SHA
  SHORT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  local TAG="${KUBEBT_IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)-${SHORT_SHA}}"
  local IMAGE_REF="${REGISTRY}:${TAG}"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ">>> 打包目标: linux/amd64（与 Harbor / x86 一致）"
  echo ">>> 镜像:     ${IMAGE_REF}"
  echo ">>> BUILD_VERSION=${TAG}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  docker buildx build \
    --platform linux/amd64 \
    -t "${IMAGE_REF}" \
    --build-arg BUILD_VERSION="${TAG}" \
    --load \
    -f "${ROOT}/Dockerfile" \
    "${ROOT}"

  echo ""
  echo ">>> 打包完成，镜像已在本地: ${IMAGE_REF}"
  echo ""

  local choice=""
  if [[ -t 0 ]]; then
    echo "请选择下一步："
    echo "  1) 推送到镜像仓库（集群镜像请自行替换）"
    echo "  2) 仅本地 Docker 运行测试（Apple 芯片为 x86_64 仿真，略慢但与线上一致）"
    echo "  3) 先推送 Harbor，再本地运行容器"
    echo ""
    while true; do
      read -r -p "请输入 1 / 2 / 3: " choice || true
      case "${choice}" in
        1|2|3) break ;;
        "")
          echo ">>> 请输入 1、2 或 3"
          ;;
        *)
          echo ">>> 无效输入: ${choice}"
          ;;
      esac
    done
  else
    echo ">>> 当前非交互终端，默认: 1) 推送 Harbor"
    choice=1
  fi

  case "${choice}" in
    1)
      echo ""
      echo ">>> 推送到 Harbor（请已执行 docker login $(echo "${REGISTRY}" | cut -d/ -f1)）"
      docker push "${IMAGE_REF}"
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ">>> 已推送，镜像地址:"
      echo "    ${IMAGE_REF}"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      ;;
    2)
      echo ""
      run_container_from_image "${IMAGE_REF}"
      ;;
    3)
      echo ""
      echo ">>> 推送到 Harbor…"
      docker push "${IMAGE_REF}"
      echo ">>> 推送完成: ${IMAGE_REF}"
      echo ""
      run_container_from_image "${IMAGE_REF}"
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ">>> 镜像地址: ${IMAGE_REF}"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      ;;
  esac
}

# 本机原生架构，快速本地开发
run_local_native() {
  require_docker

  local IMAGE="${KUBEBT_LOCAL_IMAGE:-kube-bt-sync:local}"
  local CONTAINER="${KUBEBT_LOCAL_CONTAINER:-kube-bt-sync-dev}"
  local HOST_PORT="${KUBEBT_LOCAL_BIND_PORT:-18081}"

  if [[ "${HOST_PORT}" == "18081" ]]; then
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:18081 -sTCP:LISTEN >/dev/null 2>&1; then
      echo ">>> 警告: 18081 已占用，改用 18082"
      HOST_PORT=18082
    fi
  fi

  mkdir -p "${ROOT}/data"

  echo ">>> 本机构建（原生架构，适合 Mac mini 日常开发）…"
  docker build -t "${IMAGE}" -f "${ROOT}/Dockerfile" "${ROOT}"

  docker rm -f "${CONTAINER}" 2>/dev/null || true

  local run_args=(
    -d
    --name "${CONTAINER}"
    --restart unless-stopped
    -p "${HOST_PORT}:8080"
    -e TZ=Asia/Shanghai
    -v "${ROOT}/data:/app/data"
  )

  if [[ -f "${ROOT}/.env.test" ]]; then
    run_args+=(--env-file "${ROOT}/.env.test")
  fi

  run_args+=(-e "DASHBOARD_HTTP_ADDR=:8080")

  docker run "${run_args[@]}" "${IMAGE}"

  echo ">>> 已启动 ${CONTAINER}  http://127.0.0.1:${HOST_PORT}/"
}

case "${1-}" in
  "")
    main_pack_then_choose
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  local|dev)
    run_local_native
    ;;
  *)
    echo ">>> 未知命令: $1"
    usage
    exit 1
    ;;
esac

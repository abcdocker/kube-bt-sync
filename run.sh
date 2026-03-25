#!/usr/bin/env bash
# 本地一键：构建前端 + 从项目根启动（需已配置 BAOTA_* 等环境变量）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if [[ ! -f react/dist/index.html ]]; then
  echo ">>> 构建前端 react/dist …"
  (cd react && npm ci && npm run build)
fi
if [[ -f .env.test ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.test
  set +a
fi
# 未指定时：若 8080 已被占用则改用 18080（避免旧进程占坑导致新进程起不来、浏览器仍打到旧服务 404）
LISTEN="${DASHBOARD_HTTP_ADDR:-:8080}"
if [[ "${LISTEN}" == ":8080" ]] || [[ "${LISTEN}" == "8080" ]]; then
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
    echo ">>> 警告: 端口 8080 已被占用，改用 DASHBOARD_HTTP_ADDR=:18080"
    echo ">>> 若需释放 8080：lsof -nP -iTCP:8080 -sTCP:LISTEN   然后 kill <PID>"
    export DASHBOARD_HTTP_ADDR=:18080
  fi
fi
LISTEN="${DASHBOARD_HTTP_ADDR:-:8080}"
PORT="${LISTEN#:}"
echo ">>> 启动 Dashboard: http://127.0.0.1:${PORT}/ （DASHBOARD_HTTP_ADDR=${LISTEN}）"
if [[ "${PORT}" != "8080" ]]; then
  echo ">>> 若使用 npm run dev（Vite）：请在 react/.env 设置 VITE_DEV_API_TARGET=http://127.0.0.1:${PORT}"
  echo ">>> 否则 /api 会默认代理到 8080，可能打到旧进程导致新接口 404"
fi
exec go run .

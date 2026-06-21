#!/bin/bash
# BunnyOS 一键启动 (Linux / macOS)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo "[BunnyOS] 未检测到 Node.js，请先安装 v18+：https://nodejs.org/"
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "[BunnyOS] 首次启动，安装依赖..."
    npm install
fi

echo
echo "====================================================="
echo "  BunnyOS"
echo "  http://localhost:3000/index.html"
echo "  Ctrl+C 停止服务"
echo "====================================================="
echo

# 后台延迟 2 秒打开浏览器（macOS 用 open，Linux 用 xdg-open）
(sleep 2 && (open http://localhost:3000/index.html 2>/dev/null || xdg-open http://localhost:3000/index.html 2>/dev/null || true)) &

exec node server.js

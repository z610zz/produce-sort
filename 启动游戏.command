#!/bin/bash
# 双击这个文件即可开始游戏。
# 浏览器的 ES Module 不允许从 file:// 加载，所以必须过一个本地服务器。

cd "$(dirname "$0")" || exit 1

PORT=8765
# 端口被占用时自动往后找一个能用的
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8800 ]; then
    echo "找不到可用端口（8765-8800 都被占用）"
    read -r -p "按回车关闭" _
    exit 1
  fi
done

URL="http://127.0.0.1:$PORT/index.html"
echo "启动中：$URL"
echo "关闭游戏：回到这个窗口按 Control-C，或直接关掉窗口。"
echo

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!
# 服务器随窗口一起退出，不留后台进程
trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM

sleep 1
open "$URL"

wait $SERVER_PID

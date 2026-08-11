#!/bin/bash
# 雙擊這個檔案就會開啟「LiteJam 燈譜」
#
# 一定要透過這個伺服器開，原因有兩個：
#   1. Web Bluetooth 只在 https 或 localhost 下能用，直接雙擊 index.html（file://）連不上琴
#   2. 「抓和弦」需要本機後端（YouTube 下載與 numpy 分析）

cd "$(dirname "$0")" || exit 1

echo "LiteJam 燈譜 啟動中…"

# 檢查必要工具
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "⚠️  找不到 ffmpeg，抓和弦功能會不能用。安裝：brew install ffmpeg"
fi
if ! python3 -c "import numpy" >/dev/null 2>&1; then
  echo "⚠️  找不到 numpy，抓和弦功能會不能用。安裝：pip3 install --user numpy"
fi

PORT=8123
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

PORT=$PORT python3 server.py &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

sleep 1.5
URL="http://localhost:$PORT/"

if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -a "Microsoft Edge" "$URL"
else
  echo "⚠️  找不到 Chrome 或 Edge。Safari 不支援 Web Bluetooth，燈會連不上。"
  open "$URL"
fi

wait $SERVER_PID

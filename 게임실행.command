#!/bin/bash
# AI RUN — Safari에서 안전하게 실행 (로컬 서버)
cd "$(dirname "$0")"

PORT=8765

if lsof -i :$PORT >/dev/null 2>&1; then
  echo "포트 $PORT 가 이미 사용 중입니다. 기존 서버로 연결합니다."
else
  echo "로컬 서버 시작 중... (포트 $PORT)"
  python3 -m http.server "$PORT" &
  SERVER_PID=$!
  sleep 1
fi

echo "Safari에서 게임을 엽니다..."
open -a Safari "http://127.0.0.1:$PORT/"

echo ""
echo "✅ Safari에서 http://127.0.0.1:$PORT/ 가 열렸습니다."
echo "   이 창을 닫으면 서버가 종료될 수 있습니다."
echo "   (게임 중에는 이 터미널 창을 닫지 마세요)"
echo ""

if [ -n "$SERVER_PID" ]; then
  wait $SERVER_PID
fi

#!/bin/sh
set -e
NEXT_PORT="${TG_NEXT_PORT:-43126}"
FRONT_PORT="${TG_FRONT_PORT:-43127}"

# 先起前置：未就绪时也立刻 allow，避免洪峰打进半开连接
TG_NEXT_PORT="$NEXT_PORT" TG_FRONT_PORT="$FRONT_PORT" node /app/server/check-front.mjs &
FRONT_PID=$!

# Next 仅本机，承接二次监测与其它页面
npx next start -H 127.0.0.1 -p "$NEXT_PORT" &
NEXT_PID=$!

term() {
  kill -TERM "$FRONT_PID" "$NEXT_PID" 2>/dev/null || true
  wait "$FRONT_PID" "$NEXT_PID" 2>/dev/null || true
  exit 0
}
trap term TERM INT

while kill -0 "$NEXT_PID" 2>/dev/null && kill -0 "$FRONT_PID" 2>/dev/null; do
  sleep 2
done
echo "child exited; shutting down" >&2
term

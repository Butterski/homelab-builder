#!/bin/sh
set -eu

export SERVER_PORT="${SERVER_PORT:-8080}"
export PORT="${PORT:-8081}"
export IPAM_URL="${IPAM_URL:-http://127.0.0.1:8081}"

/app/hlbipam &
IPAM_PID=$!

/app/backend &
BACKEND_PID=$!

nginx -g "daemon off;" &
NGINX_PID=$!

shutdown() {
    kill -TERM "$NGINX_PID" "$BACKEND_PID" "$IPAM_PID" 2>/dev/null || true
    wait "$NGINX_PID" "$BACKEND_PID" "$IPAM_PID" 2>/dev/null || true
}

trap shutdown INT TERM

while true; do
    for pid in "$IPAM_PID" "$BACKEND_PID" "$NGINX_PID"; do
        if ! kill -0 "$pid" 2>/dev/null; then
            shutdown
            exit 1
        fi
    done
    sleep 2
done

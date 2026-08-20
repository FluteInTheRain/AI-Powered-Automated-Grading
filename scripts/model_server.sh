#!/usr/bin/env bash
# Manage the local llama-server (see configs/model.yaml for the model/port it
# should match). Usage:
#   scripts/model_server.sh start [--parallel N]
#   scripts/model_server.sh stop
#   scripts/model_server.sh status
set -euo pipefail

MODEL="Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M"
PORT=8080
LOG_FILE=/tmp/llama-server.log
PID_FILE=/tmp/llama-server.pid

cmd="${1:-status}"

status() {
  if curl -s -o /dev/null "http://localhost:${PORT}/health"; then
    echo "RUNNING — http://localhost:${PORT} (health OK)"
    if [ -f "$PID_FILE" ]; then
      echo "pid: $(cat "$PID_FILE")"
    fi
  else
    echo "STOPPED — nothing answering on port ${PORT}"
    exit 1
  fi
}

start() {
  shift || true
  if curl -s -o /dev/null "http://localhost:${PORT}/health"; then
    echo "Already running on port ${PORT}."
    exit 0
  fi
  nohup llama-server -hf "$MODEL" --port "$PORT" --seed 0 -c 16384 "$@" \
    > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "Starting (pid $(cat "$PID_FILE")), logging to ${LOG_FILE}..."
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "http://localhost:${PORT}/health"; then
      echo "READY — http://localhost:${PORT}"
      exit 0
    fi
    sleep 2
  done
  echo "Still not ready after 60s — check ${LOG_FILE}"
  exit 1
}

stop() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null && echo "Stopped (pid $(cat "$PID_FILE"))." || echo "Process already gone."
    rm -f "$PID_FILE"
  else
    echo "No pid file — if a server is running, find it with: lsof -i :${PORT}"
  fi
}

case "$cmd" in
  start) start "$@" ;;
  stop) stop ;;
  status) status ;;
  *) echo "Usage: $0 {start|stop|status}"; exit 1 ;;
esac

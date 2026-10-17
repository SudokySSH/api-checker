#!/usr/bin/env sh
# api-checker.sh — проверка доступности API через curl
#
# usage:
#   ./checker.sh https://api.example.com/health [url ...]
#   ./checker.sh -f endpoints.txt          # один URL на строку, # — комментарий
#   INTERVAL=60 REPEAT=5 ./checker.sh -f endpoints.txt   # повторять
#
# env:
#   TIMEOUT  — таймаут запроса, сек (по умолчанию 10)
#   INTERVAL — пауза между циклами, сек (если задана — повторять бесконечно)
#   REPEAT   — сколько циклов (по умолчанию бесконечно при заданном INTERVAL)

TIMEOUT="${TIMEOUT:-10}"

if [ "$1" = "-f" ]; then
  [ -z "$2" ] && { echo "usage: $0 -f <file>" >&2; exit 2; }
  FILE="$2"
else
  [ $# -eq 0 ] && { echo "usage: $0 <url...> | $0 -f <file>" >&2; exit 2; }
  FILE=""
fi

# цвета, если терминал умеет
if [ -t 1 ]; then
  G=$(printf '\033[32m'); Y=$(printf '\033[33m'); R=$(printf '\033[31m')
  B=$(printf '\033[34m'); D=$(printf '\033[2m'); N=$(printf '\033[0m')
else
  G=""; Y=""; R=""; B=""; D=""; N=""
fi

check_one() {
  url="$1"
  # -L не следуем редиректам намеренно: 3xx считается отдельным статусом
  result=$(curl -sS -o /dev/null -m "$TIMEOUT" \
    -w '%{http_code} %{time_total}' "$url" 2>&1)
  rc=$?
  ts=$(date '+%H:%M:%S')

  if [ $rc -ne 0 ]; then
    echo "$D$ts$N $R✗ DOWN$N  $url  ($result)"
    return 1
  fi

  code=$(echo "$result" | cut -d' ' -f1)
  ms=$(echo "$result" | cut -d' ' -f2)
  case "$code" in
    2*) c="$G" ;;  # ok
    3*) c="$B" ;;  # redirect
    4*) c="$Y" ;;  # client error
    *)  c="$R" ;;  # 5xx и прочее
  esac
  echo "$D$ts$N ${c}✓ $code$N  $url  ${ms}s"
  [ "$code" -lt 400 ]
}

run_cycle() {
  fails=0
  if [ -n "$FILE" ]; then
    while IFS= read -r line; do
      case "$line" in ''|\#*) continue ;; esac
      check_one "$line" || fails=$((fails + 1))
    done < "$FILE"
  else
    for url in $URLS; do
      check_one "$url" || fails=$((fails + 1))
    done
  fi
  return $fails
}

URLS="$*"
i=1
while :; do
  [ -n "$INTERVAL" ] && [ "$REPEAT" ] && [ "$i" -gt "$REPEAT" ] && break
  run_cycle
  status=$?
  if [ -n "$INTERVAL" ]; then
    [ "$REPEAT" ] && [ "$i" -ge "$REPEAT" ] && exit $status
    sleep "$INTERVAL"
    i=$((i + 1))
  else
    exit $status
  fi
done

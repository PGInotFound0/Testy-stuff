#!/bin/sh
# Runs via nginx's /docker-entrypoint.d/ before nginx starts.
# Lets Coolify/portainer users set the homeserver at RUNTIME instead of as a
# Docker build-arg: if SECURE_BOARD_HOMESERVER_URL is a real URL, rewrite
# /usr/share/nginx/html/config.json and default MATRIX_CONNECT_SRC to it.
set -eu

CONFIG_FILE="/usr/share/nginx/html/config.json"
PLACEHOLDER="https://replace-me.invalid"
URL="${SECURE_BOARD_HOMESERVER_URL:-$PLACEHOLDER}"

case "$URL" in
  https://*)
    if [ "$URL" != "$PLACEHOLDER" ]; then
      # Minimal JSON escaping for URLs (no quotes/backslashes expected).
      printf '{\n  "homeserverUrl": "%s"\n}\n' "$URL" > "$CONFIG_FILE"
    fi
    ;;
  *) echo "secure-board: keeping built config.json (SECURE_BOARD_HOMESERVER_URL not a https URL)" >&2 ;;
esac

if [ "${MATRIX_CONNECT_SRC:-$PLACEHOLDER}" = "$PLACEHOLDER" ]; then
  case "$URL" in
    https://*|http://localhost*|http://127.0.0.1*)
      if [ "$URL" != "$PLACEHOLDER" ]; then
        export MATRIX_CONNECT_SRC="$URL"
      fi
      ;;
  esac
fi
: "${MATRIX_CONNECT_SRC:=$PLACEHOLDER}"
export MATRIX_CONNECT_SRC

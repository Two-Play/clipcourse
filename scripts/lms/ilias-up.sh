#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Starts a local ILIAS 10 for testing exported SCORM packages (Podman or
# Docker). There is no official ILIAS image; this uses the community image
# srsolutions/ilias (https://github.com/srsolutionsag/docker-ilias).
#
#   scripts/lms/ilias-up.sh          # start (first run installs ILIAS)
#   scripts/lms/ilias-up.sh down     # stop and remove containers
#
# ILIAS runs on http://localhost:8082 (bound to 127.0.0.1 only). Test
# credentials are generated on first run and stored in .lms/ilias.env
# (git-ignored).
set -euo pipefail

IMAGE="${ILIAS_IMAGE:-docker.io/srsolutions/ilias:10-php8.3-apache}"
PORT="${ILIAS_PORT:-8082}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CREDS="$ROOT/.lms/ilias.env"
RUNTIME="$(command -v podman || command -v docker)"
NET=cc-ilias-net

if [[ "${1:-}" == "down" ]]; then
  "$RUNTIME" rm -f cc-ilias cc-ilias-db >/dev/null 2>&1 || true
  echo "ILIAS containers removed."
  exit 0
fi

mkdir -p "$ROOT/.lms"
if [[ ! -f "$CREDS" ]]; then
  (
    umask 077
    {
      echo "ILIAS_URL=http://localhost:$PORT"
      echo "ILIAS_USER=root"
      echo "ILIAS_DB_PASS=$(openssl rand -hex 16)"
      echo "ILIAS_PASS=Cc-$(openssl rand -hex 8)-1!"
    } >"$CREDS"
  )
fi
# shellcheck disable=SC1090
source "$CREDS"

"$RUNTIME" network exists "$NET" 2>/dev/null || "$RUNTIME" network create "$NET" >/dev/null

if ! "$RUNTIME" container exists cc-ilias-db 2>/dev/null; then
  # utf8 (not utf8mb4): the ILIAS database dump exceeds InnoDB's row size otherwise.
  "$RUNTIME" run -d --name cc-ilias-db --network "$NET" \
    -e MARIADB_ROOT_PASSWORD="$ILIAS_DB_PASS" -e MARIADB_DATABASE=ilias \
    -e MARIADB_USER=ilias -e MARIADB_PASSWORD="$ILIAS_DB_PASS" \
    docker.io/library/mariadb:11.4 --character-set-server=utf8 --collation-server=utf8_general_ci >/dev/null
  for _ in $(seq 1 30); do
    "$RUNTIME" exec cc-ilias-db mariadb -uilias -p"$ILIAS_DB_PASS" -e 'select 1' ilias >/dev/null 2>&1 && break
    sleep 2
  done
fi

if ! "$RUNTIME" container exists cc-ilias 2>/dev/null; then
  "$RUNTIME" run -d --name cc-ilias --network "$NET" -p "127.0.0.1:$PORT:80" \
    -e ILIAS_AUTO_SETUP=1 -e ILIAS_DB_HOST=cc-ilias-db -e ILIAS_DB_USER=ilias \
    -e ILIAS_DB_PASSWORD="$ILIAS_DB_PASS" -e ILIAS_DB_NAME=ilias \
    -e ILIAS_HTTP_PATH="http://localhost:$PORT" -e ILIAS_ROOT_PASSWORD="$ILIAS_PASS" \
    "$IMAGE" >/dev/null
fi

echo "Waiting for ILIAS setup (a few minutes on first start)…"
for _ in $(seq 1 100); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/login.php" || true)"
  [[ "$code" == "200" || "$code" == "302" ]] && break
  if [[ "$("$RUNTIME" inspect -f '{{.State.Running}}' cc-ilias)" == "false" ]]; then
    echo "ILIAS stopped during setup; see: $RUNTIME logs cc-ilias" >&2
    exit 1
  fi
  sleep 6
done
# Learning progress must be on: without it ILIAS runs SCORM 1.2 modules in
# "no-credit" mode and silently drops every score and status the course sends.
"$RUNTIME" exec cc-ilias-db mariadb -uilias -p"$ILIAS_DB_PASS" ilias -e \
  "update settings set value='1' where module='common' and keyword='enable_tracking'"

echo "ILIAS is running on http://localhost:$PORT (credentials in .lms/ilias.env)."

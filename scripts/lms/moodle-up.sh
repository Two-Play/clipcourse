#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Starts a local Moodle for testing exported SCORM packages (Podman or
# Docker). Uses only official images (mariadb, moodlehq/moodle-php-apache)
# and the official Moodle release, verified by its SHA-256 checksum.
#
#   scripts/lms/moodle-up.sh          # start (first run installs Moodle)
#   scripts/lms/moodle-up.sh down     # stop and remove containers
#
# Moodle runs on http://localhost:8081 (bound to 127.0.0.1 only). Test
# credentials are generated on first run and stored in .lms/credentials.env
# (git-ignored). Run the tests with:
#
#   set -a; source .lms/credentials.env; set +a
#   pnpm --filter @clipcourse/editor test:lms
set -euo pipefail

MOODLE_VERSION="${MOODLE_VERSION:-5.3.1}"
MOODLE_BRANCH="${MOODLE_BRANCH:-stable503}"
PORT="${MOODLE_PORT:-8081}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/.lms/moodle"
CREDS="$ROOT/.lms/credentials.env"
RUNTIME="$(command -v podman || command -v docker)"
NET=cc-moodle-net

if [[ "${1:-}" == "down" ]]; then
  "$RUNTIME" rm -f cc-moodle cc-moodle-db >/dev/null 2>&1 || true
  echo "Moodle containers removed (data kept in $WORK)."
  exit 0
fi

mkdir -p "$WORK/moodledata"
chmod 777 "$WORK/moodledata"

if [[ ! -f "$CREDS" ]]; then
  (
  umask 077
  {
    echo "MOODLE_URL=http://localhost:$PORT"
    echo "MOODLE_USER=admin"
    echo "MOODLE_DB_PASS=$(openssl rand -hex 16)"
    echo "MOODLE_PASS=Cc-$(openssl rand -hex 8)-1!"
  } >"$CREDS"
  )
fi
# shellcheck disable=SC1090
source "$CREDS"

if [[ ! -d "$WORK/src/moodle" ]]; then
  tgz="$WORK/moodle-$MOODLE_VERSION.tgz"
  base="https://download.moodle.org/download.php/direct/$MOODLE_BRANCH/moodle-$MOODLE_VERSION.tgz"
  curl -fsSL -o "$tgz" "$base"
  expected="$(curl -fsSL "$base.sha256" | awk '{print $NF}')"
  actual="$(sha256sum "$tgz" | awk '{print $1}')"
  [[ "$expected" == "$actual" ]] || { echo "Checksum mismatch for $tgz" >&2; exit 1; }
  mkdir -p "$WORK/src"
  tar -xzf "$tgz" -C "$WORK/src"
fi

"$RUNTIME" network exists "$NET" 2>/dev/null || "$RUNTIME" network create "$NET" >/dev/null

if ! "$RUNTIME" container exists cc-moodle-db 2>/dev/null; then
  "$RUNTIME" run -d --name cc-moodle-db --network "$NET" \
    -e MARIADB_ROOT_PASSWORD="$MOODLE_DB_PASS" -e MARIADB_DATABASE=moodle \
    -e MARIADB_USER=moodle -e MARIADB_PASSWORD="$MOODLE_DB_PASS" \
    docker.io/library/mariadb:11.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
fi

if ! "$RUNTIME" container exists cc-moodle 2>/dev/null; then
  "$RUNTIME" run -d --name cc-moodle --network "$NET" -p "127.0.0.1:$PORT:80" \
    -e APACHE_DOCUMENT_ROOT=/var/www/html/public \
    -v "$WORK/src/moodle:/var/www/html:Z" -v "$WORK/moodledata:/var/www/moodledata:Z" \
    docker.io/moodlehq/moodle-php-apache:8.4 >/dev/null
fi

if [[ ! -f "$WORK/src/moodle/config.php" ]]; then
  echo "Installing Moodle $MOODLE_VERSION (takes a few minutes)…"
  for _ in $(seq 1 30); do
    "$RUNTIME" exec cc-moodle-db mariadb -umoodle -p"$MOODLE_DB_PASS" -e 'select 1' moodle >/dev/null 2>&1 && break
    sleep 2
  done
  "$RUNTIME" exec cc-moodle php /var/www/html/admin/cli/install.php --non-interactive --agree-license \
    --lang=en --wwwroot="http://localhost:$PORT" --dataroot=/var/www/moodledata \
    --dbtype=mariadb --dbhost=cc-moodle-db --dbname=moodle --dbuser=moodle --dbpass="$MOODLE_DB_PASS" \
    --fullname="Clipcourse test" --shortname=cctest --adminuser=admin --adminpass="$MOODLE_PASS" \
    --adminemail=admin@example.invalid --supportemail=admin@example.invalid >/dev/null
  "$RUNTIME" exec cc-moodle sh -c 'chmod 644 /var/www/html/config.php && chown -R www-data:www-data /var/www/moodledata'
fi

echo "Moodle is running on http://localhost:$PORT (credentials in .lms/credentials.env)."

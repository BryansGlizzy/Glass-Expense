#!/usr/bin/env bash
# Production updater: stop service -> zip backup -> git pull -> install/build -> start service -> publish OTA bundle.
# Run on the server as root:  /opt/webserver/glassexpense/scripts/update.sh
#
# Override defaults via the environment, e.g.  SERVICE=glassexpense BRANCH=main ./update.sh
set -Eeuo pipefail

# Defaults derive from where this script lives: <parent>/<app>/scripts/update.sh
# -> app = <parent>/<app>, backups = <parent>/backups (created on first run).
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_NAME="${APP_NAME:-$(basename "$APP_DIR")}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$APP_DIR")/backups}"
SERVICE="${SERVICE:-$APP_NAME}"
BRANCH="${BRANCH:-main}"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"   # newest N zips kept; 0 = keep everything
HEALTH_URL="${HEALTH_URL:-}"         # optional, e.g. http://127.0.0.1:3000/ ; checked after start
BUILD_OTA="${BUILD_OTA:-1}"          # 1 = publish the mobile OTA bundle after a healthy start; 0 = skip
OTA_NOTES="${OTA_NOTES:-}"           # release notes shown in the app's update dialog (default: "Release vX.Y.Z")

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (needs to stop/start $SERVICE)"
for cmd in git zip npm systemctl; do command -v "$cmd" >/dev/null || die "missing command: $cmd"; done
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout (run the one-time migration first)"
systemctl cat "$SERVICE" >/dev/null 2>&1 || die "systemd unit '$SERVICE' not found (set SERVICE=...)"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

# Refuse to start if tracked files were edited on the server: a pull could conflict mid-downtime.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no >&2
  die "tracked files have local changes; commit/stash them first"
fi

# Fetch before stopping anything, so a network/auth failure costs zero downtime.
log "Fetching origin/$BRANCH"
git fetch origin "$BRANCH"
PREV="$(git rev-parse HEAD)"
NEXT="$(git rev-parse "origin/$BRANCH")"
if [[ "$PREV" == "$NEXT" ]]; then
  log "Already up to date ($(git rev-parse --short HEAD)); nothing to do"
  exit 0
fi
log "Updating $(git rev-parse --short "$PREV") -> $(git rev-parse --short "$NEXT")"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP="$BACKUP_DIR/${APP_NAME}_${STAMP}.zip"
STOPPED=0

on_error() {
  local rc=$? line=$1
  trap - ERR
  printf '\033[1;31mUpdate failed (line %s, exit %s).\033[0m\n' "$line" "$rc" >&2
  if (( STOPPED )); then
    log "Rolling code back to $(git rev-parse --short "$PREV")"
    if git reset --hard "$PREV" && npm ci --no-audit --no-fund && npm run build; then
      systemctl start "$SERVICE" && log "Previous version restarted"
    else
      printf 'Rollback failed. Service is STOPPED. Restore from %s\n' "$BACKUP" >&2
    fi
  fi
  exit "$rc"
}
trap 'on_error $LINENO' ERR

log "Stopping $SERVICE"
systemctl stop "$SERVICE"
STOPPED=1

# Whole app directory incl. data/, .env, secrets/ and .git; node_modules is reproducible, so skipped.
log "Backing up to $BACKUP"
parent="$(dirname "$APP_DIR")"
(cd "$parent" && zip -rq -y "$BACKUP" "$(basename "$APP_DIR")" -x "$(basename "$APP_DIR")/node_modules/*")
zip -T -q "$BACKUP" >/dev/null || die "backup failed verification: $BACKUP"
log "Backup OK ($(du -h "$BACKUP" | cut -f1))"

log "Pulling"
git merge --ff-only "origin/$BRANCH"

log "Installing dependencies and building"
npm ci --no-audit --no-fund
npm run build

log "Starting $SERVICE"
systemctl start "$SERVICE"
STOPPED=0
trap - ERR

sleep 3
systemctl is-active --quiet "$SERVICE" || die "$SERVICE is not active after start; check: journalctl -u $SERVICE -n 50"
if [[ -n "$HEALTH_URL" ]]; then
  curl -fsS -o /dev/null --max-time 10 "$HEALTH_URL" || die "health check failed: $HEALTH_URL"
fi

# Publish the mobile OTA bundle only once the new release is confirmed healthy. It zips the dist/ built above
# (no second vite build) into <DATA_DIR>/updates and is skipped when the web bundle did not change. A failure here
# is reported but does not undo the release: the web app is already live; re-run `npm run build:ota` to retry.
if (( BUILD_OTA )); then
  log "Publishing OTA bundle"
  if OTA_SKIP_BUILD=1 OTA_ONLY_IF_CHANGED=1 npm run build:ota -- "" "${OTA_NOTES:-}"; then
    :
  else
    printf '\033[1;33mWARNING:\033[0m OTA bundle was not published; run: cd %s && npm run build:ota\n' "$APP_DIR" >&2
  fi
fi

if (( KEEP_BACKUPS > 0 )); then
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR/${APP_NAME}_"*.zip 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f --
fi

log "Done: now at $(git rev-parse --short HEAD). Backup: $BACKUP"

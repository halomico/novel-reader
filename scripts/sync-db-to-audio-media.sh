#!/usr/bin/env bash
# Snapshot main-site SQLite/settings to audio media node, replacing previous remote backup.
set -euo pipefail

MAIN_DATA="${MAIN_DATA:-/opt/novel-reader/data}"
REMOTE_HOST="${REMOTE_HOST:-192.227.220.85}"
REMOTE_DIR="${REMOTE_DIR:-/opt/novel-reader/backups/main-db}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="/tmp/novel-reader-db-sync-${STAMP}"
LOG="${LOG:-/var/log/novel-reader-db-sync.log}"
export SSHPASS="${SSHPASS:-}"

log() { echo "[$(date -Is)] $*" | tee -a "$LOG"; }

log "START work=$WORK remote=${REMOTE_HOST}:${REMOTE_DIR}"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

# Consistent SQLite snapshots (app can keep running)
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$MAIN_DATA/novels.db" ".timeout 30000" ".backup '$WORK/novels.db'"
  if [[ -f "$MAIN_DATA/content-search.db" ]]; then
    sqlite3 "$MAIN_DATA/content-search.db" ".timeout 30000" ".backup '$WORK/content-search.db'" || cp -a "$MAIN_DATA/content-search.db" "$WORK/content-search.db"
  fi
else
  # fallback: copy main db files (may include -wal)
  cp -a "$MAIN_DATA/novels.db" "$WORK/novels.db"
  [[ -f "$MAIN_DATA/novels.db-wal" ]] && cp -a "$MAIN_DATA/novels.db-wal" "$WORK/" || true
  [[ -f "$MAIN_DATA/content-search.db" ]] && cp -a "$MAIN_DATA/content-search.db" "$WORK/" || true
fi

[[ -f "$MAIN_DATA/admin-settings.json" ]] && cp -a "$MAIN_DATA/admin-settings.json" "$WORK/"
# optional env (no print)
if [[ -f /opt/novel-reader/.env ]]; then
  cp -a /opt/novel-reader/.env "$WORK/main.env"
  chmod 600 "$WORK/main.env"
fi

cat > "$WORK/MANIFEST.txt" <<EOF
created_at=$(date -Is)
host=$(hostname -f 2>/dev/null || hostname)
source=$MAIN_DATA
files:
$(cd "$WORK" && ls -lah)
EOF

# Clear old remote backup dir, then upload fresh set
sshpass -e ssh -o StrictHostKeyChecking=yes -o ConnectTimeout=20 "root@${REMOTE_HOST}" \
  "rm -rf '${REMOTE_DIR}' && mkdir -p '${REMOTE_DIR}' && chmod 700 '${REMOTE_DIR}'"

sshpass -e rsync -aH --info=stats2 \
  -e 'ssh -o StrictHostKeyChecking=yes -o ConnectTimeout=20' \
  "$WORK"/ "root@${REMOTE_HOST}:${REMOTE_DIR}/"

sshpass -e ssh -o StrictHostKeyChecking=yes "root@${REMOTE_HOST}" \
  "ls -lah '${REMOTE_DIR}'; du -sh '${REMOTE_DIR}'; sha256sum '${REMOTE_DIR}/novels.db' | head -1"

log "DONE remote=${REMOTE_HOST}:${REMOTE_DIR}"

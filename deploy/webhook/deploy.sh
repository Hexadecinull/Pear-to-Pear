#!/usr/bin/env bash
# Pulls the latest master and rebuilds/restarts Pear-to-Pear.
# Invoked by listener.mjs after it verifies a GitHub push webhook. Never
# run this with untrusted input; it takes no arguments and reads only
# REPO_DIR / DEPLOY_MODE from the environment, both of which you set
# yourself (see deploy/webhook/.env.example), never from the webhook
# payload itself.
set -euo pipefail

REPO_DIR="${REPO_DIR:?Set REPO_DIR to the repository path, e.g. /opt/pear-to-pear}"
DEPLOY_MODE="${DEPLOY_MODE:-docker}"   # docker | systemd
BRANCH="${DEPLOY_BRANCH:-master}"

log() { echo "[deploy] $(date -u +%FT%TZ) $*"; }

cd "$REPO_DIR"

log "fetching latest $BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

if [ "$DEPLOY_MODE" = "docker" ]; then
  log "rebuilding and restarting via docker compose..."
  docker compose up -d --build
else
  log "building client..."
  (cd client && npm ci && npm run build)
  log "building server..."
  (cd server && npm ci && npm run build)
  log "restarting service..."
  sudo systemctl restart pear-to-pear
fi

log "done."

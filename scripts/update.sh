#!/usr/bin/env bash
#
# Data-safe in-place update for a Node/EC2 (or Lightsail) deployment.
#
# It NEVER deletes or overwrites the SQLite database. It always takes a
# timestamped backup of the database first, then pulls the new code, installs
# dependencies, rebuilds the frontend, and restarts the server.
#
# Usage (run from the project directory on the server):
#   BRANCH=claude/library-management-system-s0vpql ./scripts/update.sh
#
# Environment variables:
#   BRANCH   Git branch to deploy            (default: main)
#   DB_PATH  Path to the SQLite database     (default: server/stock-management.db)
#   PORT     Port the server listens on      (default: 3001)
#
set -euo pipefail

BRANCH="${BRANCH:-main}"
PORT="${PORT:-3001}"
DB_PATH="${DB_PATH:-server/stock-management.db}"

echo "==> Deploying branch '$BRANCH' (port $PORT)"

# 1. Back up the database BEFORE doing anything else.
if [ -f "$DB_PATH" ]; then
  BACKUP_DIR="$(dirname "$DB_PATH")/backups"
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_FILE="$BACKUP_DIR/stock-management-$STAMP.db"
  cp "$DB_PATH" "$BACKUP_FILE"
  echo "==> Database backed up to $BACKUP_FILE"
else
  echo "==> No existing database at '$DB_PATH' yet (a fresh one will be created)."
fi

# 2. Pull the latest code. The database is gitignored, so this never touches it.
echo "==> Fetching latest code..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

# 3. Install dependencies and rebuild the frontend.
echo "==> Installing dependencies..."
npm ci || npm install

echo "==> Building frontend..."
npm run build

# 4. Restart the server. Uses pm2 if available, otherwise systemd, otherwise
#    prints how to start it manually. Migrations are additive (CREATE TABLE IF
#    NOT EXISTS / ADD COLUMN guards), so existing data is preserved on boot.
export NODE_ENV=production
export PORT
export DB_PATH

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Restarting with pm2..."
  pm2 startOrReload ecosystem.config.js --update-env 2>/dev/null \
    || pm2 restart stock-management --update-env 2>/dev/null \
    || pm2 start server/index.js --name stock-management --update-env
  pm2 save
elif systemctl list-units --type=service 2>/dev/null | grep -q stock-management; then
  echo "==> Restarting systemd service stock-management..."
  sudo systemctl restart stock-management
else
  echo "==> No pm2/systemd service detected."
  echo "    Start the server manually, e.g.:"
  echo "      NODE_ENV=production PORT=$PORT DB_PATH=$DB_PATH node server/index.js"
fi

echo "==> Update complete. Existing data left intact."

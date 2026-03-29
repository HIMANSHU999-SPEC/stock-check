#!/bin/bash
##############################################################################
# deploy.sh — Safe update script for AWS Lightsail (existing server)
#
# Run on the server:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# What this script does:
#   1. Backs up the SQLite database (your data is safe)
#   2. Pulls latest code from git
#   3. Installs/updates dependencies
#   4. Builds the React frontend
#   5. Reloads the PM2 process (zero-downtime reload)
##############################################################################
set -e

APP_DIR="/opt/stock-management"
DB_FILE="$APP_DIR/server/stock-management.db"
BACKUP_DIR="$APP_DIR/backups"
BRANCH="claude/update-repo-aws-nginx-dJbUu"

echo ""
echo "=================================================="
echo "  Stock Management System — Safe Deploy"
echo "=================================================="
echo ""

# ── 1. Backup database ───────────────────────────────────────────────────────
echo ">>> Step 1: Backing up database..."
mkdir -p "$BACKUP_DIR"
if [ -f "$DB_FILE" ]; then
    BACKUP_NAME="stock-management-$(date +%Y%m%d-%H%M%S).db"
    cp "$DB_FILE" "$BACKUP_DIR/$BACKUP_NAME"
    echo "    Backup saved: $BACKUP_DIR/$BACKUP_NAME"
    # Keep only last 10 backups
    ls -t "$BACKUP_DIR"/*.db 2>/dev/null | tail -n +11 | xargs -r rm --
    echo "    Old backups cleaned (keeping last 10)"
else
    echo "    No database found yet — skipping backup"
fi

# ── 2. Pull latest code ──────────────────────────────────────────────────────
echo ""
echo ">>> Step 2: Pulling latest code from git ($BRANCH)..."
cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"
echo "    Code updated."

# ── 3. Install dependencies ──────────────────────────────────────────────────
echo ""
echo ">>> Step 3: Installing dependencies..."
npm install --production=false
echo "    Dependencies installed."

# ── 4. Build frontend ────────────────────────────────────────────────────────
echo ""
echo ">>> Step 4: Building React frontend..."
npm run build
echo "    Build complete. Output: $APP_DIR/dist"

# ── 5. Reload PM2 ────────────────────────────────────────────────────────────
echo ""
echo ">>> Step 5: Reloading PM2 process..."
if pm2 list | grep -q "stock-management"; then
    pm2 reload stock-management --update-env
    echo "    PM2 process reloaded."
else
    echo "    PM2 process not found — starting fresh..."
    NODE_ENV=production pm2 start ecosystem.config.js --env production
    pm2 save
    echo "    PM2 process started and saved."
fi

echo ""
echo "=================================================="
echo "  Deploy complete!"
echo "  App running at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')"
echo "=================================================="
echo ""

#!/bin/bash
##############################################################################
# server-setup.sh — First-time AWS Lightsail server setup
#
# Run once on a fresh Ubuntu 22.04 / 24.04 Lightsail instance:
#   chmod +x server-setup.sh
#   sudo ./server-setup.sh
##############################################################################
set -e

APP_DIR="/opt/stock-management"
REPO_URL="https://github.com/himanshu999-spec/stock-check.git"
BRANCH="claude/update-repo-aws-nginx-dJbUu"

echo ""
echo "=================================================="
echo "  Stock Management — First-Time Server Setup"
echo "=================================================="

# ── System packages ──────────────────────────────────────────────────────────
echo ""
echo ">>> Installing system packages..."
apt-get update -y
apt-get install -y curl git nginx build-essential python3

# ── Node.js 20 LTS ──────────────────────────────────────────────────────────
echo ""
echo ">>> Installing Node.js 20 LTS..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
node -v && npm -v

# ── PM2 ─────────────────────────────────────────────────────────────────────
echo ""
echo ">>> Installing PM2..."
npm install -g pm2

# ── Clone repository ─────────────────────────────────────────────────────────
echo ""
echo ">>> Cloning repository to $APP_DIR..."
if [ -d "$APP_DIR" ]; then
    echo "    Directory exists — pulling latest instead"
    cd "$APP_DIR"
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
else
    git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# ── Install dependencies & build ─────────────────────────────────────────────
echo ""
echo ">>> Installing app dependencies..."
npm install --production=false

echo ""
echo ">>> Building React frontend..."
npm run build

# ── PM2 startup ──────────────────────────────────────────────────────────────
echo ""
echo ">>> Starting app with PM2..."
cd "$APP_DIR"
NODE_ENV=production pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup | tail -1 | bash || true

# ── Nginx ────────────────────────────────────────────────────────────────────
echo ""
echo ">>> Configuring Nginx..."
cp "$APP_DIR/nginx.conf" /etc/nginx/sites-available/stock-management
ln -sf /etc/nginx/sites-available/stock-management /etc/nginx/sites-enabled/stock-management
# Disable default site if present
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
systemctl enable nginx

# ── Firewall ─────────────────────────────────────────────────────────────────
echo ""
echo ">>> Opening firewall ports (80, 443)..."
ufw allow 'Nginx Full' 2>/dev/null || true

echo ""
echo "=================================================="
echo "  Setup complete!"
echo ""
echo "  Your app is running at:"
echo "  http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')"
echo ""
echo "  IMPORTANT: Edit /opt/stock-management/ecosystem.config.js"
echo "  and change AUTH_SECRET to a long random string!"
echo "=================================================="

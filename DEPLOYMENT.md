# Deployment & Updating on AWS (data-safe)

## Environment variables

No credentials are hardcoded in this repository. Configure via environment:

| Variable | Purpose |
|---|---|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First admin account, created **only** when the users table is empty (fresh install). If unset, a random password is generated and printed once to the server console. Existing databases are never modified. |
| `AUTH_SECRET` | Secret for signing login tokens. **Set this in production** (e.g. `openssl rand -hex 32`); the fallback default is public in the repo. |
| `RESTORE_PASSWORD` | Optional password for recycle-bin restores. When unset, restores require an admin login instead. |
| `DB_PATH` | SQLite database location (defaults to `server/stock-management.db`). |
| `PORT` | API port (default 3001). |
| `APP_BASE_URL` | Public address of the system, e.g. `https://stock.example.ac.uk`. Needed for Microsoft sign-in and encoded in printed QR stickers. |
| `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` | Microsoft Entra app registration used for single sign-on, email and SharePoint. See `docs/MICROSOFT365_SETUP.md`. |
| `ALLOW_PASSWORD_LOGIN` | Leave unset. Once single sign-on is working, Microsoft is the only way to sign in. Setting this to `true` (and restarting) lets email + password sign-in work as well: an emergency measure for when Microsoft sign-in itself is broken. Remove it afterwards. |
| `MAIL_FROM` / `MAIL_CC` | Mailbox emails are sent from, and optional copy addresses. Can also be set in Settings. |
| `ANTHROPIC_API_KEY` | Optional. Turns on AI suggestions for categories and brands. Only asset names, models, brands and categories are sent. `AI_MODEL` overrides the model. |
| `HOME_CAMPUS` | Campus that electronics with no campus are filed under (default `Towerhill`). |
| `SHAREPOINT_SITE_URL` / `SHAREPOINT_LIST_NAME` | SharePoint site and list to mirror assets to. Can also be set in Settings. |

These can be exported in the shell as before, or kept in a `.env` file in the
app directory (copy `.env.example`; the file is gitignored and read at
start-up, with real environment variables taking precedence).

This guide explains how to deploy the new Library Management update to an
existing AWS installation **without losing any existing data**.

## Why your data is safe

- The database schema is applied with `CREATE TABLE IF NOT EXISTS` and guarded
  `ALTER TABLE ... ADD COLUMN` statements. Starting the updated code against an
  existing database only **adds** the new empty `books`, `borrowers`, and
  `book_loans` tables — it never drops or rewrites existing tables or rows.
- The SQLite database file is **gitignored**, so `git pull` never overwrites it.
- Every method below **backs up the database first**, and keeps it on a path
  that code updates cannot touch.

> Always take a backup before updating. A backup is just a copy of the single
> SQLite file:
> ```bash
> cp /path/to/stock-management.db /path/to/stock-management-$(date +%F).db
> ```

Set `DB_PATH` to keep the database outside the code checkout (recommended), e.g.
`/var/lib/stock-management/stock-management.db`. The app reads `DB_PATH` and
falls back to `server/stock-management.db` if it is not set.

---

## Which version of Node

Use **Node 24** (the version in `.nvmrc`). The app also runs on Node 22 and on
20.19 or later, and the test suite passes on all three, but Node 20 stopped
receiving security fixes in April 2026 and Node 22 stops in April 2027.

Moving a running server from one version of Node to another:

1. Back up the database first (see below).
2. Install the new Node the same way the old one was installed (`nvm`, the
   NodeSource apt repository, or the Lightsail blueprint). `node -v` should
   then show the new version for the user that runs the app.
3. In the app directory run `npm ci`. This is not optional: the database
   library is compiled for one version of Node and will not load in another
   until it is reinstalled.
4. Run `npm test`. It uses its own temporary database and touches nothing live.
5. Restart the app **under the new Node**. With PM2, `pm2 restart` keeps using
   the old interpreter, so run `pm2 delete stock-backend`, start it again
   from the app directory with the new `node` first on the `PATH`
   (`pm2 start server/index.js --name stock-backend`, with the same
   environment as before), then `pm2 save`. If PM2 itself was installed
   under the old Node, reinstall it (`npm install -g pm2`, then `pm2 update`).
6. Check `pm2 describe stock-backend` shows the new "node.js version", and
   that the site answers.

To go back, switch `node` back to the old version, run `npm ci` again and
restart the same way.

## Option A — EC2 / Lightsail (Node + PM2)

### Connecting to a Lightsail instance (SSH with your .pem key)

Keep your `.pem` key private — never share or commit it.

```bash
# From your own machine. Lock down key permissions the first time:
chmod 400 /path/to/LightsailKey.pem

# Connect. User is "bitnami" for the Node.js blueprint, "ubuntu" for Ubuntu OS:
ssh -i /path/to/LightsailKey.pem ubuntu@YOUR_INSTANCE_PUBLIC_IP
```

Once connected, locate the app and the current database (they were set up when
you first deployed):

```bash
sudo find / -name 'stock-management.db' 2>/dev/null   # where the data lives
sudo find / -type d -name 'stock-check' 2>/dev/null   # the app directory
pm2 list                                              # how it's running (if PM2)
cd /path/to/stock-check                               # cd into the app dir
```

> **Before anything else, back up the database** (see command below). Note the
> path it is in — you pass that as `DB_PATH`.

### One-time setup to move the database onto a stable path (recommended)

```bash
sudo mkdir -p /var/lib/stock-management
# Move your existing DB there (only if it currently lives in the repo):
sudo mv server/stock-management.db /var/lib/stock-management/ 2>/dev/null || true
```

Then update with the bundled script (it backs up the DB, pulls, installs,
builds, and restarts). The first time, fetch the branch once so the script
itself is present, then run it:

```bash
cd /path/to/stock-check
git fetch origin claude/library-management-system-s0vpql
git checkout claude/library-management-system-s0vpql
export DB_PATH=/var/lib/stock-management/stock-management.db   # your DB path
BRANCH=claude/library-management-system-s0vpql ./scripts/update.sh
```

Or run the steps manually:

```bash
cp "$DB_PATH" "$DB_PATH.$(date +%F-%H%M%S).bak"   # 1. backup
git pull origin claude/library-management-system-s0vpql  # 2. new code
npm ci && npm run build                            # 3. deps + frontend
pm2 restart stock-management --update-env          # 4. restart
```

`ecosystem.config.js` is included for PM2 (`pm2 start ecosystem.config.js`).

---

## Option B — Docker / ECS / App Runner

The database lives in a named volume (`stock_data` → `/data`) that is preserved
across image rebuilds and redeploys.

```bash
# First time: if you have an existing DB, copy it into the volume once.
docker volume create stock_data
docker run --rm -v stock_data:/data -v "$PWD":/src alpine \
  sh -c "cp -n /src/server/stock-management.db /data/stock-management.db || true"

# Deploy / update:
docker compose up -d --build
```

Because the volume is separate from the image, rebuilding to ship new code does
not delete the database.

---

## Option C — Elastic Beanstalk (Node.js)

Elastic Beanstalk instances have an **ephemeral** filesystem, so the SQLite file
must live on an attached EFS mount (or you should migrate to RDS). Point
`DB_PATH` at the EFS mount so data survives deploys:

1. Attach an EFS volume (e.g. mounted at `/mnt/efs`).
2. Set an environment property `DB_PATH=/mnt/efs/stock-management.db`.
3. Copy your existing database file to that location once.
4. Deploy the new version (`eb deploy`). The additive migrations run on boot and
   leave existing rows intact.

---

## Verifying after update

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/        # 200 (app)
curl -s http://localhost:3001/api/auth/license                          # license JSON
```

Then log in as the admin and confirm your existing assets/employees are still
present, and that the new **Books**, **Borrowers**, and **Issue Desk** menu
items appear.

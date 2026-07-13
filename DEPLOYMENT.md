# Deployment & Updating on AWS (data-safe)

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

## Option A — EC2 / Lightsail (Node + PM2)

One-time setup to move the database onto a stable path (do this once):

```bash
sudo mkdir -p /var/lib/stock-management
# Move your existing DB there (only if it currently lives in the repo):
sudo mv server/stock-management.db /var/lib/stock-management/ 2>/dev/null || true
```

Then update with the bundled script (it backs up the DB, pulls, installs,
builds, and restarts):

```bash
cd /path/to/stock-check
export DB_PATH=/var/lib/stock-management/stock-management.db
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

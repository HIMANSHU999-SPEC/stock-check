// Loaded first so a DB_PATH set in the optional .env file is honoured.
require('./config');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// Database location can be overridden with DB_PATH so the SQLite file can live
// on a persistent volume (e.g. a mounted EBS/Docker volume) and survive
// code updates and redeploys. Defaults to the original in-repo location.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'stock-management.db');

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function ensureSetting(key, valueObject) {
  const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!existing) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(valueObject));
  }
}

// Bootstrap the first administrator on an empty database. No credentials are
// hardcoded in the repository: provide ADMIN_EMAIL / ADMIN_PASSWORD env vars,
// or a random password is generated and printed once to the server console.
// Further accounts are created by the admin from the Users page.
function bootstrapFirstAdmin() {
  const { c: userCount } = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (userCount > 0) return;

  const email = process.env.ADMIN_EMAIL || 'admin@localhost';
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }

  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('Administrator', email, hashPassword(password), 'admin');

  console.log('==================================================');
  console.log('First-run administrator account created:');
  console.log(`  email:    ${email}`);
  if (generated) {
    console.log(`  password: ${password}`);
    console.log('  (randomly generated — log in and change it immediately)');
  } else {
    console.log('  password: (taken from ADMIN_PASSWORD env var)');
  }
  console.log('==================================================');
}

// Initialize database schema
function initializeDatabase() {
  // Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Employees table
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      department TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Assets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category_id INTEGER,
      model TEXT,
      serial_number TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      assigned_quantity INTEGER NOT NULL DEFAULT 0,
      purchase_date DATE,
      purchase_price REAL,
      intune_price REAL,
      status TEXT DEFAULT 'available',
      assigned_to INTEGER,
      location TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (assigned_to) REFERENCES employees(id)
    )
  `);

  // Ensure quantity columns exist for older databases
  const assetColumns = db.prepare(`PRAGMA table_info('assets')`).all();
  const columnNames = assetColumns.map(col => col.name);
  if (!columnNames.includes('quantity')) {
    db.exec(`ALTER TABLE assets ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`);
  }
  if (!columnNames.includes('assigned_quantity')) {
    db.exec(`ALTER TABLE assets ADD COLUMN assigned_quantity INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnNames.includes('supplier_name')) {
    db.exec(`ALTER TABLE assets ADD COLUMN supplier_name TEXT`);
  }
  if (!columnNames.includes('warranty_period_months')) {
    db.exec(`ALTER TABLE assets ADD COLUMN warranty_period_months INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnNames.includes('deleted_at')) {
    db.exec(`ALTER TABLE assets ADD COLUMN deleted_at DATETIME`);
  }
  if (!columnNames.includes('deleted_by')) {
    db.exec(`ALTER TABLE assets ADD COLUMN deleted_by INTEGER`);
  }
  if (!columnNames.includes('campus')) {
    db.exec(`ALTER TABLE assets ADD COLUMN campus TEXT DEFAULT ''`);
  }
  if (!columnNames.includes('brand')) {
    db.exec(`ALTER TABLE assets ADD COLUMN brand TEXT`);
  }
  if (!columnNames.includes('sharepoint_item_id')) {
    db.exec(`ALTER TABLE assets ADD COLUMN sharepoint_item_id TEXT`);
  }

  // Normalize existing rows where assignment exists but assigned_quantity is zero
  db.exec(`
    UPDATE assets
    SET assigned_quantity = 1
    WHERE assigned_to IS NOT NULL AND (assigned_quantity IS NULL OR assigned_quantity = 0)
  `);
  db.exec(`
    UPDATE assets
    SET assigned_quantity = 0
    WHERE assigned_quantity IS NULL
  `);
  db.exec(`
    UPDATE assets
    SET warranty_period_months = 0
    WHERE warranty_period_months IS NULL
  `);

  // Ensure supplier_name is not null for existing rows
  db.exec(`
    UPDATE assets
    SET supplier_name = ''
    WHERE supplier_name IS NULL
  `);

  // Ensure campus is not null for existing rows
  db.exec(`
    UPDATE assets
    SET campus = ''
    WHERE campus IS NULL
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'subadmin', 'inventory', 'viewer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Settings table (for license/trial and other config)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // ---------------------------------------------------------------------------
  // Library management tables
  // ---------------------------------------------------------------------------

  // Books inventory
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_number TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT,
      isbn TEXT,
      category TEXT,
      publisher TEXT,
      published_year INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      issued_quantity INTEGER NOT NULL DEFAULT 0,
      shelf_location TEXT,
      campus TEXT DEFAULT '',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Borrowers (students and staff) — the library's own people list,
  // kept separate from IT-asset "employees".
  db.exec(`
    CREATE TABLE IF NOT EXISTS borrowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'student' CHECK (type IN ('student', 'staff')),
      identifier TEXT,
      email TEXT,
      class_dept TEXT,
      phone TEXT,
      campus TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Book loans (issue / return records)
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      borrower_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      due_at DATETIME,
      returned_at DATETIME,
      status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'returned')),
      issued_by INTEGER,
      notes TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (borrower_id) REFERENCES borrowers(id)
    )
  `);

  // Documents attached to assets (purchase invoices, warranty papers, photos)
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mimetype TEXT,
      size INTEGER,
      uploaded_by INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    )
  `);

  // Activity log (audit trail) — records key actions across the system
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ---------------------------------------------------------------------------
  // Assignments — who (or which room) currently holds how many of an asset.
  // One asset can have several open rows, so bulk stock (chairs, tables,
  // cables) can be split across people and rooms. assets.assigned_to and
  // assets.assigned_quantity are kept as a summary of the open rows here.
  // ---------------------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      employee_id INTEGER,
      location_label TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      assigned_by INTEGER,
      returned_at DATETIME,
      returned_by INTEGER,
      return_condition TEXT,
      notes TEXT,
      FOREIGN KEY (asset_id) REFERENCES assets(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_asset_assignments_open ON asset_assignments (asset_id, returned_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_asset_assignments_employee ON asset_assignments (employee_id, returned_at)`);

  // One-off backfill: carry every existing single-holder assignment over.
  const backfilled = db.prepare("SELECT value FROM settings WHERE key = 'migration_asset_assignments'").get();
  if (!backfilled) {
    db.transaction(() => {
      db.exec(`
        INSERT INTO asset_assignments (asset_id, employee_id, quantity, assigned_at)
        SELECT a.id, a.assigned_to, MAX(COALESCE(a.assigned_quantity, 0), 1), COALESCE(a.updated_at, CURRENT_TIMESTAMP)
        FROM assets a
        WHERE a.assigned_to IS NOT NULL
          AND EXISTS (SELECT 1 FROM employees e WHERE e.id = a.assigned_to)
          AND NOT EXISTS (SELECT 1 FROM asset_assignments x WHERE x.asset_id = a.id)
      `);
      db.prepare("INSERT INTO settings (key, value) VALUES ('migration_asset_assignments', ?)")
        .run(JSON.stringify({ done_at: new Date().toISOString() }));
    })();
  }

  // The organisation's own "a name containing X is a Y" rules for the
  // auto-categoriser; they take priority over the built-in ones.
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE COLLATE NOCASE,
      category_id INTEGER NOT NULL,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);

  // What the AI made of each asset, kept so it is only asked again when the
  // asset's name, model or brand changes (input_hash).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      asset_id INTEGER PRIMARY KEY,
      input_hash TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      electronic INTEGER NOT NULL DEFAULT 0,
      confident INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Editable email templates (subject + plain-text body with {{placeholders}})
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_templates (
      key TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER
    )
  `);

  // Every email the system tried to send, so a failure is never silent
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_key TEXT,
      to_email TEXT NOT NULL,
      cc_email TEXT,
      subject TEXT,
      status TEXT NOT NULL,
      error TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      user_id INTEGER,
      user_email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Assets waiting to be pushed to the SharePoint list
  db.exec(`
    CREATE TABLE IF NOT EXISTS sharepoint_outbox (
      asset_id INTEGER PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 1,
      queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )
  `);

  // Asset history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      employee_id INTEGER,
      notes TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )
  `);

  // Delete audit for sub-admin limits
  db.exec(`
    CREATE TABLE IF NOT EXISTS delete_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Recycle bin to support soft deletes and timed purge
  db.exec(`
    CREATE TABLE IF NOT EXISTS recycle_bin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_by INTEGER,
      can_restore_until DATETIME NOT NULL
    )
  `);

  // Insert default categories
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)');
  insertCategory.run('Laptop', 'Laptop computers');
  insertCategory.run('Desktop', 'Desktop computers');
  insertCategory.run('Monitor', 'Display monitors');
  insertCategory.run('Mobile Device', 'Phones and tablets');
  insertCategory.run('Peripheral', 'Keyboards, mice, and other peripherals');
  insertCategory.run('Networking', 'Routers, switches, and network equipment');
  insertCategory.run('Other Electronics', 'Other electronic devices');
  insertCategory.run('Furniture', 'Office furniture');
  insertCategory.run('Other', 'Miscellaneous items');

  // Older databases only allow the first two roles. SQLite cannot alter a
  // CHECK in place, so the table is rebuilt with the same columns and every
  // row carried over, inside one transaction that fails as a whole.
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
  const OLD_ROLE_CHECK = "CHECK (role IN ('admin', 'subadmin'))";
  if (usersSql.includes(OLD_ROLE_CHECK)) {
    db.transaction(() => {
      const before = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'users'").get();
      db.exec(usersSql
        .replace(/CREATE TABLE\s+("?)users\1/i, 'CREATE TABLE users_rebuild')
        .replace(OLD_ROLE_CHECK, "CHECK (role IN ('admin', 'subadmin', 'inventory', 'viewer'))"));
      const columns = db.prepare("PRAGMA table_info('users')").all().map((col) => col.name).join(', ');
      db.exec(`INSERT INTO users_rebuild (${columns}) SELECT ${columns} FROM users`);
      const after = db.prepare('SELECT COUNT(*) AS n FROM users_rebuild').get().n;
      if (after !== before) throw new Error(`users rebuild copied ${after} of ${before} rows`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_rebuild RENAME TO users');
      // Never hand out the id of a deleted account again.
      if (seq) db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'users'").run(seq.seq);
    })();
    console.log('Users table updated to allow the viewer and inventory roles');
  }

  // Create the first admin only when the users table is empty (fresh install).
  // Existing databases keep their accounts exactly as they are.
  bootstrapFirstAdmin();

  // People are never removed once they have a history: a leaver is marked
  // inactive instead, so every past assignment still shows who held what.
  const employeeColumns = db.prepare(`PRAGMA table_info('employees')`).all().map((col) => col.name);
  if (!employeeColumns.includes('status')) {
    db.exec(`ALTER TABLE employees ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!employeeColumns.includes('deactivated_at')) {
    db.exec(`ALTER TABLE employees ADD COLUMN deactivated_at DATETIME`);
  }
  if (!employeeColumns.includes('deactivated_by')) {
    db.exec(`ALTER TABLE employees ADD COLUMN deactivated_by TEXT`);
  }
  if (!employeeColumns.includes('deactivation_note')) {
    db.exec(`ALTER TABLE employees ADD COLUMN deactivation_note TEXT`);
  }

  // A staff-list entry is a person unless marked as a department or shared
  // mailbox ("shared"): those hold equipment but nobody signs in as them,
  // so they are never treated as leavers and IT confirms what they hold.
  if (!employeeColumns.includes('kind')) {
    db.exec(`ALTER TABLE employees ADD COLUMN kind TEXT NOT NULL DEFAULT 'person'`);
  }

  // Who carried out each change to an asset (the signed-in user's email).
  const historyColumns = db.prepare(`PRAGMA table_info('asset_history')`).all().map((col) => col.name);
  if (!historyColumns.includes('performed_by')) {
    db.exec(`ALTER TABLE asset_history ADD COLUMN performed_by TEXT`);
  }

  // Staff confirm for themselves that they hold what is recorded against
  // them. Cleared whenever more is added to the same assignment.
  const assignmentColumns = db.prepare(`PRAGMA table_info('asset_assignments')`).all().map((col) => col.name);
  if (!assignmentColumns.includes('confirmed_at')) {
    db.exec(`ALTER TABLE asset_assignments ADD COLUMN confirmed_at DATETIME`);
  }
  if (!assignmentColumns.includes('confirmed_by')) {
    db.exec(`ALTER TABLE asset_assignments ADD COLUMN confirmed_by TEXT`);
  }

  // Problems staff raise about their own list ("I don't have this",
  // "something is missing"). Kept after they are resolved, as a record. The
  // person's name and email are copied in so the entry reads the same later.
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      employee_name TEXT,
      employee_email TEXT,
      assignment_id INTEGER,
      asset_id INTEGER,
      reason TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      email_status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by TEXT,
      resolution_note TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_reports_status ON staff_reports (status, created_at)`);

  // Leavers who still hold equipment, and whether the people responsible
  // have been emailed about them yet. A row goes when the items are dealt with.
  db.exec(`
    CREATE TABLE IF NOT EXISTS leaver_alerts (
      employee_id INTEGER PRIMARY KEY,
      reason TEXT,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notified_at DATETIME
    )
  `);

  // Seed default license state
  ensureSetting('license', {
    status: 'not_activated',
    activated_at: null,
    expires_at: null,
    last_code: null
  });

  console.log('Database initialized successfully');
}

initializeDatabase();

module.exports = db;

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'stock-management.db'));

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

function ensureUser({ email, name, role, password }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!existing) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
      name,
      email,
      hashPassword(password),
      role
    );
  }
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
      role TEXT NOT NULL CHECK (role IN ('admin', 'subadmin')),
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

  // Seed default users
  // Update legacy admin credentials if present, otherwise ensure new ones.
  const adminNewEmail = 'itsupport@laat.ac.uk';
  const adminOld = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@stock.local');
  const adminExistingNew = db.prepare('SELECT id FROM users WHERE email = ?').get(adminNewEmail);
  if (!adminExistingNew) {
    if (adminOld) {
      db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?')
        .run(adminNewEmail, hashPassword('IN3Ia-147!'), adminOld.id);
    } else {
      ensureUser({
        email: adminNewEmail,
        name: 'Administrator',
        role: 'admin',
        password: 'IN3Ia-147!'
      });
    }
  }

  const subNewEmail = 'itteam@laat.ac.uk';
  const subOld = db.prepare('SELECT id FROM users WHERE email = ?').get('subadmin@stock.local');
  const subExistingNew = db.prepare('SELECT id FROM users WHERE email = ?').get(subNewEmail);
  if (!subExistingNew) {
    if (subOld) {
      db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?')
        .run(subNewEmail, hashPassword('IN3ia-147!'), subOld.id);
    } else {
      ensureUser({
        email: subNewEmail,
        name: 'IT Team',
        role: 'subadmin',
        password: 'IN3ia-147!'
      });
    }
  }

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

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

  // Normalize existing rows where assignment exists but assigned_quantity is zero
  db.exec(`
    UPDATE assets
    SET assigned_quantity = 1
    WHERE assigned_to IS NOT NULL AND (assigned_quantity IS NULL OR assigned_quantity = 0)
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
  ensureUser({
    email: 'admin@stock.local',
    name: 'Administrator',
    role: 'admin',
    password: '12345678'
  });
  ensureUser({
    email: 'subadmin@stock.local',
    name: 'Sub Administrator',
    role: 'subadmin',
    password: 'SubAdmin@123'
  });

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

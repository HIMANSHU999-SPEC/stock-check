const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'stock-management.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

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

  console.log('Database initialized successfully');
}

initializeDatabase();

module.exports = db;

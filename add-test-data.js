// Quick script to add test data
const db = require('./server/database');

// Add employees
const emp1 = db.prepare(`
  INSERT INTO employees (name, email, department, phone)
  VALUES ('John Smith', 'john.smith@laat.edu', 'IT Department', '020 1234 5678')
`).run();

const emp2 = db.prepare(`
  INSERT INTO employees (name, email, department, phone)
  VALUES ('Sarah Johnson', 'sarah.johnson@laat.edu', 'Administration', '020 1234 5679')
`).run();

console.log('Added employees');

// Add assets
db.prepare(`
  INSERT INTO assets (asset_number, name, category_id, model, serial_number, purchase_date, purchase_price, intune_price, location, notes, status)
  VALUES ('AST-2025-0001', 'Dell Latitude 7420', 1, 'Latitude 7420', 'SN123456789', '2025-01-15', 1200, 1500, 'IT Office', 'High-performance laptop for IT staff', 'available')
`).run();

db.prepare(`
  INSERT INTO assets (asset_number, name, category_id, model, serial_number, purchase_date, purchase_price, intune_price, location, notes, status)
  VALUES ('AST-2025-0002', 'HP EliteDesk 800 G6', 2, 'EliteDesk 800 G6', 'SN987654321', '2025-01-10', 900, 1100, 'Admin Office', 'Desktop computer for administration', 'available')
`).run();

db.prepare(`
  INSERT INTO assets (asset_number, name, category_id, model, serial_number, purchase_date, purchase_price, intune_price, location, status)
  VALUES ('AST-2025-0003', 'Dell UltraSharp 27 Monitor', 3, 'U2720Q', 'MON123456', '2025-01-20', 450, 550, 'IT Office', 'available')
`).run();

db.prepare(`
  INSERT INTO assets (asset_number, name, category_id, model, serial_number, purchase_date, purchase_price, intune_price, location, status, assigned_to)
  VALUES ('AST-2025-0004', 'Lenovo ThinkPad X1 Carbon', 1, 'X1 Carbon Gen 9', 'SN555666777', '2025-01-05', 1400, 1750, 'IT Office', 'assigned', 1)
`).run();

// Add history for assigned asset
db.prepare(`
  INSERT INTO asset_history (asset_id, action, employee_id, notes)
  VALUES (4, 'created', NULL, 'Asset registered in system')
`).run();

db.prepare(`
  INSERT INTO asset_history (asset_id, action, employee_id, notes)
  VALUES (4, 'assigned', 1, 'Asset assigned to John Smith')
`).run();

console.log('Added 4 assets with auto-generated asset numbers');
console.log('Test data loaded successfully!');

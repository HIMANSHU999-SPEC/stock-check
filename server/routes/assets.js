const express = require('express');
const router = express.Router();
const db = require('../database');
const { generateAssetNumber } = require('../utils/assetNumber');
const { logActivity } = require('../utils/activity');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// ---------------------------------------------------------------------------
// Document uploads (purchase invoices etc.) — stored on disk under uploads/,
// metadata in the asset_documents table. Uploads live outside the DB backup,
// but the directory is gitignored so code deploys never touch it.
// ---------------------------------------------------------------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_DOC_TYPES = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
};

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => {
            const ext = ALLOWED_DOC_TYPES[file.mimetype] || path.extname(file.originalname) || '';
            cb(null, `asset-${req.params.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        if (ALLOWED_DOC_TYPES[file.mimetype]) return cb(null, true);
        cb(new Error('Only PDF, JPG, PNG or WEBP files are allowed'));
    }
});

// Recycle-bin restore protection. If RESTORE_PASSWORD is set in the
// environment, that password is required; otherwise restores are allowed for
// administrators only (no hardcoded password — the repository is public).
const RESTORE_PASSWORD_HASH = process.env.RESTORE_PASSWORD
    ? crypto.createHash('sha256').update(process.env.RESTORE_PASSWORD).digest('hex')
    : null;

function verifyRestoreAccess(password, user) {
    if (RESTORE_PASSWORD_HASH) {
        if (!password) return false;
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        return hash === RESTORE_PASSWORD_HASH;
    }
    return Boolean(user && user.role === 'admin');
}

function toCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (value) => {
        const str = value === null || value === undefined ? '' : String(value);
        if (str.includes('"') || str.includes(',') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };
    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))
    ];
    return lines.join('\n');
}

// Get all assets with optional filtering
router.get('/', (req, res) => {
    try {
        const { status, category, search, supplier, campus, model, brand } = req.query;
        let query = `
      SELECT a.*, c.name as category_name, e.name as employee_name, e.email as employee_email
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.deleted_at IS NULL
    `;
        const params = [];

        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        }

        if (category) {
            query += ' AND a.category_id = ?';
            params.push(category);
        }

        if (supplier !== undefined) {
            if (supplier === '') {
                query += " AND (a.supplier_name IS NULL OR TRIM(a.supplier_name) = '')";
            } else {
                query += " AND LOWER(TRIM(COALESCE(a.supplier_name, ''))) = LOWER(TRIM(?))";
                params.push(supplier);
            }
        }

        if (campus) {
            query += " AND LOWER(TRIM(COALESCE(a.campus, ''))) = LOWER(TRIM(?))";
            params.push(campus);
        }

        if (model) {
            if (model === 'Unspecified') {
                query += " AND (a.model IS NULL OR TRIM(a.model) = '')";
            } else {
                query += " AND LOWER(TRIM(COALESCE(a.model, ''))) = LOWER(TRIM(?))";
                params.push(model);
            }
        }

        if (brand) {
            if (brand === 'Unspecified') {
                query += " AND (a.brand IS NULL OR TRIM(a.brand) = '')";
            } else {
                query += " AND LOWER(TRIM(COALESCE(a.brand, ''))) = LOWER(TRIM(?))";
                params.push(brand);
            }
        }

        if (search) {
            query += ' AND (a.name LIKE ? OR a.asset_number LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
        }

        query += ' ORDER BY a.created_at DESC';

        const assets = db.prepare(query).all(...params);
        res.json(assets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export assets filtered by category (CSV)
router.get('/export/by-category', (req, res) => {
    try {
        const { category } = req.query;
        let query = `
      SELECT a.asset_number, a.name, a.brand, a.model, a.serial_number, a.quantity, a.assigned_quantity,
             a.status, a.location, a.campus, a.purchase_date, a.purchase_price, a.supplier_name, a.warranty_period_months,
             c.name as category, e.name as assigned_to, e.email as assigned_email, a.created_at as date_added
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.deleted_at IS NULL
    `;
        const params = [];
        if (category) {
            query += ' AND a.category_id = ?';
            params.push(category);
        }
        query += ' ORDER BY c.name, a.name';
        const rows = db.prepare(query).all(...params);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="assets-by-category.csv"');
        return res.send(toCsv(rows));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export assets filtered by supplier (CSV)
router.get('/export/by-supplier', (req, res) => {
    try {
        const { supplier } = req.query;
        let query = `
      SELECT a.asset_number, a.name, a.brand, a.model, a.serial_number, a.quantity, a.assigned_quantity,
             a.status, a.location, a.campus, a.purchase_date, a.purchase_price, a.supplier_name, a.warranty_period_months,
             c.name as category, e.name as assigned_to, e.email as assigned_email, a.created_at as date_added
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.deleted_at IS NULL
    `;
        const params = [];
        if (supplier !== undefined) {
            if (supplier === '') {
                query += " AND (a.supplier_name IS NULL OR TRIM(a.supplier_name) = '')";
            } else {
                query += " AND LOWER(TRIM(COALESCE(a.supplier_name, ''))) = LOWER(TRIM(?))";
                params.push(supplier);
            }
        }
        query += ' ORDER BY a.supplier_name, a.name';
        const rows = db.prepare(query).all(...params);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="assets-by-supplier.csv"');
        return res.send(toCsv(rows));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export assets filtered by model (CSV)
router.get('/export/by-model', (req, res) => {
    try {
        const { model } = req.query;
        let query = `
      SELECT a.asset_number, a.name, a.brand, a.model, a.serial_number, a.quantity, a.assigned_quantity,
             a.status, a.location, a.campus, a.purchase_date, a.purchase_price, a.supplier_name, a.warranty_period_months,
             c.name as category, e.name as assigned_to, e.email as assigned_email, a.created_at as date_added
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.deleted_at IS NULL
    `;
        const params = [];
        if (model !== undefined) {
            if (model === '' || model === 'Unspecified') {
                query += " AND (a.model IS NULL OR TRIM(a.model) = '')";
            } else {
                query += " AND LOWER(TRIM(COALESCE(a.model, ''))) = LOWER(TRIM(?))";
                params.push(model);
            }
        }
        query += ' ORDER BY a.model, a.name';
        const rows = db.prepare(query).all(...params);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="assets-by-model.csv"');
        return res.send(toCsv(rows));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export assets filtered by campus (CSV)
router.get('/export/by-campus', (req, res) => {
    try {
        const { campus } = req.query;
        let query = `
      SELECT a.asset_number, a.name, a.brand, a.model, a.serial_number, a.quantity, a.assigned_quantity,
             a.status, a.location, a.campus, a.purchase_date, a.purchase_price, a.supplier_name, a.warranty_period_months,
             c.name as category, e.name as assigned_to, e.email as assigned_email, a.created_at as date_added
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.deleted_at IS NULL
    `;
        const params = [];
        if (campus !== undefined) {
            if (campus === '') {
                query += " AND (a.campus IS NULL OR TRIM(a.campus) = '')";
            } else {
                query += " AND LOWER(TRIM(COALESCE(a.campus, ''))) = LOWER(TRIM(?))";
                params.push(campus);
            }
        }
        query += ' ORDER BY a.campus, a.name';
        const rows = db.prepare(query).all(...params);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=\"assets-by-campus.csv\"');
        return res.send(toCsv(rows));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function buildEmployeePdf(employee, assets) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.fontSize(18).text('Assigned Assets Report', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Employee: ${employee.name}`);
    doc.text(`Email: ${employee.email}`);
    doc.text(`Department: ${employee.department || 'N/A'}`);
    doc.moveDown();

    doc.fontSize(14).text('Assets', { underline: true });
    doc.moveDown(0.3);
    if (!assets.length) {
        doc.fontSize(12).text('No assigned assets.');
    } else {
        assets.forEach((a) => {
            doc.fontSize(12).text(`${a.asset_number} - ${a.asset_name || a.name || ''} (${a.category || 'N/A'})`);
            doc.text(`Status: ${a.status} | Qty: ${a.assigned_quantity || 0}/${a.quantity || 0}`);
            doc.text(`Model: ${a.model || 'N/A'} | Serial: ${a.serial_number || 'N/A'} | Location: ${a.location || 'N/A'}`);
            doc.moveDown(0.5);
        });
    }
    return doc;
}

function exportAssignments(res, ids) {
    let query = `
      SELECT e.id as employee_id, e.name as employee_name, e.email as employee_email, e.department,
             a.asset_number, a.name as asset_name, a.model, a.serial_number, a.quantity, a.assigned_quantity,
             a.status, c.name as category, a.location
      FROM assets a
      JOIN employees e ON a.assigned_to = e.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.assigned_to IS NOT NULL AND a.deleted_at IS NULL
    `;
    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        query += ` AND a.assigned_to IN (${placeholders})`;
    }
    query += ' ORDER BY e.name';

    const rows = db.prepare(query).all(...ids);

    // If exactly one employee requested, force single PDF path
    if (ids.length === 1) {
        const empId = ids[0];
        const employeeRow = rows.find((r) => `${r.employee_id}` === `${empId}`);
        let employeeMeta = null;
        if (employeeRow) {
            employeeMeta = {
                id: employeeRow.employee_id,
                name: employeeRow.employee_name,
                email: employeeRow.employee_email,
                department: employeeRow.department
            };
        } else {
            const empRecord = db.prepare('SELECT id, name, email, department FROM employees WHERE id = ?').get(empId);
            if (empRecord) {
                employeeMeta = empRecord;
            }
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="assigned-assets-${empId}.pdf"`);

        const assetsForEmp = rows.filter((r) => `${r.employee_id}` === `${empId}`);
        const doc = buildEmployeePdf(
            employeeMeta || { id: empId, name: 'Employee', email: '', department: '' },
            assetsForEmp
        );
        doc.pipe(res);
        doc.end();
        return;
    }

    // Group by employee
    const grouped = rows.reduce((acc, row) => {
        if (!acc.has(row.employee_id)) {
            acc.set(row.employee_id, {
                employee: {
                    id: row.employee_id,
                    name: row.employee_name,
                    email: row.employee_email,
                    department: row.department
                },
                assets: []
            });
        }
        acc.get(row.employee_id).assets.push(row);
        return acc;
    }, new Map());

    if (grouped.size === 0) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="assigned-assets.pdf"');
        const doc = new PDFDocument({ margin: 40 });
        doc.fontSize(14).text('Assigned Assets', { align: 'left' });
        doc.moveDown();
        doc.text('No assigned assets found.');
        doc.pipe(res);
        doc.end();
        return;
    }

    const entries = Array.from(grouped.values());

    // Multiple employees -> zip of PDFs buffered, then sent
    const buildBuffers = entries.map(({ employee, assets }) => {
        return new Promise((resolve) => {
            const doc = buildEmployeePdf(employee, assets);
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => {
                resolve({ employee, buffer: Buffer.concat(chunks) });
            });
            doc.end();
        });
    });

    Promise.all(buildBuffers).then((buffers) => {
        const archive = archiver('zip');
        const output = new PassThrough();
        const zipChunks = [];

        output.on('data', (c) => zipChunks.push(c));
        output.on('end', () => {
            const zipBuffer = Buffer.concat(zipChunks);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="assigned-assets.zip"');
            res.setHeader('Content-Length', zipBuffer.length);
            res.end(zipBuffer);
        });
        output.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        });

        archive.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        });

        archive.pipe(output);
        buffers.forEach(({ employee, buffer }) => {
            archive.append(buffer, { name: `assigned-assets-${employee.id}.pdf` });
        });
        archive.finalize();
    }).catch((err) => {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    });
}

// Export assignments by selected employees (CSV) - POST body
router.post('/export/by-employees', (req, res) => {
    try {
        const { employee_ids = [] } = req.body;
        const ids = Array.isArray(employee_ids) ? employee_ids.filter(Boolean) : [];
        return exportAssignments(res, ids);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Recycle bin listing for assets
router.get('/bin', (req, res) => {
    try {
        const items = db.prepare(`
      SELECT id, entity_id, deleted_at, deleted_by, can_restore_until, payload
      FROM recycle_bin
      WHERE entity_type = 'asset'
      ORDER BY deleted_at DESC
    `).all();

        const mapped = items.map((item) => {
            let payload = {};
            try {
                payload = JSON.parse(item.payload || '{}');
            } catch (e) {
                payload = {};
            }
            return {
                id: item.id,
                entity_id: item.entity_id,
                deleted_at: item.deleted_at,
                deleted_by: item.deleted_by,
                can_restore_until: item.can_restore_until,
                asset_number: payload.asset_number || '',
                name: payload.name || '',
                campus: payload.campus || '',
                status: payload.status || '',
                supplier_name: payload.supplier_name || ''
            };
        });

        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/bin/:id', (req, res) => {
    try {
        const item = db.prepare(`
      SELECT id, entity_id, deleted_at, deleted_by, can_restore_until, payload
      FROM recycle_bin
      WHERE entity_type = 'asset' AND id = ?
    `).get(req.params.id);

        if (!item) {
            return res.status(404).json({ error: 'Recycle bin entry not found' });
        }

        let payload = {};
        try {
            payload = JSON.parse(item.payload || '{}');
        } catch (e) {
            payload = {};
        }

        res.json({ ...item, payload });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export assignments by selected employees (CSV) - GET query
router.get('/export/by-employees', (req, res) => {
    try {
        const ids = [];
        if (req.query.employee_ids) {
            const raw = Array.isArray(req.query.employee_ids) ? req.query.employee_ids : [req.query.employee_ids];
            for (const item of raw) {
                const parts = item.split(',').map(v => v.trim()).filter(Boolean);
                ids.push(...parts);
            }
        }
        return exportAssignments(res, ids);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single asset by ID
router.get('/:id', (req, res) => {
    try {
        const asset = db.prepare(`
      SELECT a.*, c.name as category_name, e.name as employee_name, e.email as employee_email, e.department
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.id = ? AND a.deleted_at IS NULL
    `).get(req.params.id);

        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        // Get asset history
        const history = db.prepare(`
      SELECT ah.*, e.name as employee_name
      FROM asset_history ah
      LEFT JOIN employees e ON ah.employee_id = e.id
      WHERE ah.asset_id = ?
      ORDER BY ah.timestamp DESC
    `).all(req.params.id);

        res.json({ ...asset, history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new asset
router.post('/', (req, res) => {
    try {
        const assetNumber = generateAssetNumber();
        const {
            name,
            category_id,
        model,
        serial_number,
        brand,
        quantity = 1,
        purchase_date,
        purchase_price,
        supplier_name,
        warranty_period_months,
        intune_price,
        status = 'available',
        campus = '',
        location,
        notes
    } = req.body;

        const safeQuantity = Math.max(1, parseInt(quantity, 10) || 1);

        const result = db.prepare(`
      INSERT INTO assets (
        asset_number, name, category_id, model, serial_number, brand, quantity, assigned_quantity,
        purchase_date, purchase_price, supplier_name, warranty_period_months, intune_price, status, campus, location, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            assetNumber, name, category_id, model, serial_number, brand || null, safeQuantity,
            purchase_date, purchase_price, supplier_name, Math.max(0, parseInt(warranty_period_months, 10) || 0), intune_price, status, campus, location, notes
        );

        // Add to history
        db.prepare(`
      INSERT INTO asset_history (asset_id, action, notes)
      VALUES (?, 'created', 'Asset registered in system')
    `).run(result.lastInsertRowid);

        const newAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk import assets (expects parsed Excel/JSON on client)
router.post('/import', (req, res) => {
    try {
        const { items = [], createMissingCategories = true } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items provided for import' });
        }

        const allowedStatuses = ['available', 'assigned', 'maintenance', 'repair', 'damaged', 'lost', 'stolen', 'retired'];
        const categoryCache = new Map();

        function resolveCategoryId(categoryName) {
            const name = categoryName?.trim();
            if (!name) return null;
            if (categoryCache.has(name)) return categoryCache.get(name);

            const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
            if (existing) {
                categoryCache.set(name, existing.id);
                return existing.id;
            }

            if (!createMissingCategories) {
                throw new Error(`Category "${name}" does not exist`);
            }

            const result = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(name, '');
            categoryCache.set(name, result.lastInsertRowid);
            return result.lastInsertRowid;
        }

        const insertStmt = db.prepare(`
      INSERT INTO assets (
        asset_number, name, category_id, model, serial_number, brand, quantity, assigned_quantity,
        purchase_date, purchase_price, supplier_name, warranty_period_months, intune_price, status, campus, location, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const importResult = db.transaction(() => {
            let inserted = 0;
            for (const item of items) {
                const status = allowedStatuses.includes(item.status) ? item.status : 'available';
                const categoryId = resolveCategoryId(item.category);

                const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
                const warrantyMonths = Math.max(0, parseInt(item.warranty_period_months || item.warranty || item['warranty months'] || item['warranty period'], 10) || 0);
                insertStmt.run(
                    generateAssetNumber(),
                    item.name || 'Unnamed Asset',
                    categoryId,
                    item.model || null,
                    item.serial_number || null,
                    item.brand || item.manufacturer || null,
                    qty,
                    item.purchase_date || null,
                    item.purchase_price || null,
                    item.supplier_name || item.supplier || null,
                    warrantyMonths,
                    null, // intune_price removed from input
                    status,
                    item.campus || '',
                    item.location || null,
                    item.notes || null
                );
                inserted += 1;
            }
            return { inserted };
        })();

        res.json({ message: 'Import completed', ...importResult });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update asset
router.put('/:id', (req, res) => {
    try {
        const {
            name,
            category_id,
            model,
            serial_number,
        brand,
        quantity = 1,
        purchase_date,
        purchase_price,
        supplier_name,
        warranty_period_months,
        intune_price,
        status,
        campus = '',
        location,
        notes
    } = req.body;

    const current = db.prepare('SELECT status, assigned_quantity, assigned_to FROM assets WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!current) {
        return res.status(404).json({ error: 'Asset not found' });
        }

        const safeQuantity = Math.max(1, parseInt(quantity, 10) || 1);
        if (safeQuantity < current.assigned_quantity) {
            return res.status(400).json({ error: 'Quantity cannot be lower than currently assigned amount' });
        }

        const unassignStatuses = ['lost', 'stolen', 'damaged', 'repair'];
        const shouldUnassign = unassignStatuses.includes(status) || status !== 'assigned';
        const newAssignedTo = shouldUnassign ? null : current.assigned_to;
        const newAssignedQty = shouldUnassign ? 0 : current.assigned_quantity;
        const statusChanged = current.status !== status;

        db.prepare(`
      UPDATE assets SET
        name = ?, category_id = ?, model = ?, serial_number = ?, brand = ?, quantity = ?,
        purchase_date = ?, purchase_price = ?, supplier_name = ?, warranty_period_months = ?, intune_price = ?,
        status = ?, assigned_to = ?, assigned_quantity = ?, campus = ?, location = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
            name, category_id, model, serial_number, brand || null, safeQuantity,
            purchase_date, purchase_price, supplier_name, Math.max(0, parseInt(warranty_period_months, 10) || 0), intune_price,
            status, newAssignedTo, newAssignedQty, campus, location, notes, req.params.id
        );

        if (statusChanged) {
            const statusNote = shouldUnassign && current.assigned_to
                ? `Status changed from ${current.status} to ${status} (auto-unassigned from employee ID ${current.assigned_to})`
                : `Status changed from ${current.status} to ${status}`;
            db.prepare(`
        INSERT INTO asset_history (asset_id, action, employee_id, notes)
        VALUES (?, 'status_change', ?, ?)
      `).run(req.params.id, current.assigned_to || null, statusNote);
        } else {
            db.prepare(`
        INSERT INTO asset_history (asset_id, action, notes)
        VALUES (?, 'updated', 'Asset information updated')
      `).run(req.params.id);
        }

        const updatedAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        res.json(updatedAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete asset
router.delete('/:id', (req, res) => {
    try {
        if (req.user && req.user.role === 'subadmin') {
            const { count } = db.prepare(`
        SELECT COUNT(*) as count FROM delete_logs
        WHERE user_id = ? AND DATE(timestamp) = DATE('now','localtime')
      `).get(req.user.id);
            if (count >= 100) {
                return res.status(429).json({ error: 'Daily delete limit reached for sub-admin (100 per day)' });
            }
        }

        const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        if (!asset || asset.deleted_at) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const userId = req.user?.id || null;

        const doDelete = db.transaction(() => {
            db.prepare(`
        INSERT INTO recycle_bin (entity_type, entity_id, payload, deleted_at, deleted_by, can_restore_until)
        VALUES ('asset', ?, ?, datetime('now','localtime'), ?, datetime('now','localtime', '+90 days'))
      `).run(asset.id, JSON.stringify(asset), userId);

            db.prepare(`
        UPDATE assets
        SET deleted_at = datetime('now','localtime'), deleted_by = ?
        WHERE id = ?
      `).run(userId, asset.id);

            if (req.user && req.user.role === 'subadmin') {
                db.prepare('INSERT INTO delete_logs (user_id, target_type, target_id) VALUES (?, ?, ?)')
                    .run(req.user.id, 'asset', req.params.id);
            }
        });

        doDelete();

        res.json({ message: 'Asset moved to recycle bin (retained for 90 days)' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Assign asset to employee
router.post('/:id/assign', (req, res) => {
    try {
        const { employee_id, notes, quantity } = req.body;
        if (!employee_id) {
            return res.status(400).json({ error: 'Employee is required for assignment' });
        }
        // The frontend sends the employee id as a string (select value); the DB
        // stores a number. Coerce so the same-employee comparison below works.
        const empId = Number(employee_id);

        const asset = db.prepare('SELECT quantity, assigned_quantity, assigned_to FROM assets WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const requestedQty = Math.max(1, parseInt(quantity, 10) || 1);
        const currentAssigned = Math.max(0, parseInt(asset.assigned_quantity, 10) || 0);
        const available = Math.max(asset.quantity - currentAssigned, 0);

        let newAssignedQty = requestedQty;
        let action = 'assigned';
        let note = notes || `Assigned quantity ${requestedQty}`;

        if (asset.assigned_to && asset.assigned_to === empId) {
            if (requestedQty > available) {
                return res.status(400).json({ error: `Only ${available} available to assign` });
            }
            newAssignedQty = currentAssigned + requestedQty;
            action = 'assigned_more';
            note = notes || `Increased assignment by ${requestedQty} (total ${newAssignedQty})`;
        } else {
            if (requestedQty > asset.quantity) {
                return res.status(400).json({ error: `Cannot assign more than total quantity (${asset.quantity})` });
            }
            action = asset.assigned_to ? 'reassigned' : 'assigned';
            note = asset.assigned_to
                ? notes || `Reassigned from employee ${asset.assigned_to} to ${empId} (qty ${requestedQty})`
                : note;
        }

        // If reassigning to the same employee, allow updating quantity; if to a different employee, move assignment.
        db.prepare(`
      UPDATE assets SET
        assigned_to = ?, status = 'assigned', assigned_quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(empId, newAssignedQty, req.params.id);

        db.prepare(`
      INSERT INTO asset_history (asset_id, action, employee_id, notes)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, action, empId, note);

        const updatedAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        res.json(updatedAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Return asset from employee
router.post('/:id/return', (req, res) => {
    try {
        const { notes } = req.body;
        const asset = db.prepare('SELECT assigned_to FROM assets WHERE id = ? AND deleted_at IS NULL').get(req.params.id);

        db.prepare(`
      UPDATE assets SET
        assigned_to = NULL, status = 'available', assigned_quantity = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

        db.prepare(`
      INSERT INTO asset_history (asset_id, action, employee_id, notes)
      VALUES (?, 'returned', ?, ?)
    `).run(req.params.id, asset.assigned_to, notes || 'Asset returned');

        const updatedAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        res.json(updatedAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Restore asset from recycle bin (password protected)
router.post('/:id/restore', (req, res) => {
    try {
        const { password } = req.body;
        if (!verifyRestoreAccess(password, req.user)) {
            return res.status(403).json({ error: 'Invalid recycle bin password or insufficient permissions' });
        }

        const binItem = db.prepare(`
      SELECT * FROM recycle_bin
      WHERE entity_type = 'asset' AND entity_id = ?
    `).get(req.params.id);

        if (!binItem) {
            return res.status(404).json({ error: 'No recycle bin entry for this asset' });
        }

        const isExpired = db.prepare(`
      SELECT CASE WHEN can_restore_until <= datetime('now','localtime') THEN 1 ELSE 0 END as expired
      FROM recycle_bin WHERE id = ?
    `).get(binItem.id)?.expired;

        if (isExpired) {
            return res.status(410).json({ error: 'Recycle bin entry expired and cannot be restored' });
        }

        let payload = {};
        try {
            payload = JSON.parse(binItem.payload || '{}');
        } catch (e) {
            // fall back to empty payload
        }

        const campus = payload.campus || '';
        const restoreTx = db.transaction(() => {
            db.prepare(`
        UPDATE assets SET
          asset_number = ?, name = ?, category_id = ?, model = ?, serial_number = ?, brand = ?, quantity = ?,
          assigned_quantity = ?, purchase_date = ?, purchase_price = ?, supplier_name = ?, warranty_period_months = ?,
          intune_price = ?, status = ?, assigned_to = ?, campus = ?, location = ?, notes = ?,
          deleted_at = NULL, deleted_by = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
                payload.asset_number,
                payload.name,
                payload.category_id,
                payload.model,
                payload.serial_number,
                payload.brand || null,
                payload.quantity || 1,
                payload.assigned_quantity || 0,
                payload.purchase_date || null,
                payload.purchase_price || null,
                payload.supplier_name || null,
                Math.max(0, parseInt(payload.warranty_period_months, 10) || 0),
                payload.intune_price || null,
                payload.status || 'available',
                payload.assigned_to || null,
                campus,
                payload.location || null,
                payload.notes || null,
                binItem.entity_id
            );

            db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(binItem.id);
        });

        restoreTx();

        const restored = db.prepare('SELECT * FROM assets WHERE id = ?').get(binItem.entity_id);
        res.json({ message: 'Asset restored successfully', asset: restored });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Invoice import: upload a supplier invoice PDF (e.g. Amazon Business),
// extract the line items, and after user review create the assets with the
// invoice attached. Parsing is heuristic — the frontend always shows a
// review/edit step before anything is created.
// ---------------------------------------------------------------------------
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

// Extract text from a PDF, reconstructing visual lines by grouping text
// fragments that share a y-coordinate (invoice tables rely on this).
async function extractPdfText(buffer) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const rows = new Map();
        for (const item of content.items) {
            if (!item.str || !item.str.trim()) continue;
            const y = Math.round(item.transform[5] / 2) * 2; // tolerate tiny baseline jitter
            if (!rows.has(y)) rows.set(y, []);
            rows.get(y).push({ x: item.transform[4], str: item.str });
        }
        const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);
        for (const [, parts] of ordered) {
            text += parts.sort((a, b) => a.x - b.x).map((t) => t.str).join(' ') + '\n';
        }
    }
    return { text, numpages: doc.numPages };
}

const invoiceUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) =>
            cb(null, `invoice-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') return cb(null, true);
        cb(new Error('Invoices must be PDF files'));
    }
});

const CATEGORY_RULES = [
    [/laptop|notebook|elitebook|thinkpad|ideapad|vivobook|macbook|chromebook|zbook|latitude|inspiron/i, 'Laptop'],
    [/\bmonitor\b|(\d{2}["”]?\s*(inch)?\s*(led|lcd|ips).*(screen|display))/i, 'Monitor'],
    [/\btablet\b|ipad|surface go/i, 'Tablet'],
    [/printer|toner|ink cartridge/i, 'Printer'],
    [/mouse|keyboard|headset|headphone|earbud|webcam|speaker|microphone/i, 'Peripheral'],
    [/cable|adapter|charger|\bhub\b|dock|usb[- ]?c|hdmi|power supply|extension lead|surge/i, 'Accessory'],
    [/router|switch|access point|ethernet|wi-?fi extender/i, 'Network'],
    [/\bssd\b|\bram\b|hard drive|\bhdd\b|memory card|\busb stick\b|flash drive/i, 'Storage & Components'],
    [/phone|iphone|galaxy s|pixel \d/i, 'Phone']
];

const KNOWN_BRANDS = [
    'Amazon Basics', 'HP', 'Dell', 'Lenovo', 'Apple', 'Microsoft', 'Samsung', 'Asus', 'Acer', 'Logitech',
    'Anker', 'Ugreen', 'Belkin', 'Kensington', 'TP-Link', 'Netgear', 'Cisco', 'Canon',
    'Epson', 'Brother', 'Jabra', 'Sony', 'LG', 'Philips', 'Sandisk', 'Kingston', 'Crucial',
    'Seagate', 'Toshiba', 'Duracell', 'Trust', 'Targus'
];

function guessCategoryAndBrand(name) {
    let category = 'Electronics';
    for (const [re, cat] of CATEGORY_RULES) {
        if (re.test(name)) { category = cat; break; }
    }
    const lower = name.toLowerCase();
    const brand = KNOWN_BRANDS.find((b) => lower.includes(b.toLowerCase())) || '';
    return { category, brand };
}

// Best-effort extraction of item lines from invoice text: a line qualifies if
// it carries a price and isn't a totals/header/address line. The user reviews
// and corrects everything before import.
function parseInvoiceItems(text) {
    const lines = String(text || '')
        .split(/\n+/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const skip = /sub-?total|grand total|^total|total\b.*£|vat|tax|shipping|postage|delivery|promotion|discount|gift|invoice|receipt|order (number|#|id|date|total)|payment|billing|dispatch|address|amazon\.(co|com|de|eu)|www\.amazon|amazon (eu|services|payments)|sold by|supplied by|thank you|balance|account|page \d|qty unit|unit price|item price|description price|£?\d+\.\d{2} £?\d+\.\d{2} £?\d+\.\d{2} £?\d+\.\d{2}/i;
    const priceToken = /(?:£\s?)?(\d{1,3}(?:,\d{3})*\.\d{2})(?:\s*(?:GBP|EUR|USD))?/g;

    const items = [];
    for (const line of lines) {
        if (skip.test(line)) continue;
        const prices = [...line.matchAll(priceToken)].map((m) => parseFloat(m[1].replace(/,/g, '')));
        if (!prices.length) continue;

        let name = line.replace(priceToken, ' ').replace(/\s+/g, ' ').trim();
        let quantity = 1;
        const qm = name.match(/^(\d{1,2})\s*(?:x\s+)?(.+)$/i);
        if (qm) {
            quantity = Math.max(1, parseInt(qm[1], 10));
            name = qm[2];
        }
        name = name.replace(/[|,;:\-–—]+$/, '').replace(/^[|,;:\-–—]+/, '').trim();
        if (name.length < 4 || !/[a-zA-Z]{3}/.test(name)) continue;

        // With "unit price ... line total" columns the unit price is the smaller.
        const unit_price = Math.min(...prices);
        items.push({
            name: name.slice(0, 150),
            quantity,
            unit_price,
            ...guessCategoryAndBrand(name)
        });
    }

    // Collapse exact duplicates (same name + price) by summing quantities.
    const merged = new Map();
    for (const it of items) {
        const key = `${it.name.toLowerCase()}|${it.unit_price}`;
        if (merged.has(key)) merged.get(key).quantity += it.quantity;
        else merged.set(key, { ...it });
    }
    return [...merged.values()];
}

router.post('/parse-invoice', (req, res) => {
    invoiceUpload.single('file')(req, res, async (err) => {
        try {
            if (err) return res.status(400).json({ error: err.message });
            if (!req.file) return res.status(400).json({ error: 'No file provided' });

            const data = await extractPdfText(fs.readFileSync(req.file.path));
            const items = parseInvoiceItems(data.text);

            res.json({
                items,
                file_token: req.file.filename,
                file_name: req.file.originalname,
                pages: data.numpages
            });
        } catch (error) {
            if (req.file) fs.unlink(req.file.path, () => {});
            res.status(400).json({ error: 'Could not read that PDF: ' + error.message });
        }
    });
});

router.post('/import-invoice', (req, res) => {
    try {
        const { items, file_token, file_name } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items to import' });
        }

        // The invoice PDF was stashed by /parse-invoice; validate the token.
        let storedFile = null;
        if (file_token) {
            const safe = path.basename(String(file_token));
            if (/^invoice-[\w.-]+\.pdf$/.test(safe) && fs.existsSync(path.join(UPLOAD_DIR, safe))) {
                storedFile = safe;
            }
        }

        const catId = (name) => {
            const clean = (name || 'Electronics').trim() || 'Electronics';
            const row = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(clean);
            if (row) return row.id;
            return db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(clean, '').lastInsertRowid;
        };

        const created = [];
        db.transaction(() => {
            for (const it of items) {
                const name = String(it.name || '').trim();
                if (!name) continue;
                const quantity = Math.min(999, Math.max(1, parseInt(it.quantity, 10) || 1));
                const price = it.unit_price === '' || it.unit_price == null ? null : Math.max(0, parseFloat(it.unit_price) || 0);
                const assetNumber = generateAssetNumber();
                const result = db.prepare(`
          INSERT INTO assets (
            asset_number, name, category_id, brand, model, serial_number, quantity, assigned_quantity,
            purchase_date, purchase_price, status, campus, notes
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, 'available', '', ?)
        `).run(
                    assetNumber, name.slice(0, 150), catId(it.category),
                    (it.brand || '').trim() || null, (it.model || '').trim() || null,
                    quantity, it.purchase_date || null, price,
                    `Imported from invoice${file_name ? ` "${file_name}"` : ''}`
                );

                if (storedFile) {
                    db.prepare(`
            INSERT INTO asset_documents (asset_id, stored_name, original_name, mimetype, size, uploaded_by)
            VALUES (?, ?, ?, 'application/pdf', ?, ?)
          `).run(result.lastInsertRowid, storedFile, file_name || 'invoice.pdf',
                        fs.statSync(path.join(UPLOAD_DIR, storedFile)).size, req.user?.id || null);
                }
                created.push({ id: result.lastInsertRowid, asset_number: assetNumber, name, quantity, purchase_price: price });
            }
        })();

        logActivity(req, {
            action: 'invoice_imported', entity_type: 'asset', entity_id: null,
            description: `Imported ${created.length} item(s) from invoice${file_name ? ` "${file_name}"` : ''}`
        });

        res.status(201).json({ message: `Imported ${created.length} item(s)`, created });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Asset documents: list / upload / download / delete
// ---------------------------------------------------------------------------
router.get('/:id/documents', (req, res) => {
    try {
        const docs = db.prepare(`
      SELECT d.id, d.original_name, d.mimetype, d.size, d.uploaded_at, u.email as uploaded_by_email
      FROM asset_documents d
      LEFT JOIN users u ON d.uploaded_by = u.id
      WHERE d.asset_id = ?
      ORDER BY d.uploaded_at DESC, d.id DESC
    `).all(req.params.id);
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/documents', (req, res) => {
    upload.single('file')(req, res, (err) => {
        try {
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            if (!req.file) {
                return res.status(400).json({ error: 'No file provided' });
            }
            const asset = db.prepare('SELECT id, asset_number, name FROM assets WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
            if (!asset) {
                fs.unlink(req.file.path, () => {});
                return res.status(404).json({ error: 'Asset not found' });
            }

            const result = db.prepare(`
        INSERT INTO asset_documents (asset_id, stored_name, original_name, mimetype, size, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(asset.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user?.id || null);

            logActivity(req, {
                action: 'document_uploaded', entity_type: 'asset', entity_id: asset.id,
                description: `Attached "${req.file.originalname}" to ${asset.asset_number} (${asset.name})`
            });

            const doc = db.prepare('SELECT id, original_name, mimetype, size, uploaded_at FROM asset_documents WHERE id = ?').get(result.lastInsertRowid);
            res.status(201).json(doc);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
});

router.get('/:id/documents/:docId/download', (req, res) => {
    try {
        const doc = db.prepare('SELECT * FROM asset_documents WHERE id = ? AND asset_id = ?').get(req.params.docId, req.params.id);
        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }
        const filePath = path.join(UPLOAD_DIR, doc.stored_name);
        if (!fs.existsSync(filePath)) {
            return res.status(410).json({ error: 'File is missing from storage' });
        }
        // Images and PDFs open inline in the browser; everything else downloads.
        res.setHeader('Content-Type', doc.mimetype || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${doc.original_name.replace(/"/g, '')}"`);
        fs.createReadStream(filePath).pipe(res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id/documents/:docId', (req, res) => {
    try {
        const doc = db.prepare('SELECT * FROM asset_documents WHERE id = ? AND asset_id = ?').get(req.params.docId, req.params.id);
        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }
        db.prepare('DELETE FROM asset_documents WHERE id = ?').run(doc.id);
        // Invoice imports share one stored PDF across several assets — only
        // remove the file from disk when no other document row references it.
        const stillReferenced = db.prepare(
            'SELECT COUNT(*) as c FROM asset_documents WHERE stored_name = ?'
        ).get(doc.stored_name).c;
        if (!stillReferenced) {
            fs.unlink(path.join(UPLOAD_DIR, doc.stored_name), () => {});
        }
        logActivity(req, {
            action: 'document_deleted', entity_type: 'asset', entity_id: Number(req.params.id),
            description: `Removed document "${doc.original_name}"`
        });
        res.json({ message: 'Document deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

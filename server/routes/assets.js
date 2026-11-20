const express = require('express');
const router = express.Router();
const db = require('../database');
const { generateAssetNumber } = require('../utils/assetNumber');
const { logActivity } = require('../utils/activity');
const assignments = require('../services/assignments');
const mailer = require('../services/mailer');
const sharepoint = require('../services/sharepoint');
const { getSettings } = require('../services/appSettings');
const tidy = require('../services/tidy');
const sales = require('../services/sales');
const cells = require('../utils/importValues');
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

// Everyone (and every room) currently holding an asset, as one display string.
const HOLDERS_SQL = `(
      SELECT GROUP_CONCAT(COALESCE(he.name, x.location_label), ', ')
      FROM asset_assignments x LEFT JOIN employees he ON x.employee_id = he.id
      WHERE x.asset_id = a.id AND x.returned_at IS NULL
    )`;
const HOLDER_COUNT_SQL = '(SELECT COUNT(*) FROM asset_assignments x WHERE x.asset_id = a.id AND x.returned_at IS NULL)';

// Send an email about an asset without letting a mail problem fail the
// action that triggered it. Resolves with the outcome for the UI to show.
async function notify(templateKey, asset, employee, extra, req) {
    if (!employee) return { status: 'no_recipient' };
    return mailer.sendTemplate(templateKey, {
        to: employee.email,
        context: mailer.assetContext(asset, { employee, user: req.user, ...extra }),
        entity: { type: 'asset', id: asset.id },
        user: req.user
    });
}

function handleError(res, error) {
    res.status(error.status || 500).json({ error: error.message });
}

// Get all assets with optional filtering
router.get('/', (req, res) => {
    try {
        const { status, category, search, supplier, campus, model, brand } = req.query;
        let query = `
      SELECT a.*, c.name as category_name, e.name as employee_name, e.email as employee_email,
             ${HOLDERS_SQL} as holders, ${HOLDER_COUNT_SQL} as holder_count,
             (SELECT s.buyer_name FROM asset_sales s WHERE s.asset_id = a.id AND s.cancelled_at IS NULL ORDER BY s.id DESC LIMIT 1) as sold_to
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.deleted_at IS NULL
    `;
        const params = [];

        // "assigned" / "available" follow the stock actually out or in hand, so
        // partly-assigned bulk items show up under both.
        if (status === 'assigned') {
            query += ' AND a.assigned_quantity > 0';
        } else if (status === 'available') {
            query += " AND a.status IN ('available', 'assigned') AND a.quantity > COALESCE(a.assigned_quantity, 0)";
        } else if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        }

        if (category === '__none__') {
            query += ' AND a.category_id IS NULL';
        } else if (category) {
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

        if (campus === '__unassigned__') {
            query += " AND TRIM(COALESCE(a.campus, '')) = ''";
        } else if (campus) {
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
            query += ` AND (a.name LIKE ? OR a.asset_number LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ?
              OR EXISTS (
                SELECT 1 FROM asset_assignments x LEFT JOIN employees he ON x.employee_id = he.id
                WHERE x.asset_id = a.id AND x.returned_at IS NULL
                  AND (he.name LIKE ? OR x.location_label LIKE ?)
              ))`;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
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
             c.name as category, ${HOLDERS_SQL} as assigned_to, e.email as assigned_email, a.created_at as date_added
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
             c.name as category, ${HOLDERS_SQL} as assigned_to, e.email as assigned_email, a.created_at as date_added
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
             c.name as category, ${HOLDERS_SQL} as assigned_to, e.email as assigned_email, a.created_at as date_added
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
             c.name as category, ${HOLDERS_SQL} as assigned_to, e.email as assigned_email, a.created_at as date_added
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
             a.asset_number, a.name as asset_name, a.model, a.serial_number, a.quantity, x.quantity as assigned_quantity,
             a.status, c.name as category, a.location
      FROM asset_assignments x
      JOIN assets a ON x.asset_id = a.id
      JOIN employees e ON x.employee_id = e.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE x.returned_at IS NULL AND a.deleted_at IS NULL
    `;
    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        query += ` AND x.employee_id IN (${placeholders})`;
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

// A scanned sticker carries the asset's link (…/s/AST-2026-0001); handheld
// scanners and older stickers give the bare number. Accept either, and a
// serial number typed by hand.
function codeFromScan(raw) {
    let code = String(raw || '').trim();
    if (/^https?:\/\//i.test(code)) {
        try {
            const segments = new URL(code).pathname.split('/').filter(Boolean);
            code = decodeURIComponent(segments[segments.length - 1] || '');
        } catch (err) {
            // not a URL after all — use the text as scanned
        }
    }
    return code.trim();
}

// Find an asset from a scanned or typed code
router.get('/lookup', (req, res) => {
    try {
        const code = codeFromScan(req.query.code);
        if (!code) {
            return res.status(400).json({ error: 'Scan or type an asset number' });
        }
        const asset = db.prepare(`
      SELECT id, asset_number FROM assets
      WHERE deleted_at IS NULL AND (
        UPPER(asset_number) = UPPER(?)
        OR (serial_number IS NOT NULL AND TRIM(serial_number) <> '' AND UPPER(TRIM(serial_number)) = UPPER(?))
      )
      ORDER BY CASE WHEN UPPER(asset_number) = UPPER(?) THEN 0 ELSE 1 END
      LIMIT 1
    `).get(code, code, code);
        if (!asset) {
            return res.status(404).json({ error: `No asset found for "${code}"`, code });
        }
        res.json(asset);
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
      ORDER BY ah.timestamp DESC, ah.id DESC
    `).all(req.params.id);

        res.json({
            ...asset,
            assignments: assignments.openAssignments(asset.id),
            previous_holders: assignments.closedAssignments(asset.id),
            sale: sales.activeSale(asset.id),
            history
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new asset
router.post('/', async (req, res) => {
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
        // Whatever was left blank is worked out from the name: the category,
        // the brand, and the home campus for electronics with no campus.
        // The form normally sends a category; when one is missing (or the
        // brand is), ask for a suggestion. This never fails the save.
        const needsGuess = !category_id || !String(brand || '').trim();
        const [guess] = needsGuess ? await tidy.suggestForNew([{ name, model, brand }], { timeout: 8000 }) : [];
        const filled = tidy.defaultsForNew({ name, model, brand, category_id, campus }, guess ? { guess } : {});

        const result = db.prepare(`
      INSERT INTO assets (
        asset_number, name, category_id, model, serial_number, brand, quantity, assigned_quantity,
        purchase_date, purchase_price, supplier_name, warranty_period_months, intune_price, status, campus, location, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            assetNumber, name, filled.category_id, model, serial_number, filled.brand, safeQuantity,
            purchase_date, purchase_price, supplier_name, Math.max(0, parseInt(warranty_period_months, 10) || 0), intune_price, status, filled.campus, location, notes
        );

        // Add to history
        db.prepare(`
      INSERT INTO asset_history (asset_id, action, notes, performed_by)
      VALUES (?, 'created', 'Asset registered in system', ?)
    `).run(result.lastInsertRowid, req.user?.email || null);

        const newAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
        tidy.rememberAi(newAsset.id, newAsset, filled.ai_answer);
        sharepoint.enqueue(newAsset.id);
        res.status(201).json(newAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk import assets (expects parsed Excel/JSON on client)
router.post('/import', async (req, res) => {
    try {
        const { items: sheetRows = [], createMissingCategories = true, date1904 = false } = req.body || {};
        if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
            return res.status(400).json({ error: 'No items provided for import' });
        }

        // A spreadsheet cell can hold anything: a serial number typed as a
        // number, a real Excel date, TRUE/FALSE. Settle every value into what
        // its column stores before anything else looks at it.
        let unreadDates = 0;
        const number = (value) => (typeof value === 'number' || typeof value === 'string' ? value : undefined);
        const items = sheetRows.map((row) => {
            const cell = row && typeof row === 'object' ? row : {};
            const purchased = cells.date(cell.purchase_date, { date1904: Boolean(date1904) });
            if (!purchased.ok) unreadDates += 1;
            return {
                name: cells.text(cell.name, 300),
                category: cells.text(cell.category, 100),
                brand: cells.text(cell.brand, 100) || cells.text(cell.manufacturer, 100),
                model: cells.text(cell.model, 300),
                serial_number: cells.text(cell.serial_number, 200),
                quantity: number(cell.quantity),
                purchase_date: purchased.date,
                purchase_price: cells.money(cell.purchase_price),
                supplier_name: cells.text(cell.supplier_name, 200) || cells.text(cell.supplier, 200),
                warranty_period_months: number(cell.warranty_period_months) ?? number(cell.warranty)
                    ?? number(cell['warranty months']) ?? number(cell['warranty period']),
                status: (cells.text(cell.status, 30) || '').toLowerCase(),
                campus: cells.text(cell.campus, 100),
                location: cells.text(cell.location, 200),
                notes: cells.text(cell.notes, 5000)
            };
        });

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const insertedIds = [];
        // One round of suggestions for the whole sheet, before anything is
        // written: rows with no category or brand are worked out from the name.
        const guesses = await tidy.suggestForNew(items.map((item) => {
            const brand = item.brand || item.manufacturer;
            return {
                name: item.name, model: item.model, brand,
                ask: !(String(item.category || '').trim() && String(brand || '').trim())
            };
        }));
        const aiAnswers = [];
        const importResult = db.transaction(() => {
            let inserted = 0;
            for (const [index, item] of items.entries()) {
                // An imported row has no holder yet, so "assigned" becomes available.
                const status = allowedStatuses.includes(item.status) && item.status !== 'assigned' ? item.status : 'available';
                // A row with no category is categorised from its name; a
                // blank brand or campus is filled in the same way.
                const filled = tidy.defaultsForNew({
                    name: item.name,
                    model: item.model,
                    brand: item.brand || item.manufacturer,
                    category_id: resolveCategoryId(item.category),
                    campus: item.campus
                }, { guess: guesses[index] });
                const categoryId = filled.category_id;

                const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
                const warrantyMonths = Math.max(0, parseInt(item.warranty_period_months || item.warranty || item['warranty months'] || item['warranty period'], 10) || 0);
                const inserted_row = insertStmt.run(
                    generateAssetNumber(),
                    item.name || 'Unnamed Asset',
                    categoryId,
                    item.model || null,
                    item.serial_number || null,
                    filled.brand,
                    qty,
                    item.purchase_date,
                    item.purchase_price,
                    item.supplier_name,
                    warrantyMonths,
                    null, // intune_price removed from input
                    status,
                    filled.campus,
                    item.location || null,
                    item.notes || null
                );
                insertedIds.push(inserted_row.lastInsertRowid);
                aiAnswers.push([inserted_row.lastInsertRowid, item, filled.ai_answer]);
                inserted += 1;
            }
            aiAnswers.forEach(([id, item, answer]) => tidy.rememberAi(id, item, answer));
            return { inserted };
        })();

        insertedIds.forEach((id) => sharepoint.enqueue(id));
        // Dates that could not be read are left blank rather than stored as
        // they came; say how many so they can be put right by hand.
        res.json({ message: 'Import completed', ...importResult, unread_dates: unreadDates });
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

        const current = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
        if (!current) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const safeQuantity = Math.max(1, parseInt(quantity, 10) || 1);
        const requestedStatus = assignments.ALL_STATUSES.includes(status) ? status : current.status;
        // "Sold" goes with a record of who bought it, so it is set and
        // cleared by the sale actions, never by editing the status.
        if (requestedStatus === 'sold' && current.status !== 'sold') {
            return res.status(400).json({ error: 'To mark this as sold, use "Sell" on the asset\'s page so the buyer and price are recorded.' });
        }
        if (current.status === 'sold' && requestedStatus !== 'sold') {
            return res.status(400).json({ error: 'This asset has been sold. Undo the sale on the asset\'s page before changing its status.' });
        }
        const outOfService = assignments.OUT_OF_SERVICE_STATUSES.includes(requestedStatus);
        // Taking an item out of service — or explicitly flipping an assigned
        // item back to available — returns it from whoever holds it.
        const releaseHolders = outOfService || (requestedStatus === 'available' && current.status === 'assigned');

        if (!releaseHolders && safeQuantity < current.assigned_quantity) {
            return res.status(400).json({ error: 'Quantity cannot be lower than currently assigned amount' });
        }

        const released = db.transaction(() => {
            const closed = releaseHolders ? assignments.closeAll(current.id, req.user?.id, 'status_change') : [];

            db.prepare(`
        UPDATE assets SET
          name = ?, category_id = ?, model = ?, serial_number = ?, brand = ?, quantity = ?,
          purchase_date = ?, purchase_price = ?, supplier_name = ?, warranty_period_months = ?, intune_price = ?,
          status = ?, campus = ?, location = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
                name, category_id, model, serial_number, brand || null, safeQuantity,
                purchase_date, purchase_price, supplier_name, Math.max(0, parseInt(warranty_period_months, 10) || 0), intune_price,
                // available / assigned are worked out from the assignments below
                outOfService ? requestedStatus : current.status, campus, location, notes, current.id
            );
            if (!outOfService && assignments.OUT_OF_SERVICE_STATUSES.includes(current.status)) {
                // back in service
                db.prepare("UPDATE assets SET status = 'available' WHERE id = ?").run(current.id);
            }
            assignments.syncAssetSummary(current.id);

            const after = db.prepare('SELECT status, campus, location FROM assets WHERE id = ?').get(current.id);
            if (after.status !== current.status) {
                const holders = closed.map(assignments.holderLabel).join(', ');
                db.prepare(`
          INSERT INTO asset_history (asset_id, action, employee_id, notes, performed_by)
          VALUES (?, 'status_change', ?, ?, ?)
        `).run(current.id, closed.length === 1 ? closed[0].employee_id : null,
                    `Status changed from ${current.status} to ${after.status}${holders ? ` (returned from ${holders})` : ''}`, req.user?.email || null);
            } else {
                db.prepare(`
          INSERT INTO asset_history (asset_id, action, notes, performed_by)
          VALUES (?, 'updated', 'Asset information updated', ?)
        `).run(current.id, req.user?.email || null);
            }
            if ((after.campus || '') !== (current.campus || '')) {
                db.prepare(`
          INSERT INTO asset_history (asset_id, action, notes, performed_by)
          VALUES (?, 'transferred', ?, ?)
        `).run(current.id, `Campus changed from ${current.campus || 'Unassigned'} to ${after.campus || 'Unassigned'}`, req.user?.email || null);
            }
            return closed;
        })();

        if (released.length > 0) {
            logActivity(req, {
                action: 'asset_returned', entity_type: 'asset', entity_id: current.id,
                description: `${current.asset_number} set to ${requestedStatus}; returned from ${released.map(assignments.holderLabel).join(', ')}`
            });
        }

        sharepoint.enqueue(current.id);
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
        if (asset.assigned_quantity > 0) {
            return res.status(400).json({ error: 'This asset is still assigned — return it before deleting' });
        }

        const userId = req.user?.id || null;

        const doDelete = db.transaction(() => {
            // Kept indefinitely: nothing purges the bin. can_restore_until is a
            // leftover NOT NULL column from the old 90-day rule and is ignored.
            db.prepare(`
        INSERT INTO recycle_bin (entity_type, entity_id, payload, deleted_at, deleted_by, can_restore_until)
        VALUES ('asset', ?, ?, datetime('now','localtime'), ?, '9999-12-31 00:00:00')
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
            assignments.addHistory(asset.id, 'deleted', null, 'Moved to the recycle bin', req.user);
        });

        doDelete();
        sharepoint.enqueue(asset.id);

        res.json({ message: 'Asset moved to the recycle bin. Its history is kept and it can be restored at any time.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Assign available stock to a person or a room
router.post('/:id/assign', async (req, res) => {
    try {
        const result = assignments.assign(req.params.id, req.body, req.user);
        const { asset, holder, quantity } = result;

        logActivity(req, {
            action: 'asset_assigned', entity_type: 'asset', entity_id: asset.id,
            description: `Assigned ${asset.asset_number} (${asset.name})${asset.quantity > 1 ? ` × ${quantity}` : ''} to ${holder.label}`
        });
        sharepoint.enqueue(asset.id);

        const wantsEmail = req.body.send_email === undefined ? getSettings().mail_on_assign : Boolean(req.body.send_email);
        const email = wantsEmail && holder.employee
            ? await notify('asset_assigned', asset, holder.employee, { quantity, notes: req.body.notes }, req)
            : null;

        res.json({ ...asset, email });
    } catch (error) {
        handleError(res, error);
    }
});

// IT confirms that a holder has what is assigned to them (one line)
router.post('/:id/assignments/:assignmentId/confirm', (req, res) => {
    try {
        const open = assignments.openAssignments(req.params.id).find((row) => row.id === Number(req.params.assignmentId));
        if (!open) {
            return res.status(404).json({ error: 'That assignment is no longer open' });
        }
        const confirmed = assignments.confirmByStaff({ assignmentId: open.id }, req.user);
        for (const row of confirmed) {
            logActivity(req, {
                action: 'asset_confirmed', entity_type: 'asset', entity_id: row.asset_id,
                description: `Confirmed ${row.asset_number} (${row.asset_name}) is with ${assignments.holderLabel(row)}`
            });
        }
        res.json({ confirmed: confirmed.length });
    } catch (error) {
        handleError(res, error);
    }
});

// Return stock from a holder
router.post('/:id/return', async (req, res) => {
    try {
        const result = assignments.giveBack(req.params.id, req.body || {}, req.user);
        const { asset, previous, quantity, condition } = result;
        const from = assignments.holderLabel(previous);

        logActivity(req, {
            action: 'asset_returned', entity_type: 'asset', entity_id: asset.id,
            description: `Returned ${asset.asset_number} (${asset.name})${asset.quantity > 1 ? ` × ${quantity}` : ''} from ${from}${condition !== 'good' ? ` — ${condition.replace('_', ' ')}` : ''}`
        });
        sharepoint.enqueue(asset.id);

        const wantsEmail = req.body?.send_email === undefined ? getSettings().mail_on_return : Boolean(req.body.send_email);
        const email = wantsEmail && previous.employee_id
            ? await notify('asset_returned', asset,
                { name: previous.employee_name, email: previous.employee_email, department: previous.department },
                { quantity, condition, notes: req.body?.notes }, req)
            : null;

        res.json({ ...asset, email });
    } catch (error) {
        handleError(res, error);
    }
});

// Sell the asset, usually to the person who has been using it. It stays on
// record as "sold"; whoever held it is booked as having handed it back.
router.post('/:id/sell', async (req, res) => {
    try {
        const { asset, sale, buyer, previous } = sales.sell(req.params.id, req.body || {}, req.user);
        logActivity(req, {
            action: 'asset_sold', entity_type: 'asset', entity_id: asset.id,
            description: `Sold ${asset.asset_number} (${asset.name}) to ${buyer.name} for ${sales.money(sale.price)}`
                + (previous.length ? `; was with ${previous.map(assignments.holderLabel).join(', ')}` : '')
        });
        sharepoint.enqueue(asset.id);

        const email = req.body?.send_email && buyer.email
            ? await mailer.sendTemplate('asset_sold', {
                to: buyer.email,
                context: {
                    ...mailer.assetContext(asset, { employee: buyer, user: req.user, notes: sale.notes }),
                    price: sales.money(sale.price),
                    sale_date: new Date(`${sale.sold_on}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
                    payment_reference: sale.payment_reference || ''
                },
                entity: { type: 'asset', id: asset.id },
                user: req.user
            })
            : null;

        res.json({ ...asset, sale, email });
    } catch (error) {
        handleError(res, error);
    }
});

// Undo a sale recorded by mistake: the asset goes back into stock.
router.post('/:id/sale/undo', (req, res) => {
    try {
        const { asset, sale } = sales.undo(req.params.id, req.body || {}, req.user);
        logActivity(req, {
            action: 'asset_sale_undone', entity_type: 'asset', entity_id: asset.id,
            description: `Undid the sale of ${asset.asset_number} (${asset.name}) to ${sale.buyer_name}`
        });
        sharepoint.enqueue(asset.id);
        res.json(asset);
    } catch (error) {
        handleError(res, error);
    }
});

// Move stock directly from one holder to another
router.post('/:id/reassign', async (req, res) => {
    try {
        const result = assignments.reassign(req.params.id, req.body, req.user);
        const { asset, previous, holder, quantity } = result;
        const from = assignments.holderLabel(previous);

        logActivity(req, {
            action: 'asset_reassigned', entity_type: 'asset', entity_id: asset.id,
            description: `Reassigned ${asset.asset_number} (${asset.name})${asset.quantity > 1 ? ` × ${quantity}` : ''} from ${from} to ${holder.label}`
        });
        sharepoint.enqueue(asset.id);

        const wantsEmail = req.body.send_email === undefined ? getSettings().mail_on_assign : Boolean(req.body.send_email);
        let email = null;
        let previous_email = null;
        if (wantsEmail) {
            const extra = { quantity, previousHolder: from, newHolder: holder.label, notes: req.body.notes };
            [email, previous_email] = await Promise.all([
                holder.employee ? notify('asset_assigned', asset, holder.employee, extra, req) : null,
                previous.employee_id
                    ? notify('asset_handed_over', asset,
                        { name: previous.employee_name, email: previous.employee_email, department: previous.department },
                        extra, req)
                    : null
            ]);
        }

        res.json({ ...asset, email, previous_email });
    } catch (error) {
        handleError(res, error);
    }
});

// Move an asset to another campus / location
router.post('/:id/transfer', (req, res) => {
    try {
        const { asset, from, to } = assignments.transfer(req.params.id, req.body || {}, req.user);
        logActivity(req, {
            action: 'asset_transferred', entity_type: 'asset', entity_id: asset.id,
            description: `Moved ${asset.asset_number} (${asset.name}) from ${from} to ${to}`
        });
        sharepoint.enqueue(asset.id);
        res.json(asset);
    } catch (error) {
        handleError(res, error);
    }
});

// Move several assets to a campus in one go (typically the ones that were
// never given a campus). Who holds each item is unaffected. Every asset gets
// its own history entry; anything already at that campus is left alone.
router.post('/bulk-transfer', (req, res) => {
    try {
        const { ids, campus, location, notes } = req.body || {};
        const assetIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
        const targetCampus = String(campus || '').trim();
        if (assetIds.length === 0) {
            return res.status(400).json({ error: 'Select at least one asset to move' });
        }
        if (assetIds.length > 1000) {
            return res.status(400).json({ error: 'Move at most 1000 assets at a time' });
        }
        if (!targetCampus) {
            return res.status(400).json({ error: 'Choose the campus to move them to' });
        }

        // Only change the room when one was typed; otherwise each keeps its own.
        const body = { campus: targetCampus.slice(0, 80), notes: String(notes || '').trim() || undefined };
        const room = String(location || '').trim();
        if (room) body.location = room.slice(0, 120);

        const moved = [];
        const skipped = [];
        db.transaction(() => {
            for (const id of assetIds) {
                try {
                    const { asset } = assignments.transfer(id, body, req.user);
                    moved.push(asset);
                } catch (err) {
                    if (!(err instanceof assignments.AssignmentError)) throw err;
                    skipped.push({ id, reason: err.message });
                }
            }
        })();

        if (moved.length > 0) {
            const numbers = moved.map((a) => a.asset_number);
            const listed = numbers.length > 12 ? `${numbers.slice(0, 12).join(', ')} and ${numbers.length - 12} more` : numbers.join(', ');
            logActivity(req, {
                action: 'assets_bulk_transferred', entity_type: 'asset', entity_id: null,
                description: `Moved ${moved.length} asset${moved.length === 1 ? '' : 's'} to ${body.campus}${body.location ? ` / ${body.location}` : ''}: ${listed}`
            });
            moved.forEach((a) => sharepoint.enqueue(a.id));
        }

        res.json({ moved: moved.length, skipped, campus: body.campus });
    } catch (error) {
        handleError(res, error);
    }
});

// Email a holder about an asset on demand (return request, maintenance…)
router.post('/:id/email', async (req, res) => {
    try {
        const { template, assignment_id } = req.body || {};
        const allowed = ['asset_assigned', 'asset_return_request', 'asset_maintenance'];
        if (!allowed.includes(template)) {
            return res.status(400).json({ error: 'Unknown email type' });
        }
        const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        const open = assignments.openAssignments(asset.id).filter((row) => row.employee_id);
        const row = assignment_id ? open.find((r) => r.id === Number(assignment_id)) : open[0];
        if (!row) {
            return res.status(400).json({ error: 'This asset is not assigned to a member of staff' });
        }
        const employee = { name: row.employee_name, email: row.employee_email, department: row.department };
        const context = mailer.assetContext(asset, { employee, quantity: row.quantity, user: req.user });

        // Without a configured mailbox the client opens the user's own mail
        // app instead, using the same (editable) wording.
        if (!mailer.mailStatus().configured) {
            return res.json({ status: 'not_configured', to: employee.email, ...mailer.render(template, context) });
        }
        const result = await mailer.sendTemplate(template, {
            to: employee.email, context, entity: { type: 'asset', id: asset.id }, user: req.user
        });
        if (result.status === 'sent') {
            logActivity(req, {
                action: 'email_sent', entity_type: 'asset', entity_id: asset.id,
                description: `Emailed ${employee.email} about ${asset.asset_number} (${mailer.getTemplate(template).name})`
            });
        }
        res.json(result);
    } catch (error) {
        handleError(res, error);
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
          purchase_date = ?, purchase_price = ?, supplier_name = ?, warranty_period_months = ?,
          intune_price = ?, status = ?, campus = ?, location = ?, notes = ?,
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
                payload.purchase_date || null,
                payload.purchase_price || null,
                payload.supplier_name || null,
                Math.max(0, parseInt(payload.warranty_period_months, 10) || 0),
                payload.intune_price || null,
                payload.status || 'available',
                campus,
                payload.location || null,
                payload.notes || null,
                binItem.entity_id
            );
            // Who holds it is read back from the assignment records, which a
            // delete never touches.
            assignments.syncAssetSummary(binItem.entity_id);
            assignments.addHistory(binItem.entity_id, 'restored', null, 'Restored from the recycle bin', req.user);

            db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(binItem.id);
        });

        restoreTx();
        sharepoint.enqueue(binItem.entity_id);

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
// pdf.js ships as an ES module, so it is loaded on first use (the "legacy"
// build is the one meant for Node). Pinned in package.json to the newest
// release that supports Node 20; later ones need Node 22.
let pdfjsModule = null;
function loadPdfjs() {
    if (!pdfjsModule) {
        pdfjsModule = import('pdfjs-dist/legacy/build/pdf.mjs').catch((error) => {
            pdfjsModule = null;
            throw error;
        });
    }
    return pdfjsModule;
}

// Extract text from a PDF, reconstructing visual lines by grouping text
// fragments that share a y-coordinate (invoice tables rely on this).
async function extractPdfText(buffer) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        // Only the text is read: never run anything a PDF carries, and keep
        // font and rendering chatter out of the server log.
        isEvalSupported: false,
        verbosity: pdfjs.VerbosityLevel.ERRORS
    });
    try {
        const doc = await task.promise;
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
    } finally {
        // Release the parsed document whether or not it could be read.
        await task.destroy().catch(() => {});
    }
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
            unit_price
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
            const lines = parseInvoiceItems(data.text);
            // Category and brand for each line, in the register's own
            // category names. A line nothing can place is filed as general
            // electronics for the reviewer to correct.
            const names = tidy.categories().map((c) => c.name);
            const fallback = names.find((n) => ['other electronics', 'electronics'].includes(n.toLowerCase())) || 'Other Electronics';
            const guesses = await tidy.suggestForNew(lines.map((line) => ({ name: line.name })));
            const items = lines.map((line, index) => ({
                ...line,
                category: guesses[index].category || fallback,
                brand: guesses[index].brand
            }));

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


        const created = [];
        db.transaction(() => {
            for (const it of items) {
                const name = String(it.name || '').trim();
                if (!name) continue;
                const quantity = Math.min(999, Math.max(1, parseInt(it.quantity, 10) || 1));
                const price = it.unit_price === '' || it.unit_price == null ? null : Math.max(0, parseFloat(it.unit_price) || 0);
                const assetNumber = generateAssetNumber();
                // The reviewer's category and brand stand; blanks are worked
                // out from the name, and electronics start at the home campus.
                const filled = tidy.defaultsForNew({ name, model: it.model, brand: it.brand, category: it.category });
                const result = db.prepare(`
          INSERT INTO assets (
            asset_number, name, category_id, brand, model, serial_number, quantity, assigned_quantity,
            purchase_date, purchase_price, status, campus, notes
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, 'available', ?, ?)
        `).run(
                    assetNumber, name.slice(0, 150), filled.category_id,
                    filled.brand, (it.model || '').trim() || null,
                    quantity, it.purchase_date || null, price, filled.campus,
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

        created.forEach((c) => sharepoint.enqueue(c.id));
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

const db = require('../database');
const assignments = require('./assignments');

// A device sold to the person who has been using it (or to anyone else): a
// leaver buying their laptop, say. The asset stays in the register for the
// record, marked "sold", with who bought it, for how much and when; it is no
// longer assigned to anybody or counted as stock. A sale can be undone.

// What cannot be sold: it is already gone.
const NOT_FOR_SALE = ['sold', 'lost', 'stolen', 'retired'];

class SaleError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const money = (value) => `£${Number(value).toFixed(2)}`;

function activeSale(assetId) {
    return db.prepare(`
      SELECT s.*, e.name AS employee_name, e.email AS employee_email
      FROM asset_sales s LEFT JOIN employees e ON s.employee_id = e.id
      WHERE s.asset_id = ? AND s.cancelled_at IS NULL
      ORDER BY s.id DESC LIMIT 1
    `).get(assetId) || null;
}

function parseDate(value) {
    const text = String(value || '').trim();
    if (!text) return new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
        throw new SaleError('Enter the sale date as a valid date');
    }
    if (Date.parse(text) > Date.now() + 86400000) throw new SaleError('The sale date cannot be in the future');
    return text;
}

/**
 * Record that an asset has been sold. `body` is
 * { employee_id | buyer_name [, buyer_email], price, sold_on, payment_reference, notes }.
 * Returns { asset, sale, buyer, previous } where `previous` are the holders
 * it was taken back from.
 */
function sell(assetId, body = {}, user) {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(assetId);
    if (!asset) throw new SaleError('Asset not found', 404);
    if (asset.status === 'sold') throw new SaleError('This asset has already been sold');
    if (NOT_FOR_SALE.includes(asset.status)) {
        throw new SaleError(`This asset is marked "${asset.status}" and cannot be sold. Change its status first if that is wrong.`);
    }
    if (asset.quantity > 1) {
        throw new SaleError('This is a stock line of several items. Register the one being sold as its own asset, then sell that.');
    }

    let buyer;
    if (body.employee_id) {
        // Leavers are welcome here: buying the laptop on the way out is the usual case.
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(body.employee_id));
        if (!employee) throw new SaleError('Employee not found', 404);
        buyer = { employee_id: employee.id, name: employee.name, email: employee.email, department: employee.department };
    } else {
        const name = String(body.buyer_name || '').trim().slice(0, 120);
        if (!name) throw new SaleError('Choose who is buying it');
        const email = String(body.buyer_email || '').trim().slice(0, 200);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SaleError('The buyer\'s email address does not look right');
        buyer = { employee_id: null, name, email, department: '' };
    }

    const price = Number(body.price);
    if (body.price === '' || body.price === null || body.price === undefined || !Number.isFinite(price) || price < 0) {
        throw new SaleError('Enter the price it is being sold for (0 if it is being given away)');
    }
    if (price > 1000000) throw new SaleError('That price looks wrong');
    const soldOn = parseDate(body.sold_on);
    const reference = String(body.payment_reference || '').trim().slice(0, 120) || null;
    const notes = String(body.notes || '').trim().slice(0, 1000) || null;

    return db.transaction(() => {
        const previous = assignments.closeAll(asset.id, user?.id, 'sold');
        db.prepare("UPDATE assets SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(asset.id);
        assignments.syncAssetSummary(asset.id);

        const saleId = db.prepare(`
          INSERT INTO asset_sales (asset_id, employee_id, buyer_name, buyer_email, price, sold_on, payment_reference, notes, recorded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(asset.id, buyer.employee_id, buyer.name, buyer.email || null, price, soldOn, reference, notes, user?.email || null).lastInsertRowid;

        assignments.addHistory(asset.id, 'sold', buyer.employee_id,
            `Sold to ${buyer.name} for ${money(price)} on ${soldOn}${reference ? ` (ref ${reference})` : ''}${notes ? ` — ${notes}` : ''}`, user);

        return {
            asset: db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id),
            sale: activeSale(asset.id),
            buyer,
            previous,
            sale_id: saleId
        };
    })();
}

/**
 * Undo a sale recorded by mistake, or one that fell through. The asset goes
 * back into stock; it is not handed back to whoever had it before.
 */
function undo(assetId, body = {}, user) {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(assetId);
    if (!asset) throw new SaleError('Asset not found', 404);
    const sale = activeSale(asset.id);
    if (asset.status !== 'sold' || !sale) throw new SaleError('This asset is not recorded as sold');
    const reason = String(body.reason || '').trim().slice(0, 500) || null;

    return db.transaction(() => {
        db.prepare(`
          UPDATE asset_sales SET cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?, cancel_reason = ? WHERE id = ?
        `).run(user?.email || null, reason, sale.id);
        db.prepare("UPDATE assets SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(asset.id);
        assignments.syncAssetSummary(asset.id);
        assignments.addHistory(asset.id, 'sale_undone', sale.employee_id,
            `Sale to ${sale.buyer_name} undone; back in stock${reason ? ` — ${reason}` : ''}`, user);
        return { asset: db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id), sale };
    })();
}

// Every sale still standing, newest first, for the report.
function list() {
    return db.prepare(`
      SELECT s.id, s.asset_id, s.employee_id, s.buyer_name, s.buyer_email, s.price, s.sold_on,
             s.payment_reference, s.notes, s.recorded_by,
             a.asset_number, a.name AS asset_name, a.brand, a.model, a.serial_number, a.purchase_price, a.purchase_date,
             c.name AS category
      FROM asset_sales s
      JOIN assets a ON s.asset_id = a.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE s.cancelled_at IS NULL AND a.deleted_at IS NULL
      ORDER BY s.sold_on DESC, s.id DESC
    `).all();
}

module.exports = { sell, undo, activeSale, list, money, SaleError };

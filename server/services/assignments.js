const db = require('../database');

// Statuses an item can be handed out in. Anything else (repair, lost, retired…)
// has to be put back to "available" before it can be assigned.
const ASSIGNABLE_STATUSES = ['available', 'assigned'];
// Statuses that take an item out of circulation; moving an asset into one of
// these closes every open assignment.
const OUT_OF_SERVICE_STATUSES = ['maintenance', 'repair', 'damaged', 'lost', 'stolen', 'retired'];
const ALL_STATUSES = [...ASSIGNABLE_STATUSES, ...OUT_OF_SERVICE_STATUSES];

// What a returned item's condition does to the asset's status.
const RETURN_CONDITIONS = {
    good: null,
    needs_repair: 'repair',
    damaged: 'damaged',
    lost: 'lost'
};

class AssignmentError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function toPositiveInt(value, fallback = 1) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getAsset(assetId) {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(assetId);
    if (!asset) throw new AssignmentError('Asset not found', 404);
    return asset;
}

function openAssignments(assetId) {
    return db.prepare(`
      SELECT x.*, e.name AS employee_name, e.email AS employee_email, e.department
      FROM asset_assignments x
      LEFT JOIN employees e ON x.employee_id = e.id
      WHERE x.asset_id = ? AND x.returned_at IS NULL
      ORDER BY x.assigned_at, x.id
    `).all(assetId);
}

function holderLabel(row) {
    if (!row) return '';
    return row.employee_name || row.location_label || 'Unknown holder';
}

// Recompute the summary columns on the asset from its open assignments.
// assigned_to is only set while exactly one person holds the item, so the
// many existing joins on it stay correct for ordinary one-device-one-person
// assets; multi-holder stock is read from asset_assignments instead.
function syncAssetSummary(assetId) {
    const asset = db.prepare('SELECT id, quantity, status FROM assets WHERE id = ?').get(assetId);
    if (!asset) return;
    const open = db.prepare(
        'SELECT employee_id, quantity FROM asset_assignments WHERE asset_id = ? AND returned_at IS NULL'
    ).all(assetId);
    const assignedQty = open.reduce((sum, row) => sum + row.quantity, 0);
    const soleEmployee = open.length > 0 && open.every((row) => row.employee_id && row.employee_id === open[0].employee_id)
        ? open[0].employee_id
        : null;

    let status = asset.status;
    if (ASSIGNABLE_STATUSES.includes(status)) {
        status = assignedQty > 0 && assignedQty >= asset.quantity ? 'assigned' : 'available';
    }

    db.prepare(`
      UPDATE assets SET assigned_to = ?, assigned_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(soleEmployee, assignedQty, status, assetId);
}

function addHistory(assetId, action, employeeId, notes) {
    db.prepare('INSERT INTO asset_history (asset_id, action, employee_id, notes) VALUES (?, ?, ?, ?)')
        .run(assetId, action, employeeId || null, notes || null);
}

// History line such as "Assigned to Jane Smith" or, for bulk stock,
// "Assigned 4 to Room 204", with any note the user typed appended.
function describe(verb, asset, quantity, rest, notes) {
    const qty = asset.quantity > 1 ? ` ${quantity}` : '';
    const note = String(notes || '').trim();
    return `${verb}${qty} ${rest}${note ? ` — ${note}` : ''}`;
}

// Resolve "who is this going to" from a request body: a person (employee_id)
// or a place (location, e.g. "Room 204").
function resolveHolder({ employee_id, location }) {
    if (employee_id) {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(employee_id));
        if (!employee) throw new AssignmentError('Employee not found', 404);
        return { employee, location: null, label: employee.name };
    }
    const label = String(location || '').trim();
    if (!label) throw new AssignmentError('Choose an employee or enter a room / location');
    return { employee: null, location: label.slice(0, 120), label: label.slice(0, 120) };
}

function findOpenRowFor(assetId, holder) {
    if (holder.employee) {
        return db.prepare(
            'SELECT * FROM asset_assignments WHERE asset_id = ? AND employee_id = ? AND returned_at IS NULL'
        ).get(assetId, holder.employee.id);
    }
    return db.prepare(`
      SELECT * FROM asset_assignments
      WHERE asset_id = ? AND employee_id IS NULL AND returned_at IS NULL
        AND LOWER(TRIM(location_label)) = LOWER(TRIM(?))
    `).get(assetId, holder.location);
}

// Add `quantity` to a holder's open assignment (creating it if needed).
function giveToHolder(assetId, holder, quantity, userId, notes) {
    const existing = findOpenRowFor(assetId, holder);
    if (existing) {
        db.prepare('UPDATE asset_assignments SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
        return existing.id;
    }
    return db.prepare(`
      INSERT INTO asset_assignments (asset_id, employee_id, location_label, quantity, assigned_by, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(assetId, holder.employee ? holder.employee.id : null, holder.location, quantity, userId || null, notes || null)
        .lastInsertRowid;
}

// Take `quantity` back out of an open assignment. A partial amount leaves the
// row open with the remainder and records the returned part as its own closed
// row, so the trail shows exactly what came back and when.
function takeFromRow(row, quantity, userId, condition, notes) {
    if (quantity >= row.quantity) {
        db.prepare(`
          UPDATE asset_assignments
          SET returned_at = CURRENT_TIMESTAMP, returned_by = ?, return_condition = ?, notes = COALESCE(?, notes)
          WHERE id = ?
        `).run(userId || null, condition || null, notes || null, row.id);
        return;
    }
    db.prepare('UPDATE asset_assignments SET quantity = quantity - ? WHERE id = ?').run(quantity, row.id);
    db.prepare(`
      INSERT INTO asset_assignments (
        asset_id, employee_id, location_label, quantity, assigned_at, assigned_by,
        returned_at, returned_by, return_condition, notes
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `).run(row.asset_id, row.employee_id, row.location_label, quantity, row.assigned_at, row.assigned_by,
        userId || null, condition || null, notes || null);
}

// Pick the open assignment an action applies to. With a single holder the
// caller doesn't need to say which; with several it must.
function pickOpenRow(assetId, assignmentId) {
    const open = openAssignments(assetId);
    if (open.length === 0) throw new AssignmentError('This asset is not assigned to anyone');
    if (assignmentId) {
        const row = open.find((r) => r.id === Number(assignmentId));
        if (!row) throw new AssignmentError('That assignment is no longer open', 409);
        return row;
    }
    if (open.length > 1) {
        throw new AssignmentError('This asset has several holders — choose which one');
    }
    return open[0];
}

/**
 * Hand out stock that is currently unassigned.
 * Returns { asset, holder, quantity } for the caller to log / email.
 */
function assign(assetId, body, user) {
    return db.transaction(() => {
        const asset = getAsset(assetId);
        if (!ASSIGNABLE_STATUSES.includes(asset.status)) {
            throw new AssignmentError(
                `This asset is marked "${asset.status}" — set it back to available before assigning it`
            );
        }
        const holder = resolveHolder(body);
        const quantity = toPositiveInt(body.quantity);
        const alreadyOut = openAssignments(asset.id).reduce((sum, row) => sum + row.quantity, 0);
        const available = Math.max(0, asset.quantity - alreadyOut);
        if (quantity > available) {
            throw new AssignmentError(
                available === 0
                    ? 'Nothing left to assign — return or reassign it first'
                    : `Only ${available} available to assign`
            );
        }

        const assignmentId = giveToHolder(asset.id, holder, quantity, user?.id, body.notes);
        addHistory(asset.id, 'assigned', holder.employee?.id,
            describe('Assigned', asset, quantity, `to ${holder.label}`, body.notes));
        syncAssetSummary(asset.id);
        return { asset: getAsset(asset.id), holder, quantity, assignmentId };
    })();
}

/**
 * Take stock back from a holder. `condition` decides what state the item
 * returns in; anything other than "good" takes a single item out of service.
 */
function giveBack(assetId, body, user) {
    return db.transaction(() => {
        const asset = getAsset(assetId);
        const row = pickOpenRow(asset.id, body.assignment_id);
        const quantity = Math.min(row.quantity, toPositiveInt(body.quantity, row.quantity));
        const condition = Object.prototype.hasOwnProperty.call(RETURN_CONDITIONS, body.condition)
            ? body.condition
            : 'good';

        takeFromRow(row, quantity, user?.id, condition, body.notes);

        const conditionText = condition === 'good' ? '' : ` (${condition.replace('_', ' ')})`;
        addHistory(asset.id, 'returned', row.employee_id,
            describe('Returned', asset, quantity, `from ${holderLabel(row)}${conditionText}`, body.notes));

        // A one-off item that comes back broken or is reported lost leaves
        // circulation. For bulk stock the count is left alone — adjust the
        // quantity on the asset if units were written off.
        const newStatus = RETURN_CONDITIONS[condition];
        if (newStatus && asset.quantity === 1) {
            db.prepare('UPDATE assets SET status = ? WHERE id = ?').run(newStatus, asset.id);
            addHistory(asset.id, 'status_change', row.employee_id,
                `Status changed from ${asset.status} to ${newStatus} on return`);
        }
        syncAssetSummary(asset.id);
        return { asset: getAsset(asset.id), previous: row, quantity, condition };
    })();
}

/** Move stock straight from one holder to another without a return in between. */
function reassign(assetId, body, user) {
    return db.transaction(() => {
        const asset = getAsset(assetId);
        if (!ASSIGNABLE_STATUSES.includes(asset.status)) {
            throw new AssignmentError(`This asset is marked "${asset.status}" and cannot be reassigned`);
        }
        const row = pickOpenRow(asset.id, body.assignment_id);
        const holder = resolveHolder(body);
        const sameHolder = holder.employee
            ? row.employee_id === holder.employee.id
            : !row.employee_id && String(row.location_label || '').trim().toLowerCase() === holder.location.toLowerCase();
        if (sameHolder) throw new AssignmentError(`${holder.label} already holds this asset`);

        const quantity = Math.min(row.quantity, toPositiveInt(body.quantity, row.quantity));
        const fromLabel = holderLabel(row);

        takeFromRow(row, quantity, user?.id, 'reassigned', null);
        const assignmentId = giveToHolder(asset.id, holder, quantity, user?.id, body.notes);

        addHistory(asset.id, 'reassigned', holder.employee?.id,
            describe('Reassigned', asset, quantity, `from ${fromLabel} to ${holder.label}`, body.notes));
        syncAssetSummary(asset.id);
        return { asset: getAsset(asset.id), previous: row, holder, quantity, assignmentId };
    })();
}

/** Move an asset to another campus and/or location. Holders are unaffected. */
function transfer(assetId, body) {
    return db.transaction(() => {
        const asset = getAsset(assetId);
        const campus = body.campus === undefined ? (asset.campus || '') : String(body.campus || '').trim();
        const location = body.location === undefined ? asset.location : (String(body.location || '').trim() || null);
        if (campus === (asset.campus || '') && (location || '') === (asset.location || '')) {
            throw new AssignmentError('The asset is already at that campus and location');
        }

        db.prepare('UPDATE assets SET campus = ?, location = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(campus, location, asset.id);

        const from = [asset.campus || 'Unassigned campus', asset.location].filter(Boolean).join(' / ');
        const to = [campus || 'Unassigned campus', location].filter(Boolean).join(' / ');
        addHistory(asset.id, 'transferred', null, `Moved from ${from} to ${to}${body.notes ? ` — ${body.notes}` : ''}`);
        return { asset: getAsset(asset.id), from, to };
    })();
}

/**
 * Close every open assignment (asset lost, retired, sent for repair…).
 * Must be called inside the caller's transaction. Returns the closed rows.
 */
function closeAll(assetId, userId, reason) {
    const open = openAssignments(assetId);
    for (const row of open) {
        takeFromRow(row, row.quantity, userId, reason, null);
    }
    return open;
}

module.exports = {
    ASSIGNABLE_STATUSES,
    OUT_OF_SERVICE_STATUSES,
    ALL_STATUSES,
    RETURN_CONDITIONS,
    AssignmentError,
    assign,
    giveBack,
    reassign,
    transfer,
    closeAll,
    openAssignments,
    syncAssetSummary,
    holderLabel
};

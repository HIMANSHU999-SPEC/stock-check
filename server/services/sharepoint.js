const db = require('../database');
const { entra, appBaseUrl } = require('../config');
const { graph, GraphError, explainGraphError } = require('./graph');
const { getSettings } = require('./appSettings');

// Mirrors the asset register into a SharePoint list so the rest of the
// organisation can see (and filter, and build views on) what IT holds without
// needing a login to this app. The app's own database stays the source of
// truth: this is a one-way push, driven by an outbox so that a SharePoint or
// network outage never blocks or loses a change made here.

const PERMISSION_HINT = 'Sites.ReadWrite.All (or Sites.Selected with write access to the site)';
const STATE_KEY = 'sharepoint_state';
const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 20000;

// Title holds the asset number; everything else is a custom column.
const COLUMNS = [
    { name: 'AssetName', displayName: 'Asset Name', text: {} },
    { name: 'AssetCategory', displayName: 'Category', text: {} },
    { name: 'AssetBrand', displayName: 'Brand', text: {} },
    { name: 'AssetModel', displayName: 'Model', text: {} },
    { name: 'SerialNumber', displayName: 'Serial Number', text: {} },
    { name: 'AssetStatus', displayName: 'Status', text: {} },
    { name: 'Campus', displayName: 'Campus', text: {} },
    { name: 'AssetLocation', displayName: 'Location', text: {} },
    { name: 'Quantity', displayName: 'Quantity', number: {} },
    { name: 'AssignedQuantity', displayName: 'Assigned Quantity', number: {} },
    { name: 'AssignedTo', displayName: 'Assigned To', text: { allowMultipleLines: true } },
    { name: 'AssignedEmail', displayName: 'Assigned Email', text: { allowMultipleLines: true } },
    { name: 'PurchaseDate', displayName: 'Purchase Date', dateTime: { format: 'dateOnly' } },
    { name: 'PurchasePrice', displayName: 'Purchase Price', number: {} },
    { name: 'Supplier', displayName: 'Supplier', text: {} },
    { name: 'WarrantyMonths', displayName: 'Warranty (months)', number: {} },
    { name: 'AssetLink', displayName: 'Open in Stock System', text: {} },
    { name: 'LastChanged', displayName: 'Last Changed', dateTime: { format: 'dateTime' } }
];

class SharePointConfigError extends Error {}

function readState() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(STATE_KEY);
    try {
        return row ? JSON.parse(row.value) : {};
    } catch (err) {
        return {};
    }
}

function writeState(changes) {
    const next = { ...readState(), ...changes };
    db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)').run(STATE_KEY, JSON.stringify(next));
}

// "https://tenant.sharepoint.com/sites/IT" -> Graph's "tenant.sharepoint.com:/sites/IT"
function siteAddress(siteUrl) {
    let url;
    try {
        url = new URL(siteUrl);
    } catch (err) {
        throw new SharePointConfigError('The SharePoint site must be a full address, e.g. https://yourtenant.sharepoint.com/sites/IT');
    }
    if (url.protocol !== 'https:') throw new SharePointConfigError('The SharePoint site address must start with https://');
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
    return path ? `${url.hostname}:${path.split('/').map(encodeURIComponent).join('/')}` : url.hostname;
}

function isEnabled() {
    const settings = getSettings();
    return Boolean(entra.configured && settings.sharepoint_enabled && settings.sharepoint_site);
}

let target = null; // { key, siteId, listId, createdNow }

// Find the list (creating it, and any missing columns, on first use).
async function resolveTarget() {
    const settings = getSettings();
    if (!entra.configured) throw new SharePointConfigError('Microsoft 365 app credentials are not set on the server');
    if (!settings.sharepoint_site) throw new SharePointConfigError('No SharePoint site has been set');
    const listName = settings.sharepoint_list || 'IT Asset Register';
    const key = `${settings.sharepoint_site}|${listName}`;
    if (target && target.key === key) return target;

    const site = await graph('GET', `/sites/${siteAddress(settings.sharepoint_site)}?$select=id,webUrl`);
    const filter = encodeURIComponent(`displayName eq '${listName.replace(/'/g, "''")}'`);
    const found = await graph('GET', `/sites/${site.id}/lists?$filter=${filter}&$select=id,displayName,webUrl`);
    let list = (found.value || [])[0];
    let createdNow = false;

    if (!list) {
        list = await graph('POST', `/sites/${site.id}/lists`, {
            body: { displayName: listName, columns: COLUMNS, list: { template: 'genericList' } }
        });
        createdNow = true;
    } else {
        const existing = await graph('GET', `/sites/${site.id}/lists/${list.id}/columns?$select=name`);
        const names = new Set((existing.value || []).map((c) => c.name));
        for (const column of COLUMNS) {
            if (!names.has(column.name)) {
                await graph('POST', `/sites/${site.id}/lists/${list.id}/columns`, { body: column });
            }
        }
    }

    target = { key, siteId: site.id, listId: list.id, createdNow };
    writeState({ list_url: list.webUrl || null });
    return target;
}

function holdersOf(assetId) {
    return db.prepare(`
      SELECT x.quantity, x.location_label, e.name, e.email
      FROM asset_assignments x
      LEFT JOIN employees e ON x.employee_id = e.id
      WHERE x.asset_id = ? AND x.returned_at IS NULL
      ORDER BY x.assigned_at, x.id
    `).all(assetId);
}

function toFields(asset) {
    const holders = holdersOf(asset.id);
    const multi = asset.quantity > 1;
    const purchaseDate = /^\d{4}-\d{2}-\d{2}/.test(asset.purchase_date || '')
        ? `${asset.purchase_date.slice(0, 10)}T00:00:00Z`
        : null;
    const number = (value) => (value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value));
    return {
        Title: asset.asset_number,
        AssetName: asset.name || '',
        AssetCategory: asset.category_name || '',
        AssetBrand: asset.brand || '',
        AssetModel: asset.model || '',
        SerialNumber: asset.serial_number || '',
        AssetStatus: asset.status || '',
        Campus: asset.campus || '',
        AssetLocation: asset.location || '',
        Quantity: number(asset.quantity),
        AssignedQuantity: number(asset.assigned_quantity) || 0,
        AssignedTo: holders.map((h) => `${h.name || h.location_label}${multi ? ` (${h.quantity})` : ''}`).join('; '),
        AssignedEmail: holders.map((h) => h.email).filter(Boolean).join('; '),
        PurchaseDate: purchaseDate,
        PurchasePrice: number(asset.purchase_price),
        Supplier: asset.supplier_name || '',
        WarrantyMonths: number(asset.warranty_period_months) || 0,
        AssetLink: appBaseUrl ? `${appBaseUrl}/s/${encodeURIComponent(asset.asset_number)}` : '',
        LastChanged: new Date().toISOString()
    };
}

async function findItemByAssetNumber(t, assetNumber) {
    const filter = encodeURIComponent(`fields/Title eq '${assetNumber.replace(/'/g, "''")}'`);
    const result = await graph('GET', `/sites/${t.siteId}/lists/${t.listId}/items?$filter=${filter}&$select=id&$top=1`, {
        // Title is not indexed on a new list; this lets the filter run anyway.
        headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }
    });
    return (result.value || [])[0] || null;
}

const setItemId = (assetId, itemId) =>
    db.prepare('UPDATE assets SET sharepoint_item_id = ? WHERE id = ?').run(itemId, assetId);

// Push one asset: create or update its row, or remove the row once the asset
// has been deleted here.
async function pushAsset(t, assetId) {
    const asset = db.prepare(`
      SELECT a.*, c.name AS category_name
      FROM assets a LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(assetId);
    const itemsPath = `/sites/${t.siteId}/lists/${t.listId}/items`;

    if (!asset || asset.deleted_at) {
        if (asset && asset.sharepoint_item_id) {
            try {
                await graph('DELETE', `${itemsPath}/${asset.sharepoint_item_id}`);
            } catch (err) {
                if (!(err instanceof GraphError) || err.status !== 404) throw err;
            }
            setItemId(asset.id, null);
        }
        return;
    }

    const fields = toFields(asset);
    if (asset.sharepoint_item_id) {
        try {
            await graph('PATCH', `${itemsPath}/${asset.sharepoint_item_id}/fields`, { body: fields });
            return;
        } catch (err) {
            // Someone deleted the row in SharePoint — fall through and recreate it.
            if (!(err instanceof GraphError) || err.status !== 404) throw err;
        }
    } else if (!t.createdNow) {
        // No id on record (first sync against an existing list, or a restored
        // database): adopt the row for this asset number rather than duplicate it.
        const existing = await findItemByAssetNumber(t, asset.asset_number).catch(() => null);
        if (existing) {
            await graph('PATCH', `${itemsPath}/${existing.id}/fields`, { body: fields });
            setItemId(asset.id, existing.id);
            return;
        }
    }

    const created = await graph('POST', itemsPath, { body: { fields } });
    setItemId(asset.id, created.id);
}

let kickTimer = null;

// Push shortly after a change instead of waiting for the next poll; a burst
// of changes (an import, a bulk edit) collapses into one pass.
function kick() {
    if (kickTimer) return;
    kickTimer = setTimeout(() => {
        kickTimer = null;
        processOutbox().catch((err) => console.error('sharepoint sync failed:', err.message));
    }, 1500);
    kickTimer.unref();
}

/** Queue an asset to be pushed. Cheap and synchronous — safe to call from any route. */
function enqueue(assetId) {
    if (!assetId || !isEnabled()) return;
    try {
        db.prepare(`
          INSERT INTO sharepoint_outbox (asset_id) VALUES (?)
          ON CONFLICT(asset_id) DO UPDATE SET
            revision = revision + 1, queued_at = CURRENT_TIMESTAMP,
            attempts = 0, next_attempt_at = 0, last_error = NULL
        `).run(assetId);
        kick();
    } catch (err) {
        console.error('sharepoint enqueue failed:', err.message);
    }
}

/** Queue every asset (plus deleted ones that still have a row in SharePoint). */
function enqueueAll() {
    const result = db.prepare(`
      INSERT INTO sharepoint_outbox (asset_id)
      SELECT id FROM assets WHERE deleted_at IS NULL OR sharepoint_item_id IS NOT NULL
      ON CONFLICT(asset_id) DO UPDATE SET
        revision = revision + 1, queued_at = CURRENT_TIMESTAMP,
        attempts = 0, next_attempt_at = 0, last_error = NULL
    `).run();
    return result.changes;
}

function retryFailed() {
    return db.prepare('UPDATE sharepoint_outbox SET attempts = 0, next_attempt_at = 0 WHERE attempts >= ?')
        .run(MAX_ATTEMPTS).changes;
}

let running = false;
let pausedUntil = 0;

/** Push queued changes. Returns how many were sent in this pass. */
async function processOutbox() {
    if (running || !isEnabled() || Date.now() < pausedUntil) return 0;
    const rows = db.prepare(`
      SELECT asset_id, revision, attempts FROM sharepoint_outbox
      WHERE attempts < ? AND next_attempt_at <= ?
      ORDER BY queued_at, asset_id LIMIT ?
    `).all(MAX_ATTEMPTS, Date.now(), BATCH_SIZE);
    if (rows.length === 0) return 0;

    running = true;
    let sent = 0;
    try {
        let t;
        try {
            t = await resolveTarget();
        } catch (err) {
            // Nothing can be pushed until the site/list is reachable; note why
            // and try again later without burning each row's attempts.
            pausedUntil = Date.now() + 5 * 60 * 1000;
            writeState({ last_error: explainGraphError(err, PERMISSION_HINT), last_error_at: new Date().toISOString() });
            return 0;
        }

        for (const row of rows) {
            try {
                await pushAsset(t, row.asset_id);
                // Only clear the entry if the asset wasn't changed again mid-push.
                db.prepare('DELETE FROM sharepoint_outbox WHERE asset_id = ? AND revision = ?').run(row.asset_id, row.revision);
                sent += 1;
            } catch (err) {
                const message = explainGraphError(err, PERMISSION_HINT);
                if (err instanceof GraphError && (err.status === 429 || err.status === 503)) {
                    // Throttled: back off as asked and leave the queue untouched.
                    pausedUntil = Date.now() + Math.max(err.retryAfter, 30) * 1000;
                    writeState({ last_error: 'Microsoft 365 is throttling requests — sync will resume shortly', last_error_at: new Date().toISOString() });
                    break;
                }
                const attempts = row.attempts + 1;
                db.prepare('UPDATE sharepoint_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE asset_id = ? AND revision = ?')
                    .run(attempts, Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000, message, row.asset_id, row.revision);
                writeState({ last_error: message, last_error_at: new Date().toISOString() });
                // An access problem will fail every row the same way.
                if (err instanceof GraphError && (err.status === 401 || err.status === 403)) {
                    target = null;
                    break;
                }
            }
        }
        if (sent > 0) writeState({ last_success_at: new Date().toISOString() });
        return sent;
    } finally {
        running = false;
    }
}

function getStatus() {
    const settings = getSettings();
    const state = readState();
    const counts = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN attempts < ? THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN attempts >= ? THEN 1 ELSE 0 END), 0) AS failed
      FROM sharepoint_outbox
    `).get(MAX_ATTEMPTS, MAX_ATTEMPTS);
    const synced = db.prepare('SELECT COUNT(*) AS c FROM assets WHERE sharepoint_item_id IS NOT NULL AND deleted_at IS NULL').get().c;
    const lastSuccess = state.last_success_at || null;
    return {
        enabled: Boolean(settings.sharepoint_enabled),
        configured: isEnabled(),
        site: settings.sharepoint_site,
        list: settings.sharepoint_list,
        list_url: state.list_url || null,
        pending: counts.pending,
        failed: counts.failed,
        synced,
        last_success_at: lastSuccess,
        // An error older than the last successful push has been overcome.
        last_error: state.last_error && (!lastSuccess || state.last_error_at > lastSuccess) ? state.last_error : null,
        last_error_at: state.last_error_at || null
    };
}

/** Check the site and list are reachable (creating the list if needed). */
async function testConnection() {
    target = null;
    pausedUntil = 0;
    try {
        const t = await resolveTarget();
        writeState({ last_error: null, last_error_at: null });
        return { ok: true, created: t.createdNow, list_url: readState().list_url || null };
    } catch (err) {
        return { ok: false, error: err instanceof SharePointConfigError ? err.message : explainGraphError(err, PERMISSION_HINT) };
    }
}

// Forget the cached list when the site or list name is changed in Settings.
function resetTarget() {
    target = null;
    pausedUntil = 0;
}

function startWorker() {
    const timer = setInterval(() => {
        processOutbox().catch((err) => console.error('sharepoint sync failed:', err.message));
    }, POLL_INTERVAL_MS);
    timer.unref();
    return timer;
}

module.exports = {
    enqueue,
    enqueueAll,
    retryFailed,
    processOutbox,
    getStatus,
    testConnection,
    resetTarget,
    startWorker,
    isEnabled
};

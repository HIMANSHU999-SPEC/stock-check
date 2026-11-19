const db = require('../database');
const { entra } = require('../config');
const { graphAll, GraphError, explainGraphError } = require('./graph');
const { holderLabel } = require('./assignments');
const { detectBrand } = require('./classifier');

// Double-checks the register against Microsoft Intune: every device Intune
// manages, and the person Intune says uses it, compared with what is recorded
// here. Devices are paired by serial number.
//
// Read-only on both sides. It needs the DeviceManagementManagedDevices.Read.All
// application permission; nothing is changed in Intune, and nothing changes in
// the register until someone acts on a finding.

const PERMISSION = 'DeviceManagementManagedDevices.Read.All';
const CACHE_MS = 10 * 60 * 1000;
// A device that has not checked in for this long is probably in a drawer,
// reimaged, or gone.
const STALE_DAYS = Math.max(1, parseInt(process.env.INTUNE_STALE_DAYS, 10) || 90);
// How recently a written-off device must have checked in to be worth raising.
const RECENT_DAYS = 30;

const DEVICE_FIELDS = [
    'id', 'deviceName', 'serialNumber', 'manufacturer', 'model',
    'userPrincipalName', 'userDisplayName', 'emailAddress',
    'operatingSystem', 'osVersion', 'lastSyncDateTime', 'enrolledDateTime',
    'complianceState', 'managedDeviceOwnerType'
];

// Categories whose items are expected to be enrolled. Anything Intune does
// report is matched whatever its category; this only decides which register
// entries are worth flagging as "not in Intune". Override with
// INTUNE_CATEGORIES (comma-separated category names).
const DEVICE_CATEGORY = /laptop|notebook|macbook|chromebook|desktop|computer|workstation|all[\s-]?in[\s-]?one|\bpc\b|imac|tablet|ipad|surface|phone|mobile/i;
const NOT_A_DEVICE = /accessor|charger|adapter|cable|bag|case|cover|stand|dock|mount|trolley|cabinet|desk\b|table/i;
const CONFIGURED_CATEGORIES = (process.env.INTUNE_CATEGORIES || '')
    .split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);

// Statuses that mean the organisation no longer has the device.
const GONE_STATUSES = ['lost', 'stolen', 'retired'];

class IntuneError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.status = status;
    }
}

function expectedInIntune(categoryName) {
    const name = String(categoryName || '').trim();
    if (!name) return false;
    if (CONFIGURED_CATEGORIES.length) return CONFIGURED_CATEGORIES.includes(name.toLowerCase());
    return DEVICE_CATEGORY.test(name) && !NOT_A_DEVICE.test(name);
}

// Serial numbers as typed, scanned and reported never quite agree on case,
// spaces or dashes. Values a manufacturer left as a placeholder are not
// serial numbers at all and must never pair two devices up.
const PLACEHOLDER_SERIALS = new Set([
    'NA', 'NONE', 'NULL', 'UNKNOWN', 'DEFAULTSTRING', 'TOBEFILLEDBYOEM', 'SYSTEMSERIALNUMBER',
    'NOTAPPLICABLE', 'NOTSPECIFIED', 'NOTAVAILABLE', 'INVALID', 'SERIALNUMBER', 'TBC', 'TBA'
]);

function normaliseSerial(value) {
    const serial = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (serial.length < 4) return '';
    if (/^(.)\1+$/.test(serial)) return ''; // 0000000, XXXXXXX
    if (/^0?123456789?0?$/.test(serial)) return '';
    if (PLACEHOLDER_SERIALS.has(serial)) return '';
    return serial;
}

function lower(value) {
    return String(value || '').trim().toLowerCase();
}

function daysSince(iso) {
    const at = Date.parse(iso || '');
    // Intune reports "never" as year 0001.
    if (!Number.isFinite(at) || at < Date.parse('2000-01-01')) return null;
    return Math.max(0, Math.floor((Date.now() - at) / 86400000));
}

let cache = { at: 0, devices: null };
let inFlight = null;

async function fetchDevices({ refresh = false } = {}) {
    if (!entra.configured) {
        throw new IntuneError('Microsoft 365 is not set up on the server yet (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET).', 400);
    }
    if (!refresh && cache.devices && Date.now() - cache.at < CACHE_MS) return cache;
    // Two people opening the page together share one trip to Intune.
    if (!inFlight) {
        inFlight = graphAll(`/deviceManagement/managedDevices?$select=${DEVICE_FIELDS.join(',')}`)
            .then((devices) => {
                cache = { at: Date.now(), devices };
                return cache;
            })
            .catch((err) => {
                if (err instanceof GraphError) {
                    throw new IntuneError(explainGraphError(err, PERMISSION), err.status === 403 ? 403 : 502);
                }
                throw err;
            })
            .finally(() => { inFlight = null; });
    }
    return inFlight;
}

function describeDevice(device, employeesByEmail) {
    const upn = lower(device.userPrincipalName);
    const mail = lower(device.emailAddress);
    const employee = employeesByEmail.get(upn) || employeesByEmail.get(mail) || null;
    const days = daysSince(device.lastSyncDateTime);
    return {
        id: device.id,
        name: device.deviceName || '',
        serial_number: String(device.serialNumber || '').trim(),
        manufacturer: device.manufacturer || '',
        model: device.model || '',
        os: [device.operatingSystem, device.osVersion].filter(Boolean).join(' '),
        user_name: device.userDisplayName || '',
        user_email: upn || mail,
        user_emails: [...new Set([upn, mail].filter(Boolean))],
        // The same person on the staff list, when there is one.
        employee_id: employee ? employee.id : null,
        employee_name: employee ? employee.name : null,
        employee_inactive: employee ? employee.status === 'inactive' : false,
        last_sync: days === null ? null : device.lastSyncDateTime,
        days_since_sync: days,
        stale: days === null || days > STALE_DAYS,
        compliance: device.complianceState || '',
        personal: lower(device.managedDeviceOwnerType) === 'personal',
        enrolled: daysSince(device.enrolledDateTime) === null ? null : device.enrolledDateTime
    };
}

// What a device Intune knows about would be called if it were added here.
function suggestAsset(device) {
    const maker = String(device.manufacturer || '').trim();
    const brand = detectBrand(maker)
        || maker.replace(/[,.]?\s+(inc|corp|corporation|co|ltd|limited|llc|gmbh)\.?(?=[\s,.]|$).*$/i, '').trim();
    const model = String(device.model || '').trim();
    const name = !model
        ? device.name
        : (brand && !model.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${model}` : model);
    // A placeholder serial is worse than none: leave it for a person to read
    // off the device.
    return { name, brand, model, serial_number: normaliseSerial(device.serial_number) ? device.serial_number : '' };
}

function describeAsset(asset, assignments) {
    const holders = (assignments.get(asset.id) || []).map((row) => ({
        assignment_id: row.id,
        employee_id: row.employee_id,
        name: holderLabel(row),
        email: lower(row.employee_email),
        // A room, or a department / shared entry on the staff list: nobody
        // signs in to Intune as either.
        shared: !row.employee_id || row.employee_kind === 'shared',
        quantity: row.quantity
    }));
    return {
        id: asset.id,
        asset_number: asset.asset_number,
        name: asset.name,
        brand: asset.brand || '',
        model: asset.model || '',
        serial_number: asset.serial_number || '',
        category: asset.category_name || '',
        status: asset.status,
        campus: asset.campus || '',
        holders
    };
}

// What the two records say about one device, taken together.
function compare(asset, device) {
    if (GONE_STATUSES.includes(asset.status)) {
        // Written off here: only worth a row if it is still checking in.
        return device.days_since_sync !== null && device.days_since_sync <= RECENT_DAYS ? 'gone_but_active' : 'match';
    }
    const people = asset.holders.filter((holder) => !holder.shared);
    const hasUser = device.user_emails.length > 0;
    if (people.length > 0) {
        if (!hasUser) return 'no_user';
        return people.some((holder) => device.user_emails.includes(holder.email)) ? 'match' : 'different';
    }
    if (!hasUser) return 'match';
    return asset.holders.length > 0 ? 'shared_here' : 'unassigned_here';
}

const KINDS = [
    'different', 'unassigned_here', 'gone_but_active', 'not_in_register',
    'shared_here', 'no_user', 'not_in_intune', 'no_serial', 'match'
];

/**
 * Resolves with { fetched_at, intune_total, stale_days, summary, rows }.
 * Each row is { kind, asset, device }: one or the other is null when a device
 * is only known to one side.
 */
async function check({ refresh = false } = {}) {
    const { at, devices } = await fetchDevices({ refresh });

    const employeesByEmail = new Map(
        db.prepare('SELECT id, name, email, status FROM employees').all().map((row) => [lower(row.email), row])
    );
    const assets = db.prepare(`
      SELECT a.*, c.name AS category_name
      FROM assets a LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.deleted_at IS NULL
      ORDER BY a.asset_number
    `).all();

    const assignments = new Map();
    db.prepare(`
      SELECT x.id, x.asset_id, x.employee_id, x.location_label, x.quantity,
             e.name AS employee_name, e.email AS employee_email, e.kind AS employee_kind
      FROM asset_assignments x
      LEFT JOIN employees e ON x.employee_id = e.id
      WHERE x.returned_at IS NULL
      ORDER BY x.assigned_at, x.id
    `).all().forEach((row) => {
        if (!assignments.has(row.asset_id)) assignments.set(row.asset_id, []);
        assignments.get(row.asset_id).push(row);
    });

    // When Intune holds several records for one serial (a re-enrolled
    // machine leaves the old record behind), the latest check-in is the live one.
    const bySerial = new Map();
    const unusable = [];
    let duplicates = 0;
    for (const raw of devices) {
        const device = describeDevice(raw, employeesByEmail);
        const serial = normaliseSerial(device.serial_number);
        if (!serial) { unusable.push(device); continue; }
        const seen = bySerial.get(serial);
        if (!seen) { bySerial.set(serial, device); continue; }
        duplicates += 1;
        const newer = (device.days_since_sync ?? Infinity) < (seen.days_since_sync ?? Infinity);
        if (newer) bySerial.set(serial, device);
    }

    const rows = [];
    const matchedSerials = new Set();
    for (const row of assets) {
        const serial = normaliseSerial(row.serial_number);
        const device = serial ? bySerial.get(serial) : null;
        if (device) {
            matchedSerials.add(serial);
            const asset = describeAsset(row, assignments);
            rows.push({ kind: compare(asset, device), asset, device });
        } else if (expectedInIntune(row.category_name) && !GONE_STATUSES.includes(row.status)) {
            rows.push({ kind: serial ? 'not_in_intune' : 'no_serial', asset: describeAsset(row, assignments), device: null });
        }
    }
    // A device that was deleted here is still "not in the register", but it
    // is worth saying so: restoring it beats typing it in again.
    const binned = new Map();
    db.prepare('SELECT asset_number, serial_number FROM assets WHERE deleted_at IS NOT NULL').all().forEach((row) => {
        const serial = normaliseSerial(row.serial_number);
        if (serial) binned.set(serial, row.asset_number);
    });
    for (const [serial, device] of bySerial) {
        if (matchedSerials.has(serial)) continue;
        rows.push({
            kind: 'not_in_register', asset: null,
            device: { ...device, recycle_bin: binned.get(serial) || null, suggested: suggestAsset(device) }
        });
    }
    // Without a serial number Intune's record cannot be paired with anything.
    for (const device of unusable) {
        rows.push({ kind: 'not_in_register', asset: null, device: { ...device, recycle_bin: null, suggested: suggestAsset(device) } });
    }

    const summary = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
    summary.personal_not_in_register = 0;
    summary.stale = 0;
    for (const row of rows) {
        if (row.kind === 'not_in_register' && row.device.personal) summary.personal_not_in_register += 1;
        else summary[row.kind] += 1;
        if (row.asset && row.device && row.device.stale) summary.stale += 1;
    }
    rows.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));

    return {
        fetched_at: new Date(at).toISOString(),
        intune_total: devices.length,
        intune_duplicates: duplicates,
        stale_days: STALE_DAYS,
        summary,
        rows
    };
}

module.exports = { check, normaliseSerial, expectedInIntune, IntuneError, PERMISSION };

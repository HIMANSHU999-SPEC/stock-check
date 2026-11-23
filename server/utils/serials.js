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

module.exports = { normaliseSerial };

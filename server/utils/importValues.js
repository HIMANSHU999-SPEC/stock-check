// Turning spreadsheet cells into values that are safe to store.
//
// A sheet read in the browser arrives here as plain JSON, and a cell can be
// text, a number, TRUE/FALSE or blank whatever the column is meant to hold:
// a serial number typed as a number, a date kept as a real Excel date (which
// travels as a day count such as 46037), a price typed as "£749.00". Stored
// as they come, these end up as "123456789012.0" in a text column, a number
// where a date belongs, or an import that fails outright.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Day counts Excel uses for dates between 1954 and 2119: wide enough for any
// purchase, narrow enough that a stray quantity or year is not read as a date.
const SERIAL_MIN = 20000;
const SERIAL_MAX = 80000;
// Excel counts from 30 December 1899; workbooks made on old Macs from 1904.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAYS_1904 = 1462;

/**
 * A cell as text for a text column: trimmed, with whole numbers written
 * without a decimal point. Blank, or anything that is not a simple value,
 * becomes null.
 */
function text(value, maxLength = 1000) {
    if (value === null || value === undefined) return null;
    let out;
    if (typeof value === 'string') {
        out = value.trim();
    } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        // String() would switch to "1e+21" for very long numbers.
        out = Number.isInteger(value) ? BigInt(value).toString() : String(value);
    } else if (typeof value === 'boolean') {
        out = value ? 'TRUE' : 'FALSE'; // as Excel shows it
    } else {
        return null;
    }
    return out ? out.slice(0, maxLength) : null;
}

function buildDate(year, month, day) {
    const at = Date.UTC(year, month - 1, day);
    const date = new Date(at);
    // Date.UTC rolls 31 February over into March; that is a typo, not a date.
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    if (year < 1950 || year > 2120) return null;
    return date.toISOString().slice(0, 10);
}

function fullYear(text2or4) {
    const n = parseInt(text2or4, 10);
    if (text2or4.length > 2) return n;
    // "25" is 2025; "98" is 1998.
    return n <= (new Date().getUTCFullYear() % 100) + 10 ? 2000 + n : 1900 + n;
}

function fromSerial(n, date1904) {
    if (!Number.isFinite(n) || n < SERIAL_MIN || n > SERIAL_MAX) return null;
    const days = Math.floor(n) + (date1904 ? DAYS_1904 : 0);
    return new Date(EXCEL_EPOCH + days * 86400000).toISOString().slice(0, 10);
}

/**
 * A cell as a date. Resolves to { date, ok }: `date` is "YYYY-MM-DD" or null,
 * and `ok` is false when there was something in the cell that could not be
 * read as a date (so the caller can say so instead of storing it).
 *
 * Understands Excel's own dates, 2026-01-15, 15/01/2026 (day first, as
 * written in the UK; month first only when it cannot be otherwise), and
 * 15 Jan 2026 / January 15, 2026.
 */
function date(value, { date1904 = false } = {}) {
    if (value === null || value === undefined || value === '') return { date: null, ok: true };
    if (typeof value === 'number') {
        const found = fromSerial(value, date1904);
        return { date: found, ok: Boolean(found) };
    }
    if (typeof value !== 'string') return { date: null, ok: false };

    const input = value.trim();
    if (!input) return { date: null, ok: true };
    let found = null;
    let m;
    if ((m = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) {
        found = buildDate(+m[1], +m[2], +m[3]);
    } else if ((m = input.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
        const a = +m[1];
        const b = +m[2];
        const year = fullYear(m[3]);
        found = a <= 12 && b > 12 ? buildDate(year, a, b) : buildDate(year, b, a);
    } else if ((m = input.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})$/))) {
        const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
        if (month) found = buildDate(fullYear(m[3]), month, +m[1]);
    } else if ((m = input.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
        const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
        if (month) found = buildDate(+m[3], month, +m[2]);
    } else if (/^\d+(\.\d+)?$/.test(input)) {
        found = fromSerial(parseFloat(input), date1904);
    }
    return { date: found, ok: Boolean(found) };
}

/**
 * A cell as an amount of money, to the penny: 749, "749.00", "£1,249.50".
 * Blank or unreadable becomes null.
 */
function money(value) {
    if (value === null || value === undefined || value === '') return null;
    let n;
    if (typeof value === 'number') {
        n = value;
    } else if (typeof value === 'string') {
        const cleaned = value.replace(/[£$€,\s]|GBP/gi, '');
        if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
        n = parseFloat(cleaned);
    } else {
        return null;
    }
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
}

/**
 * An ISBN as text. Typed into a spreadsheet as a number, a ten-digit ISBN
 * that starts with 0 loses the zero; nine digits can only be that.
 */
function isbn(value) {
    const out = text(value, 40);
    if (!out) return null;
    return typeof value === 'number' && /^\d{9}$/.test(out) ? `0${out}` : out;
}

module.exports = { text, date, money, isbn };

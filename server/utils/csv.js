// CSV as spreadsheets expect it.
//
// - A byte-order mark, so Excel reads accents and £ as UTF-8 rather than
//   showing "ZoÃ«".
// - A leading apostrophe on text that starts with = + - or @, so a name such
//   as "-20C freezer" is shown as written instead of being run as a formula.
// - When nothing matched, one line saying so rather than an empty file.
const BOM = '﻿';

function cell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
    if (!rows || rows.length === 0) return `${BOM}No matching records`;
    const headers = Object.keys(rows[0]);
    return BOM + [headers.map(cell).join(','), ...rows.map((row) => headers.map((h) => cell(row[h])).join(','))].join('\r\n');
}

module.exports = { toCsv };

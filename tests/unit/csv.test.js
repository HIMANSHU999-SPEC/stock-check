const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toCsv } = require('../../server/utils/csv');

const BOM = '﻿';

test('starts with a byte-order mark and uses CRLF, as Excel expects', () => {
    assert.equal(toCsv([{ Name: 'Zoë', Price: 5 }, { Name: 'Al', Price: 6 }]), `${BOM}Name,Price\r\nZoë,5\r\nAl,6`);
});

test('quotes commas, quotes and line breaks', () => {
    assert.equal(toCsv([{ a: 'x, y', b: 'say "hi"', c: 'two\nlines' }]), `${BOM}a,b,c\r\n"x, y","say ""hi""","two\nlines"`);
});

test('text that a spreadsheet would run as a formula is defused', () => {
    const out = toCsv([{ a: '=SUM(A1:A9)', b: '-20C freezer', c: '@home', d: '+44 20', e: -20 }]);
    assert.equal(out, `${BOM}a,b,c,d,e\r\n'=SUM(A1:A9),'-20C freezer,'@home,'+44 20,-20`);
});

test('says so when there is nothing to list', () => {
    assert.equal(toCsv([]), `${BOM}No matching records`);
    assert.equal(toCsv(null), `${BOM}No matching records`);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const cells = require('../../server/utils/importValues');

test('text: numbers typed into a text column keep their digits', () => {
    assert.equal(cells.text(123456789012), '123456789012');
    assert.equal(cells.text(1e21), '1000000000000000000000');
    assert.equal(cells.text(12.5), '12.5');
    assert.equal(cells.text('  5CG1234ABC '), '5CG1234ABC');
    assert.equal(cells.text(true), 'TRUE');
});

test('text: blanks and things that are not values become null', () => {
    for (const value of [null, undefined, '', '   ', NaN, Infinity, {}, []]) {
        assert.equal(cells.text(value), null);
    }
    assert.equal(cells.text('abcdef', 3), 'abc');
});

test('date: Excel day counts', () => {
    assert.deepEqual(cells.date(46037), { date: '2026-01-15', ok: true });
    assert.deepEqual(cells.date('46037'), { date: '2026-01-15', ok: true });
    // Workbooks made on old Macs count from 1904.
    assert.deepEqual(cells.date(44575, { date1904: true }), { date: '2026-01-15', ok: true });
    // A quantity or a year is not a date.
    assert.equal(cells.date(12).ok, false);
    assert.equal(cells.date(2025).ok, false);
});

test('date: written dates, day first as in the UK', () => {
    assert.equal(cells.date('2026-01-15').date, '2026-01-15');
    assert.equal(cells.date('2026-01-15T09:30:00Z').date, '2026-01-15');
    assert.equal(cells.date('01/09/2025').date, '2025-09-01');
    assert.equal(cells.date('1.9.25').date, '2025-09-01');
    // Month first only when it cannot be day first.
    assert.equal(cells.date('09/13/2025').date, '2025-09-13');
    assert.equal(cells.date('15 Jan 2026').date, '2026-01-15');
    assert.equal(cells.date('1st September 2025').date, '2025-09-01');
    assert.equal(cells.date('January 15, 2026').date, '2026-01-15');
});

test('date: blank is fine, nonsense is reported', () => {
    assert.deepEqual(cells.date(''), { date: null, ok: true });
    assert.deepEqual(cells.date(null), { date: null, ok: true });
    assert.deepEqual(cells.date('31/02/2025'), { date: null, ok: false });
    assert.deepEqual(cells.date('last Tuesday'), { date: null, ok: false });
    assert.deepEqual(cells.date(true), { date: null, ok: false });
});

test('money: to the penny, whatever was typed', () => {
    assert.equal(cells.money(749), 749);
    assert.equal(cells.money('749.00'), 749);
    assert.equal(cells.money('£1,249.50'), 1249.5);
    assert.equal(cells.money('1249.50 GBP'), 1249.5);
    assert.equal(cells.money(19.999), 20);
    for (const value of ['', null, undefined, 'free', '-5', -5, {}, true]) {
        assert.equal(cells.money(value), null);
    }
});

test('isbn: a ten-digit ISBN that lost its leading zero gets it back', () => {
    assert.equal(cells.isbn(306406152), '0306406152');
    assert.equal(cells.isbn(9780306406157), '9780306406157');
    assert.equal(cells.isbn('030640615X'), '030640615X');
    assert.equal(cells.isbn(''), null);
});

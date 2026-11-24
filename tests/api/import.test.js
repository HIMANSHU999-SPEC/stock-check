const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

// A spreadsheet is read in the browser and arrives as rows of raw cells: a
// serial number may be a number, a date may be Excel's day count.
let app;
let admin;
before(async () => {
    app = await startApp();
    admin = await app.login();
});
after(() => app.stop());

const assetNamed = async (name) => {
    const list = (await admin.get(`/assets?search=${encodeURIComponent(name)}`)).body;
    const rows = Array.isArray(list) ? list : list.assets || list.items || [];
    return rows.find((row) => row.name === name);
};

test('assets: every cell is settled into what its column stores', async () => {
    const res = await admin.post('/assets/import', {
        items: [
            { name: 'HP EliteBook 840 G8', category: 'Laptop', serial_number: 123456789012, model: 840, purchase_date: 46037, purchase_price: '£749.00', quantity: 1, supplier: 'Acme' },
            { name: 'Dell Latitude 5420', category: 'laptop', serial_number: ' DL5420X1 ', purchase_date: '01/09/2025', purchase_price: 600, status: 'RETIRED' },
            { name: 'Office chair', category: 'Furniture', quantity: '10', purchase_price: '1,200', purchase_date: 'sometime last year' },
            { name: 'Mystery box', quantity: true, purchase_price: 'free', status: 'sold' }
        ]
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.inserted, 4);
    assert.equal(res.body.unread_dates, 1);

    const hp = await assetNamed('HP EliteBook 840 G8');
    assert.equal(hp.serial_number, '123456789012');
    assert.equal(hp.model, '840');
    assert.equal(hp.purchase_date, '2026-01-15');
    assert.equal(hp.purchase_price, 749);
    assert.equal(hp.supplier_name, 'Acme');

    const dell = await assetNamed('Dell Latitude 5420');
    assert.equal(dell.serial_number, 'DL5420X1');
    assert.equal(dell.purchase_date, '2025-09-01');
    assert.equal(dell.status, 'retired');
    assert.equal(dell.category_id, hp.category_id, 'Laptop and laptop are one category');

    const chairs = await assetNamed('Office chair');
    assert.equal(chairs.quantity, 10);
    assert.equal(chairs.purchase_price, 1200);
    assert.equal(chairs.purchase_date, null);

    const box = await assetNamed('Mystery box');
    assert.equal(box.quantity, 1);
    assert.equal(box.purchase_price, null);
    // A sale needs a buyer and a price, so a sheet cannot mark something sold.
    assert.equal(box.status, 'available');
});

test('assets: a workbook from an old Mac counts its dates from 1904', async () => {
    const res = await admin.post('/assets/import', { date1904: true, items: [{ name: 'iMac 24"', purchase_date: 44575 }] });
    assert.equal(res.status, 200);
    assert.equal((await assetNamed('iMac 24"')).purchase_date, '2026-01-15');
});

test('assets: an empty sheet is refused, and a big one is not', async () => {
    assert.equal((await admin.post('/assets/import', { items: [] })).status, 400);
    const items = Array.from({ length: 1500 }, (_, i) => ({ name: `Bulk item ${i + 1}`, category: 'Bulk', notes: 'x'.repeat(200) }));
    const res = await admin.post('/assets/import', { items });
    assert.equal(res.status, 200);
    assert.equal(res.body.inserted, 1500);
});

test('books: ISBNs and years typed as numbers', async () => {
    const res = await admin.post('/books/import', {
        items: [
            { title: 'Information Theory', author: 'R. Hamming', isbn: 306406152, published_year: 1980, quantity: 2 },
            { title: 'Networks', isbn: 9780306406157, published_year: 'unknown', quantity: 'three' },
            { isbn: '030640615X' }
        ]
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.inserted, 3);

    const books = (await admin.get('/books')).body;
    const byTitle = Object.fromEntries(books.map((book) => [book.title, book]));
    assert.equal(byTitle['Information Theory'].isbn, '0306406152');
    assert.equal(byTitle['Information Theory'].published_year, 1980);
    assert.equal(byTitle['Information Theory'].quantity, 2);
    assert.equal(byTitle.Networks.isbn, '9780306406157');
    assert.equal(byTitle.Networks.published_year, null);
    assert.equal(byTitle.Networks.quantity, 1);
    assert.equal(byTitle.Untitled.isbn, '030640615X');
});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

let app;
let admin;
let jane;
let omar;
before(async () => {
    app = await startApp();
    admin = await app.login();
    jane = (await admin.post('/employees', { name: 'Jane Smith', email: 'jane.smith@test.local', department: 'Business' })).body;
    omar = (await admin.post('/employees', { name: 'Omar Khan', email: 'omar.khan@test.local', department: 'IT' })).body;
    assert.ok(jane.id && omar.id);
});
after(() => app.stop());

const laptop = (extra = {}) => ({ name: 'HP EliteBook 840 G8', serial_number: '5CG1234ABC', purchase_price: 749, send_email: false, ...extra });
const fetchAsset = async (id) => (await admin.get(`/assets/${id}`)).body;

test('adding an asset: numbered, and filed by its name when the category is left blank', async () => {
    const res = await admin.post('/assets', laptop({ purchase_date: '15/01/2026' }));
    assert.equal(res.status, 201);
    assert.match(res.body.asset_number, /^AST-\d{4}-\d{4}$/);
    assert.equal(res.body.status, 'available');
    assert.equal(res.body.brand, 'HP');
    assert.equal(res.body.purchase_date, '2026-01-15');
    assert.equal(res.body.purchase_price, 749);

    const stored = await fetchAsset(res.body.id);
    assert.equal(stored.category_name, 'Laptop');
});

test('adding an asset: a name is needed and a date must be a date', async () => {
    assert.equal((await admin.post('/assets', { name: '   ' })).status, 400);
    const res = await admin.post('/assets', { name: 'Thing', purchase_date: 'last Tuesday' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /purchase date/i);
});

test('one serial number, one asset, unless told otherwise', async () => {
    const clash = await admin.post('/assets', laptop({ serial_number: '5cg-1234 abc' }));
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'duplicate_serial');
    assert.match(clash.body.error, /already has the serial number/);

    const allowed = await admin.post('/assets', laptop({ serial_number: '5cg-1234 abc', allow_duplicate_serial: true }));
    assert.equal(allowed.status, 201);
    // Placeholders never clash.
    assert.equal((await admin.post('/assets', { name: 'Monitor A', serial_number: 'N/A' })).status, 201);
    assert.equal((await admin.post('/assets', { name: 'Monitor B', serial_number: 'N/A' })).status, 201);
});

test('editing: a corrected serial number is kept, checked and written to the history', async () => {
    const asset = (await admin.post('/assets', { name: 'Dell Latitude 5420', serial_number: 'DL5420X1', purchase_price: 600 })).body;

    const clash = await admin.put(`/assets/${asset.id}`, { ...asset, serial_number: '5CG1234ABC' });
    assert.equal(clash.status, 409);

    const fixed = await admin.put(`/assets/${asset.id}`, { ...asset, serial_number: 'DL5420X2' });
    assert.equal(fixed.status, 200);
    const stored = await fetchAsset(asset.id);
    assert.equal(stored.serial_number, 'DL5420X2');
    assert.equal(stored.purchase_price, 600);
    assert.match(JSON.stringify(stored.history), /DL5420X1.*DL5420X2/);
});

test('assign, hand back, assign again, pass to someone else', async () => {
    const asset = (await admin.post('/assets', { name: 'Lenovo ThinkPad T14', serial_number: 'PF2ABCDE' })).body;

    const nobody = await admin.post(`/assets/${asset.id}/assign`, { send_email: false });
    assert.equal(nobody.status, 400);

    const given = await admin.post(`/assets/${asset.id}/assign`, { employee_id: jane.id, send_email: false });
    assert.equal(given.status, 200);
    assert.equal(given.body.status, 'assigned');
    let stored = await fetchAsset(asset.id);
    assert.equal(stored.assignments.length, 1);
    assert.equal(stored.assignments[0].employee_id, jane.id);

    // There is only one of it.
    const twice = await admin.post(`/assets/${asset.id}/assign`, { employee_id: omar.id, send_email: false });
    assert.equal(twice.status, 400);

    const passed = await admin.post(`/assets/${asset.id}/reassign`, { employee_id: omar.id, send_email: false });
    assert.equal(passed.status, 200);
    stored = await fetchAsset(asset.id);
    assert.deepEqual(stored.assignments.map((row) => row.employee_id), [omar.id]);

    const back = await admin.post(`/assets/${asset.id}/return`, { send_email: false });
    assert.equal(back.status, 200);
    assert.equal(back.body.status, 'available');
    assert.equal((await fetchAsset(asset.id)).assignments.length, 0);

    const room = await admin.post(`/assets/${asset.id}/assign`, { location: 'Room 204', send_email: false });
    assert.equal(room.status, 200);
    assert.equal((await fetchAsset(asset.id)).assignments[0].location_label, 'Room 204');
});

test('a stock line of several can be shared out, but not beyond what there is', async () => {
    const chairs = (await admin.post('/assets', { name: 'Office chair', quantity: 10, purchase_price: 20 })).body;
    assert.equal((await admin.post(`/assets/${chairs.id}/assign`, { employee_id: jane.id, quantity: 4, send_email: false })).status, 200);
    assert.equal((await admin.post(`/assets/${chairs.id}/assign`, { location: 'Room 101', quantity: 6, send_email: false })).status, 200);
    const more = await admin.post(`/assets/${chairs.id}/assign`, { employee_id: omar.id, quantity: 1, send_email: false });
    assert.equal(more.status, 400);
    const stored = await fetchAsset(chairs.id);
    assert.equal(stored.assigned_quantity, 10);
    assert.equal(stored.assignments.length, 2);
});

test('something out of service cannot be given to anyone', async () => {
    const asset = (await admin.post('/assets', { name: 'Broken projector', status: 'repair' })).body;
    const res = await admin.post(`/assets/${asset.id}/assign`, { employee_id: jane.id, send_email: false });
    assert.equal(res.status, 400);
});

test('selling to the person who uses it, and undoing a sale made by mistake', async () => {
    const asset = (await admin.post('/assets', { name: 'MacBook Air M1', serial_number: 'C02SELL0001', purchase_price: 999 })).body;
    await admin.post(`/assets/${asset.id}/assign`, { employee_id: jane.id, send_email: false });

    assert.equal((await admin.post(`/assets/${asset.id}/sell`, { employee_id: jane.id })).status, 400); // no price
    const sold = await admin.post(`/assets/${asset.id}/sell`, { employee_id: jane.id, price: 150, payment_reference: 'INV-77' });
    assert.equal(sold.status, 200);
    assert.equal(sold.body.status, 'sold');
    assert.equal(sold.body.sale.price, 150);

    let stored = await fetchAsset(asset.id);
    assert.equal(stored.assignments.length, 0, 'the buyer no longer holds it as college property');
    assert.equal((await admin.post(`/assets/${asset.id}/assign`, { employee_id: omar.id, send_email: false })).status, 400);

    const report = await admin.get('/reports/sales');
    assert.equal(report.body.total, 150);
    assert.equal(report.body.sales.length, 1);

    const undone = await admin.post(`/assets/${asset.id}/sale/undo`, { reason: 'wrong laptop' });
    assert.equal(undone.status, 200);
    stored = await fetchAsset(asset.id);
    assert.equal(stored.status, 'available');
    assert.equal((await admin.get('/reports/sales')).body.sales.length, 0);
});

test('deleting goes to the recycle bin, and an administrator can bring it back', async () => {
    const asset = (await admin.post('/assets', { name: 'Old keyboard' })).body;
    assert.equal((await admin.del(`/assets/${asset.id}`)).status, 200);
    assert.equal((await admin.get(`/assets/${asset.id}`)).status, 404);
    const bin = await admin.get('/assets/bin');
    assert.ok(JSON.stringify(bin.body).includes(asset.asset_number));

    assert.equal((await admin.post(`/assets/${asset.id}/restore`, {})).status, 200);
    assert.equal((await fetchAsset(asset.id)).name, 'Old keyboard');
});

test('finding an asset from a scanned sticker or serial number', async () => {
    const res = await admin.get('/assets/lookup?code=5cg1234abc');
    assert.equal(res.status, 200);
    assert.equal((await fetchAsset(res.body.id)).name, 'HP EliteBook 840 G8');
    assert.equal((await admin.get(`/assets/lookup?code=${res.body.asset_number}`)).body.id, res.body.id);
    assert.equal((await admin.get('/assets/lookup?code=NOSUCHTHING99')).status, 404);
});

test('the list of who holds what: one PDF for one person, a ZIP of PDFs for several', async () => {
    const mouse = (await admin.post('/assets', { name: 'Logitech wireless mouse M185' })).body;
    assert.equal((await admin.post(`/assets/${mouse.id}/assign`, { employee_id: omar.id, send_email: false })).status, 200);

    const one = await admin.get(`/assets/export/by-employees?employee_ids=${jane.id}`);
    assert.equal(one.status, 200);
    assert.match(one.headers.get('content-type'), /application\/pdf/);
    assert.ok(one.text.startsWith('%PDF-'));

    const res = await fetch(`${app.url}/api/assets/export/by-employees?employee_ids=${jane.id},${omar.id}`, {
        headers: { Authorization: `Bearer ${admin.token}` }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/zip/);
    const archive = Buffer.from(await res.arrayBuffer());
    assert.equal(Number(res.headers.get('content-length')), archive.length);

    // Opened with a reader that is not the code that wrote it.
    const XLSX = require('xlsx');
    const opened = XLSX.CFB.read(archive, { type: 'buffer' });
    const names = opened.FullPaths.filter((name) => name.endsWith('.pdf')).map((name) => name.replace(/^.*\//, ''));
    assert.deepEqual(names.sort(), [`assigned-assets-${jane.id}.pdf`, `assigned-assets-${omar.id}.pdf`].sort());
    const pdf = Buffer.from(XLSX.CFB.find(opened, `assigned-assets-${jane.id}.pdf`).content);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

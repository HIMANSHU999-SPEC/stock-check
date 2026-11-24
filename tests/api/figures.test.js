const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

// The headline figures: Total Assets and Total Value, on the dashboard, the
// reports and the inventory page.
let app;
let admin;
before(async () => {
    app = await startApp();
    admin = await app.login();
    const buyer = (await admin.post('/employees', { name: 'Jane Smith', email: 'jane.smith@test.local' })).body;
    const add = async (body) => {
        const res = await admin.post('/assets', { campus: 'Towerhill', supplier_name: 'Acme', ...body });
        assert.equal(res.status, 201);
        return res.body;
    };
    await add({ name: 'HP EliteBook 840 G8', purchase_price: 500 });                       // held: 1 × £500
    await add({ name: 'Office chair', quantity: 10, purchase_price: 20 });                 // held: 10 × £20
    await add({ name: 'Dell Latitude 5420', purchase_price: 300, status: 'lost' });        // written off
    await add({ name: 'Lenovo ThinkPad T14', purchase_price: 100, status: 'retired' });    // written off
    await add({ name: 'Dell monitor P2422H', quantity: 2, purchase_price: 50, status: 'stolen' }); // written off: 2 × £50
    await add({ name: 'Projector, no price recorded', status: 'repair' });                 // held, worth nothing on paper
    const sold = await add({ name: 'MacBook Air M1', purchase_price: 400 });
    assert.equal((await admin.post(`/assets/${sold.id}/sell`, { employee_id: buyer.id, price: 120 })).status, 200);
    const binned = await add({ name: 'Deleted by mistake', purchase_price: 9999 });
    assert.equal((await admin.del(`/assets/${binned.id}`)).status, 200);
});
after(() => app.stop());

const summary = async () => (await admin.get('/reports/summary')).body;
const setCounting = async (value) => {
    const res = await admin.put('/settings/integrations', { count_written_off: value });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.count_written_off, value);
};

test('to begin with, lost, stolen and retired items are counted; sold and deleted ones never are', async () => {
    const figures = await summary();
    assert.equal(figures.total, 1 + 10 + 1 + 1 + 2 + 1);
    // Value is the price of one multiplied by how many there are.
    assert.equal(figures.total_value, 500 + 10 * 20 + 300 + 100 + 2 * 50);
    assert.deepEqual(figures.not_counted, ['sold']);
});

test('with the setting off, only what is still held is counted', async () => {
    await setCounting(false);
    const figures = await summary();
    assert.equal(figures.total, 1 + 10 + 1);
    assert.equal(figures.total_value, 500 + 10 * 20);
    assert.deepEqual(figures.not_counted, ['sold', 'lost', 'stolen', 'retired']);
    // "Ready to assign" never included them, so it does not move.
    assert.equal(figures.available, 11);
});

test('every breakdown adds up to the same total, whichever way the setting is', async () => {
    for (const counted of [false, true]) {
        await setCounting(counted);
        const figures = await summary();
        const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] || 0), 0);

        for (const report of ['by-supplier', 'by-campus', 'by-brand', 'by-model']) {
            const rows = (await admin.get(`/reports/${report}`)).body;
            assert.equal(sum(rows, 'total_value'), figures.total_value, `${report} value, counting=${counted}`);
            assert.equal(sum(rows, 'total_quantity'), figures.total, `${report} quantity, counting=${counted}`);
        }
        const byCategory = (await admin.get('/reports/by-category')).body;
        assert.equal(sum(byCategory, 'total_value'), figures.total_value, `by-category value, counting=${counted}`);

        const inventory = (await admin.get('/inventory/summary')).body;
        assert.equal(inventory.totals.value, figures.total_value, `inventory value, counting=${counted}`);
    }
});

test('the inventory page still lists everything on the register, in its own columns', async () => {
    await setCounting(false);
    const { totals } = (await admin.get('/inventory/summary')).body;
    assert.equal(totals.total, 17);
    assert.equal(totals.written_off, 5);
    assert.equal(totals.in_repair, 1);
    assert.equal(totals.available + totals.assigned + totals.in_repair + totals.written_off, totals.total);
});

test('a view-only account sees the figures but cannot change the setting', async () => {
    await admin.post('/users', { name: 'Vera Viewer', email: 'vera@test.local', role: 'viewer', password: 'veras-password' });
    const vera = await app.login('vera@test.local', 'veras-password');
    assert.equal((await vera.put('/settings/integrations', { count_written_off: true })).status, 403);
    // She still sees the figures, and what they leave out.
    assert.deepEqual((await vera.get('/reports/summary')).body.not_counted, ['sold', 'lost', 'stolen', 'retired']);
});

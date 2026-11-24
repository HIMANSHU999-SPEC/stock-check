const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

// Who may do what: administrator, sub-administrator, viewer + downloads,
// viewer, and ordinary staff who see only their own assets.
let app;
let admin;
let subadmin;
let inventory;
let viewer;
let staff;
let asset;
let jane;
before(async () => {
    app = await startApp();
    admin = await app.login();
    for (const role of ['subadmin', 'inventory', 'viewer']) {
        const res = await admin.post('/users', { name: role, email: `${role}@test.local`, role, password: `${role}-password` });
        assert.equal(res.status, 201);
    }
    subadmin = await app.login('subadmin@test.local', 'subadmin-password');
    inventory = await app.login('inventory@test.local', 'inventory-password');
    viewer = await app.login('viewer@test.local', 'viewer-password');

    jane = (await admin.post('/employees', { name: 'Jane Smith', email: 'jane.smith@test.local' })).body;
    const other = (await admin.post('/employees', { name: 'Omar Khan', email: 'omar.khan@test.local' })).body;
    asset = (await admin.post('/assets', { name: 'HP EliteBook 840 G8', serial_number: '5CG1234ABC' })).body;
    const omars = (await admin.post('/assets', { name: 'Dell Latitude 5420', serial_number: 'DL5420X1' })).body;
    await admin.post(`/assets/${asset.id}/assign`, { employee_id: jane.id, send_email: false });
    await admin.post(`/assets/${omars.id}/assign`, { employee_id: other.id, send_email: false });
    // Jane is on the staff list but has no account: a staff session.
    staff = app.tokenFor({ employeeId: jane.id });
});
after(() => app.stop());

test('view-only accounts can read but never change', async () => {
    for (const account of [viewer, inventory]) {
        assert.equal((await account.get('/assets')).status, 200);
        assert.equal((await account.get(`/assets/${asset.id}`)).status, 200);
        assert.equal((await account.get('/reports/summary')).status, 200);
        assert.equal((await account.post('/assets', { name: 'Sneaked in' })).status, 403);
        assert.equal((await account.put(`/assets/${asset.id}`, { name: 'Renamed' })).status, 403);
        assert.equal((await account.del(`/assets/${asset.id}`)).status, 403);
        assert.equal((await account.post(`/assets/${asset.id}/return`, {})).status, 403);
    }
    assert.equal((await admin.get(`/assets/${asset.id}`)).body.name, 'HP EliteBook 840 G8');
});

test('the areas for running the system are closed to view-only accounts', async () => {
    for (const account of [viewer, inventory]) {
        for (const route of ['/users', '/settings/integrations', '/activity', '/staff-reports', '/intune/check']) {
            assert.equal((await account.get(route)).status, 403, route);
        }
        // What every screen needs to draw itself stays open.
        assert.equal((await account.get('/settings/public')).status, 200);
    }
});

test('downloads need the "viewer + downloads" role', async () => {
    assert.equal((await viewer.get('/assets/export/by-category')).status, 403);
    assert.equal((await viewer.get(`/employees/${jane.id}/report`)).status, 403);
    const res = await inventory.get('/assets/export/by-category');
    assert.equal(res.status, 200);
    assert.match(res.text, /HP EliteBook 840 G8/);
});

test('a sub-administrator works with assets but not with accounts or settings', async () => {
    const made = await subadmin.post('/assets', { name: 'Logitech wireless mouse M185' });
    assert.equal(made.status, 201);
    assert.equal((await subadmin.get('/users')).status, 403);
    assert.equal((await subadmin.put('/settings/integrations', { org_name: 'Mine now' })).status, 403);
    assert.equal((await subadmin.post('/users', { name: 'x', email: 'x@test.local', role: 'admin', password: 'x-password-1' })).status, 403);
});

test('an administrator cannot change their own role or remove themselves', async () => {
    const me = (await admin.get('/auth/me')).body.user;
    assert.equal((await admin.put(`/users/${me.id}`, { name: me.name, role: 'viewer' })).status, 400);
    assert.equal((await admin.del(`/users/${me.id}`)).status, 400);
    assert.equal((await admin.get('/auth/me')).body.user.role, 'admin');
});

test('ordinary staff see their own assets and nothing else', async () => {
    const mine = await staff.get('/my/assets');
    assert.equal(mine.status, 200);
    const text = JSON.stringify(mine.body);
    assert.match(text, /HP EliteBook 840 G8/);
    assert.doesNotMatch(text, /Dell Latitude 5420/);

    for (const route of ['/assets', `/assets/${asset.id}`, '/employees', '/reports/summary', '/users', '/settings/public']) {
        assert.equal((await staff.get(route)).status, 401, route);
    }
    assert.equal((await staff.get('/auth/me')).body.user.role, 'staff');
});

test('a member of staff marked inactive loses access at once', async () => {
    assert.equal((await staff.get('/my/assets')).status, 200);
    const db = app.db();
    db.prepare("UPDATE employees SET status = 'inactive' WHERE id = ?").run(jane.id);
    db.close();
    assert.equal((await staff.get('/my/assets')).status, 401);
});

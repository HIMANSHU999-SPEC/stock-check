const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN } = require('../helpers/app');

let app;
let admin;
before(async () => {
    app = await startApp();
    admin = await app.login();
});
after(() => app.stop());

test('signing in: wrong password refused, email matched in any case', async () => {
    const wrong = await app.request('POST', '/auth/login', { body: { email: ADMIN.email, password: 'not-it' } });
    assert.equal(wrong.status, 401);

    const shouting = await app.request('POST', '/auth/login', { body: { email: ADMIN.email.toUpperCase(), password: ADMIN.password } });
    assert.equal(shouting.status, 200);
    assert.equal(shouting.body.user.role, 'admin');
    assert.ok(shouting.body.token);
});

test('nothing but sign-in is open without a session', async () => {
    assert.equal((await app.request('GET', '/assets')).status, 401);
    assert.equal((await app.request('GET', '/auth/me')).status, 401);
    assert.equal((await app.request('GET', '/assets', { token: 'made-up' })).status, 401);
});

test('an address that does not exist answers in JSON, not with the web page', async () => {
    const res = await admin.get('/no-such-thing');
    assert.equal(res.status, 404);
    assert.equal(typeof res.body.error, 'string');
});

test('who am I: says whether this account can change its password', async () => {
    const me = await admin.get('/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, ADMIN.email);
    assert.equal(me.body.user.can_change_password, true);
    assert.equal(me.body.user.password_hash, undefined);
});

test('changing your own password: any role, with the current one', async () => {
    const created = await admin.post('/users', { name: 'Vera Viewer', email: 'vera@test.local', role: 'viewer', password: 'first-password' });
    assert.equal(created.status, 201);
    const vera = await app.login('vera@test.local', 'first-password');

    const change = (body) => vera.post('/auth/change-password', body);
    assert.equal((await change({ current_password: 'wrong', new_password: 'second-password' })).status, 403);
    assert.equal((await change({ current_password: 'first-password', new_password: 'short' })).status, 400);
    assert.equal((await change({ current_password: 'first-password', new_password: 'first-password' })).status, 400);
    assert.equal((await change({ new_password: 'second-password' })).status, 400);
    assert.equal((await change({ current_password: 'first-password', new_password: 12345678 })).status, 400);

    const done = await change({ current_password: 'first-password', new_password: 'second-password' });
    assert.equal(done.status, 200);

    const old = await app.request('POST', '/auth/login', { body: { email: 'vera@test.local', password: 'first-password' } });
    assert.equal(old.status, 401);
    await app.login('vera@test.local', 'second-password');

    const log = await admin.get('/activity');
    assert.match(JSON.stringify(log.body), /vera@test\.local changed their own password/);
});

test('nobody can change someone else\'s password this way', async () => {
    await admin.post('/users', { name: 'Ian Inventory', email: 'ian@test.local', role: 'inventory', password: 'ians-password' });
    const ian = await app.login('ian@test.local', 'ians-password');

    // Ian names the administrator's account and guesses at its password.
    const guess = await ian.post('/auth/change-password', {
        email: ADMIN.email, current_password: 'a-guess-at-it', new_password: 'taken-over-123'
    });
    assert.equal(guess.status, 403);
    // Even knowing it, naming another account does nothing: only his own
    // current password counts, and only his own password changes.
    const named = await ian.post('/auth/change-password', {
        email: ADMIN.email, current_password: ADMIN.password, new_password: 'taken-over-123'
    });
    assert.equal(named.status, 403);
    // Without a session there is nothing to change, whatever is sent.
    const anonymous = await app.request('POST', '/auth/change-password', {
        body: { email: ADMIN.email, current_password: ADMIN.password, new_password: 'taken-over-123' }
    });
    assert.equal(anonymous.status, 401);

    await app.login(); // the administrator's password still works
    await app.login('ian@test.local', 'ians-password'); // and so does Ian's
});

test('an account that signs in with Microsoft only has no password to change', async () => {
    const db = app.db();
    const id = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Sam Sso', 'sam@test.local', ?, 'subadmin')")
        .run('microsoft sign-in only').lastInsertRowid;
    db.close();

    const sam = app.tokenFor({ userId: Number(id), role: 'subadmin' });
    const me = await sam.get('/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.can_change_password, false);
    const res = await sam.post('/auth/change-password', { current_password: 'microsoft sign-in only', new_password: 'a-new-password' });
    assert.equal(res.status, 403);
});

test('without a licence the app is closed, and only the script can open it', async () => {
    const db = app.db();
    const saved = db.prepare("SELECT value FROM settings WHERE key = 'license'").get().value;
    db.prepare("UPDATE settings SET value = ? WHERE key = 'license'")
        .run(JSON.stringify({ status: 'active', activated_at: 1, expires_at: Date.now() - 1000 }));
    try {
        const res = await admin.get('/assets');
        assert.equal(res.status, 403);
        assert.match(res.body.error, /licen[cs]e/i);
        // There is no activation call to try.
        assert.equal((await admin.post('/auth/activate', { code: 'anything' })).status, 404);
    } finally {
        db.prepare("UPDATE settings SET value = ? WHERE key = 'license'").run(saved);
        db.close();
    }
    assert.equal((await admin.get('/assets')).status, 200);
});

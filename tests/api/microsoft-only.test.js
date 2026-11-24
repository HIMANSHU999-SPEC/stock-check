const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN } = require('../helpers/app');
const { startMicrosoft, signInWithMicrosoft } = require('../helpers/microsoft');

// Once Microsoft sign-in is set up it is the only way in. Microsoft is played
// by a stand-in on this machine that takes the same steps and signs its
// tokens the same way.
let microsoft;
let app;
let admin;
before(async () => {
    microsoft = await startMicrosoft();
    app = await startApp({ env: microsoft.envWithSignIn });
    const signedIn = await signInWithMicrosoft(app, microsoft, ADMIN.email);
    assert.ok(signedIn.token, `the administrator should get in: ${signedIn.error}`);
    admin = app.session(signedIn.token);
});
after(async () => {
    await app.stop();
    await microsoft.stop();
});

test('the sign-in screen is told: Microsoft, and no passwords', async () => {
    const res = await app.request('GET', '/auth/sso/config');
    assert.deepEqual(res.body, { enabled: true, password_login: false });
});

test('a correct email and password no longer get anyone in', async () => {
    const res = await app.request('POST', '/auth/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Microsoft/);
    assert.equal(res.body.token, undefined);
});

test('there is no password to change or reset, by anyone', async () => {
    assert.equal((await admin.get('/auth/me')).body.user.can_change_password, false);
    const own = await admin.post('/auth/change-password', { current_password: ADMIN.password, new_password: 'a-new-password' });
    assert.equal(own.status, 403);
    const anonymous = await app.request('POST', '/auth/change-password', {
        body: { email: ADMIN.email, current_password: ADMIN.password, new_password: 'a-new-password' }
    });
    assert.equal(anonymous.status, 401);
});

test('an administrator signs in with Microsoft and gets their role', async () => {
    const me = await admin.get('/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, ADMIN.email);
    assert.equal(me.body.user.role, 'admin');
    assert.equal((await admin.get('/users')).status, 200);
    assert.match(JSON.stringify((await admin.get('/activity')).body), /Signed in with Microsoft/);
});

test('accounts are made without passwords; a password is refused, not quietly dropped', async () => {
    const withPassword = await admin.post('/users', { name: 'Vera Viewer', email: 'vera@test.local', role: 'viewer', password: 'veras-password' });
    assert.equal(withPassword.status, 400);
    assert.match(withPassword.body.error, /Microsoft/);

    const made = await admin.post('/users', { name: 'Vera Viewer', email: 'Vera@test.local', role: 'viewer' });
    assert.equal(made.status, 201);
    assert.equal(made.body.has_password, 0);
    assert.equal((await admin.put(`/users/${made.body.id}`, { name: 'Vera', role: 'viewer', password: 'veras-password' })).status, 400);

    // She signs in with Microsoft, whatever case her address is typed in.
    const vera = await signInWithMicrosoft(app, microsoft, 'vera@TEST.local', '/reports');
    assert.ok(vera.token, vera.error);
    assert.equal(vera.returnTo, '/reports');
    const session = app.session(vera.token);
    assert.equal((await session.get('/auth/me')).body.user.role, 'viewer');
    assert.equal((await session.post('/assets', { name: 'Sneaked in' })).status, 403);
});

test('someone on the staff list sees only their own assets; a stranger is turned away', async () => {
    const jane = (await admin.post('/employees', { name: 'Jane Smith', email: 'jane.smith@test.local' })).body;
    const laptop = (await admin.post('/assets', { name: 'HP EliteBook 840 G8', serial_number: '5CG1234ABC' })).body;
    await admin.post(`/assets/${laptop.id}/assign`, { employee_id: jane.id, send_email: false });

    const staff = await signInWithMicrosoft(app, microsoft, 'jane.smith@test.local');
    assert.ok(staff.token, staff.error);
    assert.equal(staff.returnTo, '/my-assets');
    const session = app.session(staff.token);
    assert.match(JSON.stringify((await session.get('/my/assets')).body), /HP EliteBook 840 G8/);
    assert.equal((await session.get('/assets')).status, 401);

    const stranger = await signInWithMicrosoft(app, microsoft, 'stranger@elsewhere.example');
    assert.equal(stranger.token, null);
    assert.match(stranger.error, /not on the staff list/);

    // She leaves: the laptop comes back, and she is marked inactive.
    assert.equal((await admin.post(`/assets/${laptop.id}/return`, { send_email: false })).status, 200);
    assert.equal((await admin.post(`/employees/${jane.id}/deactivate`, {})).status, 200);
    const leaver = await signInWithMicrosoft(app, microsoft, 'jane.smith@test.local');
    assert.equal(leaver.token, null);
    assert.match(leaver.error, /no longer active/);
});

test('a token that is not genuinely from this organisation\'s Microsoft is refused', async () => {
    for (const wrong of ['signature', 'audience', 'tenant', 'expired', 'nonce']) {
        microsoft.state.tamper = wrong;
        try {
            const res = await signInWithMicrosoft(app, microsoft, ADMIN.email);
            assert.equal(res.token, null, `${wrong}: must not get a session`);
            assert.ok(res.error, `${wrong}: says why`);
        } finally {
            microsoft.state.tamper = null;
        }
    }
    assert.ok((await signInWithMicrosoft(app, microsoft, ADMIN.email)).token, 'and a genuine one still works');
});

test('a sign-in cannot be finished by a browser that did not start it', async () => {
    microsoft.state.signInAs = ADMIN.email;
    const start = await fetch(`${app.url}/api/auth/sso/login`, { redirect: 'manual' });
    const atMicrosoft = await fetch(start.headers.get('location'), { redirect: 'manual' });
    // The callback address, opened without the cookie the first browser was given.
    const back = await fetch(atMicrosoft.headers.get('location'), { redirect: 'manual' });
    const landing = new URL(back.headers.get('location'));
    assert.equal(landing.hash, '');
    assert.ok(landing.searchParams.get('sso_error'));
});

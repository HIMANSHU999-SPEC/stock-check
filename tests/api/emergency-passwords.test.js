const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, ADMIN } = require('../helpers/app');
const { startMicrosoft, signInWithMicrosoft } = require('../helpers/microsoft');

// The way back in if Microsoft sign-in itself is broken: someone with access
// to the server sets ALLOW_PASSWORD_LOGIN=true and restarts. Nothing in the
// web app can switch it on.
let microsoft;
let app;
before(async () => {
    microsoft = await startMicrosoft();
    app = await startApp({ env: (url) => ({ ...microsoft.envWithSignIn(url), ALLOW_PASSWORD_LOGIN: 'true' }) });
});
after(async () => {
    await app.stop();
    await microsoft.stop();
});

test('with the emergency switch set on the server, both ways work', async () => {
    assert.deepEqual((await app.request('GET', '/auth/sso/config')).body, { enabled: true, password_login: true });
    const byPassword = await app.login();
    assert.equal((await byPassword.get('/auth/me')).body.user.email, ADMIN.email);
    assert.ok((await signInWithMicrosoft(app, microsoft, ADMIN.email)).token);
});

test('the switch is not something the app can change', async () => {
    const admin = await app.login();
    const res = await admin.put('/settings/integrations', { allow_password_login: false, ALLOW_PASSWORD_LOGIN: 'false' });
    assert.equal(res.status, 200);
    assert.equal((await app.request('GET', '/auth/sso/config')).body.password_login, true);
});

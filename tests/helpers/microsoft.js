// A stand-in for Microsoft sign-in and Microsoft Graph, on this machine
// only. It answers what the tests need: a person signing in (the same
// OpenID Connect steps Microsoft takes, with a signed ID token), the app's
// own token, Intune's list of managed devices (in pages), and sending mail.
const http = require('node:http');
const crypto = require('node:crypto');

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'test-client';
const SECRET = 'test-client-secret';

function startMicrosoft() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
    const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
    const codes = new Map();
    const idToken = (claims, key) => {
        const unsigned = `${b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${b64(claims)}`;
        return `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
    };

    const state = {
        // Who "signs in" when the app sends a browser here.
        signInAs: 'someone@test.local',
        // Make the ID token wrong in one way: 'signature', 'audience',
        // 'tenant', 'expired' or 'nonce'. The app must refuse each.
        tamper: null,
        devices: [],
        pageSize: 4,
        // Set to answer as Graph does when the permission has not been granted.
        refuseIntune: false,
        mails: [],
        requests: []
    };

    const send = (res, status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body === undefined ? '' : JSON.stringify(body));
    };

    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            const base = `http://127.0.0.1:${server.address().port}`;
            const url = new URL(req.url, base);
            const route = decodeURIComponent(url.pathname);
            state.requests.push(`${req.method} ${route}`);

            // The sign-in page: no page here, the chosen person is "signed in"
            // at once and the browser is sent back with a one-time code.
            if (route === `/${TENANT}/oauth2/v2.0/authorize`) {
                const query = url.searchParams;
                if (query.get('client_id') !== CLIENT || query.get('code_challenge_method') !== 'S256') {
                    return send(res, 400, { error: 'bad authorize request' });
                }
                const code = crypto.randomBytes(8).toString('hex');
                codes.set(code, {
                    nonce: query.get('nonce'), challenge: query.get('code_challenge'),
                    redirect: query.get('redirect_uri'), email: state.signInAs
                });
                const back = new URL(query.get('redirect_uri'));
                back.searchParams.set('code', code);
                back.searchParams.set('state', query.get('state'));
                res.writeHead(302, { Location: back.toString() });
                return res.end();
            }
            if (route === `/${TENANT}/discovery/v2.0/keys`) return send(res, 200, { keys: [jwk] });

            if (route === `/${TENANT}/oauth2/v2.0/token`) {
                const form = new URLSearchParams(raw);
                if (form.get('client_id') !== CLIENT || form.get('client_secret') !== SECRET) {
                    return send(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
                }
                if (form.get('grant_type') === 'client_credentials') {
                    return send(res, 200, { access_token: 'app-token', expires_in: 3600, token_type: 'Bearer' });
                }
                // A person's sign-in: the code works once, and only for the
                // browser that started it (PKCE).
                const pending = codes.get(form.get('code'));
                codes.delete(form.get('code'));
                const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
                if (!pending || challenge !== pending.challenge || form.get('redirect_uri') !== pending.redirect) {
                    return send(res, 400, { error: 'invalid_grant', error_description: 'The code is not valid for this sign-in.' });
                }
                const now = Math.floor(Date.now() / 1000);
                const claims = {
                    aud: state.tamper === 'audience' ? 'another-app' : CLIENT,
                    iss: `${base}/${TENANT}/v2.0`,
                    tid: state.tamper === 'tenant' ? '99999999-0000-0000-0000-000000000000' : TENANT,
                    iat: now,
                    nbf: now,
                    exp: state.tamper === 'expired' ? now - 3600 : now + 3600,
                    nonce: state.tamper === 'nonce' ? 'from-another-sign-in' : pending.nonce,
                    name: pending.email.split('@')[0],
                    preferred_username: pending.email,
                    sub: 'test-subject'
                };
                const key = state.tamper === 'signature'
                    ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
                    : privateKey;
                return send(res, 200, { id_token: idToken(claims, key), access_token: 'unused', token_type: 'Bearer' });
            }

            if (!route.startsWith('/graph/')) return send(res, 404, { error: 'not found' });
            if (req.headers.authorization !== 'Bearer app-token') {
                return send(res, 401, { error: { code: 'InvalidAuthenticationToken', message: 'no token' } });
            }
            const graph = route.slice('/graph'.length);

            if (graph === '/deviceManagement/managedDevices' && req.method === 'GET') {
                if (state.refuseIntune) {
                    return send(res, 403, { error: { code: 'Forbidden', message: 'Application is not authorized to perform this operation. Application must have one of the following scopes: DeviceManagementManagedDevices.Read.All' } });
                }
                const fields = (url.searchParams.get('$select') || '').split(',').filter(Boolean);
                const skip = parseInt(url.searchParams.get('$skiptoken') || '0', 10);
                const page = state.devices.slice(skip, skip + state.pageSize)
                    .map((device) => Object.fromEntries(fields.map((field) => [field, device[field] ?? null])));
                const out = { value: page };
                if (skip + state.pageSize < state.devices.length) {
                    out['@odata.nextLink'] = `${base}/graph/deviceManagement/managedDevices?$select=${fields.join(',')}&$skiptoken=${skip + state.pageSize}`;
                }
                return send(res, 200, out);
            }

            const mail = graph.match(/^\/users\/([^/]+)\/sendMail$/);
            if (mail && req.method === 'POST') {
                state.mails.push({ from: mail[1], ...JSON.parse(raw || '{}') });
                res.writeHead(202);
                return res.end();
            }
            return send(res, 404, { error: { code: 'BadRequest', message: `stand-in: nothing answers ${req.method} ${graph}` } });
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const base = `http://127.0.0.1:${server.address().port}`;
            resolve({
                state,
                // What the server under test needs in its environment to talk to this.
                env: {
                    ENTRA_TENANT_ID: TENANT,
                    ENTRA_CLIENT_ID: CLIENT,
                    ENTRA_CLIENT_SECRET: SECRET,
                    ENTRA_AUTHORITY_HOST: base,
                    GRAPH_BASE_URL: `${base}/graph`,
                    SSO_ENABLED: 'false'
                },
                // The same, with people signing in through it too. The app
                // has to know its own address for Microsoft to send them back.
                envWithSignIn: (appUrl) => ({
                    ENTRA_TENANT_ID: TENANT,
                    ENTRA_CLIENT_ID: CLIENT,
                    ENTRA_CLIENT_SECRET: SECRET,
                    ENTRA_AUTHORITY_HOST: base,
                    GRAPH_BASE_URL: `${base}/graph`,
                    APP_BASE_URL: appUrl
                }),
                stop: () => new Promise((done) => server.close(done))
            });
        });
    });
}

// One device as Intune reports it.
function device(deviceName, serialNumber, user, daysSinceSync, extra = {}) {
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    return {
        id: `dev-${deviceName}`,
        deviceName,
        serialNumber,
        manufacturer: extra.manufacturer || 'HP',
        model: extra.model || 'EliteBook',
        userPrincipalName: user || '',
        userDisplayName: user ? user.split('@')[0] : '',
        emailAddress: user || '',
        operatingSystem: extra.os || 'Windows',
        osVersion: '10.0.22631',
        lastSyncDateTime: daysSinceSync === null ? '0001-01-01T00:00:00Z' : ago(daysSinceSync),
        enrolledDateTime: ago(400),
        complianceState: 'compliant',
        managedDeviceOwnerType: extra.owner || 'company',
        // Not in the list of fields the app asks for; must never come back.
        notRequested: 'should not be selected'
    };
}

/**
 * Sign in to the app as a browser would: the app sends us to "Microsoft",
 * which sends us back with a code, and the app finishes the job. Resolves
 * with { token, landing, error }: a session token when the person was let
 * in, or the message the sign-in screen would show when they were not.
 */
async function signInWithMicrosoft(app, microsoft, email, returnTo = '/') {
    microsoft.state.signInAs = email;
    const start = await fetch(`${app.url}/api/auth/sso/login?returnTo=${encodeURIComponent(returnTo)}`, { redirect: 'manual' });
    const cookie = start.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
    const atMicrosoft = await fetch(start.headers.get('location'), { redirect: 'manual' });
    const back = await fetch(atMicrosoft.headers.get('location'), { redirect: 'manual', headers: { Cookie: cookie } });
    const landing = new URL(back.headers.get('location'));
    const fragment = new URLSearchParams(landing.hash.slice(1));
    return {
        landing,
        token: fragment.get('token'),
        returnTo: fragment.get('returnTo'),
        error: landing.searchParams.get('sso_error')
    };
}

module.exports = { startMicrosoft, device, signInWithMicrosoft };

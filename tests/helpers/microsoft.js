// A stand-in for Microsoft sign-in and Microsoft Graph, on this machine
// only. It answers the three calls the tests need: the app's own token,
// Intune's list of managed devices (in pages), and sending mail.
const http = require('node:http');

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'test-client';
const SECRET = 'test-client-secret';

function startMicrosoft() {
    const state = {
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

            if (route === `/${TENANT}/oauth2/v2.0/token`) {
                const form = new URLSearchParams(raw);
                if (form.get('client_id') !== CLIENT || form.get('client_secret') !== SECRET) {
                    return send(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
                }
                return send(res, 200, { access_token: 'app-token', expires_in: 3600, token_type: 'Bearer' });
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

module.exports = { startMicrosoft, device };

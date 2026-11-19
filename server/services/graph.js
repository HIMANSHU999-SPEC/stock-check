const { entra } = require('../config');

// Microsoft Graph client using the app's own identity (client-credentials
// flow). Used for sending mail and for the SharePoint list sync; neither acts
// on behalf of the signed-in user, so no user tokens are ever stored.

class GraphError extends Error {
    constructor(message, { status = 0, code = '', retryAfter = 0 } = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }
}

const REQUEST_TIMEOUT_MS = 15000;
let cachedToken = null; // { value, expiresAt }

async function getAppToken() {
    if (!entra.configured) {
        throw new GraphError('Microsoft 365 is not configured (ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET)');
    }
    if (cachedToken && cachedToken.expiresAt - 60000 > Date.now()) {
        return cachedToken.value;
    }

    let response;
    try {
        response = await fetch(`${entra.authorityHost}/${entra.tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: entra.clientId,
                client_secret: entra.clientSecret,
                scope: entra.graphScope
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (err) {
        throw new GraphError(`Could not reach Microsoft sign-in: ${err.message}`);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
        throw new GraphError(
            `Microsoft sign-in refused the app credentials: ${data.error_description || data.error || response.status}`,
            { status: response.status, code: data.error || '' }
        );
    }
    cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    return cachedToken.value;
}

/**
 * Call Microsoft Graph. `path` is relative to the v1.0 root ("/sites/…").
 * Resolves with the parsed JSON body (or null for 202/204), and throws a
 * GraphError carrying Graph's own error code and message otherwise.
 */
async function graph(method, path, { body, headers = {} } = {}) {
    const token = await getAppToken();
    let response;
    try {
        response = await fetch(`${entra.graphBaseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...headers
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (err) {
        throw new GraphError(`Could not reach Microsoft Graph: ${err.message}`);
    }

    if (response.status === 401) cachedToken = null;

    const text = await response.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch (e) { data = null; }
    }

    if (!response.ok) {
        const err = data && data.error ? data.error : {};
        throw new GraphError(err.message || `Microsoft Graph returned ${response.status}`, {
            status: response.status,
            code: err.code || '',
            retryAfter: parseInt(response.headers.get('retry-after'), 10) || 0
        });
    }
    return data;
}

/**
 * GET a collection and follow Graph's paging links to the end. Resolves with
 * every item. A next link is only followed while it stays on the Graph host
 * the app is configured for, so the token is never sent anywhere else.
 */
async function graphAll(path, { headers, maxPages = 200 } = {}) {
    const items = [];
    let next = path;
    for (let page = 0; next && page < maxPages; page += 1) {
        const data = await graph('GET', next, { headers });
        if (data && Array.isArray(data.value)) items.push(...data.value);
        const link = data && data['@odata.nextLink'];
        if (!link) break;
        if (!String(link).startsWith(`${entra.graphBaseUrl}/`)) {
            throw new GraphError('Microsoft Graph returned a paging link to an unexpected address');
        }
        next = String(link).slice(entra.graphBaseUrl.length);
    }
    return items;
}

// Turn the common failures into something an IT admin can act on.
function explainGraphError(err, permission) {
    if (!(err instanceof GraphError)) return err.message;
    if (err.status === 403 || err.code === 'ErrorAccessDenied' || err.code === 'accessDenied') {
        return `Microsoft 365 denied the request — grant the app the "${permission}" application permission and admin consent. (${err.message})`;
    }
    return err.message;
}

module.exports = { graph, graphAll, getAppToken, GraphError, explainGraphError };

const crypto = require('crypto');
const { entra, appBaseUrl } = require('../config');
const { signToken, verifyToken } = require('../utils/token');

// Single sign-on with Microsoft Entra ID: OpenID Connect authorization-code
// flow with PKCE, done entirely on the server. The browser only ever sees the
// one-time code; the client secret and ID token stay here.

const TX_COOKIE = 'sso_tx';
const TX_LIFETIME_MINUTES = 10;
const CLOCK_SKEW_SECONDS = 300;
const JWKS_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

class SsoError extends Error {}

const b64url = (buffer) => Buffer.from(buffer).toString('base64url');
const redirectUri = () => `${appBaseUrl}/api/auth/sso/callback`;

// Only ever send people back to a path inside this app.
function safeReturnPath(value) {
    const path = String(value || '');
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.startsWith('/api/')) {
        return '/';
    }
    return path.slice(0, 500);
}

/**
 * Start a sign-in. Returns the Microsoft URL to redirect to and the value of
 * a short-lived signed cookie that ties the callback to this browser.
 */
function beginLogin(returnTo) {
    const state = b64url(crypto.randomBytes(24));
    const nonce = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

    const params = new URLSearchParams({
        client_id: entra.clientId,
        response_type: 'code',
        response_mode: 'query',
        redirect_uri: redirectUri(),
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account'
    });

    return {
        url: `${entra.authorityHost}/${entra.tenantId}/oauth2/v2.0/authorize?${params}`,
        cookie: signToken(
            { purpose: 'sso', state, nonce, verifier, returnTo: safeReturnPath(returnTo) },
            TX_LIFETIME_MINUTES / (24 * 60)
        )
    };
}

let jwksCache = { keys: [], fetchedAt: 0 };

async function fetchSigningKeys(force = false) {
    if (!force && jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
        return jwksCache.keys;
    }
    const response = await fetch(`${entra.authorityHost}/${entra.tenantId}/discovery/v2.0/keys`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new SsoError(`Could not load Microsoft signing keys (${response.status})`);
    const data = await response.json();
    jwksCache = { keys: Array.isArray(data.keys) ? data.keys : [], fetchedAt: Date.now() };
    return jwksCache.keys;
}

function decodeSegment(segment) {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

// Verify the ID token's signature and the claims that prove it was issued by
// our tenant, for this app, for this sign-in attempt.
async function verifyIdToken(idToken, expectedNonce) {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw new SsoError('Malformed ID token');

    let header;
    let claims;
    try {
        header = decodeSegment(parts[0]);
        claims = decodeSegment(parts[1]);
    } catch (err) {
        throw new SsoError('Malformed ID token');
    }
    if (header.alg !== 'RS256' || !header.kid) throw new SsoError('Unexpected ID token algorithm');

    let jwk = (await fetchSigningKeys()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await fetchSigningKeys(true)).find((k) => k.kid === header.kid);
    if (!jwk) throw new SsoError('ID token was signed with an unknown key');

    const valid = crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        crypto.createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url')
    );
    if (!valid) throw new SsoError('ID token signature is invalid');

    const now = Math.floor(Date.now() / 1000);
    const tenant = entra.tenantId.toLowerCase();
    if (claims.aud !== entra.clientId) throw new SsoError('ID token was issued for a different application');
    if (String(claims.tid || '').toLowerCase() !== tenant) throw new SsoError('ID token is from a different organisation');
    if (String(claims.iss || '').toLowerCase() !== `${entra.authorityHost}/${tenant}/v2.0`.toLowerCase()) {
        throw new SsoError('ID token has an unexpected issuer');
    }
    if (!claims.exp || claims.exp + CLOCK_SKEW_SECONDS < now) throw new SsoError('ID token has expired');
    if (claims.nbf && claims.nbf - CLOCK_SKEW_SECONDS > now) throw new SsoError('ID token is not valid yet');
    if (!claims.nonce || claims.nonce !== expectedNonce) throw new SsoError('ID token does not match this sign-in attempt');

    return claims;
}

function sameString(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Finish a sign-in from the callback's query string and the transaction
 * cookie. Resolves with who signed in and where to send them.
 */
async function completeLogin(query, txCookie) {
    if (query.error) {
        throw new SsoError(String(query.error_description || query.error).split('\r\n')[0].slice(0, 300));
    }
    const tx = verifyToken(txCookie);
    if (!tx || tx.purpose !== 'sso' || !tx.state || !tx.nonce || !tx.verifier) {
        throw new SsoError('Sign-in session expired — please try again');
    }
    if (!query.code || !sameString(query.state, tx.state)) {
        throw new SsoError('Sign-in response did not match the request — please try again');
    }

    const response = await fetch(`${entra.authorityHost}/${entra.tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: entra.clientId,
            client_secret: entra.clientSecret,
            code: String(query.code),
            redirect_uri: redirectUri(),
            code_verifier: tx.verifier,
            scope: 'openid profile email'
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id_token) {
        throw new SsoError(`Microsoft did not complete the sign-in: ${data.error_description || data.error || response.status}`);
    }

    const claims = await verifyIdToken(data.id_token, tx.nonce);
    const emails = [...new Set(
        [claims.email, claims.preferred_username, claims.upn]
            .filter((v) => typeof v === 'string' && v.includes('@'))
            .map((v) => v.trim().toLowerCase())
    )];
    if (emails.length === 0) throw new SsoError('Your Microsoft account has no email address');

    return { emails, name: claims.name || '', returnTo: safeReturnPath(tx.returnTo) };
}

module.exports = { TX_COOKIE, TX_LIFETIME_MINUTES, SsoError, beginLogin, completeLogin, redirectUri, safeReturnPath };

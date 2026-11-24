// Starts the real server for a test file: its own empty database in a
// temporary folder, its own port, and no way to reach the developer's .env,
// the live database or the internet.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ADMIN = { email: 'admin@test.local', password: 'correct-horse-battery' };
const AUTH_SECRET = 'test-suite-secret';

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function waitUntilUp(url, child, output) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`The server stopped while starting:\n${output.join('')}`);
        try {
            const res = await fetch(`${url}/api/auth/license`);
            if (res.ok) return;
        } catch (err) {
            // not listening yet
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`The server did not start in time:\n${output.join('')}`);
}

/**
 * Resolves with { url, dir, admin, request, login, session, tokenFor, db, stop }.
 * `env` adds to (or overrides) the server's environment.
 */
async function startApp({ env = {} } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-check-test-'));
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const serverEnv = {
        // Nothing is inherited except what is needed to run Node at all.
        PATH: process.env.PATH,
        HOME: dir,
        NODE_ENV: 'test',
        ENV_FILE: path.join(dir, 'not-there.env'),
        DB_PATH: path.join(dir, 'test.db'),
        UPLOAD_DIR: path.join(dir, 'uploads'),
        HOST: '127.0.0.1',
        PORT: String(port),
        AUTH_SECRET,
        ADMIN_EMAIL: ADMIN.email,
        ADMIN_PASSWORD: ADMIN.password,
        AI_ENABLED: 'false',
        ...env
    };

    const output = [];
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: serverEnv });
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));

    try {
        await waitUntilUp(url, child, output);
        // The only way a licence is ever set: the script, from the shell.
        const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
        execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'set-licence.js'), nextYear], { cwd: ROOT, env: serverEnv, stdio: 'pipe' });
    } catch (error) {
        child.kill();
        throw error;
    }

    async function request(method, route, { token, body, headers } = {}) {
        const res = await fetch(`${url}/api${route}`, {
            method,
            headers: {
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...headers
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const text = await res.text();
        let parsed = text;
        try { parsed = JSON.parse(text); } catch (err) { /* a download, not JSON */ }
        return { status: res.status, body: parsed, text, headers: res.headers };
    }

    // The four verbs with a token already attached.
    function session(token) {
        return {
            token,
            get: (route) => request('GET', route, { token }),
            post: (route, body = {}) => request('POST', route, { token, body }),
            put: (route, body = {}) => request('PUT', route, { token, body }),
            del: (route) => request('DELETE', route, { token })
        };
    }

    async function login(email = ADMIN.email, password = ADMIN.password) {
        const res = await request('POST', '/auth/login', { body: { email, password } });
        if (res.status !== 200) throw new Error(`Could not sign in as ${email}: ${res.status} ${res.text}`);
        return session(res.body.token);
    }

    // A session without the sign-in screen, for accounts that have no
    // password: people who use Microsoft sign-in, and ordinary staff.
    function tokenFor(payload) {
        process.env.AUTH_SECRET = AUTH_SECRET;
        const { signToken } = require(path.join(ROOT, 'server', 'utils', 'token'));
        return session(signToken(payload, 1));
    }

    // Direct access to the test database, for setting up what the API has
    // no call for (an overdue loan, an account with no password).
    function db() {
        const Database = require('better-sqlite3');
        return new Database(serverEnv.DB_PATH);
    }

    async function stop() {
        if (child.exitCode === null) {
            const gone = new Promise((resolve) => child.once('exit', resolve));
            child.kill();
            await gone;
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }

    return { url, dir, admin: ADMIN, request, login, session, tokenFor, db, stop, output };
}

module.exports = { startApp, ADMIN };

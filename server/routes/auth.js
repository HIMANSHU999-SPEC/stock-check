const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { signToken, verifyToken, usingDefaultSecret } = require('../utils/token');
const config = require('../config');
const sso = require('../services/sso');

const router = express.Router();

// Single sign-on is only offered when sessions can be trusted: with the
// public fallback AUTH_SECRET anyone could forge a login token anyway.
const ssoEnabled = config.sso.enabled && !usingDefaultSecret;
const passwordLoginEnabled = !(ssoEnabled && config.sso.passwordLoginDisabled);
const SSO_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.appBaseUrl.startsWith('https://'),
  path: '/api/auth/sso'
};

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > -1 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

// Master password-reset override. Disabled unless MASTER_RESET_PASSWORD is set
// in the environment — never hardcode this, the repository is public.
const MASTER_RESET_PASSWORD_HASH = process.env.MASTER_RESET_PASSWORD
  ? crypto.createHash('sha256').update(process.env.MASTER_RESET_PASSWORD).digest('hex')
  : null;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getLicense() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('license');
  if (!row) {
    return { status: 'not_activated', activated_at: null, expires_at: null, last_code: null };
  }
  try {
    return JSON.parse(row.value);
  } catch (error) {
    return { status: 'not_activated', activated_at: null, expires_at: null, last_code: null };
  }
}

function licenseStatus() {
  const license = getLicense();
  const now = Date.now();
  const expired = license.expires_at ? now > license.expires_at : true;
  return { ...license, expired };
}

function getUserFromToken(req) {
  const auth = req.headers.authorization || '';
  const queryToken = req.query.token || req.query.auth_token;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (queryToken || null);
  if (!token) return null;
  const payload = verifyToken(token);
  // A staff session (see getPersonFromToken) is not a user of the system
  // and must never pass for one.
  if (!payload || !payload.userId || payload.employeeId) return null;

  const user = db
    .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .get(payload.userId);
  return user || null;
}

const STAFF_SESSION_DAYS = 1;

/**
 * Who is asking, for the "My assets" pages, which are open to every member
 * of staff and not only to the people who run the system.
 *
 * Returns { user, employee, role } or null:
 *  - an administrator / sub-administrator: `user` is set, and `employee` is
 *    their own staff record when one exists with the same email;
 *  - anyone else on the staff list: `user` is null and role is 'staff'. Such
 *    a session opens nothing but /api/my.
 * Looked up afresh on every request, so marking someone inactive ends their
 * access straight away.
 */
function getPersonFromToken(req) {
  const user = getUserFromToken(req);
  if (user) {
    const employee = db
      .prepare("SELECT * FROM employees WHERE LOWER(email) = LOWER(?) AND status != 'inactive'")
      .get(user.email);
    return { user, employee: employee || null, role: user.role };
  }

  const auth = req.headers.authorization || '';
  const payload = auth.startsWith('Bearer ') ? verifyToken(auth.slice(7)) : null;
  if (!payload || !payload.employeeId || payload.userId) return null;
  const employee = db
    .prepare("SELECT * FROM employees WHERE id = ? AND status != 'inactive'")
    .get(payload.employeeId);
  return employee ? { user: null, employee, role: 'staff' } : null;
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!passwordLoginEnabled) {
    return res.status(403).json({ error: 'Password sign-in is turned off — use "Sign in with Microsoft"' });
  }
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // People type their address in whatever case they like; accounts are
  // matched the same way everywhere else.
  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
    .get(String(email).trim());

  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({ userId: user.id, role: user.role }, 7);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// What the login screen should offer
router.get('/sso/config', (req, res) => {
  res.json({ enabled: ssoEnabled, password_login: passwordLoginEnabled });
});

// Step 1: send the browser to Microsoft
router.get('/sso/login', (req, res) => {
  if (!ssoEnabled) {
    return res.redirect('/login?sso_error=' + encodeURIComponent('Single sign-on is not set up on this server'));
  }
  const { url, cookie } = sso.beginLogin(req.query.returnTo);
  res.cookie(sso.TX_COOKIE, cookie, { ...SSO_COOKIE_OPTIONS, maxAge: sso.TX_LIFETIME_MINUTES * 60 * 1000 });
  res.redirect(url);
});

// Step 2: Microsoft sends the browser back here with a one-time code
router.get('/sso/callback', async (req, res) => {
  const fail = (message) => res.redirect(`${config.appBaseUrl}/login?sso_error=${encodeURIComponent(message)}`);
  if (!ssoEnabled) {
    return fail('Single sign-on is not set up on this server');
  }
  try {
    const identity = await sso.completeLogin(req.query, readCookie(req, sso.TX_COOKIE));
    res.clearCookie(sso.TX_COOKIE, SSO_COOKIE_OPTIONS);

    // Signing in with Microsoft proves who someone is; whether they may use
    // this system is still decided by the Users list here.
    const placeholders = identity.emails.map(() => '?').join(',');
    const user = db
      .prepare(`SELECT * FROM users WHERE LOWER(email) IN (${placeholders})`)
      .get(...identity.emails);
    if (!user) {
      // Not someone who runs the system. Anyone on the staff list may still
      // sign in to see, and confirm, what is recorded against their own name.
      const employee = db
        .prepare(`SELECT * FROM employees WHERE LOWER(email) IN (${placeholders})`)
        .get(...identity.emails);
      if (!employee) {
        return fail(`${identity.emails[0]} is not on the staff list in this system. If you have been given equipment, ask IT Support to add you.`);
      }
      if (employee.kind === 'shared') {
        return fail(`${identity.emails[0]} is a department or shared mailbox here, not a personal account. Sign in with your own account.`);
      }
      if (employee.status === 'inactive') {
        return fail(`${identity.emails[0]} is marked as no longer active. Please contact IT Support.`);
      }
      db.prepare(`
        INSERT INTO activity_log (user_id, user_email, action, entity_type, entity_id, description)
        VALUES (NULL, ?, 'sso_login', 'employee', ?, 'Staff member signed in with Microsoft to view their assets')
      `).run(employee.email, employee.id);

      const staffToken = signToken({ employeeId: employee.id, role: 'staff' }, STAFF_SESSION_DAYS);
      const staffFragment = new URLSearchParams({ token: staffToken, returnTo: '/my-assets' });
      return res.redirect(`${config.appBaseUrl}/sso-complete#${staffFragment}`);
    }
    if (!user.name && identity.name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(identity.name, user.id);
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, user_email, action, entity_type, entity_id, description)
      VALUES (?, ?, 'sso_login', 'user', ?, 'Signed in with Microsoft')
    `).run(user.id, user.email, user.id);

    const token = signToken({ userId: user.id, role: user.role }, 7);
    // The token travels in the URL fragment, which browsers never send to a
    // server or include in a Referer header.
    const fragment = new URLSearchParams({ token, returnTo: identity.returnTo });
    res.redirect(`${config.appBaseUrl}/sso-complete#${fragment}`);
  } catch (error) {
    if (!(error instanceof sso.SsoError)) {
      console.error('SSO callback failed:', error);
    }
    fail(error instanceof sso.SsoError ? error.message : 'Sign-in could not be completed — please try again');
  }
});

router.get('/me', (req, res) => {
  const person = getPersonFromToken(req);
  if (!person) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (person.user) {
    return res.json({ user: person.user });
  }
  // A member of staff: no account in Users, only their own staff record.
  res.json({
    user: {
      id: null,
      employee_id: person.employee.id,
      name: person.employee.name,
      email: person.employee.email,
      role: 'staff'
    }
  });
});

// The licence is set on the server only (scripts/set-licence.js); nothing in
// the web app can activate or extend it. Before sign-in a visitor learns just
// whether the app is usable; the status and dates are for signed-in users.
router.get('/license', (req, res) => {
  const status = licenseStatus();
  if (!getUserFromToken(req)) {
    return res.json({ expired: status.expired });
  }
  res.json({
    status: status.status,
    activated_at: status.activated_at,
    expires_at: status.expires_at,
    expired: status.expired
  });
});

// Change password (requires auth or master override)
router.post('/change-password', (req, res) => {
  const { current_password, new_password, email } = req.body;
  if (!new_password) {
    return res.status(400).json({ error: 'New password is required' });
  }

  const requester = getUserFromToken(req);
  const targetEmail = email || requester?.email;

  if (!targetEmail) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(String(targetEmail).trim());
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const isMasterOverride = Boolean(
    MASTER_RESET_PASSWORD_HASH && current_password && hashPassword(current_password) === MASTER_RESET_PASSWORD_HASH
  );
  const isSelfWithPassword = requester && requester.id === user.id && user.password_hash === hashPassword(current_password || '');

  if (!isMasterOverride && !isSelfWithPassword) {
    return res.status(403).json({ error: 'Current password is incorrect' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), user.id);
  return res.json({ message: 'Password updated successfully' });
});

module.exports = { router, getUserFromToken, getPersonFromToken, licenseStatus, ssoEnabled, passwordLoginEnabled };

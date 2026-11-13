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

const TRIAL_CODE = 'jhinfotech31@gmail.com';
const TRIAL_EXTENSION_CODE = 'sales@jhinfo.tech';
const ACTIVATION_CODE = 'help@jhinfo.tech';
const RENEWAL_CODE = 'helpp@jhinfo.tech';
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

function saveLicense(license) {
  db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)').run('license', JSON.stringify(license));
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
  if (!payload) return null;

  const user = db
    .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .get(payload.userId);
  return user || null;
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!passwordLoginEnabled) {
    return res.status(403).json({ error: 'Password sign-in is turned off — use "Sign in with Microsoft"' });
  }
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email);

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
      return fail(`${identity.emails[0]} has not been given access. Ask an administrator to add you under Users.`);
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
  const user = getUserFromToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ user });
});

router.get('/license', (req, res) => {
  res.json(licenseStatus());
});

router.post('/activate', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Activation code is required' });
  }

  const now = Date.now();
  const license = getLicense();

  if (code === TRIAL_CODE) {
    if (license.status === 'trial') {
      return res.status(400).json({ error: 'Trial already activated' });
    }
    const newLicense = {
      status: 'trial',
      activated_at: now,
      expires_at: now + 15 * 24 * 60 * 60 * 1000,
      last_code: code,
      trial_extended: false
    };
    saveLicense(newLicense);
    return res.json({ message: '14-day trial activated', license: { ...newLicense, expired: false } });
  }

  if (code === TRIAL_EXTENSION_CODE) {
    if (license.status !== 'trial') {
      return res.status(400).json({ error: 'Trial extension only available after trial activation' });
    }
    if (license.trial_extended) {
      return res.status(400).json({ error: 'Trial already extended once' });
    }
    const baseDate = license.expires_at && license.expires_at > now ? license.expires_at : now;
    const newLicense = {
      status: 'trial',
      activated_at: license.activated_at || now,
      expires_at: baseDate + 7 * 24 * 60 * 60 * 1000, // extend trial by 7 days
      last_code: code,
      trial_extended: true
    };
    saveLicense(newLicense);
    return res.json({ message: 'Trial extended once', license: { ...newLicense, expired: false } });
  }

  if (code === ACTIVATION_CODE) {
    const baseDate = license.expires_at && license.expires_at > now ? license.expires_at : now;
    const newLicense = {
      status: 'active',
      activated_at: license.activated_at || now,
      expires_at: baseDate + 365 * 24 * 60 * 60 * 1000,
      last_code: code,
      trial_extended: license.trial_extended || false
    };
    saveLicense(newLicense);
    return res.json({ message: 'License activated for 1 year', license: { ...newLicense, expired: false } });
  }

  if (code === RENEWAL_CODE) {
    const baseDate = license.expires_at && license.expires_at > now ? license.expires_at : now;
    const newLicense = {
      status: 'active',
      activated_at: license.activated_at || now,
      expires_at: baseDate + 365 * 24 * 60 * 60 * 1000,
      last_code: code,
      trial_extended: license.trial_extended || false
    };
    saveLicense(newLicense);
    return res.json({ message: 'License extended for 1 year', license: { ...newLicense, expired: false } });
  }

  return res.status(400).json({ error: 'Invalid activation code' });
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

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(targetEmail);
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

module.exports = { router, getUserFromToken, licenseStatus, ssoEnabled, passwordLoginEnabled };

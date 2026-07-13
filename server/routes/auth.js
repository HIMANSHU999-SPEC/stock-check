const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { signToken, verifyToken } = require('../utils/token');

const router = express.Router();

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

module.exports = { router, getUserFromToken, licenseStatus };

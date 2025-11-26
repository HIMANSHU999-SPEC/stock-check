const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { signToken, verifyToken } = require('../utils/token');

const router = express.Router();

const TRIAL_CODE = 'jhinfotech31@gmail.com';
const YEAR_EXTENSION_CODE = 'jhinfo.tech';

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
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
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
    const newLicense = {
      status: 'trial',
      activated_at: now,
      expires_at: now + 14 * 24 * 60 * 60 * 1000,
      last_code: code
    };
    saveLicense(newLicense);
    return res.json({ message: '14-day trial activated', license: { ...newLicense, expired: false } });
  }

  if (code === YEAR_EXTENSION_CODE) {
    const baseDate = license.expires_at && license.expires_at > now ? license.expires_at : now;
    const newLicense = {
      status: 'active',
      activated_at: license.activated_at || now,
      expires_at: baseDate + 365 * 24 * 60 * 60 * 1000,
      last_code: code
    };
    saveLicense(newLicense);
    return res.json({ message: 'License extended for 1 year', license: { ...newLicense, expired: false } });
  }

  return res.status(400).json({ error: 'Invalid activation code' });
});

module.exports = { router, getUserFromToken, licenseStatus };

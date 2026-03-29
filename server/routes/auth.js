const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { signToken, verifyToken } = require('../utils/token');

const router = express.Router();

const TRIAL_CODE = 'jhinfotech31@gmail.com';
const TRIAL_EXTENSION_CODE = 'sales@jhinfo.tech';
const ACTIVATION_CODE = 'help@jhinfo.tech';
const RENEWAL_CODE = 'helpp@jhinfo.tech';
const MASTER_RESET_PASSWORD_HASH = crypto.createHash('sha256').update('Admin@123').digest('hex');

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

  const isMasterOverride = current_password && hashPassword(current_password) === MASTER_RESET_PASSWORD_HASH;
  const isSelfWithPassword = requester && requester.id === user.id && user.password_hash === hashPassword(current_password || '');

  if (!isMasterOverride && !isSelfWithPassword) {
    return res.status(403).json({ error: 'Current password is incorrect' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), user.id);
  return res.json({ message: 'Password updated successfully' });
});

// ─── Email Settings (admin only) ─────────────────────────────────────────────

router.get('/email-settings', (req, res) => {
  const user = getUserFromToken(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const row = db.prepare("SELECT value FROM settings WHERE key = 'email_settings'").get();
  if (!row) return res.json({ enabled: false });
  try { res.json(JSON.parse(row.value)); } catch { res.json({ enabled: false }); }
});

router.post('/email-settings', (req, res) => {
  const user = getUserFromToken(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { host, port, user: smtpUser, pass, from, admin_email, enabled } = req.body;
  const settings = { host, port: Number(port) || 587, user: smtpUser, pass, from, admin_email, enabled: !!enabled };
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email_settings', ?)").run(JSON.stringify(settings));
  res.json({ message: 'Email settings saved' });
});

router.post('/email-test', async (req, res) => {
  const user = getUserFromToken(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const { sendEmail } = require('../utils/email');
    await sendEmail({ to: user.email, subject: 'Test Email from Stock Management', html: '<p>Email configuration is working correctly.</p>' });
    res.json({ message: 'Test email sent to ' + user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User Management (admin only) ────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  req.user = user;
  next();
}

// List all users
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC').all();
  res.json(users);
});

// Create user
router.post('/users', requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password, and role are required' });
  }
  if (!['admin', 'subadmin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or subadmin' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name || '', email, hashPassword(password), role);

  res.status(201).json({ id: result.lastInsertRowid, name: name || '', email, role });
});

// Update user
router.put('/users/:id', requireAdmin, (req, res) => {
  const { name, email, role, password } = req.body;
  const id = Number(req.params.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role && !['admin', 'subadmin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or subadmin' });
  }

  if (email && email !== user.email) {
    const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id);
    if (clash) return res.status(409).json({ error: 'Email already in use' });
  }

  const newName = name !== undefined ? name : user.name;
  const newEmail = email || user.email;
  const newRole = role || user.role;
  const newHash = password ? hashPassword(password) : user.password_hash;

  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?')
    .run(newName, newEmail, newRole, newHash, id);

  res.json({ id, name: newName, email: newEmail, role: newRole });
});

// Delete user
router.delete('/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (req.user.id === id) return res.status(400).json({ error: 'Cannot delete your own account' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'User deleted' });
});

module.exports = { router, getUserFromToken, licenseStatus };

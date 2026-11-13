const crypto = require('crypto');

require('../config');

const DEFAULT_SECRET = 'stock-management-secret';
const SECRET = process.env.AUTH_SECRET || DEFAULT_SECRET;
// The fallback is public in the repository, so tokens signed with it can be
// forged. Features that depend on trustworthy sessions check this.
const usingDefaultSecret = SECRET === DEFAULT_SECRET;

function signToken(payload, expiresInDays = 7) {
  const exp = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
  const data = { ...payload, exp };
  const base = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(base).digest('base64url');
  return `${base}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [base, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(base).digest('base64url');
  if (expected !== signature) return null;

  try {
    const data = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'));
    if (Date.now() > data.exp) return null;
    return data;
  } catch (error) {
    return null;
  }
}

module.exports = { signToken, verifyToken, usingDefaultSecret };

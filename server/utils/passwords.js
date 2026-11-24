const crypto = require('crypto');

// The shortest password someone may choose for themselves.
const MIN_LENGTH = 8;

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

// An account made for Microsoft sign-in only holds a marker in place of a
// digest, so "has a password" is "holds something shaped like a digest".
function hasPassword(storedHash) {
    return /^[0-9a-f]{64}$/.test(String(storedHash || ''));
}

module.exports = { hashPassword, hasPassword, MIN_LENGTH };

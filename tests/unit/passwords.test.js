const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, hasPassword, MIN_LENGTH } = require('../../server/utils/passwords');

test('a stored digest counts as a password; a marker in its place does not', () => {
    assert.equal(hasPassword(hashPassword('anything at all')), true);
    assert.equal(hasPassword('microsoft sign-in only'), false);
    assert.equal(hasPassword(''), false);
    assert.equal(hasPassword(null), false);
});

test('the same password always gives the same digest, different ones differ', () => {
    assert.equal(hashPassword('abc'), hashPassword('abc'));
    assert.notEqual(hashPassword('abc'), hashPassword('abd'));
    assert.ok(MIN_LENGTH >= 8);
});

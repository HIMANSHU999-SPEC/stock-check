const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseSerial } = require('../../server/utils/serials');

test('case, spaces and dashes do not matter', () => {
    assert.equal(normaliseSerial('5cg-1234 abc'), '5CG1234ABC');
    assert.equal(normaliseSerial(' 5CG1234ABC '), '5CG1234ABC');
});

test('placeholders are not serial numbers', () => {
    for (const value of ['', null, undefined, 'N/A', 'none', 'To be filled by O.E.M.', 'Default string', '0', '0000000', 'XXXXXXXX', '123456789', 'abc', 'System Serial Number']) {
        assert.equal(normaliseSerial(value), '', `${value} should not count as a serial number`);
    }
});

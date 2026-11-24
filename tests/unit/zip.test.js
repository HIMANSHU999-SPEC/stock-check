const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { zip } = require('../../server/utils/zip');

// Reads an archive back by following the format from its end, the way any
// unzip program does, so the writer is checked against the format itself.
function unzip(buffer) {
    const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end >= 0, 'has an end-of-directory record');
    assert.equal(end + 22, buffer.length, 'nothing after the end record');
    const count = buffer.readUInt16LE(end + 10);
    const directorySize = buffer.readUInt32LE(end + 12);
    let at = buffer.readUInt32LE(end + 16);
    assert.equal(at + directorySize, end, 'the directory sits right before the end record');

    const files = [];
    for (let i = 0; i < count; i += 1) {
        assert.equal(buffer.readUInt32LE(at), 0x02014b50);
        const method = buffer.readUInt16LE(at + 10);
        const crc = buffer.readUInt32LE(at + 16);
        const packedSize = buffer.readUInt32LE(at + 20);
        const size = buffer.readUInt32LE(at + 24);
        const nameLength = buffer.readUInt16LE(at + 28);
        const local = buffer.readUInt32LE(at + 42);
        const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

        assert.equal(buffer.readUInt32LE(local), 0x04034b50);
        assert.equal(buffer.readUInt32LE(local + 14), crc, 'both headers agree');
        const localNameLength = buffer.readUInt16LE(local + 26);
        assert.equal(buffer.toString('utf8', local + 30, local + 30 + localNameLength), name);
        const start = local + 30 + localNameLength + buffer.readUInt16LE(local + 28);
        const packed = buffer.subarray(start, start + packedSize);
        const data = method === 8 ? zlib.inflateRawSync(packed) : Buffer.from(packed);
        assert.equal(data.length, size);
        assert.equal(zlib.crc32(data), crc, `${name}: checksum`);
        files.push({ name, data, method });
        at += 46 + nameLength;
    }
    return files;
}

test('what goes in comes out, byte for byte', () => {
    const text = Buffer.from('assigned assets\n'.repeat(500));
    const noise = crypto.randomBytes(4096); // will not compress
    const files = unzip(zip([
        { name: 'assigned-assets-1.pdf', data: text },
        { name: 'reports/Zoë — notes.txt', data: noise },
        { name: 'empty.txt', data: Buffer.alloc(0) }
    ]));
    assert.deepEqual(files.map((file) => file.name), ['assigned-assets-1.pdf', 'reports/Zoë — notes.txt', 'empty.txt']);
    assert.ok(files[0].data.equals(text));
    assert.ok(files[1].data.equals(noise));
    assert.equal(files[2].data.length, 0);
    assert.equal(files[0].method, 8, 'text is compressed');
    assert.equal(files[1].method, 0, 'what will not shrink is stored as it is');
});

test('another reader agrees: the spreadsheet library opens it', () => {
    const XLSX = require('xlsx');
    const archive = XLSX.CFB.read(zip([{ name: 'hello.txt', data: Buffer.from('hello, world') }]), { type: 'buffer' });
    const entry = XLSX.CFB.find(archive, 'hello.txt');
    assert.ok(entry, 'the file is listed');
    assert.equal(Buffer.from(entry.content).toString(), 'hello, world');
});

test('refuses what would make a broken archive', () => {
    assert.throws(() => zip([]), /Nothing to put/);
    assert.throws(() => zip([{ name: '', data: Buffer.from('x') }]), /no usable name/);
    assert.throws(() => zip([{ name: 'a.txt', data: Buffer.from('x') }, { name: 'a.txt', data: Buffer.from('y') }]), /both called/);
});

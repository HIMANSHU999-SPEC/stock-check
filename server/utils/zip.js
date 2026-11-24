// A ZIP file from a handful of buffers held in memory, which is all this
// app ever needs one for (the per-person PDFs of a multi-employee export).
// Written here, on Node's own zlib, so there is no archive library and no
// chain of packages behind it to keep patched.
const zlib = require('zlib');

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const VERSION = 20;          // plain ZIP 2.0: deflate, no ZIP64
const UTF8_NAMES = 0x0800;
const STORED = 0;
const DEFLATED = 8;
const MAX_FILES = 0xffff;
const MAX_SIZE = 0xffffffff;

// The format keeps time to two seconds, in local time, from 1980.
function dosDateTime(date) {
    const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

/**
 * files: [{ name, data }] where data is a Buffer. Returns the archive as a
 * Buffer. Names use forward slashes and must be unique.
 */
function zip(files, { date = new Date() } = {}) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('Nothing to put in the ZIP file');
    if (files.length > MAX_FILES) throw new Error('Too many files for one ZIP file');
    const stamp = dosDateTime(date);
    const seen = new Set();
    const bodies = [];
    const directory = [];
    let offset = 0;

    for (const file of files) {
        const name = Buffer.from(String(file.name || '').replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
        if (name.length === 0 || name.length > 0xffff) throw new Error('A file in the ZIP has no usable name');
        if (seen.has(name.toString())) throw new Error(`Two files in the ZIP are both called ${name}`);
        seen.add(name.toString());

        const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || '');
        const packed = zlib.deflateRawSync(data);
        // Already-compressed content can come out larger; keep it as it is.
        const method = packed.length < data.length ? DEFLATED : STORED;
        const body = method === DEFLATED ? packed : data;
        const crc = zlib.crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL_HEADER, 0);
        local.writeUInt16LE(VERSION, 4);
        local.writeUInt16LE(UTF8_NAMES, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(stamp.time, 10);
        local.writeUInt16LE(stamp.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        // 28: length of the extra field, none

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(CENTRAL_HEADER, 0);
        entry.writeUInt16LE(VERSION, 4);   // made by
        entry.writeUInt16LE(VERSION, 6);   // needed to read
        entry.writeUInt16LE(UTF8_NAMES, 8);
        entry.writeUInt16LE(method, 10);
        entry.writeUInt16LE(stamp.time, 12);
        entry.writeUInt16LE(stamp.date, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(body.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(name.length, 28);
        // 30 extra, 32 comment, 34 disk, 36 internal and 38 external attributes: all zero
        entry.writeUInt32LE(offset, 42);

        bodies.push(local, name, body);
        directory.push(entry, name);
        offset += local.length + name.length + body.length;
        if (offset > MAX_SIZE) throw new Error('Too much for one ZIP file');
    }

    const directorySize = directory.reduce((total, part) => total + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_DIRECTORY, 0);
    // 4 and 6: this disk and the disk the directory starts on, both zero
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(offset, 16);
    // 20: length of the comment, none

    return Buffer.concat([...bodies, ...directory, end]);
}

module.exports = { zip };

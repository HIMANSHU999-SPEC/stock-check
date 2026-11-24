#!/usr/bin/env node
// Runs every *.test.js under tests/ with Node's own test runner. Listing the
// files here, rather than handing the runner a folder, behaves the same on
// every supported version of Node.
//
//   npm test                 everything
//   npm test -- unit         only files whose path contains "unit"
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function find(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return find(full);
        return entry.name.endsWith('.test.js') ? [full] : [];
    });
}

const wanted = process.argv.slice(2);
const files = find(__dirname).sort().filter((file) => wanted.length === 0 || wanted.some((word) => file.includes(word)));
if (files.length === 0) {
    console.error('No test files matched.');
    process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);

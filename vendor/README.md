# Vendored packages

## xlsx-0.20.3.tgz (SheetJS)

The Excel library the browser uses to read uploaded spreadsheets and write
exports. SheetJS stopped publishing to npm at 0.18.5, which has known
vulnerabilities (prototype pollution, ReDoS); fixed releases are only
distributed from the project's own site. `package.json` therefore installs it
from this file (`"xlsx": "file:vendor/xlsx-0.20.3.tgz"`), so a deploy does not
depend on that site being reachable.

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- Licence: Apache-2.0. No dependencies, no install scripts.

To update: download the new tarball from https://cdn.sheetjs.com/ into this
folder, run `npm install ./vendor/xlsx-<version>.tgz`, delete the old file,
and update this note.

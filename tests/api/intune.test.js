const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');
const { startMicrosoft, device } = require('../helpers/microsoft');

// The register double-checked against Intune. Microsoft is played by a
// stand-in on this machine; nothing here reaches the internet.
let microsoft;
let app;
let admin;
before(async () => {
    microsoft = await startMicrosoft();
    app = await startApp({ env: microsoft.env });
    admin = await app.login();

    const person = async (name, email, extra = {}) => (await admin.post('/employees', { name, email, ...extra })).body;
    const jane = await person('Jane Smith', 'Jane.Smith@test.local');
    const omar = await person('Omar Khan', 'omar.khan@test.local');
    const office = await person('Admissions office', 'admissions@test.local', { kind: 'shared' });

    const add = async (name, serial_number, extra = {}) => {
        const res = await admin.post('/assets', { name, serial_number, ...extra });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        return res.body;
    };
    const give = (asset, to) => admin.post(`/assets/${asset.id}/assign`, { ...to, send_email: false });

    await give(await add('HP EliteBook 840 G8', '5cg-1234 abc'), { employee_id: jane.id });   // same person, serial typed differently
    await give(await add('Dell Latitude 5420', 'DL5420X1'), { employee_id: omar.id });        // Intune says Jane
    await add('Lenovo ThinkPad T14', 'PF2ABCDE');                                             // in stock here, in use there
    await give(await add('HP ProBook 450 G9', '5CD9999ZZZ'), { employee_id: jane.id });       // nobody signed in there
    await give(await add('Dell OptiPlex 7090 desktop', 'OPT7090A'), { location: 'Room 204' }); // a room here, a person there
    await give(await add('HP ProDesk 400 G7 desktop', 'PRODESK77'), { employee_id: office.id });
    await add('MacBook Air M1', 'C02RETIRED1', { status: 'retired' });                        // written off, still checking in
    await add('MacBook Pro 13', 'C02LOSTOLD1', { status: 'lost' });                           // written off, long silent
    await add('Dell Latitude 7420', 'NOTENROLLED1');                                          // a laptop Intune has never seen
    await add('HP 250 G9 laptop', '');                                                        // a laptop with no serial recorded
    await add('Office chair', 'CHAIR0001');                                                   // nobody expects a chair in Intune

    microsoft.state.devices = [
        device('LAAT-JS-01', '5CG1234ABC', 'jane.smith@test.local', 1),
        device('LAAT-DL-02', 'dl5420x1', 'jane.smith@test.local', 2),
        device('LAAT-LN-03', 'PF2ABCDE', 'omar.khan@test.local', 0),
        device('LAAT-HP-04', '5CD9999ZZZ', '', 5),
        device('LAAT-RM-204', 'OPT7090A', 'jane.smith@test.local', 3),
        device('LAAT-ADM-01', 'PRODESK77', 'omar.khan@test.local', 3),
        device('MBA-OLD', 'C02RETIRED1', 'omar.khan@test.local', 4),
        device('MBP-LOST', 'C02LOSTOLD1', 'omar.khan@test.local', 200),
        device('LAAT-NEW-09', 'BRANDNEW99', 'omar.khan@test.local', 0, { model: 'HP EliteBook 840 14 inch G10 Notebook PC' }),
        device('Omars-iPhone', 'F17PERSONAL', 'omar.khan@test.local', 0, { manufacturer: 'Apple', model: 'iPhone 14', owner: 'personal' }),
        device('VM-TEST', 'To be filled by O.E.M.', '', 1),
        // An older record for a machine that was re-enrolled: the newer one is the live one.
        device('LAAT-JS-01-OLD', '5CG1234ABC', 'someone.else@test.local', 300)
    ];
});
after(async () => {
    await app.stop();
    await microsoft.stop();
});

const kindOf = (rows, serial) => {
    const row = rows.find((r) => (r.asset && r.asset.serial_number === serial) || (r.device && r.device.serial_number === serial));
    return row ? row.kind : undefined;
};

test('each device is put under the right heading', async () => {
    const res = await admin.get('/intune/check?refresh=1');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { rows, summary } = res.body;

    assert.equal(res.body.intune_total, 12, 'every page of devices was read');
    assert.equal(res.body.intune_duplicates, 1);

    assert.equal(kindOf(rows, '5cg-1234 abc'), 'match');
    assert.equal(kindOf(rows, 'DL5420X1'), 'different');
    assert.equal(kindOf(rows, 'PF2ABCDE'), 'unassigned_here');
    assert.equal(kindOf(rows, '5CD9999ZZZ'), 'no_user');
    assert.equal(kindOf(rows, 'OPT7090A'), 'shared_here');
    assert.equal(kindOf(rows, 'PRODESK77'), 'shared_here');
    assert.equal(kindOf(rows, 'C02RETIRED1'), 'gone_but_active');
    assert.equal(kindOf(rows, 'C02LOSTOLD1'), 'match');
    assert.equal(kindOf(rows, 'NOTENROLLED1'), 'not_in_intune');
    assert.equal(kindOf(rows, 'BRANDNEW99'), 'not_in_register');
    assert.equal(kindOf(rows, 'CHAIR0001'), undefined, 'furniture is not expected in Intune');

    assert.equal(summary.no_serial, 1);
    assert.equal(summary.personal_not_in_register, 1);
    // The app asks Microsoft only for the fields it uses.
    assert.doesNotMatch(JSON.stringify(res.body), /should not be selected/);
});

test('a device Intune knows and the register does not comes with a suggestion for adding it', async () => {
    const { rows } = (await admin.get('/intune/check')).body;
    const fresh = rows.find((row) => row.device && row.device.serial_number === 'BRANDNEW99');
    assert.equal(fresh.device.suggested.brand, 'HP');
    assert.equal(fresh.device.suggested.serial_number, 'BRANDNEW99');
    // A placeholder serial is left for a person to read off the device.
    const vm = rows.find((row) => row.device && row.device.name === 'VM-TEST');
    assert.equal(vm.device.suggested.serial_number, '');
});

test('when the permission has not been granted, the answer says which one is needed', async () => {
    microsoft.state.refuseIntune = true;
    try {
        const res = await admin.get('/intune/check?refresh=1');
        assert.equal(res.status, 403);
        assert.match(res.body.error, /DeviceManagementManagedDevices\.Read\.All/);
    } finally {
        microsoft.state.refuseIntune = false;
    }
});

test('the check only reads: nothing in the register changes', async () => {
    const before = (await admin.get('/reports/by-status')).body;
    await admin.get('/intune/check?refresh=1');
    assert.deepEqual((await admin.get('/reports/by-status')).body, before);
    assert.ok(microsoft.state.requests.every((line) => line.startsWith('GET ') || line.includes('/oauth2/')));
});

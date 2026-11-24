const { test } = require('node:test');
const assert = require('node:assert/strict');
const classifier = require('../../server/services/classifier');

// What a newly typed asset name is filed under when the category or brand is
// left blank. `sure` is false when a person should check the suggestion.
// [name, model, category, brand, sure]
const cases = [
  ['HP EliteBook 840 G8', '', 'Laptop', 'HP', true],
  ['HP 250 G9 Laptop, Intel i5, 8GB RAM, 256GB SSD, Windows 11, UK Keyboard', '', 'Laptop', 'HP', true],
  ['Dell Latitude 5420 14" i5 16GB 512GB SSD UK keyboard', '', 'Laptop', 'Dell', true],
  ['Lenovo ThinkPad T14 Gen 3', '', 'Laptop', 'Lenovo', true],
  ['Laptop', 'Latitude 5420', 'Laptop', 'Dell', true],
  ['Staff laptop', '', 'Laptop', '', true],
  ['MacBook Air M2', '', 'Laptop', 'Apple', true],
  ['HP EliteBook 840 G8 with charger and bag', '', 'Laptop', 'HP', true],
  ['Laptop charger for HP EliteBook', '', 'Accessory', 'HP', true],
  ['Dell Latitude 5420 charger', '', 'Accessory', 'Dell', false],
  ['Laptop bag 15.6"', '', 'Accessory', '', true],
  ['Dell OptiPlex 7090 SFF', '', 'Desktop', 'Dell', true],
  ['HP ProDesk 400 G7 Desktop PC i5 8GB 256GB SSD', '', 'Desktop', 'HP', true],
  ['Desktop PC', '', 'Desktop', '', true],
  ['iMac 24"', '', 'Desktop', 'Apple', true],
  ['Lenovo ThinkCentre M70q', '', 'Desktop', 'Lenovo', true],
  ['Dell Inspiron 15 3520', '', 'Laptop', 'Dell', false],
  ['Dell Inspiron Desktop 3910', '', 'Desktop', 'Dell', true],
  ['Dell 24 Monitor P2422H', '', 'Monitor', 'Dell', true],
  ['Monitor with stand', '', 'Monitor', '', true],
  ['Monitor arm', '', 'Accessory', '', true],
  ['Samsung 27" curved display', '', 'Monitor', 'Samsung', true],
  ['DisplayPort cable 2m', '', 'Accessory', '', true],
  ['iPad 10th Gen', '', 'Tablet', 'Apple', true],
  ['Samsung Galaxy Tab A8', '', 'Tablet', 'Samsung', true],
  ['Wacom graphics tablet', '', 'Peripheral', '', true],
  ['iPhone 13', '', 'Phone', 'Apple', true],
  ['Yealink T54W desk phone', '', 'Phone', 'Yealink', true],
  ['Phone charger', '', 'Accessory', '', true],
  ['Logitech wireless mouse M185', '', 'Peripheral', 'Logitech', true],
  ['Keyboard and mouse set', '', 'Peripheral', '', true],
  ['Jabra Evolve 20 headsets', '', 'Peripheral', 'Jabra', true],
  ['Headphones', '', 'Peripheral', '', true],
  ['Logitech C920 webcam', '', 'Peripheral', 'Logitech', true],
  ['HP LaserJet Pro M404dn', '', 'Printer', 'HP', true],
  ['Toner for HP LaserJet', '', 'Consumables', 'HP', true],
  ['Brother label printer QL-820', '', 'Printer', 'Brother', true],
  ['Barcode scanner', '', 'Peripheral', '', true],
  ['Epson EB-W49 projector', '', 'Audio Visual', 'Epson', true],
  ['Promethean ActivPanel 75"', '', 'Audio Visual', 'Promethean', true],
  ['Samsung 55" TV', '', 'Audio Visual', 'Samsung', true],
  ['Cisco Catalyst 2960 switch', '', 'Networking', 'Cisco', true],
  ['KVM switch', '', 'Accessory', '', true],
  ['UniFi access point U6', '', 'Networking', 'Ubiquiti', true],
  ['Dell PowerEdge R740 server', '', 'Server', 'Dell', true],
  ['Kingston 16GB DDR4 RAM laptop memory', '', 'Storage & Components', 'Kingston', true],
  ['16GB RAM for Dell Latitude', '', 'Storage & Components', 'Dell', true],
  ['SanDisk 64GB USB stick', '', 'Storage & Components', 'SanDisk', true],
  ['Samsung 1TB SSD', '', 'Storage & Components', 'Samsung', true],
  ['USB-C docking station', '', 'Accessory', '', true],
  ['Lenovo ThinkPad USB-C dock', '', 'Accessory', 'Lenovo', false],
  ['HDMI cables', '', 'Accessory', '', true],
  ['Classroom table', '', 'Furniture', '', true],
  ['Office chair', '', 'Furniture', '', true],
  ['Standing desk 160cm', '', 'Furniture', '', true],
  ['Desk with drawers', '', 'Furniture', '', true],
  ['Whiteboard 1200x900', '', 'Furniture', '', true],
  ['Tablet PC', '', 'Desktop', '', true],   // known limitation: checked by a person
  ['Fire extinguisher', '', '', '', false],
  ['Trolley', '', '', '', false],
  ['hp', '', '', 'HP', false],
  ['Chipset upgrade bulgaria', '', '', '', false],
];

for (const [name, model, category, brand, sure] of cases) {
    test(`${name}${model ? ` (${model})` : ''} → ${category || 'no category'}${brand ? ` / ${brand}` : ''}`, () => {
        const result = classifier.classify({ name, model });
        assert.equal(result.category, category);
        assert.equal(result.brand, brand);
        assert.equal(result.sure, sure);
    });
}

test('brand spellings are settled into one', () => {
    assert.deepEqual(
        ['hp', 'Hewlett Packard', 'DELL', 'lenovo '].map(classifier.normaliseBrand),
        ['HP', 'HP', 'Dell', 'Lenovo']
    );
});

test('a suggested category is matched to the names this organisation uses', () => {
    assert.equal(classifier.resolveCategoryName('Networking', ['Network', 'Laptop']), 'Network');
    assert.equal(classifier.resolveCategoryName('Tablet', ['Mobile Device', 'Tablets']), 'Tablets');
});

test('an organisation\'s own keyword rule wins', () => {
    const result = classifier.classify({ name: 'Clevertouch Impact 75' }, [{ keyword: 'impact 75', category: 'Classroom screens' }]);
    assert.equal(result.category, 'Classroom screens');
    assert.equal(result.custom, true);
});

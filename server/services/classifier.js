// Works out what kind of thing an asset is (and who made it) from its name
// and model. Pure text rules, no database: the same function serves the
// asset form's suggestion, the Excel and invoice imports, and the tidy-up
// tool that fixes the existing register.
//
// It is a best guess. Every result says whether it is `sure`; callers only
// act on unsure results after a person has looked at them.

// Build /\b(?:a|b|c)(?:s|es)?\b/i so "charger" also matches "chargers".
function words(list) {
    const body = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ -]?')).join('|');
    return new RegExp(`\\b(?:${body})(?:s|es)?\\b`, 'i');
}

// Things that mention a device but are an add-on to one. In a compound noun
// the last word is the thing itself ("laptop charger", "monitor arm").
const ADD_ONS = [
    ['Consumables', words([
        'toner', 'ink cartridge', 'cartridge', 'drum unit', 'printer paper', 'copier paper', 'label roll', 'ribbon',
        'marker', 'eraser', 'cleaning wipe', 'screen wipe'
    ])],
    ['Storage & Components', words([
        'ssd', 'hdd', 'hard drive', 'hard disk', 'external drive', 'nvme', 'ram', 'dimm', 'sodimm', 'memory module',
        'memory card', 'sd card', 'usb stick', 'usb drive', 'flash drive', 'pen drive', 'memory stick',
        'graphics card', 'gpu', 'motherboard'
    ])],
    ['Peripheral', words([
        'mouse', 'mice', 'keyboard', 'headset', 'headphone', 'earbud', 'earphone', 'webcam', 'speaker', 'microphone',
        'presenter', 'clicker', 'barcode scanner', 'card reader', 'keypad', 'trackpad', 'trackball',
        'graphics tablet', 'drawing tablet'
    ])],
    ['Accessory', words([
        'bag', 'backpack', 'sleeve', 'carry case', 'case', 'cover', 'charger', 'power adapter', 'ac adapter', 'adapter',
        'adaptor', 'power supply', 'psu', 'battery', 'batteries', 'stand', 'riser', 'monitor arm', 'mount', 'bracket',
        'dock', 'docking station', 'port replicator', 'cable', 'lead', 'usb hub', 'usb c hub', 'dongle', 'splitter',
        'kvm', 'privacy filter', 'privacy screen', 'screen protector', 'cable lock', 'laptop lock', 'stylus', 'pencil',
        'surge protector', 'extension lead', 'power strip', 'ups'
    ])]
];

// Actual devices. Checked in order, so the explicit words ("desktop") come
// before model families that could be either ("inspiron"). Each row is
// [category, pattern, sure, isModelFamily].
const DEVICES = [
    ['Audio Visual', words([
        'projector', 'tv', 'television', 'interactive panel', 'interactive display', 'interactive whiteboard',
        'interactive screen', 'interactive flat panel', 'smart board', 'smartboard', 'promethean', 'clevertouch',
        'surface hub', 'visualiser', 'visualizer', 'soundbar', 'apple tv', 'chromecast', 'digital signage',
        'camera', 'camcorder'
    ]), true, false],
    ['Laptop', words(['laptop', 'notebook', 'chromebook', 'macbook', 'ultrabook']), true, false],
    ['Desktop', words([
        'desktop', 'all in one', 'aio', 'tower pc', 'mini pc', 'micro pc', 'thin client', 'workstation', 'imac',
        'mac mini', 'mac studio', 'mac pro', 'nuc', 'pc'
    ]), true, false],
    ['Tablet', words(['ipad', 'tablet', 'galaxy tab', 'surface go', 'kindle', 'fire hd']), true, false],
    ['Phone', words(['iphone', 'smartphone', 'mobile phone', 'desk phone', 'ip phone', 'handset', 'phone']), true, false],
    ['Printer', words([
        'printer', 'laserjet', 'officejet', 'deskjet', 'pagewide', 'mfp', 'multifunction', 'photocopier', 'copier',
        'plotter', 'scanner', 'ecotank', 'pixma', 'imagerunner', 'bizhub', 'ecosys'
    ]), true, false],
    ['Monitor', words(['monitor', 'ultrasharp', 'thinkvision', 'display']), true, false],
    ['Server', words(['server', 'poweredge', 'proliant', 'nas', 'synology', 'qnap']), true, false],
    ['Networking', words([
        'router', 'network switch', 'switch', 'access point', 'firewall', 'modem', 'wifi extender', 'wi-fi extender',
        'mesh', 'unifi', 'meraki', 'patch panel', 'sonicwall', 'fortigate', 'draytek'
    ]), true, false],
    // Model families that are (nearly) always one kind of machine.
    ['Laptop', words([
        'elitebook', 'probook', 'zbook', 'thinkpad', 'ideapad', 'latitude', 'vivobook', 'zenbook', 'travelmate',
        'surface laptop', 'surface book', 'surface pro', 'dynabook', 'tecra', 'portege', 'x360', 'spectre'
    ]), true, true],
    ['Desktop', words(['optiplex', 'prodesk', 'elitedesk', 'thinkcentre', 'ideacentre', 'veriton']), true, true],
    // Families sold as both laptops and desktops: a guess to be checked.
    ['Laptop', words(['inspiron', 'xps', 'vostro', 'pavilion', 'aspire', 'precision']), false, true],
    ['Furniture', words([
        'desk', 'table', 'chair', 'stool', 'cabinet', 'cupboard', 'shelf', 'shelves', 'shelving', 'bookcase', 'locker',
        'sofa', 'pedestal', 'drawer unit', 'filing', 'whiteboard', 'noticeboard', 'lectern', 'bench', 'wardrobe'
    ]), true, false]
];

// A device described with its specification ("… i5 16GB 512GB SSD, UK
// keyboard") names parts without being one.
const SPEC = /\b\d+ ?(?:gb|tb)\b|\bi[3579]\b|\bryzen\b|\bceleron\b|\bpentium\b|\bwindows\b|\bwin ?1[01]\b|\b\d{2}(?:\.\d)? ?(?:"|”|in\b|inch)/i;

// Makers: [name, other spellings of the name, product names that give it
// away]. Product names are only listed where they cannot mean anything else.
const BRANDS = [
    ['HP', ['hewlett packard', 'hewlett-packard', 'hp inc'], ['elitebook', 'probook', 'prodesk', 'elitedesk', 'zbook', 'laserjet', 'officejet']],
    ['Dell', [], ['latitude', 'optiplex', 'inspiron', 'vostro', 'poweredge', 'ultrasharp']],
    ['Lenovo', [], ['thinkpad', 'thinkcentre', 'ideapad', 'ideacentre', 'thinkvision']],
    ['Apple', [], ['macbook', 'imac', 'ipad', 'iphone', 'mac mini', 'mac studio', 'airpods']],
    ['Microsoft', [], ['surface pro', 'surface laptop', 'surface go', 'surface book', 'surface hub']],
    ['Samsung', [], ['galaxy tab']],
    ['Asus', [], ['vivobook', 'zenbook']],
    ['Acer', [], ['travelmate', 'veriton']],
    ['Toshiba', [], ['dynabook', 'tecra', 'portege']],
    ['Amazon Basics', ['amazonbasics'], []],
    ['Logitech', ['logi'], []],
    ['Cisco', [], ['meraki']],
    ['Ubiquiti', [], ['unifi']],
    ['TP-Link', ['tp link', 'tplink'], []],
    ['Netgear', [], []],
    ['Canon', [], ['pixma', 'imagerunner']],
    ['Epson', [], ['ecotank']],
    ['Brother', [], []],
    ['Kyocera', [], ['ecosys']],
    ['Konica Minolta', ['konica'], ['bizhub']],
    ['Xerox', [], []],
    ['LG', [], []],
    ['Sony', [], []],
    ['Philips', [], []],
    ['BenQ', [], []],
    ['AOC', [], []],
    ['iiyama', [], []],
    ['ViewSonic', [], []],
    ['Promethean', [], []],
    ['Clevertouch', [], []],
    ['Jabra', [], []],
    ['Poly', ['polycom', 'plantronics'], []],
    ['Yealink', [], []],
    ['Anker', [], []],
    ['Ugreen', [], []],
    ['Belkin', [], []],
    ['Kensington', [], []],
    ['Targus', [], []],
    ['SanDisk', [], []],
    ['Kingston', [], []],
    ['Crucial', [], []],
    ['Seagate', [], []],
    ['Western Digital', ['wd'], []],
    ['Synology', [], []],
    ['APC', [], []],
    ['Google', [], ['chromecast']],
    ['Huawei', [], []],
    ['MSI', [], []]
].map(([brand, spellings, products]) => ({
    brand,
    spellings: [brand.toLowerCase(), ...spellings],
    re: words([brand.toLowerCase(), ...spellings, ...products])
}));

// Category names that mean the same thing, most specific first. The first
// existing category that matches is used, so a register that already has
// "Laptops" or "Network" keeps its own names.
const CATEGORY_ALIASES = {
    Laptop: ['laptop', 'laptops', 'notebook', 'notebooks'],
    Desktop: ['desktop', 'desktops', 'desktop pc', 'desktop pcs', 'desktop computer', 'desktop computers', 'pc', 'pcs', 'computer', 'computers', 'workstation', 'workstations'],
    Monitor: ['monitor', 'monitors', 'display', 'displays', 'screen', 'screens'],
    Tablet: ['tablet', 'tablets', 'ipad', 'ipads', 'mobile device', 'mobile devices'],
    Phone: ['phone', 'phones', 'mobile phone', 'mobile phones', 'smartphone', 'smartphones', 'mobile', 'mobiles', 'mobile device', 'mobile devices'],
    Printer: ['printer', 'printers', 'printers & scanners', 'printers and scanners'],
    Peripheral: ['peripheral', 'peripherals'],
    Accessory: ['accessory', 'accessories'],
    Networking: ['networking', 'network', 'networks', 'network equipment'],
    Server: ['server', 'servers'],
    'Storage & Components': ['storage & components', 'storage and components', 'storage', 'components', 'component'],
    'Audio Visual': ['audio visual', 'audio-visual', 'audio/visual', 'av', 'a/v', 'av equipment', 'projector', 'projectors'],
    Consumables: ['consumables', 'consumable'],
    Furniture: ['furniture']
};
const ELECTRONIC = new Set([
    'Laptop', 'Desktop', 'Monitor', 'Tablet', 'Phone', 'Printer', 'Peripheral', 'Accessory', 'Networking', 'Server',
    'Storage & Components', 'Audio Visual'
]);
// Catch-all categories: an asset filed under one of these has not really
// been categorised yet.
const GENERIC_ELECTRONIC = ['other electronics', 'electronics', 'electronic', 'it equipment', 'it'];
const GENERIC = [...GENERIC_ELECTRONIC, 'other', 'others', 'misc', 'miscellaneous', 'general', 'equipment', 'uncategorised', 'uncategorized', 'unknown', 'n/a'];

const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

// The part of a name that says what the thing is: before any "with …",
// "for …" or the first comma / bracket / dash.
function headOf(name) {
    return String(name || '')
        .split(/\s+(?:with|w\/|including|incl\.?|inc\.?|plus|for)\s+|\s[-–—|]\s|[,(;+]/i)[0]
        .trim();
}

function firstMatch(list, text) {
    for (const [category, re, sure, family] of list) {
        const match = text.match(re);
        if (match) {
            return {
                category,
                matched: match[0].toLowerCase(),
                sure: sure !== false,
                family: Boolean(family),
                index: match.index,
                end: match.index + match[0].length
            };
        }
    }
    return null;
}

function typeFrom(text, model) {
    const addOn = firstMatch(ADD_ONS, text);
    const device = firstMatch(DEVICES, [text, model].filter(Boolean).join(' '));
    if (!addOn || !device) return addOn || device;

    // Both a machine and a part are named.
    const compound = device.end <= addOn.index && !text.slice(device.end, addOn.index).trim();
    if (device.index < addOn.index && !compound && SPEC.test(text)) {
        // "Latitude 5420 i5 16GB 512GB SSD, UK keyboard": the machine, with
        // its specification listed after it. ("Laptop bag 15.6in" is not:
        // the part follows the machine's name directly.)
        return device;
    }
    // "Laptop charger", "16GB RAM for desktops": the part. When only a model
    // family names the machine ("ThinkPad keyboard") it could be either, so
    // that one is left for a person to confirm.
    return { ...addOn, sure: !device.family || addOn.index < device.index };
}

function detectBrand(...texts) {
    const text = texts.filter(Boolean).join(' ');
    let best = null;
    for (const entry of BRANDS) {
        const match = text.match(entry.re);
        if (match && (best === null || match.index < best.index)) best = { brand: entry.brand, index: match.index };
    }
    return best ? best.brand : '';
}

// "hp", "Hewlett Packard", "DELL" -> the usual spelling, so one maker does
// not show up as three in the brand breakdown. Unknown brands are left alone.
function normaliseBrand(brand) {
    const value = norm(brand);
    if (!value) return '';
    const known = BRANDS.find((entry) => entry.spellings.includes(value));
    return known ? known.brand : String(brand).trim();
}

/**
 * Classify an asset. `customRules` are the organisation's own
 * [{ keyword, category }] pairs and win over the built-in rules.
 * Returns { category, matched, sure, brand } — category is '' when nothing fits.
 */
function classify({ name, model, brand } = {}, customRules = []) {
    const fullName = String(name || '');
    const detectedBrand = normaliseBrand(brand) || detectBrand(fullName, model);
    const haystack = norm(`${fullName} ${model || ''}`);

    const own = [...customRules]
        .filter((rule) => rule.keyword && haystack.includes(norm(rule.keyword)))
        .sort((a, b) => b.keyword.length - a.keyword.length)[0];
    if (own) {
        return { category: own.category, matched: own.keyword, sure: true, brand: detectedBrand, custom: true };
    }

    // The head of the name first; the full name only if that says nothing.
    const found = typeFrom(headOf(fullName), model) || typeFrom(fullName, model);
    return {
        category: found ? found.category : '',
        matched: found ? found.matched : '',
        sure: found ? found.sure : false,
        brand: detectedBrand
    };
}

// Which of our category names an existing category name stands for.
function canonicalsOf(categoryName) {
    const value = norm(categoryName);
    if (!value) return [];
    return Object.keys(CATEGORY_ALIASES).filter((key) => CATEGORY_ALIASES[key].includes(value));
}

function isGeneric(categoryName) {
    const value = norm(categoryName);
    return !value || GENERIC.includes(value);
}

// Is a category (by whatever name the register uses) electronic equipment?
function isElectronic(categoryName) {
    const value = norm(categoryName);
    if (!value) return false;
    if (GENERIC_ELECTRONIC.includes(value)) return true;
    const canonicals = canonicalsOf(value);
    if (canonicals.length) return canonicals.some((c) => ELECTRONIC.has(c));
    // A category of the register's own ("Docking stations"): judge its name.
    const guess = typeFrom(value, '');
    return Boolean(guess && ELECTRONIC.has(guess.category));
}

/**
 * Pick the existing category that a classifier result belongs in.
 * `existing` is a list of category names. Returns the existing name, or the
 * classifier's own name when the register has nothing equivalent yet.
 */
function resolveCategoryName(category, existing) {
    if (!category) return '';
    const byName = new Map(existing.map((name) => [norm(name), name]));
    if (byName.has(norm(category))) return byName.get(norm(category));
    for (const alias of CATEGORY_ALIASES[category] || []) {
        if (byName.has(alias)) return byName.get(alias);
    }
    return category;
}

module.exports = {
    classify,
    detectBrand,
    normaliseBrand,
    canonicalsOf,
    isGeneric,
    isElectronic,
    resolveCategoryName,
    CATEGORY_ALIASES
};

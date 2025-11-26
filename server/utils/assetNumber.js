const db = require('../database');

// Generate next asset number in format AST-YYYY-NNNN
function generateAssetNumber() {
    const year = new Date().getFullYear();
    const prefix = `AST-${year}-`;

    // Get the last asset number for this year
    const lastAsset = db.prepare(
        'SELECT asset_number FROM assets WHERE asset_number LIKE ? ORDER BY asset_number DESC LIMIT 1'
    ).get(`${prefix}%`);

    let nextNumber = 1;

    if (lastAsset) {
        // Extract the number part and increment
        const lastNumber = parseInt(lastAsset.asset_number.split('-')[2]);
        nextNumber = lastNumber + 1;
    }

    // Format with leading zeros (4 digits)
    const formattedNumber = nextNumber.toString().padStart(4, '0');

    return `${prefix}${formattedNumber}`;
}

module.exports = { generateAssetNumber };

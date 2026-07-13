const db = require('../database');

// Generate next book accession number in format LIB-YYYY-NNNN
function generateBookNumber() {
    const year = new Date().getFullYear();
    const prefix = `LIB-${year}-`;

    const lastBook = db.prepare(
        'SELECT book_number FROM books WHERE book_number LIKE ? ORDER BY book_number DESC LIMIT 1'
    ).get(`${prefix}%`);

    let nextNumber = 1;

    if (lastBook) {
        const lastNumber = parseInt(lastBook.book_number.split('-')[2], 10);
        if (!Number.isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
        }
    }

    const formattedNumber = nextNumber.toString().padStart(4, '0');

    return `${prefix}${formattedNumber}`;
}

module.exports = { generateBookNumber };

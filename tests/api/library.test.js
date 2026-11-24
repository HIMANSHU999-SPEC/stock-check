const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers/app');

let app;
let admin;
let book;
let student;
before(async () => {
    app = await startApp();
    admin = await app.login();
    book = (await admin.post('/books', { title: 'Clean Code', author: 'R. Martin', isbn: '9780132350884', quantity: 2 })).body;
    student = (await admin.post('/borrowers', { name: 'Sara Student', type: 'student', identifier: 'S1001', email: 'sara@test.local' })).body;
    assert.ok(book.id && student.id);
});
after(() => app.stop());

const day = (offset) => {
    const at = new Date(Date.now() + offset * 86400000);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};
const copiesOut = async () => (await admin.get(`/books/${book.id}`)).body.issued_quantity;

test('a book needs a title and is given a number', async () => {
    assert.match(book.book_number, /^LIB-\d{4}-\d{4}$/);
    assert.equal((await admin.post('/books', { title: '  ' })).status, 400);
});

test('issuing: only as many copies as there are', async () => {
    const tooMany = await admin.post('/books/issue', { borrower_id: student.id, due_at: day(14), items: [{ book_id: book.id, quantity: 3 }] });
    assert.equal(tooMany.status, 400);
    assert.equal(await copiesOut(), 0);

    assert.equal((await admin.post('/books/issue', { borrower_id: student.id, items: [] })).status, 400);
    assert.equal((await admin.post('/books/issue', { items: [{ book_id: book.id }] })).status, 400);
});

test('a loan is overdue the day after it was due, not on the day', async () => {
    const dueToday = await admin.post('/books/issue', { borrower_id: student.id, due_at: day(0), items: [{ book_id: book.id }] });
    assert.equal(dueToday.status, 201);
    const dueYesterday = await admin.post('/books/issue', { borrower_id: student.id, due_at: day(-1), items: [{ book_id: book.id }] });
    assert.equal(dueYesterday.status, 201);
    assert.equal(await copiesOut(), 2);

    const overdue = (await admin.get('/books/loans?overdue=1')).body;
    assert.deepEqual(overdue.map((loan) => loan.id), [dueYesterday.body.loans[0].loan_id]);

    const all = (await admin.get('/books/loans?status=issued')).body;
    const flags = Object.fromEntries(all.map((loan) => [loan.id, loan.is_overdue]));
    assert.equal(flags[dueToday.body.loans[0].loan_id], false);
    assert.equal(flags[dueYesterday.body.loans[0].loan_id], true);
    assert.equal((await admin.get('/books/summary')).body.overdue_loans, 1);
});

test('returning a loan frees the copy, once', async () => {
    const [loan] = (await admin.get('/books/loans?status=issued')).body;
    assert.equal((await admin.post(`/books/loans/${loan.id}/return`, {})).status, 200);
    assert.equal(await copiesOut(), 1);
    assert.equal((await admin.post(`/books/loans/${loan.id}/return`, {})).status, 400);
    assert.equal(await copiesOut(), 1);
});

test('the loan limit for students is enforced', async () => {
    assert.equal((await admin.put('/books/settings', { student_limit: 1, staff_limit: 0, loan_days: 14 })).status, 200);
    // Sara still has one book out.
    const res = await admin.post('/books/issue', { borrower_id: student.id, due_at: day(14), items: [{ book_id: book.id }] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /limit is 1/);
});

test('a borrower with books out cannot be removed', async () => {
    const res = await admin.del(`/borrowers/${student.id}`);
    assert.equal(res.status, 400);
    assert.equal((await admin.get(`/borrowers/${student.id}`)).status, 200);
});

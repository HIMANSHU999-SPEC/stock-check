# Stock Management System

An asset register and library system built for a three-campus higher-education provider, replacing a spreadsheet inventory that had no assignment history and no reliable way to trace a device back to a person.

Built and maintained by **Himanshu Chadha**. Hosting for the deployed instance is provided by an external supplier; the application is mine.

**Stack:** React 19 + Vite · Node.js + Express · SQLite (embedded — no external database to run)

## Features

- **Asset management** — register, track and assign every organisational asset
- **Automatic asset numbering** — `AST-YYYY-NNNN`, generated on creation
- **Employee management** — staff records and asset assignment history
- **Library module** — book inventory, borrowers (students and staff), QR-code issue/return desk
- **QR code tags** — generate and print asset and book tags
- **Email drafts** — pre-filled assignment emails via the default mail client
- **Cost tracking** — purchase price and Intune licensing cost per asset
- **Reports** — summary statistics, category breakdown, CSV export
- **Recycle bin** — soft delete with password-protected restore
- **Role-based access** — admin and subadmin, SHA-256 hashed credentials
- **Dark/light mode** and responsive layout

## Design notes

A few decisions worth explaining, since they were deliberate:

**SQLite rather than Postgres or MySQL.** The application runs on a single box for a single organisation. An embedded database means no separate service to provision, secure, back up or patch — which matters when the IT team is three people. The database is one file on a mounted volume.

**QR codes over barcodes.** Handheld scanners in keyboard-wedge mode type the code and press Enter, so the issue desk works with any cheap scanner and needs no driver or integration.

**No hardcoded secrets.** Every credential is read from the environment. `AUTH_SECRET`, `ADMIN_PASSWORD`, `RESTORE_PASSWORD` and `MASTER_RESET_PASSWORD` are all injected at runtime — see `DEPLOYMENT.md`. The repository is public, so this is enforced rather than assumed.

## Installation

**Prerequisites:** Node.js v18 or higher, npm

```bash
git clone https://github.com/HIMANSHU999-SPEC/stock-check.git
cd stock-check
npm install
npm run dev
```

This starts the backend on port 3001 and the frontend dev server on port 5173. Open `http://localhost:5173`.

For production deployment and the full environment variable reference, see `DEPLOYMENT.md`.

## Usage

### Assets

**Add** — Assets → Add New Asset. Fill in name, category, model, serial number and prices; the asset number is generated automatically.

**Assign** — open the asset, click Assign to Employee, pick from the dropdown. Every assignment and return is written to the history table.

**Email** — from an assigned asset, Email Employee opens your mail client with the asset details pre-filled.

**Print tags** — Print Tags → select assets → print. Each tag carries a QR code encoding the asset number.

### Reports

Reports shows summary statistics, a category breakdown and Intune pricing analysis. The pricing report exports to CSV.

### Library

The Books, Borrowers and Issue Desk sections form a self-contained library module, available to logged-in admin users.

1. **Add books** — Books → Add New Book. Each book gets an accession number (`LIB-YYYY-NNNN`). Bulk import from Excel is supported, and shelf tags can be printed with the book number encoded.
2. **Add borrowers** — students or staff, with an ID, class or department, and email.
3. **Issue** — scan a book's QR code with a handheld scanner (or type the number). Each scan adds to a temporary list. Set quantities, pick a borrower, set a due date, and issue the whole list at once.
4. **Return** — the Issue Desk lists all outstanding loans with a Return button and flags anything overdue. Returns are also available from a book's detail page.

## Project structure

```
stock-check/
├── server/                 # Express backend
│   ├── index.js
│   ├── database.js         # SQLite setup, password hashing
│   ├── routes/             # assets, employees, books, borrowers, users, auth, reports
│   └── utils/
│       ├── assetNumber.js
│       └── token.js        # signed session tokens
├── src/                    # React frontend
│   ├── components/         # Dashboard, AssetList, AssetForm, AssetDetails,
│   │                       # EmployeeList, Reports, TagPrinter, Login,
│   │                       # UserManagement, RecycleBin
│   ├── services/api.js
│   ├── utils/emailTemplates.js
│   └── App.jsx
├── vite.config.js
└── package.json
```

## API

### Assets
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/assets` | List assets (supports filters) |
| POST | `/api/assets` | Create asset |
| GET | `/api/assets/:id` | Get asset by ID |
| PUT | `/api/assets/:id` | Update asset |
| DELETE | `/api/assets/:id` | Soft delete to recycle bin |
| POST | `/api/assets/:id/assign` | Assign to employee |
| POST | `/api/assets/:id/return` | Return from employee |

### Employees
`GET` `POST` `/api/employees` · `GET` `PUT` `DELETE` `/api/employees/:id`

### Books
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/books` | List (filters: search, category, campus, availability) |
| POST | `/api/books` | Add a book |
| GET | `/api/books/:id` | Book with loan history |
| PUT / DELETE | `/api/books/:id` | Update / delete (blocked while on loan) |
| GET | `/api/books/lookup?number=` | Lookup by accession number (scanner) |
| POST | `/api/books/import` | Bulk import |
| GET | `/api/books/summary` | Library statistics |
| GET | `/api/books/export` | Export inventory to CSV |
| POST | `/api/books/issue` | Issue a list of books to one borrower |
| GET | `/api/books/loans` | List loans (filters: status, overdue) |
| POST | `/api/books/loans/:loanId/return` | Return a loan |

### Borrowers
`GET` `POST` `/api/borrowers` · `GET` `PUT` `DELETE` `/api/borrowers/:id`

### Reports
`/api/reports/summary` · `/api/reports/by-category` · `/api/reports/by-status` · `/api/reports/pricing`

## Database schema

**assets** — id, asset_number, name, category_id, model, serial_number, purchase_date, purchase_price, intune_price, status, assigned_to, location, notes, created_at, updated_at

**employees** — id, name, email, department, phone, created_at

**categories** — id, name, description, created_at

**asset_history** — id, asset_id, action, employee_id, notes, timestamp

**books** — id, book_number, title, author, isbn, category, publisher, published_year, quantity, issued_quantity, shelf_location, campus, notes, created_at, updated_at

**borrowers** — id, name, type (student/staff), identifier, email, class_dept, phone, campus, created_at

**book_loans** — id, book_id, borrower_id, quantity, issued_at, due_at, returned_at, status, issued_by, notes

## Development

```bash
npm run dev       # backend + frontend, hot reload
npm run build     # production build
npm run preview   # serve the production build
```

## Author

**Himanshu Chadha** — IT Manager, London Academy for Applied Technology
[linkedin.com/in/himanshuchadha-it](https://www.linkedin.com/in/himanshuchadha-it)

## License

Copyright © 2026 Himanshu Chadha. All rights reserved.

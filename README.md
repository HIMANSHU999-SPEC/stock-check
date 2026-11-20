# Stock Management System

An asset register and library system built for a three-campus higher-education provider, replacing a spreadsheet inventory that had no assignment history and no reliable way to trace a device back to a person.

Built and maintained by **Himanshu Chadha**. Hosting for the deployed instance is provided by an external supplier; the application is mine.

**Stack:** React 19 + Vite · Node.js + Express · SQLite (embedded — no external database to run)

## Features

- **Asset management** — register, track and assign every organisational asset
- **Automatic asset numbering** — `AST-YYYY-NNNN`, generated on creation
- **Assign, reassign, return** — to a person or to a room; bulk stock (chairs, tables, cables) can be split across several holders, returned in part, and returned in a recorded condition
- **Auto-categorising, with AI** — an asset's category and brand are worked out from its name (on the form, in Excel and invoice imports). With an Anthropic API key configured, Claude does the working out; without one, built-in rules do. Your own "names containing X are Y" rules win over both. A tidy-up screen proposes fixes for the existing register and applies only what you approve
- **Sell to staff** — record that a device has been sold, usually to the person who used it: buyer, price, date and payment reference are kept, the asset stays on record as *sold* and drops out of stock, and the buyer can be emailed a confirmation. A sale can be undone
- **Intune check** — compares the register with Microsoft Intune by serial number: who Intune says uses each device against who it is assigned to here, plus devices known to only one side
- **What we have** — dashboard tiles for laptops, desktops and every other type; click one to split it by brand, click a brand to see those assets
- **Stock by campus** — quantities per campus and category: assigned, available, in repair, written off; move items between campuses with a history trail
- **QR stickers and scanning** — print stickers on A4 label sheets or a label printer; scanning one with a phone or handheld scanner opens the asset, ready to assign or book back in
- **Single sign-on** — sign in with Microsoft (Entra ID); access is still controlled by the Users list
- **Email** — assignment, return and reminder emails sent by the system from the IT support mailbox, with wording editable in Settings and a log of everything sent
- **SharePoint** — the asset register mirrored to a SharePoint list, updated within seconds of a change
- **Employee management** — staff records and asset assignment history
- **Library module** — book inventory, borrowers (students and staff), QR-code issue/return desk
- **Cost tracking** — purchase price and Intune licensing cost per asset
- **Reports** — summary statistics, category breakdown, CSV export
- **Recycle bin** — soft delete with password-protected restore
- **Role-based access** — admin and subadmin, SHA-256 hashed credentials
- **Dark/light mode** and responsive layout

## Design notes

A few decisions worth explaining, since they were deliberate:

**SQLite rather than Postgres or MySQL.** The application runs on a single box for a single organisation. An embedded database means no separate service to provision, secure, back up or patch — which matters when the IT team is three people. The database is one file on a mounted volume.

**QR codes over barcodes.** Handheld scanners in keyboard-wedge mode type the code and press Enter, so the issue desk works with any cheap scanner and needs no driver or integration.

**One-way sync to SharePoint.** This database stays the source of truth and SharePoint receives a copy. Changes are queued in an outbox table and pushed by a background worker, so a Microsoft 365 outage neither blocks nor loses a change made here.

**Sign-in proves identity; the Users list grants access.** Single sign-on never creates accounts. Someone must be added under Users before their Microsoft sign-in is accepted, so membership of the tenant alone gives nobody access.

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

For production deployment and the full environment variable reference, see `DEPLOYMENT.md`. To connect single sign-on, email and SharePoint, see `docs/MICROSOFT365_SETUP.md`.

## Usage

### Assets

**Add** — Assets → Add New Asset. Fill in name, category, model, serial number and prices; the asset number is generated automatically.

**Assign** — from the asset, the asset list or the Scan screen, choose Assign and pick a person or type a room. For bulk stock set a quantity; the rest stays available. Every assignment, reassignment, return and move is written to the history table.

**Reassign / return** — Reassign moves an item straight from one holder to another. Return books it back in and records its condition: an item returned as damaged, needing repair or lost is taken out of circulation until its status is set back to available.

**Email** — the member of staff is emailed automatically on assignment and return (untick the box to skip). Return requests and maintenance notices can be sent from the asset page. Without a configured mailbox the same wording opens in your own mail app instead.

**Stickers** — Print Stickers → choose the sticker type → select assets → print at 100% scale. Each sticker's QR code is a link to the asset, so any phone camera can read it; handheld scanners type it into the Scan screen.

**Tidy up** — Assets → Tidy up lists every asset with no real category, a missing or oddly spelt brand, or (for electronics) no campus, with a suggested fix for each. Untick or change anything, then Apply. Electronics with no campus go under Towerhill (set `HOME_CAMPUS` to change it), ready to be moved on with the bulk move on the asset list. Categories somebody chose by hand are only ever questioned, never changed unless ticked.

**Selling a device** — on an asset's page, press **Sell to them** beside the person who has it (or **Sell** at the top for a device in stock, or to sell to somebody else). Enter the price (0 if it is being given away), the date and a payment reference, confirm the device has been wiped and removed from Intune, and press *Record sale*. The device comes off the holder's list, its status becomes *sold*, and it is no longer counted as stock; it is never deleted, so the record of who bought it and for how much stays. Leavers can be chosen as buyers. Sold devices are listed with their prices under Reports, can be filtered on the asset list, and the Intune check flags any that are still checking in. **Undo sale** on the asset's page puts it back into stock. Only single items can be sold, not a stock line of several; the wording of the confirmation email is under Settings → Email templates (*Asset sold*).

**Intune check** — Assets → Intune check reads every device Microsoft Intune manages and compares it, by serial number, with the register: devices Intune shows with a different person than the one recorded here, devices in use that are still "in stock" here, devices marked lost, stolen or retired that are still checking in, devices Intune knows that are not in the register (and the other way round), and devices that cannot be checked because they have no serial number. Each finding has the obvious next step beside it (reassign to the Intune user, add to the register with the details filled in, add the serial number), and the whole comparison downloads as a CSV. It is read-only on both sides until you press one of those buttons, and never changes anything in Intune. Needs the `DeviceManagementManagedDevices.Read.All` application permission (see [docs/MICROSOFT365_SETUP.md](docs/MICROSOFT365_SETUP.md)). Administrators and sub-administrators only.

**Categorise with AI** — on the Tidy up screen, press *Categorise with AI* to have Claude look at every asset. It runs in the background and its answers appear in the same list as suggestions, marked ✨ AI; nothing changes until you apply them. It asks about each asset once, and again only if the name or model changes. To turn it on, set `ANTHROPIC_API_KEY` in `.env` and restart. Only each asset's name, model, brand and current category are sent to Anthropic — never holders, locations, serial numbers or prices. If the AI cannot be reached, adding and importing assets carries on with the built-in rules.

**Stock by campus** — Inventory shows each campus broken down by category, with links through to the matching assets.

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
│   ├── config.js           # environment / .env configuration
│   ├── routes/             # assets, employees, inventory, settings, mail,
│   │                       # books, borrowers, users, auth, reports
│   ├── services/
│   │   ├── assignments.js  # assign / reassign / return / transfer rules
│   │   ├── aiClassifier.js # category and brand from Claude (Anthropic API)
│   │   ├── classifier.js   # the same from built-in rules (fallback)
│   │   ├── tidy.js         # defaults for new assets, tidy-up of existing ones
│   │   ├── intune.js       # register compared with Intune's device list
│   │   ├── sales.js        # devices sold to staff: record and undo
│   │   ├── sso.js          # Microsoft sign-in (OpenID Connect + PKCE)
│   │   ├── graph.js        # Microsoft Graph client (app identity)
│   │   ├── mailer.js       # email templates, sending, log
│   │   └── sharepoint.js   # list sync and outbox worker
│   └── utils/
│       ├── assetNumber.js
│       └── token.js        # signed session tokens
├── src/                    # React frontend
│   ├── components/         # Dashboard, AssetList, AssetForm, AssetDetails,
│   │                       # AssetActions (assign/return/move dialogs),
│   │                       # Inventory, Scan, TagPrinter, Settings, Login,
│   │                       # EmployeeList, Reports, UserManagement, RecycleBin
│   ├── services/api.js
│   └── App.jsx
├── docs/MICROSOFT365_SETUP.md
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
| POST | `/api/assets/:id/assign` | Assign available stock to a person (`employee_id`) or room (`location`) |
| POST | `/api/assets/:id/reassign` | Move stock from one holder to another |
| POST | `/api/assets/:id/return` | Return stock from a holder (`quantity`, `condition`) |
| POST | `/api/assets/:id/transfer` | Move to another campus / location |
| POST | `/api/assets/:id/email` | Email a holder (return request, maintenance…) |
| GET | `/api/assets/lookup?code=` | Find an asset from a scanned sticker, asset number or serial |

### Inventory
`/api/inventory/summary` — stock by campus and category · `/api/inventory/categories` — each type split by brand · `/api/inventory/locations` — rooms holding stock

### Tidy-up
`GET /api/tidy/preview` — proposed fixes (changes nothing) · `POST /api/tidy/apply` · `POST /api/tidy/ai-run` and `GET /api/tidy/ai-status` — ask the AI about the register · `GET /api/tidy/classify?name=&model=` · `/api/tidy/rules`

### Selling
`POST /api/assets/:id/sell` — `{ employee_id | buyer_name, price, sold_on, payment_reference, notes, send_email }` · `POST /api/assets/:id/sale/undo` · `GET /api/reports/sales`

### Intune check
`GET /api/intune/check` — the register compared with Intune (changes nothing; `?refresh=1` re-reads Intune instead of using the last ten minutes' copy)

### Settings (admin)
`/api/settings/integrations` · `/api/settings/email-templates` · `/api/settings/email-log` · `/api/settings/sharepoint/*`

### Sign-in
`POST /api/auth/login` · `GET /api/auth/sso/login` → Microsoft → `GET /api/auth/sso/callback`

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

**asset_assignments** — id, asset_id, employee_id *or* location_label, quantity, assigned_at, assigned_by, returned_at, returned_by, return_condition, notes. Open rows (no `returned_at`) are who holds what now; `assets.assigned_to` / `assigned_quantity` are a summary of them.

**asset_history** — id, asset_id, action, employee_id, notes, timestamp

**email_templates** — key, subject, body, updated_at, updated_by · **email_log** — every email sent or attempted

**sharepoint_outbox** — assets waiting to be pushed to the SharePoint list

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

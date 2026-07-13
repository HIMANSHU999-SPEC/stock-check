# Stock Management System

A comprehensive stock management application for **London Academy for Applied Technology**, developed by **JH Infotech**.

## Features

- ✅ **Asset Management**: Register, track, and manage all organizational assets
- ✅ **Automatic Asset Numbering**: Auto-generated asset numbers in format `AST-YYYY-NNNN`
- ✅ **Employee Management**: Manage employees and asset assignments
- ✅ **Library Management**: Books inventory, borrowers (students & staff), QR-code issue/return desk
- ✅ **QR Code Tags**: Generate and print asset and book tags with QR codes
- ✅ **Email Drafts**: Create email drafts for asset assignments via default email client
- ✅ **Intune Pricing**: Track purchase prices and Intune pricing for cost analysis
- ✅ **Reports & Analytics**: Comprehensive reporting with CSV export
- ✅ **Dark/Light Mode**: Toggle between dark and light themes
- ✅ **Responsive Design**: Works on desktop, tablet, and mobile devices

## Technology Stack

### Frontend
- React 19 with React Router
- Vite for fast development
- Modern CSS with custom design system
- QR Code generation with react-qr-code

### Backend
- Node.js with Express
- SQLite database (embedded, no external dependencies)
- RESTful API architecture

## Installation

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd stock-management
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the application**
   ```bash
   npm run dev
   ```

   This will start both the backend server (port 3001) and frontend dev server (port 5173).

4. **Access the application**
   Open your browser and navigate to: `http://localhost:5173`

## Usage

### Adding Assets

1. Navigate to **Assets** → **Add New Asset**
2. Fill in asset details (name, category, model, serial number, prices, etc.)
3. Asset number is automatically generated
4. Click **Register Asset**

### Assigning Assets to Employees

1. Go to asset details page
2. Click **Assign to Employee**
3. Select employee from dropdown
4. Click **Assign**

### Email Employee

1. Open asset details for an assigned asset
2. Click **📧 Email Employee**
3. Your default email client will open with a pre-filled draft containing asset details

### Printing Asset Tags

1. Navigate to **Print Tags**
2. Select assets to print
3. Click **🖨️ Print Tags**
4. Use browser print dialog to print QR code tags

### Viewing Reports

1. Navigate to **Reports**
2. View summary statistics, category breakdown, and Intune pricing analysis
3. Export Intune pricing report to CSV

### Library Management

The **Books**, **Borrowers**, and **Issue Desk** sections form a self-contained
library module (available to logged-in admin users).

1. **Add books** — Go to **Books → Add New Book**. Each book gets an auto-generated
   accession number (`LIB-YYYY-NNNN`). You can also bulk-import from Excel and
   print QR tags for the shelves (each tag encodes the book number).
2. **Add borrowers** — Go to **Borrowers** and add **students** or **staff**
   (with an ID, class/department, email, etc.). These are "the people already in
   the system" you issue books to.
3. **Issue books** — Go to **Issue Desk**:
   - Scan a book's QR/barcode with a handheld scanner (keyboard-wedge — it types
     the book number and presses Enter) or type the number manually. Each scan
     adds the book to a **temporary list**.
   - Adjust quantities, pick a borrower already in the system (or add a new one
     inline), set a due date, and click **Issue** to check the whole list out at once.
4. **Return books** — The Issue Desk shows all currently-issued books with a
   **Return** button; overdue loans are flagged. Returns are also available from a
   book's details page.

## Project Structure

```
stock-management/
├── server/                 # Backend server
│   ├── index.js           # Express server
│   ├── database.js        # SQLite database setup
│   ├── routes/            # API routes
│   │   ├── assets.js
│   │   ├── employees.js
│   │   └── reports.js
│   └── utils/
│       └── assetNumber.js # Asset number generator
├── src/                   # Frontend React app
│   ├── components/        # React components
│   │   ├── Dashboard.jsx
│   │   ├── AssetList.jsx
│   │   ├── AssetForm.jsx
│   │   ├── AssetDetails.jsx
│   │   ├── EmployeeList.jsx
│   │   ├── Reports.jsx
│   │   └── TagPrinter.jsx
│   ├── services/
│   │   └── api.js        # API service layer
│   ├── utils/
│   │   └── emailTemplates.js
│   ├── App.jsx           # Main app component
│   ├── main.jsx          # Entry point
│   └── index.css         # Global styles
├── index.html            # HTML template
├── vite.config.js        # Vite configuration
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## API Endpoints

### Assets
- `GET /api/assets` - Get all assets (with optional filters)
- `POST /api/assets` - Create new asset
- `GET /api/assets/:id` - Get asset by ID
- `PUT /api/assets/:id` - Update asset
- `DELETE /api/assets/:id` - Delete asset
- `POST /api/assets/:id/assign` - Assign asset to employee
- `POST /api/assets/:id/return` - Return asset from employee

### Employees
- `GET /api/employees` - Get all employees
- `POST /api/employees` - Create employee
- `GET /api/employees/:id` - Get employee by ID
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee

### Books (Library)
- `GET /api/books` - List books (filters: `search`, `category`, `campus`, `availability`)
- `POST /api/books` - Add a book (auto number `LIB-YYYY-NNNN`)
- `GET /api/books/:id` - Get a book with its loan history
- `PUT /api/books/:id` - Update a book
- `DELETE /api/books/:id` - Delete a book (blocked while copies are on loan)
- `GET /api/books/lookup?number=LIB-YYYY-NNNN` - Look up a book by its number (QR/barcode scan)
- `POST /api/books/import` - Bulk import books
- `GET /api/books/summary` - Library statistics
- `GET /api/books/export` - Export inventory to CSV
- `POST /api/books/issue` - Issue a temporary list of books to one borrower
- `GET /api/books/loans` - List loans (filters: `status`, `overdue`)
- `POST /api/books/loans/:loanId/return` - Return a specific loan

### Borrowers (students & staff)
- `GET /api/borrowers` - List borrowers (filters: `type`, `search`)
- `POST /api/borrowers` - Create a borrower
- `GET /api/borrowers/:id` - Get a borrower with loan history
- `PUT /api/borrowers/:id` - Update a borrower
- `DELETE /api/borrowers/:id` - Delete a borrower (blocked while books are on loan)

### Reports
- `GET /api/reports/summary` - Get summary statistics
- `GET /api/reports/by-category` - Assets by category
- `GET /api/reports/by-status` - Assets by status
- `GET /api/reports/pricing` - Intune pricing report
- `GET /api/reports` - Get all categories

## Database Schema

### Assets Table
- `id`, `asset_number`, `name`, `category_id`, `model`, `serial_number`
- `purchase_date`, `purchase_price`, `intune_price`
- `status`, `assigned_to`, `location`, `notes`
- `created_at`, `updated_at`

### Employees Table
- `id`, `name`, `email`, `department`, `phone`, `created_at`

### Categories Table
- `id`, `name`, `description`, `created_at`

### Asset History Table
- `id`, `asset_id`, `action`, `employee_id`, `notes`, `timestamp`

### Books Table
- `id`, `book_number`, `title`, `author`, `isbn`, `category`, `publisher`, `published_year`
- `quantity`, `issued_quantity`, `shelf_location`, `campus`, `notes`, `created_at`, `updated_at`

### Borrowers Table
- `id`, `name`, `type` (`student`/`staff`), `identifier`, `email`, `class_dept`, `phone`, `campus`, `created_at`

### Book Loans Table
- `id`, `book_id`, `borrower_id`, `quantity`, `issued_at`, `due_at`, `returned_at`, `status`, `issued_by`, `notes`

## Development

### Running in Development Mode
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```

### Running Production Build
```bash
npm run preview
```

## GitHub Upload

This project is ready to be uploaded to GitHub:

1. Initialize git repository (if not already done):
   ```bash
   git init
   ```

2. Add all files:
   ```bash
   git add .
   ```

3. Commit:
   ```bash
   git commit -m "Initial commit: Stock Management System"
   ```

4. Add remote repository:
   ```bash
   git remote add origin <your-github-repo-url>
   ```

5. Push to GitHub:
   ```bash
   git push -u origin main
   ```

## License

Proprietary - JH INFOTECH

## Credits

**Developed by**: JH Infotech  
**For**: London Academy for Applied Technology  
**Version**: 1.0.0

## Support

For support or questions, please contact the JHINFO.TECH

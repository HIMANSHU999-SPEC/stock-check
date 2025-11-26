# Stock Management System

A comprehensive stock management application for **London Academy for Applied Technology**, developed by **JH Infotech**.

## Features

- ✅ **Asset Management**: Register, track, and manage all organizational assets
- ✅ **Automatic Asset Numbering**: Auto-generated asset numbers in format `AST-YYYY-NNNN`
- ✅ **Employee Management**: Manage employees and asset assignments
- ✅ **QR Code Tags**: Generate and print asset tags with QR codes
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

## Deploying on Amazon Lightsail (or other Ubuntu/Debian servers)

If you saw `mkdir: cannot create directory '/opt/apps': Permission denied`, create the directory with `sudo` or choose a location inside your home folder. Here’s a quick, permission-safe path that works on Lightsail:

```bash
mkdir -p ~/apps
cd ~/apps
```

Then clone and run the project:

```bash
git clone https://github.com/HIMANSHU999-SPEC/stock-check.git
cd stock-check
npm install
npm run build
NODE_ENV=production PORT=3001 node server/index.js
```

Expose port `3001` in the Lightsail firewall and visit `http://<instance-ip>:3001`. Wrap the start command in `pm2` or `systemd` to keep the app running after reboots.

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

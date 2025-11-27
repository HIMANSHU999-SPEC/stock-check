const express = require('express');
const cors = require('cors');
const path = require('path');
const { router: authRouter, getUserFromToken, licenseStatus } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
app.use(express.json());

// Initialize database
require('./database');

// Auth & license routes
app.use('/api/auth', authRouter);

// License and auth gate for all other API routes
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    // Allow CORS preflight without auth/license
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    // Skip gate for auth endpoints (handled above)
    if (req.path.startsWith('/api/auth')) {
        return next();
    }

    const license = licenseStatus();
    if (license.expired) {
        return res.status(403).json({ error: 'License expired or not activated', license });
    }

    const user = getUserFromToken(req);
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    next();
});

// API Routes
app.use('/api/assets', require('./routes/assets'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/reports', require('./routes/reports'));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../dist')));

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API available at http://localhost:${PORT}/api`);
});

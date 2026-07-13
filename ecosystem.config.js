// PM2 process configuration for running the app in production on EC2/Lightsail.
//
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup   # to survive reboots
//
// The database path is kept OUTSIDE the repo checkout by default so that code
// updates (git pull) can never touch it. Override DB_PATH to match your server.
module.exports = {
  apps: [
    {
      name: 'stock-management',
      script: 'server/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3001,
        // Keep data on a persistent path outside the repo. Change as needed.
        DB_PATH: process.env.DB_PATH || '/var/lib/stock-management/stock-management.db'
      },
      autorestart: true,
      max_restarts: 10
    }
  ]
};

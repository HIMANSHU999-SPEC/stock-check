/**
 * PM2 Ecosystem Configuration
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   (to auto-start on reboot)
 */
module.exports = {
    apps: [
        {
            name: 'stock-management',
            script: 'server/index.js',
            cwd: '/opt/stock-management',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',

            env_production: {
                NODE_ENV: 'production',
                PORT: 3001,
                AUTH_SECRET: 'CHANGE_THIS_TO_A_LONG_RANDOM_STRING_IN_PRODUCTION'
            }
        }
    ]
};

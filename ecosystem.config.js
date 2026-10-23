// PM2 配置：在 VPS 上 `pm2 start ecosystem.config.js`
const path = require('path');
const fs = require('fs');
const { storageRoot } = require('./modules/storage-root');
const root = storageRoot(__dirname);
const envFile = path.join(root, 'server-env.json');
const serverEnv = fs.existsSync(envFile) ? JSON.parse(fs.readFileSync(envFile, 'utf8')) : {};

module.exports = {
    apps: [{
        name: 'bunnyos',
        script: 'server.js',
        cwd: __dirname,
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        watch: false,
        max_memory_restart: '512M',
        env: {
            NODE_ENV: 'production',
            PORT: 3000,
            ...serverEnv,
            BUNNYOS_STORAGE_DIR: root
        },
        // 日志
        out_file: path.join(root, 'data/logs/out.log'),
        error_file: path.join(root, 'data/logs/err.log'),
        merge_logs: true,
        time: true
    }]
};

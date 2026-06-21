// PM2 配置：在 VPS 上 `pm2 start ecosystem.config.js`
module.exports = {
    apps: [{
        name: 'bunnyos',
        script: 'server.js',
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        watch: false,
        max_memory_restart: '512M',
        env: {
            NODE_ENV: 'production',
            PORT: 3000
        },
        // 日志
        out_file: './data/logs/out.log',
        error_file: './data/logs/err.log',
        merge_logs: true,
        time: true
    }]
};

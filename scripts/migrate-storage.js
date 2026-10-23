// Run once while the old service is stopped. Updates never copy or restore user data.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { storageRoot, USER_PATHS } = require('../modules/storage-root');

const codeDir = path.resolve(__dirname, '..');
let serverEnv = {};
if (process.argv.includes('--pm2')) {
    const apps = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
    const app = apps.find(item => item.name === 'bunnyos');
    serverEnv = app?.pm2_env?.env || {};
    if (!process.env.BUNNYOS_STORAGE_DIR && serverEnv.BUNNYOS_STORAGE_DIR) process.env.BUNNYOS_STORAGE_DIR = serverEnv.BUNNYOS_STORAGE_DIR;
}
const root = storageRoot(codeDir);
const config = Object.fromEntries(Object.entries({ ...serverEnv, ...process.env })
    .filter(([key]) => key.startsWith('BUNNYOS_') || ['PORT', 'NODE_ENV'].includes(key)));
fs.mkdirSync(root, { recursive: true });
const envFile = path.join(root, 'server-env.json');
if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
for (const name of USER_PATHS) {
    const source = path.join(codeDir, name);
    const target = path.join(root, name);
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(target)) throw new Error(`目标已存在，未覆盖：${target}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
}
console.log(`用户数据目录：${root}`);

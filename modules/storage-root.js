const path = require('path');
const fs = require('fs');

function storageRoot(codeDir, env = process.env) {
    const root = path.resolve(codeDir, env.BUNNYOS_STORAGE_DIR || `${codeDir}-data`);
    const relative = path.relative(path.resolve(codeDir), root);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
        throw new Error('BUNNYOS_STORAGE_DIR 必须位于程序目录之外');
    }
    return root;
}

const USER_PATHS = ['settings.json', 'data', 'assets/backgrounds', 'assets/app-icons'];

function requireExternalStorage(codeDir, root) {
    if (USER_PATHS.some(name => fs.existsSync(path.join(codeDir, name)))) {
        throw new Error('请先停止旧服务并运行 node scripts/migrate-storage.js，将用户数据移出程序目录');
    }
    fs.mkdirSync(root, { recursive: true });
}

module.exports = { storageRoot, requireExternalStorage, USER_PATHS };

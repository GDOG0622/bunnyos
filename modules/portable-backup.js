const fs = require('fs');
const path = require('path');

const BACKUP_FORMAT = 'bunnyos-portable-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const INCLUDED_PATHS = ['settings.json', 'data', 'assets/backgrounds', 'assets/app-icons'];
const EXCLUDED_PATHS = new Set([
    'data/_cache',
    'data/backups',
    'data/vapid.json',
    'data/push-subscriptions.json'
]);

function normalizedRelative(rootDir, filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function isExcluded(relativePath) {
    return [...EXCLUDED_PATHS].some(item => relativePath === item || relativePath.startsWith(`${item}/`));
}

function collectFiles(rootDir, targetPath, files, stats) {
    if (!fs.existsSync(targetPath)) return;
    const relativePath = normalizedRelative(rootDir, targetPath);
    if (isExcluded(relativePath)) return;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
        for (const name of fs.readdirSync(targetPath)) {
            collectFiles(rootDir, path.join(targetPath, name), files, stats);
        }
        return;
    }
    if (!stat.isFile()) return;
    stats.bytes += stat.size;
    if (stats.bytes > MAX_BACKUP_BYTES) {
        throw new Error(`备份数据超过 ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)}MB 上限`);
    }
    files[relativePath] = fs.readFileSync(targetPath).toString('base64');
    stats.count += 1;
}

function createPortableBackup(rootDir) {
    const files = {};
    const stats = { count: 0, bytes: 0 };
    for (const relativePath of INCLUDED_PATHS) {
        collectFiles(rootDir, path.resolve(rootDir, relativePath), files, stats);
    }
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        fileCount: stats.count,
        sourceBytes: stats.bytes,
        files
    };
}

function validateBackup(backup) {
    if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
        throw new Error('不是受支持的 BunnyOS 备份文件');
    }
    if (!backup.files || typeof backup.files !== 'object' || Array.isArray(backup.files)) {
        throw new Error('备份文件缺少 files 数据');
    }
    let decodedBytes = 0;
    const entries = [];
    for (const [relativePath, base64] of Object.entries(backup.files)) {
        const normalized = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
        const allowed = INCLUDED_PATHS.some(item => normalized === item || normalized.startsWith(`${item}/`));
        if (!allowed || normalized.includes('../') || isExcluded(normalized)) {
            throw new Error(`备份包含不允许恢复的路径：${relativePath}`);
        }
        if (typeof base64 !== 'string') throw new Error(`备份文件内容无效：${relativePath}`);
        const buffer = Buffer.from(base64, 'base64');
        decodedBytes += buffer.length;
        if (decodedBytes > MAX_BACKUP_BYTES) throw new Error('解压后的备份数据过大');
        entries.push([normalized, buffer]);
    }
    return entries;
}

function clearManagedTarget(rootDir, targetPath) {
    if (!fs.existsSync(targetPath)) return;
    const relativePath = normalizedRelative(rootDir, targetPath);
    if (isExcluded(relativePath)) return;
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory() && relativePath === 'data') {
        for (const name of fs.readdirSync(targetPath)) clearManagedTarget(rootDir, path.join(targetPath, name));
        return;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
}

function clearManagedFiles(rootDir) {
    for (const relativePath of INCLUDED_PATHS) {
        const target = path.resolve(rootDir, relativePath);
        const root = path.resolve(rootDir);
        if (target !== root && target.startsWith(`${root}${path.sep}`)) clearManagedTarget(rootDir, target);
    }
}

function restorePortableBackup(rootDir, backup) {
    const entries = validateBackup(backup);
    const backupsDir = path.join(rootDir, 'data', 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const rollback = createPortableBackup(rootDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rollbackPath = path.join(backupsDir, `before-cloud-restore-${stamp}.json`);
    fs.writeFileSync(rollbackPath, JSON.stringify(rollback), 'utf8');

    clearManagedFiles(rootDir);
    for (const [relativePath, buffer] of entries) {
        const target = path.resolve(rootDir, relativePath);
        const root = path.resolve(rootDir);
        if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`恢复路径越界：${relativePath}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buffer);
    }
    return {
        restoredFiles: entries.length,
        rollbackPath: normalizedRelative(rootDir, rollbackPath)
    };
}

function createPortableBackupFeature({ app, rootDir }) {
    app.get('/api/storage/backup/export', (req, res) => {
        try {
            res.json(createPortableBackup(rootDir));
        } catch (error) {
            res.status(500).json({ error: error?.message || '生成备份失败' });
        }
    });

    app.post('/api/storage/backup/restore', (req, res) => {
        try {
            const result = restorePortableBackup(rootDir, req.body);
            res.json({ success: true, ...result, restartRequired: true });
        } catch (error) {
            res.status(400).json({ error: error?.message || '恢复备份失败' });
        }
    });
}

module.exports = {
    BACKUP_FORMAT,
    createPortableBackup,
    restorePortableBackup,
    createPortableBackupFeature
};

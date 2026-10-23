const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStoragePath } = require('./storage-path');

const BACKUP_FORMAT = 'bunnyos-portable-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const INCLUDED_PATHS = ['settings.json', 'data', 'assets/backgrounds', 'assets/app-icons'];
const EXCLUDED_PATHS = new Set([
    'data/_cache',
    'data/backups',
    'data/access.json',
    'data/vapid.json',
    'data/push-subscriptions.json'
]);

function normalizedRelative(rootDir, filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function isExcluded(relativePath) {
    const normalized = relativePath.toLowerCase();
    return [...EXCLUDED_PATHS].some(item => normalized === item || normalized.startsWith(`${item}/`));
}

function collectFiles(rootDir, targetPath, files, stats) {
    if (!fs.existsSync(targetPath)) return;
    const relativePath = normalizedRelative(rootDir, targetPath);
    if (isExcluded(relativePath)) return;
    safeStoragePath(rootDir, relativePath);
    const stat = fs.lstatSync(targetPath);
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
    const buffer = fs.readFileSync(targetPath);
    files[relativePath] = buffer.toString('base64');
    if (/^data\/chats\/qq\/[^/]+\.json$/.test(relativePath)) {
        let chat;
        try { chat = JSON.parse(buffer.toString('utf8')); } catch { /* Preserve malformed files in rollback snapshots too. */ }
        for (const message of Array.isArray(chat?.messages) ? chat.messages : []) {
            if (message?.type !== 'image') continue;
            const url = message.image_url || '';
            if (!/^\/data\/assets\/chat-images\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|avif)$/.test(url)
                || !fs.existsSync(safeStoragePath(rootDir, url.slice(1)))) stats.missingChatImages += 1;
        }
    }
    stats.count += 1;
}

function createPortableBackup(rootDir) {
    const files = {};
    const stats = { count: 0, bytes: 0, missingChatImages: 0 };
    for (const relativePath of INCLUDED_PATHS) {
        collectFiles(rootDir, path.resolve(rootDir, relativePath), files, stats);
    }
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        fileCount: stats.count,
        sourceBytes: stats.bytes,
        missingChatImages: stats.missingChatImages,
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
    const names = new Set();
    if (Object.keys(backup.files).length > 10000) throw new Error('备份文件数量过多');
    for (const [relativePath, base64] of Object.entries(backup.files)) {
        const normalized = relativePath;
        const parts = normalized.split('/');
        const allowed = normalized === 'settings.json'
            || INCLUDED_PATHS.slice(1).some(item => normalized.startsWith(`${item}/`));
        if (!allowed || parts.some(part => !part || part === '.' || part === '..'
            || /[<>:"\\|?*\x00-\x1f\x7f]|[. ]$/.test(part)
            || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || isExcluded(normalized)) {
            throw new Error(`备份包含不允许恢复的路径：${relativePath}`);
        }
        const nameKey = normalized.toLowerCase();
        if (names.has(nameKey)) throw new Error(`备份包含重复路径：${relativePath}`);
        names.add(nameKey);
        if (typeof base64 !== 'string' || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
            throw new Error(`备份文件内容无效：${relativePath}`);
        }
        const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
        decodedBytes += base64.length / 4 * 3 - padding;
        if (decodedBytes > MAX_BACKUP_BYTES) throw new Error('解压后的备份数据过大');
        const buffer = Buffer.from(base64, 'base64');
        entries.push([normalized, buffer]);
    }
    for (const name of names) {
        const parts = name.split('/');
        while (parts.length > 1) {
            parts.pop();
            if (names.has(parts.join('/'))) throw new Error(`备份路径同时是文件和目录：${name}`);
        }
    }
    if (!names.has('settings.json')) throw new Error('备份缺少 settings.json，拒绝清空当前数据');
    if ((backup.fileCount !== undefined && backup.fileCount !== entries.length)
        || (backup.sourceBytes !== undefined && backup.sourceBytes !== decodedBytes)) {
        throw new Error('备份文件数量或字节数与清单不一致');
    }
    return entries;
}

function restorePortableBackup(rootDir, backup) {
    const entries = validateBackup(backup);
    for (const [relativePath] of entries) safeStoragePath(rootDir, relativePath);
    // Collecting also checks the current managed tree for symlinks before anything is moved.
    const rollback = createPortableBackup(rootDir);
    const transactionDir = fs.mkdtempSync(path.join(path.resolve(rootDir), '.restore-'));
    const stageDir = path.join(transactionDir, 'stage');
    const undoDir = path.join(transactionDir, 'undo');
    const actions = [];
    let keepRecovery = false;
    try {
        for (const [relativePath, buffer] of entries) {
            const target = safeStoragePath(stageDir, relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, buffer, { mode: 0o600 });
        }
        const dataDir = safeStoragePath(rootDir, 'data');
        const stagedData = path.join(stageDir, 'data');
        const dataChildren = new Map([
            ...(fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []),
            ...(fs.existsSync(stagedData) ? fs.readdirSync(stagedData) : [])
        ].map(name => [name.toLowerCase(), name]));
        const targets = [
            'settings.json', 'assets/backgrounds', 'assets/app-icons',
            ...[...dataChildren.values()].map(name => `data/${name}`).filter(name => !isExcluded(name))
        ];
        for (const relativePath of targets) safeStoragePath(rootDir, relativePath);
        const backupsDir = safeStoragePath(rootDir, 'data/backups');
        fs.mkdirSync(backupsDir, { recursive: true });
        const rollbackPath = path.join(backupsDir, `before-cloud-restore-${crypto.randomUUID()}.json`);
        fs.writeFileSync(rollbackPath, JSON.stringify(rollback), { encoding: 'utf8', mode: 0o600 });
        for (const relativePath of targets) {
            const target = safeStoragePath(rootDir, relativePath);
            const staged = path.join(stageDir, relativePath);
            const original = path.join(undoDir, relativePath);
            const action = { target, original, movedOriginal: false, installed: false };
            actions.push(action);
            if (fs.existsSync(target)) {
                fs.mkdirSync(path.dirname(original), { recursive: true });
                fs.renameSync(target, original);
                action.movedOriginal = true;
            }
            if (fs.existsSync(staged)) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.renameSync(staged, target);
                action.installed = true;
            }
        }
        return { restoredFiles: entries.length, rollbackPath: normalizedRelative(rootDir, rollbackPath) };
    } catch (error) {
        try {
            for (const action of actions.reverse()) {
                if (action.installed) fs.rmSync(action.target, { recursive: true, force: true });
                if (action.movedOriginal) fs.renameSync(action.original, action.target);
            }
        } catch (rollbackError) {
            keepRecovery = true;
            throw new Error(`恢复和自动回滚均失败，原文件保留在 ${transactionDir}：${rollbackError.message}`, { cause: error });
        }
        throw error;
    } finally {
        if (!keepRecovery) {
            try { fs.rmSync(transactionDir, { recursive: true, force: true }); } catch (error) {
                console.warn('恢复临时目录清理失败：', transactionDir, error.message);
            }
        }
    }
}

function createPortableBackupFeature({ app, rootDir }) {
    app.get('/api/storage/backup/export', (req, res) => {
        try {
            const backup = createPortableBackup(rootDir);
            if (backup.missingChatImages) {
                return res.status(409).json({ error: `还有 ${backup.missingChatImages} 张聊天原图未上传，请在保存过原图的浏览器打开 QQ 完成迁移后再备份。` });
            }
            res.json(backup);
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

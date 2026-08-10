const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPortableBackup, restorePortableBackup } = require('../modules/portable-backup');

test('portable backup restores managed data and keeps a rollback snapshot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-backup-'));
    try {
        fs.mkdirSync(path.join(root, 'data', 'chats'), { recursive: true });
        fs.mkdirSync(path.join(root, 'data', 'backups'), { recursive: true });
        fs.writeFileSync(path.join(root, 'settings.json'), '{"theme":"pink"}');
        fs.writeFileSync(path.join(root, 'data', 'chats', 'a.json'), '{"messages":["hello"]}');
        const backup = createPortableBackup(root);

        fs.writeFileSync(path.join(root, 'settings.json'), '{"theme":"blue"}');
        fs.writeFileSync(path.join(root, 'data', 'chats', 'a.json'), '{"messages":[]}');
        const result = restorePortableBackup(root, backup);

        assert.equal(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), '{"theme":"pink"}');
        assert.equal(fs.readFileSync(path.join(root, 'data', 'chats', 'a.json'), 'utf8'), '{"messages":["hello"]}');
        assert.equal(fs.existsSync(path.join(root, result.rollbackPath)), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('portable backup rejects paths outside managed storage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-backup-invalid-'));
    try {
        assert.throws(() => restorePortableBackup(root, {
            format: 'bunnyos-portable-backup',
            version: 1,
            files: { '../server.js': Buffer.from('bad').toString('base64') }
        }), /不允许恢复的路径/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

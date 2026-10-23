const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPortableBackup, restorePortableBackup } = require('../modules/portable-backup');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-restore-security-'));
    t.after(() => {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'data', 'chats', 'qq'), { recursive: true });
    fs.writeFileSync(path.join(root, 'settings.json'), '{"key":"keep-me"}');
    fs.writeFileSync(path.join(root, 'data', 'chats', 'qq', 'a.json'), '{"messages":["keep-me"]}');
    return root;
}

test('restore validates every path and file collision before changing current data', t => {
    const root = fixture(t);
    const original = createPortableBackup(root);
    for (const invalid of [
        'data/../../outside.json', 'data/C:/outside.json', 'data/C:\\outside.json',
        'data/..', 'data/a/./b', '/data/a', 'settings.json/a', 'data/NUL.json',
        'data/file.', 'data/VAPID.json', 'data/ACCESS.json', 'data/a:stream'
    ]) {
        const backup = { ...original, files: { ...original.files, [invalid]: 'YQ==' } };
        assert.throws(() => restorePortableBackup(root, backup), /不允许恢复的路径/, invalid);
        assert.deepEqual(createPortableBackup(root).files, original.files, invalid);
    }
    for (const files of [{ 'data/a': 'YQ==', 'data/a/b': 'YQ==' }, { 'data/A': 'YQ==', 'data/a': 'YQ==' }, { 'data/a': 'invalid!' }]) {
        assert.throws(() => restorePortableBackup(root, { ...original, files }));
        assert.deepEqual(createPortableBackup(root).files, original.files);
    }
});

test('restore automatically rolls back a failure after installing some new data', t => {
    const root = fixture(t);
    const original = createPortableBackup(root);
    const backup = { format: original.format, version: original.version, files: { 'settings.json': 'e30=', 'data/new/file.json': 'e30=' } };
    const rename = fs.renameSync;
    let injected = false;
    t.mock.method(fs, 'renameSync', (source, target) => {
        if (!injected && source.includes(`${path.sep}stage${path.sep}data${path.sep}new`)) {
            injected = true;
            throw new Error('injected disk failure');
        }
        return rename(source, target);
    });
    assert.throws(() => restorePortableBackup(root, backup), /injected disk failure/);
    assert.equal(injected, true);
    assert.deepEqual(createPortableBackup(root).files, original.files);
    assert.equal(fs.existsSync(path.join(root, 'data', 'new')), false);
    assert.equal(fs.readdirSync(root).some(name => name.startsWith('.restore-')), false);
});

test('backup and restore reject symlinks and keep server authentication out of portable data', t => {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, 'data', 'access.json'), '{"password":"local-secret"}');
    fs.writeFileSync(path.join(root, 'data', 'vapid.json'), '{"privateKey":"local-push"}');
    const backup = createPortableBackup(root);
    assert.equal(backup.files['data/access.json'], undefined);
    assert.equal(backup.files['data/vapid.json'], undefined);
    restorePortableBackup(root, backup);
    assert.equal(fs.readFileSync(path.join(root, 'data', 'access.json'), 'utf8'), '{"password":"local-secret"}');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-restore-outside-'));
    t.after(() => {
        assert.ok(path.resolve(outside).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(outside, { recursive: true, force: true });
    });
    fs.writeFileSync(path.join(outside, 'secret.json'), 'do not touch');
    const link = path.join(root, 'data', 'linked');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => createPortableBackup(root), /符号链接/);
    assert.throws(() => restorePortableBackup(root, { ...backup, fileCount: 2, sourceBytes: undefined, files: { 'settings.json': 'e30=', 'data/linked/secret.json': 'YQ==' } }), /符号链接/);
    assert.equal(fs.readFileSync(path.join(outside, 'secret.json'), 'utf8'), 'do not touch');
    fs.unlinkSync(link);
});

test('empty and truncated backup manifests cannot erase current storage', t => {
    const root = fixture(t);
    const original = createPortableBackup(root);
    for (const backup of [
        { ...original, files: {} },
        { ...original, files: { 'settings.json': original.files['settings.json'] } },
        { ...original, sourceBytes: original.sourceBytes + 1 }
    ]) {
        assert.throws(() => restorePortableBackup(root, backup), /缺少|不一致/);
        assert.deepEqual(createPortableBackup(root).files, original.files);
    }
});

test('multi-megabyte originals restore without overflowing the base64 validator stack', t => {
    const root = fixture(t);
    const buffer = Buffer.alloc(4 * 1024 * 1024, 42);
    restorePortableBackup(root, {
        format: 'bunnyos-portable-backup', version: 1,
        files: { 'settings.json': 'e30=', 'data/assets/original.png': buffer.toString('base64') }
    });
    assert.deepEqual(fs.readFileSync(path.join(root, 'data/assets/original.png')), buffer);
});

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

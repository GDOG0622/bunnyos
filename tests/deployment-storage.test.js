const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createPortableBackup } = require('../modules/portable-backup');
const { requireExternalStorage } = require('../modules/storage-root');

test('one-time storage migration moves live data and configuration without overwriting a destination', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-deploy-'));
    t.after(() => {
        assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const code = path.join(directory, 'program');
    const storage = path.join(directory, 'user-storage');
    for (const relative of ['modules', 'scripts', 'data/chats/qq', 'assets/backgrounds', 'assets/app-icons']) fs.mkdirSync(path.join(code, relative), { recursive: true });
    for (const relative of ['modules/storage-root.js', 'scripts/migrate-storage.js']) fs.copyFileSync(path.resolve(__dirname, '..', relative), path.join(code, relative));
    fs.writeFileSync(path.join(code, 'settings.json'), JSON.stringify({ latest: 'settings' }));
    fs.writeFileSync(path.join(code, 'data/chats/qq/chat.json'), JSON.stringify({ messages: [{ text: 'last live write' }] }));
    fs.writeFileSync(path.join(code, 'assets/backgrounds/wide-back.png'), 'wallpaper');
    assert.throws(() => requireExternalStorage(code, storage), /停止旧服务/);
    const env = { ...process.env, BUNNYOS_STORAGE_DIR: storage, BUNNYOS_PASSWORD: 'migration-test-password-123456789' };
    const migrate = () => execFileSync(process.execPath, [path.join(code, 'scripts/migrate-storage.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    migrate();
    requireExternalStorage(code, storage);
    assert.equal(JSON.parse(fs.readFileSync(path.join(storage, 'data/chats/qq/chat.json'))).messages[0].text, 'last live write');
    assert.equal(JSON.parse(fs.readFileSync(path.join(storage, 'server-env.json'))).BUNNYOS_PASSWORD, env.BUNNYOS_PASSWORD);
    assert.equal(fs.readFileSync(path.join(storage, 'assets/backgrounds/wide-back.png'), 'utf8'), 'wallpaper');
    migrate();
    fs.writeFileSync(path.join(code, 'settings.json'), '{"latest":"old deployment"}');
    assert.throws(migrate);
    assert.equal(JSON.parse(fs.readFileSync(path.join(storage, 'settings.json'))).latest, 'settings');
    const backup = createPortableBackup(storage);
    assert.ok(backup.files['settings.json']);
    assert.equal(backup.files['server-env.json'], undefined);
    assert.equal(backup.files['modules/storage-root.js'], undefined);
});

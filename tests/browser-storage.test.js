const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB, IDBDatabase } = require('fake-indexeddb');
const fs = require('../browser/fs');
global.indexedDB = indexedDB;

test('browser storage persists atomic replacements, binary media and directory moves across restarts', async () => {
    const name = 'bunnyos-storage-test-' + crypto.randomUUID();
    await fs.initialize(name);
    fs.mkdirSync('/storage/data/chats', { recursive: true });
    fs.writeFileSync('/storage/data/chats/a.tmp', '{"messages":[1]}');
    fs.renameSync('/storage/data/chats/a.tmp', '/storage/data/chats/a.json');
    fs.writeFileSync('/storage/data/image.png', Buffer.from([0, 255, 27, 12]));
    await fs.flush();
    // Changes arriving while an earlier transaction is queued must not be lost.
    fs.writeFileSync('/storage/data/first.json', 'first'); const first = fs.flush();
    fs.writeFileSync('/storage/data/second.json', 'second'); const second = fs.flush();
    await Promise.all([first, second]);
    await fs.initialize(name);
    assert.equal(fs.readFileSync('/storage/data/chats/a.json', 'utf8'), '{"messages":[1]}');
    assert.deepEqual(fs.readFileSync('/storage/data/image.png'), Buffer.from([0, 255, 27, 12]));
    assert.equal(fs.readFileSync('/storage/data/first.json', 'utf8'), 'first');
    assert.equal(fs.readFileSync('/storage/data/second.json', 'utf8'), 'second');
    fs.renameSync('/storage/data/chats', '/storage/data/renamed'); await fs.flush();
    await fs.initialize(name);
    assert.equal(fs.existsSync('/storage/data/chats'), false);
    assert.equal(fs.readFileSync('/storage/data/renamed/a.json', 'utf8'), '{"messages":[1]}');
    fs.rmSync('/storage/data/renamed', { recursive: true }); await fs.flush();
    await fs.initialize(name); assert.equal(fs.existsSync('/storage/data/renamed/a.json'), false);
});

test('a failed browser transaction never acknowledges a save or overwrites the last durable state', async () => {
    const name = 'bunnyos-quota-test-' + crypto.randomUUID();
    await fs.initialize(name);
    fs.writeFileSync('/storage/settings.json', '{"saved":true}'); await fs.flush();
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === 'readwrite') throw new DOMException('Disk full', 'QuotaExceededError');
        return original.apply(this, args);
    };
    try {
        fs.writeFileSync('/storage/settings.json', '{"saved":false}');
        await assert.rejects(fs.flush(), /未确认保存/);
        assert.throws(() => fs.assertHealthy(), /未确认保存/);
    } finally { IDBDatabase.prototype.transaction = original; }
    await fs.initialize(name);
    assert.equal(fs.readFileSync('/storage/settings.json', 'utf8'), '{"saved":true}');
});

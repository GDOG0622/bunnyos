'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorldbookStore } = require('../modules/worldbook-store');

test('worldbooks migrate into named files and keep stable IDs through rename', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-worldbooks-'));
    t.after(() => {
        if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(root, { recursive: true, force: true });
    });
    const directory = path.join(root, 'worldbooks');
    const legacyFile = path.join(root, 'worldbooks.json');
    fs.writeFileSync(legacyFile, JSON.stringify({ books: [
        { id: 'book_1', name: '旧世界', entries: [{ id: 'entry_1', content: '记忆' }] }
    ] }), 'utf8');
    const store = createWorldbookStore({ directory, legacyFile });
    assert.equal(store.read()[0].id, 'book_1');
    assert.ok(fs.existsSync(path.join(directory, '旧世界.json')));
    const renamed = store.read();
    renamed[0].name = '新世界';
    store.write(renamed);
    assert.equal(store.read()[0].entries[0].content, '记忆');
    assert.ok(fs.existsSync(path.join(directory, '新世界.json')));
    assert.ok(!fs.existsSync(path.join(directory, '旧世界.json')));
    assert.throws(() => store.write([...renamed, { id: 'book_2', name: '新世界', entries: [] }]), /名称不能重复/);
    store.write([]);
    assert.deepEqual(store.read(), []);
});

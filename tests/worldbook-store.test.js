'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createWorldbookStore } = require('../modules/worldbook-store');

test('worldbooks migrate into ID files and keep the same path through rename', t => {
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
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.json'));
    assert.equal(files.length, 1);
    const renamed = store.read();
    renamed[0].name = '新世界';
    store.write(renamed);
    assert.equal(store.read()[0].entries[0].content, '记忆');
    assert.deepEqual(fs.readdirSync(directory).filter(name => name.endsWith('.json')), files);
    assert.throws(() => store.write([...renamed, { id: 'book_2', name: '新世界', entries: [] }]), /名称不能重复/);
    store.write([]);
    assert.deepEqual(store.read(), []);
    assert.deepEqual(fs.readdirSync(directory).filter(name => name.endsWith('.json')), []);
});

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-worldbooks-'));
    t.after(() => {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const options = { directory: path.join(root, 'worldbooks'), legacyFile: path.join(root, 'legacy.json') };
    return { options, store: createWorldbookStore(options) };
}

function crashAfterPublish(options) {
    const program = `
        const fs = require('fs');
        const { createWorldbookStore } = require(process.argv[1]);
        const store = createWorldbookStore(JSON.parse(process.argv[2]));
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => { rename(from, to); process.exit(86); };
        const books = store.read();
        books[0].name = 'New';
        store.write(books);
    `;
    const run = spawnSync(process.execPath, ['-e', program, require.resolve('../modules/worldbook-store'), JSON.stringify(options)], { encoding: 'utf8' });
    assert.equal(run.status, 86, run.stderr);
}

test('failed publication preserves the old book; exit after a rename preserves one editable ID', t => {
    const { options, store } = fixture(t);
    store.write([{ id: 'stable-id', name: 'Old', entries: [{ content: 'keep' }] }]);
    const books = store.read();
    books[0].name = 'New';
    const rename = fs.renameSync;
    try {
        fs.renameSync = () => { throw new Error('injected publish failure'); };
        assert.throws(() => store.write(books), /injected publish failure/);
    } finally { fs.renameSync = rename; }
    assert.equal(store.read()[0].name, 'Old');
    crashAfterPublish(options);
    const reopened = createWorldbookStore(options);
    assert.equal(reopened.read().length, 1);
    assert.equal(reopened.read()[0].name, 'New');
    assert.equal(reopened.read()[0].entries[0].content, 'keep');
    const updated = reopened.read();
    updated[0].entries.push({ content: 'editable' });
    updated.push({ id: 'another-id', name: 'Another', entries: [] });
    reopened.write(updated);
    assert.equal(reopened.read().length, 2);
});

for (const crash of [false, true]) {
    test(`legacy duplicate IDs recover after migration ${crash ? 'process exit' : 'cleanup failure'}`, t => {
        const { options, store } = fixture(t);
        fs.mkdirSync(options.directory);
        fs.writeFileSync(path.join(options.directory, '.migration-complete'), '');
        const old = { id: 'stable-id', name: 'Old', entries: [{ content: 'old' }], updated_at: 1 };
        const current = { ...old, name: 'New', entries: [{ content: 'newest' }], updated_at: 2 };
        fs.writeFileSync(path.join(options.directory, 'Old.json'), JSON.stringify(old));
        fs.writeFileSync(path.join(options.directory, 'New.json'), JSON.stringify(current));
        if (crash) crashAfterPublish(options);
        else {
            const remove = fs.rmSync;
            try {
                fs.rmSync = (file, ...args) => {
                    if (file === path.join(options.directory, 'New.json')) throw new Error('injected cleanup failure');
                    return remove(file, ...args);
                };
                assert.throws(() => store.read(), /injected cleanup failure/);
            } finally { fs.rmSync = remove; }
        }
        const reopened = createWorldbookStore(options);
        assert.deepEqual(reopened.read(), [current]);
        assert.equal(fs.readdirSync(options.directory).filter(name => name.endsWith('.json')).length, 1);
        const books = reopened.read();
        books[0].name = 'Editable';
        reopened.write(books);
        assert.equal(reopened.read()[0].name, 'Editable');
    });
}

test('migration detects a legacy filename occupying another ID path before overwriting data', t => {
    const { options, store } = fixture(t);
    const original = { id: 'one', name: 'Original', entries: [{ content: 'keep original' }] };
    store.write([original]);
    const target = fs.readdirSync(options.directory).find(name => name.endsWith('.json'));
    const other = { id: 'two', name: path.basename(target, '.json'), entries: [{ content: 'keep other' }] };
    fs.writeFileSync(path.join(options.directory, target), JSON.stringify(other));
    fs.writeFileSync(path.join(options.directory, 'Original.json'), JSON.stringify(original));
    assert.throws(() => store.read(), /存储路径冲突/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(options.directory, target))), other);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(options.directory, 'Original.json'))), original);
});

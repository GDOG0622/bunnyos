// Synchronous filesystem interface for the shared application logic. IndexedDB is
// the durable store; a successful API response always waits for its transaction.
const path = require('path-browserify');
const { Buffer } = require('buffer');
let entries = new Map(), dirty = new Map(), database, failure;
let committing = Promise.resolve();
const descriptors = new Map();
let nextDescriptor = 1;
const normalize = name => path.resolve('/', descriptors.get(name) || String(name));
const error = (code, name) => Object.assign(new Error(`${code}: ${name}`), { code });
function put(name, entry) {
    entries.set(name, entry);
    if (name.startsWith('/storage/')) dirty.set(name, entry);
}
function remove(name) {
    entries.delete(name);
    if (name.startsWith('/storage/')) dirty.set(name, null);
}
function entry(name) {
    const value = entries.get(normalize(name));
    if (!value) throw error('ENOENT', name);
    return value;
}
function mkdirSync(name, options = {}) {
    name = normalize(name);
    if (entries.has(name)) {
        if (!entries.get(name).directory) throw error('ENOTDIR', name);
        return;
    }
    const parent = path.dirname(name);
    if (parent !== name && !entries.has(parent)) {
        if (!options.recursive) throw error('ENOENT', parent);
        mkdirSync(parent, options);
    }
    put(name, { directory: true, mtimeMs: Date.now() });
}
function writeFileSync(name, data, options = {}) {
    name = normalize(name);
    if (options.flag === 'wx' && entries.has(name)) throw error('EEXIST', name);
    if (!entry(path.dirname(name)).directory) throw error('ENOTDIR', name);
    const encoding = typeof options === 'string' ? options : options.encoding;
    put(name, { data: new Uint8Array(Buffer.from(data, encoding || 'utf8')), mtimeMs: Date.now() });
}
function readFileSync(name, options) {
    const value = entry(name);
    if (value.directory) throw error('EISDIR', name);
    const buffer = Buffer.from(value.data);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? buffer.toString(encoding) : buffer;
}
function statSync(name) {
    const value = entry(name);
    return { size: value.data?.length || 0, mtimeMs: value.mtimeMs, mtime: new Date(value.mtimeMs),
        isFile: () => !value.directory, isDirectory: () => !!value.directory, isSymbolicLink: () => false };
}
function readdirSync(name, options = {}) {
    name = normalize(name);
    if (!entry(name).directory) throw error('ENOTDIR', name);
    return [...entries.keys()].filter(key => key !== name && path.dirname(key) === name).sort().map(key => {
        const basename = path.basename(key);
        return options.withFileTypes ? { name: basename, ...statSync(key) } : basename;
    });
}
function rmSync(name, options = {}) {
    name = normalize(name);
    if (!entries.has(name)) { if (options.force) return; throw error('ENOENT', name); }
    const children = [...entries.keys()].filter(key => key.startsWith(name + '/'));
    if (children.length && !options.recursive) throw error('ENOTEMPTY', name);
    for (const key of [...children, name]) remove(key);
}
function renameSync(from, to) {
    from = normalize(from); to = normalize(to);
    entry(from); entry(path.dirname(to));
    if (from === to) return;
    if (to.startsWith(from + '/')) throw error('EINVAL', to);
    if (entries.get(to)?.directory && readdirSync(to).length) throw error('ENOTEMPTY', to);
    const moved = [...entries].filter(([key]) => key === from || key.startsWith(from + '/'));
    for (const [key, value] of moved) { put(to + key.slice(from.length), value); remove(key); }
}
async function initialize(name, seeds = {}) {
    database?.close();
    failure = undefined; dirty = new Map(); entries = new Map();
    mkdirSync('/storage', { recursive: true }); mkdirSync('/app', { recursive: true });
    for (const [file, content] of Object.entries(seeds)) {
        mkdirSync(path.dirname('/app/' + file), { recursive: true });
        writeFileSync('/app/' + file, Buffer.from(content, 'base64'));
    }
    database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('浏览器数据库被另一个窗口占用，请关闭旧窗口后重试'));
        request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
        const tx = database.transaction('files', 'readonly');
        const cursor = tx.objectStore('files').openCursor();
        cursor.onsuccess = () => { const c = cursor.result; if (c) { entries.set(c.key, c.value); c.continue(); } };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
}
function flush() {
    const batch = dirty; dirty = new Map();
    const commit = committing.then(() => {
        if (failure) throw failure;
        if (!batch.size) return;
        return new Promise((resolve, reject) => {
            const tx = database.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            for (const [name, value] of batch) value === null ? store.delete(name) : store.put(value, name);
            tx.oncomplete = resolve;
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        });
    }).catch(cause => {
        failure = Object.assign(new Error('浏览器未能保存数据。请释放存储空间，关闭本站所有页面后重新打开；此次操作未确认保存。'), { cause, statusCode: 507 });
        throw failure;
    });
    committing = commit.catch(() => {});
    return commit;
}
module.exports = { initialize, flush, assertHealthy() { if (failure) throw failure; },
    mkdirSync, writeFileSync, readFileSync, statSync, lstatSync: statSync, readdirSync, rmSync, renameSync,
    existsSync: name => entries.has(normalize(name)),
    mkdtempSync(prefix) { const dir = prefix + globalThis.crypto.randomUUID(); mkdirSync(dir); return dir; },
    utimesSync(name, _atime, mtime) { const key = normalize(name); put(key, { ...entry(key), mtimeMs: Number(mtime) * 1000 }); },
    openSync(name, flags) { if (flags === 'wx' && entries.has(normalize(name))) throw error('EEXIST', name);
        writeFileSync(name, ''); const fd = nextDescriptor++; descriptors.set(fd, normalize(name)); return fd; },
    fsyncSync() {}, closeSync(fd) { descriptors.delete(fd); }
};

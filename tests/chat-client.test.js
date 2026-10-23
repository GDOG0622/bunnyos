const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mediaRuntime(fetch) {
    const chat = { characterId: 'test', messages: [], version: null, _messagesLoaded: true };
    const context = vm.createContext({
        state: { chats: [chat], activeChatId: null }, fetch,
        getImageBlob: async () => null, toast() {}, renderActiveChat() {},
        loadWalletBalance: async () => {}, ensureChatLoaded: async () => chat,
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps/QQ/scripts/media.js'), 'utf8'), context);
    return { context, chat };
}

test('save queue preserves message edits during an in-flight save and advances the confirmed server version', async () => {
    const requests = [];
    let finishFirst;
    let firstStarted;
    const started = new Promise(resolve => { firstStarted = resolve; });
    const { context, chat } = mediaRuntime(async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        if (requests.length === 1) {
            firstStarted();
            await new Promise(resolve => { finishFirst = resolve; });
        }
        return { ok: true, json: async () => ({ characterId: 'test', messages: body.messages, version: `version-${requests.length}` }) };
    });
    chat.messages.push({ id: 'one', text: 'first' });
    const first = context.saveChat(chat);
    await started;
    chat.messages.push({ id: 'two', text: 'second' });
    const second = context.saveChat(chat);
    finishFirst();
    await Promise.all([first, second]);
    assert.equal(requests[0].version, null);
    assert.equal(requests[1].version, 'version-1');
    assert.equal(requests[1].messages.length, 2);
    assert.equal(chat.messages.length, 2);
    assert.equal(context.state.chats[0], chat, 'generation code retains its live chat reference');
    chat.messages.push({ id: 'three', text: 'assistant reply' });
    await context.saveChat(chat);
    assert.equal(requests[2].messages.length, 3);
});

test('a conflicting save keeps local messages and prevents later queued requests from overwriting the server', async () => {
    let calls = 0;
    const { context, chat } = mediaRuntime(async () => {
        calls += 1;
        return { ok: false, status: 409, json: async () => ({ error_code: 'CHAT_VERSION_CONFLICT', error: 'reload required' }) };
    });
    chat.messages.push({ text: 'keep my unsaved message' });
    await assert.rejects(context.saveChat(chat), /reload required/);
    await assert.rejects(context.saveChat(chat), /保存已暂停/);
    assert.equal(calls, 1);
    assert.equal(chat.messages[0].text, 'keep my unsaved message');
});

function imageRuntime({ failWrite = false, abort = false, loseWrite = false } = {}) {
    const values = new Map();
    const old = new Map([['qq:img:one', 'data:image/png;base64,YQ==']]);
    const logs = [];
    const db = {
        transaction() {
            const tx = {};
            tx.objectStore = () => ({
                put(value, key) {
                    queueMicrotask(() => {
                        if (abort) tx.onabort();
                        else if (failWrite) tx.onerror();
                        else { if (!loseWrite) values.set(key, value); tx.oncomplete(); }
                    });
                },
                get(key) {
                    const request = {};
                    queueMicrotask(() => { request.result = values.get(key); request.onsuccess(); });
                    return request;
                }
            });
            return tx;
        }
    };
    const context = vm.createContext({
        indexedDB: { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } },
        localStorage: { get length() { return old.size; }, key: index => [...old.keys()][index], getItem: key => old.get(key), removeItem: key => old.delete(key) },
        console: { warn() {}, log: message => logs.push(message) }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps/QQ/scripts/image-cache.js'), 'utf8'), context);
    return { context, old, values, logs };
}

test('failed, aborted and unverified cache writes preserve the original localStorage image', async () => {
    for (const failure of [{ failWrite: true }, { abort: true }, { loseWrite: true }]) {
        const { context, old, logs } = imageRuntime(failure);
        if (!failure.loseWrite) await assert.rejects(context.putImageBlob('one', 'image'));
        assert.equal(await context.migrateLocalStorageImagesToIdb(), 0);
        assert.equal(old.has('qq:img:one'), true);
        assert.equal(logs.length, 0);
    }
});

test('a verified cache migration removes the source only after the IDB transaction commits', async () => {
    const { context, old, values } = imageRuntime();
    assert.equal(await context.migrateLocalStorageImagesToIdb(), 1);
    assert.equal(old.size, 0);
    assert.equal(values.get('one'), 'data:image/png;base64,YQ==');
});

test('legacy image upload includes the server version and keeps the cache if upload conflicts', async () => {
    const { context, values } = imageRuntime();
    const requests = [];
    context.fetch = async (url, options) => {
        if (url.endsWith('?summary=1')) return { ok: true, json: async () => [{ characterId: 'test', missingImageCount: 1 }] };
        if (!options) return { ok: true, json: async () => ({ characterId: 'test', version: 'legacy-version', messages: [{ type: 'image', client_image_id: 'one' }] }) };
        requests.push(JSON.parse(options.body));
        return { ok: false, status: 409, json: async () => ({ error: 'reload required' }) };
    };
    await assert.rejects(context.migrateCachedChatImagesToServer(), /reload required/);
    assert.equal(requests[0].version, 'legacy-version');
    assert.equal(requests[0].messages[0].image, 'data:image/png;base64,YQ==');
    assert.equal(values.get('one'), 'data:image/png;base64,YQ==');
});

test('image migration only loads full histories for chats that still need legacy originals', async () => {
    const { context } = imageRuntime();
    const urls = [];
    context.fetch = async url => {
        urls.push(url);
        return { ok: true, json: async () => [{ characterId: 'already-migrated', missingImageCount: 0 }] };
    };
    await context.migrateCachedChatImagesToServer();
    assert.deepEqual(urls, ['/api/qq/chats?summary=1']);
});

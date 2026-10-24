const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function element() {
    return { dataset: {}, style: {}, textContent: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, appendChild() {}, querySelectorAll() { return []; }, querySelector() { return null; },
        getBoundingClientRect() { return { width: 1000, height: 700 }; } };
}

test('the settings save response preserves newer typing and the next request only patches its field', async () => {
    const input = { id: 'mainApi_model', type: 'text', value: 'first' };
    const requests = [];
    let release, started;
    const pending = new Promise(resolve => { started = resolve; });
    const document = { querySelectorAll: () => [input], getElementById: () => element(), addEventListener() {}, documentElement: element() };
    const window = { addEventListener() {}, parent: { postMessage() {} } };
    const context = vm.createContext({ document, window, console, setInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
        fetch: async (_url, options) => {
            const body = JSON.parse(options.body);
            requests.push(body);
            if (requests.length === 1) { started(); await new Promise(resolve => { release = resolve; }); }
            return { ok: true, json: async () => ({ settings: { mainApi_model: body.changes.mainApi_model, untouched: true, _version: `v${requests.length}` } }) };
        }
    });
    vm.runInContext(source('apps/settings/settings.js'), context);
    vm.runInContext("settings = { mainApi_model: '', untouched: true, _version: 'v0' }; confirmedSettings = JSON.parse(JSON.stringify(settings)); settingsVersion = 'v0'; settingsFormValues = { mainApi_model: '' };", context);
    const first = context.saveData();
    const flushing = context.flushSettingsSave();
    await pending;
    input.value = 'second';
    const second = context.saveData();
    release();
    await flushing;
    assert.equal(vm.runInContext('settings.mainApi_model', context), 'second');
    await context.flushSettingsSave();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.deepEqual(requests, [{ version: 'v0', changes: { mainApi_model: 'first' } }, { version: 'v1', changes: { mainApi_model: 'second' } }]);
    context.console = { error() {} };
    context.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'disk failure' }) });
    input.value = 'unsaved';
    const failed = context.saveData();
    await context.flushSettingsSave();
    assert.equal(await failed, false);
    context.fetch = () => { throw new Error('Polling cannot overwrite the unsaved draft'); };
    assert.equal(await context.reloadSettingsIfChanged(), false);
    assert.equal(vm.runInContext('settings.mainApi_model', context), 'unsaved');
});

test('a slow beauty response from A cannot apply to B and the library is fetched once', async () => {
    const styles = new Map();
    const deferred = new Map();
    let libraryFetches = 0;
    const state = { activeChatId: 'A' };
    const document = { getElementById: id => { if (!styles.has(id)) styles.set(id, element()); return styles.get(id); } };
    const context = vm.createContext({ state, document, console, refreshMessageAvatars() {}, fetch: async url => {
        if (url === '/api/qq/beauties') {
            libraryFetches++;
            return { ok: true, json: async () => ({ bubbles: [{ id: 'A', userCss: 'A styles' }, { id: 'B', userCss: 'B styles' }] }) };
        }
        const id = url.split('/').at(-1);
        return new Promise(resolve => deferred.set(id, () => resolve({ ok: true, json: async () => ({ bubbleId: id }) })));
    } });
    vm.runInContext(source('apps/QQ/scripts/chat-settings.js'), context);
    const a = context.applyCharBeauty('A');
    state.activeChatId = 'B';
    const b = context.applyCharBeauty('B');
    deferred.get('B')();
    await b;
    deferred.get('A')();
    await a;
    assert.equal(state.charBeautyCurrent.characterId, 'B');
    assert.match(styles.get('bunny-style-bubble').textContent, /^B styles/);
    await context.applyCharBeauty('B');
    assert.equal(libraryFetches, 1);
    await context.applyCharBeauty('A', true);
    assert.equal(state.charBeautyCurrent.characterId, 'B');
    assert.match(styles.get('bunny-style-bubble').textContent, /^B styles/);
});

test('startup and notification navigation wait for the same QQ readiness, including a failed load and retry', async () => {
    const listeners = new Map();
    const nodes = new Map();
    const messages = [];
    const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
    const document = { getElementById: get, querySelector: get, querySelectorAll() { return []; }, addEventListener() {},
        createElement() { return { ...element(), contentWindow: { postMessage: message => messages.push(message) } }; } };
    const app = { id: 'QQ', entryUrl: '/apps/QQ/index.html' };
    let resolveApps;
    const window = { installedApps: [], bunnyosAppsReady: new Promise(resolve => { resolveApps = resolve; }), innerWidth: 1000, innerHeight: 700,
        matchMedia: () => ({ matches: true, addEventListener() {} }),
        addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); } };
    const context = vm.createContext({ window, document, console, location: { origin: 'http://local.test' },
        requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, clearTimeout() {},
        setTimeout() { throw new Error('Navigation must not use timed retries'); },
        ResizeObserver: class { observe() {} }, fetch() { throw new Error('Apps are already loaded'); }
    });
    vm.runInContext(source('assets/scripts/window-manager.js'), context);
    const ready = window.bunnyosWaitForQq(app);
    assert.equal(window.bunnyosWaitForQq(app), ready);
    const navigation = window.bunnyosOpenAppAndFocusChat('QQ', 'target');
    await Promise.resolve();
    assert.equal(messages.length, 0);
    const iframe = vm.runInContext("getIframeForApp('QQ')", context);
    const signal = type => listeners.get('message').forEach(callback => callback({ source: iframe.contentWindow, origin: 'http://local.test', data: { type } }));
    signal('bunnyos:qq-core-error');
    assert.equal(window.bunnyosWaitForQq(app, true), ready);
    assert.equal(messages.length, 0);
    resolveApps([app]);
    await Promise.resolve();
    signal('bunnyos:qq-core-ready');
    await Promise.all([ready, navigation]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].characterId, 'target');
});

test('bubble playback only reveals saved DOM rows without changing or saving messages', async () => {
    const Replies = require('../assets/scripts/qq-replies');
    const chat = { characterId: 'test', messages: [] };
    Replies.appendReply(chat, ['one', 'two', 'three']);
    const before = JSON.stringify(chat);
    const rows = chat.messages.map((_, index) => ({ dataset: { idx: String(index) }, style: {}, isConnected: true }));
    const box = { querySelectorAll: () => rows, scrollHeight: 100 };
    const context = vm.createContext({ state: { activeChatId: 'test' }, window: {}, $: () => box, getReplyGroup: Replies.getReplyGroup,
        sleep: async () => {}, saveChat() { throw new Error('Playback cannot save'); } });
    vm.runInContext(source('apps/QQ/scripts/chat-render.js'), context);
    await context.revealSavedReply(chat);
    assert.equal(rows[1].style.display, '');
    assert.equal(rows[2].style.display, '');
    assert.equal(JSON.stringify(chat), before);
});

test('worldbook saves retain a conflicting draft across an editor reload', async () => {
    const StPreset = require('../assets/scripts/st-preset');
    const context = vm.createContext({ StPreset, window: { addEventListener() {} }, document: { addEventListener() {} },
        console: { warn() {} }, setTimeout() {}, clearTimeout() {}, fetch: async (_url, options) => options
            ? { ok: false, status: 409, json: async () => ({ error: 'background summary changed' }) }
            : { ok: true, json: async () => ({ books: [{ id: 'book', name: 'server', entries: [{ content: 'new summary' }], _version: 'v2' }] }) }
    });
    vm.runInContext(source('apps/prompt-manager/prompt-manager.js'), context);
    vm.runInContext(`
        state.worldbookBooks = [{ id: 'book', name: 'draft', entries: [{ content: 'keep my draft' }], _version: 'v1' }];
        state.currentBookId = 'book';
        toast = () => {};
        fillWorldInfoSettings = renderWorldbookBookSelect = renderGlobalChips = renderWorldbookEntries = renderWorldbookMeta = () => {};
    `, context);
    assert.equal(await context.saveWorldbooks(), false);
    await context.loadWorldbooks();
    assert.equal(vm.runInContext('state.worldbookBooks[0].entries[0].content', context), 'keep my draft');
    assert.equal(vm.runInContext('state.worldbookBooks[0]._version', context), 'v1');
    assert.equal(vm.runInContext('state.worldbookBooks[0]._saveConflict', context), true);
});

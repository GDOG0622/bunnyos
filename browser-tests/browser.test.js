const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '../dist/browser');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let browser, host, upstream, origin, upstreamUrl, privateRequests = 0, aiCalls = [], cloudBackup;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
test.before(async () => {
    host = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) { privateRequests++; res.writeHead(403); return res.end('PRIVATE SERVER'); }
        const relative = url.pathname.replace(/^\/(phone|other)\//, '') || 'index.html';
        const file = path.resolve(root, relative.endsWith('/') ? relative + 'index.html' : relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
        res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    upstream = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, apikey, x-upsert');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        let body = ''; req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            if (req.url.startsWith('/storage/')) {
                if (req.method === 'POST' && !req.url.includes('/list/')) cloudBackup = JSON.parse(body);
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify(req.method === 'GET' ? cloudBackup : { Key: 'backup.json' }));
            }
            aiCalls.push({ url: req.url, body: JSON.parse(body || '{}') });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '你好，我记得我们的小家。' } }] }));
        });
    });
    await listen(host); await listen(upstream);
    origin = `http://127.0.0.1:${host.address().port}`;
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    const executablePath = process.env.BUNNYOS_TEST_BROWSER || undefined;
    browser = await chromium.launch({ executablePath, headless: true });
});
test.after(async () => { await browser?.close(); host?.close(); upstream?.close(); });
async function open(context) {
    const page = await context.newPage();
    page.on('pageerror', error => console.error('[page]', error.message));
    await page.goto(origin + '/phone/');
    try { await page.waitForURL('**/desktop.html', { timeout: 30000 }); }
    catch (error) { console.error(await page.locator('body').innerText()); throw error; }
    await page.waitForFunction(() => window.BunnyBrowser && navigator.serviceWorker.controller);
    return page;
}
async function request(page, url, method = 'GET', body) {
    return page.evaluate(async ({ url, method, body }) => {
        const res = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: res.status, data: await res.json() };
    }, { url, method, body });
}
async function ok(page, url, method, body) {
    const result = await request(page, url, method, body);
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
}
test('public browser edition isolates visitors, persists data, shares business logic and runs without private APIs', { timeout: 120000 }, async t => {
    const a = await browser.newContext(), b = await browser.newContext();
    a.on('console', message => { if (message.type() === 'error') console.error('[browser]', message.text()); });
    t.after(() => Promise.all([a.close(), b.close()]));
    const pa = await open(a), pb = await open(b);
    assert.equal((await ok(pa, '/api/runtime')).mode, 'browser');
    const apps = await ok(pa, '/api/apps'); assert.ok(apps.some(app => app.id === 'QQ'));
    let settings = await ok(pa, '/api/settings');
    settings = await ok(pa, '/api/settings', 'PATCH', { version: settings._version, changes: { mainApi_url: upstreamUrl + '/v1', mainApi_key: 'test-private-key', mainApi_model: 'test-browser', mainApi_context: 8192, personalMarker: 'visitor-a' } });
    assert.equal((await ok(pb, '/api/settings')).personalMarker, undefined);
    const char = await ok(pa, '/api/qq/characters', 'POST', { id: 'browser-test-char', name: '浏览器角色', char_info: '温柔的朋友' });
    assert.equal(char.name, '浏览器角色');
    assert.equal((await ok(pb, '/api/qq/characters')).length, 0);
    let chat = await ok(pa, '/api/qq/chats/' + char.id);
    chat = await ok(pa, '/api/qq/chats/' + char.id, 'POST', { version: chat.version, messages: [{ role: 'user', type: 'text', text: '你好', created_at: Date.now() }] });
    const stale = await request(pa, '/api/qq/chats/' + char.id, 'POST', { version: null, messages: [] }); assert.equal(stale.status, 409);
    chat = await ok(pa, '/api/qq/chats/' + char.id);
    await ok(pa, '/api/qq/reply', 'POST', { characterId: char.id, version: chat.version, generationId: 'browser-ai', chatType: 'private' });
    chat = await ok(pa, '/api/qq/chats/' + char.id);
    assert.ok(chat.messages.some(message => message.role === 'assistant' && message.text.includes('小家')));
    assert.equal(aiCalls.length, 1);
    // Media is stored in this browser and served locally, including in backups.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMwoAAAAASUVORK5CYII=';
    const uploaded = await ok(pa, '/api/suki/image', 'POST', { dataUrl: png });
    assert.equal(await pa.evaluate(async url => (await fetch(url)).status, uploaded.url), 200);
    let home = await ok(pa, '/api/suki/' + char.id);
    home = await ok(pa, '/api/suki/' + char.id, 'PATCH', { version: home._version, title: '本地小家', startDate: '2026-01-01', timeZone: 'Asia/Shanghai' });
    home = await ok(pa, '/api/suki/' + char.id + '/entries', 'POST', { version: home._version, text: '浏览器日记', image: uploaded.url });
    assert.equal(home.space.entries[0].text, '浏览器日记');
    const book = await ok(pa, '/api/worldbooks/books', 'POST', { name: '本机世界书' }); assert.ok(book.book.id);
    const preset = await ok(pa, '/api/st-presets/new', 'POST', { name: '本机预设' }); assert.ok(preset.id || preset.preset || preset.success);
    const secondTab = await open(a);
    assert.equal((await ok(secondTab, '/api/qq/characters'))[0].id, char.id);
    await pa.reload();
    assert.equal((await ok(pa, '/api/settings')).personalMarker, 'visitor-a');
    const devtools = await a.newCDPSession(pa);
    await devtools.send('ServiceWorker.enable'); await devtools.send('ServiceWorker.stopAllWorkers');
    assert.equal((await ok(pa, '/api/settings')).personalMarker, 'visitor-a');
    assert.equal((await ok(pa, '/api/suki/' + char.id)).space.entries[0].text, '浏览器日记');
    await devtools.detach();
    const backup = await ok(pa, '/api/storage/backup/export');
    assert.equal(backup.format, 'bunnyos-portable-backup');
    assert.ok(backup.files['data/characters/' + char.id + '.json']);
    assert.equal(backup.files['data/access.json'], undefined);
    await ok(pb, '/api/storage/backup/restore', 'POST', backup);
    assert.equal((await ok(pb, '/api/qq/characters'))[0].id, char.id);
    assert.equal(await pb.evaluate(async url => (await fetch(url)).status, uploaded.url), 200);
    const malicious = structuredClone(backup); malicious.files['data/../../escape.json'] = 'e30=';
    assert.equal((await request(pb, '/api/storage/backup/restore', 'POST', malicious)).status, 400);
    assert.equal((await ok(pb, '/api/qq/characters'))[0].id, char.id);
    // Exercise the real cloud adapter against a local provider fixture.
    const settingsPage = await a.newPage(); await settingsPage.goto(origin + '/phone/apps/settings/index.html');
    await settingsPage.waitForFunction(() => window.SupabaseStorage);
    const cloudResult = await settingsPage.evaluate(async url => {
        const provider = new SupabaseStorage({ url, key: 'visitor-cloud-key', bucket: 'private', objectPath: 'backup.json' });
        const sent = await provider.uploadBackup(); const received = await provider.downloadBackup();
        return { sent: sent.fileCount, received: received.fileCount, hasImage: Object.keys(received.files).some(key => key.startsWith('data/assets/chat-images/')) };
    }, upstreamUrl);
    assert.equal(cloudResult.sent, cloudResult.received); assert.equal(cloudResult.hasImage, true);
    assert.ok(cloudBackup.files['data/suki/' + char.id + '.json']);
    await settingsPage.evaluate(() => navTo('page-storage'));
    assert.equal(await settingsPage.locator('#browser-storage-section').isVisible(), true);
    fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
    await settingsPage.screenshot({ path: path.resolve(__dirname, '../test-results/browser-storage.png'), fullPage: true });
    const separatePath = await a.newPage(); await separatePath.goto(origin + '/other/');
    await separatePath.waitForURL('**/other/desktop.html');
    assert.equal((await ok(separatePath, '/api/qq/characters')).length, 0);
    // A missing service worker must fail closed rather than reaching private APIs.
    const bare = await browser.newContext({ serviceWorkers: 'block' });
    const blockedPage = await bare.newPage(); await blockedPage.goto(origin + '/phone/desktop.html');
    const blocked = await blockedPage.evaluate(() => fetch('/api/settings').then(() => false, () => true));
    assert.equal(blocked, true); await bare.close();
    assert.equal(privateRequests, 0, 'browser edition leaked a request to the private server');
    // Offline reload uses only the locally cached shell and IndexedDB.
    await a.setOffline(true); await pa.reload();
    assert.equal((await ok(pa, '/api/qq/characters'))[0].id, char.id);
    await a.setOffline(false);
});

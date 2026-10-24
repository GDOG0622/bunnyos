const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const { once } = require('events');
const { restorePortableBackup } = require('../modules/portable-backup');

function copyDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, item.name);
        const to = path.join(destination, item.name);
        if (item.isDirectory()) copyDirectory(from, to);
        else fs.copyFileSync(from, to);
    }
}

test('server access, path, chat concurrency and media regressions', { timeout: 20000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-server-security-'));
    const root = path.join(directory, 'code');
    const storage = path.join(directory, 'storage');
    fs.mkdirSync(root);
    const repo = path.resolve(__dirname, '..');
    fs.copyFileSync(path.join(repo, 'server.js'), path.join(root, 'server.js'));
    copyDirectory(path.join(repo, 'modules'), path.join(root, 'modules'));
    copyDirectory(path.join(repo, 'assets', 'scripts'), path.join(root, 'assets', 'scripts'));
    fs.mkdirSync(path.join(root, 'apps', 'QQ'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<html>BunnyOS</html>');
    fs.writeFileSync(path.join(root, 'apps', 'QQ', 'index.html'), '<html>QQ</html>');
    fs.writeFileSync(path.join(root, 'runner.cjs'), "const { bunnyosHttpServer: server } = require('./server'); server.on('listening', () => process.send({ port: server.address().port }));");
    const password = 'security-test-password-0123456789';
    const child = fork(path.join(root, 'runner.cjs'), [], {
        cwd: root,
        env: { ...process.env, PORT: '0', BUNNYOS_STORAGE_DIR: storage, BUNNYOS_PASSWORD: password, BUNNYOS_ORIGIN: '', BUNNYOS_UPDATE_TOKEN: '', NODE_PATH: path.join(repo, 'node_modules') },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    t.after(async () => {
        if (child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const [{ port }] = await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => { throw new Error(`server exited: ${output}`); })
    ]);
    const base = `http://127.0.0.1:${port}`;
    const authorization = `Basic ${Buffer.from(`bunnyos:${password}`).toString('base64')}`;
    const request = (url, method = 'GET', body, headers = {}) => fetch(base + url, {
        method,
        headers: { Authorization: authorization, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const readChat = async id => (await request(`/api/qq/chats/${id}`)).json();

    await t.test('anonymous access is challenged and authenticated static access cannot expose private files', async () => {
        for (const url of ['/', '/settings.json', '/api/settings', '/data/vapid.json', '/api/storage/backup/export', '/data/chats/qq/a.json']) {
            const response = await fetch(base + url);
            assert.equal(response.status, 401, url);
            assert.match(response.headers.get('www-authenticate'), /^Basic /);
            assert.equal(response.headers.get('access-control-allow-origin'), null);
        }
        for (const url of ['/settings.json', '/data/vapid.json', '/server.js', '/package.json', '/data/chats/qq/a.json', '/.git/config']) {
            assert.equal((await request(url)).status, 404, url);
        }
        assert.equal((await request('/')).status, 200);
        assert.equal((await request('/apps/QQ/index.html')).status, 200);
        assert.equal((await request('/api/settings')).status, 200);
        assert.equal((await request('/api/admin/update-from-github', 'POST', {})).status, 404);
        const wrong = await request('/api/settings', 'GET', undefined, { Authorization: 'Basic YTpi' });
        assert.equal(wrong.status, 401);
    });

    await t.test('foreign origins are rejected for reads, writes and preflights', async () => {
        for (const method of ['GET', 'POST', 'OPTIONS']) {
            const response = await request('/api/settings', method, method === 'POST' ? { key: 'bad' } : undefined, { Origin: 'https://evil.example' });
            assert.equal(response.status, 403);
            assert.equal(response.headers.get('access-control-allow-origin'), null);
        }
        assert.equal((await request('/api/settings', 'GET', undefined, { Origin: base })).status, 200);
        assert.equal((await request('/api/settings', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    });

    await t.test('uploaded SVGs stay sandboxed even through case and slash aliases', async () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
        const created = await request('/api/qq/characters', 'POST', { id: 'svg-test', avatarDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
        assert.equal(created.status, 200);
        for (const url of ['/data/assets/avatars/svg-test.svg', '/DATA/ASSETS/avatars/svg-test.svg', '/data/assets//avatars/svg-test.svg']) {
            const response = await request(url);
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-security-policy'), /^sandbox;/);
            assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        }
    });

    await t.test('all path ID entry points reject traversal and Windows filenames before any write', async () => {
        for (const id of ['../escape', '..\\escape', '..', 'C:\\escape', 'NUL', 'CON.txt', 'trailing.', '__proto__', ['bad']]) {
            assert.equal((await request('/api/qq/characters', 'POST', { id, name: 'bad' })).status, 400, JSON.stringify(id));
            if (typeof id !== 'string' || id === '..') continue;
            for (const [route, method] of [[`/api/qq/chats/${encodeURIComponent(id)}`, 'POST'], [`/api/qq/char-beauty/${encodeURIComponent(id)}/background`, 'POST'], [`/api/qq/summary-settings/${encodeURIComponent(id)}`, 'PUT']]) {
                assert.equal((await request(route, method, { version: null })).status, 400, route);
            }
        }
        assert.equal(fs.existsSync(path.join(root, 'data', 'escape.json')), false);
        const good = await request('/api/qq/characters', 'POST', { id: '角色-1', name: 'valid' });
        assert.equal(good.status, 200);
        assert.equal((await request('/api/qq/characters/' + encodeURIComponent('角色-1'), 'PUT', { name: 'updated' })).status, 200);
    });

    await t.test('two devices cannot replace each other, and missing versions cannot bypass the check', async () => {
        const a = await readChat('race');
        const b = await readChat('race');
        assert.equal(a.version, null);
        const saved = await (await request('/api/qq/chats/race', 'POST', { version: a.version, messages: [{ text: 'from A' }] })).json();
        assert.match(saved.version, /^[a-f0-9]{64}$/);
        const stale = await request('/api/qq/chats/race', 'POST', { version: b.version, messages: [{ text: 'from B' }] });
        assert.equal(stale.status, 409);
        assert.equal((await stale.json()).error_code, 'CHAT_VERSION_CONFLICT');
        assert.equal((await request('/api/qq/chats/race', 'POST', { messages: [] })).status, 409);
        assert.equal((await request('/api/qq/chats/race/messages', 'DELETE', { version: b.version })).status, 409);
        assert.equal((await readChat('race')).messages[0].text, 'from A');
        const hidden = await (await request('/api/qq/chats/race/hidden', 'PATCH', { version: saved.version, hidden: true })).json();
        assert.notEqual(hidden.version, saved.version);
        assert.equal((await request('/api/qq/chats/race', 'POST', { version: saved.version, messages: [] })).status, 409);
        assert.equal((await request('/api/qq/chats/race', 'POST', { version: hidden.version, messages: [{ text: 'A then B' }] })).status, 200);
    });

    await t.test('paid messages and transfer settlement preserve versions and never charge an idempotent retry twice', async () => {
        const balanceBefore = (await (await request('/api/wallet')).json()).balance;
        const seeded = await (await request('/api/qq/chats/payments', 'POST', { version: null, messages: [{ role: 'user', text: 'hello' }] })).json();
        const body = { version: null, requestId: 'paid-one', cost: 5, message: { role: 'user', type: 'service', price: '5', text: 'gift' } };
        assert.equal((await request('/api/qq/chats/payments/paid-message', 'POST', body)).status, 409);
        assert.equal((await (await request('/api/wallet')).json()).balance, balanceBefore);
        body.version = seeded.version;
        const paidResponse = await request('/api/qq/chats/payments/paid-message', 'POST', body);
        assert.equal(paidResponse.status, 200);
        const paid = await paidResponse.json();
        assert.equal(paid.balance, balanceBefore - 5);
        const retry = await (await request('/api/qq/chats/payments/paid-message', 'POST', body)).json();
        assert.equal(retry.idempotent, true);
        assert.equal(retry.balance, paid.balance);
        assert.equal(retry.chat.messages.length, 2);
        assert.equal((await request('/api/qq/chats/payments', 'POST', { version: seeded.version, messages: seeded.messages })).status, 409);
        const withTransfer = await (await request('/api/qq/chats/payments', 'POST', {
            version: paid.chat.version, messages: [...paid.chat.messages, { role: 'assistant', type: 'transfer', amount: '7', status: 'pending' }]
        })).json();
        assert.equal((await request('/api/qq/chats/payments/transfer/2/receive', 'POST', { version: paid.chat.version })).status, 409);
        const claimResponse = await request('/api/qq/chats/payments/transfer/2/receive', 'POST', { version: withTransfer.version });
        assert.equal(claimResponse.status, 200);
        const claimed = await claimResponse.json();
        assert.equal(claimed.balance, balanceBefore + 2);
        assert.equal((await request('/api/qq/chats/payments/transfer/2/receive', 'POST', { version: claimed.version })).status, 409);
        assert.equal((await readChat('payments')).messages[2].status, 'received');
    });

    await t.test('image originals are protected server assets and survive a portable backup restore', async () => {
        const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
        const response = await request('/api/qq/chats/pictures', 'POST', { version: null, messages: [{ type: 'image', image, client_image_id: 'img_1' }] });
        assert.equal(response.status, 200);
        const chat = await response.json();
        const message = chat.messages[0];
        assert.equal(message.image, undefined);
        assert.match(message.image_url, /^\/data\/assets\/chat-images\/[a-f0-9]{64}\.png$/);
        assert.equal((await fetch(base + message.image_url)).status, 401);
        const asset = await request(message.image_url);
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('content-security-policy'), /sandbox/);
        const bytes = Buffer.from(await asset.arrayBuffer());
        assert.deepEqual(bytes, Buffer.from(image.split(',')[1], 'base64'));
        for (const url of [message.image_url.replace('/data/assets/', '/DATA/ASSETS/'), message.image_url.replace('/chat-images/', '//chat-images/')]) {
            const alternative = await request(url);
            assert.equal(alternative.status, 200);
            assert.match(alternative.headers.get('content-security-policy'), /sandbox/);
        }
        const backupResponse = await request('/api/storage/backup/export');
        assert.equal(backupResponse.status, 200);
        const backup = await backupResponse.json();
        assert.ok(backup.files[message.image_url.slice(1)]);
        const restored = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-images-restored-'));
        try {
            restorePortableBackup(restored, backup);
            assert.deepEqual(fs.readFileSync(path.join(restored, message.image_url.slice(1))), bytes);
        } finally {
            assert.ok(path.resolve(restored).startsWith(path.resolve(os.tmpdir()) + path.sep));
            fs.rmSync(restored, { recursive: true, force: true });
        }
        assert.equal((await request('/api/qq/chats/pictures', 'POST', { version: chat.version, messages: [{ type: 'image', image_url: '/settings.json' }] })).status, 400);
        assert.deepEqual((await readChat('pictures')).messages, chat.messages);
    });

    await t.test('backup export reports missing legacy originals instead of silently exporting placeholders', async () => {
        const legacy = await request('/api/qq/chats/legacy-picture', 'POST', { version: null, messages: [{ type: 'image', client_image_id: 'only-on-old-device' }] });
        assert.equal(legacy.status, 200);
        const backup = await request('/api/storage/backup/export');
        assert.equal(backup.status, 409);
        assert.match((await backup.json()).error, /原图未上传/);
    });

    await t.test('an asynchronous summary cannot overwrite a chat saved while its upstream request is pending', async () => {
        let reply;
        let called;
        const upstreamCalled = new Promise(resolve => { called = resolve; });
        const upstream = http.createServer((req, res) => {
            reply = () => {
                if (res.writableEnded) return;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ choices: [{ message: { content: 'summary' } }] }));
            };
            req.resume();
            called();
        });
        upstream.listen(0, '127.0.0.1');
        await once(upstream, 'listening');
        try {
            const currentSettings = await (await request('/api/settings')).json();
            await request('/api/settings', 'PATCH', { version: currentSettings._version, changes: { subApi_url: `http://127.0.0.1:${upstream.address().port}`, subApi_key: 'test', subApi_model: 'test' } });
            await request('/api/qq/characters', 'POST', { id: 'summary-race', name: 'test' });
            const seeded = await (await request('/api/qq/chats/summary-race', 'POST', { version: null, messages: [{ role: 'user', text: 'one' }, { role: 'assistant', text: 'two' }] })).json();
            const settings = await (await request('/api/qq/summary-settings/summary-race', 'PUT', { version: seeded.version, layerThreshold: 1 })).json();
            const summarizing = request('/api/qq/summarize', 'POST', { characterId: 'summary-race', version: settings.version });
            await upstreamCalled;
            const newer = await request('/api/qq/chats/summary-race', 'POST', { version: settings.version, messages: [...seeded.messages, { role: 'user', text: 'keep this' }] });
            assert.equal(newer.status, 200);
            reply();
            assert.equal((await summarizing).status, 409);
            const chat = await readChat('summary-race');
            assert.equal(chat.messages.length, 3);
            assert.equal(chat.messages[2].text, 'keep this');
            assert.equal(chat.messages.some(message => message.summary_archived), false);
        } finally {
            if (reply) reply();
            upstream.closeAllConnections();
            await new Promise(resolve => upstream.close(resolve));
        }
    });
});

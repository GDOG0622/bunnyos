'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { testServer } = require('./helpers/server');

async function fixture(t) {
    const server = await testServer(t);
    const runnerFile = path.join(server.code, 'runner.cjs');
    const provider = `
        require('web-push').sendNotification = async subscription => {
            fs.appendFileSync(path.join(process.env.BUNNYOS_STORAGE_DIR, 'push-started'), 'started\\n');
            await new Promise(resolve => {
                const timer = setInterval(() => {
                    if (fs.existsSync(path.join(process.env.BUNNYOS_STORAGE_DIR, 'push-release'))) {
                        clearInterval(timer); resolve();
                    }
                }, 5);
            });
            const status = subscription.endpoint.endsWith('/dead') ? 410
                : subscription.endpoint.endsWith('/missing') ? 404
                : subscription.endpoint.endsWith('/transient') ? 503 : 201;
            if (status !== 201) throw Object.assign(new Error('controlled push response'), { statusCode: status });
            return { statusCode: status };
        };
    `;
    const runner = fs.readFileSync(runnerFile, 'utf8');
    const importServer = "const { bunnyosHttpServer } = require('./server');";
    assert.ok(runner.includes(importServer));
    fs.writeFileSync(runnerFile, runner.replace(importServer, provider + '\n' + importServer));
    await server.restart();
    const file = path.join(server.storage, 'data/push-subscriptions.json');
    return {
        ...server,
        subscribe: subscription => server.json('/api/notify/subscribe', 'POST', { subscription }),
        read: () => JSON.parse(fs.readFileSync(file, 'utf8')),
        broadcast: () => server.json('/api/notify/test', 'POST', {}),
        started: async count => {
            const startedFile = path.join(server.storage, 'push-started');
            const deadline = Date.now() + 5000;
            const sent = () => fs.existsSync(startedFile) ? fs.readFileSync(startedFile, 'utf8').trim().split('\n').length : 0;
            while (sent() < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
            assert.equal(sent(), count, 'provider barrier not reached');
        },
        release: () => fs.writeFileSync(path.join(server.storage, 'push-release'), 'release'),
    };
}

test('two overlapping broadcasts preserve acknowledged additions and removals during cleanup', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    const dead = { endpoint: 'https://push.example.test/dead' };
    const existing = { endpoint: 'https://push.example.test/existing' };
    const added = { endpoint: 'https://push.example.test/new' };
    await server.subscribe(dead);
    await server.subscribe(existing);
    const first = server.broadcast();
    const second = server.broadcast();
    await server.started(4);
    await server.subscribe(added);
    await server.json('/api/notify/unsubscribe', 'POST', { endpoint: existing.endpoint });
    assert.deepEqual(server.read().map(sub => sub.endpoint).sort(), [dead.endpoint, added.endpoint].sort());
    server.release();
    const results = await Promise.all([first, second]);
    assert.equal(results.reduce((total, result) => total + result.removed, 0), 1);
    assert.deepEqual(server.read(), [added]);
    await server.restart();
    assert.deepEqual(server.read(), [added]);
});

test('an expired response for old credentials cannot delete a renewed endpoint', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    const old = { endpoint: 'https://push.example.test/dead', keys: { auth: 'old', p256dh: 'old-key' } };
    const renewed = { ...old, keys: { auth: 'renewed', p256dh: 'renewed-key' } };
    await server.subscribe(old);
    const broadcast = server.broadcast();
    await server.started(1);
    await server.subscribe(renewed);
    assert.deepEqual(server.read(), [renewed]);
    server.release();
    assert.equal((await broadcast).removed, 0);
    assert.deepEqual(server.read(), [renewed]);
});

test('only 404 and 410 prune subscriptions; transient errors and concurrent new subscriptions survive', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    const transient = { endpoint: 'https://push.example.test/transient' };
    const missing = { endpoint: 'https://push.example.test/missing' };
    const healthy = { endpoint: 'https://push.example.test/healthy' };
    const added = { endpoint: 'https://push.example.test/new' };
    for (const sub of [transient, missing, healthy]) await server.subscribe(sub);
    const broadcast = server.broadcast();
    await server.started(3);
    await server.subscribe(added);
    server.release();
    assert.deepEqual(await broadcast, { success: true, sent: 1, removed: 1 });
    assert.deepEqual(server.read(), [transient, healthy, added]);
    const noExpired = await server.broadcast();
    assert.deepEqual(noExpired, { success: true, sent: 2, removed: 0 });
    assert.deepEqual(server.read(), [transient, healthy, added]);
});

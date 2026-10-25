const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { installAccessControl } = require('../modules/access-control');
const { createPortableBackup } = require('../modules/portable-backup');

test('default startup generates a persistent private password and excludes it from backups', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-access-'));
    t.after(() => {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    });
    installAccessControl(express(), { rootDir: root, env: {} });
    const file = path.join(root, 'data/access.json');
    const password = JSON.parse(fs.readFileSync(file, 'utf8')).password;
    assert.ok(password.length >= 32);
    installAccessControl(express(), { rootDir: root, env: {} });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).password, password);
    assert.equal(createPortableBackup(root).files['data/access.json'], undefined);
    assert.throws(() => installAccessControl(express(), { rootDir: root, env: { BUNNYOS_PASSWORD: 'short' } }), /至少需要 8/);
});

test('an explicit HTTPS origin supports reverse proxies without trusting forwarded headers', () => {
    let middleware;
    const env = { BUNNYOS_PASSWORD: 'reverse-proxy-test-password', BUNNYOS_ORIGIN: 'https://bunny.example' };
    installAccessControl({ use(handler) { middleware = handler; } }, { rootDir: __dirname, env });
    const authorization = `Basic ${Buffer.from(`bunnyos:${env.BUNNYOS_PASSWORD}`).toString('base64')}`;
    for (const [origin, allowed] of [['https://bunny.example', true], ['http://bunny.example', false], ['https://evil.example', false]]) {
        let passed = false;
        let status;
        middleware({ path: '/api/settings', protocol: 'http', get: name => ({ origin, host: 'localhost:3000', authorization })[name] }, {
            setHeader() {}, status(value) { status = value; return this; }, json() {}
        }, () => { passed = true; });
        assert.equal(passed, allowed);
        if (!allowed) assert.equal(status, 403);
    }
    assert.throws(() => installAccessControl({ use() {} }, { rootDir: __dirname, env: { ...env, BUNNYOS_ORIGIN: 'file:///tmp' } }), /必须使用 http/);
});

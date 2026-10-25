const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('GitHub image backups without inline content use the authenticated raw API', async () => {
    const calls = [], backup = { format: 'bunnyos-portable-backup', version: 1, files: { 'settings.json': 'e30=' } };
    const context = vm.createContext({ window: {}, TextEncoder, TextDecoder, atob, btoa,
        fetch: async (url, options) => {
            calls.push({ url, options });
            return new Response(JSON.stringify(calls.length === 1 ? { encoding: 'none', size: 2000000 } : backup), { status: 200 });
        } });
    for (const name of ['base.js', 'github.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../apps/settings/storage-providers', name), 'utf8'), context);
    const provider = new context.window.GitHubStorage({ token: 'private-test-token', owner: 'visitor', repo: 'private-backup' });
    assert.deepEqual(JSON.parse(JSON.stringify(await provider.downloadBackup())), backup);
    assert.equal(calls[1].options.headers.Accept, 'application/vnd.github.raw+json');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer private-test-token');
    assert.match(calls[1].url, /^https:\/\/api.github.com\/repos\/visitor\/private-backup\/contents\//);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { once } = require('events');
const { testServer } = require('./helpers/server');
const { createToolAssistant, validateServer, reminderTime } = require('../modules/tool-assistant');
const { nextAnniversary, dateOnly } = require('../modules/suki');

async function httpFixture(t, handler) {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    return `http://127.0.0.1:${server.address().port}`;
}

test('reminders persist before delivery, catch up after downtime and never fire twice', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-reminders-'));
    let time = Date.now(); const notifications = [];
    const feature = createToolAssistant({ app: { get() {}, post() {}, patch() {}, put() {}, delete() {} }, dataDir: directory,
        now: () => time, notify: async payload => {
            assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'reminders.json')))[0].status, 'fired');
            notifications.push(payload);
        } });
    t.after(async () => { await feature.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
    feature.createReminder({ title: 'drink water', at: new Date(time + 60000).toISOString() }, { callId: 'one' });
    feature.createReminder({ title: 'drink water', at: new Date(time + 60000).toISOString() }, { callId: 'one' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'reminders.json'))).length, 1);
    time += 120000; await feature.tick(); await feature.tick();
    assert.equal(notifications.length, 1);
    assert.throws(() => reminderTime('2030-01-01T12:00'), /时区/);
    assert.throws(() => reminderTime('2000-01-01T12:00:00Z'), /未来/);
    assert.throws(() => reminderTime('2027-02-30T12:00:00Z'), /日期/);
    fs.mkdirSync(path.join(directory, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'tools/actions.json'), JSON.stringify([{ id: 'interrupted', status: 'running' }]));
    const recovered = createToolAssistant({ app: { get() {}, post() {}, patch() {}, put() {}, delete() {} }, dataDir: directory, notify: async () => {} });
    try { assert.equal((await recovered.decide('interrupted', true)).status, 'unknown'); }
    finally { await recovered.close(); }
});

test('MCP configuration validates transports and calendar dates handle leap years', () => {
    assert.throws(() => validateServer(null), /对象/);
    assert.throws(() => validateServer({ name: 'x', transport: 'http', url: 'file:///etc/passwd' }), /HTTP/);
    assert.throws(() => validateServer({ name: 'x', transport: 'http', url: 'http://example.com/mcp' }), /HTTPS/);
    assert.throws(() => validateServer({ name: 'x', transport: 'stdio', command: 'node', args: 'bad' }), /数组/);
    assert.throws(() => dateOnly('2026-02-30'), /日期/);
    assert.deepEqual(nextAnniversary('2024-02-29', true, '2026-02-27'), { date: '2026-02-28', days: 1 });
    assert.deepEqual(nextAnniversary('2024-02-29', true, '2027-03-01'), { date: '2028-02-29', days: 365 });
});

test('chat runs real MCP calls, persists approval, and cannot submit an order twice', { timeout: 30000 }, async t => {
    const server = await testServer(t);
    const { json, request, storage } = server;
    const mcpCalls = [];
    const mcp = await httpFixture(t, async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return; }
        assert.equal(req.headers.authorization, 'Bearer test-mcp-secret');
        let raw = ''; for await (const chunk of req) raw += chunk;
        const rpc = JSON.parse(raw);
        if (rpc.id === undefined) { res.writeHead(202).end(); return; }
        let result;
        if (rpc.method === 'initialize') result = { protocolVersion: '2025-11-25', serverInfo: { name: 'test-mcp', version: '1.0.0' }, capabilities: { tools: {} } };
        else if (rpc.method === 'tools/list') result = { tools: [{ name: 'place_order', description: 'Place a food order', inputSchema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'], additionalProperties: false } },
            { name: 'search', description: 'Read-only search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } }] };
        else if (rpc.method === 'tools/call') {
            mcpCalls.push(rpc.params);
            result = { content: [{ type: 'text', text: rpc.params.name === 'search' ? 'Found reliable sources' : 'Order accepted #123' }] };
            // Both JSON and SSE responses are legal Streamable HTTP responses.
            res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n\n`); return;
        } else { res.writeHead(400).end(); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    });
    let mode = 'reminder'; const modelCalls = [];
    const model = await httpFixture(t, async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw); modelCalls.push(body);
        const toolResult = body.messages.findLast(message => message.role === 'tool');
        let message;
        if (toolResult) message = { content: `真实工具结果：${toolResult.content}` };
        else {
            const name = mode === 'reminder' ? 'bunny_create_reminder' : body.tools.find(tool => tool.function.description.includes(mode === 'search' ? 'Read-only search' : 'Place a food order')).function.name;
            const args = mode === 'reminder' ? { title: '测试喝水提醒', at: new Date(Date.now() + 3600000).toISOString() } : mode === 'search' ? { query: 'weather' } : { item: 'noodles' };
            message = { content: null, tool_calls: [{ id: `call-${modelCalls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
        }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
    });
    let config = await json('/api/tools');
    config = await json('/api/tools', 'PATCH', { version: config._version, enabled: true, tavilyKey: 'secret-tavily-key' });
    assert.equal(config.hasTavilyKey, true); assert.equal(config.tavilyKey, undefined);
    assert.equal((await request('/api/tools', 'PATCH', { version: 'old', enabled: false })).status, 409);
    config = await json('/api/tools/servers', 'POST', { version: config._version, server: { name: 'Food and search', transport: 'http', url: mcp, headers: { Authorization: 'Bearer test-mcp-secret' }, enabled: true, autoApproveReadOnly: true } });
    assert.equal(config.servers[0].headers, undefined);
    const tools = await json(`/api/tools/servers/${config.servers[0].id}/test`, 'POST', {});
    assert.equal(tools.tools.length, 2);
    const settings = await json('/api/settings');
    await json('/api/settings', 'PATCH', { version: settings._version, changes: { mainApi_url: model, mainApi_key: 'test', mainApi_model: 'gpt-4o', mainApi_context: 16000 } });
    await json('/api/qq/characters', 'POST', { id: 'tools', name: 'Partner' });
    let chat = await json('/api/qq/chats/tools', 'POST', { version: null, messages: [{ role: 'user', type: 'text', text: 'remind me' }] });
    const reply = async () => { const result = await json('/api/qq/reply', 'POST', { characterId: 'tools', version: chat.version }); chat = result.chat; return result; };
    const first = await reply();
    assert.equal((await json('/api/reminders')).length, 1);
    assert.equal(chat.messages.at(-1).toolActions[0].status, 'completed');
    assert.ok(first.context_itemization.toolSchemaTokens > 0);
    assert.ok((await json('/api/qq/prompt-preview', 'POST', { characterId: 'tools' })).itemization.toolSchemaTokens > 0);
    assert.ok(modelCalls.at(-1).messages.some(message => message.role === 'tool'));
    mode = 'search'; await reply();
    assert.equal(mcpCalls.filter(call => call.name === 'search').length, 1);
    mode = 'order'; await reply();
    assert.equal(mcpCalls.filter(call => call.name === 'place_order').length, 0);
    let pending = (await json('/api/tools/actions')).find(item => item.status === 'pending');
    assert.ok(pending);
    const decisions = await Promise.all([json(`/api/tools/actions/${pending.id}/decide`, 'POST', { approve: true }), json(`/api/tools/actions/${pending.id}/decide`, 'POST', { approve: true })]);
    assert.ok(decisions.some(item => item.status === 'completed'));
    assert.equal(mcpCalls.filter(call => call.name === 'place_order').length, 1);
    await json(`/api/tools/actions/${pending.id}/decide`, 'POST', { approve: true });
    assert.equal(mcpCalls.filter(call => call.name === 'place_order').length, 1);
    await reply(); pending = (await json('/api/tools/actions')).find(item => item.status === 'pending');
    await json(`/api/tools/actions/${pending.id}/decide`, 'POST', { approve: false });
    assert.equal(mcpCalls.filter(call => call.name === 'place_order').length, 1);
    await reply(); pending = (await json('/api/tools/actions')).find(item => item.status === 'pending');
    const stored = JSON.parse(fs.readFileSync(path.join(storage, 'data/tools/actions.json')));
    stored.find(item => item.id === pending.id).expiresAt = Date.now() - 1;
    fs.writeFileSync(path.join(storage, 'data/tools/actions.json'), JSON.stringify(stored));
    assert.equal((await json(`/api/tools/actions/${pending.id}/decide`, 'POST', { approve: true })).status, 'expired');
    assert.equal(mcpCalls.filter(call => call.name === 'place_order').length, 1);
    await server.restart();
    assert.equal((await json(`/api/tools/actions/${decisions[0].id}/decide`, 'POST', { approve: true })).status, 'completed');
    assert.equal(mcpCalls.filter(call => call.name === 'place_order').length, 1);
    const backup = await json('/api/storage/backup/export');
    assert.ok(backup.files['data/reminders.json']);
    assert.equal(Object.keys(backup.files).some(file => file.startsWith('data/tools/')), false);
    await json('/api/storage/backup/restore', 'POST', backup);
    assert.equal((await json('/api/tools')).servers[0].id, config.servers[0].id);
    assert.equal((await json(`/api/tools/actions/${decisions[0].id}/decide`, 'POST', { approve: true })).status, 'completed');
});

test('legacy SSE MCP preserves authentication on both the event stream and message endpoint', { timeout: 15000 }, async t => {
    const { json } = await testServer(t);
    let stream;
    const url = await httpFixture(t, async (req, res) => {
        assert.equal(req.headers.authorization, 'Bearer legacy-secret');
        if (req.method === 'GET' && req.url === '/sse') {
            stream = res;
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            res.write('event: endpoint\ndata: /messages\n\n'); return;
        }
        let raw = ''; for await (const chunk of req) raw += chunk;
        const rpc = JSON.parse(raw); res.writeHead(202).end();
        if (rpc.id === undefined) return;
        const result = rpc.method === 'initialize'
            ? { protocolVersion: '2025-11-25', serverInfo: { name: 'legacy', version: '1' }, capabilities: { tools: {} } }
            : { tools: [{ name: 'legacy_search', inputSchema: { type: 'object' } }] };
        stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n\n`);
    });
    let config = await json('/api/tools');
    config = await json('/api/tools/servers', 'POST', { version: config._version, server: { name: 'legacy', transport: 'sse', url: url + '/sse', headers: { Authorization: 'Bearer legacy-secret' }, enabled: true } });
    assert.equal((await json(`/api/tools/servers/${config.servers[0].id}/test`, 'POST', {})).tools[0].name, 'legacy_search');
});

test('stdio MCP uses the official client without inheriting BunnyOS secrets', { timeout: 15000 }, async t => {
    const { json, code } = await testServer(t);
    const fixture = path.join(code, 'test-mcp.cjs');
    fs.writeFileSync(fixture, `const readline = require('readline');
        readline.createInterface({ input: process.stdin }).on('line', line => {
            const req = JSON.parse(line); if (req.id === undefined) return;
            const result = req.method === 'initialize'
                ? { protocolVersion: '2025-11-25', serverInfo: { name: 'stdio-test', version: '1' }, capabilities: { tools: {} } }
                : { tools: [{ name: process.env.BUNNYOS_PASSWORD ? 'LEAKED' : 'safe', inputSchema: { type: 'object' } }] };
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');
        });`);
    let config = await json('/api/tools');
    config = await json('/api/tools/servers', 'POST', { version: config._version, server: { name: 'stdio test', transport: 'stdio', command: process.execPath, args: [fixture], env: {}, enabled: false } });
    assert.equal((await json(`/api/tools/servers/${config.servers[0].id}/test`, 'POST', {})).tools[0].name, 'safe');
});

test('Suki isolates characters, protects concurrent changes, and connects records to real AI replies and backups', { timeout: 20000 }, async t => {
    const server = await testServer(t);
    const { json, request } = server;
    for (const id of ['alice', 'bob']) await json('/api/qq/characters', 'POST', { id, name: id });
    let data = await json('/api/suki/alice');
    assert.equal(data.space, null);
    data = await json('/api/suki/alice', 'PATCH', { version: data._version, title: 'Our home', userName: 'Me', timeZone: 'Asia/Shanghai', startDate: '2024-01-01' });
    assert.ok(data.daysTogether > 1);
    const stale = data._version;
    data = await json('/api/suki/alice/mood', 'POST', { version: data._version, mood: '开心' });
    assert.equal((await request('/api/suki/alice/wishes', 'POST', { version: stale, text: 'must not overwrite' })).status, 409);
    assert.equal((await json('/api/suki/bob')).space, null);
    data = await json('/api/suki/alice/wishes', 'POST', { version: data._version, text: 'watch sunset' });
    data = await json(`/api/suki/alice/wishes/${data.space.wishes[0].id}`, 'PATCH', { version: data._version, done: true });
    assert.equal(data.space.wishes[0].done, true);
    data = await json('/api/suki/alice/pet', 'POST', { version: data._version });
    data = await json('/api/suki/alice/pet', 'POST', { version: data._version });
    assert.equal(data.space.pet.careDates.length, 1);
    const image = await json('/api/suki/image', 'POST', { dataUrl: 'data:image/png;base64,YQ==' });
    data = await json('/api/suki/alice/entries', 'POST', { version: data._version, text: 'We had noodles today', image: image.url });
    data = await json('/api/suki/alice/answer', 'POST', { version: data._version, text: 'I would like to see the sea' });
    const entryId = data.space.entries[0].id;
    let modelBody, hold = false, release, started;
    const model = await httpFixture(t, async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        modelBody = JSON.parse(raw);
        if (started) { const signal = started; started = null; signal(); }
        if (hold) await new Promise(resolve => { release = resolve; });
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'I would love to go with you.' } }] }));
    });
    const settings = await json('/api/settings');
    await json('/api/settings', 'PATCH', { version: settings._version, changes: { mainApi_url: model, mainApi_key: 'test', mainApi_model: 'gpt-4o' } });
    data = await json('/api/suki/alice/generate', 'POST', { version: data._version, kind: 'answer' });
    assert.equal(data.space.answers[data.today].partner, 'I would love to go with you.');
    assert.ok(JSON.stringify(modelBody.messages).includes('I would like to see the sea'));
    assert.equal((await request('/api/suki/alice/generate', 'POST', { version: data._version, kind: 'answer' })).status, 409);
    hold = true;
    const pending = new Promise(resolve => { started = resolve; });
    const generating = request('/api/suki/alice/generate', 'POST', { version: data._version, kind: 'entry', entryId });
    await pending;
    data = await json('/api/suki/alice/mood', 'POST', { version: data._version, mood: '想你' });
    release();
    assert.equal((await generating).status, 409);
    assert.equal((await json('/api/suki/alice')).space.entries[0].partner, undefined);
    hold = false;
    data = await json('/api/suki/alice/generate', 'POST', { version: data._version, kind: 'entry', entryId });
    assert.equal(data.space.entries[0].partner, 'I would love to go with you.');
    const preview = await json('/api/qq/prompt-preview', 'POST', { characterId: 'alice' });
    assert.ok(JSON.stringify(preview).includes('We had noodles today'));
    const backup = await json('/api/storage/backup/export');
    assert.ok(backup.files['data/suki/alice.json']);
    assert.ok(backup.files[image.url.slice(1)]);
    await server.restart();
    assert.equal((await json('/api/suki/alice')).space.entries[0].id, entryId);
});

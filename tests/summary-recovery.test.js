'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { once } = require('events');
const { testServer } = require('./helpers/server');

async function fixture(t) {
    const server = await testServer(t);
    const responses = [];
    let calls = 0;
    let hold = false;
    const api = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            calls++;
            const reply = () => res.end(JSON.stringify({ choices: [{ message: { content: `Memory ${calls}` } }] }));
            if (hold) responses.push(reply);
            else reply();
        });
    });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    t.after(() => new Promise(resolve => { api.closeAllConnections(); api.close(resolve); }));
    const initial = await server.json('/api/settings');
    await server.json('/api/settings', 'PATCH', { version: initial._version, changes: {
        subApi_url: `http://127.0.0.1:${api.address().port}/v1`, subApi_key: 'local', subApi_model: 'local',
        mainApi_url: `http://127.0.0.1:${api.address().port}/v1`, mainApi_key: 'local', mainApi_model: 'gpt-4o', mainApi_antiCutoffEnabled: false
    } });
    const { book } = await server.json('/api/worldbooks/books', 'POST', { name: 'Memories' });
    await server.json('/api/qq/characters', 'POST', { id: 'summary', name: 'Summary', memory: { summaryWorldbookId: book.id } });
    const seeded = await server.json('/api/qq/chats/summary', 'POST', { version: null, messages: [
        { id: 'u1', role: 'user', type: 'text', text: 'one', created_at: 1700000000000 },
        { id: 'a1', role: 'assistant', type: 'text', text: 'two', created_at: 1700000000001 },
        { id: 'u2', role: 'user', type: 'text', text: 'three', created_at: 1700000000002 },
    ] });
    await server.json('/api/qq/summary-settings/summary', 'PUT', { version: seeded.version, layerThreshold: 1, summaryWorldbookId: book.id });
    const chat = await server.json('/api/qq/chats/summary');
    const directory = path.join(server.storage, 'data/worldbooks');
    const bookPath = path.join('data/worldbooks', fs.readdirSync(directory).find(name => name.endsWith('.json')));
    const readBook = () => JSON.parse(fs.readFileSync(path.join(server.storage, bookPath), 'utf8'));
    const readChat = () => JSON.parse(fs.readFileSync(path.join(server.storage, 'data/chats/qq/summary.json'), 'utf8'));
    return { ...server, chat, bookPath, readBook, readChat, calls: () => calls, responses, hold: () => { hold = true; } };
}

test('archive failure retries the committed summary without another upstream request', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    await server.fault('data/chats/qq/summary.json');
    const body = { characterId: 'summary', version: server.chat.version };
    assert.equal((await server.request('/api/qq/summarize', 'POST', body)).status, 500);
    const partial = server.readBook().entries[0];
    assert.equal(partial.summaryArchivePending, true);
    assert.equal(server.readChat().messages[0].summary_archived, undefined);
    const retried = await server.json('/api/qq/summarize', 'POST', body);
    assert.equal(retried.triggered, true);
    assert.equal(retried.entry.id, partial.id);
    assert.deepEqual(retried.archivedMessageIndexes, [0]);
    assert.equal(server.calls(), 1);
    assert.equal(server.readBook().entries.length, 1);
    assert.equal(server.readBook().entries[0].summaryArchivePending, undefined);
    assert.equal(server.readChat().messages[0].summary_archived, true);
    assert.equal((await server.json('/api/qq/summarize', 'POST', body)).entry.id, partial.id);
    assert.equal(server.calls(), 1);
});

test('a crash after card publication recovers before later edits and permits a different batch', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    await server.fault('data/chats/qq/summary.json', true);
    const body = { characterId: 'summary', version: server.chat.version };
    await assert.rejects(server.request('/api/qq/summarize', 'POST', body));
    assert.equal(server.readBook().entries.length, 1);
    assert.equal(server.readChat().messages[0].summary_archived, undefined);
    await server.restart();
    assert.equal(server.readChat().messages[0].summary_archived, true);
    assert.equal(server.readBook().entries[0].summaryArchivePending, undefined);
    const retry = await server.json('/api/qq/summarize', 'POST', body);
    assert.equal(server.calls(), 1);
    assert.equal((await server.request('/api/qq/chats/summary', 'POST', {
        version: server.chat.version, messages: server.chat.messages
    })).status, 409);
    const latest = await server.json('/api/qq/chats/summary');
    const saved = await server.json('/api/qq/chats/summary', 'POST', {
        version: latest.version, messages: [...latest.messages, { id: 'a2', role: 'assistant', type: 'text', text: 'new edit' }]
    });
    const next = await server.json('/api/qq/summarize', 'POST', { characterId: 'summary', version: saved.version });
    assert.notEqual(next.entry.id, retry.entry.id);
    assert.equal(server.readBook().entries.length, 2);
    assert.equal(server.calls(), 2);
    assert.equal(server.readChat().messages.at(-1).text, 'new edit');
});

for (const crash of [false, true]) {
    test(`marker cleanup ${crash ? 'crash' : 'failure'} does not rewrite the archived chat on recovery`, { timeout: 15000 }, async t => {
        const server = await fixture(t);
        await server.fault(server.bookPath, crash, { skip: 1 });
        const request = server.request('/api/qq/summarize', 'POST', { characterId: 'summary', version: server.chat.version });
        if (crash) await assert.rejects(request);
        else assert.equal((await request).status, 500);
        const chatFile = path.join(server.storage, 'data/chats/qq/summary.json');
        const committedBytes = fs.readFileSync(chatFile);
        assert.equal(server.readChat().messages[0].summary_archived, true);
        assert.equal(server.readBook().entries[0].summaryArchivePending, true);
        if (crash) await server.restart();
        const recovered = await server.json('/api/qq/chats/summary');
        assert.deepEqual(fs.readFileSync(chatFile), committedBytes);
        assert.equal(server.readBook().entries[0].summaryArchivePending, undefined);
        const edited = await server.json('/api/qq/chats/summary', 'POST', {
            version: recovered.version, messages: [...recovered.messages, { role: 'user', text: 'keep later edit' }]
        });
        await server.restart();
        assert.equal((await server.json('/api/qq/chats/summary')).version, edited.version);
        assert.equal(server.readChat().messages.at(-1).text, 'keep later edit');
        assert.equal(server.readBook().entries.length, 1);
    });
}

test('a worldbook edit cannot remove pending recovery, and stale chat edits are rejected after replay', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    const { books: [oldBook] } = await server.json('/api/worldbooks');
    await server.fault('data/chats/qq/summary.json');
    assert.equal((await server.request('/api/qq/summarize', 'POST', { characterId: 'summary', version: server.chat.version })).status, 500);
    assert.equal((await server.request(`/api/worldbooks/books/${oldBook.id}`, 'PATCH', {
        version: oldBook._version, changes: { entries: [] }
    })).status, 409);
    assert.equal(server.readBook().entries.length, 1);
    assert.equal(server.readChat().messages[0].summary_archived, true);
    assert.equal((await server.request('/api/qq/summary-settings/summary', 'PUT', {
        version: server.chat.version, layerThreshold: 2, summaryWorldbookId: ''
    })).status, 409);
});

test('overlapping summaries recover a partial commit before validating the other continuation', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    server.hold();
    const body = { characterId: 'summary', version: server.chat.version };
    const first = server.request('/api/qq/summarize', 'POST', body);
    const second = server.request('/api/qq/summarize', 'POST', body);
    const deadline = Date.now() + 5000;
    while (server.responses.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(server.responses.length, 2);
    await server.fault('data/chats/qq/summary.json');
    server.responses[0]();
    assert.equal((await Promise.race([first, second])).status, 500);
    server.responses[1]();
    assert.deepEqual((await Promise.all([first, second])).map(response => response.status).sort(), [409, 500]);
    assert.equal(server.readBook().entries.length, 1);
    assert.equal(server.readChat().messages[0].summary_archived, true);
});

test('failed card publication leaves the chat untouched and a retry commits one card', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    await server.fault(server.bookPath);
    const body = { characterId: 'summary', version: server.chat.version };
    assert.equal((await server.request('/api/qq/summarize', 'POST', body)).status, 500);
    assert.equal(server.readBook().entries.length, 0);
    assert.equal(server.readChat().messages[0].summary_archived, undefined);
    await server.json('/api/qq/summarize', 'POST', body);
    assert.equal(server.readBook().entries.length, 1);
    assert.equal(server.readChat().messages[0].summary_archived, true);
});

test('the exact source batch reuses its card if archive flags are removed in a later save', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    const first = await server.json('/api/qq/summarize', 'POST', { characterId: 'summary', version: server.chat.version });
    const archived = await server.json('/api/qq/chats/summary');
    const messages = archived.messages.map(message => { const copy = { ...message }; delete copy.summary_archived; return copy; });
    const restored = await server.json('/api/qq/chats/summary', 'POST', { version: archived.version, messages });
    const retry = await server.json('/api/qq/summarize', 'POST', { characterId: 'summary', version: restored.version });
    assert.equal(retry.entry.id, first.entry.id);
    assert.equal(server.readBook().entries.length, 1);
    assert.equal(server.calls(), 1);
    assert.equal(server.readChat().messages[0].summary_archived, true);
    assert.ok(server.readChat().updated_at >= restored.updated_at);
});

test('recovery refuses to overwrite an unexpected external edit to the source chat', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    await server.fault('data/chats/qq/summary.json');
    assert.equal((await server.request('/api/qq/summarize', 'POST', { characterId: 'summary', version: server.chat.version })).status, 500);
    const file = path.join(server.storage, 'data/chats/qq/summary.json');
    const external = server.readChat();
    external.messages[0].text = 'external edit must survive';
    fs.writeFileSync(file, JSON.stringify(external));
    assert.equal((await server.request('/api/qq/chats/summary')).status, 503);
    assert.equal(server.readChat().messages[0].text, 'external edit must survive');
    assert.equal(server.readBook().entries[0].summaryArchivePending, true);
});

test('an already pending reply recovers summary projection before its final version check', { timeout: 15000 }, async t => {
    const server = await fixture(t);
    server.hold();
    const body = { characterId: 'summary', version: server.chat.version };
    const reply = server.request('/api/qq/reply', 'POST', { ...body, generationId: 'pending' });
    let deadline = Date.now() + 5000;
    while (server.responses.length < 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(server.responses.length, 1);
    const summary = server.request('/api/qq/summarize', 'POST', body);
    deadline = Date.now() + 5000;
    while (server.responses.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(server.responses.length, 2);
    await server.fault('data/chats/qq/summary.json');
    server.responses[1]();
    assert.equal((await summary).status, 500);
    server.responses[0]();
    assert.equal((await reply).status, 409);
    assert.equal(server.readChat().messages.length, server.chat.messages.length);
    assert.equal(server.readChat().messages[0].summary_archived, true);
    assert.equal(server.readBook().entries.length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { once } = require('events');
const { testServer } = require('./helpers/server');
const Replies = require('../assets/scripts/qq-replies');
const { migrateSettings } = require('../modules/settings-migration');
const { storageRoot } = require('../modules/storage-root');

test('settings, worldbooks, preset identities and financial commits survive stale writers and failures', { timeout: 30000 }, async t => {
    const server = await testServer(t);
    const { json, request, storage } = server;
    const chat = id => json(`/api/qq/chats/${id}`);

    await t.test('settings require the read version and only patch supplied fields', async () => {
        const initial = await json('/api/settings');
        const updated = await json('/api/settings', 'PATCH', { version: initial._version, changes: { mainApi_model: 'first', untouched: true } });
        assert.notEqual(updated.settings._version, initial._version);
        assert.equal((await request('/api/settings', 'PATCH', { version: initial._version, changes: { mainApi_model: 'stale' } })).status, 409);
        assert.equal((await request('/api/settings', 'POST', { mainApi_model: 'old-client' })).status, 409);
        const next = await json('/api/settings', 'PATCH', { version: updated.settings._version, changes: { mainApi_model: 'second' } });
        assert.equal(next.settings.untouched, true);
        assert.equal(next.settings.mainApi_model, 'second');
        assert.equal(fs.existsSync(path.join(server.code, 'settings.json')), false);
        assert.throws(() => storageRoot(server.code, { BUNNYOS_STORAGE_DIR: path.join(server.code, 'data') }), /程序目录之外/);
    });

    await t.test('an old worldbook editor cannot delete a background summary', async () => {
        await json('/api/worldbooks/books', 'POST', { name: 'Memories' });
        const { books: [old] } = await json('/api/worldbooks');
        const file = path.join(storage, 'data/worldbooks/Memories.json');
        const background = JSON.parse(fs.readFileSync(file));
        background.entries.push({ id: 'summary', content: 'background summary' });
        fs.writeFileSync(file, JSON.stringify(background));
        const failed = await request(`/api/worldbooks/books/${old.id}`, 'PATCH', { version: old._version, changes: { entries: [] } });
        assert.equal(failed.status, 409);
        const { books: [current] } = await json('/api/worldbooks');
        assert.equal(current.entries[0].id, 'summary');
        const saved = await json(`/api/worldbooks/books/${current.id}`, 'PATCH', { version: current._version, changes: { name: 'Renamed' } });
        assert.equal(saved.book.entries[0].id, 'summary');
        assert.equal((await request(`/api/worldbooks/books/${current.id}`, 'DELETE', { version: old._version })).status, 409);
    });

    await t.test('renaming a preset preserves the independent QQ and editor selections', async () => {
        const first = await json('/api/st-presets/new', 'POST', { name: 'Old' });
        await json('/api/qq/prompt-preset', 'POST', { id: first.id });
        const editor = await json('/api/st-presets/new', 'POST', { name: 'AAA' });
        const renamed = await json(`/api/st-presets/${first.id}/rename`, 'POST', { name: 'ZZZ' });
        assert.equal(renamed.id, first.id);
        assert.equal((await json('/api/qq/prompt-preset')).currentPromptPresetId, first.id);
        assert.equal((await json('/api/st-presets')).currentPresetId, editor.id);
        assert.equal((await json(`/api/st-presets/${first.id}`)).preset.name, 'ZZZ');
        assert.ok(fs.existsSync(path.join(storage, 'data/presets/st-presets/ZZZ.json')));
        await json(`/api/st-presets/${first.id}/rename`, 'POST', { name: 'zzz' });
        assert.equal((await json(`/api/st-presets/${first.id}`)).preset.name, 'zzz');
        const legacy = (await json(`/api/st-presets/${first.id}`)).preset;
        delete legacy.extensions.bunnyosPresetId;
        legacy.name = 'Legacy';
        fs.writeFileSync(path.join(storage, 'data/presets/st-presets/Legacy.json'), JSON.stringify(legacy));
        await json('/api/qq/prompt-preset', 'POST', { id: 'Legacy' });
        await json('/api/st-presets/Legacy/rename', 'POST', { name: 'Legacy renamed' });
        await server.restart();
        assert.equal((await json('/api/qq/prompt-preset')).currentPromptPresetId, 'Legacy');
        assert.equal((await json('/api/st-presets/Legacy')).preset.name, 'Legacy renamed');
    });

    await t.test('a claimed transfer cannot credit twice after its chat write fails', async () => {
        const seeded = await json('/api/qq/chats/claim', 'POST', { version: null, messages: [{ id: 'gift', role: 'assistant', type: 'transfer', amount: '10', status: 'pending' }] });
        const before = (await json('/api/wallet')).balance;
        await server.fault('data/chats/qq/claim.json');
        assert.equal((await request('/api/qq/chats/claim/transfer/0/receive', 'POST', { version: seeded.version })).status, 500);
        await server.restart();
        const recovered = await chat('claim');
        assert.equal(recovered.messages[0].status, 'received');
        assert.equal((await request('/api/qq/chats/claim/transfer/0/receive', 'POST', { version: recovered.version })).status, 409);
        assert.equal((await json('/api/wallet')).balance, before + 10);
        recovered.messages[0].status = 'pending';
        const restored = await json('/api/qq/chats/claim', 'POST', { version: recovered.version, messages: recovered.messages });
        assert.equal(restored.messages[0].status, 'received');
    });

    await t.test('a process crash between debit and chat projection recovers one paid card', async () => {
        const before = (await json('/api/wallet')).balance;
        const body = { version: null, requestId: 'one-payment', cost: 5, message: { role: 'user', type: 'service', price: '5', text: 'gift' } };
        await server.fault('data/chats/qq/paid.json', true);
        await assert.rejects(request('/api/qq/chats/paid/paid-message', 'POST', body));
        await server.restart();
        const retry = await json('/api/qq/chats/paid/paid-message', 'POST', body);
        assert.equal(retry.idempotent, true);
        assert.equal(retry.chat.messages.length, 1);
        assert.equal(retry.balance, before - 5);
    });

    await t.test('refund and beauty projection failures retain one financial outcome', async () => {
        const before = (await json('/api/wallet')).balance;
        fs.writeFileSync(path.join(storage, 'data/chats/qq/expired.json'), JSON.stringify({ characterId: 'expired', messages: [
            { id: 'old', role: 'user', type: 'transfer', status: 'pending', amount: '7', created_at: Date.now() - 86400001 }
        ] }));
        await server.fault('data/chats/qq/expired.json');
        assert.equal((await request('/api/qq/chats/expired')).status, 500);
        assert.equal((await chat('expired')).messages[0].status, 'returned');
        assert.equal((await json('/api/wallet')).balance, before + 7);
        await server.fault('data/qq/beauties.json');
        const purchase = { requestId: 'one-beauty', name: 'Test bubble' };
        assert.equal((await request('/api/qq/beauties/bubbles', 'POST', purchase)).status, 500);
        const item = await json('/api/qq/beauties/bubbles', 'POST', purchase);
        const again = await json('/api/qq/beauties/bubbles', 'POST', purchase);
        assert.equal(again.id, item.id);
        assert.equal((await json('/api/qq/beauties/bubbles')).filter(value => value.id === item.id).length, 1);
        assert.equal((await json('/api/wallet')).balance, before + 2);
    });
});

test('structured reply versions retain transfer identity, settlement, cards and receipts', () => {
    const chat = { messages: [{ id: 'sent', role: 'user', type: 'transfer', amount: '3', status: 'pending' }] };
    Replies.appendReply(chat, ['[🧧¥10|gift]', '[🎁淘宝|29.8|毛衣|备注]', '[🧧领取]']);
    const transfer = chat.messages[1];
    transfer.status = 'received';
    transfer.settled_at = 123;
    Replies.appendReply(chat, ['another version'], 1);
    Replies.replaceReplyGroupWithVersion(chat, Replies.getReplyGroup(chat, 1), 0);
    assert.equal(chat.messages[1].type, 'transfer');
    assert.equal(chat.messages[1].transaction_id, transfer.transaction_id);
    assert.equal(chat.messages[1].status, 'received');
    assert.equal(chat.messages[1].settled_at, 123);
    assert.equal(chat.messages[2].type, 'service');
    assert.equal(chat.messages[2].item, '毛衣');
    assert.equal(chat.messages[3].type, 'transfer-receipt');
    assert.equal(chat.messages[0].status, 'received');
    assert.equal(chat.messages[1].reply_group_versions[0].segments, undefined);
});

test('asset migration runs once; deleted imported sounds and fonts stay deleted', () => {
    const settings = { imported_carrot: { fonts: { imported: { url: '/font.woff2' } }, notifSounds: { imported: '/sound.mp3' } } };
    assert.equal(migrateSettings(settings), true);
    delete settings.beautyPresets.font.imported;
    delete settings.notify_savedSounds.imported;
    assert.equal(migrateSettings(settings), false);
    assert.deepEqual(settings.beautyPresets.font, {});
    assert.deepEqual(settings.notify_savedSounds, {});
    assert.ok(settings.imported_carrot.fonts.imported);
});

test('shared preset normalization is idempotent and retains ST injection settings', () => {
    const { normalize } = require('../assets/scripts/st-preset');
    const custom = { identifier: 'custom', content: 'keep me', role: 'assistant', injection_position: 1, injection_depth: 3, injection_trigger: ['impersonate'] };
    const preset = { prompts: [custom], prompt_order: [{ order: [{ identifier: 'custom', enabled: true }] }], extensions: { bunnyosPromptGroups: {} } };
    assert.equal(normalize(preset, { bunnyosRealtime: 'editable realtime' }), true);
    assert.equal(normalize(preset, { bunnyosRealtime: 'other default' }), false);
    assert.deepEqual(preset.prompts.find(prompt => prompt.identifier === 'custom'), custom);
    assert.equal(preset.prompts.find(prompt => prompt.identifier === 'bunnyosRealtime').content, 'editable realtime');
});

test('reply persistence, notifications, prompt preview and server image references share the generation path', { timeout: 30000 }, async t => {
    const server = await testServer(t);
    const { json, request, pushes, storage } = server;
    const calls = [];
    let reply = '[🧧¥10|gift]\n\n[🎁淘宝|29.8|毛衣]';
    let hold = false, release, started;
    const upstream = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        calls.push(JSON.parse(body));
        if (started) { const signal = started; started = null; signal(); }
        if (hold) await new Promise(resolve => { release = resolve; });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }));
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    t.after(async () => { release?.(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
    const settings = await json('/api/settings');
    await json('/api/settings', 'PATCH', { version: settings._version, changes: {
        mainApi_url: `http://127.0.0.1:${upstream.address().port}`, mainApi_key: 'test', mainApi_model: 'gpt-4o', mainApi_context: 8192
    } });
    await json('/api/qq/characters', 'POST', { id: 'reply', name: 'Reply test' });
    await json('/api/notify/subscribe', 'POST', { subscription: { endpoint: 'https://push.example.test/one' } });
    const image = 'data:image/png;base64,YQ==';
    let chat = await json('/api/qq/chats/reply', 'POST', { version: null, messages: [{ role: 'user', type: 'image', image, text: 'activate-key' }] });
    const imageUrl = chat.messages[0].image_url;
    await json('/api/worldbooks/books', 'POST', { name: 'Keywords' });
    const { books: [book] } = await json('/api/worldbooks');
    await json(`/api/worldbooks/books/${book.id}`, 'PATCH', { version: book._version, changes: { entries: [
        { id: 'keyword', key: ['activate-key'], constant: false, content: 'KEYWORD-CONTENT', enabled: true }
    ] } });
    await json('/api/qq/global-worldbooks', 'POST', { globalWorldbookIds: [book.id] });

    await t.test('preview, token count and generation activate the same keyword and image', async () => {
        const preview = await json('/api/qq/prompt-preview', 'POST', { characterId: 'reply' });
        const tokens = await json('/api/qq/chat-tokens/reply');
        assert.match(preview.promptText, /KEYWORD-CONTENT/);
        assert.match(tokens.promptText, /KEYWORD-CONTENT/);
        const generated = await json('/api/qq/reply', 'POST', { characterId: 'reply', version: chat.version });
        assert.match(JSON.stringify(calls[0].messages), /KEYWORD-CONTENT/);
        assert.ok(calls[0].messages.some(message => Array.isArray(message.content)
            && message.content.some(part => part.type === 'image_url' && part.image_url.url === image)));
        assert.equal(calls[0].temperature, preview.sampling.temperature);
        assert.equal(generated.chat.messages[0].image, undefined);
        assert.equal(generated.chat.messages[0].image_url, imageUrl);
        assert.equal(generated.chat.messages[1].type, 'transfer');
        assert.equal(generated.chat.messages[2].type, 'service');
        const stored = JSON.parse(fs.readFileSync(path.join(storage, 'data/chats/qq/reply.json')));
        assert.equal(stored.messages[1].id, generated.chat.messages[1].id);
        assert.equal(pushes.length, 1);
        assert.equal(pushes[0].chat.messages.length, generated.chat.messages.length);
        chat = generated.chat;
    });

    await t.test('a write failure produces no success push', async () => {
        await server.fault('data/chats/qq/reply.json');
        const result = await request('/api/qq/reply', 'POST', { characterId: 'reply', version: chat.version });
        assert.equal(result.status, 500);
        assert.equal(pushes.length, 1);
        assert.equal((await json('/api/qq/chats/reply')).version, chat.version);
    });

    await t.test('editing on another device during generation rejects the stale result', async () => {
        hold = true;
        const pending = new Promise(resolve => { started = resolve; });
        const generating = request('/api/qq/reply', 'POST', { characterId: 'reply', version: chat.version });
        await pending;
        chat = await json('/api/qq/chats/reply', 'POST', { version: chat.version, messages: [...chat.messages, { role: 'user', text: 'newer device edit' }] });
        release();
        assert.equal((await generating).status, 409);
        assert.equal(pushes.length, 1);
        assert.equal((await json('/api/qq/chats/reply')).messages.at(-1).text, 'newer device edit');
        hold = false;
    });

    await t.test('closing the browser request still saves the reply before notifying', async () => {
        hold = true;
        reply = 'saved after closing';
        const pending = new Promise(resolve => { started = resolve; });
        const controller = new AbortController();
        const generating = request('/api/qq/reply', 'POST', { characterId: 'reply', version: chat.version }, { signal: controller.signal });
        await pending;
        controller.abort();
        await assert.rejects(generating);
        release();
        for (let attempt = 0; attempt < 100; attempt++) {
            chat = await json('/api/qq/chats/reply');
            if (chat.messages.at(-1).text === reply) break;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(chat.messages.at(-1).text, reply);
        assert.equal(pushes.length, 2);
        hold = false;
    });

    await t.test('an explicit stop cancels the server job without appending a reply', async () => {
        hold = true;
        const pending = new Promise(resolve => { started = resolve; });
        const generating = request('/api/qq/reply', 'POST', { characterId: 'reply', generationId: 'cancel-me', version: chat.version });
        await pending;
        await json('/api/qq/reply/cancel', 'POST', { characterId: 'reply', generationId: 'cancel-me' });
        release();
        assert.equal((await generating).status, 499);
        assert.equal((await json('/api/qq/chats/reply')).version, chat.version);
        assert.equal(pushes.length, 2);
        hold = false;
    });
});

test('browser HTML uses the server link parser, generic-title validation and finalizer', async t => {
    const { json } = await testServer(t);
    const valid = await json('/api/qq/link-preview', 'POST', {
        url: 'https://page.example.test/article', frontend: { finalUrl: 'https://page.example.test/article', html: '<title>Real title</title><meta name="description" content="Real description">' }
    });
    assert.equal(valid.title, 'Real title');
    assert.equal(valid.description, 'Real description');
    const generic = await json('/api/qq/link-preview', 'POST', {
        url: 'https://www.xiaohongshu.com/explore/one', frontend: { finalUrl: 'https://www.xiaohongshu.com/explore/one', html: '<title>小红书－你的生活指南</title>' }
    });
    assert.notEqual(generic.title, '小红书－你的生活指南');
    assert.ok(generic.limitedReason);
    const xhs = await json('/api/qq/link-preview', 'POST', {
        url: 'https://www.xiaohongshu.com/explore/two', frontend: { finalUrl: 'https://www.xiaohongshu.com/explore/two',
            html: '<script>window.state = {"noteData":{"title":"Real XHS note","desc":"Real XHS description","imageList":[]}}</script>' }
    });
    assert.equal(xhs.title, 'Real XHS note');
});

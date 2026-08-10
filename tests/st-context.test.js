'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activateWorldInfo, buildStContext, injectInChatPrompts } = require('../modules/st-context');
const { createModelTokenCounter, selectTokenizerFamily, selectTiktokenModel } = require('../modules/st-context/tokenizer');

test('in-chat prompts use depth, descending order, and role order', () => {
    const history = [{ role: 'user', content: 'A' }, { role: 'assistant', content: 'B' }];
    const result = injectInChatPrompts(history, [
        { identifier: 'low', role: 'user', content: 'low', injection_depth: 1, injection_order: 50 },
        { identifier: 'high', role: 'system', content: 'high', injection_depth: 1, injection_order: 100 },
        { identifier: 'tail', role: 'assistant', content: 'tail', injection_depth: 0, injection_order: 100 }
    ]);
    assert.deepEqual(result.map(item => item.content), ['A', 'high', 'low', 'B', 'tail']);
});

test('legacy worldbook entries remain always-on', () => {
    const result = activateWorldInfo({
        books: { character: [{ id: 'c', name: 'C', entries: [{ id: 'old', content: 'legacy', enabled: true }] }] },
        history: [], contextTokens: 1000
    });
    assert.equal(result.after.join('\n'), 'legacy');
    assert.equal(result.activated.length, 1);
});

test('keyword recursion activates a second entry', () => {
    const result = activateWorldInfo({
        books: { character: [{ id: 'c', name: 'C', entries: [
            { id: 'one', key: ['apple'], content: 'banana', position: 1 },
            { id: 'two', key: ['banana'], content: 'result', position: 1 }
        ] }] },
        history: [{ role: 'user', content: 'apple' }], contextTokens: 1000,
        settings: { recursive: true }
    });
    assert.deepEqual(result.activated.map(item => item.id).sort(), ['one', 'two']);
});

test('generation triggers and in-chat injection are respected', () => {
    const preset = {
        prompts: [
            { identifier: 'main', role: 'system', content: 'main', injection_position: 0 },
            { identifier: 'chatHistory', role: 'system', marker: true, injection_position: 0 },
            { identifier: 'regen', role: 'system', content: 'regen only', injection_position: 1, injection_depth: 0, injection_trigger: ['regenerate'] }
        ],
        prompt_order: [{ character_id: 1, order: [
            { identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }, { identifier: 'regen', enabled: true }
        ] }]
    };
    const result = buildStContext({ preset, character: { id: 1 }, history: [{ role: 'user', content: 'hello' }], generationType: 'regenerate', contextTokens: 500, responseTokens: 50 });
    assert.deepEqual(result.messages.map(item => item.content), ['main', 'hello', 'regen only']);
    assert.equal(result.itemization.generationType, 'regenerate');
});

test('oldest history is removed first when the context budget is full', () => {
    const preset = {
        prompts: [{ identifier: 'chatHistory', role: 'system', marker: true, injection_position: 0 }],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'chatHistory', enabled: true }] }]
    };
    const history = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index} xxxxxxxxxx` }));
    const result = buildStContext({ preset, character: { id: 1 }, history, contextTokens: 80, responseTokens: 20 });
    assert.ok(result.itemization.historyDropped > 0);
    assert.equal(result.messages.at(-1).content, history.at(-1).content);
});

test('world-info outlet content replaces outlet macros', () => {
    const preset = {
        prompts: [
            { identifier: 'main', role: 'system', content: 'Lore: {{outlet::facts}}', injection_position: 0 },
            { identifier: 'chatHistory', role: 'system', marker: true, injection_position: 0 }
        ],
        prompt_order: [{ character_id: 1, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }]
    };
    const result = buildStContext({
        preset,
        character: { id: 1 },
        history: [{ role: 'user', content: 'hi' }],
        books: { character: [{ id: 'c', name: 'C', entries: [{ id: 'fact', constant: true, position: 7, outletName: 'facts', content: 'blue' }] }] },
        contextTokens: 500,
        responseTokens: 50
    });
    assert.equal(result.messages[0].content, 'Lore: blue');
});

test('ST-compatible tokenizer selection recognizes common model families', () => {
    assert.equal(selectTokenizerFamily('gemini-3.5-flash-low'), 'gemma');
    assert.equal(selectTokenizerFamily('anthropic/claude-sonnet-4'), 'claude');
    assert.equal(selectTokenizerFamily('deepseek/deepseek-v3'), 'deepseek');
    assert.equal(selectTokenizerFamily('qwen/qwen3-235b'), 'qwen2');
    assert.equal(selectTiktokenModel('gpt-5.2'), 'o1');
});

test('OpenAI tokenizer uses exact tiktoken counting', async () => {
    const tokenizer = await createModelTokenCounter({ model: 'gpt-4o' });
    assert.equal(tokenizer.exact, true);
    assert.equal(tokenizer.family, 'openai');
    assert.ok(tokenizer.textCounter('你好，BunnyOS') > 0);
    assert.ok(tokenizer.messageCounter({ role: 'system', content: '角色设定' }) > tokenizer.textCounter('角色设定'));
});

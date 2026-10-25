const { Tiktoken } = require('js-tiktoken/lite');
const { contentText } = require('../modules/st-context/token-budget');
let tokenizer;
async function createModelTokenCounter({ model = '' } = {}) {
    const openai = /gpt|chatgpt|^o[134]/i.test(model);
    if (openai) {
        tokenizer ||= new Tiktoken(await (await globalThis.bunnyBrowserReadAsset('tokenizer-o200k.json')).json());
        const count = value => tokenizer.encode(String(value || '')).length;
        return { family: 'openai', resolvedModel: 'gpt-4o', requestedModel: model, exact: false,
            fallbackReason: '网页版使用 o200k_base 计数；不同模型的消息开销可能不同。',
            textCounter: count, messageCounter: m => 3 + count(m?.role) + count(contentText(m?.content)) + (m?.name ? count(m.name) + 1 : 0) };
    }
    const count = value => Math.ceil(new TextEncoder().encode(String(value || '')).length / 3.35);
    return { family: 'browser-estimate', resolvedModel: 'byte-estimate', requestedModel: model, exact: false,
        fallbackReason: '网页版对该模型使用字节估算，请为上下文预留余量。', textCounter: count, messageCounter: m => count(JSON.stringify(m || {})) };
}
module.exports = { createModelTokenCounter };

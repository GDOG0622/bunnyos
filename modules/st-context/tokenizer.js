'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const tiktoken = require('tiktoken');
const { SentencePieceProcessor } = require('@agnai/sentencepiece-js');
const { Tokenizer } = require('@agnai/web-tokenizers');
const { contentText, estimateMessageTokens, estimateTextTokens } = require('./token-budget');

const gunzip = promisify(zlib.gunzip);
const ST_COMMIT = '51ad27fb86d39a3daca3adaa970375c9670c12df';
const ST_RAW = `https://raw.githubusercontent.com/SillyTavern/SillyTavern/${ST_COMMIT}/src/tokenizers`;
const TOKENIZER_RAW = 'https://raw.githubusercontent.com/SillyTavern/SillyTavern-Tokenizers/main';
const DEFAULT_CACHE_DIR = path.join(process.cwd(), 'data', '_cache', 'tokenizers');
const BYTES_PER_TOKEN = 3.35;

const MODEL_SOURCES = Object.freeze({
    llama: { kind: 'sentencepiece', url: `${ST_RAW}/llama.model` },
    mistral: { kind: 'sentencepiece', url: `${ST_RAW}/mistral.model` },
    yi: { kind: 'sentencepiece', url: `${ST_RAW}/yi.model` },
    gemma: { kind: 'sentencepiece', url: `${ST_RAW}/gemma.model` },
    jamba: { kind: 'sentencepiece', url: `${ST_RAW}/jamba.model` },
    claude: { kind: 'web', url: `${ST_RAW}/claude.json` },
    llama3: { kind: 'web', url: `${ST_RAW}/llama3.json` },
    qwen2: { kind: 'web', url: `${TOKENIZER_RAW}/qwen2.json.gz`, compressed: true },
    'command-r': { kind: 'web', url: `${TOKENIZER_RAW}/command-r.json.gz`, compressed: true },
    'command-a': { kind: 'web', url: `${TOKENIZER_RAW}/command-a.json.gz`, compressed: true },
    nemo: { kind: 'web', url: `${TOKENIZER_RAW}/nemo.json.gz`, compressed: true },
    deepseek: { kind: 'web', url: `${TOKENIZER_RAW}/deepseek.json.gz`, compressed: true }
});

const instancePromises = new Map();
const tiktokenCache = new Map();

function byteEstimate(value) {
    return Math.max(0, Math.ceil(Buffer.byteLength(String(value || ''), 'utf8') / BYTES_PER_TOKEN));
}

function selectTokenizerFamily(modelName) {
    const model = String(modelName || '').toLowerCase();
    if (model.includes('claude')) return 'claude';
    if (model.includes('deepseek') || model.includes('sonar-reasoning') || /(^|[\/-])r1([\/-]|$)/.test(model)) return 'deepseek';
    if (model.includes('qwen') || model.includes('qwq') || model.includes('tongyi') || model.includes('kimi')) return 'qwen2';
    if (model.includes('command-a')) return 'command-a';
    if (model.includes('command-r')) return 'command-r';
    if (model.includes('nemo') || model.includes('pixtral')) return 'nemo';
    if (model.includes('llama3') || model.includes('llama-3') || model.includes('llama 3') || model.includes('llama-4')) return 'llama3';
    if (model.includes('llama')) return 'llama';
    if (model.includes('mistral') || model.includes('mixtral')) return 'mistral';
    if (/(^|[\/-])yi([\/-]|$)/.test(model)) return 'yi';
    if (model.includes('gemma') || model.includes('gemini') || model.includes('learnlm')) return 'gemma';
    if (model.includes('jamba')) return 'jamba';
    return 'openai';
}

function selectTiktokenModel(modelName) {
    const model = String(modelName || '').toLowerCase();
    if (model.includes('gpt-5') || model.includes('o1') || model.includes('o3') || model.includes('o4')) return 'o1';
    if (model.includes('gpt-4o') || model.includes('chatgpt-4o') || model.includes('gpt-4.1') || model.includes('gpt-4.5')) return 'gpt-4o';
    if (model.includes('gpt-4-32k')) return 'gpt-4-32k';
    if (model.includes('gpt-4')) return 'gpt-4';
    if (model.includes('gpt-3.5-turbo-0301')) return 'gpt-3.5-turbo-0301';
    return 'gpt-3.5-turbo';
}

async function downloadModel(family, cacheDir) {
    const source = MODEL_SOURCES[family];
    if (!source) throw new Error(`没有 ${family} tokenizer 模型来源`);
    const extension = source.kind === 'sentencepiece' ? '.model' : '.json';
    const target = path.join(cacheDir, `${family}${extension}`);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;
    fs.mkdirSync(cacheDir, { recursive: true });
    const response = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`下载 ${family} tokenizer 失败: HTTP ${response.status}`);
    let data = Buffer.from(await response.arrayBuffer());
    if (source.compressed) data = await gunzip(data);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, target);
    return target;
}

async function loadLocalTokenizer(family, cacheDir) {
    const cacheKey = `${cacheDir}:${family}`;
    if (instancePromises.has(cacheKey)) return instancePromises.get(cacheKey);
    const promise = (async () => {
        const source = MODEL_SOURCES[family];
        const modelPath = await downloadModel(family, cacheDir);
        if (source.kind === 'sentencepiece') {
            const instance = new SentencePieceProcessor();
            await instance.load(modelPath);
            return { instance, kind: source.kind, modelPath };
        }
        const buffer = fs.readFileSync(modelPath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const instance = await Tokenizer.fromJSON(arrayBuffer);
        return { instance, kind: source.kind, modelPath };
    })();
    instancePromises.set(cacheKey, promise);
    try { return await promise; }
    catch (error) {
        instancePromises.delete(cacheKey);
        throw error;
    }
}

function getTiktoken(model) {
    if (tiktokenCache.has(model)) return tiktokenCache.get(model);
    let instance;
    try { instance = tiktoken.encoding_for_model(model); }
    catch { instance = tiktoken.get_encoding(model === 'o1' || model === 'gpt-4o' ? 'o200k_base' : 'cl100k_base'); }
    tiktokenCache.set(model, instance);
    return instance;
}

function messageTextForLocalTokenizer(message) {
    return Object.entries(message || {}).map(([key, value]) => {
        if (key === 'content') return contentText(value);
        if (typeof value === 'string') return value;
        return JSON.stringify(value ?? '');
    }).join('\n\n');
}

function buildExactCounters(family, loaded, modelName) {
    if (family === 'openai') {
        const resolvedModel = selectTiktokenModel(modelName);
        const tokenizer = getTiktoken(resolvedModel);
        const encode = value => tokenizer.encode(String(value || '')).length;
        return {
            textCounter: encode,
            messageCounter(message) {
                let tokens = resolvedModel === 'gpt-3.5-turbo-0301' ? 4 : 3;
                tokens += encode(message?.role);
                tokens += encode(contentText(message?.content));
                if (message?.name) tokens += encode(message.name) + (resolvedModel === 'gpt-3.5-turbo-0301' ? -1 : 1);
                return tokens;
            },
            resolvedModel
        };
    }

    const encode = loaded.kind === 'sentencepiece'
        ? value => loaded.instance.encodeIds(String(value || '')).length
        : value => loaded.instance.encode(String(value || '')).length;
    return {
        textCounter: encode,
        messageCounter: message => encode(messageTextForLocalTokenizer(message)),
        resolvedModel: family
    };
}

async function createModelTokenCounter({ model, cacheDir = DEFAULT_CACHE_DIR } = {}) {
    const family = selectTokenizerFamily(model);
    try {
        const loaded = family === 'openai' ? null : await loadLocalTokenizer(family, cacheDir);
        const counters = buildExactCounters(family, loaded, model);
        return {
            ...counters,
            family,
            requestedModel: String(model || ''),
            exact: true,
            fallbackReason: '',
            modelPath: loaded?.modelPath || ''
        };
    } catch (error) {
        console.warn(`[TOKENIZER] ${family} 加载失败，使用 ST 字节估算回退:`, error?.message || error);
        return {
            family,
            requestedModel: String(model || ''),
            resolvedModel: 'byte-estimate',
            exact: false,
            fallbackReason: error?.message || String(error),
            modelPath: '',
            textCounter: value => byteEstimate(value) || estimateTextTokens(value),
            messageCounter: message => byteEstimate(JSON.stringify(message || {})) || estimateMessageTokens(message)
        };
    }
}

module.exports = {
    DEFAULT_CACHE_DIR,
    MODEL_SOURCES,
    byteEstimate,
    selectTokenizerFamily,
    selectTiktokenModel,
    createModelTokenCounter
};

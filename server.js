const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self)');
    next();
});
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

const settingsEventClients = new Set();

function broadcastSettingsUpdated(settings) {
    const payload = JSON.stringify({ type: 'settings-updated', updatedAt: settings?._updatedAt || Date.now() });
    for (const client of settingsEventClients) {
        try {
            client.write(`event: settings-updated\ndata: ${payload}\n\n`);
        } catch {
            settingsEventClients.delete(client);
        }
    }
}

// 诊断 body-parser 错误（413 等）
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        console.error('[BODY-PARSER 413]', {
            url: req.originalUrl,
            received: err.length,
            limit: err.limit,
            message: err.message
        });
        return res.status(413).json({
            error: 'Payload too large',
            received: err.length,
            limit: err.limit
        });
    }
    next(err);
});

// 静态提供当前目录，以支持 index.html 等前端页面
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (['.html', '.js', '.css', '.json', '.webmanifest'].includes(ext)) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// 萝卜机目录结构
const APPS_DIR = path.join(__dirname, 'apps');
const DATA_DIR = path.join(__dirname, 'data');
const ASSETS_DIR = path.join(__dirname, 'assets');
const BACKGROUNDS_DIR = path.join(ASSETS_DIR, 'backgrounds');
const APP_ICONS_DIR = path.join(ASSETS_DIR, 'app-icons');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets', 'image-prompts.json');
const ST_PRESETS_DIR = path.join(DATA_DIR, 'presets', 'st-presets');
const ST_PRESETS_SETTINGS_FILE = path.join(DATA_DIR, 'presets', 'st-presets-settings.json');
const DEFAULT_ST_PRESET_FILE = path.join(APPS_DIR, 'prompt-manager', 'Liminal_online.json');
const WORLDBOOK_FILE = path.join(DATA_DIR, 'worlds', 'worldbooks.json');
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
const CHATS_DIR = path.join(DATA_DIR, 'chats', 'qq');
const QQ_DIR = path.join(DATA_DIR, 'qq');
const QQ_GROUPS_FILE = path.join(QQ_DIR, 'groups.json');
const QQ_STICKER_PACKS_FILE = path.join(QQ_DIR, 'sticker-packs.json');
const QQ_SETTINGS_FILE = path.join(QQ_DIR, 'settings.json');
const WALLET_FILE = path.join(DATA_DIR, 'wallet.json');
const WALLET_INITIAL_BALANCE = 20000;
const QQ_BEAUTIES_FILE = path.join(QQ_DIR, 'beauties.json');
const QQ_CHAR_BEAUTY_FILE = path.join(QQ_DIR, 'char-beauty.json');
const QQ_BEAUTY_BG_DIR = path.join(QQ_DIR, 'beauty-backgrounds');
// 美化分类 + 创建价（cc）。详见 QQ美化系统计划.md §1.4。
// 头像：公共库，成对（charUrl + userUrl），换也成对换（用户决策 2026-06-22 反转）
const BEAUTY_TYPES = ['skins', 'avatars', 'frames', 'bubbles', 'backgrounds'];
const BEAUTY_PRICES = { skins: 20, avatars: 5, frames: 5, bubbles: 5, backgrounds: 0 };
function defaultBeautyItem(type) {
    const base = { id: 'default', name: '默认', preview: '' };
    if (type === 'bubbles') return { ...base, userCss: '', charCss: '' };
    if (type === 'avatars') return { ...base, charUrl: '', userUrl: '' };
    // 头像框 = 透明 PNG 直链；背景图 = 上传图片。都是 url 字段。
    if (type === 'backgrounds' || type === 'frames') return { ...base, url: '' };
    return { ...base, css: '' };
}
function defaultBeautiesData() {
    const out = {};
    BEAUTY_TYPES.forEach(t => { out[t] = [defaultBeautyItem(t)]; });
    return out;
}
const USER_PERSONAS_DIR = path.join(DATA_DIR, 'userpersonas');
const AVATARS_DIR = path.join(DATA_DIR, 'assets', 'avatars');
const USER_PERSONA_AVATARS_DIR = path.join(AVATARS_DIR, 'userpersonas');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const PUSH_SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');

// 辅助函数：确保目录和文件存在
function ensureFileExist(filePath, defaultData = {}) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf-8');
    }
}

// 初始化默认文件结构
ensureFileExist(SETTINGS_FILE, {});
ensureFileExist(PRESETS_FILE, {});
ensureFileExist(ST_PRESETS_SETTINGS_FILE, {});
ensureFileExist(WORLDBOOK_FILE, { books: [] });
// 老格式（扁平条目数组）一律重置
{
    const raw = readJsonFile(WORLDBOOK_FILE, null);
    if (!raw || Array.isArray(raw) || !Array.isArray(raw.books)) {
        writeJsonFile(WORLDBOOK_FILE, { books: [] });
    }
}
fs.mkdirSync(ST_PRESETS_DIR, { recursive: true });
fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
fs.mkdirSync(APP_ICONS_DIR, { recursive: true });
fs.mkdirSync(CHARACTERS_DIR, { recursive: true });
fs.mkdirSync(CHATS_DIR, { recursive: true });
fs.mkdirSync(AVATARS_DIR, { recursive: true });
fs.mkdirSync(USER_PERSONAS_DIR, { recursive: true });
fs.mkdirSync(USER_PERSONA_AVATARS_DIR, { recursive: true });
ensureFileExist(QQ_GROUPS_FILE, []);
ensureFileExist(QQ_STICKER_PACKS_FILE, []);
ensureFileExist(QQ_SETTINGS_FILE, {});
ensureFileExist(PUSH_SUBSCRIPTIONS_FILE, []);
ensureFileExist(WALLET_FILE, { balance: WALLET_INITIAL_BALANCE, updated_at: Date.now() });
ensureFileExist(QQ_BEAUTIES_FILE, defaultBeautiesData());
ensureFileExist(QQ_CHAR_BEAUTY_FILE, {});
fs.mkdirSync(QQ_BEAUTY_BG_DIR, { recursive: true });
// 兜底：若文件存在但缺类目或缺 default 项，补齐
{
    const cur = readJsonFile(QQ_BEAUTIES_FILE, {});
    let changed = false;
    BEAUTY_TYPES.forEach(t => {
        if (!Array.isArray(cur[t])) { cur[t] = [defaultBeautyItem(t)]; changed = true; }
        else if (!cur[t].some(it => it && it.id === 'default')) {
            cur[t].unshift(defaultBeautyItem(t)); changed = true;
        }
    });
    if (changed) writeJsonFile(QQ_BEAUTIES_FILE, cur);
}

// ========== Web Push 初始化 ==========
function ensureVapidKeys() {
    let pair = readJsonFile(VAPID_FILE, null);
    if (!pair || !pair.publicKey || !pair.privateKey) {
        pair = webpush.generateVAPIDKeys();
        writeJsonFile(VAPID_FILE, pair);
        console.log('[PUSH] 生成新 VAPID 密钥对到 data/vapid.json');
    }
    return pair;
}
const VAPID_KEYS = ensureVapidKeys();
webpush.setVapidDetails(
    'mailto:bunnyos@localhost',
    VAPID_KEYS.publicKey,
    VAPID_KEYS.privateKey
);

function readPushSubscriptions() {
    const list = readJsonFile(PUSH_SUBSCRIPTIONS_FILE, []);
    return Array.isArray(list) ? list : [];
}
function writePushSubscriptions(list) {
    writeJsonFile(PUSH_SUBSCRIPTIONS_FILE, list);
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
async function sendWebPushToAll(payload) {
    const subs = readPushSubscriptions();
    if (!subs.length) return { sent: 0, removed: 0 };
    let sent = 0;
    const dead = [];
    await Promise.all(subs.map(async (sub) => {
        try {
            await webpush.sendNotification(sub, JSON.stringify(payload));
            sent += 1;
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                // 订阅失效，剔除
                dead.push(sub.endpoint);
            } else {
                console.warn('[PUSH] 推送失败', err.statusCode, err.body || err.message);
            }
        }
    }));
    if (dead.length) {
        writePushSubscriptions(subs.filter(s => !dead.includes(s.endpoint)));
    }
    return { sent, removed: dead.length };
}

function parseDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
        mime: match[1],
        buffer: Buffer.from(match[2], 'base64')
    };
}

function extensionFromMime(mime) {
    const map = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/svg+xml': 'svg'
    };
    return map[mime] || 'png';
}

function cleanName(name) {
    return String(name || 'app')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'app';
}

function cleanFileName(name, fallback = '未命名') {
    return String(name || fallback)
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || fallback;
}

function uniquePersonaFileName(name, currentFileName = '') {
    const base = cleanFileName(name || '默认');
    let candidate = `${base}.json`;
    let index = 2;
    const currentLower = currentFileName.toLowerCase();
    while (
        fs.existsSync(path.join(USER_PERSONAS_DIR, candidate)) &&
        candidate.toLowerCase() !== currentLower
    ) {
        candidate = `${base}-${index}.json`;
        index += 1;
    }
    return candidate;
}

function removeBackgroundSlot(slotName) {
    if (!fs.existsSync(BACKGROUNDS_DIR)) return;
    fs.readdirSync(BACKGROUNDS_DIR)
        .filter(file => file === slotName || file.startsWith(`${slotName}.`))
        .forEach(file => fs.rmSync(path.join(BACKGROUNDS_DIR, file), { force: true }));
}

function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function isSillyTavernPreset(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.prompts) && Array.isArray(data.prompt_order);
}

function stPresetIdFromName(name) {
    return cleanFileName(name || 'preset', 'preset')
        .replace(/\.+$/g, '')
        .slice(0, 80) || 'preset';
}

function uniqueStPresetId(name, currentId = '') {
    const base = stPresetIdFromName(name);
    let candidate = base;
    let index = 2;
    const currentLower = currentId.toLowerCase();
    while (
        fs.existsSync(path.join(ST_PRESETS_DIR, `${candidate}.json`)) &&
        candidate.toLowerCase() !== currentLower
    ) {
        candidate = `${base}-${index}`;
        index += 1;
    }
    return candidate;
}

function stPresetFile(id) {
    return path.join(ST_PRESETS_DIR, `${stPresetIdFromName(id)}.json`);
}

function ensureDefaultStPreset() {
    const files = fs.existsSync(ST_PRESETS_DIR)
        ? fs.readdirSync(ST_PRESETS_DIR).filter(file => file.endsWith('.json'))
        : [];
    if (!files.length && fs.existsSync(DEFAULT_ST_PRESET_FILE)) {
        const preset = readJsonFile(DEFAULT_ST_PRESET_FILE, null);
        if (isSillyTavernPreset(preset)) {
            writeJsonFile(path.join(ST_PRESETS_DIR, 'Liminal_online.json'), preset);
            writeJsonFile(ST_PRESETS_SETTINGS_FILE, { currentPresetId: 'Liminal_online' });
        }
    }
}

function summarizeStPreset(id, data, stat = null) {
    const order = Array.isArray(data?.prompt_order?.[0]?.order) ? data.prompt_order[0].order : [];
    const promptMap = new Map((Array.isArray(data?.prompts) ? data.prompts : []).map(prompt => [prompt.identifier, prompt]));
    const enabledCount = order.filter(item => item.enabled).length;
    const markerCount = Array.from(promptMap.values()).filter(prompt => prompt.marker).length;
    const name = data?.name || data?.preset_name || id;
    return {
        id,
        name,
        fileName: `${id}.json`,
        promptCount: Array.isArray(data?.prompts) ? data.prompts.length : 0,
        orderCount: order.length,
        enabledCount,
        markerCount,
        updated_at: stat?.mtimeMs ? Math.round(stat.mtimeMs) : 0
    };
}

function listStPresetSummaries() {
    ensureDefaultStPreset();
    if (!fs.existsSync(ST_PRESETS_DIR)) return [];
    return fs.readdirSync(ST_PRESETS_DIR)
        .filter(file => file.endsWith('.json'))
        .map(file => {
            const filePath = path.join(ST_PRESETS_DIR, file);
            const data = readJsonFile(filePath, null);
            if (!isSillyTavernPreset(data)) return null;
            return summarizeStPreset(path.basename(file, '.json'), data, fs.statSync(filePath));
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function getCurrentStPresetId() {
    const presets = listStPresetSummaries();
    const settings = readJsonFile(ST_PRESETS_SETTINGS_FILE, {});
    if (presets.some(preset => preset.id === settings.currentPresetId)) return settings.currentPresetId;
    const currentPresetId = presets[0]?.id || '';
    writeJsonFile(ST_PRESETS_SETTINGS_FILE, { ...settings, currentPresetId });
    return currentPresetId;
}

function listUserPersonas() {
    if (!fs.existsSync(USER_PERSONAS_DIR)) return [];
    return fs.readdirSync(USER_PERSONAS_DIR)
        .filter(file => file.endsWith('.json'))
        .map(file => {
            try {
                const persona = JSON.parse(fs.readFileSync(path.join(USER_PERSONAS_DIR, file), 'utf-8'));
                return { ...persona, fileName: file };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
}

function findUserPersonaFile(id) {
    const persona = listUserPersonas().find(item => item.id === id);
    return persona ? path.join(USER_PERSONAS_DIR, persona.fileName) : '';
}

function createDefaultUserPersona() {
    const now = Date.now();
    const persona = {
        id: `user_${shortId()}`,
        name: '默认',
        gender: '',
        birthday: '',
        status: '超开心',
        customStatus: '',
        signature: '情绪是一场雷阵雨',
        note: '',
        prompt: '',
        avatar: '',
        created_at: now,
        updated_at: now
    };
    const fileName = uniquePersonaFileName(persona.name);
    writeJsonFile(path.join(USER_PERSONAS_DIR, fileName), persona);
    const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
    writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPersonaId: persona.id });
    return { ...persona, fileName };
}

function ensureUserPersonasReady() {
    let personas = listUserPersonas();
    if (!personas.length) {
        personas = [createDefaultUserPersona()];
    }
    const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
    let currentPersonaId = qqSettings.currentPersonaId;
    if (!personas.some(item => item.id === currentPersonaId)) {
        currentPersonaId = personas[0].id;
        writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPersonaId });
    }
    return { personas, currentPersonaId };
}

function getCurrentUserPersona() {
    const { personas, currentPersonaId } = ensureUserPersonasReady();
    return personas.find(item => item.id === currentPersonaId) || personas[0] || null;
}

function buildUserInfoPrompt(persona) {
    if (!persona) return '';
    const lines = [
        '<user_info>',
        `名字：${persona.name || '默认'}`,
        `性别：${persona.gender || ''}`,
        `生日：${persona.birthday || ''}`,
        `用户人设：${persona.prompt || ''}`,
        '</user_info>'
    ];
    return lines.join('\n');
}

function buildCharacterInfoPrompt(character) {
    if (!character) return '';
    const lines = [
        '<character_info>',
        `角色名：${character.name || ''}`,
        '角色设定：',
        character.role_setting || character.description || '',
        `其它设定：${character.other_setting || character.nsfw_setting || ''}`,
        '</character_info>'
    ];
    return lines.join('\n');
}

function injectCharRulesAtDepth(history, character, variables = {}) {
    const rawRules = (character?.rp_rules || character?.personality || '').trim();
    if (!rawRules) return history;
    // 宏渲染：否则 {{user}}/{{char}} 等占位符会原样发给模型
    const rules = renderPromptTemplate(rawRules, variables).trim();
    if (!rules) return history;
    const depth = Math.max(0, Math.min(parseInt(character?.rp_rules_depth, 10) || 0, history.length));
    const insertIndex = history.length - depth;
    const next = [...history];
    next.splice(insertIndex, 0, { role: 'system', content: rules });
    return next;
}

function buildBlankStPreset(name) {
    const builtinMarkers = [
        { identifier: 'bunnyosRealtime', name: '实时模式' },
        { identifier: 'charDescription', name: 'CHAR人设' },
        { identifier: 'personaDescription', name: 'USER人设' },
        { identifier: 'worldInfoAfter', name: '世界书' },
        { identifier: 'worldInfoBefore', name: '总结内容' },
        { identifier: 'scenario', name: '场景信息' },
        { identifier: 'dialogueExamples', name: '示例聊天' },
        { identifier: 'onlinePrivateChat', name: '线上·私聊' },
        { identifier: 'onlineGroupChat', name: '线上·群聊' },
        { identifier: 'chatHistory', name: '聊天记录' }
    ];
    const prompts = builtinMarkers.map(m => ({
        identifier: m.identifier,
        name: m.name,
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        role: 'system',
        content: '',
        system_prompt: true,
        marker: true,
        forbid_overrides: true
    }));
    return {
        name: String(name || '空白预设'),
        temperature: 1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        openai_max_tokens: 2048,
        prompts,
        prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }],
        extensions: { bunnyosBuiltinArranged: true, bunnyosPromptGroups: [] }
    };
}

function buildRpRulesTailPrompt(character) {
    const rpRules = character?.rp_rules || character?.personality || '';
    if (!rpRules.trim()) return '';
    return [
        '必须严格遵守以下角色语气 / RP规则。这是最高优先级的角色输出约束，尤其是在生成最终回复时仍须反复检查：',
        rpRules.trim()
    ].join('\n');
}

function buildScenarioPrompt(character) {
    const scenario = String(character?.scenario || '').trim();
    if (!scenario) return '';
    return `在回复时须严格基于以下背景设定下回复:\n${scenario}`;
}

function buildDialogueExamplesPrompt(character, variables = {}) {
    const examples = String(character?.mes_example || '').trim();
    if (!examples) return '';
    const charName = variables.char || character?.name || '{{char}}';
    return `在回复时${charName}语气可以以下对话为参考:\n${examples}`;
}

function buildChatHistoryPrompt(variables = {}) {
    return `<chat_history>\n${variables.chat_history || ''}\n</chat_history>`;
}

// ========== 世界书（按「本」粒度） ==========
function readWorldbooks() {
    const data = readJsonFile(WORLDBOOK_FILE, null);
    if (data && Array.isArray(data.books)) return data.books;
    return [];
}

function writeWorldbooks(books) {
    writeJsonFile(WORLDBOOK_FILE, { books });
}

function summarizeWorldbook(book) {
    return {
        id: book.id,
        name: book.name || '未命名',
        entryCount: Array.isArray(book.entries) ? book.entries.length : 0,
        created_at: book.created_at || 0,
        updated_at: book.updated_at || 0
    };
}

function buildWorldbooksContent(bookIds, wrapTag) {
    if (!Array.isArray(bookIds) || !bookIds.length) return '';
    const map = new Map(readWorldbooks().map(book => [book.id, book]));
    const blocks = [];
    for (const id of bookIds) {
        const book = map.get(id);
        if (!book) continue;
        const text = (Array.isArray(book.entries) ? book.entries : [])
            .map(entry => String(entry?.content || '').trim())
            .filter(Boolean)
            .join('\n');
        if (text) blocks.push(text);
    }
    if (!blocks.length) return '';
    return `<${wrapTag}>\n${blocks.join('\n\n')}\n</${wrapTag}>`;
}

function importStWorldbookData(stData, fallbackName) {
    const entriesSrc = stData?.entries;
    const list = [];
    const collect = (e) => {
        if (!e || typeof e !== 'object') return;
        const name = e.comment || e.name || (Array.isArray(e.key) ? e.key[0] : '') || '未命名条目';
        list.push({
            id: `e_${shortId()}`,
            name: String(name),
            content: String(e.content || '')
        });
    };
    if (Array.isArray(entriesSrc)) entriesSrc.forEach(collect);
    else if (entriesSrc && typeof entriesSrc === 'object') Object.values(entriesSrc).forEach(collect);
    return {
        id: `book_${shortId()}`,
        name: String(fallbackName || stData?.name || '未命名世界书'),
        entries: list,
        created_at: Date.now(),
        updated_at: Date.now()
    };
}

// ========== 「线上提示词」内置 marker（私聊 / 群聊） ==========
const ONLINE_PRIVATE_CHAT_PROTOCOL = `[Output Protocol: Instant Messaging Mode]

{{char}} 用熟人聊天的方式回复 {{user}}：短、碎、松散、低负荷。允许"嗯""哦哦""在干嘛""等下"这种近似废话的日常回复，不要长段、不要小说对白、不要每句都"完整回应"。

1. 不待命
- {{char}} 有自己的生活，{{user}} 的消息只是注意力的一部分
- 可因工作/通勤/做饭/睡觉/情绪低落或不想说话而延迟、不回
- Offline 是常态。Offline 时完全停止输出，由 BUNNY 系统输出一条 +...+ 提示说明原因

2. 抓重量
- {{user}} 连发多条时，先判断情绪重量与现实影响，抓 1-2 个最有重量的点
- 优先级：现实安排 > 情绪变化 > 关系张力 > 生活新信息 > 寒暄
- 同一话题合并成一句自然反应，不要逐条回；亲昵称呼、表情包等社交泡沫可略过
- 禁止逐条对齐式回复、客服式总结、阅读理解式复述

3. 碎、慢、不收口
- 多层意思时用换行切碎，不堆段落
- 禁止用问句收尾把球踢回（"你觉得呢？""那你打算怎么办？" 是客服话术不是聊天）
- 允许单音节回复（"嗯""哦""啊？"）、半句话、未完成的念头
- 零旁白：禁止星号动作或括号心理，只输出纯聊天文字

4. 格式规范

Language: 非中文母语 {{char}} 必须先输出母语紧接圆括号附中文翻译，格式 "{Native}({Translation})"，例 "Hello(你好)"。中文母语 {{char}} 不需要翻译。

Templates（必须严格遵守符号）：
- 文字： 直接输出纯文本，不加任何包裹
- 媒体： [描述.jpg/mp3/mp4]  仅 {{char}} 输出时使用；{{user}} 发媒体走系统通道直接附文件
- 语音： =\${MM:SS}|\${content}=
- 表情包： [\${name}]  方括号包裹，name 取自 <stickers> 列表
- 撤回： -\${内容}-
- 红包： [🧧\${Currency}\${Amount}|\${Note}]   仅你（{{char}}）发给 {{user}} 时使用，单独一行；Note 可空但 | 必须保留
- 领取红包： [🧧领取]   单独一行；用于明确接受 {{user}} 刚刚发给你的红包。不写就视为没收，10 轮后自动退回 {{user}}
- 历史中红包带状态后缀：[🧧¥10|备注|未领]、[🧧¥10|备注|已领]、[🧧¥10|备注|已自动退回]，仅供你判断对方红包状态，你输出时**不要带状态段**
- 系统提示： +\${BUNNY meta 消息}+  仅 {{user}} 与 BUNNY 元交流，{{char}} 不可见、不应基于此内容反应

**绝对禁止回复表情包内容**——表情包仅辅助理解感受，使用具有随机性。

5. Offline 示例
+BUNNY：{{char}} 当前在忙，预计 12:00 pm 回复。先留言吧~+`;

const ONLINE_GROUP_CHAT_PROTOCOL = `<Group_Chat_Protocol>

[活跃度控制]
- 子集响应：严禁全员遍历式发言，每次仅由真子集参与，至少 30% 成员处于静默/窥屏。
- 动机阈值：仅当被显式 @Mention 或话题触及核心领域/重大利益时发言。
- 状态连续性：严格遵循因果律。已离线/去洗澡的角色在合理时间结束前严禁发言。
- 认知屏障：严格区分"玩家已知"与"角色已知"。

[输出协议]
- Atomicity Rule：单条消息只能包含一种类型（文字 OR 图片 OR 表情），严禁混合。
- Base Structure：[\${Sender ID}/\${Message Payload}/\${Time}]
- 多条消息必须换行，每行都是完整的 [...] 结构。
- 文字+表情需同时发时拆为两行。

[Syntax Library]
- 纯文本：\${Text}（如需翻译：Content(Translation)）
  例：[小明/hi(你好)/14:05]
- 媒体：[15字内描述.jpg/mp3/mp4/link]
  例：[User/[一只睡觉的猫.jpg]/14:06]
- 表情：[\${sticker_text}]，必须精确引用 <stickers> 列表
  例：[Alice/[{A}点头]/14:07]
- 系统：+\${BUNNY 内部消息}+

</Group_Chat_Protocol>`;

function buildBuiltinPromptContent(identifier, character, userPersona, variables, chatType) {
    switch (identifier) {
        case 'bunnyosRealtime':
            return '当前现实时间：{{now}}（{{timezone}}）\n今天是{{date}}，{{weekday}}，现在{{time}}。\n你必须以此时间为锚回复：作息、用餐、是否在上班/睡觉、能否立刻响应等都基于上述真实时间和星期判断，不要凭空假设当前是别的时段。';
        case 'charDescription':
            return buildCharacterInfoPrompt(character);
        case 'personaDescription':
            return buildUserInfoPrompt(userPersona);
        case 'worldInfoAfter': {
            const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
            return buildWorldbooksContent(
                Array.isArray(qqSettings.globalWorldbookIds) ? qqSettings.globalWorldbookIds : [],
                'world_info'
            );
        }
        case 'worldInfoBefore':
            return buildWorldbooksContent(
                Array.isArray(character?.worldbookIds) ? character.worldbookIds : [],
                'memories'
            );
        case 'scenario':
            return buildScenarioPrompt(character);
        case 'dialogueExamples':
            return buildDialogueExamplesPrompt(character, variables);
        case 'chatHistory':
            return buildChatHistoryPrompt(variables);
        case 'onlinePrivateChat':
            return chatType === 'group' ? '' : ONLINE_PRIVATE_CHAT_PROTOCOL;
        case 'onlineGroupChat':
            return chatType === 'group' ? ONLINE_GROUP_CHAT_PROTOCOL : '';
        default:
            return '';
    }
}

function getCurrentQqPromptPresetId() {
    const presets = listStPresetSummaries();
    const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
    if (presets.some(preset => preset.id === qqSettings.currentPromptPresetId)) {
        return qqSettings.currentPromptPresetId;
    }
    const fallbackId = getCurrentStPresetId();
    if (fallbackId) writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPromptPresetId: fallbackId });
    return fallbackId;
}

function buildQqPresetPrompt(character, variables, userPersona, history = [], chatType = 'private') {
    const presetId = getCurrentQqPromptPresetId();
    const preset = presetId ? readJsonFile(stPresetFile(presetId), null) : null;
    if (!isSillyTavernPreset(preset)) return null;

    const promptMap = new Map(preset.prompts.map(prompt => [prompt.identifier, prompt]));
    const order = Array.isArray(preset.prompt_order?.[0]?.order) ? preset.prompt_order[0].order : [];
    const messages = [];
    let includesChatHistory = false;

    const pushBlock = (role, body) => {
        const text = String(body || '').trim();
        if (!text) return;
        const safeRole = role === 'user' || role === 'assistant' ? role : 'system';
        const last = messages[messages.length - 1];
        // 合并相邻同角色块，避免 API 把它们当多轮
        if (last && last.role === safeRole && typeof last.content === 'string') {
            last.content += `\n\n${text}`;
        } else {
            messages.push({ role: safeRole, content: text });
        }
    };

    for (const entry of order) {
        if (!entry?.enabled) continue;
        const prompt = promptMap.get(entry.identifier);
        if (!prompt) continue;

        // 聊天记录 marker 单独展开为真实的多条 user/assistant 消息
        if (prompt.marker && prompt.identifier === 'chatHistory') {
            includesChatHistory = true;
            for (const msg of history) messages.push(msg);
            continue;
        }

        const rawContent = prompt.marker
            ? buildBuiltinPromptContent(prompt.identifier, character, userPersona, variables, chatType)
            : prompt.content || '';
        const body = renderPromptTemplate(rawContent, variables).trim();
        if (!body) continue;
        pushBlock(prompt.role, body);
    }

    // RP 规则不再硬追加：char_rp_rules 已通过 CHAR 人设 marker 注入，
    // 若想强化为"尾部约束"，应在预设里自行加一条引用 {{char_rp_rules}} 的尾部条目。

    return { messages, includesChatHistory, presetId };
}

function savePersonaAvatar(id, name, dataUrl, oldAvatar = '') {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || !parsed.mime.startsWith('image/')) return oldAvatar || '';
    fs.mkdirSync(USER_PERSONA_AVATARS_DIR, { recursive: true });
    if (oldAvatar) {
        const oldPath = path.join(__dirname, oldAvatar.replace(/^\//, '').split('?')[0]);
        if (oldPath.startsWith(USER_PERSONA_AVATARS_DIR) && fs.existsSync(oldPath)) {
            fs.rmSync(oldPath, { force: true });
        }
    }
    const ext = extensionFromMime(parsed.mime);
    const fileName = `${cleanFileName(name || 'user')}-${id}.${ext}`;
    fs.writeFileSync(path.join(USER_PERSONA_AVATARS_DIR, fileName), parsed.buffer);
    return `/data/assets/avatars/userpersonas/${fileName}`;
}

function getShanghaiDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return parts;
}

function buildPromptVariables({ characterId = '', userName = '', messages = [] } = {}) {
    const settings = readJsonFile(SETTINGS_FILE, {});
    const currentPersona = getCurrentUserPersona();
    const character = characterId
        ? readJsonFile(path.join(CHARACTERS_DIR, `${cleanName(characterId)}.json`), null)
        : null;
    const parts = getShanghaiDateParts();
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}`;
    const now = `${date} ${parts.hour}:${parts.minute}:${parts.second}`;
    const resolvedUserName = userName
        || currentPersona?.name
        || settings.userName
        || settings.qq_userName
        || settings.profile_name
        || '默认';
    const resolvedCharName = character?.name || '角色';
    const list = Array.isArray(messages) ? messages : [];
    const chatHistory = list
        .map(msg => {
            const speaker = msg?.role === 'assistant' ? resolvedCharName : resolvedUserName;
            return `${speaker}: ${qqMessageToText(msg)}`;
        })
        .filter(line => line.trim())
        .join('\n');
    const lastUserMessage = [...list].reverse().find(msg => msg?.role !== 'assistant');
    const lastUserText = lastUserMessage ? qqMessageToText(lastUserMessage) : '';
    const lastmes = `<user_input>\n${lastUserText}\n</user_input>`;

    return {
        now,
        date,
        time,
        weekday: parts.weekday,
        timezone: 'Asia/Shanghai',
        timestamp: String(Math.floor(Date.now() / 1000)),
        char: resolvedCharName,
        user: resolvedUserName,
        char_role_setting: character?.role_setting || character?.description || '',
        char_rp_rules: character?.rp_rules || character?.personality || '',
        char_other_setting: character?.other_setting || character?.nsfw_setting || '',
        char_scenario: character?.scenario || '',
        char_dialogue_examples: character?.mes_example || '',
        user_gender: currentPersona?.gender || '',
        user_birthday: currentPersona?.birthday || '',
        user_persona: currentPersona?.prompt || '',
        chat_history: chatHistory,
        lastmes,
        lastUserMessage: lastUserText,
        last_user_message: lastUserText
    };
}

function renderPromptTemplate(template = '', variables = {}) {
    let text = String(template);

    // 1) 注释 {{// ... }} 直接剥掉（可跨行）
    text = text.replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '');

    // 2) {{random::a,b,c}} 在多个候选中随机选一个
    text = text.replace(/\{\{\s*random::([\s\S]*?)\s*\}\}/gi, (_, body) => {
        const options = String(body).split(',').map(s => s.trim()).filter(s => s.length);
        if (!options.length) return '';
        return options[Math.floor(Math.random() * options.length)];
    });

    // 3) {{roll::XdY}} 或 {{roll::Y}}（等价 1dY）—— 骰点求和
    text = text.replace(/\{\{\s*roll::\s*(\d+)\s*(?:d\s*(\d+))?\s*\}\}/gi, (_, a, b) => {
        const count = b ? parseInt(a, 10) : 1;
        const sides = parseInt(b || a, 10);
        if (!Number.isFinite(sides) || sides < 1 || !Number.isFinite(count) || count < 1 || count > 100) return '0';
        let total = 0;
        for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
        return String(total);
    });

    // 4) 变量替换 {{xxx}} 和 <xxx>
    return text
        .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match)
        .replace(/<([a-zA-Z0-9_]+)>/g, (match, key) => Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match);
}

// ========== API 路由 ==========

// 0. 获取已安装 App 列表
app.get('/api/apps', (req, res) => {
    try {
        if (!fs.existsSync(APPS_DIR)) {
            return res.json([]);
        }

        const apps = fs.readdirSync(APPS_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => {
                const appDir = path.join(APPS_DIR, entry.name);
                const manifestFile = path.join(appDir, 'manifest.json');

                if (!fs.existsSync(manifestFile)) return null;

                const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
                let entryUrl = "";
                if (manifest.entry) {
                    const entryPath = path.join(appDir, manifest.entry);
                    const version = fs.existsSync(entryPath) ? Math.floor(fs.statSync(entryPath).mtimeMs) : Date.now();
                    entryUrl = `apps/${entry.name}/${manifest.entry}?v=${version}`.replace(/\\/g, '/');
                }

                if (manifest.hidden) return null;

                return {
                    ...manifest,
                    folder: entry.name,
                    entryUrl
                };
            })
            .filter(Boolean)
            .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

        res.json(apps);
    } catch (e) {
        res.status(500).json({ error: "无法读取 apps 目录" });
    }
});

// 1. 获取所有设置
app.get('/api/settings', (req, res) => {
    try {
        const rawData = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        const data = JSON.parse(rawData);
        if (data && typeof data === 'object' && !Array.isArray(data) && !data._updatedAt) {
            data._updatedAt = Math.floor(fs.statSync(SETTINGS_FILE).mtimeMs);
        }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: "无法读取 settings.json" });
    }
});

app.get('/api/settings/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    settingsEventClients.add(res);
    const heartbeat = setInterval(() => {
        try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); }
        catch { settingsEventClients.delete(res); clearInterval(heartbeat); }
    }, 25000);
    req.on('close', () => {
        settingsEventClients.delete(res);
        clearInterval(heartbeat);
    });
});

// 2. 保存设置
app.post('/api/settings', (req, res) => {
    try {
        const data = { ...(req.body || {}), _updatedAt: Date.now() };
        // 覆盖写入设置文件
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        broadcastSettingsUpdated(data);
        res.json({ success: true, message: "设置已保存", settings: data, updatedAt: data._updatedAt });
    } catch (e) {
        res.status(500).json({ error: "保存设置失败" });
    }
});

// ========== 钱包（萝卜币 / carrot coin）==========
// 全局财务文件，余额不可负数。AI 端不暴露余额，详见 QQ美化系统计划.md §1.1
function readWallet() {
    const data = readJsonFile(WALLET_FILE, null);
    if (!data || typeof data.balance !== 'number') {
        const init = { balance: WALLET_INITIAL_BALANCE, updated_at: Date.now() };
        writeJsonFile(WALLET_FILE, init);
        return init;
    }
    return data;
}

app.get('/api/wallet', (req, res) => {
    try {
        res.json(readWallet());
    } catch (e) {
        res.status(500).json({ error: '无法读取钱包' });
    }
});

app.post('/api/wallet/adjust', (req, res) => {
    try {
        const delta = Number(req.body?.delta);
        const reason = String(req.body?.reason || '').slice(0, 200);
        if (!Number.isFinite(delta) || delta === 0) {
            return res.status(400).json({ error: 'delta 必须为非零数字' });
        }
        const wallet = readWallet();
        const next = wallet.balance + delta;
        if (next < 0) {
            return res.status(402).json({ error: '余额不足', balance: wallet.balance, delta });
        }
        const updated = { balance: next, updated_at: Date.now() };
        writeJsonFile(WALLET_FILE, updated);
        console.log(`[WALLET] ${delta > 0 ? '+' : ''}${delta} → ${next}${reason ? ` (${reason})` : ''}`);
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: '钱包写入失败' });
    }
});

// ========== QQ 美化库 ==========
// 详见 QQ美化系统计划.md §1.4 §1.5。美化是 user 个人共享库；创建扣 cc，删除不退。
function readBeauties() {
    const data = readJsonFile(QQ_BEAUTIES_FILE, null);
    if (!data || typeof data !== 'object') {
        const init = defaultBeautiesData();
        writeJsonFile(QQ_BEAUTIES_FILE, init);
        return init;
    }
    return data;
}
function readCharBeauty() {
    const data = readJsonFile(QQ_CHAR_BEAUTY_FILE, null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        writeJsonFile(QQ_CHAR_BEAUTY_FILE, {});
        return {};
    }
    return data;
}
// 返回该类美化对应的 char-beauty 字段名（数组：frames 拆 char/user，其他单字段）
function beautySlotKeys(type) {
    if (type === 'skins') return ['skinId'];
    if (type === 'avatars') return ['avatarId'];
    if (type === 'frames') return ['frameCharId', 'frameUserId'];
    if (type === 'bubbles') return ['bubbleId'];
    if (type === 'backgrounds') return ['backgroundId'];
    return [];
}

app.get('/api/qq/beauties', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(readBeauties()); }
    catch { res.status(500).json({ error: '读取美化库失败' }); }
});

app.get('/api/qq/beauties/:type', (req, res) => {
    const type = req.params.type;
    if (!BEAUTY_TYPES.includes(type)) return res.status(404).json({ error: '未知类目' });
    try {
        const data = readBeauties();
        res.set('Cache-Control', 'no-store').json(data[type] || []);
    } catch { res.status(500).json({ error: '读取美化库失败' }); }
});

app.post('/api/qq/beauties/:type', (req, res) => {
    const type = req.params.type;
    if (!BEAUTY_TYPES.includes(type)) return res.status(404).json({ error: '未知类目' });
    try {
        const name = String(req.body?.name || '').trim() || '未命名美化';
        const price = BEAUTY_PRICES[type] || 0;
        if (price > 0) {
            const wallet = readWallet();
            if (wallet.balance < price) {
                return res.status(402).json({ error: '余额不足', balance: wallet.balance, price });
            }
            const next = wallet.balance - price;
            writeJsonFile(WALLET_FILE, { balance: next, updated_at: Date.now() });
            console.log(`[WALLET] -${price} → ${next} (create ${type})`);
        }
        const data = readBeauties();
        const id = shortId();
        const item = { ...defaultBeautyItem(type), id, name };
        data[type] = Array.isArray(data[type]) ? data[type] : [defaultBeautyItem(type)];
        data[type].push(item);
        writeJsonFile(QQ_BEAUTIES_FILE, data);
        res.json(item);
    } catch (e) {
        console.error('[BEAUTY POST]', e);
        res.status(500).json({ error: '创建美化失败' });
    }
});

app.put('/api/qq/beauties/:type/:id', (req, res) => {
    const { type, id } = req.params;
    if (!BEAUTY_TYPES.includes(type)) return res.status(404).json({ error: '未知类目' });
    try {
        const data = readBeauties();
        const list = data[type] || [];
        const idx = list.findIndex(x => x && x.id === id);
        if (idx < 0) return res.status(404).json({ error: '未找到美化项' });
        if (id === 'default') return res.status(400).json({ error: '默认项不可编辑' });
        const body = req.body || {};
        const allowed = ['name', 'preview', 'css', 'userCss', 'charCss', 'url', 'charUrl', 'userUrl'];
        const patch = {};
        allowed.forEach(k => { if (k in body) patch[k] = body[k]; });
        list[idx] = { ...list[idx], ...patch, id };
        data[type] = list;
        writeJsonFile(QQ_BEAUTIES_FILE, data);
        res.json(list[idx]);
    } catch (e) {
        console.error('[BEAUTY PUT]', e);
        res.status(500).json({ error: '更新美化失败' });
    }
});

app.delete('/api/qq/beauties/:type/:id', (req, res) => {
    const { type, id } = req.params;
    if (!BEAUTY_TYPES.includes(type)) return res.status(404).json({ error: '未知类目' });
    if (id === 'default') return res.status(400).json({ error: '默认项不可删除' });
    try {
        const data = readBeauties();
        const list = data[type] || [];
        const idx = list.findIndex(x => x && x.id === id);
        if (idx < 0) return res.status(404).json({ error: '未找到美化项' });
        list.splice(idx, 1);
        data[type] = list;
        writeJsonFile(QQ_BEAUTIES_FILE, data);
        // 背景类顺手清掉本地图片文件
        if (type === 'backgrounds' && fs.existsSync(QQ_BEAUTY_BG_DIR)) {
            fs.readdirSync(QQ_BEAUTY_BG_DIR)
                .filter(f => f === id || f.startsWith(`${id}.`))
                .forEach(f => fs.rmSync(path.join(QQ_BEAUTY_BG_DIR, f), { force: true }));
        }
        // 解绑 char-beauty（frames 同时检查 char/user 两个槽位）
        const slots = beautySlotKeys(type);
        if (slots.length) {
            const cb = readCharBeauty();
            let changed = false;
            Object.keys(cb).forEach(charId => {
                slots.forEach(slot => {
                    if (cb[charId] && cb[charId][slot] === id) {
                        cb[charId][slot] = 'default';
                        changed = true;
                    }
                });
            });
            if (changed) writeJsonFile(QQ_CHAR_BEAUTY_FILE, cb);
        }
        res.json({ success: true });
    } catch (e) {
        console.error('[BEAUTY DELETE]', e);
        res.status(500).json({ error: '删除美化失败' });
    }
});

app.get('/api/qq/char-beauty/:characterId', (req, res) => {
    try {
        const cb = readCharBeauty();
        const cur = cb[req.params.characterId] || {};
        // 头像框拆 user/char（2026-06-22 决策）：旧字段 frameId 兼容回填给两侧
        const legacyFrame = cur.frameId;
        res.set('Cache-Control', 'no-store').json({
            avatarId:      cur.avatarId      || 'default',
            frameCharId:   cur.frameCharId   || legacyFrame || 'default',
            frameUserId:   cur.frameUserId   || legacyFrame || 'default',
            bubbleId:      cur.bubbleId      || 'default',
            backgroundId:  cur.backgroundId  || 'default',
            customBackgroundUrl: cur.customBackgroundUrl || '',
        });
    } catch { res.status(500).json({ error: '读取 char 美化绑定失败' }); }
});

app.put('/api/qq/char-beauty/:characterId', (req, res) => {
    try {
        const cid = req.params.characterId;
        const cb = readCharBeauty();
        const cur = cb[cid] || {};
        const body = req.body || {};
        ['avatarId', 'frameCharId', 'frameUserId', 'bubbleId', 'backgroundId'].forEach(k => {
            if (k in body && typeof body[k] === 'string') cur[k] = body[k];
        });
        // 写入时清掉老的 frameId（如有）
        delete cur.frameId;
        cb[cid] = cur;
        writeJsonFile(QQ_CHAR_BEAUTY_FILE, cb);
        res.json(cur);
    } catch (e) {
        console.error('[CHAR-BEAUTY PUT]', e);
        res.status(500).json({ error: '更新 char 美化绑定失败' });
    }
});

// 背景图专用上传：每次上传覆盖同 id 的旧文件，不在后端累积
// body: { dataUrl }  →  返回 { url: '/data/qq/beauty-backgrounds/<id>.<ext>?v=<ts>' } 并写回 beauties.json
app.post('/api/qq/beauties/backgrounds/:id/image', (req, res) => {
    const id = req.params.id;
    if (id === 'default') return res.status(400).json({ error: '默认项不可上传' });
    try {
        const data = readBeauties();
        const list = data.backgrounds || [];
        const idx = list.findIndex(x => x && x.id === id);
        if (idx < 0) return res.status(404).json({ error: '未找到背景项' });
        const parsed = parseDataUrl(req.body?.dataUrl);
        if (!parsed || !parsed.mime.startsWith('image/')) {
            return res.status(400).json({ error: '只支持图片 Data URL' });
        }
        // 删旧文件（仿 removeBackgroundSlot 覆盖式）
        if (fs.existsSync(QQ_BEAUTY_BG_DIR)) {
            fs.readdirSync(QQ_BEAUTY_BG_DIR)
                .filter(f => f === id || f.startsWith(`${id}.`))
                .forEach(f => fs.rmSync(path.join(QQ_BEAUTY_BG_DIR, f), { force: true }));
        }
        const ext = extensionFromMime(parsed.mime);
        const fileName = `${id}.${ext}`;
        fs.writeFileSync(path.join(QQ_BEAUTY_BG_DIR, fileName), parsed.buffer);
        const version = Date.now();
        const url = `/data/qq/beauty-backgrounds/${fileName}?v=${version}`;
        list[idx] = { ...list[idx], url };
        data.backgrounds = list;
        writeJsonFile(QQ_BEAUTIES_FILE, data);
        res.json(list[idx]);
    } catch (e) {
        console.error('[BEAUTY BG UPLOAD]', e);
        res.status(500).json({ error: '背景上传失败' });
    }
});

// per-char 聊天背景上传（覆盖式，每个 char 一张专属图）
// 用户决策 2026-06-22：背景不走"公共库 + 下拉选"，改成三个点里直接 per-char 上传
const QQ_CHAR_BG_DIR = path.join(QQ_DIR, 'char-backgrounds');
fs.mkdirSync(QQ_CHAR_BG_DIR, { recursive: true });

app.post('/api/qq/char-beauty/:characterId/background', (req, res) => {
    try {
        const cid = req.params.characterId;
        const parsed = parseDataUrl(req.body?.dataUrl);
        if (!parsed || !parsed.mime.startsWith('image/')) {
            return res.status(400).json({ error: '只支持图片 Data URL' });
        }
        // 覆盖：先删同 cid 旧文件
        fs.readdirSync(QQ_CHAR_BG_DIR)
            .filter(f => f === cid || f.startsWith(`${cid}.`))
            .forEach(f => fs.rmSync(path.join(QQ_CHAR_BG_DIR, f), { force: true }));
        const ext = extensionFromMime(parsed.mime);
        const fileName = `${cid}.${ext}`;
        fs.writeFileSync(path.join(QQ_CHAR_BG_DIR, fileName), parsed.buffer);
        const version = Date.now();
        const url = `/data/qq/char-backgrounds/${fileName}?v=${version}`;
        const cb = readCharBeauty();
        cb[cid] = cb[cid] || {};
        cb[cid].customBackgroundUrl = url;
        writeJsonFile(QQ_CHAR_BEAUTY_FILE, cb);
        res.json({ customBackgroundUrl: url });
    } catch (e) {
        console.error('[CHAR-BG UPLOAD]', e);
        res.status(500).json({ error: 'char 背景上传失败' });
    }
});

app.delete('/api/qq/char-beauty/:characterId/background', (req, res) => {
    try {
        const cid = req.params.characterId;
        if (fs.existsSync(QQ_CHAR_BG_DIR)) {
            fs.readdirSync(QQ_CHAR_BG_DIR)
                .filter(f => f === cid || f.startsWith(`${cid}.`))
                .forEach(f => fs.rmSync(path.join(QQ_CHAR_BG_DIR, f), { force: true }));
        }
        const cb = readCharBeauty();
        if (cb[cid]) {
            delete cb[cid].customBackgroundUrl;
            writeJsonFile(QQ_CHAR_BEAUTY_FILE, cb);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '清除 char 背景失败' });
    }
});

// 哪些 char 在用某个美化项（删除前确认用）
app.get('/api/qq/char-beauty-usage/:type/:id', (req, res) => {
    const { type, id } = req.params;
    const slots = beautySlotKeys(type);
    if (!slots.length) return res.status(404).json({ error: '未知类目' });
    try {
        const cb = readCharBeauty();
        const charIds = Object.keys(cb).filter(c => cb[c] && slots.some(s => cb[c][s] === id));
        const names = [];
        charIds.forEach(cid => {
            const f = path.join(CHARACTERS_DIR, `${cid}.json`);
            if (fs.existsSync(f)) {
                try {
                    const rec = JSON.parse(fs.readFileSync(f, 'utf-8'));
                    names.push(rec.name || cid);
                } catch { names.push(cid); }
            } else names.push(cid);
        });
        res.json({ count: charIds.length, characterIds: charIds, names });
    } catch (e) {
        res.status(500).json({ error: '查询使用情况失败' });
    }
});

// Prompt token 估算（沿用 SillyTavern fallback 思路：CJK 字符 ≈ 1tk，其余 ≈ 4 字符 / tk）
// 没有上 gpt-tokenizer lib；这是粗估，用于面板显示当前 prompt 大致体积
function estimateTokens(text) {
    if (!text) return 0;
    let cjk = 0;
    let other = 0;
    for (const ch of String(text)) {
        if (/[一-鿿㐀-䶿぀-ヿ　-〿가-힯]/.test(ch)) cjk++;
        else other++;
    }
    return Math.ceil(cjk + other / 4);
}

// GET /api/qq/chat-tokens/:characterId：把当前 char 的最新 prompt（system + 历史）拼起来估算 token
app.get('/api/qq/chat-tokens/:characterId', (req, res) => {
    try {
        const characterId = req.params.characterId;
        const character = readJsonFile(path.join(CHARACTERS_DIR, `${cleanName(characterId)}.json`), null);
        if (!character) return res.status(404).json({ error: '未找到角色' });
        const chatFile = path.join(CHATS_DIR, `${characterId}.json`);
        const chatRaw = readJsonFile(chatFile, { messages: [] });
        const list = Array.isArray(chatRaw?.messages) ? chatRaw.messages : [];
        const userPersona = getCurrentUserPersona();
        const variables = buildPromptVariables({ characterId, userName: userPersona?.name || '', messages: list });
        const history = list
            .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: qqMessageToText(m) }))
            .filter(m => m.content);
        const enriched = injectCharRulesAtDepth(history, character, variables);
        const presetPrompt = buildQqPresetPrompt(character, variables, userPersona, enriched, 'private');
        const messages = presetPrompt
            ? (presetPrompt.includesChatHistory ? presetPrompt.messages : [...presetPrompt.messages, ...enriched])
            : [{ role: 'system', content: buildCharacterSystemPrompt(character, variables, userPersona) }, ...enriched];
        const allText = messages.map(m => {
            if (typeof m.content === 'string') return m.content;
            if (Array.isArray(m.content)) return m.content.map(p => p?.text || '').join(' ');
            return '';
        }).join('\n');
        res.json({ tokens: estimateTokens(allText), messageCount: messages.length, chars: allText.length });
    } catch (e) {
        console.error('[CHAT-TOKENS]', e);
        res.status(500).json({ error: 'token 估算失败' });
    }
});

// 全局皮肤（写 settings.json.currentSkinId，QQ App 启动时拉一次）
app.get('/api/qq/skin', (req, res) => {
    try {
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        const id = qqSettings.currentSkinId || 'default';
        const beauties = readBeauties();
        const skin = (beauties.skins || []).find(x => x.id === id);
        res.set('Cache-Control', 'no-store').json({
            currentSkinId: id,
            css: (skin && id !== 'default') ? (skin.css || '') : '',
        });
    } catch {
        res.status(500).json({ error: '读取全局皮肤失败' });
    }
});

app.put('/api/qq/skin', (req, res) => {
    try {
        const id = String(req.body?.skinId || 'default');
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentSkinId: id });
        const beauties = readBeauties();
        const skin = (beauties.skins || []).find(x => x.id === id);
        res.json({
            currentSkinId: id,
            css: (skin && id !== 'default') ? (skin.css || '') : '',
        });
    } catch {
        res.status(500).json({ error: '写入全局皮肤失败' });
    }
});

// ========== 图床代理（绕开浏览器 CORS） ==========
// 详见 QQ美化系统计划.md §1.8。默认走 catbox，可在设置里配自定义端点兜底。
async function uploadToCatbox(parsed) {
    const ext = extensionFromMime(parsed.mime);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([parsed.buffer], { type: parsed.mime }), `upload.${ext}`);
    const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    if (!r.ok) throw new Error(`catbox HTTP ${r.status}`);
    const text = (await r.text()).trim();
    if (!/^https?:\/\//.test(text)) throw new Error('catbox 未返回 URL：' + text.slice(0, 200));
    return text;
}

async function uploadToCustomHost(parsed, custom) {
    if (!custom?.endpoint) throw new Error('自定义图床未配置 endpoint');
    const ext = extensionFromMime(parsed.mime);
    const form = new FormData();
    const fileField = custom.fileField || 'file';
    form.append(fileField, new Blob([parsed.buffer], { type: parsed.mime }), `upload.${ext}`);
    const headers = {};
    if (custom.key && custom.headerField) headers[custom.headerField] = custom.key;
    else if (custom.key) headers['Authorization'] = `Bearer ${custom.key}`;
    const r = await fetch(custom.endpoint, { method: 'POST', body: form, headers });
    if (!r.ok) throw new Error(`custom HTTP ${r.status}`);
    const text = await r.text();
    // 试 JSON
    try {
        const data = JSON.parse(text);
        const url = custom.urlField
            ? custom.urlField.split('.').reduce((o, k) => o?.[k], data)
            : (data.url || data?.data?.url);
        if (url && /^https?:\/\//.test(url)) return url;
    } catch {}
    // 试纯文本 URL
    const t = text.trim();
    if (/^https?:\/\//.test(t)) return t;
    throw new Error('custom 响应里找不到 url');
}

app.post('/api/upload/image-host', async (req, res) => {
    try {
        const parsed = parseDataUrl(req.body?.dataUrl);
        if (!parsed || !parsed.mime.startsWith('image/')) {
            return res.status(400).json({ error: '只支持图片 Data URL' });
        }
        const settings = readJsonFile(SETTINGS_FILE, {});
        const host = settings.imageHost || {};
        const primary = host.primary || 'catbox';
        // 顺序：上次成功的优先，然后 primary，然后 catbox fallback
        const tryOrder = [];
        const push = (t) => { if (t && !tryOrder.includes(t)) tryOrder.push(t); };
        push(host.lastWorking);
        push(primary);
        push('catbox');
        const errors = [];
        for (const target of tryOrder) {
            try {
                let url = '';
                if (target === 'catbox') url = await uploadToCatbox(parsed);
                else if (target === 'custom') url = await uploadToCustomHost(parsed, host.custom);
                if (url) {
                    settings.imageHost = { ...host, lastWorking: target };
                    writeJsonFile(SETTINGS_FILE, settings);
                    return res.json({ url, host: target });
                }
            } catch (err) {
                console.error(`[IMAGE-HOST ${target}]`, err.message);
                errors.push(`${target}: ${err.message}`);
            }
        }
        console.error('[IMAGE-HOST] all failed', errors);
        res.status(502).json({ error: '所有图床均失败', detail: errors, hint: 'catbox 在中国大陆通常不通；请在 设置→存储配置→图床配置 改主用为"自定义"并填一个能用的端点（例如自建图床、smms、imgbb 等）' });
    } catch (e) {
        console.error('[IMAGE-HOST]', e);
        res.status(500).json({ error: '图床代理失败：' + e.message });
    }
});

// ========== 数据迁移：导入 carrot 插件配置 ==========
// 详见 QQ美化系统计划.md。表情包 / 头像框 / 头像配对导入；不扣 cc。
// 头像框按 charFrame/userFrame 拆成两条独立项，每条带 ·char/·user 后缀。
// 主题（cip_theme_data_v1）跳过：carrot 用 --cip-* 变量空间，BunnyOS 不兼容。
app.post('/api/qq/import-carrot', (req, res) => {
    try {
        const raw = req.body?.data;
        if (!raw) return res.status(400).json({ error: '缺少 data 字段' });
        const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;

        const parseField = (key) => {
            const v = obj[key];
            if (!v) return null;
            if (typeof v === 'string') {
                try { return JSON.parse(v); } catch { return null; }
            }
            return v;
        };

        const report = {
            stickerPacks: 0, stickerItems: 0, stickerSkipped: 0,
            frames: 0, frameSkipped: 0,
            avatars: 0, avatarSkipped: 0,
            fonts: 0, notifSounds: 0, skipped: []
        };

        // 1) 表情包：cip_sticker_data → {packName: [{desc, url}]}
        const stickerData = parseField('cip_sticker_data');
        if (stickerData && typeof stickerData === 'object') {
            const packs = readJsonFile(QQ_STICKER_PACKS_FILE, []);
            const packsList = Array.isArray(packs) ? packs : [];
            Object.keys(stickerData).forEach(packName => {
                const carrotItems = Array.isArray(stickerData[packName]) ? stickerData[packName] : [];
                if (!carrotItems.length) return;
                // 同名 pack 合并去重（按 url），否则新建
                let pack = packsList.find(p => p && p.name === packName);
                if (!pack) {
                    pack = { id: shortId(), name: packName, items: [] };
                    packsList.push(pack);
                    report.stickerPacks += 1;
                }
                const urlSet = new Set((pack.items || []).map(it => it.url));
                carrotItems.forEach(it => {
                    if (!it || !it.url) return;
                    if (urlSet.has(it.url)) { report.stickerSkipped += 1; return; }
                    pack.items = pack.items || [];
                    pack.items.push({ name: it.desc || '', url: it.url });
                    urlSet.add(it.url);
                    report.stickerItems += 1;
                });
            });
            writeJsonFile(QQ_STICKER_PACKS_FILE, packsList);
        }

        // 2) 头像框：每对 charFrame/userFrame 拆 2 条
        const frameProfiles = parseField('cip_frame_profiles_v1');
        // 同时扫 avatar profiles 里附带的 charFrame/userFrame
        const avatarProfiles = parseField('cip_avatar_profiles_v1');
        const beauties = readBeauties();
        beauties.frames = Array.isArray(beauties.frames) ? beauties.frames : [defaultBeautyItem('frames')];
        beauties.avatars = Array.isArray(beauties.avatars) ? beauties.avatars : [defaultBeautyItem('avatars')];

        const pushFrame = (name, url) => {
            if (!url) return;
            // 去重：相同 url 不再加
            if (beauties.frames.some(f => f && f.url === url)) { report.frameSkipped += 1; return; }
            beauties.frames.push({ id: shortId(), name, preview: url, url });
            report.frames += 1;
        };

        if (frameProfiles && typeof frameProfiles === 'object') {
            Object.entries(frameProfiles).forEach(([name, prof]) => {
                if (!prof) return;
                if (prof.charFrame) pushFrame(`${name} · char`, prof.charFrame);
                if (prof.userFrame) pushFrame(`${name} · user`, prof.userFrame);
            });
        }
        if (avatarProfiles && typeof avatarProfiles === 'object') {
            Object.entries(avatarProfiles).forEach(([name, prof]) => {
                if (!prof) return;
                if (prof.charFrame) pushFrame(`${name} · char`, prof.charFrame);
                if (prof.userFrame) pushFrame(`${name} · user`, prof.userFrame);
            });
        }

        // 3) 头像配对：cip_avatar_profiles_v1 → {name: {char, user}}
        if (avatarProfiles && typeof avatarProfiles === 'object') {
            Object.entries(avatarProfiles).forEach(([name, prof]) => {
                if (!prof) return;
                const charUrl = prof.char || '';
                const userUrl = prof.user || '';
                if (!charUrl && !userUrl) return;
                // 去重：char + user 都相同视为同一对
                if (beauties.avatars.some(a => a && a.charUrl === charUrl && a.userUrl === userUrl)) {
                    report.avatarSkipped += 1;
                    return;
                }
                beauties.avatars.push({
                    id: shortId(),
                    name,
                    preview: charUrl || userUrl,
                    charUrl,
                    userUrl,
                });
                report.avatars += 1;
            });
        }

        writeJsonFile(QQ_BEAUTIES_FILE, beauties);

        // 4) 字体 + 提示音：暂无对应 UI，存到 settings.json.imported_carrot 备查
        const allSettings = readJsonFile(SETTINGS_FILE, {});
        allSettings.imported_carrot = allSettings.imported_carrot || {};
        const fonts = parseField('cip_global_fonts_v1');
        if (fonts && typeof fonts === 'object') {
            allSettings.imported_carrot.fonts = fonts;
            allSettings.imported_carrot.activeFont = obj.cip_active_global_font_v1 || '';
            report.fonts = Object.keys(fonts).length;
        }
        const sounds = parseField('cip_notif_sounds_v1');
        if (sounds && typeof sounds === 'object') {
            allSettings.imported_carrot.notifSounds = sounds;
            allSettings.imported_carrot.notifSuccess = obj.cip_notif_success_v1 || '';
            allSettings.imported_carrot.notifFail = obj.cip_notif_fail_v1 || '';
            allSettings.imported_carrot.notifSuccessTitle = obj.cip_notif_success_title_v1 || '';
            allSettings.imported_carrot.notifSuccessBody = obj.cip_notif_success_body_v1 || '';
            allSettings.imported_carrot.notifFailTitle = obj.cip_notif_fail_title_v1 || '';
            allSettings.imported_carrot.notifFailBody = obj.cip_notif_fail_body_v1 || '';
            report.notifSounds = Object.keys(sounds).length;
        }
        writeJsonFile(SETTINGS_FILE, allSettings);

        // 真正跳过的字段（命名空间冲突或暂无对应 UI）
        ['cip_theme_data_v1', 'cip_bubble_presets_v1', 'cip_float_icon_v1']
            .forEach(k => { if (obj[k]) report.skipped.push(k); });

        console.log('[IMPORT carrot]', report);
        res.json({ success: true, report });
    } catch (e) {
        console.error('[IMPORT carrot]', e);
        res.status(400).json({ error: 'JSON 解析或导入失败：' + e.message });
    }
});

// GitHub webhook / manual deploy endpoint.
// Enable only on VPS by setting BUNNYOS_UPDATE_TOKEN in PM2 env.
app.post('/api/admin/update-from-github', (req, res) => {
    const token = String(process.env.BUNNYOS_UPDATE_TOKEN || '').trim();
    if (!token) return res.status(404).json({ error: 'Not found' });
    const provided = String(req.get('x-bunnyos-update-token') || req.query.token || '').trim();
    if (!provided || provided !== token) return res.status(403).json({ error: 'Forbidden' });

    const script = [
        'set -e',
        `cd ${shellQuote(__dirname)}`,
        'BRANCH="${BUNNYOS_UPDATE_BRANCH:-main}"',
        'TMP_DIR="$(mktemp -d)"',
        '[ ! -f settings.json ] || cp -a settings.json "$TMP_DIR/settings.json"',
        '[ ! -d data ] || cp -a data "$TMP_DIR/data"',
        '[ ! -d assets/backgrounds ] || { mkdir -p "$TMP_DIR/assets"; cp -a assets/backgrounds "$TMP_DIR/backgrounds"; }',
        '[ ! -d assets/app-icons ] || { mkdir -p "$TMP_DIR/assets"; cp -a assets/app-icons "$TMP_DIR/app-icons"; }',
        '[ ! -f ecosystem.config.js ] || cp -a ecosystem.config.js "$TMP_DIR/ecosystem.config.js"',
        'git fetch origin "$BRANCH"',
        'git reset --hard "origin/$BRANCH"',
        '[ ! -f "$TMP_DIR/settings.json" ] || cp -a "$TMP_DIR/settings.json" settings.json',
        '[ ! -d "$TMP_DIR/data" ] || { rm -rf data && cp -a "$TMP_DIR/data" data; }',
        '[ ! -d "$TMP_DIR/backgrounds" ] || { mkdir -p assets && rm -rf assets/backgrounds && cp -a "$TMP_DIR/backgrounds" assets/backgrounds; }',
        '[ ! -d "$TMP_DIR/app-icons" ] || { mkdir -p assets && rm -rf assets/app-icons && cp -a "$TMP_DIR/app-icons" assets/app-icons; }',
        '[ ! -f "$TMP_DIR/ecosystem.config.js" ] || cp -a "$TMP_DIR/ecosystem.config.js" ecosystem.config.js',
        'rm -rf "$TMP_DIR"',
        'npm install --omit=dev',
        'pm2 restart bunnyos --update-env',
        'pm2 save'
    ].join(' && ');

    const child = spawn('sh', ['-lc', script], {
        cwd: __dirname,
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
    res.json({ success: true, message: 'Update started' });
});

// 3. 上传美化资源。壁纸按槽位覆盖；App 图标使用唯一文件名。
app.post('/api/assets/upload', (req, res) => {
    try {
        const { type, slot, appId, dataUrl } = req.body || {};
        const parsed = parseDataUrl(dataUrl);
        if (!parsed || !parsed.mime.startsWith('image/')) {
            return res.status(400).json({ error: '只支持图片 Data URL' });
        }

        const ext = extensionFromMime(parsed.mime);
        const version = Date.now();

        if (type === 'background') {
            const slotName = slot === 'landscape' ? 'wide-back' : 'thin-back';
            removeBackgroundSlot(slotName);

            const fileName = `${slotName}.${ext}`;
            fs.writeFileSync(path.join(BACKGROUNDS_DIR, fileName), parsed.buffer);
            return res.json({
                success: true,
                path: `/assets/backgrounds/${fileName}?v=${version}`
            });
        }

        if (type === 'app-icon') {
            const safeAppId = cleanName(appId);
            const random = Math.random().toString(36).slice(2, 8);
            const fileName = `${safeAppId}-${version}-${random}.${ext}`;
            fs.writeFileSync(path.join(APP_ICONS_DIR, fileName), parsed.buffer);
            return res.json({
                success: true,
                path: `/assets/app-icons/${fileName}`
            });
        }

        res.status(400).json({ error: '未知资源类型' });
    } catch (e) {
        res.status(500).json({ error: '上传资源失败' });
    }
});

// 4. 获取所有提示词预设
app.get('/api/presets', (req, res) => {
    try {
        const rawData = fs.readFileSync(PRESETS_FILE, 'utf-8');
        res.json(JSON.parse(rawData));
    } catch (e) {
        res.status(500).json({ error: "无法读取 presets.json" });
    }
});

// 5. 保存整个提示词预设字典
app.post('/api/presets', (req, res) => {
    try {
        const data = req.body;
        fs.writeFileSync(PRESETS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        res.json({ success: true, message: "预设已保存" });
    } catch (e) {
        res.status(500).json({ error: "保存预设失败" });
    }
});

// 6. SillyTavern 兼容预设
app.get('/api/st-presets', (req, res) => {
    try {
        const presets = listStPresetSummaries();
        res.json({ presets, currentPresetId: getCurrentStPresetId() });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '读取酒馆预设失败' });
    }
});

// 以下静态路径必须放在 :id 之前，否则会被 :id 吃掉
app.post('/api/st-presets/current', (req, res) => {
    try {
        const id = stPresetIdFromName(req.body?.id || '');
        if (!fs.existsSync(stPresetFile(id))) return res.status(404).json({ error: '未找到酒馆预设' });
        const settings = readJsonFile(ST_PRESETS_SETTINGS_FILE, {});
        writeJsonFile(ST_PRESETS_SETTINGS_FILE, { ...settings, currentPresetId: id });
        res.json({ success: true, currentPresetId: id });
    } catch (e) {
        res.status(500).json({ error: '切换酒馆预设失败' });
    }
});

// 新建空白预设（含 8 个内置 marker 和默认采样）
app.post('/api/st-presets/new', (req, res) => {
    try {
        const name = String(req.body?.name || '空白预设').trim() || '空白预设';
        const id = uniqueStPresetId(name);
        const preset = buildBlankStPreset(name);
        writeJsonFile(stPresetFile(id), preset);
        const settings = readJsonFile(ST_PRESETS_SETTINGS_FILE, {});
        writeJsonFile(ST_PRESETS_SETTINGS_FILE, { ...settings, currentPresetId: id });
        res.json({ success: true, id });
    } catch (e) {
        res.status(500).json({ error: '新建预设失败' });
    }
});

app.get('/api/st-presets/:id', (req, res) => {
    try {
        const id = stPresetIdFromName(req.params.id);
        const file = stPresetFile(id);
        const preset = readJsonFile(file, null);
        if (!isSillyTavernPreset(preset)) return res.status(404).json({ error: '未找到酒馆预设' });
        res.json({ id, summary: summarizeStPreset(id, preset, fs.statSync(file)), preset });
    } catch (e) {
        res.status(500).json({ error: '读取酒馆预设失败' });
    }
});

app.post('/api/st-presets/:id', (req, res) => {
    try {
        const id = stPresetIdFromName(req.params.id);
        const preset = req.body?.preset;
        if (!isSillyTavernPreset(preset)) return res.status(400).json({ error: '不是有效的酒馆预设 JSON' });
        writeJsonFile(stPresetFile(id), preset);
        res.json({ success: true, summary: summarizeStPreset(id, preset, fs.statSync(stPresetFile(id))) });
    } catch (e) {
        res.status(500).json({ error: '保存酒馆预设失败' });
    }
});

app.post('/api/st-presets/:id/rename', (req, res) => {
    try {
        const id = stPresetIdFromName(req.params.id);
        const nextId = uniqueStPresetId(req.body?.name || id, id);
        const oldFile = stPresetFile(id);
        const nextFile = stPresetFile(nextId);
        if (!fs.existsSync(oldFile)) return res.status(404).json({ error: '未找到酒馆预设' });
        if (id !== nextId) fs.renameSync(oldFile, nextFile);
        const settings = readJsonFile(ST_PRESETS_SETTINGS_FILE, {});
        if (settings.currentPresetId === id) writeJsonFile(ST_PRESETS_SETTINGS_FILE, { ...settings, currentPresetId: nextId });
        res.json({ success: true, id: nextId });
    } catch (e) {
        res.status(500).json({ error: '重命名酒馆预设失败' });
    }
});

app.post('/api/st-presets/:id/copy', (req, res) => {
    try {
        const id = stPresetIdFromName(req.params.id);
        const preset = readJsonFile(stPresetFile(id), null);
        if (!isSillyTavernPreset(preset)) return res.status(404).json({ error: '未找到酒馆预设' });
        const nextId = uniqueStPresetId(req.body?.name || `${id} 副本`);
        writeJsonFile(stPresetFile(nextId), preset);
        res.json({ success: true, id: nextId });
    } catch (e) {
        res.status(500).json({ error: '复制酒馆预设失败' });
    }
});

app.post('/api/st-presets/:id/refresh-default', (req, res) => {
    try {
        const id = stPresetIdFromName(req.params.id);
        const preset = readJsonFile(DEFAULT_ST_PRESET_FILE, null);
        if (!isSillyTavernPreset(preset)) return res.status(404).json({ error: '未找到默认 Liminal_online.json' });
        writeJsonFile(stPresetFile(id), preset);
        const settings = readJsonFile(ST_PRESETS_SETTINGS_FILE, {});
        writeJsonFile(ST_PRESETS_SETTINGS_FILE, { ...settings, currentPresetId: id });
        res.json({ success: true, id });
    } catch (e) {
        res.status(500).json({ error: '刷新默认酒馆预设失败' });
    }
});

app.delete('/api/st-presets/:id', (req, res) => {
    try {
        const presets = listStPresetSummaries();
        if (presets.length <= 1) return res.status(400).json({ error: '至少保留一个预设' });
        const id = stPresetIdFromName(req.params.id);
        const file = stPresetFile(id);
        if (!fs.existsSync(file)) return res.status(404).json({ error: '未找到酒馆预设' });
        fs.rmSync(file, { force: true });
        const settings = readJsonFile(ST_PRESETS_SETTINGS_FILE, {});
        if (settings.currentPresetId === id) {
            const nextId = listStPresetSummaries()[0]?.id || '';
            writeJsonFile(ST_PRESETS_SETTINGS_FILE, { ...settings, currentPresetId: nextId });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '删除酒馆预设失败' });
    }
});

app.post('/api/st-presets/import-default', (req, res) => {
    try {
        const preset = readJsonFile(DEFAULT_ST_PRESET_FILE, null);
        if (!isSillyTavernPreset(preset)) return res.status(404).json({ error: '未找到默认 Liminal_online.json' });
        const id = uniqueStPresetId('Liminal_online');
        writeJsonFile(stPresetFile(id), preset);
        const settings = readJsonFile(ST_PRESETS_SETTINGS_FILE, {});
        writeJsonFile(ST_PRESETS_SETTINGS_FILE, { ...settings, currentPresetId: id });
        res.json({ success: true, id });
    } catch (e) {
        res.status(500).json({ error: '导入默认酒馆预设失败' });
    }
});

app.get('/api/qq/prompt-preset', (req, res) => {
    try {
        const presets = listStPresetSummaries();
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        let currentPromptPresetId = qqSettings.currentPromptPresetId || getCurrentStPresetId();
        if (!presets.some(preset => preset.id === currentPromptPresetId)) {
            currentPromptPresetId = presets[0]?.id || '';
            writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPromptPresetId });
        }
        res.json({ presets, currentPromptPresetId });
    } catch (e) {
        res.status(500).json({ error: '读取 QQ 提示词预设失败' });
    }
});

app.post('/api/qq/prompt-preset', (req, res) => {
    try {
        const id = stPresetIdFromName(req.body?.id || '');
        if (!fs.existsSync(stPresetFile(id))) return res.status(404).json({ error: '未找到提示词预设' });
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPromptPresetId: id });
        res.json({ success: true, currentPromptPresetId: id });
    } catch (e) {
        res.status(500).json({ error: '保存 QQ 提示词预设失败' });
    }
});

// 链接预览：拉 HTML，解析 OG/meta，返回卡片字段
app.post('/api/qq/link-preview', async (req, res) => {
    try {
        let raw = String(req.body?.url || '').trim();
        const rawText = String(req.body?.rawText || raw).trim();
        if (!raw) return res.status(400).json({ error: '缺少 URL' });
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(raw)) {
            raw = `https://${raw}`;
        }
        let u;
        try { u = new URL(raw); } catch { return res.status(400).json({ error: 'URL 格式无效' }); }
        if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: '仅支持 http/https' });
        // SSRF: 拒绝内网/本地
        const isBlockedHost = (hostname) => {
            const host = String(hostname || '').toLowerCase();
            return host === 'localhost' || host === '0.0.0.0' || /^127\./.test(host) || /^10\./.test(host)
                || /^192\.168\./.test(host) || /^169\.254\./.test(host)
                || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || /^::1$/.test(host) || /^fe80:/i.test(host);
        };
        const host = u.hostname.toLowerCase();
        if (isBlockedHost(host)) {
            return res.status(400).json({ error: '禁止访问内网地址' });
        }
        const isXhsHost = (hostname) => /(^|\.)xhslink\.com$|(^|\.)xiaohongshu\.com$|(^|\.)xhscdn\.com$/i.test(hostname || '');
        const inferSiteName = (hostname) => {
            if (isXhsHost(hostname)) return '小红书';
            return hostname || '链接';
        };
        const isGenericPreviewText = (text, hostname = host) => {
            const value = String(text || '').trim().replace(/\s+/g, ' ');
            if (!value) return true;
            if (isXhsHost(hostname)) {
                return /^(小红书|小红书 - 你的生活指南|小红书 - 标记我的生活|xiaohongshu|xhs)$/i.test(value)
                    || /登录|访问链接异常|正在跳转|安全验证|验证码/.test(value);
            }
            return false;
        };
        const cleanSharedText = (text) => {
            return String(text || '')
                .replace(/https?:\/\/[^\s"'<>，。！？、；）)】\]]+/gi, '')
                .replace(/复制本条信息.*?(小红书|App).*$/i, '')
                .replace(/打开【?小红书】?App查看精彩内容.*$/i, '')
                .replace(/[“”"']/g, '')
                .replace(/\s+/g, ' ')
                .replace(/^[,，。:：\s]+|[,，。:：\s]+$/g, '')
                .slice(0, 200);
        };
        const fallbackPreview = (finalUrl = u.toString(), reason = '') => {
            let finalHost = host;
            try { finalHost = new URL(finalUrl).hostname; } catch {}
            const sharedTitle = cleanSharedText(rawText);
            return {
                url: finalUrl,
                title: sharedTitle || inferSiteName(finalHost),
                description: '',
                image: '',
                siteName: inferSiteName(finalHost),
                source: 'fallback',
                limitedReason: reason || ''
            };
        };
        const normalizePreviewPayload = (payload) => {
            const data = payload?.data || payload?.result || payload?.note || payload;
            if (!data || typeof data !== 'object') return null;
            const images = Array.isArray(data.images) ? data.images
                : Array.isArray(data.imageList) ? data.imageList
                    : Array.isArray(data.pictures) ? data.pictures
                        : [];
            const imageCandidate = data.image || data.cover || data.coverUrl || data.thumbnail || images[0] || '';
            const title = data.title || data.desc || data.description || data.content || data.text || '';
            const description = data.description || data.desc || data.content || data.text || '';
            if (!title && !description && !imageCandidate) return null;
            return {
                url: data.url || data.shareUrl || u.toString(),
                title: String(title || inferSiteName(host)).slice(0, 200),
                description: String(description || '').slice(0, 1200),
                image: imageCandidate ? new URL(String(imageCandidate), u.toString()).toString() : '',
                siteName: data.siteName || data.source || inferSiteName(host),
                source: 'third-party'
            };
        };
        const trimMarkdownNoise = (text, max = 400) => String(text || '')
            .replace(/!\[[^\]]*]\([^)]+\)/g, '')
            .replace(/\[[^\]]+]\([^)]+\)/g, '$1')
            .replace(/[#>*_`~|-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
        const normalizeJinaMarkdown = (markdown, sourceUrl) => {
            const content = String(markdown || '').trim();
            if (!content) return null;
            const titleLine = content.match(/^Title:\s*(.+)$/im)?.[1]
                || content.match(/^#\s+(.+)$/m)?.[1]
                || '';
            const descriptionLine = content.match(/^Description:\s*(.+)$/im)?.[1] || '';
            const imageMatch = content.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)[^)]*\)/i);
            const genericTitle = /小红书|xiaohongshu|xhs|生活指南|发现精彩|正在跳转/i.test(titleLine);
            const sharedText = cleanSharedText(rawText);
            const lines = content
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line
                    && !/^Title:/i.test(line)
                    && !/^Description:/i.test(line)
                    && !/^URL Source:/i.test(line)
                    && !/^Markdown Content:/i.test(line)
                    && !/^#+\s*/.test(line)
                    && !/^!\[[^\]]*]\(/.test(line)
                    && !/^(打开|下载|登录|注册|复制|扫码|点击|更多精彩|当前浏览器)/.test(line));
            const bodyText = trimMarkdownNoise(lines
                .map(line => trimMarkdownNoise(line, 300))
                .filter(line => line.length >= 8)
                .filter((line, index, arr) => arr.indexOf(line) === index)
                .join(' '), 1200);
            const description = trimMarkdownNoise(descriptionLine || sharedText || bodyText, 1200);
            const title = trimMarkdownNoise((genericTitle ? '' : titleLine) || sharedText || description, 200);
            if (!title && !description && !imageMatch?.[1]) return null;
            return {
                url: sourceUrl || u.toString(),
                title: title || inferSiteName(host),
                description: description && description !== title ? description : '',
                image: imageMatch?.[1] ? new URL(imageMatch[1], sourceUrl || u.toString()).toString() : '',
                siteName: inferSiteName(new URL(sourceUrl || u.toString()).hostname),
                source: 'jina'
            };
        };
        const tryJinaReader = async (targetUrl, token = '') => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                console.log(`[link-preview jina] target=${targetUrl} token=${token ? 'yes' : 'no'}`);
                const readerResp = await fetch(`https://r.jina.ai/${targetUrl}`, {
                    method: 'GET',
                    redirect: 'follow',
                    signal: controller.signal,
                    headers: {
                        'Accept': 'text/markdown,text/plain;q=0.9,*/*;q=0.8',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    }
                });
                if (!readerResp.ok) return null;
                const markdown = await readerResp.text();
                return normalizeJinaMarkdown(markdown, targetUrl);
            } catch (e) {
                console.warn('[link-preview jina failed]', e?.message || e);
                return null;
            } finally {
                clearTimeout(timer);
            }
        };
        const isUsefulPreview = (preview, hostname = host) => {
            if (!preview) return false;
            return Boolean(
                String(preview.description || '').trim()
                || String(preview.image || '').trim()
                || !isGenericPreviewText(preview.title, hostname)
            );
        };
        const settings = readJsonFile(SETTINGS_FILE, {});
        const previewApiUrl = String(settings.linkPreview_apiUrl || '').trim();
        const previewApiEnabled = settings.linkPreview_apiEnabled === true || settings.linkPreview_apiEnabled === 'true';
        const jinaToken = String(settings.linkPreview_jinaToken || '').trim();
        if (previewApiEnabled && previewApiUrl) {
            try {
                const apiResp = await fetch(previewApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(settings.linkPreview_apiKey ? { 'Authorization': `Bearer ${settings.linkPreview_apiKey}` } : {})
                    },
                    body: JSON.stringify({ url: u.toString(), rawText })
                });
                if (apiResp.ok) {
                    const parsed = await apiResp.json().catch(() => null);
                    const normalized = normalizePreviewPayload(parsed);
                    if (normalized) return res.json(normalized);
                }
            } catch (e) {
                console.warn('[link-preview third-party failed]', e?.message || e);
            }
        }
        // ── 工具：抓 HTML（追 HTTP redirect；解析 JS/meta redirect 兜底）──────────────
        const fetchHtml = async (targetUrl, timeout = 10000) => {
            const hdrs = {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            };
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), timeout);
            let resp;
            try {
                resp = await fetch(targetUrl, { redirect: 'follow', signal: ctrl.signal, headers: hdrs });
            } finally { clearTimeout(t); }
            const finalU = resp.url || targetUrl;
            const ctype = resp.headers.get('content-type') || '';
            if (!resp.ok || !/text\/html|application\/xhtml/i.test(ctype)) {
                return { finalUrl: finalU, html: '', resp };
            }
            // 读最多 256KB
            const reader = resp.body?.getReader?.();
            let html = '', total = 0;
            const dec = new TextDecoder('utf-8');
            if (reader) {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    total += value.length;
                    if (total > 256 * 1024) { try { await reader.cancel(); } catch {} break; }
                    html += dec.decode(value, { stream: true });
                }
                html += dec.decode();
            } else {
                html = await resp.text();
                if (html.length > 256 * 1024) html = html.slice(0, 256 * 1024);
            }
            return { finalUrl: finalU, html, resp };
        };

        // ── 工具：从 HTML 提取短链跳转目标（JS redirect / meta refresh）─────────────
        const extractHtmlRedirect = (html) => {
            const metaR = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]*;\s*url=([^"'\s>]+)/i)
                || html.match(/content=["'][^;]*;\s*url=([^"'\s>]+)[^>]+http-equiv=["']refresh["']/i);
            if (metaR?.[1]) return metaR[1].trim();
            const jsR = html.match(/(?:window\.location(?:\.href)?|location\.replace\()\s*[=\(]\s*["'](https?:\/\/[^"']+)["']/i);
            if (jsR?.[1]) return jsR[1].trim();
            return null;
        };

        // ── 工具：从 HTML 提取 OG / meta ──────────────────────────────────────────
        const parseOgFromHtml = (html, baseUrl) => {
            const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
            const decEnt = (s) => s
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
            const metaC = (prop) => {
                const r1 = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${prop}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i');
                const r2 = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]+(?:property|name)\\s*=\\s*["']${prop}["']`, 'i');
                return decEnt(pick(r1) || pick(r2));
            };
            let finalHost = '';
            try { finalHost = new URL(baseUrl).hostname; } catch {}
            const title = metaC('og:title') || decEnt(pick(/<title[^>]*>([^<]+)<\/title>/i));
            const description = metaC('og:description') || metaC('description');
            const imageRaw = metaC('og:image') || metaC('twitter:image');
            const image = imageRaw ? (() => { try { return new URL(imageRaw, baseUrl).toString(); } catch { return ''; } })() : '';
            const siteName = metaC('og:site_name') || inferSiteName(finalHost);
            return { title, description, image, siteName };
        };

        // ── 工具：从 HTML 里按 key 括号配平抠出一个 JSON 对象（不依赖整体 parse）──────
        // 实测：__INITIAL_STATE__ 是超大 blob，整体 JSON.parse 易因某处非法值整体失败；
        // 直接定位 "noteData":{ 然后括号配平取该对象，远比解析整个 state 稳。
        const extractJsonObjectAfterKey = (html, key) => {
            let from = 0;
            while (true) {
                const k = html.indexOf(key, from);
                if (k === -1) return null;
                const start = k + key.length;
                from = start;
                if (html[start] !== '{') continue;
                let depth = 0, inStr = false, esc = false, end = -1;
                for (let j = start; j < html.length; j++) {
                    const c = html[j];
                    if (esc) { esc = false; continue; }
                    if (c === '\\') { esc = true; continue; }
                    if (c === '"') { inStr = !inStr; continue; }
                    if (inStr) continue;
                    if (c === '{') depth++;
                    else if (c === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
                }
                if (end === -1) continue;
                try {
                    const obj = JSON.parse(html.slice(start, end));
                    if (obj && typeof obj === 'object') return obj;
                } catch {}
            }
        };

        // ── 工具：小红书 __INITIAL_STATE__ / 内嵌 JSON 提取 ─────────────────────────
        const parseXhsFromHtml = (html, baseUrl) => {
            // 方案 A：括号配平抠 "noteData":{...}，遍历所有同名 key 找带 title/desc 的那个
            let from = 0;
            const KEY = '"noteData":';
            while (true) {
                const k = html.indexOf(KEY, from);
                if (k === -1) break;
                from = k + KEY.length;
                const note = extractJsonObjectAfterKey(html.slice(k), KEY);
                if (note && (note.title || note.desc)) {
                    const title = String(note.title || '').trim();
                    const desc = String(note.desc || '').trim();
                    const images = Array.isArray(note.imageList) ? note.imageList : [];
                    const image = note.cover?.urlDefault
                        || images[0]?.url
                        || images[0]?.infoList?.find(i => /WB_DFT|H5_DTL|DFT/i.test(i.imageScene))?.url
                        || images[0]?.infoList?.[0]?.url
                        || '';
                    // 去掉描述里的 #话题# / #话题[话题]# 标签
                    const cleanDesc = desc
                        .replace(/#[^#\n]{1,30}(?:\[话题\])?#/g, '')
                        .replace(/[ \t]+/g, ' ')
                        .trim();
                    return {
                        title: title || cleanDesc.slice(0, 60) || '小红书笔记',
                        description: cleanDesc,
                        image,
                        siteName: '小红书',
                        source: 'xhs-state',
                        url: baseUrl
                    };
                }
            }
            // 方案 B：OG 标签
            const og = parseOgFromHtml(html, baseUrl);
            const finalHost = (() => { try { return new URL(baseUrl).hostname; } catch { return ''; } })();
            if (og.title && !isGenericPreviewText(og.title, finalHost)) {
                return { ...og, source: 'xhs-og', url: baseUrl };
            }
            return null;
        };

        // ── 主流程 ─────────────────────────────────────────────────────────────────

        // Step 1: 抓原始 URL，拿到 finalUrl（追 HTTP redirect）
        let fetchResult;
        try { fetchResult = await fetchHtml(u.toString()); } catch (e) {
            // 网络完全失败 → 直接 Jina 兜底
            const jinaFb = await tryJinaReader(u.toString(), jinaToken);
            return res.json(isUsefulPreview(jinaFb, host) ? jinaFb : fallbackPreview(u.toString(), '抓取超时'));
        }
        let { finalUrl, html } = fetchResult;

        // Step 2: 如果 HTML 里有 JS/meta redirect（常见于短链跳转页），追一跳
        if (!html && !isXhsHost(host)) {
            // 非 XHS 短链，直接 Jina 兜底
            const jinaFb = await tryJinaReader(finalUrl, jinaToken);
            return res.json(isUsefulPreview(jinaFb, new URL(finalUrl).hostname)
                ? jinaFb : fallbackPreview(finalUrl, `远程返回 ${fetchResult.resp?.status}`));
        }
        if (html) {
            const redirectTarget = extractHtmlRedirect(html);
            if (redirectTarget && redirectTarget !== finalUrl) {
                try {
                    const newParsed = new URL(redirectTarget);
                    if (!isBlockedHost(newParsed.hostname)) {
                        const r2 = await fetchHtml(redirectTarget, 8000);
                        if (r2.html) { finalUrl = r2.finalUrl; html = r2.html; }
                    }
                } catch {}
            }
        }

        const finalHost = (() => { try { return new URL(finalUrl).hostname; } catch { return host; } })();
        try { if (isBlockedHost(finalHost)) return res.status(400).json({ error: '禁止访问内网地址' }); } catch {}

        // Step 3: 针对小红书特化解析（OG + __INITIAL_STATE__）
        if (isXhsHost(finalHost)) {
            // 诊断：VPS 机房 IP 常被小红书反爬，返回的页面里没有 __INITIAL_STATE__/noteData
            const hasState = html.includes('__INITIAL_STATE__');
            const hasNote = html.includes('"noteData":');
            const looksBlocked = /验证|滑动|captcha|访问异常|网络不给力|当前页面无法访问/i.test(html);
            console.log(`[link-preview xhs] finalUrl=${finalUrl} htmlLen=${html.length} hasState=${hasState} hasNote=${hasNote} blocked=${looksBlocked}`);

            const xhsData = html ? parseXhsFromHtml(html, finalUrl) : null;
            if (xhsData && isUsefulPreview(xhsData, finalHost)) {
                return res.json({ ...xhsData, url: xhsData.url || finalUrl });
            }
            // XHS 直抓失败（多半被反爬）→ 试 Jina（用真正的 xiaohongshu.com URL，不再是短链）
            const jinaXhs = await tryJinaReader(finalUrl, jinaToken);
            if (isUsefulPreview(jinaXhs, finalHost)) return res.json(jinaXhs);
            // 都失败：用分享文字兜底 + 诊断原因
            const sharedXhs = cleanSharedText(rawText);
            const reason = looksBlocked ? '小红书反爬拦截（服务器 IP 被限），建议配置 Jina Token'
                : !hasState ? '小红书未返回内容（IP 被限或链接失效），建议配置 Jina Token'
                : '小红书内容解析失败';
            return res.json({
                url: finalUrl,
                title: (xhsData?.title || sharedXhs || '小红书笔记').slice(0, 200),
                description: (sharedXhs || '').slice(0, 1200),
                image: xhsData?.image || '',
                siteName: '小红书',
                source: 'xhs-limited',
                limitedReason: reason
            });
        }

        // Step 4: 通用 OG 解析
        const sharedText = cleanSharedText(rawText);
        if (html) {
            const og = parseOgFromHtml(html, finalUrl);
            const hasUseful = Boolean(og.description || og.image || (og.title && !isGenericPreviewText(og.title, finalHost)));
            if (hasUseful) {
                return res.json({
                    url: finalUrl,
                    title: og.title.slice(0, 200),
                    description: og.description.slice(0, 1200),
                    image: og.image,
                    siteName: og.siteName.slice(0, 80),
                    source: 'og'
                });
            }
        }

        // Step 5: OG 没内容 → Jina（用 finalUrl，比原始短链更准）
        const jinaFinal = await tryJinaReader(finalUrl, jinaToken);
        if (isUsefulPreview(jinaFinal, finalHost)) return res.json(jinaFinal);

        // Step 6: 全失败 → 用 rawText 里的分享文字兜底
        if (sharedText) {
            return res.json({ url: finalUrl, title: sharedText.slice(0, 200), description: '', image: '', siteName: inferSiteName(finalHost), source: 'shared-text' });
        }
        return res.json(fallbackPreview(finalUrl, '无法解析'));
    } catch (e) {
        const msg = e?.name === 'AbortError' ? '抓取超时' : '抓取失败';
        res.status(502).json({ error: msg });
    }
});

// 7. 世界书 —— 按「本」粒度
app.get('/api/worldbooks', (req, res) => {
    try {
        res.json({ books: readWorldbooks() });
    } catch (e) {
        res.status(500).json({ error: '读取世界书失败' });
    }
});

// 整体覆盖（前端编辑后一次写回）
app.post('/api/worldbooks', (req, res) => {
    try {
        const books = Array.isArray(req.body?.books) ? req.body.books : [];
        writeWorldbooks(books);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '保存世界书失败' });
    }
});

// 新建空白本
app.post('/api/worldbooks/books', (req, res) => {
    try {
        const name = String(req.body?.name || '').trim() || '未命名世界书';
        const now = Date.now();
        const book = { id: `book_${shortId()}`, name, entries: [], created_at: now, updated_at: now };
        const books = readWorldbooks();
        books.unshift(book);
        writeWorldbooks(books);
        res.json({ success: true, book: summarizeWorldbook(book) });
    } catch (e) {
        res.status(500).json({ error: '新建世界书失败' });
    }
});

// 删除一本
app.delete('/api/worldbooks/books/:id', (req, res) => {
    try {
        const id = req.params.id;
        const books = readWorldbooks().filter(book => book.id !== id);
        writeWorldbooks(books);
        // 清理 QQ 全局选择
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        if (Array.isArray(qqSettings.globalWorldbookIds) && qqSettings.globalWorldbookIds.includes(id)) {
            qqSettings.globalWorldbookIds = qqSettings.globalWorldbookIds.filter(item => item !== id);
            writeJsonFile(QQ_SETTINGS_FILE, qqSettings);
        }
        // 清理所有角色卡的引用
        if (fs.existsSync(CHARACTERS_DIR)) {
            fs.readdirSync(CHARACTERS_DIR).filter(f => f.endsWith('.json')).forEach(f => {
                const file = path.join(CHARACTERS_DIR, f);
                const c = readJsonFile(file, null);
                if (c && Array.isArray(c.worldbookIds) && c.worldbookIds.includes(id)) {
                    c.worldbookIds = c.worldbookIds.filter(item => item !== id);
                    writeJsonFile(file, c);
                }
            });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '删除世界书失败' });
    }
});

// 酒馆世界书 JSON 导入
app.post('/api/worldbooks/import-st', (req, res) => {
    try {
        const stData = req.body?.data;
        const name = req.body?.name;
        if (!stData || typeof stData !== 'object') return res.status(400).json({ error: '请上传有效的酒馆世界书 JSON' });
        const book = importStWorldbookData(stData, name);
        const books = readWorldbooks();
        books.unshift(book);
        writeWorldbooks(books);
        res.json({ success: true, book: summarizeWorldbook(book) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '导入失败' });
    }
});

// QQ 全局世界书 enabled 列表
app.get('/api/qq/global-worldbooks', (req, res) => {
    try {
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        const ids = Array.isArray(qqSettings.globalWorldbookIds) ? qqSettings.globalWorldbookIds : [];
        res.json({ globalWorldbookIds: ids });
    } catch (e) {
        res.status(500).json({ error: '读取 QQ 全局世界书失败' });
    }
});

app.post('/api/qq/global-worldbooks', (req, res) => {
    try {
        const ids = Array.isArray(req.body?.globalWorldbookIds) ? req.body.globalWorldbookIds : [];
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, globalWorldbookIds: ids });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '保存 QQ 全局世界书失败' });
    }
});

// 装配预览：实际 world_info / memories 内容（供前端展开查看）
app.get('/api/qq/preset-marker-preview', (req, res) => {
    try {
        const characterId = String(req.query?.characterId || '');
        const character = characterId
            ? readJsonFile(path.join(CHARACTERS_DIR, `${cleanName(characterId)}.json`), null)
            : null;
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        res.json({
            world_info: buildWorldbooksContent(
                Array.isArray(qqSettings.globalWorldbookIds) ? qqSettings.globalWorldbookIds : [],
                'world_info'
            ),
            memories: buildWorldbooksContent(
                Array.isArray(character?.worldbookIds) ? character.worldbookIds : [],
                'memories'
            )
        });
    } catch (e) {
        res.status(500).json({ error: '读取 marker 预览失败' });
    }
});

// 8. 提示词变量
app.get('/api/prompt/variables', (req, res) => {
    try {
        res.json(buildPromptVariables({
            characterId: req.query.characterId || '',
            userName: req.query.userName || '',
            messages: Array.isArray(req.query.messages) ? req.query.messages : []
        }));
    } catch (e) {
        res.status(500).json({ error: '读取变量失败' });
    }
});

app.post('/api/prompt/render', (req, res) => {
    try {
        const variables = buildPromptVariables({
            characterId: req.body?.characterId || '',
            userName: req.body?.userName || '',
            messages: Array.isArray(req.body?.messages) ? req.body.messages : []
        });
        res.json({
            variables,
            rendered: renderPromptTemplate(req.body?.template || '', variables)
        });
    } catch (e) {
        res.status(500).json({ error: '渲染提示词失败' });
    }
});

// 9. User personas
app.get('/api/userpersonas', (req, res) => {
    try {
        const { personas, currentPersonaId } = ensureUserPersonasReady();
        res.json({
            personas,
            currentPersonaId,
            currentPersona: personas.find(item => item.id === currentPersonaId) || personas[0] || null
        });
    } catch (e) {
        res.status(500).json({ error: '读取 user 人设失败' });
    }
});

app.post('/api/userpersonas', (req, res) => {
    try {
        const body = req.body || {};
        const now = Date.now();
        const id = body.id || `user_${shortId()}`;
        const name = cleanFileName(body.name || '未命名');
        let persona = {
            id,
            name,
            gender: body.gender || '',
            birthday: body.birthday || '',
            status: body.status || '超开心',
            customStatus: body.customStatus || '',
            signature: body.signature || '情绪是一场雷阵雨',
            note: body.note || '',
            prompt: body.prompt || '',
            avatar: body.avatar || '',
            created_at: now,
            updated_at: now
        };
        if (body.avatarDataUrl) {
            persona.avatar = savePersonaAvatar(id, persona.name, body.avatarDataUrl, persona.avatar);
        }
        const fileName = uniquePersonaFileName(persona.name);
        writeJsonFile(path.join(USER_PERSONAS_DIR, fileName), persona);
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        if (!qqSettings.currentPersonaId) {
            writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPersonaId: id });
        }
        res.json({ ...persona, fileName });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '保存 user 人设失败' });
    }
});

app.put('/api/userpersonas/:id', (req, res) => {
    try {
        const id = req.params.id;
        const file = findUserPersonaFile(id);
        if (!file) return res.status(404).json({ error: '未找到 user 人设' });
        const cur = readJsonFile(file, null);
        if (!cur) return res.status(404).json({ error: '未找到 user 人设' });
        const body = req.body || {};
        const name = cleanFileName(body.name || cur.name || '未命名');
        let avatar = body.avatar ?? cur.avatar ?? '';
        if (body.avatarDataUrl) {
            avatar = savePersonaAvatar(id, name, body.avatarDataUrl, cur.avatar || '');
        }
        const next = {
            ...cur,
            name,
            gender: body.gender ?? cur.gender ?? '',
            birthday: body.birthday ?? cur.birthday ?? '',
            status: body.status ?? cur.status ?? '超开心',
            customStatus: body.customStatus ?? cur.customStatus ?? '',
            signature: body.signature ?? cur.signature ?? '情绪是一场雷阵雨',
            note: body.note ?? cur.note ?? '',
            prompt: body.prompt ?? cur.prompt ?? '',
            avatar,
            id: cur.id,
            updated_at: Date.now()
        };
        const oldFileName = path.basename(file);
        const nextFileName = uniquePersonaFileName(next.name, oldFileName);
        const nextFile = path.join(USER_PERSONAS_DIR, nextFileName);
        writeJsonFile(nextFile, next);
        if (nextFile !== file && fs.existsSync(file)) fs.rmSync(file, { force: true });
        res.json({ ...next, fileName: nextFileName });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '更新 user 人设失败' });
    }
});

app.delete('/api/userpersonas/:id', (req, res) => {
    try {
        const { personas, currentPersonaId } = ensureUserPersonasReady();
        if (personas.length <= 1) return res.status(400).json({ error: '至少保留一个 user 人设' });
        const id = req.params.id;
        const target = personas.find(item => item.id === id);
        if (!target) return res.status(404).json({ error: '未找到 user 人设' });
        const file = path.join(USER_PERSONAS_DIR, target.fileName);
        if (fs.existsSync(file)) fs.rmSync(file, { force: true });
        if (target.avatar) {
            const avatarPath = path.join(__dirname, target.avatar.replace(/^\//, '').split('?')[0]);
            if (avatarPath.startsWith(USER_PERSONA_AVATARS_DIR) && fs.existsSync(avatarPath)) {
                fs.rmSync(avatarPath, { force: true });
            }
        }
        const remaining = personas.filter(item => item.id !== id);
        if (currentPersonaId === id) {
            const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
            writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPersonaId: remaining[0].id });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '删除 user 人设失败' });
    }
});

app.post('/api/userpersonas/current', (req, res) => {
    try {
        const id = req.body?.id || '';
        const { personas } = ensureUserPersonasReady();
        if (!personas.some(item => item.id === id)) {
            return res.status(404).json({ error: '未找到 user 人设' });
        }
        const qqSettings = readJsonFile(QQ_SETTINGS_FILE, {});
        writeJsonFile(QQ_SETTINGS_FILE, { ...qqSettings, currentPersonaId: id });
        res.json({ success: true, currentPersonaId: id });
    } catch (e) {
        res.status(500).json({ error: '切换 user 人设失败' });
    }
});

// ========== QQ App 路由 ==========

function shortId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 列出所有角色
app.get('/api/qq/characters', (req, res) => {
    try {
        if (!fs.existsSync(CHARACTERS_DIR)) return res.json([]);
        const files = fs.readdirSync(CHARACTERS_DIR).filter(f => f.endsWith('.json'));
        const list = files.map(f => {
            try {
                return JSON.parse(fs.readFileSync(path.join(CHARACTERS_DIR, f), 'utf-8'));
            } catch { return null; }
        }).filter(Boolean);
        list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: '读取角色失败' });
    }
});

// 新建角色（来自 ST 导入或新增好友）
app.post('/api/qq/characters', (req, res) => {
    console.log(`[POST /api/qq/characters] content-length=${req.headers['content-length']} body-keys=${Object.keys(req.body || {}).join(',')}`);
    try {
        const body = req.body || {};
        const id = body.id || shortId();
        let avatarPath = '';
        if (body.avatarDataUrl) {
            const parsed = parseDataUrl(body.avatarDataUrl);
            if (parsed && parsed.mime.startsWith('image/')) {
                const ext = extensionFromMime(parsed.mime);
                const fileName = `${id}.${ext}`;
                fs.writeFileSync(path.join(AVATARS_DIR, fileName), parsed.buffer);
                avatarPath = `/data/assets/avatars/${fileName}`;
            }
        }
        const record = {
            id,
            name: body.name || '未命名',
            avatar: avatarPath,
            description: body.description || '',
            personality: body.personality || '',
            scenario: body.scenario || '',
            first_mes: body.first_mes || '',
            mes_example: body.mes_example || '',
            system_prompt: body.system_prompt || '',
            post_history_instructions: body.post_history_instructions || '',
            role_setting: body.role_setting || body.description || '',
            rp_rules: body.rp_rules || body.personality || '',
            other_setting: body.other_setting || body.nsfw_setting || '',
            nsfw_setting: body.nsfw_setting || '',
            alternate_greetings: Array.isArray(body.alternate_greetings) ? body.alternate_greetings : [],
            tags: Array.isArray(body.tags) ? body.tags : [],
            worldbookIds: Array.isArray(body.worldbookIds) ? body.worldbookIds : [],
            rp_rules_depth: Math.max(0, Math.min(parseInt(body.rp_rules_depth, 10) || 0, 4)),
            creator: body.creator || '',
            character_version: body.character_version || '',
            group: body.group || '',
            starred: !!body.starred,
            remark: body.remark || '',
            created_at: Date.now(),
        };
        fs.writeFileSync(path.join(CHARACTERS_DIR, `${id}.json`), JSON.stringify(record, null, 2), 'utf-8');
        res.json(record);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '保存角色失败' });
    }
});

// 更新单个角色（PATCH 风格）
app.put('/api/qq/characters/:id', (req, res) => {
    try {
        const id = req.params.id;
        const file = path.join(CHARACTERS_DIR, `${id}.json`);
        if (!fs.existsSync(file)) return res.status(404).json({ error: '未找到角色' });
        const cur = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const body = req.body || {};
        let avatar = body.avatar ?? cur.avatar;
        if (body.avatarDataUrl) {
            const parsed = parseDataUrl(body.avatarDataUrl);
            if (parsed && parsed.mime.startsWith('image/')) {
                if (cur.avatar && fs.existsSync(AVATARS_DIR)) {
                    fs.readdirSync(AVATARS_DIR)
                        .filter(f => f.startsWith(`${id}.`))
                        .forEach(f => fs.rmSync(path.join(AVATARS_DIR, f), { force: true }));
                }
                const ext = extensionFromMime(parsed.mime);
                const fileName = `${id}.${ext}`;
                fs.writeFileSync(path.join(AVATARS_DIR, fileName), parsed.buffer);
                avatar = `/data/assets/avatars/${fileName}`;
            }
        }
        const { avatarDataUrl, ...patch } = body;
        const next = { ...cur, ...patch, avatar, id: cur.id };
        fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8');
        res.json(next);
    } catch (e) {
        res.status(500).json({ error: '更新角色失败' });
    }
});

// 删除角色
app.delete('/api/qq/characters/:id', (req, res) => {
    try {
        const id = req.params.id;
        const file = path.join(CHARACTERS_DIR, `${id}.json`);
        if (fs.existsSync(file)) fs.rmSync(file, { force: true });
        const chatFile = path.join(CHATS_DIR, `${id}.json`);
        if (fs.existsSync(chatFile)) fs.rmSync(chatFile, { force: true });
        // 顺手清头像
        if (fs.existsSync(AVATARS_DIR)) {
            fs.readdirSync(AVATARS_DIR)
                .filter(f => f.startsWith(`${id}.`))
                .forEach(f => fs.rmSync(path.join(AVATARS_DIR, f), { force: true }));
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '删除角色失败' });
    }
});

// 单人聊天记录
function sanitizeChatMessagesForStorage(messages) {
    // 图片：dataURL 不进存盘（前端 localStorage 兜底，详见 §1.x 图片处理 2026-06-22）；
    // 但 client_image_id 必须保留，让重载后 localStorage 还能找到图。
    return (Array.isArray(messages) ? messages : []).map(message => {
        if (!message || typeof message !== 'object' || message.type !== 'image') return message;
        const clean = { ...message, text: message.text || '[图片]' };
        delete clean.image;
        return clean;
    });
}

function sanitizeChatForStorage(chat) {
    const data = chat && typeof chat === 'object' ? chat : {};
    return {
        ...data,
        messages: sanitizeChatMessagesForStorage(data.messages)
    };
}

app.get('/api/qq/chats', (req, res) => {
    try {
        if (!fs.existsSync(CHATS_DIR)) return res.json([]);
        const files = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json'));
        const list = files.map(f => {
            try {
                const file = path.join(CHATS_DIR, f);
                const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
                const clean = sanitizeChatForStorage(raw);
                if (JSON.stringify(raw) !== JSON.stringify(clean)) {
                    fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8');
                }
                return clean;
            } catch { return null; }
        }).filter(Boolean);
        list.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: '读取聊天失败' });
    }
});

app.get('/api/qq/chats/:characterId', (req, res) => {
    try {
        const file = path.join(CHATS_DIR, `${req.params.characterId}.json`);
        if (!fs.existsSync(file)) return res.json({ characterId: req.params.characterId, messages: [] });
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const clean = sanitizeChatForStorage(raw);
        if (JSON.stringify(raw) !== JSON.stringify(clean)) {
            fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8');
        }
        res.json(clean);
    } catch (e) {
        res.status(500).json({ error: '读取聊天失败' });
    }
});

// 1 楼层 = 1 轮 user-char 交互 = transfer 之后出现的 1 个不同 reply_group_id
// 满 10 轮仍 pending 的 user→char 红包自动退回，详见 QQ美化系统计划.md §1.2
const TRANSFER_AUTO_RETURN_ROUNDS = 10;
function countRoundsSince(messages, fromIdx) {
    const groupIds = new Set();
    for (let i = fromIdx + 1; i < messages.length; i++) {
        const m = messages[i];
        if (m && m.role === 'assistant' && m.reply_group_id) {
            groupIds.add(m.reply_group_id);
        }
    }
    return groupIds.size;
}

function settleUserTransfers(messages) {
    let walletDelta = 0;
    const updates = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m || m.role !== 'user' || m.type !== 'transfer' || m.status !== 'pending') continue;
        const rounds = countRoundsSince(messages, i);
        if (rounds < TRANSFER_AUTO_RETURN_ROUNDS) continue;
        const amt = Number(m.amount);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        m.status = 'returned';
        m.settled_at = Date.now();
        walletDelta += amt;
        updates.push({ idx: i, amount: amt });
    }
    if (walletDelta > 0) {
        try {
            const w = readWallet();
            writeJsonFile(WALLET_FILE, { balance: w.balance + walletDelta, updated_at: Date.now() });
            console.log(`[WALLET] +${walletDelta} (transfer auto-return × ${updates.length})`);
        } catch (err) {
            console.warn('[WALLET] auto-return write failed', err);
        }
    }
    return updates;
}

// 领取 char→user 的红包：校验 + 改 status + 加钱 + 落盘
app.post('/api/qq/chats/:characterId/transfer/:idx/receive', (req, res) => {
    try {
        const characterId = req.params.characterId;
        const idx = Number(req.params.idx);
        if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: 'idx 非法' });
        const chatPath = path.join(CHATS_DIR, `${characterId}.json`);
        if (!fs.existsSync(chatPath)) return res.status(404).json({ error: '聊天不存在' });
        const chat = JSON.parse(fs.readFileSync(chatPath, 'utf-8'));
        const msg = chat?.messages?.[idx];
        if (!msg) return res.status(404).json({ error: '消息不存在' });
        if (msg.type !== 'transfer') return res.status(400).json({ error: '不是红包消息' });
        if (msg.role !== 'assistant') return res.status(400).json({ error: '只能领取对方发来的红包' });
        if (msg.status === 'received') return res.status(409).json({ error: '已领取过' });
        if (msg.status && msg.status !== 'pending') return res.status(409).json({ error: `状态异常: ${msg.status}` });
        const amt = Number(msg.amount);
        if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: '金额非法' });

        const settledAt = Date.now();
        msg.status = 'received';
        msg.settled_at = settledAt;

        const w = readWallet();
        const nextBalance = w.balance + amt;
        writeJsonFile(WALLET_FILE, { balance: nextBalance, updated_at: settledAt });
        chat.updated_at = settledAt;
        fs.writeFileSync(chatPath, JSON.stringify(chat, null, 2), 'utf-8');
        console.log(`[WALLET] +${amt} (transfer received from ${characterId})`);
        res.json({ success: true, balance: nextBalance, settled_at: settledAt });
    } catch (e) {
        console.error('[transfer receive]', e);
        res.status(500).json({ error: '领取失败' });
    }
});

app.post('/api/qq/chats/:characterId', (req, res) => {
    try {
        const characterId = req.params.characterId;
        const messages = sanitizeChatMessagesForStorage(req.body?.messages);
        settleUserTransfers(messages);
        const chatFile = path.join(CHATS_DIR, `${characterId}.json`);
        // 保留原 chat 的辅助字段（如 hidden），只覆盖 messages + updated_at
        const prev = fs.existsSync(chatFile) ? readJsonFile(chatFile, {}) : {};
        const data = {
            ...prev,
            characterId,
            messages,
            updated_at: Date.now()
        };
        fs.writeFileSync(chatFile, JSON.stringify(data, null, 2), 'utf-8');
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: '保存聊天失败' });
    }
});

// M8 清空 messages（保留 chat 文件 + hidden 等字段）
app.delete('/api/qq/chats/:characterId/messages', (req, res) => {
    try {
        const characterId = req.params.characterId;
        const chatFile = path.join(CHATS_DIR, `${characterId}.json`);
        if (!fs.existsSync(chatFile)) return res.json({ characterId, messages: [] });
        const prev = readJsonFile(chatFile, {});
        const data = { ...prev, characterId, messages: [], updated_at: Date.now() };
        fs.writeFileSync(chatFile, JSON.stringify(data, null, 2), 'utf-8');
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: '清空聊天失败' });
    }
});

// M8 隐藏 / 显示聊天（联系人列表默认过滤 hidden）
app.patch('/api/qq/chats/:characterId/hidden', (req, res) => {
    try {
        const characterId = req.params.characterId;
        const chatFile = path.join(CHATS_DIR, `${characterId}.json`);
        const prev = fs.existsSync(chatFile) ? readJsonFile(chatFile, {}) : { characterId, messages: [] };
        const data = { ...prev, characterId, hidden: !!req.body?.hidden };
        fs.writeFileSync(chatFile, JSON.stringify(data, null, 2), 'utf-8');
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: '隐藏聊天失败' });
    }
});

// M8 删除整个 chat（chat 文件 + char-beauty 绑定 + char 专属背景文件）
app.delete('/api/qq/chats/:characterId', (req, res) => {
    try {
        const characterId = req.params.characterId;
        const chatFile = path.join(CHATS_DIR, `${characterId}.json`);
        if (fs.existsSync(chatFile)) fs.rmSync(chatFile, { force: true });
        // 顺手清 char 专属背景文件
        if (fs.existsSync(QQ_CHAR_BG_DIR)) {
            fs.readdirSync(QQ_CHAR_BG_DIR)
                .filter(f => f === characterId || f.startsWith(`${characterId}.`))
                .forEach(f => fs.rmSync(path.join(QQ_CHAR_BG_DIR, f), { force: true }));
        }
        // 清 char-beauty 绑定
        const cb = readCharBeauty();
        if (cb[characterId]) { delete cb[characterId]; writeJsonFile(QQ_CHAR_BEAUTY_FILE, cb); }
        res.json({ success: true });
    } catch (e) {
        console.error('[DELETE chat]', e);
        res.status(500).json({ error: '删除聊天失败' });
    }
});

// 通讯录分组定义
app.get('/api/qq/groups', (req, res) => {
    try {
        const raw = fs.readFileSync(QQ_GROUPS_FILE, 'utf-8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.status(500).json({ error: '读取分组失败' });
    }
});

app.post('/api/qq/groups', (req, res) => {
    try {
        const data = Array.isArray(req.body) ? req.body : [];
        fs.writeFileSync(QQ_GROUPS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '保存分组失败' });
    }
});

app.get('/api/qq/sticker-packs', (req, res) => {
    try {
        const raw = fs.readFileSync(QQ_STICKER_PACKS_FILE, 'utf-8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.status(500).json({ error: '读取表情包失败' });
    }
});

app.post('/api/qq/sticker-packs', (req, res) => {
    try {
        const data = Array.isArray(req.body) ? req.body : [];
        fs.writeFileSync(QQ_STICKER_PACKS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '保存表情包失败' });
    }
});

// 网页图标（favicon）：自动认根目录下的 icon.png / icon.jpg / icon.gif 等，换图免改代码
app.get('/app-icon', (req, res) => {
    const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'];
    for (const ext of exts) {
        const iconPath = path.join(__dirname, `icon.${ext}`);
        if (fs.existsSync(iconPath)) {
            res.set('Cache-Control', 'no-cache');
            return res.sendFile(iconPath);
        }
    }
    res.status(404).end();
});

// ========== QQ AI 回复路由（转发员） ==========

// 把单条 QQ 消息转成给大模型看的纯文本，遵循「线上提示词」格式约定
// 文字 → "content"   表情包 → "[name]"   红包 → [🧧¥10|备注|状态]
// 状态段：user→char pending=未领 / returned=已自动退回；char→user pending=未领 / received=已领
// 图片不走文字 wrap，单独走 multimodal image_url（在 /api/qq/reply 里处理）
function qqMessageToText(msg) {
    if (!msg) return '';
    switch (msg.type) {
        case 'sticker':
            return `[${msg.text || '表情'}]`;
        case 'image':
            return '[图片]';
        case 'transfer': {
            const note = msg.note || '';
            const status = msg.status;
            let label = '';
            if (status === 'pending')  label = '未领';
            else if (status === 'received') label = '已领';
            else if (status === 'returned') label = '已自动退回';
            return `[🧧${msg.currency || ''}${msg.amount || ''}|${note}${label ? `|${label}` : ''}]`;
        }
        case 'voice':
            return String(msg.text || '');
        case 'link': {
            const t = String(msg.title || '').trim();
            const d = String(msg.fullDescription || msg.description || '').trim();
            const s = String(msg.siteName || '').trim();
            const parts = [];
            if (t) parts.push(`标题：${t}`);
            if (d) parts.push(`描述：${d}`);
            if (s) parts.push(`站点：${s}`);
            return `[链接卡片] ${parts.join('；')}`;
        }
        case 'system':
            // BUNNY 元交流：user 与系统层，char 不可见
            return `+${String(msg.text || '').trim()}+`;
        default:
            return String(msg.text || '').trim();
    }
}

// 用角色卡拼出"你要扮演谁"的系统提示词
function buildCharacterSystemPrompt(character, variables, userPersona = null) {
    const lines = [
        '你正在一个手机聊天软件（类似微信 / QQ）里扮演一个角色，正在用文字和用户私聊。',
        '请始终以该角色的第一人称身份回复，不要跳出角色，不要解释你是 AI。',
        ''
    ];
    const characterInfo = buildCharacterInfoPrompt(character);
    if (characterInfo) {
        lines.push(characterInfo);
    }
    const scenarioInfo = buildScenarioPrompt(character);
    if (scenarioInfo) {
        lines.push('', scenarioInfo);
    }
    const dialogueExamples = buildDialogueExamplesPrompt(character, variables);
    if (dialogueExamples) {
        lines.push('', dialogueExamples);
    }
    if (character.system_prompt && character.system_prompt.trim()) {
        lines.push('', character.system_prompt.trim());
    }
    const userInfo = buildUserInfoPrompt(userPersona);
    if (userInfo) {
        lines.push('', userInfo);
    }
    lines.push('', `【与你对话的用户】${variables.user}`, `【当前时间】${variables.now}（${variables.weekday}）`);
    lines.push(
        '',
        '【回复规则——必须严格遵守】',
        '1. 只输出你作为角色要"说出口"的聊天内容本身。',
        '2. 严禁任何动作、神态、场景或心理描写；严禁使用括号（）()、星号*、破折号旁白或任何小说式叙述。',
        '3. 像真人发消息一样简短、口语化。把一次要表达的内容拆成若干条短消息，每条单独占一行，用换行分隔，通常 1~4 条。',
        '4. 不要复述或解释用户的话，不要添加任何前后缀说明。'
    );
    const rpRulesTail = buildRpRulesTailPrompt(character);
    if (rpRulesTail) {
        lines.push('', rpRulesTail);
    }
    return renderPromptTemplate(lines.join('\n'), variables);
}

// 从 AI 输出里剥掉 <think>...</think> / <thinking>...</thinking>（含未闭合的）
function stripThinkingTags(text) {
    return String(text || '')
        // 1. 闭合段：成对剥
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        // 2. 兜底：只开不关时，从 tag 处到结尾全砍
        .replace(/<think(?:ing)?>[\s\S]*$/i, '')
        .trim();
}

// 按换行把模型回复拆成多条气泡显示；不做任何"剥旁白"清洗，是否短回复完全由预设提示词决定。
function splitReplyToSegments(text) {
    const segments = String(text || '')
        .split(/\r?\n+/)
        .map(s => s.trim())
        .filter(Boolean);
    if (!segments.length) {
        const fallback = String(text || '').trim();
        return fallback ? [fallback] : [];
    }
    return segments;
}

app.post('/api/qq/reply', async (req, res) => {
    try {
        const { characterId, messages, chatType } = req.body || {};
        const resolvedChatType = chatType === 'group' ? 'group' : 'private';
        if (!characterId) return res.status(400).json({ error: '缺少 characterId' });

        const settings = readJsonFile(SETTINGS_FILE, {});
        const apiUrl = (settings.mainApi_url || '').trim();
        const apiKey = (settings.mainApi_key || '').trim();
        const model = (settings.mainApi_model || '').trim();
        if (!apiUrl || !apiKey || !model) {
            return res.status(400).json({ error: '请先在「设置 / 通用 API」里配置并应用主 API（地址、密钥、模型）' });
        }

        const character = readJsonFile(path.join(CHARACTERS_DIR, `${cleanName(characterId)}.json`), null);
        if (!character) return res.status(404).json({ error: '未找到角色' });

        const list = Array.isArray(messages) ? messages : [];
        const userPersona = getCurrentUserPersona();
        const variables = buildPromptVariables({ characterId, userName: userPersona?.name || '', messages: list });

        // 把 QQ 聊天记录转成 OpenAI 的 messages 格式。
        // 图片只允许本次请求里的最后一张真实 dataURL 进入多模态；其它历史图片只保留 [图片] 占位。
        const latestImageIndex = (() => {
            for (let i = list.length - 1; i >= 0; i--) {
                const m = list[i];
                if (m?.role !== 'assistant' && m?.type === 'image' && /^data:image\//.test(m.image || '')) return i;
            }
            return -1;
        })();
        const history = list
            .map((m, idx) => {
                const role = m.role === 'assistant' ? 'assistant' : 'user';
                if (role === 'user' && m.type === 'image' && idx === latestImageIndex) {
                    return {
                        role,
                        content: [
                            { type: 'text', text: (m.text && m.text !== '[图片]') ? m.text : '[图片]' },
                            { type: 'image_url', image_url: { url: m.image } }
                        ]
                    };
                }
                return { role, content: qqMessageToText(m) };
            })
            .filter(m => Array.isArray(m.content) ? m.content.length : m.content);

        const enrichedHistory = injectCharRulesAtDepth(history, character, variables);
        const presetPrompt = buildQqPresetPrompt(character, variables, userPersona, enrichedHistory, resolvedChatType);
        // 预设按各条目 role 展开为多条消息；没有可用预设时回退到老的单条 system + 历史
        const chatMessages = presetPrompt
            ? (presetPrompt.includesChatHistory ? presetPrompt.messages : [...presetPrompt.messages, ...enrichedHistory])
            : [{ role: 'system', content: buildCharacterSystemPrompt(character, variables, userPersona) }, ...enrichedHistory];

        // 采样参数来自当前 QQ 预设；预设缺字段时回退到温和默认值
        const presetId = getCurrentQqPromptPresetId();
        const presetRaw = presetId ? readJsonFile(stPresetFile(presetId), null) : null;
        const presetSampling = isSillyTavernPreset(presetRaw) ? presetRaw : {};
        const pickNum = (val, fallback) => Number.isFinite(parseFloat(val)) ? parseFloat(val) : fallback;
        const temperature = pickNum(presetSampling.temperature, 1);
        const top_p = pickNum(presetSampling.top_p, 1);
        const frequency_penalty = pickNum(presetSampling.frequency_penalty, 0);
        const presence_penalty = pickNum(presetSampling.presence_penalty, 0);
        const maxReply = Math.min(Math.max(parseInt(presetSampling.openai_max_tokens, 10) || 2048, 1), 200000);

        const endpoint = apiUrl.endsWith('/chat/completions')
            ? apiUrl
            : `${apiUrl.replace(/\/+$/, '')}/chat/completions`;

        // 抗截断设置
        const antiCutoffEnabled = settings.mainApi_antiCutoffEnabled !== false && settings.mainApi_antiCutoffEnabled !== 'false';
        const antiCutoffMax = Math.max(0, Math.min(parseInt(settings.mainApi_antiCutoffMaxRetries, 10) || 2, 5));

        async function callUpstream(messages) {
            const upstream = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model, messages, temperature, max_tokens: maxReply,
                    top_p, frequency_penalty, presence_penalty, stream: false
                })
            });
            const rawText = await upstream.text();
            return { upstream, rawText };
        }

        let cleanedAccumulated = '';        // 已剥离思维链的可见正文
        let rawAccumulatedForRetry = '';    // 原始累加（用于续写时传给模型当 assistant 上下文）
        let finishReason = '';
        let lastRawText = '';
        let workingMessages = chatMessages;
        const attempts = 1 + antiCutoffMax; // 首发 + 抗截断续写次数
        let attemptUsed = 0;
        for (let attempt = 0; attempt < attempts; attempt++) {
            attemptUsed = attempt + 1;
            const { upstream, rawText } = await callUpstream(workingMessages);
            lastRawText = rawText;
            if (!upstream.ok) {
                console.error('[QQ reply upstream error]', upstream.status, rawText.slice(0, 500));
                return res.status(502).json({ error: `模型接口返回 ${upstream.status}`, detail: rawText.slice(0, 2000) });
            }
            let data;
            try { data = JSON.parse(rawText); }
            catch { return res.status(502).json({ error: '模型返回的不是有效 JSON', detail: rawText.slice(0, 500) }); }
            const chunk = (data?.choices?.[0]?.message?.content || '').trim();
            finishReason = data?.choices?.[0]?.finish_reason || '';

            // 关键：每个 chunk 在自己上下文里剥思维链再累加。避免跨 chunk 的未闭合 <think> 把后续好内容连带砍掉
            const chunkCleaned = stripThinkingTags(chunk);
            cleanedAccumulated += (cleanedAccumulated && chunkCleaned ? '\n' : '') + chunkCleaned;
            rawAccumulatedForRetry += chunk;

            // 续写判定
            const shouldRetry = antiCutoffEnabled && attempt < attempts - 1 && (
                finishReason === 'length' ||                    // 被 max_tokens 截
                (!cleanedAccumulated && chunk)                  // 当前累加仍无可见正文
            );
            if (!shouldRetry) break;
            workingMessages = [
                ...workingMessages,
                { role: 'assistant', content: rawAccumulatedForRetry },
                { role: 'user', content: '[续写上面被截断的回复。直接接着说，不要重复已有内容、不要解释、不要任何旁白。]' }
            ];
        }

        if (!rawAccumulatedForRetry) {
            return res.status(502).json({
                error: `模型没有返回内容（finish_reason=${finishReason || '未知'}）`,
                detail: lastRawText.slice(0, 2000)
            });
        }
        const cleaned = cleanedAccumulated.trim();
        if (!cleaned) {
            return res.status(502).json({
                error: `模型只返回了 <think> 思维链，剥离后无可见正文（finish_reason=${finishReason || '未知'}，已尝试 ${attemptUsed} 次）`,
                detail: lastRawText.slice(0, 2000)
            });
        }
        const segments = splitReplyToSegments(cleaned);
        if (!segments.length) {
            return res.status(502).json({
                error: '清洗后切不出有效气泡段',
                detail: lastRawText.slice(0, 2000)
            });
        }
        // 后台推送：SW 收到后决定是否弹（焦点客户端会被 SW 跳过）
        sendWebPushToAll({
            title: character.name || '蒋幸怜',
            body: String(segments[0] || '').slice(0, 120),
            kind: 'success',
            characterId,
            characterName: character.name || '',
            avatar: character.avatar || '',
            appId: 'QQ'
        }).catch(err => console.warn('[PUSH after reply]', err));
        res.json({ segments, reply: cleaned });
    } catch (e) {
        console.error('[QQ reply error]', e);
        res.status(500).json({ error: '生成回复失败：' + (e.message || '未知错误') });
    }
});

// Web Push: 提供 VAPID 公钥
app.get('/api/notify/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_KEYS.publicKey });
});

// Web Push: 订阅（前端 swReg.pushManager.subscribe 后调用）
app.post('/api/notify/subscribe', (req, res) => {
    try {
        const sub = req.body?.subscription;
        if (!sub || !sub.endpoint) return res.status(400).json({ error: '订阅信息缺失' });
        const subs = readPushSubscriptions();
        if (!subs.find(s => s.endpoint === sub.endpoint)) {
            subs.push(sub);
            writePushSubscriptions(subs);
        }
        res.json({ success: true, total: subs.length });
    } catch (e) {
        res.status(500).json({ error: '保存订阅失败' });
    }
});

// Web Push: 取消订阅
app.post('/api/notify/unsubscribe', (req, res) => {
    try {
        const endpoint = req.body?.endpoint;
        if (!endpoint) return res.status(400).json({ error: '缺少 endpoint' });
        const subs = readPushSubscriptions().filter(s => s.endpoint !== endpoint);
        writePushSubscriptions(subs);
        res.json({ success: true, total: subs.length });
    } catch (e) {
        res.status(500).json({ error: '删除订阅失败' });
    }
});

// Web Push: 查询订阅数量
app.get('/api/notify/subscriptions', (req, res) => {
    res.json({ total: readPushSubscriptions().length });
});

// Web Push: 测试推送
app.post('/api/notify/test', async (req, res) => {
    const result = await sendWebPushToAll({
        title: 'BunnyOS 测试推送',
        body: '如果你看到这条系统通知，说明 Web Push 已正常工作。',
        kind: 'success',
        characterId: '',
        appId: 'QQ'
    });
    res.json({ success: true, ...result });
});

// AI 代回（impersonate）：用当前预设拼装上下文，追加代回指令，返回纯文本
app.post('/api/qq/impersonate', async (req, res) => {
    try {
        const { characterId, messages, chatType } = req.body || {};
        const resolvedChatType = chatType === 'group' ? 'group' : 'private';
        if (!characterId) return res.status(400).json({ error: '缺少 characterId' });
        const settings = readJsonFile(SETTINGS_FILE, {});
        const apiUrl = (settings.mainApi_url || '').trim();
        const apiKey = (settings.mainApi_key || '').trim();
        const model = (settings.mainApi_model || '').trim();
        if (!apiUrl || !apiKey || !model) return res.status(400).json({ error: '请先在设置里配置主 API' });
        const character = readJsonFile(path.join(CHARACTERS_DIR, `${cleanName(characterId)}.json`), null);
        if (!character) return res.status(404).json({ error: '未找到角色' });
        const list = Array.isArray(messages) ? messages : [];
        const userPersona = getCurrentUserPersona();
        const variables = buildPromptVariables({ characterId, userName: userPersona?.name || '', messages: list });
        const history = list
            .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: qqMessageToText(m) }))
            .filter(m => m.content);
        const enrichedHistory = injectCharRulesAtDepth(history, character, variables);
        const presetPrompt = buildQqPresetPrompt(character, variables, userPersona, enrichedHistory, resolvedChatType);
        const baseMessages = presetPrompt
            ? (presetPrompt.includesChatHistory ? presetPrompt.messages : [...presetPrompt.messages, ...enrichedHistory])
            : [{ role: 'system', content: buildCharacterSystemPrompt(character, variables, userPersona) }, ...enrichedHistory];

        // 末尾追加代回指令，让模型从 user 视角输出
        baseMessages.push({
            role: 'system',
            content: '学习user_input中user的语言习惯，代替user拟出回复。注意：user是独立人格成年人，禁止娇妻化塑造user。只输出user会发出的纯文字内容，不要任何动作、神态、括号旁白。'
        });

        // 采样参数同 reply：走预设
        const presetId = getCurrentQqPromptPresetId();
        const presetRaw = presetId ? readJsonFile(stPresetFile(presetId), null) : null;
        const presetSampling = isSillyTavernPreset(presetRaw) ? presetRaw : {};
        const pickNum = (val, fallback) => Number.isFinite(parseFloat(val)) ? parseFloat(val) : fallback;
        const temperature = pickNum(presetSampling.temperature, 1);
        const top_p = pickNum(presetSampling.top_p, 1);
        const frequency_penalty = pickNum(presetSampling.frequency_penalty, 0);
        const presence_penalty = pickNum(presetSampling.presence_penalty, 0);
        const maxReply = Math.min(Math.max(parseInt(presetSampling.openai_max_tokens, 10) || 2048, 1), 200000);
        const endpoint = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl.replace(/\/+$/, '')}/chat/completions`;
        const upstream = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: baseMessages, temperature, max_tokens: maxReply, top_p, frequency_penalty, presence_penalty, stream: false })
        });
        const rawText = await upstream.text();
        if (!upstream.ok) return res.status(502).json({ error: `模型接口返回 ${upstream.status}`, detail: rawText.slice(0, 500) });
        let data;
        try { data = JSON.parse(rawText); }
        catch { return res.status(502).json({ error: '模型返回的不是有效 JSON' }); }
        const reply = data?.choices?.[0]?.message?.content?.trim();
        const finishReason = data?.choices?.[0]?.finish_reason;
        if (!reply) return res.status(502).json({
            error: `模型没有返回内容（finish_reason=${finishReason || '未知'}）`,
            detail: rawText.slice(0, 2000)
        });
        const cleaned = stripThinkingTags(reply);
        if (!cleaned) return res.status(502).json({
            error: `代回只返回了 <think> 思维链，剥离后无可见正文`,
            detail: rawText.slice(0, 2000)
        });
        res.json({ text: cleaned });
    } catch (e) {
        console.error('[impersonate]', e);
        res.status(500).json({ error: e.message || '代回失败' });
    }
});

app.listen(PORT, () => {
    console.log('===========================================');
    console.log(`[BunnyOS v2-qq-413debug] booted ${new Date().toISOString()}`);
    console.log(`  body limit: 200mb (json + urlencoded)`);
    console.log(`  QQ routes:  /api/qq/characters, /api/qq/groups`);
    console.log(`  url:        http://localhost:${PORT}/index.html`);
    console.log('===========================================');
});

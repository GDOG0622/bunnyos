const path = require('path');

function createQqSummaryFeature(dependencies) {
    const {
        app, SETTINGS_FILE, CHARACTERS_DIR, CHATS_DIR,
        cleanName, shortId, readJsonFile, writeJsonFile, readWorldbooks, writeWorldbooks,
        getCurrentUserPersona, qqMessageToPromptText, stripThinkingTags, sanitizeErrorDetail,
        buildUpstreamErrorPayload, buildInternalErrorPayload,
    } = dependencies;

// ========== QQ 分层总结 / 记忆世界书 ==========
const DEFAULT_SUMMARY_LAYER_THRESHOLD = 100;
const SUMMARY_BATCH_CARD_COUNT = 5;
const SUMMARY_PROMPT = `你是一个善于总结的总结助手。你的任务是模拟人类的记忆机制，对记忆进行分层处理，不带任何评判地客观地总结你读到的所有内容。

## 通用规则：
- 只描述具体行为和场景的变化，禁止使用性格评价词（如占有欲、强势、支柱、保护者、温柔、理性等抽象形容词）。例如不要写“表现出强势的占有欲”，而要写“在xx场合下做了xx事，说了xx话”。
- 每个部分精简概括但又能让人回想起当时的情景，不应提及日常琐事。对于做爱场景应以一句“发生性关系”带过，不详细复述过程。
- 去AI味，不可使用AI常用词汇；禁止使用极端词汇，保持用词保守客观。
- 尽量使用中国现当代文学的文学性语言表达。

## 总结要求
### 1. 内容提取要求
- 仔细识别和提取上下文中的所有重要事件、对话、决定、承诺和关键信息。
- 按时间顺序整理所有事件。
- 对于每个事件，提供简洁但信息完整的描述。
- 保留严肃的立场发言、高光对话、尚未完成的约定，以及其他可能影响后续剧情的关键对话。
- 对于做爱过程用“发生性关系”概括即可。

### 2. 用户和角色识别
- 准确识别<user>（用户）和<char>（角色）。
- 如果上下文中有多个角色，明确区分主要角色。
- 确定当前总结的时间段范围。

## 输出格式要求
严格按照以下模板输出：
<summary>
Title:小总结：<user>【<char>】:\${当前总结时间段}
· YYYY-MM-DD：{150字记录这一天发生的事，需要包括地点/场景、所包含人物、事件来龙去脉。需尽量具体不可一概而过。}

**讨论过的话题：**
· YYYY-MM-DD：{150字以内记录聊的话题，包括双方观点和最终讨论结果。如没有，则空}

**高光对白：**
· \${<char>or<user>}: \${记录下比较touching或者承诺的话。或能体现说话者立场的话。如没有，则空}

**关于{{user}}的小事：**
· \${提炼在这段时间内，<char>发现的关于<user>的具体小事。只记录可在日后对话中用到的规律性行为、事件或较大生活变化；禁止记录模糊评价以及人设中已经包含的内容。}

</summary>

## 质量标准
1. 完整性：确保所有重要事件都被记录。
2. 准确性：时间、人物、事件描述准确无误。
3. 简洁性：描述简洁但信息充分。
4. 逻辑性：事件按时间顺序合理排列。
5. 一致性：格式严格遵循模板要求。
6. 去AI常用词：整体不可看出AI味。`;

function clampSummaryThreshold(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 5000)) : DEFAULT_SUMMARY_LAYER_THRESHOLD;
}

function qqSummaryLayers(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const layers = [];
    let previousRole = '';
    let previousAssistantGroup = '';
    let current = null;
    for (let index = 0; index < list.length; index++) {
        const message = list[index];
        if (message?.summary_archived === true) continue;
        if (message?.type === 'system') {
            if (current) current.indices.push(index);
            continue;
        }
        const role = message?.role === 'assistant' ? 'assistant' : 'user';
        const assistantGroup = role === 'assistant' ? String(message?.reply_group_id || '') : '';
        const assistantBoundary = role === 'assistant'
            && previousRole === 'assistant'
            && assistantGroup !== previousAssistantGroup
            && Boolean(assistantGroup || previousAssistantGroup);
        if (!current || role !== previousRole || assistantBoundary) {
            current = { role, indices: [] };
            layers.push(current);
        }
        current.indices.push(index);
        previousRole = role;
        previousAssistantGroup = assistantGroup;
    }
    return layers;
}

function summaryDateLabel(timestamp) {
    const date = Number(timestamp);
    if (!Number.isFinite(date)) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(date)).replaceAll('/', '-');
}

function summaryContextText(messages, layers, character, userPersona) {
    const userName = userPersona?.name || 'user';
    const charName = character?.name || 'char';
    const indexes = layers.flatMap(layer => layer.indices).sort((a, b) => a - b);
    return indexes.map(index => {
        const message = messages[index];
        const speaker = message?.role === 'assistant' ? charName : userName;
        return `[${summaryDateLabel(message?.created_at)}] ${speaker}: ${qqMessageToPromptText(messages, index)}`;
    }).join('\n');
}

function summaryApiConfig(settings) {
    const selected = String(settings.subApi_config || '');
    const saved = settings.apiConfigs?.[selected] || {};
    return {
        apiUrl: String(settings.subApi_url || saved.url || '').trim(),
        apiKey: String(settings.subApi_key || saved.key || '').trim(),
        model: String(settings.subApi_model || saved.model || '').trim(),
        temperature: Number.isFinite(parseFloat(settings.subApi_temperature)) ? parseFloat(settings.subApi_temperature) : 0.7,
        top_p: Number.isFinite(parseFloat(settings.subApi_topP)) ? parseFloat(settings.subApi_topP) : 1,
        frequency_penalty: Number.isFinite(parseFloat(settings.subApi_frequencyPenalty)) ? parseFloat(settings.subApi_frequencyPenalty) : 0,
        presence_penalty: Number.isFinite(parseFloat(settings.subApi_presencePenalty)) ? parseFloat(settings.subApi_presencePenalty) : 0,
        max_tokens: Math.max(1, Math.min(parseInt(settings.subApi_maxReply, 10) || 2048, 200000)),
    };
}

async function requestSummaryFromSecondaryApi(context, instruction = '') {
    const settings = readJsonFile(SETTINGS_FILE, {});
    const config = summaryApiConfig(settings);
    if (!config.apiUrl || !config.apiKey || !config.model) {
        const error = new Error('请先在“设置 → 副 API”中选择并应用 API 配置');
        error.status = 400;
        error.payload = {
            error: error.message, error_code: 'SUB_API_NOT_CONFIGURED',
            error_type: 'configuration_error', operation: 'summarize'
        };
        throw error;
    }
    const endpoint = config.apiUrl.endsWith('/chat/completions')
        ? config.apiUrl
        : `${config.apiUrl.replace(/\/+$/, '')}/chat/completions`;
    const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: SUMMARY_PROMPT },
                { role: 'user', content: `${instruction ? `${instruction}\n\n` : ''}以下是需要总结的内容：\n${context}` }
            ],
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            top_p: config.top_p,
            frequency_penalty: config.frequency_penalty,
            presence_penalty: config.presence_penalty,
            stream: false
        })
    });
    const rawText = await upstream.text();
    if (!upstream.ok) {
        const error = new Error('副 API 总结失败');
        error.status = 502;
        error.payload = buildUpstreamErrorPayload({ upstream, rawText, model: config.model, operation: 'summarize' });
        throw error;
    }
    let data;
    try { data = JSON.parse(rawText); } catch {
        const error = new Error('副 API 返回的不是有效 JSON');
        error.status = 502;
        error.payload = {
            error: error.message, error_code: 'INVALID_SUMMARY_UPSTREAM_JSON',
            error_type: 'invalid_response_error', operation: 'summarize', detail: sanitizeErrorDetail(rawText)
        };
        throw error;
    }
    const content = stripThinkingTags(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
        const error = new Error('副 API 没有返回总结正文');
        error.status = 502;
        error.payload = {
            error: error.message, error_code: 'EMPTY_SUMMARY_RESPONSE',
            error_type: 'empty_response_error', operation: 'summarize', detail: sanitizeErrorDetail(rawText)
        };
        throw error;
    }
    return content;
}

function ensureSummaryWorldbook(character, characterFile) {
    const books = readWorldbooks();
    let book = character?.summaryWorldbookId
        ? books.find(item => item.id === character.summaryWorldbookId)
        : null;
    if (!book) {
        const now = Date.now();
        book = {
            id: `book_${shortId()}`,
            name: `${character?.name || '角色'}的记忆`,
            entries: [], created_at: now, updated_at: now
        };
        books.unshift(book);
        character.summaryWorldbookId = book.id;
        writeWorldbooks(books);
        writeJsonFile(characterFile, character);
    }
    return { books, book };
}

function activeSmallSummaryEntries(book, characterId) {
    return (Array.isArray(book?.entries) ? book.entries : [])
        .filter(entry => entry?.enabled !== false && entry?.summaryType === 'small' && entry?.summaryCharacterId === characterId)
        .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
}

app.get('/api/qq/summary-settings/:characterId', (req, res) => {
    try {
        const characterId = cleanName(req.params.characterId);
        const character = readJsonFile(path.join(CHARACTERS_DIR, `${characterId}.json`), null);
        if (!character) return res.status(404).json({ error: '未找到角色', error_code: 'CHARACTER_NOT_FOUND' });
        const chat = readJsonFile(path.join(CHATS_DIR, `${characterId}.json`), { messages: [] });
        const book = readWorldbooks().find(item => item.id === character.summaryWorldbookId);
        res.json({
            layerThreshold: clampSummaryThreshold(chat.summaryLayerThreshold),
            summaryWorldbookId: character.summaryWorldbookId || '',
            unsummarizedLayers: qqSummaryLayers(chat.messages).length,
            activeSmallCards: activeSmallSummaryEntries(book, characterId).length,
        });
    } catch (error) {
        res.status(500).json(buildInternalErrorPayload(error, 'summary-settings'));
    }
});

app.put('/api/qq/summary-settings/:characterId', (req, res) => {
    try {
        const characterId = cleanName(req.params.characterId);
        const characterFile = path.join(CHARACTERS_DIR, `${characterId}.json`);
        const character = readJsonFile(characterFile, null);
        if (!character) return res.status(404).json({ error: '未找到角色', error_code: 'CHARACTER_NOT_FOUND' });
        const summaryWorldbookId = String(req.body?.summaryWorldbookId || '');
        if (summaryWorldbookId && !readWorldbooks().some(book => book.id === summaryWorldbookId)) {
            return res.status(400).json({ error: '选择的总结世界书不存在', error_code: 'SUMMARY_WORLDBOOK_NOT_FOUND' });
        }
        character.summaryWorldbookId = summaryWorldbookId;
        writeJsonFile(characterFile, character);
        const chatFile = path.join(CHATS_DIR, `${characterId}.json`);
        const chat = readJsonFile(chatFile, { characterId, messages: [] });
        chat.summaryLayerThreshold = clampSummaryThreshold(req.body?.layerThreshold);
        writeJsonFile(chatFile, chat);
        res.json({ success: true, layerThreshold: chat.summaryLayerThreshold, summaryWorldbookId });
    } catch (error) {
        res.status(500).json(buildInternalErrorPayload(error, 'summary-settings'));
    }
});

app.post('/api/qq/summarize', async (req, res) => {
    try {
        const characterId = cleanName(req.body?.characterId || '');
        const characterFile = path.join(CHARACTERS_DIR, `${characterId}.json`);
        const chatFile = path.join(CHATS_DIR, `${characterId}.json`);
        const character = readJsonFile(characterFile, null);
        const chat = readJsonFile(chatFile, null);
        if (!character || !chat) return res.status(404).json({ error: '角色或聊天不存在', error_code: 'SUMMARY_TARGET_NOT_FOUND' });
        const threshold = clampSummaryThreshold(chat.summaryLayerThreshold);
        const layers = qqSummaryLayers(chat.messages);
        if (layers.length <= threshold) {
            return res.json({ triggered: false, unsummarizedLayers: layers.length, layerThreshold: threshold });
        }
        const targetLayers = layers.slice(0, threshold);
        const userPersona = getCurrentUserPersona();
        const context = summaryContextText(chat.messages, targetLayers, character, userPersona);
        const content = await requestSummaryFromSecondaryApi(
            context,
            `当前<user>是“${userPersona?.name || 'user'}”，当前<char>是“${character.name || 'char'}”。请用实际名字替换模板中的<user>和<char>。`
        );
        const { books, book } = ensureSummaryWorldbook(character, characterFile);
        const allIndexes = targetLayers.flatMap(layer => layer.indices).sort((a, b) => a - b);
        const firstMessage = chat.messages[allIndexes[0]];
        const lastMessage = chat.messages[allIndexes[allIndexes.length - 1]];
        const now = Date.now();
        const entry = {
            id: `e_${shortId()}`,
            name: `小总结 ${summaryDateLabel(firstMessage?.created_at)} ～ ${summaryDateLabel(lastMessage?.created_at)}`,
            content, enabled: true,
            summaryType: 'small', summaryCharacterId: characterId,
            sourceStartAt: firstMessage?.created_at || 0,
            sourceEndAt: lastMessage?.created_at || 0,
            sourceLayerCount: targetLayers.length,
            created_at: now, updated_at: now,
        };
        book.entries = Array.isArray(book.entries) ? book.entries : [];
        book.entries.push(entry);
        book.updated_at = now;
        writeWorldbooks(books);
        allIndexes.forEach(index => { if (chat.messages[index]) chat.messages[index].summary_archived = true; });
        chat.summaryLayerThreshold = threshold;
        chat.lastSummaryAt = now;
        chat.updated_at = now;
        writeJsonFile(chatFile, chat);
        const activeCards = activeSmallSummaryEntries(book, characterId);
        res.json({
            triggered: true,
            entry,
            summaryWorldbookId: book.id,
            summaryWorldbookName: book.name,
            archivedMessageIndexes: allIndexes,
            activeSmallCards: activeCards.length,
            needsBigSummary: activeCards.length >= SUMMARY_BATCH_CARD_COUNT,
            unsummarizedLayers: qqSummaryLayers(chat.messages).length,
        });
    } catch (error) {
        console.error('[QQ summarize]', error);
        res.status(error.status || 500).json(error.payload || buildInternalErrorPayload(error, 'summarize'));
    }
});

app.post('/api/qq/summarize/big/preview', async (req, res) => {
    try {
        const characterId = cleanName(req.body?.characterId || '');
        const character = readJsonFile(path.join(CHARACTERS_DIR, `${characterId}.json`), null);
        const books = readWorldbooks();
        const book = books.find(item => item.id === character?.summaryWorldbookId);
        if (!book) return res.status(400).json({ error: '尚未绑定总结世界书', error_code: 'SUMMARY_WORLDBOOK_NOT_BOUND' });
        const entries = activeSmallSummaryEntries(book, characterId).slice(-SUMMARY_BATCH_CARD_COUNT);
        if (entries.length < SUMMARY_BATCH_CARD_COUNT) {
            return res.status(400).json({ error: '不足 5 个启用的小总结', error_code: 'NOT_ENOUGH_SMALL_SUMMARIES' });
        }
        const context = entries.map((entry, index) => `【小总结 ${index + 1}】\n${entry.content}`).join('\n\n');
        const content = await requestSummaryFromSecondaryApi(
            context,
            `下面是“${character.name || 'char'}”与user时间连续的5个小总结。请合并为一张大总结卡片，标题必须以“Title:大总结：”开头。去除重复内容，但不得遗漏会影响后续关系和剧情的事件、决定、承诺、高光对白及关于user的小事。`
        );
        res.json({ content, sourceEntryIds: entries.map(entry => entry.id) });
    } catch (error) {
        console.error('[QQ big summary preview]', error);
        res.status(error.status || 500).json(error.payload || buildInternalErrorPayload(error, 'summarize-big-preview'));
    }
});

app.post('/api/qq/summarize/big/confirm', (req, res) => {
    try {
        const characterId = cleanName(req.body?.characterId || '');
        const content = String(req.body?.content || '').trim();
        const sourceEntryIds = Array.isArray(req.body?.sourceEntryIds) ? req.body.sourceEntryIds.map(String) : [];
        if (!content) return res.status(400).json({ error: '大总结内容不能为空', error_code: 'EMPTY_BIG_SUMMARY' });
        if (sourceEntryIds.length !== SUMMARY_BATCH_CARD_COUNT) {
            return res.status(400).json({ error: '大总结必须对应 5 个小总结', error_code: 'INVALID_BIG_SUMMARY_SOURCE_COUNT' });
        }
        const character = readJsonFile(path.join(CHARACTERS_DIR, `${characterId}.json`), null);
        const books = readWorldbooks();
        const book = books.find(item => item.id === character?.summaryWorldbookId);
        if (!book) return res.status(400).json({ error: '尚未绑定总结世界书', error_code: 'SUMMARY_WORLDBOOK_NOT_BOUND' });
        const selected = (book.entries || []).filter(entry => sourceEntryIds.includes(String(entry.id)));
        if (selected.length !== SUMMARY_BATCH_CARD_COUNT || selected.some(entry => entry.enabled === false || entry.summaryType !== 'small' || entry.summaryCharacterId !== characterId)) {
            return res.status(409).json({ error: '组成大总结的小总结已发生变化，请重新生成', error_code: 'SUMMARY_SOURCE_CHANGED' });
        }
        const now = Date.now();
        selected.forEach(entry => { entry.enabled = false; entry.closedByBigSummaryAt = now; entry.updated_at = now; });
        const entry = {
            id: `e_${shortId()}`,
            name: `大总结 ${summaryDateLabel(selected[0]?.sourceStartAt)} ～ ${summaryDateLabel(selected[selected.length - 1]?.sourceEndAt)}`,
            content, enabled: true,
            summaryType: 'big', summaryCharacterId: characterId,
            sourceEntryIds, created_at: now, updated_at: now,
        };
        book.entries.push(entry);
        book.updated_at = now;
        writeWorldbooks(books);
        res.json({ success: true, entry, disabledEntryIds: sourceEntryIds });
    } catch (error) {
        res.status(500).json(buildInternalErrorPayload(error, 'summarize-big-confirm'));
    }
});


    function filterPromptMessages(messages) {
        return (Array.isArray(messages) ? messages : [])
            .filter(message => message?.summary_archived !== true);
    }

    return { filterPromptMessages };
}

module.exports = { createQqSummaryFeature };

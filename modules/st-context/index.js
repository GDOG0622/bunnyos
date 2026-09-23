'use strict';

const { activateWorldInfo } = require('./world-info');
const {
    preparePrompts,
    injectInChatPrompts,
    mergeAdjacentSystemMessages
} = require('./prompt-manager');
const {
    countMessages,
    createTokenCounter,
    trimHistoryToBudget
} = require('./token-budget');

function joinBlocks(blocks, wrapper = '') {
    const content = (Array.isArray(blocks) ? blocks : []).map(String).map(value => value.trim()).filter(Boolean).join('\n\n');
    if (!content || !wrapper) return content;
    return `<${wrapper}>\n${content}\n</${wrapper}>`;
}

function getGlobalScanData(character, persona, generationType) {
    return {
        personaDescription: persona?.prompt || '',
        characterDescription: character?.char_info || character?.role_setting || character?.description || '',
        characterPersonality: character?.other_setting || character?.nsfw_setting || '',
        characterDepthPrompt: character?.rp_rules || character?.personality || '',
        scenario: character?.scenario || '',
        creatorNotes: character?.creator_notes || '',
        trigger: generationType
    };
}

function buildStContext(options = {}) {
    const {
        preset,
        character,
        persona,
        history = [],
        books = {},
        generationType = 'normal',
        contextTokens = 8192,
        responseTokens = 2048,
        worldInfoSettings = {},
        render = value => value,
        resolveBuiltin = () => '',
        tokenCounter,
        textTokenCounter,
        tokenizerInfo = null,
        pinExamples = false,
        additionalInChat = [],
        tailPrompt = '',
        legacyMemoryContent = ''
    } = options;
    const counter = createTokenCounter(tokenCounter);
    const maxPromptTokens = Math.max(1, Math.trunc(Number(contextTokens) || 8192) - Math.max(1, Math.trunc(Number(responseTokens) || 2048)));
    const worldInfo = activateWorldInfo({
        books,
        history: history.map(message => ({
            ...message,
            name: (worldInfoSettings.world_info_include_names ?? true)
                ? (message.role === 'assistant' ? character?.name : persona?.name)
                : ''
        })),
        contextTokens: Math.max(1, Number(contextTokens) || 8192),
        settings: worldInfoSettings,
        generationType,
        render,
        countText: typeof textTokenCounter === 'function' ? textTokenCounter : undefined,
        globalScanData: getGlobalScanData(character, persona, generationType)
    });

    const markerValues = {
        worldInfoBefore: [joinBlocks(worldInfo.before), String(legacyMemoryContent || '').trim()].filter(Boolean).join('\n\n'),
        worldInfoAfter: joinBlocks(worldInfo.after)
    };
    const renderWithOutlets = value => render(String(value || '').replace(/\{\{\s*outlet::([^}]+)\}\}/gi, (_match, name) => {
        return joinBlocks(worldInfo.outlets[String(name).trim()] || []);
    }));
    const resolveMarker = (identifier, sourcePrompt) => {
        if (Object.prototype.hasOwnProperty.call(markerValues, identifier)) return markerValues[identifier];
        let value = resolveBuiltin(identifier, worldInfo, sourcePrompt);
        if (identifier === 'dialogueExamples') {
            value = [joinBlocks(worldInfo.examplesTop), value, joinBlocks(worldInfo.examplesBottom)].filter(Boolean).join('\n\n');
        }
        if (identifier === 'authorsNote') {
            value = [joinBlocks(worldInfo.authorsNoteTop), value, joinBlocks(worldInfo.authorsNoteBottom)].filter(Boolean).join('\n\n');
        }
        return value;
    };
    const prepared = preparePrompts({
        preset,
        characterId: character?.id ?? character?.character_id ?? 100001,
        generationType,
        resolveMarker,
        render: renderWithOutlets
    });

    const injectedPrompts = [
        ...prepared.inChat,
        ...(Array.isArray(additionalInChat) ? additionalInChat : []),
        ...worldInfo.depth.map((entry, index) => ({
            identifier: `worldInfoDepth-${index}`,
            role: entry.role,
            content: entry.content,
            injection_depth: entry.depth,
            injection_order: entry.order
        }))
    ];
    const injectedHistory = injectInChatPrompts(history, injectedPrompts);

    const optionalExamplePrompts = pinExamples ? [] : prepared.relative.filter(prompt => prompt.identifier === 'dialogueExamples');
    const relativeWithoutHistory = prepared.relative.filter(prompt => prompt.identifier !== 'chatHistory' && (pinExamples || prompt.identifier !== 'dialogueExamples'));
    const fixedMessages = relativeWithoutHistory.map(prompt => ({
        role: prompt.role,
        content: prompt.content,
        meta: [{ type: 'prompt', identifier: prompt.identifier, position: 'relative', sequence: prompt.sequence }]
    }));
    const hasChatHistoryMarker = prepared.relative.some(prompt => prompt.identifier === 'chatHistory');
    const historyTags = hasChatHistoryMarker ? [
        { role: 'system', content: '<chat_history>' },
        { role: 'system', content: '</chat_history>' }
    ] : [];
    const tailMessage = String(tailPrompt || '').trim() ? { role: 'system', content: String(tailPrompt).trim() } : null;
    const fixedTokens = countMessages([...fixedMessages, ...historyTags, ...(tailMessage ? [tailMessage] : [])], counter);
    const remaining = Math.max(0, maxPromptTokens - fixedTokens);
    let historyTrim = hasChatHistoryMarker
        ? trimHistoryToBudget(injectedHistory, remaining, counter)
        : { messages: [], usedTokens: 0, dropped: injectedHistory.length };
    // Some upstreams reject a request made entirely of system messages. If fixed
    // prompts exhaust the configured budget, keep the latest real user turn.
    const hasUserTurn = historyTrim.messages.some(message => message.role === 'user' && message.content);
    const latestUserTurn = !hasUserTurn && hasChatHistoryMarker
        ? [...injectedHistory].reverse().find(message => message.role === 'user' && message.content)
        : null;
    if (latestUserTurn) {
        historyTrim = {
            messages: [latestUserTurn],
            usedTokens: Math.max(0, Number(counter(latestUserTurn)) || 0),
            dropped: injectedHistory.length - 1
        };
    }
    const exampleMessages = optionalExamplePrompts.map(prompt => ({ role: prompt.role, content: prompt.content }));
    const exampleTokens = optionalExamplePrompts.length ? countMessages(exampleMessages, counter) - 3 : 0;
    const includeOptionalExamples = !optionalExamplePrompts.length || historyTrim.usedTokens + exampleTokens <= remaining;

    const chatMarkerIndex = prepared.relative.findIndex(prompt => prompt.identifier === 'chatHistory');
    const assembled = [];
    if (chatMarkerIndex < 0) {
        assembled.push(...fixedMessages);
        if (includeOptionalExamples) assembled.push(...exampleMessages);
    } else {
        for (const prompt of prepared.relative) {
            if (prompt.identifier === 'chatHistory') assembled.push(historyTags[0], ...historyTrim.messages, historyTags[1]);
            else if (prompt.identifier === 'dialogueExamples' && !pinExamples && !includeOptionalExamples) continue;
            else assembled.push({
                role: prompt.role,
                content: prompt.content,
                meta: [{ type: 'prompt', identifier: prompt.identifier, position: 'relative', sequence: prompt.sequence }]
            });
        }
    }

    const messages = mergeAdjacentSystemMessages(assembled).map(({ meta, ...message }) => message);
    if (tailMessage) messages.push(tailMessage);
    const itemization = {
        contextTokens: Math.max(1, Number(contextTokens) || 8192),
        responseTokens: Math.max(1, Number(responseTokens) || 2048),
        promptBudget: maxPromptTokens,
        estimatedPromptTokens: countMessages(messages, counter),
        fixedPromptTokens: fixedTokens,
        historyTokens: historyTrim.usedTokens,
        historyIncluded: historyTrim.messages.length,
        historyDropped: historyTrim.dropped,
        examplesIncluded: pinExamples || includeOptionalExamples,
        examplesTokens: includeOptionalExamples ? exampleTokens : 0,
        worldInfo: {
            ...worldInfo.budget,
            activated: worldInfo.activated
        },
        generationType,
        tokenizer: tokenizerInfo || { family: tokenCounter ? 'custom' : 'estimate', resolvedModel: tokenCounter ? 'custom' : 'conservative-estimate', exact: !!tokenCounter },
        pinExamples: !!pinExamples,
        prompts: prepared.relative.map(prompt => {
            const included = prompt.identifier !== 'dialogueExamples' || pinExamples || includeOptionalExamples;
            const tokens = prompt.identifier === 'chatHistory'
                ? historyTrim.usedTokens
                : Math.max(0, Number(counter({ role: prompt.role, content: prompt.content })) || 0);
            return {
                identifier: prompt.identifier,
                role: prompt.role,
                position: 'relative',
                enabled: included,
                tokens: included ? tokens : 0
            };
        }).concat(injectedPrompts.map(prompt => ({
            identifier: prompt.identifier,
            role: prompt.role,
            position: 'in_chat',
            depth: Math.max(0, Number(prompt.injection_depth) || 0),
            order: Number(prompt.injection_order) || 100,
            enabled: historyTrim.messages.some(message => message?.meta?.some?.(meta => meta.identifier === prompt.identifier)),
            tokens: Math.max(0, Number(counter({ role: prompt.role, content: prompt.content })) || 0)
        })))
    };
    const warnings = [];
    if (fixedTokens > maxPromptTokens) warnings.push('固定提示词已超过可用上下文预算，聊天记录将被裁剪。');
    if (latestUserTurn) warnings.push('固定提示词占满上下文预算，已优先保留最近一条用户消息；请提高上下文长度或精简固定内容。');
    if (worldInfo.budget.overflowed) warnings.push('世界书已达到独立预算上限，部分命中条目未注入。');
    return { messages, itemization, warnings, worldInfo };
}

module.exports = {
    buildStContext,
    ...require('./constants'),
    ...require('./prompt-manager'),
    ...require('./token-budget'),
    ...require('./world-info')
};

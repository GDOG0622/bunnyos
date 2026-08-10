'use strict';

function contentText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return String(content || '');
    return content.map(part => {
        if (part?.type === 'text') return String(part.text || '');
        if (part?.type === 'image_url') return '[image]';
        return '';
    }).join('\n');
}

// 与 ST 一样把计数器做成可替换依赖。没有模型专用 tokenizer 时使用偏保守估算，
// 避免中文按“4 字符约 1 token”的英文经验造成严重超预算。
function estimateTextTokens(value) {
    const text = String(value || '');
    if (!text) return 0;
    let ascii = 0;
    let nonAscii = 0;
    for (const ch of text) {
        if (ch.codePointAt(0) <= 0x7f) ascii += 1;
        else nonAscii += 1;
    }
    return Math.max(1, Math.ceil(ascii / 3.5) + Math.ceil(nonAscii / 1.5));
}

function estimateMessageTokens(message) {
    return 4 + estimateTextTokens(message?.role) + estimateTextTokens(message?.name) + estimateTextTokens(contentText(message?.content));
}

function createTokenCounter(counter) {
    return typeof counter === 'function' ? counter : estimateMessageTokens;
}

function countMessages(messages, counter) {
    const count = createTokenCounter(counter);
    return (Array.isArray(messages) ? messages : []).reduce((sum, message) => sum + Math.max(0, Number(count(message)) || 0), 3);
}

function trimHistoryToBudget(history, availableTokens, counter) {
    const count = createTokenCounter(counter);
    const source = Array.isArray(history) ? history : [];
    const kept = [];
    let used = 0;
    for (let index = source.length - 1; index >= 0; index -= 1) {
        const tokens = Math.max(0, Number(count(source[index])) || 0);
        if (used + tokens > availableTokens) break;
        kept.unshift(source[index]);
        used += tokens;
    }
    return { messages: kept, usedTokens: used, dropped: source.length - kept.length };
}

module.exports = {
    contentText,
    estimateTextTokens,
    estimateMessageTokens,
    createTokenCounter,
    countMessages,
    trimHistoryToBudget
};

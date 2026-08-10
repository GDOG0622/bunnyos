'use strict';

const { GENERATION_TYPES, INJECTION_POSITION } = require('./constants');

function safeRole(role) {
    return ['system', 'user', 'assistant'].includes(role) ? role : 'system';
}

function normalizeTriggers(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(',');
    return raw.map(item => String(item).trim().toLowerCase()).filter(item => GENERATION_TYPES.includes(item));
}

function isPromptTriggered(prompt, generationType) {
    const triggers = normalizeTriggers(prompt?.injection_trigger);
    return !triggers.length || triggers.includes(generationType);
}

function mergeAdjacentSystemMessages(messages) {
    const output = [];
    for (const message of messages) {
        if (!message || !message.content) continue;
        const previous = output[output.length - 1];
        if (previous?.role === 'system' && message.role === 'system' && !previous.name && !message.name) {
            previous.content = `${previous.content}\n${message.content}`;
            previous.meta = [...(previous.meta || []), ...(message.meta || [])];
        } else {
            output.push({ ...message });
        }
    }
    return output;
}

function injectInChatPrompts(history, prompts) {
    const groups = new Map();
    for (const prompt of prompts) {
        const depth = Math.max(0, Math.trunc(Number(prompt.injection_depth) || 0));
        const order = Number.isFinite(Number(prompt.injection_order)) ? Number(prompt.injection_order) : 100;
        const key = `${depth}:${order}`;
        if (!groups.has(key)) groups.set(key, { depth, order, prompts: [] });
        groups.get(key).prompts.push(prompt);
    }

    const slots = new Map();
    const sorted = [...groups.values()].sort((a, b) => b.order - a.order);
    for (const group of sorted) {
        const slot = Math.max(0, Math.min(history.length, history.length - group.depth));
        if (!slots.has(slot)) slots.set(slot, []);
        for (const role of ['system', 'user', 'assistant']) {
            const members = group.prompts.filter(prompt => safeRole(prompt.role) === role);
            const content = members.map(prompt => prompt.content).filter(Boolean).join('\n').trim();
            if (!content) continue;
            slots.get(slot).push({
                role,
                content,
                meta: members.map(prompt => ({ type: 'prompt', identifier: prompt.identifier, position: 'in_chat', depth: group.depth, order: group.order }))
            });
        }
    }
    const result = [];
    for (let index = 0; index <= history.length; index += 1) {
        result.push(...(slots.get(index) || []));
        if (index < history.length) result.push(history[index]);
    }
    return result;
}

function resolvePromptOrder(preset, characterId) {
    const groups = Array.isArray(preset?.prompt_order) ? preset.prompt_order : [];
    return groups.find(group => String(group?.character_id) === String(characterId))?.order
        || groups[0]?.order
        || [];
}

function preparePrompts({ preset, characterId, generationType = 'normal', resolveMarker, render }) {
    const promptMap = new Map((Array.isArray(preset?.prompts) ? preset.prompts : []).map(prompt => [prompt.identifier, prompt]));
    const order = resolvePromptOrder(preset, characterId);
    const relative = [];
    const inChat = [];
    for (let sequence = 0; sequence < order.length; sequence += 1) {
        const orderEntry = order[sequence];
        if (!orderEntry?.enabled) continue;
        const source = promptMap.get(orderEntry.identifier);
        if (!source || !isPromptTriggered(source, generationType)) continue;
        const raw = source.marker ? resolveMarker(source.identifier) : source.content;
        const content = String(render(raw || '') || '').trim();
        if (!content && source.identifier !== 'chatHistory') continue;
        const prompt = { ...source, role: safeRole(source.role), content, sequence };
        if (Number(source.injection_position) === INJECTION_POSITION.IN_CHAT) inChat.push(prompt);
        else relative.push(prompt);
    }
    return { relative, inChat };
}

module.exports = {
    safeRole,
    normalizeTriggers,
    isPromptTriggered,
    mergeAdjacentSystemMessages,
    injectInChatPrompts,
    resolvePromptOrder,
    preparePrompts
};

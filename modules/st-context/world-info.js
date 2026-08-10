'use strict';

const { WORLD_INFO_LOGIC, WORLD_INFO_POSITION } = require('./constants');
const { estimateTextTokens } = require('./token-budget');

const DEFAULTS = Object.freeze({
    depth: 2,
    budgetPercent: 25,
    budgetCap: 0,
    recursive: false,
    maxRecursionSteps: 0,
    caseSensitive: false,
    matchWholeWords: false,
    sourceStrategy: 1
});

function arrayValue(value) {
    if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
    return [];
}

function numberValue(...values) {
    for (const value of values) {
        if (value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value))) return Number(value);
    }
    return undefined;
}

function positionValue(entry, extensions, source) {
    if (entry?.position === 'before_char') return WORLD_INFO_POSITION.BEFORE;
    if (entry?.position === 'after_char') return WORLD_INFO_POSITION.AFTER;
    return numberValue(entry?.position, extensions?.position) ?? (source === 'memory' ? WORLD_INFO_POSITION.BEFORE : WORLD_INFO_POSITION.AFTER);
}

function normalizeEntry(entry, book, source, index) {
    const ext = entry?.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    const hasActivationFields = Object.prototype.hasOwnProperty.call(entry || {}, 'key')
        || Object.prototype.hasOwnProperty.call(entry || {}, 'keys')
        || Object.prototype.hasOwnProperty.call(entry || {}, 'constant')
        || Object.prototype.hasOwnProperty.call(entry || {}, 'position');
    const enabled = entry?.enabled !== false && entry?.disable !== true;
    const contentLines = String(entry?.content || '').split(/\r?\n/);
    const decorators = [];
    while (contentLines.length && /^@@(?:activate|dont_activate)\s*$/i.test(contentLines[0].trim())) decorators.push(contentLines.shift().trim().toLowerCase());
    return {
        ...entry,
        uid: entry?.uid ?? entry?.id ?? index,
        id: entry?.id ?? String(entry?.uid ?? index),
        bookId: book?.id || '',
        world: book?.name || '',
        source,
        enabled,
        content: contentLines.join('\n'),
        decorators,
        key: arrayValue(entry?.key ?? entry?.keys),
        keysecondary: arrayValue(entry?.keysecondary ?? entry?.secondary_keys),
        constant: entry?.constant === true || (!hasActivationFields && enabled),
        selective: entry?.selective === true || arrayValue(entry?.keysecondary ?? entry?.secondary_keys).length > 0,
        selectiveLogic: numberValue(entry?.selectiveLogic, ext.selectiveLogic) ?? WORLD_INFO_LOGIC.AND_ANY,
        position: positionValue(entry, ext, source),
        order: numberValue(entry?.order, entry?.insertion_order) ?? 100,
        depth: Math.max(0, Math.trunc(numberValue(entry?.depth, ext.depth) ?? 4)),
        role: numberValue(entry?.role, ext.role) ?? 0,
        outletName: String(entry?.outletName ?? ext.outlet_name ?? ''),
        probability: Math.max(0, Math.min(100, numberValue(entry?.probability, ext.probability) ?? 100)),
        useProbability: entry?.useProbability ?? ext.useProbability ?? true,
        scanDepth: numberValue(entry?.scanDepth, ext.scan_depth),
        caseSensitive: entry?.caseSensitive ?? ext.case_sensitive,
        matchWholeWords: entry?.matchWholeWords ?? ext.match_whole_words,
        excludeRecursion: entry?.excludeRecursion ?? ext.exclude_recursion ?? false,
        preventRecursion: entry?.preventRecursion ?? ext.prevent_recursion ?? false,
        delayUntilRecursion: entry?.delayUntilRecursion ?? ext.delay_until_recursion ?? false,
        ignoreBudget: entry?.ignoreBudget ?? ext.ignore_budget ?? false,
        group: String(entry?.group ?? ext.group ?? ''),
        groupOverride: entry?.groupOverride ?? ext.group_override ?? false,
        groupWeight: Math.max(0, numberValue(entry?.groupWeight, ext.group_weight) ?? 100),
        matchPersonaDescription: entry?.matchPersonaDescription ?? ext.match_persona_description ?? false,
        matchCharacterDescription: entry?.matchCharacterDescription ?? ext.match_character_description ?? false,
        matchCharacterPersonality: entry?.matchCharacterPersonality ?? ext.match_character_personality ?? false,
        matchCharacterDepthPrompt: entry?.matchCharacterDepthPrompt ?? ext.match_character_depth_prompt ?? false,
        matchScenario: entry?.matchScenario ?? ext.match_scenario ?? false,
        matchCreatorNotes: entry?.matchCreatorNotes ?? ext.match_creator_notes ?? false,
        triggers: arrayValue(entry?.triggers ?? ext.triggers)
    };
}

function flattenBooks(groups, strategy = DEFAULTS.sourceStrategy) {
    const character = Array.isArray(groups?.character) ? groups.character : [];
    const global = Array.isArray(groups?.global) ? groups.global : [];
    const memory = Array.isArray(groups?.memory) ? groups.memory : [];
    let sources;
    if (Number(strategy) === 2) sources = [['memory', memory], ['global', global], ['character', character]];
    else if (Number(strategy) === 0) {
        const mixed = [];
        const max = Math.max(character.length, global.length);
        for (let index = 0; index < max; index += 1) {
            if (character[index]) mixed.push(['character', [character[index]]]);
            if (global[index]) mixed.push(['global', [global[index]]]);
        }
        sources = [['memory', memory], ...mixed];
    } else sources = [['memory', memory], ['character', character], ['global', global]];

    const entries = [];
    for (const [source, books] of sources) {
        for (const book of books) {
            (Array.isArray(book?.entries) ? book.entries : []).forEach((entry, index) => {
                entries.push(normalizeEntry(entry, book, source, index));
            });
        }
    }
    if (Number(strategy) === 0) {
        const memories = entries.filter(entry => entry.source === 'memory').sort((a, b) => b.order - a.order);
        const rest = entries.filter(entry => entry.source !== 'memory').sort((a, b) => b.order - a.order);
        return [...memories, ...rest];
    }
    return sources.flatMap(([source]) => entries.filter(entry => entry.source === source).sort((a, b) => b.order - a.order));
}

function parseRegex(value) {
    const match = String(value || '').match(/^\/(.*)\/([dgimsuvy]*)$/);
    if (!match) return null;
    try { return new RegExp(match[1], match[2].replace('g', '')); } catch { return null; }
}

function matchesKey(haystack, needle, entry, settings) {
    const regex = parseRegex(needle);
    if (regex) return regex.test(haystack);
    const caseSensitive = entry.caseSensitive ?? settings.caseSensitive;
    const wholeWords = entry.matchWholeWords ?? settings.matchWholeWords;
    const source = caseSensitive ? haystack : haystack.toLowerCase();
    const key = caseSensitive ? needle : needle.toLowerCase();
    if (!wholeWords || /\s/.test(key)) return source.includes(key);
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(source);
}

function entryMatches(entry, buffer, settings) {
    if (entry.constant) return true;
    if (!entry.key.length) return false;
    const primary = entry.key.some(key => matchesKey(buffer, key, entry, settings));
    if (!primary) return false;
    if (!entry.selective || !entry.keysecondary.length) return true;
    const results = entry.keysecondary.map(key => matchesKey(buffer, key, entry, settings));
    switch (entry.selectiveLogic) {
        case WORLD_INFO_LOGIC.NOT_ALL: return !results.every(Boolean);
        case WORLD_INFO_LOGIC.NOT_ANY: return !results.some(Boolean);
        case WORLD_INFO_LOGIC.AND_ALL: return results.every(Boolean);
        default: return results.some(Boolean);
    }
}

function scanText(historyNewestFirst, entry, settings, recursionText, globalScanData) {
    const depth = Math.max(0, Math.trunc(entry.scanDepth ?? settings.depth));
    return [
        ...historyNewestFirst.slice(0, depth),
        entry.matchPersonaDescription ? globalScanData?.personaDescription : '',
        entry.matchCharacterDescription ? globalScanData?.characterDescription : '',
        entry.matchCharacterPersonality ? globalScanData?.characterPersonality : '',
        entry.matchCharacterDepthPrompt ? globalScanData?.characterDepthPrompt : '',
        entry.matchScenario ? globalScanData?.scenario : '',
        entry.matchCreatorNotes ? globalScanData?.creatorNotes : '',
        recursionText
    ].filter(Boolean).join('\n\u0001');
}

function rollProbability(entry, random) {
    return !entry.useProbability || entry.probability >= 100 || random() * 100 <= entry.probability;
}

function filterInclusionGroups(candidates, activated, random) {
    const activeGroups = new Set(activated.flatMap(entry => entry.group.split(/,\s*/).filter(Boolean)));
    let result = candidates.filter(entry => !entry.group.split(/,\s*/).some(group => activeGroups.has(group)));
    const groups = new Map();
    for (const entry of result) {
        for (const group of entry.group.split(/,\s*/).filter(Boolean)) {
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(entry);
        }
    }
    for (const members of groups.values()) {
        const available = members.filter(entry => result.includes(entry));
        if (available.length <= 1) continue;
        const overrides = available.filter(entry => entry.groupOverride).sort((a, b) => b.order - a.order);
        let winner = overrides[0];
        if (!winner) {
            const total = available.reduce((sum, entry) => sum + entry.groupWeight, 0);
            let roll = random() * total;
            winner = available[available.length - 1];
            for (const entry of available) {
                roll -= entry.groupWeight;
                if (roll <= 0) { winner = entry; break; }
            }
        }
        result = result.filter(entry => !available.includes(entry) || entry === winner);
    }
    return result;
}

function roleFromWorldInfo(value) {
    if (value === 1 || value === 'user') return 'user';
    if (value === 2 || value === 'assistant') return 'assistant';
    return 'system';
}

function buildWorldInfoResult(activated) {
    const result = {
        before: [], after: [], examplesTop: [], examplesBottom: [],
        authorsNoteTop: [], authorsNoteBottom: [], depth: [], outlets: {}, activated: []
    };
    for (const entry of [...activated].sort((a, b) => b.order - a.order).reverse()) {
        const content = entry.renderedContent;
        if (!content) continue;
        result.activated.push({ id: entry.id, uid: entry.uid, bookId: entry.bookId, world: entry.world, source: entry.source, name: entry.name || entry.comment || '', tokens: entry.tokens });
        if (entry.position === WORLD_INFO_POSITION.BEFORE) result.before.unshift(content);
        else if (entry.position === WORLD_INFO_POSITION.AFTER) result.after.unshift(content);
        else if (entry.position === WORLD_INFO_POSITION.EXAMPLES_TOP) result.examplesTop.unshift(content);
        else if (entry.position === WORLD_INFO_POSITION.EXAMPLES_BOTTOM) result.examplesBottom.unshift(content);
        else if (entry.position === WORLD_INFO_POSITION.AUTHORS_NOTE_TOP) result.authorsNoteTop.unshift(content);
        else if (entry.position === WORLD_INFO_POSITION.AUTHORS_NOTE_BOTTOM) result.authorsNoteBottom.unshift(content);
        else if (entry.position === WORLD_INFO_POSITION.AT_DEPTH) result.depth.push({ depth: entry.depth, role: roleFromWorldInfo(entry.role), order: entry.order, content });
        else if (entry.position === WORLD_INFO_POSITION.OUTLET) {
            const outlet = entry.outletName || 'default';
            if (!result.outlets[outlet]) result.outlets[outlet] = [];
            result.outlets[outlet].unshift(content);
        }
    }
    return result;
}

function activateWorldInfo({ books, history, contextTokens, settings: rawSettings = {}, generationType = 'normal', render = value => value, random = Math.random, countText = estimateTextTokens, globalScanData = {} }) {
    const settings = {
        depth: Math.max(0, Math.trunc(numberValue(rawSettings.depth, rawSettings.world_info_depth) ?? DEFAULTS.depth)),
        budgetPercent: Math.max(0, numberValue(rawSettings.budgetPercent, rawSettings.world_info_budget) ?? DEFAULTS.budgetPercent),
        budgetCap: Math.max(0, numberValue(rawSettings.budgetCap, rawSettings.world_info_budget_cap) ?? DEFAULTS.budgetCap),
        recursive: rawSettings.recursive ?? rawSettings.world_info_recursive ?? DEFAULTS.recursive,
        maxRecursionSteps: Math.max(0, Math.trunc(numberValue(rawSettings.maxRecursionSteps, rawSettings.world_info_max_recursion_steps) ?? DEFAULTS.maxRecursionSteps)),
        caseSensitive: rawSettings.caseSensitive ?? rawSettings.world_info_case_sensitive ?? DEFAULTS.caseSensitive,
        matchWholeWords: rawSettings.matchWholeWords ?? rawSettings.world_info_match_whole_words ?? DEFAULTS.matchWholeWords,
        sourceStrategy: numberValue(rawSettings.sourceStrategy, rawSettings.world_info_character_strategy) ?? DEFAULTS.sourceStrategy
    };
    let budget = Math.max(1, Math.round(settings.budgetPercent * contextTokens / 100));
    if (settings.budgetCap > 0) budget = Math.min(budget, settings.budgetCap);
    const entries = flattenBooks(books, settings.sourceStrategy);
    const newestFirst = (Array.isArray(history) ? history : []).slice().reverse().map(message => {
        const content = Array.isArray(message?.content) ? message.content.map(part => part?.text || '').join('\n') : message?.content;
        return `${message?.name ? `${message.name}: ` : ''}${String(content || '')}`;
    });
    const activated = [];
    const activatedIds = new Set();
    const failedProbability = new Set();
    let used = 0;
    let recursionText = '';
    let step = 0;
    let overflowed = false;

    do {
        const newEntries = [];
        for (const entry of entries) {
            const id = `${entry.bookId}.${entry.uid}`;
            if (!entry.enabled || activatedIds.has(id) || failedProbability.has(id)) continue;
            if (entry.triggers.length && !entry.triggers.includes(generationType)) continue;
            if (entry.decorators.includes('@@dont_activate')) continue;
            if (step > 0 && entry.excludeRecursion) continue;
            if (step === 0 && entry.delayUntilRecursion) continue;
            const buffer = scanText(newestFirst, entry, settings, recursionText, globalScanData);
            if (entry.decorators.includes('@@activate') || entryMatches(entry, buffer, settings)) newEntries.push(entry);
        }
        if (!newEntries.length) break;
        const filteredEntries = filterInclusionGroups(newEntries, activated, random);
        let recurseAdditions = 0;
        for (const entry of filteredEntries) {
            const id = `${entry.bookId}.${entry.uid}`;
            if (!rollProbability(entry, random)) { failedProbability.add(id); continue; }
            const renderedContent = String(render(entry.content) || '').trim();
            const tokens = Math.max(0, Number(countText(renderedContent)) || 0);
            if (!entry.ignoreBudget && used + tokens >= budget) { overflowed = true; continue; }
            const accepted = { ...entry, renderedContent, tokens };
            activated.push(accepted);
            activatedIds.add(id);
            used += tokens;
            if (!entry.preventRecursion && renderedContent) {
                recursionText += `${recursionText ? '\n' : ''}${renderedContent}`;
                recurseAdditions += 1;
            }
        }
        step += 1;
        if (!settings.recursive || !recurseAdditions || overflowed) break;
        if (settings.maxRecursionSteps > 0 && step >= settings.maxRecursionSteps) break;
    } while (step < 100);

    return { ...buildWorldInfoResult(activated), budget: { limit: budget, used, overflowed }, settings };
}

module.exports = {
    DEFAULTS,
    normalizeEntry,
    flattenBooks,
    matchesKey,
    activateWorldInfo
};

const state = {
    page: 'presets',
    stPresets: [],
    currentPresetId: '',
    currentPreset: null,
    filter: 'all',
    search: '',
    groupMode: false,
    groupSelection: [],
    dirty: false,
    // 世界书：本粒度
    worldbookBooks: [],
    currentBookId: '',
    qqGlobalWorldbookIds: [],
    markerPreviewCache: null,
    markerExpanded: { world_info: false, memories: false },
    variables: {},
    editingMode: '',
    editingId: '',
    snapshot: ''
};

const samplingFields = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'openai_max_tokens'];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const markerLabels = {
    bunnyosRealtime: '这里会插入实时变量，例如当前日期、时间、星期、时区。',
    charDescription: '这里会插入当前角色卡里填写的所有 char 人设信息。',
    personaDescription: '这里会插入当前 user 人设：名字、性别、生日、用户人设提示词。',
    scenario: '这里会插入角色场景 scenario。',
    worldInfoAfter: '这里会插入当前命中的世界书条目。',
    dialogueExamples: '这里会插入示例聊天 mes_example。',
    worldInfoBefore: '这里会插入总结内容。总结内容本质上也是世界书，后续总结模块会细化。',
    onlinePrivateChat: '【私聊场景才注入】BunnyOS 线上私聊协议（短碎、不待命、抓重量、统一 wrap 格式）。',
    onlineGroupChat: '【群聊场景才注入】BunnyOS 线上群聊协议（子集响应、原子输出、[Sender/Payload/Time] 结构）。',
    chatHistory: '这里会插入聊天记录。'
};

const markerTemplates = {
    bunnyosRealtime: '当前现实时间：{{now}}（{{timezone}}）\n今天是{{date}}，{{weekday}}，现在{{time}}。',
    charDescription: '<character_info>\n角色名：{{char}}\n角色设定：\n{{char_role_setting}}\n其它设定：{{char_other_setting}}\n</character_info>',
    personaDescription: '<user_info>\n名字：{{user}}\n性别：{{user_gender}}\n生日：{{user_birthday}}\n用户人设：{{user_persona}}\n</user_info>',
    worldInfoAfter: '<world_info>\n[点击上方按钮展开当前 QQ 全局世界书的实际内容]\n</world_info>',
    worldInfoBefore: '<memories>\n[点击上方按钮展开当前角色绑定世界书的实际内容]\n</memories>',
    scenario: '在回复时须严格基于以下背景设定下回复:\n{{char_scenario}}',
    dialogueExamples: '在回复时{{char}}语气可以以下对话为参考:\n{{char_dialogue_examples}}',
    onlinePrivateChat: '[私聊协议占位 —— 当 chatType=private 时由 BunnyOS 注入完整文本]',
    onlineGroupChat: '[群聊协议占位 —— 当 chatType=group 时由 BunnyOS 注入完整文本]',
    chatHistory: '<chat_history>\n{{chat_history}}\n</chat_history>'
};

const markerSlotByIdentifier = {
    worldInfoAfter: 'world_info',
    worldInfoBefore: 'memories'
};

const builtinPrompts = [
    { identifier: 'bunnyosRealtime', name: '实时模式', content: '', role: 'system' },
    { identifier: 'charDescription', name: 'CHAR人设', content: '', role: 'system' },
    { identifier: 'personaDescription', name: 'USER人设', content: '', role: 'system' },
    { identifier: 'worldInfoAfter', name: '世界书', content: '', role: 'system' },
    { identifier: 'worldInfoBefore', name: '总结内容', content: '', role: 'system' },
    { identifier: 'scenario', name: '场景信息', content: '', role: 'system' },
    { identifier: 'dialogueExamples', name: '示例聊天', content: '', role: 'system' },
    { identifier: 'onlinePrivateChat', name: '线上·私聊', content: '', role: 'system' },
    { identifier: 'onlineGroupChat', name: '线上·群聊', content: '', role: 'system' },
    { identifier: 'chatHistory', name: '聊天记录', content: '', role: 'system' }
];

const builtinIds = new Set(builtinPrompts.map(item => item.identifier));
const legacyBuiltinIds = new Set(['charPersonality']);

const variableDocs = [
    ['{{now}}', '<now>', '当前完整时间，例如 2026-06-19 14:23:08'],
    ['{{date}}', '<date>', '当前日期，例如 2026-06-19'],
    ['{{time}}', '<time>', '当前时间，例如 14:23'],
    ['{{weekday}}', '<weekday>', '星期几'],
    ['{{timezone}}', '<timezone>', '当前时区（Asia/Shanghai）'],
    ['{{timestamp}}', '<timestamp>', 'Unix 时间戳'],
    ['{{char}}', '<char>', '当前角色名'],
    ['{{user}}', '<user>', '当前用户名字'],
    ['{{char_role_setting}}', '<char_role_setting>', '角色卡里的「角色设定」字段'],
    ['{{char_rp_rules}}', '<char_rp_rules>', '角色卡里的「角色语气 / RP规则」字段'],
    ['{{char_other_setting}}', '<char_other_setting>', '角色卡里的「其它设定」字段'],
    ['{{char_scenario}}', '<char_scenario>', '角色卡里的「场景信息」字段'],
    ['{{char_dialogue_examples}}', '<char_dialogue_examples>', '角色卡里的「示例聊天」字段'],
    ['{{user_gender}}', '<user_gender>', '当前 user 人设的性别'],
    ['{{user_birthday}}', '<user_birthday>', '当前 user 人设的生日'],
    ['{{user_persona}}', '<user_persona>', '当前 user 人设的提示词正文'],
    ['{{chat_history}}', '<chat_history>', '完整聊天记录纯文本（角色名: 文本，按行）'],
    ['{{lastmes}}', '<lastmes>', '最后一条 user 信息，已自动用 <user_input> 包裹']
];

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadAll();
    notifyNavState();
});

function bindEvents() {
    $$('.pm-tab').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
    $('#pm-add').addEventListener('click', handleAdd);
    $('#preset-select').addEventListener('change', () => setCurrentPreset($('#preset-select').value));
    $('#preset-new').addEventListener('click', createBlankPreset);
    $('#preset-save').addEventListener('click', saveCurrentPreset);
    $('#preset-rename').addEventListener('click', renameCurrentPreset);
    $('#preset-groups').addEventListener('click', toggleGroupMode);
    $('#preset-refresh-source').addEventListener('click', refreshCurrentFromSource);
    $('#preset-export').addEventListener('click', exportCurrentPreset);
    $('#preset-copy').addEventListener('click', copyCurrentPreset);
    $('#preset-delete').addEventListener('click', deleteCurrentPreset);
    $('#preset-preview').addEventListener('click', openPreview);
    $('#preset-search').addEventListener('input', (event) => {
        state.search = event.target.value.trim().toLowerCase();
        renderPromptList();
    });
    $('#preset-filter').addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-filter]');
        if (!btn) return;
        state.filter = btn.dataset.filter;
        $$('#preset-filter button').forEach(item => item.classList.toggle('active', item === btn));
        renderPromptList();
    });
    $$('[data-close]').forEach(el => el.addEventListener('click', closeEditor));
    $$('[data-preview-close]').forEach(el => el.addEventListener('click', closePreview));
    $('#preview-copy').addEventListener('click', copyPreview);
    $('#editor-delete').addEventListener('click', deleteCurrentEditorItem);
    ['editor-name', 'editor-identifier', 'editor-role', 'editor-content', 'editor-enabled', 'editor-marker',
        'editor-system-prompt', 'editor-injection-position', 'editor-injection-depth', 'editor-injection-order',
        'editor-injection-trigger', 'editor-forbid-overrides'
    ].forEach(id => $(`#${id}`).addEventListener('input', scheduleEditorAutosave));
    $('#variable-template').addEventListener('input', renderVariablePreview);
    samplingFields.forEach(field => {
        const input = $(`#sampling-${field}`);
        if (input) input.addEventListener('input', () => onSamplingInput(field));
    });
    $('#wb-book-select').addEventListener('change', () => {
        state.currentBookId = $('#wb-book-select').value;
        renderWorldbookEntries();
        renderWorldbookMeta();
    });
    $('#wb-book-new').addEventListener('click', createNewBook);
    $('#wb-book-rename').addEventListener('click', renameCurrentBook);
    $('#wb-book-delete').addEventListener('click', deleteCurrentBook);
    $('#wb-import').addEventListener('click', () => $('#wb-import-file').click());
    $('#wb-import-file').addEventListener('change', handleStWorldbookImport);
    $('.wb-global').addEventListener('click', (event) => {
        if (event.target.closest('.wb-chip button')) return;
        openChipMenu($('.wb-global'));
    });
    document.addEventListener('click', (event) => {
        const menu = $('#wb-chip-menu');
        if (menu && !menu.classList.contains('hidden') && !menu.contains(event.target) && !event.target.closest('.wb-global')) {
            menu.classList.add('hidden');
        }
    });
    window.addEventListener('message', (event) => {
        if (event.data?.type === 'bunnyos:navigate-back') {
            if (!$('#preview-modal').classList.contains('hidden')) closePreview();
            else closeEditor();
        }
    });
}

async function loadAll() {
    await Promise.all([loadStPresets(), loadWorldbooks(), loadVariables()]);
}

async function loadStPresets() {
    const res = await fetch('/api/st-presets');
    if (!res.ok) {
        toast('读取预设失败');
        return;
    }
    const data = await res.json();
    state.stPresets = data.presets || [];
    state.currentPresetId = data.currentPresetId || state.stPresets[0]?.id || '';
    renderPresetSelect();
    if (state.currentPresetId) await loadPresetDetail(state.currentPresetId);
}

async function loadPresetDetail(id) {
    const res = await fetch(`/api/st-presets/${encodeURIComponent(id)}`);
    if (!res.ok) {
        toast('读取预设详情失败');
        return;
    }
    const data = await res.json();
    state.currentPresetId = data.id;
    state.currentPreset = data.preset;
    state.dirty = false;
    normalizeCurrentPreset();
    $('#preset-select').value = data.id;
    renderPresetMeta(data.summary);
    renderSamplingFold();
    renderPromptList();
}

function renderSamplingFold() {
    const preset = state.currentPreset || {};
    samplingFields.forEach(field => {
        const input = $(`#sampling-${field}`);
        if (!input) return;
        const value = preset[field];
        input.value = (value === undefined || value === null || value === '') ? '' : value;
    });
}

let samplingSaveTimer = null;
function onSamplingInput(field) {
    if (!state.currentPreset) return;
    const input = $(`#sampling-${field}`);
    const raw = input.value;
    if (raw === '') {
        delete state.currentPreset[field];
    } else {
        const num = parseFloat(raw);
        if (Number.isFinite(num)) state.currentPreset[field] = field === 'openai_max_tokens' ? Math.round(num) : num;
    }
    markDirty();
    clearTimeout(samplingSaveTimer);
    samplingSaveTimer = setTimeout(() => { saveCurrentPreset(); }, 600);
}

function normalizeCurrentPreset() {
    if (!state.currentPreset) return;
    if (!Array.isArray(state.currentPreset.prompts)) state.currentPreset.prompts = [];
    getPromptOrder();
    state.currentPreset.extensions = state.currentPreset.extensions || {};
    if (!Array.isArray(state.currentPreset.extensions.bunnyosPromptGroups)) {
        state.currentPreset.extensions.bunnyosPromptGroups = [];
    }
    removeLegacyBuiltins();
    const promptMap = getPromptMap();
    for (const item of builtinPrompts) {
        if (!promptMap.has(item.identifier)) {
            state.currentPreset.prompts.push({
                identifier: item.identifier,
                name: item.name,
                enabled: true,
                injection_position: 0,
                injection_depth: 4,
                injection_order: 100,
                role: item.role,
                content: item.content,
                system_prompt: true,
                marker: true,
                forbid_overrides: true,
                injection_trigger: ''
            });
        } else {
            const prompt = promptMap.get(item.identifier);
            if (prompt.name !== item.name) state.dirty = true;
            prompt.name = item.name;
            prompt.role = prompt.role || item.role;
            prompt.marker = true;
            prompt.system_prompt = true;
            prompt.forbid_overrides = true;
        }
    }
    const order = getPromptOrder();
    for (const item of builtinPrompts) {
        if (!order.some(entry => entry.identifier === item.identifier)) {
            order.unshift({ identifier: item.identifier, enabled: true });
        }
    }
    order.forEach(entry => {
        if (builtinIds.has(entry.identifier)) entry.enabled = true;
    });
    if (!state.currentPreset.extensions.bunnyosBuiltinArranged) {
        const builtinEntries = [];
        const rest = [];
        for (const entry of order) {
            if (builtinIds.has(entry.identifier)) builtinEntries.push({ ...entry, enabled: true });
            else rest.push(entry);
        }
        const seen = new Set();
        const uniqueBuiltin = builtinPrompts
            .map(item => builtinEntries.find(entry => entry.identifier === item.identifier) || { identifier: item.identifier, enabled: true })
            .filter(entry => {
                if (seen.has(entry.identifier)) return false;
                seen.add(entry.identifier);
                return true;
            });
        state.currentPreset.prompt_order[0].order = [...uniqueBuiltin, ...rest.filter(entry => !seen.has(entry.identifier))];
        state.currentPreset.extensions.bunnyosBuiltinArranged = true;
        state.dirty = true;
    }
}

function removeLegacyBuiltins() {
    const beforePrompts = state.currentPreset.prompts.length;
    state.currentPreset.prompts = state.currentPreset.prompts.filter(prompt => !legacyBuiltinIds.has(prompt.identifier));
    state.currentPreset.prompt_order.forEach(group => {
        const beforeOrder = group.order?.length || 0;
        group.order = (group.order || []).filter(entry => !legacyBuiltinIds.has(entry.identifier));
        if (group.order.length !== beforeOrder) state.dirty = true;
    });
    state.currentPreset.extensions.bunnyosPromptGroups = getPromptGroups()
        .map(group => ({
            ...group,
            itemIds: group.itemIds.filter(id => !legacyBuiltinIds.has(id))
        }))
        .filter(group => group.itemIds.length > 1);
    if (state.currentPreset.prompts.length !== beforePrompts) state.dirty = true;
}

async function setCurrentPreset(id) {
    if (state.dirty && !await askConfirm('当前预设还没保存，要切换吗？')) {
        $('#preset-select').value = state.currentPresetId;
        return;
    }
    await fetch('/api/st-presets/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    await loadPresetDetail(id);
}

function renderPresetSelect() {
    const select = $('#preset-select');
    select.innerHTML = '';
    for (const preset of state.stPresets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name || preset.id;
        select.appendChild(option);
    }
}

function renderPresetMeta(summary = null) {
    const current = state.currentPreset ? summarizeCurrentPreset() : (summary || state.stPresets.find(item => item.id === state.currentPresetId));
    if (!current) {
        $('#preset-meta').textContent = '没有可用预设';
        return;
    }
    const updated = current.updated_at ? new Date(current.updated_at).toLocaleString('zh-CN') : '未知';
    $('#preset-meta').textContent = `当前：${current.name || current.id} · 启用 ${current.enabledCount || 0} / 顺序 ${current.orderCount || 0} · 条目 ${current.promptCount || 0} · marker ${current.markerCount || 0} · ${updated}${state.dirty ? ' · 未保存' : ''}`;
}

function summarizeCurrentPreset() {
    const order = getPromptOrder();
    const prompts = state.currentPreset?.prompts || [];
    return {
        id: state.currentPresetId,
        name: state.currentPreset?.name || state.currentPreset?.preset_name || state.currentPresetId,
        promptCount: prompts.length,
        orderCount: order.length,
        enabledCount: order.filter(item => item.enabled).length,
        markerCount: prompts.filter(prompt => prompt.marker).length,
        updated_at: 0
    };
}

function getPromptMap() {
    return new Map((state.currentPreset?.prompts || []).map(prompt => [prompt.identifier, prompt]));
}

function getPromptOrder() {
    if (!state.currentPreset?.prompt_order?.length) {
        state.currentPreset.prompt_order = [{ character_id: 100001, order: [] }];
    }
    if (!Array.isArray(state.currentPreset.prompt_order[0].order)) {
        state.currentPreset.prompt_order[0].order = [];
    }
    return state.currentPreset.prompt_order[0].order;
}

function renderPromptList() {
    const list = $('#st-prompt-list');
    list.innerHTML = '';
    if (!state.currentPreset) {
        list.innerHTML = '<div class="pm-card"><div class="pm-card-title">没有预设</div><div class="pm-card-sub">请先导入酒馆预设。</div></div>';
        return;
    }
    const promptMap = getPromptMap();
    const order = getPromptOrder();
    const groups = getPromptGroups();
    const groupedIds = new Map();
    groups.forEach(group => group.itemIds.forEach(id => groupedIds.set(id, group)));
    const rows = order
        .map((entry, index) => ({ entry, index, prompt: promptMap.get(entry.identifier), group: groupedIds.get(entry.identifier) }))
        .filter(item => item.prompt);

    const visibleRows = rows.filter(item => {
        if (item.group && item.group.collapsed && item.group.itemIds[0] !== item.entry.identifier) return false;
        return matchesFilter(item);
    });

    if (!visibleRows.length) {
        list.innerHTML = '<div class="pm-card"><div class="pm-card-title">没有匹配条目</div><div class="pm-card-sub">换一个筛选或搜索词。</div></div>';
        return;
    }
    const renderedGroups = new Set();
    for (const item of visibleRows) {
        if (item.group && !renderedGroups.has(item.group.id)) {
            list.appendChild(createGroupRow(item.group));
            renderedGroups.add(item.group.id);
            if (item.group.collapsed) continue;
        }
        list.appendChild(createPromptRow(item));
    }
}

function matchesFilter({ entry, prompt }) {
    const enabled = !!entry.enabled;
    if (state.filter === 'enabled' && !enabled) return false;
    if (state.filter === 'disabled' && enabled) return false;
    if (state.filter === 'marker' && !prompt.marker) return false;
    if (!state.search) return true;
    const haystack = `${prompt.name || ''} ${prompt.identifier || ''} ${prompt.content || ''}`.toLowerCase();
    return haystack.includes(state.search);
}

function createGroupRow(group) {
    const row = document.createElement('div');
    row.className = 'group-row';
    row.innerHTML = `
        <button class="group-toggle" type="button" title="展开/收起"><i class="bi ${group.collapsed ? 'bi-chevron-right' : 'bi-chevron-down'}"></i></button>
        <span>${escapeHtml(group.name || '未命名分组')}</span>
        <small>${group.itemIds.length} 条</small>
        <button class="group-delete" type="button" title="取消分组"><i class="bi bi-x-lg"></i></button>
    `;
    row.querySelector('.group-toggle').addEventListener('click', () => {
        group.collapsed = !group.collapsed;
        markDirty();
        renderPromptList();
    });
    row.querySelector('.group-delete').addEventListener('click', async () => {
        if (!await askConfirm('取消这个分组吗？条目不会被删除。')) return;
        state.currentPreset.extensions.bunnyosPromptGroups = getPromptGroups().filter(item => item.id !== group.id);
        markDirty();
        renderPromptList();
    });
    return row;
}

function createPromptRow({ entry, index, prompt }) {
    const row = document.createElement('div');
    row.className = 'prompt-row';
    if (state.groupMode) row.classList.add('grouping');
    row.draggable = true;
    row.dataset.index = index;
    const locked = isLockedPrompt(prompt.identifier);
    const selected = state.groupSelection.includes(index);
    const summary = prompt.marker
        ? markerLabels[prompt.identifier] || '动态插入点'
        : (prompt.content || '').replace(/\s+/g, ' ').slice(0, 120);
    row.innerHTML = `
        <label class="group-check ${state.groupMode ? '' : 'hidden'}" title="选择分组端点">
            <input type="checkbox" ${selected ? 'checked' : ''}>
            <span></span>
        </label>
        <button class="drag-handle" type="button" title="拖动排序"><i class="bi bi-grip-vertical"></i></button>
        <label class="prompt-toggle" title="启用/关闭">
            <input type="checkbox" ${entry.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span></span>
        </label>
        <div class="prompt-main">
            <div class="prompt-name">${escapeHtml(prompt.name || prompt.identifier || '未命名')}</div>
            <div class="prompt-meta-line">
                <span class="badge">${escapeHtml(prompt.role || 'system')}</span>
                ${prompt.marker ? '<span class="badge marker">marker</span>' : ''}
                ${locked ? '<span class="badge lock">locked</span>' : ''}
                <span class="prompt-sub">${escapeHtml(summary)}</span>
            </div>
        </div>
        <div class="prompt-actions">
            <button class="pm-icon-btn" type="button" data-action="edit" title="${locked ? '内置条目不可编辑' : '编辑'}" ${locked ? 'disabled' : ''}><i class="bi ${locked ? 'bi-lock' : 'bi-pencil'}"></i></button>
            <button class="pm-icon-btn" type="button" data-action="copy" title="${locked ? '内置条目不可复制' : '复制条目'}" ${locked ? 'disabled' : ''}><i class="bi bi-files"></i></button>
            <button class="pm-icon-btn danger" type="button" data-action="delete" title="${locked ? '内置条目不可删除' : '删除'}" ${locked ? 'disabled' : ''}><i class="bi bi-trash"></i></button>
        </div>
    `;
    row.querySelector('.group-check input').addEventListener('change', (event) => handleGroupSelection(index, event.target.checked));
    row.querySelector('.prompt-toggle input').addEventListener('change', (event) => {
        entry.enabled = event.target.checked;
        markDirty();
        renderPresetMeta();
    });
    row.querySelector('.prompt-main').addEventListener('click', () => openPromptViewer(prompt.identifier));
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openPromptEditor(prompt.identifier));
    row.querySelector('[data-action="copy"]').addEventListener('click', () => copyPrompt(prompt.identifier));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deletePrompt(prompt.identifier));
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragover', handleDragOver);
    row.addEventListener('drop', handleDrop);
    row.addEventListener('dragend', handleDragEnd);
    // 移动端：HTML5 drag/drop 在 iOS Safari 不工作；从握把走 touch 事件
    const handle = row.querySelector('.drag-handle');
    if (handle) handle.addEventListener('touchstart', handleTouchDragStart, { passive: false });
    return row;
}

function getPromptGroups() {
    state.currentPreset.extensions = state.currentPreset.extensions || {};
    if (!Array.isArray(state.currentPreset.extensions.bunnyosPromptGroups)) {
        state.currentPreset.extensions.bunnyosPromptGroups = [];
    }
    return state.currentPreset.extensions.bunnyosPromptGroups;
}

function isLockedPrompt(identifier) {
    return builtinIds.has(identifier);
}

function toggleGroupMode() {
    state.groupMode = !state.groupMode;
    state.groupSelection = [];
    $('#preset-groups').classList.toggle('active', state.groupMode);
    toast(state.groupMode ? '选择两个端点创建分组' : '已退出分组模式');
    renderPromptList();
}

function handleGroupSelection(index, checked) {
    if (checked) {
        if (!state.groupSelection.includes(index)) state.groupSelection.push(index);
        state.groupSelection = state.groupSelection.slice(-2);
    } else {
        state.groupSelection = state.groupSelection.filter(item => item !== index);
    }
    state.groupSelection.sort((a, b) => a - b);
    if (state.groupSelection.length === 2) createGroupFromSelection();
    else renderPromptList();
}

async function createGroupFromSelection() {
    const [start, end] = state.groupSelection;
    const order = getPromptOrder();
    const itemIds = order.slice(start, end + 1).map(item => item.identifier);
    if (itemIds.length < 2) {
        state.groupSelection = [];
        renderPromptList();
        return;
    }
    const existing = getPromptGroups();
    const selected = new Set(itemIds);
    if (existing.some(group => group.itemIds.some(id => selected.has(id)))) {
        toast('不能嵌套或交叉分组');
        state.groupSelection = [];
        renderPromptList();
        return;
    }
    const name = await askText('分组名称', '新分组');
    state.groupSelection = [];
    if (!name) {
        renderPromptList();
        return;
    }
    existing.push({
        id: `group_${newId()}`,
        name: name.trim() || '未命名分组',
        itemIds,
        collapsed: true
    });
    markDirty();
    renderPromptList();
}

let dragIndex = null;
function handleDragStart(event) {
    dragIndex = Number(event.currentTarget.dataset.index);
    if (getGroupForIndex(dragIndex)) {
        dragIndex = null;
        toast('分组内条目请先取消分组再拖动');
        event.preventDefault();
        return;
    }
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(event) {
    event.preventDefault();
}

function handleDrop(event) {
    event.preventDefault();
    const targetIndex = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(dragIndex) || !Number.isInteger(targetIndex) || dragIndex === targetIndex) return;
    if (getGroupForIndex(targetIndex)) {
        toast('不能把条目拖入已有分组范围');
        return;
    }
    const order = getPromptOrder();
    const [moved] = order.splice(dragIndex, 1);
    order.splice(targetIndex, 0, moved);
    dragIndex = null;
    markDirty();
    renderPromptList();
}

function handleDragEnd(event) {
    event.currentTarget.classList.remove('dragging');
}

// ========== 移动端 touch 拖拽 ==========
let touchDragState = null;

function handleTouchDragStart(event) {
    if (event.touches.length !== 1) return;
    const row = event.currentTarget.closest('.prompt-row');
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (getGroupForIndex(idx)) {
        toast('分组内条目请先取消分组再拖动');
        return;
    }
    event.preventDefault();
    touchDragState = { row, sourceIndex: idx, targetIndex: idx };
    row.classList.add('dragging');
    document.addEventListener('touchmove', handleTouchDragMove, { passive: false });
    document.addEventListener('touchend', handleTouchDragEnd);
    document.addEventListener('touchcancel', handleTouchDragEnd);
}

function handleTouchDragMove(event) {
    if (!touchDragState || event.touches.length !== 1) return;
    event.preventDefault();
    const t = event.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    document.querySelectorAll('.prompt-row.drag-target').forEach(r => r.classList.remove('drag-target'));
    const targetRow = el && el.closest ? el.closest('.prompt-row') : null;
    if (targetRow && targetRow !== touchDragState.row) {
        const idx = Number(targetRow.dataset.index);
        if (Number.isInteger(idx) && !getGroupForIndex(idx)) {
            targetRow.classList.add('drag-target');
            touchDragState.targetIndex = idx;
        }
    }
}

function handleTouchDragEnd() {
    document.removeEventListener('touchmove', handleTouchDragMove);
    document.removeEventListener('touchend', handleTouchDragEnd);
    document.removeEventListener('touchcancel', handleTouchDragEnd);
    document.querySelectorAll('.prompt-row.drag-target').forEach(r => r.classList.remove('drag-target'));
    document.querySelectorAll('.prompt-row.dragging').forEach(r => r.classList.remove('dragging'));
    if (!touchDragState) return;
    const { sourceIndex, targetIndex } = touchDragState;
    touchDragState = null;
    if (sourceIndex === targetIndex) return;
    const order = getPromptOrder();
    const [moved] = order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, moved);
    markDirty();
    renderPromptList();
}

function getGroupForIndex(index) {
    const entry = getPromptOrder()[index];
    if (!entry) return null;
    return getPromptGroups().find(group => group.itemIds.includes(entry.identifier)) || null;
}

function markDirty() {
    state.dirty = true;
    renderPresetMeta();
}

async function saveCurrentPreset() {
    if (!state.currentPresetId || !state.currentPreset) return;
    const res = await fetch(`/api/st-presets/${encodeURIComponent(state.currentPresetId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: state.currentPreset })
    });
    if (!res.ok) {
        toast('保存失败');
        return;
    }
    const data = await res.json();
    state.dirty = false;
    renderPresetMeta(data.summary);
    await loadStPresets();
    toast('已保存');
}

async function renameCurrentPreset() {
    if (!state.currentPresetId) return;
    const name = await askText('预设名称', state.currentPresetId);
    if (!name) return;
    if (state.dirty) await saveCurrentPreset();
    const res = await fetch(`/api/st-presets/${encodeURIComponent(state.currentPresetId)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (!res.ok) {
        toast('重命名失败');
        return;
    }
    const data = await res.json();
    await loadStPresets();
    await setCurrentPreset(data.id);
}

async function createBlankPreset() {
    const name = await askText('新建空白预设', '我的预设');
    if (!name) return;
    const res = await fetch('/api/st-presets/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || '新建失败');
        return;
    }
    const data = await res.json();
    await loadStPresets();
    await setCurrentPreset(data.id);
    toast('已新建（仅含 8 个内置 marker + 默认采样）');
}

async function copyCurrentPreset() {
    if (!state.currentPresetId) return;
    const name = await askText('复制为', `${state.currentPresetId} 副本`);
    if (!name) return;
    const res = await fetch(`/api/st-presets/${encodeURIComponent(state.currentPresetId)}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (!res.ok) {
        toast('复制失败');
        return;
    }
    const data = await res.json();
    await loadStPresets();
    await setCurrentPreset(data.id);
}

async function refreshCurrentFromSource() {
    if (!state.currentPresetId) return;
    if (!await askConfirm('从 apps/prompt-manager/Liminal_online.json 重新读取并覆盖当前工作副本吗？当前预设里的本地修改会被替换。')) return;
    const res = await fetch(`/api/st-presets/${encodeURIComponent(state.currentPresetId)}/refresh-default`, {
        method: 'POST'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || '重新读取失败');
        return;
    }
    await loadPresetDetail(state.currentPresetId);
    if (state.dirty) await saveCurrentPreset();
    await loadStPresets();
    toast('已重新读取 Liminal_online');
}

async function deleteCurrentPreset() {
    if (!state.currentPresetId || !await askConfirm('确定删除当前预设吗？')) return;
    const res = await fetch(`/api/st-presets/${encodeURIComponent(state.currentPresetId)}`, { method: 'DELETE' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || '删除失败');
        return;
    }
    await loadStPresets();
}

function exportCurrentPreset() {
    if (!state.currentPreset) return;
    const blob = new Blob([JSON.stringify(state.currentPreset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.currentPresetId || 'preset'}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function handleAdd() {
    if (state.page === 'presets') addPrompt();
    if (state.page === 'worldbooks') openWorldbookEditor();
}

function addPrompt() {
    if (!state.currentPreset) return;
    const id = `prompt_${newId()}`;
    const prompt = {
        identifier: id,
        name: '新条目',
        enabled: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        role: 'system',
        content: '',
        system_prompt: false,
        marker: false,
        forbid_overrides: false,
        injection_trigger: ''
    };
    state.currentPreset.prompts.unshift(prompt);
    getPromptOrder().unshift({ identifier: id, enabled: true });
    markDirty();
    renderPromptList();
    openPromptEditor(id);
}

function copyPrompt(identifier) {
    if (isLockedPrompt(identifier)) {
        toast('内置条目不可复制');
        return;
    }
    const prompt = getPromptMap().get(identifier);
    if (!prompt) return;
    const copy = JSON.parse(JSON.stringify(prompt));
    copy.identifier = `prompt_${newId()}`;
    copy.name = `${copy.name || '未命名'} 副本`;
    copy.marker = false;
    const order = getPromptOrder();
    const idx = order.findIndex(item => item.identifier === identifier);
    state.currentPreset.prompts.push(copy);
    order.splice(idx + 1, 0, { identifier: copy.identifier, enabled: true });
    markDirty();
    renderPromptList();
}

async function deletePrompt(identifier) {
    if (isLockedPrompt(identifier)) {
        toast('内置条目不可删除');
        return;
    }
    if (!await askConfirm('删除这个条目吗？')) return;
    state.currentPreset.prompts = state.currentPreset.prompts.filter(prompt => prompt.identifier !== identifier);
    state.currentPreset.prompt_order.forEach(group => {
        group.order = (group.order || []).filter(item => item.identifier !== identifier);
    });
    markDirty();
    renderPromptList();
}

function openPromptEditor(identifier) {
    if (isLockedPrompt(identifier)) {
        toast('内置条目不可编辑');
        return;
    }
    const prompt = getPromptMap().get(identifier);
    const entry = getPromptOrder().find(item => item.identifier === identifier);
    if (!prompt || !entry) return;
    state.editingMode = 'prompt';
    state.editingId = identifier;
    $$('.pm-modal-card').forEach(card => card.removeAttribute('data-mode'));
    $('#editor-title').textContent = '编辑条目';
    $('#editor-delete').classList.remove('hidden');
    $('.advanced-fields').classList.remove('hidden');
    fillEditor(prompt, entry);
    state.snapshot = JSON.stringify(editorDraft());
    $('#editor-modal').classList.remove('hidden');
    notifyNavState();
}

function openPromptViewer(identifier) {
    const prompt = getPromptMap().get(identifier);
    if (!prompt) return;
    $('#preview-title').textContent = prompt.name || prompt.identifier || '条目内容';
    $('#assembly-preview').textContent = buildPromptDisplayContent(prompt);
    $('#preview-marker-toggles').classList.add('hidden');
    $('#preview-modal').classList.remove('hidden');
    notifyNavState();
}

function fillEditor(prompt, entry) {
    $('#editor-name').value = prompt.name || '';
    $('#editor-identifier').value = prompt.identifier || '';
    $('#editor-role').value = prompt.role || 'system';
    $('#editor-content').value = prompt.content || '';
    $('#editor-enabled').checked = !!entry.enabled;
    $('#editor-marker').checked = !!prompt.marker;
    $('#editor-system-prompt').checked = !!prompt.system_prompt;
    $('#editor-injection-position').value = prompt.injection_position ?? '';
    $('#editor-injection-depth').value = prompt.injection_depth ?? '';
    $('#editor-injection-order').value = prompt.injection_order ?? '';
    $('#editor-injection-trigger').value = prompt.injection_trigger || '';
    $('#editor-forbid-overrides').checked = !!prompt.forbid_overrides;
    const markerDetails = $('#editor-marker-details');
    markerDetails.classList.toggle('hidden', !prompt.marker);
    $('#editor-marker-preview').textContent = markerLabels[prompt.identifier] || '这里会插入 BunnyOS 动态内容。';
}

function editorDraft() {
    return {
        name: $('#editor-name').value.trim(),
        identifier: $('#editor-identifier').value.trim(),
        role: $('#editor-role').value,
        content: $('#editor-content').value,
        enabled: $('#editor-enabled').checked,
        marker: $('#editor-marker').checked,
        system_prompt: $('#editor-system-prompt').checked,
        injection_position: numberOrString($('#editor-injection-position').value),
        injection_depth: numberOrString($('#editor-injection-depth').value),
        injection_order: numberOrString($('#editor-injection-order').value),
        injection_trigger: $('#editor-injection-trigger').value,
        forbid_overrides: $('#editor-forbid-overrides').checked
    };
}

let autosaveTimer = null;
function scheduleEditorAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveEditorIfChanged, 300);
}

async function saveEditorIfChanged() {
    if (!state.editingMode || !state.editingId) return;
    const draft = editorDraft();
    if (JSON.stringify(draft) === state.snapshot) return;
    if (state.editingMode === 'prompt') savePromptDraft(draft);
    if (state.editingMode === 'worldbook') saveWorldbookDraft(draft);
    state.snapshot = JSON.stringify(editorDraft());
}

function savePromptDraft(draft) {
    if (isLockedPrompt(state.editingId)) return;
    const prompt = getPromptMap().get(state.editingId);
    const entry = getPromptOrder().find(item => item.identifier === state.editingId);
    if (!prompt || !entry) return;
    const nextId = draft.identifier || state.editingId;
    if (nextId !== state.editingId && getPromptMap().has(nextId)) {
        toast('identifier 已存在');
        $('#editor-identifier').value = state.editingId;
        return;
    }
    prompt.identifier = nextId;
    prompt.name = draft.name || '未命名';
    prompt.role = draft.role || 'system';
    prompt.content = draft.content;
    prompt.enabled = draft.enabled;
    prompt.marker = draft.marker;
    prompt.system_prompt = draft.system_prompt;
    prompt.injection_position = draft.injection_position;
    prompt.injection_depth = draft.injection_depth;
    prompt.injection_order = draft.injection_order;
    prompt.injection_trigger = draft.injection_trigger;
    prompt.forbid_overrides = draft.forbid_overrides;
    entry.identifier = nextId;
    entry.enabled = draft.enabled;
    state.editingId = nextId;
    $('#editor-marker-details').classList.toggle('hidden', !prompt.marker);
    $('#editor-marker-preview').textContent = markerLabels[prompt.identifier] || '这里会插入 BunnyOS 动态内容。';
    markDirty();
    renderPromptList();
}

function closeEditor() {
    if ($('#editor-modal').classList.contains('hidden')) return;
    saveEditorIfChanged();
    $('#editor-modal').classList.add('hidden');
    $$('.pm-modal-card').forEach(card => card.removeAttribute('data-mode'));
    state.editingMode = '';
    state.editingId = '';
    state.snapshot = '';
    notifyNavState();
}

function deleteCurrentEditorItem() {
    if (state.editingMode === 'prompt') {
        const id = state.editingId;
        closeEditor();
        deletePrompt(id);
    } else if (state.editingMode === 'worldbook') {
        deleteWorldbook(state.editingId);
    }
}

function openPreview() {
    $('#preview-title').textContent = '装配预览';
    $('#assembly-preview').textContent = buildAssemblyPreview();
    renderMarkerToggles();
    $('#preview-modal').classList.remove('hidden');
    notifyNavState();
}

function renderMarkerToggles() {
    const wrap = $('#preview-marker-toggles');
    wrap.innerHTML = '';
    wrap.classList.remove('hidden');
    ['world_info', 'memories'].forEach(slot => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preview-marker-toggle';
        btn.textContent = `${state.markerExpanded[slot] ? '收起' : '展开'} ${slot}`;
        btn.addEventListener('click', () => toggleMarkerExpansion(slot));
        wrap.appendChild(btn);
    });
}

async function toggleMarkerExpansion(slot) {
    state.markerExpanded[slot] = !state.markerExpanded[slot];
    if (state.markerExpanded[slot] && !state.markerPreviewCache) {
        try {
            const res = await fetch('/api/qq/preset-marker-preview');
            state.markerPreviewCache = res.ok ? await res.json() : { world_info: '', memories: '' };
        } catch {
            state.markerPreviewCache = { world_info: '', memories: '' };
        }
    }
    $('#assembly-preview').textContent = buildAssemblyPreview();
    renderMarkerToggles();
}

function closePreview() {
    $('#preview-modal').classList.add('hidden');
    $('#preview-marker-toggles').classList.add('hidden');
    notifyNavState();
}

async function copyPreview() {
    await navigator.clipboard?.writeText($('#assembly-preview').textContent || '');
    toast('已复制预览');
}

function buildAssemblyPreview() {
    if (!state.currentPreset) return '';
    const promptMap = getPromptMap();
    const blocks = [];
    getPromptOrder().forEach((entry) => {
        if (!entry.enabled) return;
        const prompt = promptMap.get(entry.identifier);
        if (!prompt) return;
        const body = buildPromptDisplayContent(prompt);
        if (!body.trim() && !prompt.marker) return;
        blocks.push(body);
    });
    return blocks.join('\n\n');
}

function buildPromptDisplayContent(prompt) {
    if (!prompt) return '';
    if (prompt.marker) {
        const slot = markerSlotByIdentifier[prompt.identifier];
        if (slot && state.markerExpanded[slot] && state.markerPreviewCache) {
            return state.markerPreviewCache[slot] || `<${slot}>\n（当前没有任何选中世界书条目）\n</${slot}>`;
        }
        return markerTemplates[prompt.identifier] || `[动态插入：${markerLabels[prompt.identifier] || `${prompt.identifier} 对应内容`}]`;
    }
    return scrubPreviewContent(prompt.content || '');
}

function scrubPreviewContent(content) {
    return String(content || '')
        .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, '[图片 data_url 已省略]');
}

async function loadWorldbooks() {
    const [booksRes, globalRes] = await Promise.all([
        fetch('/api/worldbooks'),
        fetch('/api/qq/global-worldbooks')
    ]);
    const booksData = booksRes.ok ? await booksRes.json() : { books: [] };
    state.worldbookBooks = Array.isArray(booksData.books) ? booksData.books : [];
    if (!state.worldbookBooks.find(book => book.id === state.currentBookId)) {
        state.currentBookId = state.worldbookBooks[0]?.id || '';
    }
    const globalData = globalRes.ok ? await globalRes.json() : { globalWorldbookIds: [] };
    state.qqGlobalWorldbookIds = (globalData.globalWorldbookIds || []).filter(id => state.worldbookBooks.some(book => book.id === id));
    renderWorldbookBookSelect();
    renderGlobalChips();
    renderWorldbookEntries();
    renderWorldbookMeta();
}

async function loadVariables() {
    const res = await fetch('/api/prompt/variables');
    state.variables = res.ok ? await res.json() : {};
    renderVariables();
}

function renderWorldbookBookSelect() {
    const select = $('#wb-book-select');
    select.innerHTML = '';
    if (!state.worldbookBooks.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '（还没有世界书）';
        select.appendChild(option);
        select.disabled = true;
        return;
    }
    select.disabled = false;
    for (const book of state.worldbookBooks) {
        const option = document.createElement('option');
        option.value = book.id;
        option.textContent = book.name || '未命名';
        select.appendChild(option);
    }
    if (state.currentBookId) select.value = state.currentBookId;
}

function getCurrentBook() {
    return state.worldbookBooks.find(book => book.id === state.currentBookId) || null;
}

function renderGlobalChips() {
    const wrap = $('#wb-global-chips');
    wrap.innerHTML = '';
    const bookMap = new Map(state.worldbookBooks.map(book => [book.id, book]));
    const selectedBooks = state.qqGlobalWorldbookIds.map(id => bookMap.get(id)).filter(Boolean);
    if (!selectedBooks.length) {
        const empty = document.createElement('span');
        empty.className = 'wb-chip-empty';
        empty.textContent = '点击此处选择全局世界书…';
        wrap.appendChild(empty);
    }
    for (const book of selectedBooks) {
        const chip = document.createElement('span');
        chip.className = 'wb-chip';
        chip.innerHTML = `<span>${escapeHtml(book.name || '未命名')}</span><button type="button" aria-label="移除"><i class="bi bi-x"></i></button>`;
        const removeBtn = chip.querySelector('button');
        removeBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            removeGlobalChip(book.id);
        });
        wrap.appendChild(chip);
    }
}

function openChipMenu(anchor) {
    const menu = $('#wb-chip-menu');
    menu.innerHTML = '';
    const selected = new Set(state.qqGlobalWorldbookIds);
    const candidates = state.worldbookBooks.filter(book => !selected.has(book.id));
    if (!candidates.length) {
        const empty = document.createElement('div');
        empty.className = 'wb-chip-menu-empty';
        empty.textContent = state.worldbookBooks.length ? '所有世界书都已加入' : '还没有世界书';
        menu.appendChild(empty);
    }
    for (const book of candidates) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = book.name || '未命名';
        btn.addEventListener('click', () => addGlobalChip(book.id));
        menu.appendChild(btn);
    }
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.width = `${rect.width}px`;
    menu.classList.remove('hidden');
}

async function addGlobalChip(bookId) {
    if (state.qqGlobalWorldbookIds.includes(bookId)) return;
    state.qqGlobalWorldbookIds.push(bookId);
    $('#wb-chip-menu').classList.add('hidden');
    await saveGlobalChips();
    renderGlobalChips();
}

async function removeGlobalChip(bookId) {
    state.qqGlobalWorldbookIds = state.qqGlobalWorldbookIds.filter(id => id !== bookId);
    await saveGlobalChips();
    renderGlobalChips();
}

async function saveGlobalChips() {
    await fetch('/api/qq/global-worldbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalWorldbookIds: state.qqGlobalWorldbookIds })
    });
    state.markerPreviewCache = null;
}

function renderWorldbookMeta() {
    const book = getCurrentBook();
    if (!book) {
        $('#wb-meta').textContent = '请先新建或导入一本世界书。';
        return;
    }
    const updated = book.updated_at ? new Date(book.updated_at).toLocaleString('zh-CN') : '';
    const count = Array.isArray(book.entries) ? book.entries.length : 0;
    $('#wb-meta').textContent = `当前：${book.name || '未命名'} · ${count} 条目${updated ? ' · ' + updated : ''}`;
}

function renderWorldbookEntries() {
    const list = $('#worldbook-list');
    list.innerHTML = '';
    const book = getCurrentBook();
    if (!book) {
        list.innerHTML = '<div class="pm-card"><div class="pm-card-title">还没有世界书</div><div class="pm-card-sub">点击工具栏的 + 新建空白本，或点 ⬆ 导入酒馆世界书 JSON。</div></div>';
        return;
    }
    const entries = Array.isArray(book.entries) ? book.entries : [];
    if (!entries.length) {
        list.innerHTML = '<div class="pm-card"><div class="pm-card-title">这本世界书还是空的</div><div class="pm-card-sub">点击右上角 + 新建条目。</div></div>';
        return;
    }
    for (const entry of entries) {
        const card = document.createElement('div');
        card.className = 'pm-card';
        card.innerHTML = `<div class="pm-card-title">${escapeHtml(entry.name || '未命名')}</div><div class="pm-card-sub">${escapeHtml((entry.content || '').replace(/\s+/g, ' ').slice(0, 90))}</div>`;
        card.addEventListener('click', () => openWorldbookEditor(entry.id));
        list.appendChild(card);
    }
}

function openWorldbookEditor(entryId = '') {
    const book = getCurrentBook();
    if (!book) {
        toast('请先新建或选择一本世界书');
        return;
    }
    state.editingMode = 'worldbook';
    state.editingId = entryId || newId();
    let entry = (book.entries || []).find(item => item.id === state.editingId);
    if (!entry) {
        entry = { id: state.editingId, name: '', content: '' };
        book.entries = Array.isArray(book.entries) ? book.entries : [];
        book.entries.unshift(entry);
    }
    $$('.pm-modal-card').forEach(card => card.setAttribute('data-mode', 'worldbook'));
    $('#editor-title').textContent = '世界书条目';
    $('#editor-delete').classList.remove('hidden');
    $('#editor-name').value = entry.name || '';
    $('#editor-identifier').value = entry.id || '';
    $('#editor-role').value = 'system';
    $('#editor-content').value = entry.content || '';
    $('#editor-enabled').checked = true;
    $('#editor-marker').checked = false;
    $('#editor-system-prompt').checked = false;
    state.snapshot = JSON.stringify(editorDraft());
    $('#editor-modal').classList.remove('hidden');
    notifyNavState();
}

function saveWorldbookDraft(draft) {
    const book = getCurrentBook();
    if (!book) return;
    book.entries = Array.isArray(book.entries) ? book.entries : [];
    const entry = book.entries.find(item => item.id === state.editingId);
    if (!entry) return;
    entry.name = draft.name || '未命名';
    entry.content = draft.content;
    book.updated_at = Date.now();
    saveWorldbooks();
    renderWorldbookEntries();
    renderWorldbookMeta();
    state.markerPreviewCache = null;
}

async function saveWorldbooks() {
    await fetch('/api/worldbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ books: state.worldbookBooks })
    });
}

async function deleteWorldbook(entryId) {
    const book = getCurrentBook();
    if (!book) return;
    if (!await askConfirm('确定删除这个条目吗？')) return;
    book.entries = (book.entries || []).filter(item => item.id !== entryId);
    book.updated_at = Date.now();
    await saveWorldbooks();
    $('#editor-modal').classList.add('hidden');
    $$('.pm-modal-card').forEach(card => card.removeAttribute('data-mode'));
    state.editingMode = '';
    state.editingId = '';
    renderWorldbookEntries();
    renderWorldbookMeta();
    state.markerPreviewCache = null;
    notifyNavState();
}

async function createNewBook() {
    const name = await askText('世界书名称', '新世界书');
    if (!name) return;
    const res = await fetch('/api/worldbooks/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (!res.ok) {
        toast('新建失败');
        return;
    }
    const data = await res.json();
    state.currentBookId = data.book.id;
    await loadWorldbooks();
    toast('已创建');
}

async function renameCurrentBook() {
    const book = getCurrentBook();
    if (!book) return;
    const name = await askText('重命名世界书', book.name || '');
    if (!name) return;
    book.name = name.trim();
    book.updated_at = Date.now();
    await saveWorldbooks();
    renderWorldbookBookSelect();
    renderWorldbookMeta();
    renderGlobalChips();
}

async function deleteCurrentBook() {
    const book = getCurrentBook();
    if (!book) return;
    if (!await askConfirm(`删除整本「${book.name || '未命名'}」？所有条目会一起消失，被绑定它的角色卡和全局列表也会自动清理。`)) return;
    const res = await fetch(`/api/worldbooks/books/${encodeURIComponent(book.id)}`, { method: 'DELETE' });
    if (!res.ok) {
        toast('删除失败');
        return;
    }
    state.currentBookId = '';
    await loadWorldbooks();
    toast('已删除');
}

async function handleStWorldbookImport(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const defaultName = file.name.replace(/\.json$/i, '');
        const res = await fetch('/api/worldbooks/import-st', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, name: defaultName })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            toast(err.error || '导入失败');
            return;
        }
        const result = await res.json();
        state.currentBookId = result.book.id;
        await loadWorldbooks();
        toast(`已导入「${result.book.name}」（${result.book.entryCount} 条）`);
    } catch (e) {
        console.error(e);
        toast('JSON 解析失败');
    }
}

function renderVariables() {
    const grid = $('#variable-grid');
    grid.innerHTML = '';
    for (const [curly, angle, desc] of variableDocs) {
        const key = curly.replace(/[{}]/g, '');
        const row = document.createElement('div');
        row.className = 'pm-variable';
        row.innerHTML = `<code>${escapeHtml(curly)} / ${escapeHtml(angle)}</code><div>${escapeHtml(desc)}</div><div class="pm-variable-value">${escapeHtml(state.variables[key] || '')}</div>`;
        grid.appendChild(row);
    }
    renderVariablePreview();
}

async function renderVariablePreview() {
    const res = await fetch('/api/prompt/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: $('#variable-template').value })
    });
    if (!res.ok) return;
    const data = await res.json();
    state.variables = data.variables || state.variables;
    $('#variable-preview').textContent = data.rendered || '';
}

function switchPage(page) {
    state.page = page;
    $$('.pm-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.page === page));
    $$('.pm-page').forEach(panel => panel.classList.toggle('active', panel.dataset.page === page));
    $('#pm-title').textContent = { presets: '预设', worldbooks: '世界书', variables: '变量手册' }[page] || '提示词';
    $('#pm-add').classList.toggle('hidden', page === 'variables');
}

function notifyNavState() {
    const canGoBack = !$('#editor-modal')?.classList.contains('hidden') || !$('#preview-modal')?.classList.contains('hidden');
    window.parent?.postMessage({ type: 'bunnyos:navigation-state', title: '', canGoBack }, '*');
}

function numberOrString(value) {
    if (value === '') return '';
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
}

function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function openDialog({ title = '确认', message = '', input = false, value = '' } = {}) {
    return new Promise(resolve => {
        const dialog = $('#pm-dialog');
        const titleEl = $('#pm-dialog-title');
        const messageEl = $('#pm-dialog-message');
        const inputEl = $('#pm-dialog-input');
        const ok = $('#pm-dialog-ok');
        const cancel = $('#pm-dialog-cancel');
        titleEl.textContent = title;
        messageEl.textContent = message;
        inputEl.classList.toggle('hidden', !input);
        inputEl.value = value;
        dialog.classList.remove('hidden');
        setTimeout(() => {
            if (input) {
                inputEl.focus();
                inputEl.select();
            } else {
                ok.focus();
            }
        }, 0);

        const cleanup = (result) => {
            dialog.classList.add('hidden');
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            dialog.removeEventListener('keydown', onKeydown);
            resolve(result);
        };
        const onOk = () => cleanup(input ? inputEl.value : true);
        const onCancel = () => cleanup(input ? null : false);
        const onKeydown = (event) => {
            if (event.key === 'Enter' && (!input || document.activeElement === inputEl)) onOk();
            if (event.key === 'Escape') onCancel();
        };

        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        dialog.addEventListener('keydown', onKeydown);
    });
}

function askConfirm(message, title = '确认') {
    return openDialog({ title, message, input: false });
}

function askText(title, value = '') {
    return openDialog({ title, input: true, value });
}

let toastTimer = null;
function toast(message) {
    const el = $('#pm-toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1600);
}

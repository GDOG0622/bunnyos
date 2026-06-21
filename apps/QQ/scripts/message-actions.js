async function inputMessage() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || !state.activeChatId) return;
    input.value = '';
    await appendChatMessage({ role: 'user', type: parseVoiceText(text) ? 'voice' : 'text', text, created_at: Date.now() });
}

let isGenerating = false;
let abortController = null;

async function generateReply(e) {
    e.preventDefault();
    // 生成中点击 = 停止
    if (isGenerating) {
        abortController?.abort();
        return;
    }
    const input = $('#chat-input');
    const hasNew = input.value.trim().length > 0;
    if (hasNew) await inputMessage();

    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!state.activeChatId || !chat || !chat.messages?.length) return;
    // 空输入时：若末尾已是 AI 回复，提示用「重新生成」；若末尾是 user 则直接用最新预设/世界书发
    if (!hasNew) {
        const last = chat.messages[chat.messages.length - 1];
        if (last?.role === 'assistant') {
            toast('已有最新回复，要重生成请用消息上的「重新生成」按钮');
            return;
        }
    }
    await requestAssistantReply(chat);
}

// 重新生成：从选中的「对方」消息起截断，再基于前文重新请求
async function regenerateReplyAt(idx) {
    if (isGenerating) return;
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!chat || !chat.messages?.length) return;
    const msg = chat.messages[idx];
    if (!msg || msg.role !== 'assistant') {
        toast('只能重新生成对方回复');
        return;
    }
    const group = getReplyGroup(chat, idx);
    if (!canRerollAssistantMessage(chat, idx)) {
        toast('只能重新生成最后一条角色回复');
        return;
    }
    chat.messages.splice(group.start);
    if (state.replyDraft?.created_at === msg.created_at) clearReplyDraft();
    renderChats();
    renderActiveChat();
    await saveChat(chat);
    await requestAssistantReply(chat);
}

// 发送 BUNNY 系统信息：以 user 视角写一条 +xxx+ 元层消息，落聊天记录、传 AI 但 char 不应反应
async function sendSystemMessage() {
    if (!state.activeChatId) {
        toast('请先打开一个对话');
        return;
    }
    const textarea = $('#system-msg-text');
    const text = textarea.value.trim();
    if (!text) {
        toast('请输入系统信息内容');
        return;
    }
    let chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!chat) {
        chat = { characterId: state.activeChatId, messages: [], updated_at: Date.now() };
        state.chats.unshift(chat);
    }
    chat.messages.push({
        role: 'user',
        type: 'system',
        text,
        created_at: Date.now()
    });
    chat.updated_at = Date.now();
    textarea.value = '';
    closePopModal('system-msg-modal');
    renderChats();
    renderActiveChat();
    await saveChat(chat);
}

// AI 代回：以 user 视角拟一段回复，仅填入输入框，不发送
async function requestImpersonateReply() {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!state.activeChatId || !chat) {
        toast('请先打开一个对话');
        return;
    }
    const input = $('#chat-input');
    if (!input) return;
    const oldPlaceholder = input.placeholder;
    input.placeholder = 'AI 正在帮你拟回复…';
    input.disabled = true;
    try {
        const res = await fetch('/api/qq/impersonate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId: chat.characterId, messages: chat.messages || [], chatType: 'private' })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            await showBackendError(`代回失败 (HTTP ${res.status})`, data);
            return;
        }
        if (!data.text) {
            await showBackendError('代回返回空内容', data);
            return;
        }
        const cur = input.value;
        input.value = cur && cur.trim() ? `${cur}\n${data.text}` : data.text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange?.(input.value.length, input.value.length);
    } catch (err) {
        toast('网络错误：' + (err.message || '无法连接服务器'));
    } finally {
        input.disabled = false;
        input.placeholder = oldPlaceholder;
    }
}

// 共用：把当前聊天历史发给模型，拿回复逐条显示
async function requestAssistantReply(chat) {
    isGenerating = true;
    abortController = new AbortController();
    setSendButtonAborting(true);
    setTyping(true);
    try {
        const res = await fetch('/api/qq/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId: chat.characterId, messages: chat.messages, chatType: 'private' }),
            signal: abortController.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            await showBackendError(`生成失败 (HTTP ${res.status})`, data);
            return;
        }
        const segments = Array.isArray(data.segments) && data.segments.length
            ? data.segments
            : (data.reply ? [data.reply] : []);
        if (!segments.length) {
            await showBackendError('后台返回了空内容', data);
            notifyParent('fail', chat, '后台返回空');
            return;
        }
        await appendAssistantReplySegments(chat, segments);
        notifyParent('success', chat, segments[0] || '');
    } catch (err) {
        if (err.name === 'AbortError') {
            toast('已停止生成');
            // user 主动停，不算失败，不响铃
        } else {
            toast('网络错误：' + (err.message || '无法连接服务器'));
            notifyParent('fail', chat, '网络错误');
        }
    } finally {
        isGenerating = false;
        abortController = null;
        setSendButtonAborting(false);
        setTyping(false);
    }
}

// 通知父窗口（BunnyOS desktop）播提示音 + 决定是否弹横幅
function notifyParent(kind, chat, snippet) {
    try {
        const char = state.characters.find(c => c.id === chat.characterId);
        const payload = {
            type: 'bunnyos:notify',
            kind,
            characterId: chat.characterId,
            characterName: char?.name || '',
            avatar: char?.avatar || '',
            snippet: String(snippet || '').slice(0, 80)
        };
        window.parent?.postMessage(payload, '*');
    } catch (err) {
        console.warn('[notifyParent]', err);
    }
}

// 把后台错误（包括 detail 原始响应）完整呈现给用户
async function showBackendError(fallback, data) {
    const headline = data?.error || fallback;
    const detail = data?.detail ? `\n\n— 上游原始返回 —\n${data.detail}` : '';
    console.error('[QQ reply error]', data);
    toast(headline);
    // detail 长时再用 dialog 展开，让用户能看清模型实际返回了什么
    if (detail) await askQqConfirm(`${headline}${detail}`, '后台报错');
}

function setSendButtonAborting(aborting) {
    const btn = document.querySelector('.qq-compose-send');
    if (!btn) return;
    btn.innerHTML = aborting
        ? '<i class="bi bi-stop-fill"></i>'
        : '<i class="bi bi-send-fill"></i>';
    btn.classList.toggle('aborting', aborting);
    btn.setAttribute('aria-label', aborting ? '停止生成' : '发送');
}

// 编辑某条消息的文字
async function editMessage(idx) {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    if (!msg) return;
    state.editingMessageIndex = idx;
    renderActiveChat();
    requestAnimationFrame(() => {
        const input = $(`.qq-message-row[data-idx="${idx}"] [data-edit-input]`);
        input?.focus();
        input?.setSelectionRange?.(input.value.length, input.value.length);
    });
}

async function saveInlineEdit(idx) {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    const input = $(`.qq-message-row[data-idx="${idx}"] [data-edit-input]`);
    if (!msg || !input) return;
    setActiveMessageText(msg, input.value.trim());
    state.editingMessageIndex = -1;
    chat.updated_at = Date.now();
    renderChats();
    renderActiveChat();
    await saveChat(chat);
}

function cancelInlineEdit() {
    state.editingMessageIndex = -1;
    renderActiveChat();
}

// 加号 → 钟表：展示所有收藏的消息
const favState = { selectMode: false, selected: new Set() };

function favKey(characterId, createdAt) {
    return `${characterId}::${createdAt}`;
}

function renderFavList() {
    const list = $('#fav-list');
    const empty = $('#fav-list-empty');
    if (!list) return;
    list.innerHTML = '';
    const items = [];
    for (const chat of state.chats || []) {
        const c = state.characters.find(x => x.id === chat.characterId);
        if (!chat.messages?.length) continue;
        chat.messages.forEach((msg, idx) => {
            if (msg?.favorited) items.push({ chat, character: c, msg, idx });
        });
    }
    items.sort((a, b) => (b.msg.created_at || 0) - (a.msg.created_at || 0));
    // 清理已经不再存在的选中项
    const validKeys = new Set(items.map(it => favKey(it.chat.characterId, it.msg.created_at)));
    favState.selected.forEach(k => { if (!validKeys.has(k)) favState.selected.delete(k); });
    if (!items.length) {
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');
    for (const it of items) {
        const key = favKey(it.chat.characterId, it.msg.created_at);
        const row = document.createElement('div');
        row.className = 'qq-row qq-fav-row';
        if (favState.selectMode) row.classList.add('select-mode');
        if (favState.selected.has(key)) row.classList.add('selected');
        row.dataset.favKey = key;
        const name = it.character?.name || '未命名';
        const time = formatConversationTime(it.msg.created_at);
        const text = messageSummaryText(it.msg);
        row.innerHTML = `
            <span class="qq-avatar lg">${avatarHtml(it.character?.avatar)}</span>
            <div class="qq-row-main">
                <div class="qq-row-titleline">
                    <div class="qq-row-name">${escapeHtml(name)}</div>
                    <time class="qq-row-time">${escapeHtml(time)}</time>
                </div>
                <div class="qq-row-sub">${escapeHtml(text)}</div>
            </div>
        `;
        row.addEventListener('click', () => {
            if (favState.selectMode) {
                if (favState.selected.has(key)) favState.selected.delete(key);
                else favState.selected.add(key);
                row.classList.toggle('selected', favState.selected.has(key));
                updateFavHeader();
                return;
            }
            state.activeChatId = it.chat.characterId;
            $('#fav-list-modal')?.classList.add('hidden');
            setChatListCollapsed(true);
            renderChats();
            renderActiveChat();
        });
        list.appendChild(row);
    }
}

function updateFavHeader() {
    const toggle = $('#fav-select-toggle');
    const del = $('#fav-delete-confirm');
    const cancel = $('#fav-select-cancel');
    if (!toggle || !del || !cancel) return;
    toggle.classList.toggle('hidden', favState.selectMode);
    del.classList.toggle('hidden', !favState.selectMode);
    cancel.classList.toggle('hidden', !favState.selectMode);
    const n = favState.selected.size;
    del.textContent = n ? `删除(${n})` : '删除';
    del.disabled = !n;
}

function setFavSelectMode(on) {
    favState.selectMode = !!on;
    favState.selected = new Set();
    updateFavHeader();
    renderFavList();
}

async function batchUnfavorite() {
    if (!favState.selected.size) return;
    const n = favState.selected.size;
    if (!await askQqConfirm(`取消收藏选中的 ${n} 条消息吗？`)) return;
    const dirtyChats = new Set();
    for (const key of favState.selected) {
        const [characterId, ts] = key.split('::');
        const chat = state.chats.find(c => c.characterId === characterId);
        if (!chat) continue;
        const tsNum = Number(ts);
        const msg = chat.messages?.find(m => m.created_at === tsNum && m.favorited);
        if (msg) {
            msg.favorited = false;
            dirtyChats.add(chat);
        }
    }
    for (const chat of dirtyChats) await saveChat(chat);
    setFavSelectMode(false);
    if (state.activeChatId && dirtyChats.has(state.chats.find(c => c.characterId === state.activeChatId))) {
        renderActiveChat();
    }
    toast(`已取消收藏 ${n} 条`);
}

function openFavListModal() {
    const modal = $('#fav-list-modal');
    if (!modal) return;
    favState.selectMode = false;
    favState.selected = new Set();
    updateFavHeader();
    renderFavList();
    modal.classList.remove('hidden');
}

// 收藏 / 取消收藏某条消息
async function toggleFavorite(idx) {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    if (!msg) return;
    msg.favorited = !msg.favorited;
    renderActiveChat();
    await saveChat(chat);
    toast(msg.favorited ? '已收藏' : '已取消收藏');
}

async function deleteMessage(idx) {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    if (!msg) return;
    if (!await askQqConfirm('删除这条消息吗？')) return;
    chat.messages.splice(idx, 1);
    chat.updated_at = Date.now();
    if (state.replyDraft?.created_at === msg.created_at) clearReplyDraft();
    renderChats();
    renderActiveChat();
    await saveChat(chat);
    toast('已删除');
}

async function generateMessageVersion(idx) {
    if (isGenerating) return;
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    if (!chat || !msg || msg.role !== 'assistant') {
        toast('只有角色回复可以生成多版本');
        return;
    }
    if (!canRerollAssistantMessage(chat, idx)) {
        toast('只能给最后一条角色回复生成新版本');
        return;
    }
    isGenerating = true;
    abortController = new AbortController();
    setSendButtonAborting(true);
    setTyping(true);
    try {
        const group = getReplyGroup(chat, idx);
        const context = chat.messages.slice(0, group.start);
        const res = await fetch('/api/qq/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId: chat.characterId, messages: context, chatType: 'private' }),
            signal: abortController.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            await showBackendError(`生成失败 (HTTP ${res.status})`, data);
            return;
        }
        const segments = Array.isArray(data.segments) && data.segments.length
            ? data.segments
            : (data.reply ? [data.reply] : []);
        const cleanSegments = normalizeReplySegments(segments);
        if (!cleanSegments.length) {
            await showBackendError('没有生成新版本（后台返回空）', data);
            return;
        }
        const versions = ensureGroupVersions(chat, group);
        versions.push({ segments: cleanSegments, created_at: Date.now() });
        replaceReplyGroupWithVersion(chat, group, versions.length - 1);
        chat.updated_at = Date.now();
        renderChats();
        renderActiveChat();
        await saveChat(chat);
        toast(`已生成第 ${versions.length} 个版本`);
    } catch (err) {
        if (err.name === 'AbortError') {
            toast('已停止生成');
        } else {
            toast('网络错误：' + (err.message || '无法连接服务器'));
        }
    } finally {
        isGenerating = false;
        abortController = null;
        setSendButtonAborting(false);
        setTyping(false);
    }
}

async function switchMessageVersion(idx, dir) {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    if (!msg || msg.role !== 'assistant') return;
    const group = getReplyGroup(chat, idx);
    if (!canRerollAssistantMessage(chat, idx)) return;
    const versions = normalizedGroupVersions(chat, group);
    if (versions.length <= 1) return;
    const next = clamp(activeGroupVersionIndex(chat, group) + dir, 0, versions.length - 1);
    replaceReplyGroupWithVersion(chat, group, next);
    chat.updated_at = Date.now();
    renderChats();
    renderActiveChat();
    await saveChat(chat);
}

function setReplyDraft(idx) {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    if (!msg) return;
    const character = state.characters.find(item => item.id === state.activeChatId);
    state.replyDraft = {
        characterId: state.activeChatId,
        role: msg.role,
        name: msg.role === 'assistant' ? (character?.name || '对方') : '我',
        text: messageSummaryText(msg),
        created_at: msg.created_at || Date.now()
    };
    renderReplyDraft();
    $('#chat-input')?.focus();
}

function clearReplyDraft() {
    state.replyDraft = null;
    renderReplyDraft();
}

function renderReplyDraft() {
    const draft = state.replyDraft;
    const wrap = $('#reply-draft');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !draft);
    if (!draft) return;
    $('#reply-draft-name').textContent = `回复 ${draft.name || '消息'}`;
    $('#reply-draft-text').textContent = draft.text || '';
}

function setDeleteMode(on) {
    state.deleteMode = !!on;
    state.selectedDeleteIndexes = new Set();
    if (!on) {
        state.deleteRangeMode = false;
        const range = $('#delete-range-mode');
        if (range) range.checked = false;
    }
    hideMessageMenu();
    renderDeleteDraft();
    renderActiveChat();
}

function renderDeleteDraft() {
    const wrap = $('#delete-draft');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !state.deleteMode);
    if (!state.deleteMode) return;
    const count = state.selectedDeleteIndexes.size;
    $('#delete-info').textContent = count ? `已选择 ${count} 条信息` : '选择要删除的信息';
}

function toggleDeleteSelection(idx) {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!chat?.messages?.length) return;
    if (state.deleteRangeMode) {
        state.selectedDeleteIndexes = new Set();
        for (let i = idx; i < chat.messages.length; i++) {
            state.selectedDeleteIndexes.add(i);
        }
    } else if (state.selectedDeleteIndexes.has(idx)) {
        state.selectedDeleteIndexes.delete(idx);
    } else {
        state.selectedDeleteIndexes.add(idx);
    }
    renderDeleteDraft();
    // 仅刷新选中态，不重渲染整列，避免滚动跳到底部
    const box = $('#chat-messages');
    if (box) {
        box.querySelectorAll('[data-idx]').forEach(el => {
            const i = Number(el.dataset.idx);
            el.classList.toggle('selected', state.selectedDeleteIndexes.has(i));
        });
    }
}

async function confirmDeleteSelection() {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const indexes = [...state.selectedDeleteIndexes].sort((a, b) => b - a);
    if (!chat || !indexes.length) {
        toast('先选择要删除的信息');
        return;
    }
    if (!await askQqConfirm(`删除选中的 ${indexes.length} 条消息吗？`)) return;
    for (const idx of indexes) {
        const msg = chat.messages[idx];
        if (state.replyDraft?.created_at === msg?.created_at) clearReplyDraft();
        chat.messages.splice(idx, 1);
    }
    chat.updated_at = Date.now();
    setDeleteMode(false);
    renderChats();
    renderActiveChat();
    await saveChat(chat);
    toast('已删除');
}

function activeMessageText(msg) {
    return msg?.text || '';
}

function setActiveMessageText(msg, text) {
    if (msg?.role === 'assistant') {
        // If this bubble belongs to a generated reply group, update the active
        // group's matching segment as well so version switching keeps the edit.
        const chat = state.chats.find(item => item.characterId === state.activeChatId);
        const idx = chat?.messages?.indexOf(msg) ?? -1;
        if (chat && idx >= 0) {
            const group = getReplyGroup(chat, idx);
            const versions = ensureGroupVersions(chat, group);
            const versionIndex = activeGroupVersionIndex(chat, group);
            const segmentIndex = idx - group.start;
            const nextSegments = [...(versions[versionIndex]?.segments || [])];
            nextSegments[segmentIndex] = text;
            versions[versionIndex] = { ...versions[versionIndex], segments: nextSegments, updated_at: Date.now() };
            getGroupCarrier(chat, group).reply_group_version_index = versionIndex;
        }
    }
    msg.text = text;
}

function normalizeReplySegments(segments) {
    return (Array.isArray(segments) ? segments : [])
        .map(segment => String(segment || '').trim())
        .filter(Boolean);
}

function createReplyGroupId() {
    return `rg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getReplyGroup(chat, idx) {
    const msg = chat?.messages?.[idx];
    if (!msg || msg.role !== 'assistant') return { start: idx, end: idx, id: '' };
    const id = msg.reply_group_id || '';
    let start = idx;
    let end = idx;
    if (id) {
        while (start > 0 && chat.messages[start - 1]?.role === 'assistant' && chat.messages[start - 1].reply_group_id === id) start--;
        while (end < chat.messages.length - 1 && chat.messages[end + 1]?.role === 'assistant' && chat.messages[end + 1].reply_group_id === id) end++;
    } else {
        while (start > 0 && chat.messages[start - 1]?.role === 'assistant' && !chat.messages[start - 1].reply_group_id) start--;
        while (end < chat.messages.length - 1 && chat.messages[end + 1]?.role === 'assistant' && !chat.messages[end + 1].reply_group_id) end++;
    }
    return { start, end, id: id || createReplyGroupId() };
}

function canRerollAssistantMessage(chat, idx) {
    const msg = chat?.messages?.[idx];
    if (!msg || msg.role !== 'assistant') return false;
    const group = getReplyGroup(chat, idx);
    return idx === group.end && group.end === (chat.messages?.length || 0) - 1;
}

function getGroupCarrier(chat, group) {
    return chat.messages[group.start];
}

function normalizedGroupVersions(chat, group) {
    const carrier = getGroupCarrier(chat, group);
    if (Array.isArray(carrier?.reply_group_versions) && carrier.reply_group_versions.length) {
        return carrier.reply_group_versions;
    }
    if (Array.isArray(carrier?.versions) && carrier.versions.length) {
        return carrier.versions.map(version => ({
            segments: [version.text || ''],
            created_at: version.created_at,
            updated_at: version.updated_at
        }));
    }
    return [{
        segments: chat.messages.slice(group.start, group.end + 1).map(message => message.text || ''),
        created_at: carrier?.created_at || Date.now()
    }];
}

function ensureGroupVersions(chat, group) {
    const carrier = getGroupCarrier(chat, group);
    const versions = normalizedGroupVersions(chat, group);
    const id = carrier.reply_group_id || group.id || createReplyGroupId();
    carrier.reply_group_versions = versions;
    carrier.reply_group_version_index = activeGroupVersionIndex(chat, group);
    for (let i = group.start; i <= group.end; i++) {
        chat.messages[i].reply_group_id = id;
    }
    return carrier.reply_group_versions;
}

function activeGroupVersionIndex(chat, group) {
    const carrier = getGroupCarrier(chat, group);
    const versions = normalizedGroupVersions(chat, group);
    const index = Number.isInteger(carrier?.reply_group_version_index)
        ? carrier.reply_group_version_index
        : (Number.isInteger(carrier?.version_index) ? carrier.version_index : 0);
    return clamp(index, 0, Math.max(0, versions.length - 1));
}

function replaceReplyGroupWithVersion(chat, group, versionIndex) {
    const carrier = getGroupCarrier(chat, group);
    const versions = ensureGroupVersions(chat, group);
    const id = carrier.reply_group_id || group.id || createReplyGroupId();
    const nextIndex = clamp(versionIndex, 0, versions.length - 1);
    const segments = normalizeReplySegments(versions[nextIndex]?.segments || []);
    const baseTime = Date.now();
    const nextMessages = segments.map((text, offset) => ({
        role: 'assistant',
        type: 'text',
        text,
        created_at: offset === 0 ? (carrier.created_at || baseTime) : baseTime + offset,
        reply_group_id: id,
        reply_group_version_index: nextIndex,
        reply_group_versions: offset === 0 ? versions : undefined
    })).map(message => {
        if (message.reply_group_versions === undefined) delete message.reply_group_versions;
        return message;
    });
    chat.messages.splice(group.start, group.end - group.start + 1, ...nextMessages);
}

async function appendAssistantReplySegments(chat, segments) {
    const cleanSegments = normalizeReplySegments(segments);
    if (!cleanSegments.length) return;
    const groupId = createReplyGroupId();
    const createdAt = Date.now();
    const versions = [{ segments: cleanSegments, created_at: createdAt }];
    for (let i = 0; i < cleanSegments.length; i++) {
        if (i > 0) await sleep(Math.min(1400, 350 + cleanSegments[i].length * 45));
        chat.messages.push({
            role: 'assistant',
            type: 'text',
            text: cleanSegments[i],
            created_at: Date.now(),
            reply_group_id: groupId,
            reply_group_version_index: 0,
            reply_group_versions: i === 0 ? versions : undefined
        });
        if (chat.messages[chat.messages.length - 1].reply_group_versions === undefined) {
            delete chat.messages[chat.messages.length - 1].reply_group_versions;
        }
        chat.updated_at = Date.now();
        renderChats();
        renderActiveChat();
    }
    await saveChat(chat);
}

function setTyping(on) {
    const status = $('#chat-status');
    if (!status) return;
    if (on) {
        status.dataset.typing = '1';
        status.textContent = '正在输入…';
    } else {
        delete status.dataset.typing;
        status.textContent = '在线';
    }
}

async function appendChatMessage(message) {
    let chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!chat) {
        chat = { characterId: state.activeChatId, messages: [] };
        state.chats.unshift(chat);
    }
    chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
    if (state.replyDraft && state.replyDraft.characterId === state.activeChatId && !message.reply_to) {
        message.reply_to = { ...state.replyDraft };
    }
    if (message.role === 'user' && !message.persona) {
        message.persona = personaSnapshot();
    }
    chat.messages.push(message);
    chat.updated_at = Date.now();
    if (message.role === 'user' && state.replyDraft) clearReplyDraft();
    renderChats();
    renderActiveChat();
    await saveChat(chat);
}

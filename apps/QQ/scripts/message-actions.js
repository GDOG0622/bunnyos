async function inputMessage() {
    const characterId = state.activeChatId;
    const input = $('#chat-input');
    const rawText = input.value.trim();
    if (!rawText || !characterId) return false;
    input.value = '';

    // 自动检测 URL → 解析链接卡片，失败则降级发纯文本
    const urlMatch = extractFirstLink(rawText);
    if (urlMatch) {
        const url = normalizeInputLink(urlMatch);
        toast('正在解析链接...');
        try {
            const frontend = await fetchFrontendHtml(url).catch(() => null);

            const res = await fetch('/api/qq/link-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, rawText, frontend })
            });
            if (res.ok) {
                const data = await res.json();
                await appendLinkPreviewMessage(data, url, characterId);
                return true;
            }
        } catch {}
        // 解析失败：静默降级为普通文本
    }

    await appendChatMessage({ role: 'user', type: parseVoiceText(rawText) ? 'voice' : 'text', text: rawText, created_at: Date.now() }, characterId);
    return true;
}

function makeClientMessageId(prefix = 'msg') {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function extractFirstLink(text) {
    const match = String(text || '').match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s"'<>，。！？、；）)】\]]*)?/i);
    if (!match) return '';
    return match[0].replace(/[，。！？、；：:）)\]}]+$/g, '');
}

function normalizeInputLink(url) {
    const value = String(url || '').trim();
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

async function appendLinkPreviewMessage(data, fallbackUrl, characterId = state.activeChatId) {
    const cleanTitle = String(data?.title || '').trim();
    const cleanDesc = String(data?.description || '').trim().replace(/^预览受限：.*/, '');
    const limitedReason = String(data?.limitedReason || '').trim();
    const source = String(data?.source || '').trim();
    const comments = Array.isArray(data?.comments) ? data.comments : [];
    const parts = [cleanTitle, cleanDesc].filter(Boolean).filter((p, i, a) => a.indexOf(p) === i);
    await appendChatMessage({
        role: 'user', type: 'link',
        url: data?.url || fallbackUrl,
        title: cleanTitle,
        description: cleanDesc,
        fullDescription: cleanDesc,
        image: data?.image || '',
        imageLocal: data?.imageLocal || '',
        siteName: data?.siteName || '',
        previewType: data?.previewType || '',
        platform: data?.platform || '',
        price: data?.price || '',
        comments,
        source,
        limitedReason,
        text: `[链接] ${parts.join('：') || data?.siteName || fallbackUrl}`,
        created_at: Date.now()
    }, characterId);
    if (limitedReason && data?.previewType !== 'product') toast(limitedReason);
}

async function fetchFrontendHtml(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
        const resp = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: ctrl.signal,
            headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });
        const ctype = resp.headers.get('content-type') || '';
        if (!resp.ok || !/text\/html|application\/xhtml/i.test(ctype)) return null;
        const html = await resp.text();
        return html.length <= 4 * 1024 * 1024 ? { finalUrl: resp.url || url, html } : null;
    } finally {
        clearTimeout(timer);
    }
}

// 每个角色独立一个生成任务。切换聊天不会中止其他角色的请求。
const generationTasks = new Map();

function activeGenerationTask(characterId = state.activeChatId) {
    return characterId ? generationTasks.get(characterId) || null : null;
}

function syncActiveGenerationUi() {
    const running = Boolean(activeGenerationTask());
    setSendButtonAborting(running);
    setTyping(running);
}

async function generateReply(e) {
    e.preventDefault();
    // 生成中点击 = 停止
    const runningTask = activeGenerationTask();
    if (runningTask) {
        runningTask.cancelled = true;
        await fetch('/api/qq/reply/cancel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId: state.activeChatId, generationId: runningTask.id }), keepalive: true
        }).catch(() => {});
        runningTask.controller.abort();
        return;
    }
    const input = $('#chat-input');
    const hasNew = input.value.trim().length > 0;
    const characterId = state.activeChatId;
    if (hasNew) await inputMessage();

    const chat = state.chats.find(item => item.characterId === characterId);
    if (!characterId || !chat || !chat.messages?.length) return;
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

// 基于最后一组回复前的上下文生成新版本，服务端保存后再展示。
async function regenerateReplyAt(idx) {
    if (activeGenerationTask()) {
        toast('这个对话正在生成中');
        return;
    }
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
    await generateMessageVersion(group.end);
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
function rememberContextItemization(data) {
    if (!data?.context_itemization) return;
    try {
        localStorage.setItem('bunnyos:last-context-itemization', JSON.stringify({
            ...data.context_itemization,
            warnings: data.context_warnings || [],
            savedAt: Date.now()
        }));
    } catch { /* 诊断信息写入失败不影响聊天 */ }
}

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
        const data = await readApiResponse(res);
        rememberContextItemization(data);
        if (!res.ok) {
            await showBackendError(`代回失败 (HTTP ${res.status})`, data, res);
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
        await showBackendError('网络错误：无法连接 BunnyOS 后端', {
            error: err.message || '无法连接服务器',
            error_code: err.name || 'CLIENT_NETWORK_ERROR',
            error_type: 'client_network_error',
            operation: 'impersonate',
            timestamp: new Date().toISOString(),
        });
    } finally {
        input.disabled = false;
        input.placeholder = oldPlaceholder;
    }
}

// 服务端使用已保存的聊天生成并提交回复，浏览器接收确认后的记录。
async function requestAssistantReply(chat) {
    if (!chat?.characterId || generationTasks.has(chat.characterId)) return;
    const task = { id: makeClientMessageId('generation'), controller: new AbortController(), startedAt: Date.now(), kind: 'reply' };
    generationTasks.set(chat.characterId, task);
    syncActiveGenerationUi();
    let summaryResult = null;
    try {
        summaryResult = await maybeRunLayerSummary(chat, task.controller.signal);
        if (summaryResult?.failed) return;
        if (task.cancelled) return;
        const data = await mutateChat(chat.characterId, '/api/qq/reply', 'POST', {
            characterId: chat.characterId, generationId: task.id, chatType: 'private'
        }, null, task.controller.signal);
        rememberContextItemization(data);
        renderChats();
        if (state.activeChatId === chat.characterId) {
            renderActiveChat();
            revealSavedReply(chat);
        }
        notifyParent('success', chat, data.segments?.[0] || '');
        if (summaryResult?.needsBigSummary && state.activeChatId === chat.characterId) {
            setTimeout(() => offerBigSummary(chat.characterId), 250);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            toast('已停止生成');
        } else if (err.payload) {
            await showBackendError(`生成失败 (HTTP ${err.status})`, err.payload, err.response);
            notifyParent('fail', chat, err.message);
        } else {
            await showBackendError('网络错误：无法连接 BunnyOS 后端', {
                error: err.message || '无法连接服务器',
                error_code: err.name || 'CLIENT_NETWORK_ERROR',
                error_type: 'client_network_error',
                operation: 'reply',
                timestamp: new Date().toISOString(),
            });
            notifyParent('fail', chat, '网络错误');
        }
    } finally {
        if (generationTasks.get(chat.characterId) === task) generationTasks.delete(chat.characterId);
        syncActiveGenerationUi();
    }
}

// 找最后一张"AI 还没看到"的用户图片（最后 assistant 消息之后的最后一张 user image）
// async 是为了在 consumed 后能从 IDB 回退取 dataUrl（re-roll 场景）
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
            snippet: String(snippet || '').slice(0, 80),
            forceBanner: chat.characterId !== state.activeChatId
        };
        window.parent?.postMessage(payload, '*');
    } catch (err) {
        console.warn('[notifyParent]', err);
    }
}

// 和 SillyTavern 一样先保留原始响应，再按常见 API 错误结构提取原因。
async function readApiResponse(response) {
    const rawText = await response.text();
    if (!rawText) return {};
    try {
        return JSON.parse(rawText);
    } catch {
        return {
            error: 'BunnyOS 后端返回了非 JSON 内容',
            error_code: 'INVALID_BACKEND_RESPONSE',
            error_type: 'invalid_response_error',
            detail: rawText.slice(0, 12000),
            timestamp: new Date().toISOString(),
        };
    }
}

function formatErrorValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
}

function formatRawErrorDetail(detail) {
    if (!detail) return '';
    if (typeof detail === 'object') return JSON.stringify(detail, null, 2);
    const text = String(detail);
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// 把可读原因、错误码、请求信息和上游原始响应完整呈现给用户。
async function showBackendError(fallback, data = {}, response = null) {
    const headline = formatErrorValue(data.error) || fallback;
    const rows = [
        ['错误原因', headline],
        ['上游说明', data.upstream_message],
        ['BunnyOS HTTP', response ? `${response.status} ${response.statusText || ''}`.trim() : ''],
        ['上游 HTTP', data.upstream_status ? `${data.upstream_status} ${data.upstream_status_text || ''}`.trim() : ''],
        ['错误代码', data.error_code ?? data.code],
        ['错误类型', data.error_type ?? data.type],
        ['相关参数', data.error_param ?? data.param],
        ['模型', data.model],
        ['请求 ID', data.request_id],
        ['请求阶段', data.operation],
        ['第几次尝试', data.attempt],
        ['结束原因', data.finish_reason],
        ['发生时间', data.timestamp],
    ].filter(([, value]) => formatErrorValue(value));
    const summary = rows.map(([label, value]) => `${label}：${formatErrorValue(value)}`).join('\n');
    const rawDetail = formatRawErrorDetail(data.detail);
    const fullMessage = rawDetail
        ? `${summary}\n\n— 上游原始返回 —\n${rawDetail}`
        : summary;
    const titleStatus = data.upstream_status || response?.status;

    console.error('[QQ request error]', { response, data });
    toast(headline);
    await openQqDialog({
        title: titleStatus ? `请求失败 · HTTP ${titleStatus}` : '请求失败',
        message: fullMessage || fallback,
        copyText: fullMessage || fallback,
    });
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
        if (!input) return;
        const supportsFieldSizing = CSS?.supports?.('field-sizing', 'content');
        const autoGrow = () => {
            // 高度跟内容（所有浏览器）
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
            // 宽度跟内容（非 field-sizing 浏览器手动测）
            if (!supportsFieldSizing) {
                const mirror = document.createElement('span');
                const cs = getComputedStyle(input);
                mirror.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;';
                mirror.style.font = cs.font;
                mirror.style.letterSpacing = cs.letterSpacing;
                mirror.textContent = input.value || ' ';
                document.body.appendChild(mirror);
                const w = Math.min(mirror.offsetWidth + 8, input.parentElement?.parentElement?.clientWidth || 540);
                input.style.width = Math.max(w, 40) + 'px';
                mirror.remove();
            }
        };
        autoGrow();
        input.addEventListener('input', autoGrow);
        input.focus();
        input.setSelectionRange?.(input.value.length, input.value.length);
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
        row.addEventListener('click', async () => {
            if (favState.selectMode) {
                if (favState.selected.has(key)) favState.selected.delete(key);
                else favState.selected.add(key);
                row.classList.toggle('selected', favState.selected.has(key));
                updateFavHeader();
                return;
            }
            $('#fav-list-modal')?.classList.add('hidden');
            popNavigationLayer('favorites');
            await activateChat(it.chat.characterId);
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
    const dirtyIds = new Set();
    for (const key of favState.selected) {
        const [characterId, ts] = key.split('::');
        const chat = state.chats.find(c => c.characterId === characterId);
        if (!chat) continue;
        const tsNum = Number(ts);
        const msg = chat.messages?.find(m => m.created_at === tsNum && m.favorited);
        if (msg) {
            msg.favorited = false;
            dirtyIds.add(characterId);
        }
    }
    for (const characterId of dirtyIds) {
        const chat = state.chats.find(c => c.characterId === characterId);
        if (chat) await saveChat(chat);
    }
    setFavSelectMode(false);
    renderFavList();
    if (state.activeChatId && dirtyIds.has(state.activeChatId)) {
        renderActiveChat();
    }
    toast(`已取消收藏 ${n} 条`);
}

async function openFavListModal() {
    const modal = $('#fav-list-modal');
    if (!modal) return;
    favState.selectMode = false;
    favState.selected = new Set();
    updateFavHeader();
    modal.classList.remove('hidden');
    pushNavigationLayer('favorites');
    const list = $('#fav-list');
    if (list) list.innerHTML = '<div class="qq-empty qq-empty-inline"><div class="qq-empty-title">正在加载收藏…</div></div>';
    await ensureAllChatsLoaded();
    renderFavList();
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
    if (activeGenerationTask()) {
        toast('这个对话正在生成中');
        return;
    }
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
    const task = { id: makeClientMessageId('generation'), controller: new AbortController(), startedAt: Date.now(), kind: 'version' };
    generationTasks.set(chat.characterId, task);
    syncActiveGenerationUi();
    try {
        const group = getReplyGroup(chat, idx);
        if (task.cancelled) return;
        const data = await mutateChat(chat.characterId, '/api/qq/reply', 'POST', {
            characterId: chat.characterId, generationId: task.id, chatType: 'private', generationType: 'regenerate', replaceIndex: group.start
        }, null, task.controller.signal);
        rememberContextItemization(data);
        renderChats();
        if (state.activeChatId === chat.characterId) renderActiveChat();
        toast('已保存新版本');
    } catch (err) {
        if (err.name === 'AbortError') {
            toast('已停止生成');
        } else if (err.payload) {
            await showBackendError(`生成失败 (HTTP ${err.status})`, err.payload, err.response);
        } else {
            await showBackendError('网络错误：无法连接 BunnyOS 后端', {
                error: err.message || '无法连接服务器',
                error_code: err.name || 'CLIENT_NETWORK_ERROR',
                error_type: 'client_network_error',
                operation: 'reply_version',
                timestamp: new Date().toISOString(),
            });
        }
    } finally {
        if (generationTasks.get(chat.characterId) === task) generationTasks.delete(chat.characterId);
        syncActiveGenerationUi();
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
            const messageIndex = idx - group.start;
            versions[versionIndex].messages[messageIndex].text = text;
            versions[versionIndex].updated_at = Date.now();
            chat.messages[group.start].reply_group_version_index = versionIndex;
        }
    }
    msg.text = text;
}

const { getReplyGroup, normalizedGroupVersions, ensureGroupVersions,
    activeGroupVersionIndex, replaceReplyGroupWithVersion } = QqReplies;

function canRerollAssistantMessage(chat, index) {
    const group = getReplyGroup(chat, index);
    return chat.messages[index]?.role === 'assistant' && index === group.end && group.end === chat.messages.length - 1;
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

async function appendChatMessage(message, characterId = state.activeChatId) {
    if (!characterId) return null;
    let chat = state.chats.find(item => item.characterId === characterId);
    if (!chat) {
        chat = { characterId, messages: [] };
        state.chats.unshift(chat);
    }
    chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
    if (!message.id) message.id = makeClientMessageId();
    if (state.replyDraft && state.replyDraft.characterId === characterId && !message.reply_to) {
        message.reply_to = { ...state.replyDraft };
    }
    if (message.role === 'user' && !message.persona) {
        message.persona = personaSnapshot();
    }
    chat.messages.push(message);
    chat.updated_at = Date.now();
    if (message.role === 'user' && state.replyDraft?.characterId === characterId) clearReplyDraft();
    renderChats();
    if (state.activeChatId === characterId) renderActiveChat();
    await saveChat(chat);
    return message;
}

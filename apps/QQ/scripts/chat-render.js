function renderChats() {
    const list = $('#chat-list');
    const empty = $('#empty-chats');
    list.querySelectorAll('.qq-chat-row').forEach(el => el.remove());
    if (!state.chats.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    for (const chat of state.chats) {
        const c = state.characters.find(item => item.id === chat.characterId);
        if (!c) continue;
        const row = document.createElement('div');
        row.className = 'qq-row qq-chat-row';
        row.classList.toggle('active', state.activeChatId === chat.characterId);
        const lastMsg = chat.messages?.[chat.messages.length - 1];
        const last = lastMsg ? messageSummaryText(lastMsg) : summaryForCharacter(c);
        const lastTime = formatConversationTime(lastMsg?.created_at || chat.updated_at);
        row.innerHTML = `
            <span class="qq-avatar lg">${avatarHtml(c.avatar)}</span>
            <div class="qq-row-main">
                <div class="qq-row-titleline">
                    <div class="qq-row-name">${escapeHtml(c.name || '未命名')}</div>
                    <time class="qq-row-time">${escapeHtml(lastTime)}</time>
                </div>
                <div class="qq-row-sub">${escapeHtml(last)}</div>
            </div>
        `;
        row.addEventListener('click', () => {
            state.activeChatId = chat.characterId;
            setChatListCollapsed(true);
            renderChats();
            renderActiveChat();
        });
        list.appendChild(row);
    }
}

function renderActiveChat() {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const character = state.characters.find(item => item.id === state.activeChatId);
    if (state.replyDraft && state.replyDraft.characterId !== state.activeChatId) {
        clearReplyDraft();
    }
    // 竖屏下：有聊天打开就让列表让位给对话区，并隐藏顶/底栏
    $('#qq-root')?.classList.toggle('chat-open', !!(chat && character));
    notifyNavState();
    $('#empty-chat-view').classList.toggle('hidden', !!chat);
    $('#chat-room').classList.toggle('hidden', !chat);
    if (!chat || !character) return;

    $('#chat-title').textContent = character.name || '未命名';
    const headAvatar = $('#chat-head-avatar');
    if (headAvatar) headAvatar.innerHTML = avatarHtml(character.avatar);
    const statusEl = $('#chat-status');
    if (statusEl && !statusEl.dataset.typing) statusEl.textContent = '在线';
    const box = $('#chat-messages');
    box.innerHTML = '';
    if (!chat.messages?.length) {
        const empty = document.createElement('div');
        empty.className = 'qq-empty qq-empty-inline';
        empty.innerHTML = '<div class="qq-empty-title">还没有消息</div><div class="qq-empty-sub">先发一句吧。</div>';
        box.appendChild(empty);
        return;
    }
    let lastDay = '';
    for (let i = 0; i < chat.messages.length; i++) {
        const msg = chat.messages[i];
        // 日期分割线
        const day = dayKey(msg.created_at);
        if (day && day !== lastDay) {
            lastDay = day;
            const divider = document.createElement('div');
            divider.className = 'qq-date-divider';
            divider.innerHTML = `<span>${escapeHtml(formatDateDivider(msg.created_at))}</span>`;
            box.appendChild(divider);
        }
        // BUNNY 系统信息：居中灰字，不走气泡结构。`+...+` 仅给 AI 看，UI 不显示
        if (msg.type === 'system') {
            const sys = document.createElement('div');
            sys.className = 'qq-system-message';
            if (state.deleteMode) sys.classList.add('delete-mode');
            if (state.selectedDeleteIndexes.has(i)) sys.classList.add('selected');
            sys.dataset.idx = i;
            sys.textContent = msg.text || '';
            box.appendChild(sys);
            continue;
        }
        const isAssistant = msg.role === 'assistant';
        const item = document.createElement('div');
        item.className = `qq-message-row ${isAssistant ? 'assistant' : 'user'}${msg.favorited ? ' is-fav' : ''}`;
        item.classList.toggle('delete-mode', state.deleteMode);
        item.classList.toggle('selected', state.selectedDeleteIndexes.has(i));
        item.dataset.idx = i;
        // 一对一私聊不放气泡头像；时间/已读和气泡平行放在外侧。
        item.innerHTML = `<div class="qq-msg-col">${messageContentHtml(msg, i)}${versionNavHtml(chat, i)}</div>${metaHtml(msg)}`
            + (isAssistant ? msgActionsHtml(chat, i) : '');
        box.appendChild(item);
    }
    box.scrollTop = box.scrollHeight;
}

// 「对方」气泡旁的操作按钮（横屏悬停显示）
function msgActionsHtml(chat, idx) {
    const msg = chat.messages[idx];
    const canReroll = canRerollAssistantMessage(chat, idx);
    return `<div class="qq-msg-actions">
        ${canReroll ? '<button type="button" data-act="regen" title="重新生成"><i class="bi bi-arrow-clockwise"></i></button>' : ''}
        <button type="button" data-act="edit" title="编辑信息"><i class="bi bi-pencil"></i></button>
        <button type="button" data-act="fav" title="收藏信息"><i class="bi ${msg.favorited ? 'bi-heart-fill' : 'bi-heart'}"></i></button>
        ${canReroll ? '<button type="button" data-act="version" title="生成新版本"><i class="bi bi-chevron-right"></i></button>' : ''}
    </div>`;
}

function messageContentHtml(msg, idx) {
    const reply = replyContentHtml(msg.reply_to);
    if (state.editingMessageIndex === idx) {
        return `<div class="qq-message">
            <div class="qq-message-edit">
                <textarea data-edit-input>${escapeHtml(activeMessageText(msg))}</textarea>
                <div class="qq-message-edit-actions">
                    <button type="button" data-edit-cancel>取消</button>
                    <button type="button" data-edit-save>保存</button>
                </div>
            </div>
        </div>`;
    }
    if (msg.type === 'sticker' || msg.type === 'image') {
        return `<div class="qq-message qq-message-media">${reply}<img src="${escapeAttr(msg.image || '')}" alt="${escapeAttr(msg.text || '')}"></div>`;
    }
    if (msg.type === 'transfer') {
        const amount = `${escapeHtml(msg.currency || '')}${escapeHtml(msg.amount || '')}`;
        const note = msg.note ? `<div class="qq-transfer-note">${escapeHtml(msg.note)}</div>` : '';
        return `<div class="qq-message qq-transfer-card">${reply}<div class="qq-transfer-amount">${amount}</div>${note}<div class="qq-transfer-label">转账</div></div>`;
    }
    if (msg.type === 'link') {
        const t = escapeHtml(msg.title || msg.url || '链接');
        const d = msg.description ? `<div class="qq-link-desc">${escapeHtml(msg.description)}</div>` : '';
        const site = escapeHtml(msg.siteName || '');
        const img = msg.image
            ? `<img class="qq-link-thumb" src="${escapeAttr(msg.image)}" alt="" onerror="this.remove()">`
            : '';
        const href = escapeAttr(msg.url || '');
        return `<div class="qq-message qq-link-card">${reply}<a class="qq-link-card-inner" href="${href}" target="_blank" rel="noopener noreferrer">${img}<div class="qq-link-body"><div class="qq-link-title">${t}</div>${d}<div class="qq-link-site">${site}</div></div></a></div>`;
    }
    return `<div class="qq-message">${reply}${escapeHtml(activeMessageText(msg))}</div>`;
}

function versionNavHtml(chat, idx) {
    const msg = chat?.messages?.[idx];
    if (msg?.role !== 'assistant') return '';
    const group = getReplyGroup(chat, idx);
    if (!group || !canRerollAssistantMessage(chat, idx)) return '';
    const versions = normalizedGroupVersions(chat, group);
    if (versions.length <= 1) return '';
    const index = activeGroupVersionIndex(chat, group);
    return `<div class="qq-version-nav">
        <button type="button" data-version-dir="-1" ${index <= 0 ? 'disabled' : ''} aria-label="上一个版本"><i class="bi bi-chevron-left"></i></button>
        <span>${index + 1}/${versions.length}</span>
        <button type="button" data-version-dir="1" ${index >= versions.length - 1 ? 'disabled' : ''} aria-label="下一个版本"><i class="bi bi-chevron-right"></i></button>
    </div>`;
}

function replyContentHtml(reply) {
    if (!reply) return '';
    return `<span class="qq-message-reply">
        <span class="qq-message-reply-name">${escapeHtml(reply.name || '消息')}</span>
        <span class="qq-message-reply-text">${escapeHtml(reply.text || '')}</span>
    </span>`;
}

// 气泡右下角：时间 +（我的消息）已读双勾
function metaHtml(msg) {
    const t = formatTime(msg.created_at);
    if (!t) return '';
    const read = msg.role !== 'assistant'
        ? ' <i class="bi bi-check2-all qq-msg-read"></i>'
        : '';
    return `<span class="qq-msg-meta">${t}${read}</span>`;
}

function dayKey(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatConversationTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const today = dayKey(Date.now());
    const yesterday = dayKey(Date.now() - 86400000);
    const key = dayKey(ts);
    if (key === today) return formatTime(ts);
    if (key === yesterday) return '昨天';
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateDivider(ts) {
    if (!ts) return '';
    const now = Date.now();
    const dk = dayKey(ts);
    if (dk === dayKey(now)) return '今天';
    if (dk === dayKey(now - 86400000)) return '昨天';
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
}

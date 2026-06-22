const TAB_TITLES = { messages: '消息', contacts: '联系人', moments: '动态', me: '我' };
function switchTab(tab) {
    state.tab = tab;
    $$('.qq-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.qq-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
    const title = $('#qq-topbar-title');
    if (title) title.textContent = TAB_TITLES[tab] || 'QQ';
}

function setChatListCollapsed(collapsed) {
    state.chatListCollapsed = collapsed;
    $('.qq-chat-shell')?.classList.toggle('chat-list-collapsed', collapsed);
}

function bindComposeResize() {
    const compose = $('#chat-compose');
    const room = $('#chat-room');
    if (!compose || !room) return;

    let startY = 0;
    let startHeight = state.composeHeight;
    let dragging = false;

    compose.addEventListener('pointerdown', (event) => {
        const rect = compose.getBoundingClientRect();
        if (event.clientY - rect.top > 8) return;
        dragging = true;
        startY = event.clientY;
        startHeight = state.composeHeight;
        compose.setPointerCapture?.(event.pointerId);
        compose.classList.add('resizing-compose');
        event.preventDefault();
    });

    compose.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const next = clamp(startHeight + startY - event.clientY, 150, 420);
        state.composeHeight = next;
        room.style.setProperty('--qq-compose-h', `${next}px`);
    });

    function stopResize(event) {
        if (!dragging) return;
        dragging = false;
        compose.releasePointerCapture?.(event.pointerId);
        compose.classList.remove('resizing-compose');
    }

    compose.addEventListener('pointerup', stopResize);
    compose.addEventListener('pointercancel', stopResize);
}

function bindMessageMenuEvents() {
    const box = $('#chat-messages');
    if (!box) return;
    // 改为「点击气泡」触发菜单，替代长按（用户决策 2026-06-22）
    // 桌面右键 contextmenu 保留作为兜底
    box.addEventListener('contextmenu', (event) => {
        const row = event.target.closest('.qq-message-row');
        if (!row) return;
        if (state.deleteMode) return;
        event.preventDefault();
        openMessageMenu(event, Number(row.dataset.idx));
    });
}

function switchSubTab(name) {
    state.subtab = name;
    $$('.qq-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab === name));
    $$('.qq-subpanel').forEach(p => p.classList.toggle('hidden', p.dataset.subpanel !== name));
}

function onAddAction(e) {
    e.stopPropagation();
    $('#add-menu').classList.toggle('hidden');
}

function hideAddMenu() {
    $('#add-menu').classList.add('hidden');
}

function openMessageMenu(event, idx) {
    if (state.deleteMode) return;
    if (Number.isNaN(idx) || idx < 0) return;
    const menu = $('#message-menu');
    if (!menu) return;
    state.messageMenuIndex = idx;
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    const msg = chat?.messages?.[idx];
    if (!msg) return;

    const versionBtn = menu.querySelector('[data-action="version"]');
    const group = msg.role === 'assistant' ? getReplyGroup(chat, idx) : null;
    const canReroll = canRerollAssistantMessage(chat, idx);
    const regenBtn = menu.querySelector('[data-action="regen"]');
    if (regenBtn) regenBtn.classList.toggle('hidden', !canReroll);
    if (versionBtn) versionBtn.classList.toggle('hidden', !canReroll || idx !== group.end);
    const favIcon = menu.querySelector('[data-action="fav"] i');
    const favText = menu.querySelector('[data-action="fav"] span');
    if (favIcon) favIcon.className = `bi ${msg.favorited ? 'bi-heart-fill' : 'bi-heart'}`;
    if (favText) favText.textContent = msg.favorited ? '取消收藏' : '收藏';

    menu.classList.remove('hidden');
    menu.classList.add('icon-menu');
    state.messageMenuOpenedAt = Date.now();
    const rect = menu.getBoundingClientRect();
    // 单击模式：菜单贴气泡侧边（char→右；self→左），垂直居中对齐气泡
    const row = event.target?.closest?.('.qq-message-row');
    const bubble = event.target?.closest?.('.qq-message') || row;
    const bubbleRect = bubble?.getBoundingClientRect?.();
    const margin = 6;
    let x, y;
    if (bubbleRect) {
        y = bubbleRect.top + (bubbleRect.height - rect.height) / 2;
        const isSelf = row?.classList.contains('user');
        if (isSelf) {
            // 气泡在右 → 菜单放气泡左侧
            x = bubbleRect.left - rect.width - margin;
            if (x < 8) x = bubbleRect.right + margin; // 没空间则翻到右边
        } else {
            x = bubbleRect.right + margin;
            if (x + rect.width > window.innerWidth - 8) x = bubbleRect.left - rect.width - margin;
        }
    } else {
        x = event.clientX || window.innerWidth / 2;
        y = event.clientY || window.innerHeight / 2;
    }
    x = clamp(x, 8, window.innerWidth - rect.width - 8);
    y = clamp(y, 8, window.innerHeight - rect.height - 8);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}

function hideMessageMenu() {
    const menu = $('#message-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.classList.remove('icon-menu');
    state.messageMenuIndex = -1;
}

function handleMessageMenuAction(action) {
    const idx = state.messageMenuIndex;
    hideMessageMenu();
    if (idx < 0) return;
    if (action === 'regen') regenerateReplyAt(idx);
    else if (action === 'edit') editMessage(idx);
    else if (action === 'fav') toggleFavorite(idx);
    else if (action === 'version') generateMessageVersion(idx);
    else if (action === 'reply') setReplyDraft(idx);
    else if (action === 'delete') deleteMessage(idx);
}

function handleAddAction(action) {
    if (action === 'add-friend') {
        openFriendModal();
        return;
    }
    if (action === 'create-group') {
        createGroupChat();
    }
}


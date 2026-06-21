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
    let longPressTimer = null;

    function clearLongPress() {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }

    box.addEventListener('contextmenu', (event) => {
        const row = event.target.closest('.qq-message-row');
        if (!row) return;
        if (state.deleteMode) return;
        event.preventDefault();
        openMessageMenu(event, Number(row.dataset.idx));
    });

    box.addEventListener('pointerdown', (event) => {
        const row = event.target.closest('.qq-message-row');
        if (state.deleteMode) return;
        if (!row || event.target.closest('.qq-msg-actions')) return;
        clearLongPress();
        longPressTimer = setTimeout(() => {
            openMessageMenu(event, Number(row.dataset.idx));
        }, 520);
    });

    ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach(type => {
        box.addEventListener(type, clearLongPress, { passive: true });
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
    const rowRect = event.target.closest?.('.qq-message-row')?.getBoundingClientRect?.();
    const anchorX = rowRect ? rowRect.left + rowRect.width / 2 : (event.clientX || window.innerWidth / 2);
    const anchorY = rowRect ? rowRect.top : (event.clientY || window.innerHeight / 2);
    const x = clamp(anchorX - rect.width / 2, 8, window.innerWidth - rect.width - 8);
    const y = clamp(anchorY - rect.height - 8, 8, window.innerHeight - rect.height - 8);
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


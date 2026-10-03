const chatLoadPromises = new Map();

async function fetchQqJson(url, fallback, strict = false) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try { return await response.json(); } catch (error) {
        if (strict) throw error;
        return fallback;
    }
}

function markChatSummary(chat) {
    return {
        ...(chat && typeof chat === 'object' ? chat : {}),
        _messagesLoaded: false,
    };
}

async function loadSecondaryQqData() {
    const [groupsResult, packsResult] = await Promise.allSettled([
        fetchQqJson('/api/qq/groups', []),
        fetchQqJson('/api/qq/sticker-packs', []),
    ]);
    state.groups = groupsResult.status === 'fulfilled' && Array.isArray(groupsResult.value) ? groupsResult.value : [];
    state.stickerPacks = packsResult.status === 'fulfilled' && Array.isArray(packsResult.value) ? packsResult.value : [];
    state.groupchats = [];
    renderGroupChats();
    // 只创建每个表情合集的入口缩略图；合集内部图片仍在用户点开后才加载。
    renderStickerPacks();
    if (state.activeChatId) renderActiveChat();
}

async function loadData() {
    try {
        // 首屏只等联系人和聊天摘要；群聊、表情合集等非首屏数据在后台补载。
        const [chars, chats] = await Promise.all([
            fetchQqJson('/api/qq/characters', [], true),
            fetchQqJson('/api/qq/chats?summary=1', [], true),
        ]);
        if (!Array.isArray(chars) || !Array.isArray(chats)) throw new Error('QQ 数据格式不正确');
        state.characters = chars;
        state.chats = chats.map(markChatSummary);
        $('#chat-list')?.querySelector('.qq-core-load-error')?.remove();
        renderContacts();
        renderChats();
        window.bunnyosQqCoreReady = true;
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'bunnyos:qq-core-ready' }, location.origin);
        }
        loadSecondaryQqData().catch(error => console.warn('[QQ] secondary data load failed', error));
    } catch (err) {
        window.bunnyosQqCoreReady = false;
        console.warn('[QQ] load core data failed', err);
        renderQqCoreLoadError(err);
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'bunnyos:qq-core-error', message: err?.message || 'QQ 数据加载失败' }, location.origin);
        }
    }
}

async function ensureChatLoaded(characterId) {
    if (!characterId) return null;
    let chat = state.chats.find(item => item.characterId === characterId);
    if (chat?._messagesLoaded || (chat && Array.isArray(chat.messages) && chat._messagesLoaded !== false)) return chat;
    if (chatLoadPromises.has(characterId)) return chatLoadPromises.get(characterId);

    const loadPromise = (async () => {
        const loaded = await fetchQqJson(`/api/qq/chats/${encodeURIComponent(characterId)}`, {
            characterId,
            messages: [],
        });
        chat = state.chats.find(item => item.characterId === characterId);
        const next = {
            ...(chat || {}),
            ...(loaded && typeof loaded === 'object' ? loaded : {}),
            messages: Array.isArray(loaded?.messages) ? loaded.messages : [],
            _messagesLoaded: true,
        };
        next.lastMessage = next.messages[next.messages.length - 1] || null;
        next.messageCount = next.messages.length;
        const index = state.chats.findIndex(item => item.characterId === characterId);
        if (index >= 0) state.chats[index] = next;
        else state.chats.unshift(next);
        return next;
    })().finally(() => chatLoadPromises.delete(characterId));

    chatLoadPromises.set(characterId, loadPromise);
    return loadPromise;
}

async function activateChat(characterId) {
    if (!characterId) return null;
    state.activeChatId = characterId;
    setChatListCollapsed(true);
    renderChats();
    renderActiveChat();
    try {
        const chat = await ensureChatLoaded(characterId);
        if (state.activeChatId === characterId) {
            renderChats();
            renderActiveChat();
        }
        return chat;
    } catch (error) {
        console.warn('[QQ] load chat failed', error);
        if (state.activeChatId === characterId) renderChatLoadError(error);
        return null;
    }
}

async function ensureAllChatsLoaded() {
    await Promise.all(state.chats.map(chat => ensureChatLoaded(chat.characterId).catch(() => null)));
}

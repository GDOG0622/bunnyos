const chatLoadPromises = new Map();

async function fetchQqJson(url, fallback) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try { return await response.json(); } catch { return fallback; }
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
            fetchQqJson('/api/qq/characters', []),
            fetchQqJson('/api/qq/chats?summary=1', []),
        ]);
        state.characters = Array.isArray(chars) ? chars : [];
        state.chats = Array.isArray(chats) ? chats.map(markChatSummary) : [];
        renderContacts();
        renderChats();
        loadSecondaryQqData().catch(error => console.warn('[QQ] secondary data load failed', error));
    } catch (err) {
        console.warn('[QQ] load core data failed', err);
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

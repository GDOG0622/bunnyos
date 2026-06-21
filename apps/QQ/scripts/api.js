async function loadData() {
    try {
        const [chars, groups, chats, packs] = await Promise.all([
            fetch('/api/qq/characters').then(r => r.ok ? r.json() : []),
            fetch('/api/qq/groups').then(r => r.ok ? r.json() : []),
            fetch('/api/qq/chats').then(r => r.ok ? r.json() : []),
            fetch('/api/qq/sticker-packs').then(r => r.ok ? r.json() : []),
        ]);
        state.characters = Array.isArray(chars) ? chars : [];
        state.groups = Array.isArray(groups) ? groups : [];
        state.chats = Array.isArray(chats) ? chats : [];
        state.stickerPacks = Array.isArray(packs) ? packs : [];
        state.groupchats = [];
        renderContacts();
        renderChats();
        renderStickerPacks();
    } catch (err) {
        console.warn('[QQ] load data failed', err);
    }
}

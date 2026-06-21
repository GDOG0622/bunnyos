function renderContacts() {
    renderFriends();
    renderGroupChats();
}

function renderFriends() {
    const list = $('#list-friends');
    const empty = $('#empty-friends');
    list.innerHTML = '';
    if (!state.characters.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    for (const c of state.characters) {
        list.appendChild(rowForCharacter(c));
    }
}

function rowForCharacter(c) {
    const row = document.createElement('div');
    row.className = 'qq-row';
    row.dataset.id = c.id;
    row.innerHTML = `
        <span class="qq-avatar lg">${avatarHtml(c.avatar)}</span>
        <div class="qq-row-main">
            <div class="qq-row-name">${escapeHtml(c.name || '未命名')}</div>
            <div class="qq-row-sub">${escapeHtml(summaryForCharacter(c))}</div>
        </div>
    `;
    row.addEventListener('click', () => openFriendModal(c.id));
    return row;
}

function renderGroupChats() {
    const list = $('#list-groupchats');
    const empty = $('#empty-groupchats');
    list.innerHTML = '';
    if (!state.groups.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    for (const g of state.groups) {
        const row = document.createElement('div');
        row.className = 'qq-row';
        const count = (g.members || []).length;
        row.innerHTML = `
            <div class="qq-row-main">
                <div class="qq-row-name">${escapeHtml(g.name || '未命名群聊')}</div>
                <div class="qq-row-sub">${count} 位好友</div>
            </div>
            <i class="bi bi-chevron-right" style="color:var(--qq-text-fade);font-size:13px;"></i>
        `;
        row.addEventListener('click', () => toast('群聊聊天：后续迭代'));
        list.appendChild(row);
    }
}

async function createGroupChat() {
    const name = await askQqText('群聊名称');
    if (!name || !name.trim()) return;
    const group = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name: name.trim(),
        members: [],
        created_at: Date.now()
    };
    try {
        const nextGroups = [group, ...state.groups];
        const res = await fetch('/api/qq/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextGroups),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.groups = nextGroups;
        renderGroupChats();
        switchTab('contacts');
        switchSubTab('groupchats');
        toast('群聊已创建');
    } catch (err) {
        console.error(err);
        toast('创建失败：' + (err.message || err));
    }
}

async function openFriendModal(id = '') {
    const c = id ? state.characters.find(item => item.id === id) : null;
    state.editingId = c?.id || '';
    state.editingAvatarDataUrl = '';
    state.editingWorldbookIds = Array.isArray(c?.worldbookIds) ? [...c.worldbookIds] : [];

    $('#friend-modal-title').textContent = c ? '好友资料' : '添加好友';
    $('#friend-delete').classList.toggle('hidden', !c);
    $('#friend-start-chat').classList.toggle('hidden', !c);
    $('#friend-name').value = c?.name || '';
    $('#friend-role-setting').value = c?.role_setting || c?.description || '';
    $('#friend-rp-rules').value = c?.rp_rules || c?.personality || '';
    $('#friend-rp-rules-depth').value = String(Math.max(0, Math.min(parseInt(c?.rp_rules_depth, 10) || 0, 4)));
    $('#friend-other-setting').value = c?.other_setting || c?.nsfw_setting || '';
    $('#friend-scenario').value = c?.scenario || '';
    $('#friend-mes-example').value = c?.mes_example || '';
    $('#friend-avatar-img').src = c?.avatar || DEFAULT_AVATAR_URL;
    $('#friend-avatar-input').value = '';
    await loadFriendWorldbookOptions();
    renderFriendWorldbookChips();
    state.friendSnapshot = JSON.stringify(getFriendDraft());
    $('#friend-modal').classList.remove('hidden');
    state.pageHistory.push('friend');
    notifyNavState();
}

async function loadFriendWorldbookOptions() {
    try {
        const res = await fetch('/api/worldbooks');
        const data = res.ok ? await res.json() : { books: [] };
        state.worldbookBooks = Array.isArray(data.books) ? data.books : [];
    } catch {
        state.worldbookBooks = [];
    }
    state.editingWorldbookIds = state.editingWorldbookIds.filter(id => state.worldbookBooks.some(book => book.id === id));
}

function renderFriendWorldbookChips() {
    const wrap = $('#friend-worldbook-chips');
    if (!wrap) return;
    wrap.innerHTML = '';
    const bookMap = new Map(state.worldbookBooks.map(book => [book.id, book]));
    const selected = state.editingWorldbookIds.map(id => bookMap.get(id)).filter(Boolean);
    if (!selected.length) {
        const empty = document.createElement('span');
        empty.className = 'qq-chip-empty';
        empty.textContent = '未绑定任何世界书';
        wrap.appendChild(empty);
    }
    for (const book of selected) {
        const chip = document.createElement('span');
        chip.className = 'qq-chip';
        chip.innerHTML = `<span>${escapeHtml(book.name || '未命名')}</span><button type="button" aria-label="移除"><i class="bi bi-x"></i></button>`;
        chip.querySelector('button').addEventListener('click', () => removeFriendWorldbookChip(book.id));
        wrap.appendChild(chip);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'qq-chip-add';
    add.textContent = '+ 添加';
    add.addEventListener('click', openFriendWorldbookMenu);
    wrap.appendChild(add);
}

function openFriendWorldbookMenu() {
    const menu = $('#friend-worldbook-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const selected = new Set(state.editingWorldbookIds);
    const candidates = state.worldbookBooks.filter(book => !selected.has(book.id));
    if (!candidates.length) {
        const empty = document.createElement('div');
        empty.className = 'qq-chip-menu-empty';
        empty.textContent = state.worldbookBooks.length ? '所有世界书都已绑定' : '还没有世界书，去提示词管理添加';
        menu.appendChild(empty);
    }
    for (const book of candidates) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = book.name || '未命名';
        btn.addEventListener('click', () => addFriendWorldbookChip(book.id));
        menu.appendChild(btn);
    }
    menu.classList.remove('hidden');
    setTimeout(() => {
        document.addEventListener('click', closeFriendWorldbookMenuOnce, { once: true });
    }, 0);
}

function closeFriendWorldbookMenuOnce(event) {
    const menu = $('#friend-worldbook-menu');
    if (!menu) return;
    if (menu.contains(event.target) || event.target.closest('.qq-chip-add')) {
        // 还在菜单或加号上，重新绑定一次
        setTimeout(() => document.addEventListener('click', closeFriendWorldbookMenuOnce, { once: true }), 0);
        return;
    }
    menu.classList.add('hidden');
}

function addFriendWorldbookChip(bookId) {
    if (state.editingWorldbookIds.includes(bookId)) return;
    state.editingWorldbookIds.push(bookId);
    $('#friend-worldbook-menu').classList.add('hidden');
    renderFriendWorldbookChips();
}

function removeFriendWorldbookChip(bookId) {
    state.editingWorldbookIds = state.editingWorldbookIds.filter(id => id !== bookId);
    renderFriendWorldbookChips();
}

async function closeFriendModal(options = {}) {
    if (state.friendClosing) return;
    state.friendClosing = true;
    if (!options.skipAutosave) {
        await autoSaveFriendDraft();
    }
    $('#friend-modal').classList.add('hidden');
    state.editingId = '';
    state.editingAvatarDataUrl = '';
    state.friendSnapshot = '';
    if (state.pageHistory[state.pageHistory.length - 1] === 'friend') {
        state.pageHistory.pop();
        notifyNavState();
    }
    state.friendClosing = false;
}

async function onFriendAvatarPicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        toast('请选择图片文件');
        return;
    }
    state.editingAvatarDataUrl = await fileToDataUrl(file);
    $('#friend-avatar-img').src = state.editingAvatarDataUrl;
}

function getFriendDraft() {
    const name = $('#friend-name').value.trim();
    const roleSetting = $('#friend-role-setting').value.trim();
    return {
        name,
        role_setting: roleSetting,
        rp_rules: $('#friend-rp-rules').value.trim(),
        rp_rules_depth: parseInt($('#friend-rp-rules-depth').value, 10) || 0,
        other_setting: $('#friend-other-setting').value.trim(),
        scenario: $('#friend-scenario').value.trim(),
        mes_example: $('#friend-mes-example').value.trim(),
        worldbookIds: [...state.editingWorldbookIds],
        avatarDataUrl: state.editingAvatarDataUrl
    };
}

async function autoSaveFriendDraft() {
    const draft = getFriendDraft();
    if (JSON.stringify(draft) === state.friendSnapshot) return null;
    if (!draft.name && !draft.role_setting && !draft.rp_rules && !draft.other_setting && !draft.scenario && !draft.mes_example && !draft.avatarDataUrl) {
        return null;
    }
    if (!draft.name || !draft.role_setting) {
        toast('名字和角色设定完整后才会保存');
        return null;
    }
    return saveFriendDraft(draft, { quiet: true });
}

async function saveFriendDraft(draft, { quiet = false } = {}) {
    const name = draft.name;
    const roleSetting = draft.role_setting;
    if (!name) {
        toast('请填写名字');
        return null;
    }
    if (!roleSetting) {
        toast('请填写角色设定');
        return null;
    }
    const body = {
        name,
        role_setting: roleSetting,
        rp_rules: draft.rp_rules,
        rp_rules_depth: draft.rp_rules_depth,
        other_setting: draft.other_setting,
        nsfw_setting: draft.other_setting,
        scenario: draft.scenario,
        mes_example: draft.mes_example,
        worldbookIds: Array.isArray(draft.worldbookIds) ? draft.worldbookIds : [],
        description: roleSetting,
        personality: draft.rp_rules,
    };
    if (draft.avatarDataUrl) body.avatarDataUrl = draft.avatarDataUrl;

    try {
        const url = state.editingId
            ? `/api/qq/characters/${encodeURIComponent(state.editingId)}`
            : '/api/qq/characters';
        const res = await fetch(url, {
            method: state.editingId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = await res.json();
        const idx = state.characters.findIndex(c => c.id === saved.id);
        if (idx >= 0) state.characters[idx] = saved;
        else state.characters.unshift(saved);
        state.editingId = saved.id;
        state.editingAvatarDataUrl = '';
        state.friendSnapshot = JSON.stringify(getFriendDraft());
        renderContacts();
        renderChats();
        if (!quiet) toast('已保存');
        return saved;
    } catch (err) {
        console.error(err);
        toast('保存失败：' + (err.message || err));
        return null;
    }
}

async function deleteFriend() {
    if (!state.editingId) return;
    const target = state.characters.find(c => c.id === state.editingId);
    const name = target?.name || $('#friend-name').value.trim() || '这个好友';
    if (!await askQqConfirm(`确定删除「${name}」吗？这个操作不能撤销。`)) return;
    const id = state.editingId;
    try {
        const res = await fetch(`/api/qq/characters/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.characters = state.characters.filter(c => c.id !== id);
        state.chats = state.chats.filter(chat => chat.characterId !== id);
        if (state.activeChatId === id) state.activeChatId = '';
        renderContacts();
        renderChats();
        renderActiveChat();
        await closeFriendModal({ skipAutosave: true });
        toast('已删除');
    } catch (err) {
        console.error(err);
        toast('删除失败：' + (err.message || err));
    }
}

async function startChat(characterId) {
    await autoSaveFriendDraft();
    let chat = state.chats.find(item => item.characterId === characterId);
    if (!chat) {
        chat = { characterId, messages: [], updated_at: Date.now() };
        state.chats.unshift(chat);
        await saveChat(chat);
    }
    state.activeChatId = characterId;
    await closeFriendModal({ skipAutosave: true });
    switchTab('messages');
    setChatListCollapsed(true);
    renderChats();
    renderActiveChat();
}

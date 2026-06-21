async function loadPersonas() {
    try {
        const res = await fetch('/api/userpersonas');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        state.personas = Array.isArray(data.personas) ? data.personas : [];
        state.currentPersonaId = data.currentPersonaId || state.personas[0]?.id || '';
        state.currentPersona = data.currentPersona || state.personas.find(item => item.id === state.currentPersonaId) || state.personas[0] || null;
        renderUserProfile();
        renderAccountList();
    } catch (err) {
        console.warn('[QQ] load personas failed', err);
        renderUserProfile();
    }
}

function currentPersona() {
    return state.currentPersona || state.personas.find(item => item.id === state.currentPersonaId) || null;
}

function currentPersonaStatus(persona = currentPersona()) {
    if (!persona) return '超开心';
    if (persona.status === '自定义') return persona.customStatus || '自定义';
    return persona.status || '超开心';
}

function renderUserProfile() {
    const persona = currentPersona();
    const name = persona?.name || '默认';
    const avatar = avatarHtml(persona?.avatar);
    const signature = persona?.signature || '情绪是一场雷阵雨';
    const status = currentPersonaStatus(persona);

    ['#qq-user-avatar', '#qq-topbar-avatar', '#me-avatar'].forEach(sel => {
        const el = $(sel);
        if (el) el.innerHTML = avatar;
    });
    const userName = $('#qq-user-name');
    if (userName) userName.textContent = name;
    const topSignature = $('#qq-signature');
    if (topSignature) topSignature.textContent = signature;
    const meName = $('#me-name');
    if (meName) meName.textContent = name;
    const meStatus = $('#me-status');
    if (meStatus) meStatus.textContent = status;
    const meSignature = $('#me-signature');
    if (meSignature?.tagName === 'INPUT') {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'me-signature';
        button.className = 'qq-me-signature';
        button.textContent = signature;
        button.addEventListener('click', editSignatureInline);
        meSignature.replaceWith(button);
    } else if (meSignature) {
        meSignature.textContent = signature;
    }
}

function openPersonaModal(id = '') {
    const persona = id ? state.personas.find(item => item.id === id) : null;
    state.editingPersonaId = persona?.id || '';
    state.editingPersonaAvatarDataUrl = '';
    $('#persona-modal-title').textContent = persona ? '编辑人设' : '新建人设';
    $('#persona-name').value = persona?.name || '';
    $('#persona-gender').value = persona?.gender || '';
    $('#persona-birthday').value = persona?.birthday || '';
    $('#persona-signature').value = persona?.signature || '情绪是一场雷阵雨';
    $('#persona-note').value = persona?.note || '';
    $('#persona-prompt').value = persona?.prompt || '';
    renderPersonaStatusOptions(persona);
    $('#persona-avatar-img').src = persona?.avatar || DEFAULT_AVATAR_URL;
    $('#persona-avatar-input').value = '';
    state.personaSnapshot = JSON.stringify(getPersonaDraft());
    $('#persona-modal').classList.remove('hidden');
    state.pageHistory.push('persona');
    notifyNavState();
}

function renderPersonaStatusOptions(persona = null) {
    const select = $('#persona-status');
    if (!select) return;
    select.innerHTML = '';
    const current = persona?.status || '超开心';
    PERSONA_STATUSES.forEach(status => {
        const opt = document.createElement('option');
        opt.value = status;
        opt.textContent = status;
        select.appendChild(opt);
    });
    select.value = PERSONA_STATUSES.includes(current) ? current : '自定义';
    $('#persona-custom-status').value = persona?.customStatus || (!PERSONA_STATUSES.includes(current) ? current : '');
    toggleCustomStatusField();
}

function toggleCustomStatusField() {
    const isCustom = $('#persona-status')?.value === '自定义';
    $('#persona-custom-status-field')?.classList.toggle('hidden', !isCustom);
}

async function closePersonaModal(options = {}) {
    if (state.personaClosing) return;
    state.personaClosing = true;
    if (!options.skipAutosave) {
        await autoSavePersonaDraft();
    }
    $('#persona-modal').classList.add('hidden');
    state.editingPersonaId = '';
    state.editingPersonaAvatarDataUrl = '';
    state.personaSnapshot = '';
    if (state.pageHistory[state.pageHistory.length - 1] === 'persona') {
        state.pageHistory.pop();
        notifyNavState();
    }
    state.personaClosing = false;
}

function getPersonaDraft() {
    return {
        name: $('#persona-name').value.trim(),
        gender: $('#persona-gender').value.trim(),
        birthday: $('#persona-birthday').value.trim(),
        status: $('#persona-status').value || '超开心',
        customStatus: $('#persona-custom-status').value.trim(),
        signature: $('#persona-signature').value.trim() || '情绪是一场雷阵雨',
        note: $('#persona-note').value.trim(),
        prompt: $('#persona-prompt').value.trim(),
        avatarDataUrl: state.editingPersonaAvatarDataUrl
    };
}

async function autoSavePersonaDraft() {
    const draft = getPersonaDraft();
    if (JSON.stringify(draft) === state.personaSnapshot) return null;
    if (!draft.name) {
        if (!state.editingPersonaId && !draft.gender && !draft.birthday && !draft.note && !draft.prompt && !draft.avatarDataUrl) return null;
        toast('请填写名字后再保存人设');
        return null;
    }
    return savePersonaDraft(draft);
}

async function savePersonaDraft(draft) {
    const id = state.editingPersonaId;
    const url = id ? `/api/userpersonas/${encodeURIComponent(id)}` : '/api/userpersonas';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
    });
    const saved = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(saved.error || '保存人设失败');
        return null;
    }
    const idx = state.personas.findIndex(item => item.id === saved.id);
    if (idx >= 0) state.personas[idx] = saved;
    else state.personas.push(saved);
    if (!state.currentPersonaId || !id) {
        await switchPersona(saved.id, { quiet: true });
    } else if (state.currentPersonaId === saved.id) {
        state.currentPersona = saved;
    }
    renderUserProfile();
    renderAccountList();
    toast('人设已保存');
    return saved;
}

async function onPersonaAvatarPicked(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        toast('请选择图片文件');
        return;
    }
    state.editingPersonaAvatarDataUrl = await fileToDataUrl(file);
    $('#persona-avatar-img').src = state.editingPersonaAvatarDataUrl;
}

function openAccountModal() {
    state.accountDeleteMode = false;
    renderAccountList();
    $('#account-modal').classList.remove('hidden');
}

function closeAccountModal() {
    state.accountDeleteMode = false;
    $('#account-modal').classList.add('hidden');
    renderAccountList();
}

function renderAccountList() {
    const list = $('#account-list');
    if (!list) return;
    list.innerHTML = '';
    state.personas.forEach(persona => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'qq-account-row';
        row.classList.toggle('active', persona.id === state.currentPersonaId);
        row.classList.toggle('delete-mode', state.accountDeleteMode);
        row.innerHTML = `
            <span class="qq-avatar lg">${avatarHtml(persona.avatar)}</span>
            <span class="qq-account-main">
                <span class="qq-account-name">${escapeHtml(persona.name || '未命名')}</span>
                <span class="qq-account-note">${escapeHtml(persona.note || '没有备注')}</span>
            </span>
            ${state.accountDeleteMode
                ? '<i class="bi bi-trash qq-account-delete-mark"></i>'
                : (persona.id === state.currentPersonaId ? '<i class="bi bi-check-lg qq-account-check"></i>' : '')}
        `;
        row.addEventListener('click', () => {
            if (state.accountDeleteMode) deletePersona(persona.id);
            else switchPersona(persona.id);
        });
        list.appendChild(row);
    });
    $('#account-delete')?.classList.toggle('delete-mode', state.accountDeleteMode);
}

async function switchPersona(id, options = {}) {
    const persona = state.personas.find(item => item.id === id);
    if (!persona) return;
    const res = await fetch('/api/userpersonas/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(data.error || '切换失败');
        return;
    }
    state.currentPersonaId = id;
    state.currentPersona = persona;
    renderUserProfile();
    renderAccountList();
    closeAccountModal();
    if (!options.quiet) toast(`已切换为 ${persona.name || '人设'}`);
}

async function deletePersona(id) {
    if (state.personas.length <= 1) {
        toast('至少保留一个人设');
        return;
    }
    const persona = state.personas.find(item => item.id === id);
    if (!persona) return;
    if (!await askQqConfirm(`删除「${persona.name || '这个人设'}」吗？`)) return;
    const res = await fetch(`/api/userpersonas/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(data.error || '删除失败');
        return;
    }
    await loadPersonas();
    toast('已删除');
}

function toggleAccountDeleteMode() {
    if (state.personas.length <= 1) {
        toast('至少保留一个人设');
        return;
    }
    state.accountDeleteMode = !state.accountDeleteMode;
    renderAccountList();
}

function editSignatureInline() {
    const button = $('#me-signature');
    const persona = currentPersona();
    if (!button || !persona) return;
    const input = document.createElement('input');
    input.id = 'me-signature';
    input.className = 'qq-me-signature qq-me-signature-input';
    input.value = persona.signature || '情绪是一场雷阵雨';
    button.replaceWith(input);
    input.focus();
    input.select();

    async function commit() {
        const value = input.value.trim() || '情绪是一场雷阵雨';
        persona.signature = value;
        await fetch(`/api/userpersonas/${encodeURIComponent(persona.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...persona, signature: value })
        });
        state.currentPersona = persona;
        renderUserProfile();
    }

    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') input.blur();
        if (event.key === 'Escape') renderUserProfile();
    });
}

function personaSnapshot() {
    const persona = currentPersona();
    if (!persona) return null;
    return {
        id: persona.id,
        name: persona.name || '默认',
        avatar: persona.avatar || '',
    };
}

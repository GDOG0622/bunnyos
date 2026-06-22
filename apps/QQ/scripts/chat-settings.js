// 聊天设置面板（聊天页右上三个点）
// 详见 QQ美化系统计划.md §1.5 §8 M4
// M4：头像框下拉 + CSS 注入器
// M5：补气泡 / 背景 下拉；M8：补清空/隐藏/删除聊天

function ensureBeautyStyleNodes() {
    ['skin', 'frame', 'bubble', 'bg'].forEach(name => {
        const id = `bunny-style-${name}`;
        if (!document.getElementById(id)) {
            const el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
        }
    });
}

// 进入 char 聊天时调用：拉 char-beauty + 美化库，注入当前选中项的 CSS / 资源
async function applyCharBeauty(characterId) {
    ensureBeautyStyleNodes();
    const frameStyle = document.getElementById('bunny-style-frame');
    const bubbleStyle = document.getElementById('bunny-style-bubble');
    const bgStyle = document.getElementById('bunny-style-bg');
    if (!characterId) {
        if (frameStyle) frameStyle.textContent = '';
        if (bubbleStyle) bubbleStyle.textContent = '';
        if (bgStyle) bgStyle.textContent = '';
        return;
    }
    try {
        const [cbRes, beautyRes] = await Promise.all([
            fetch(`/api/qq/char-beauty/${encodeURIComponent(characterId)}`),
            fetch('/api/qq/beauties'),
        ]);
        if (!cbRes.ok || !beautyRes.ok) return;
        const cb = await cbRes.json();
        const beauties = await beautyRes.json();
        state.charBeautyCurrent = { characterId, ...cb };

        // 头像框（拆 char/user 两侧）：分别命中 .bunny-qq-frame-char/-user::after
        const frames = beauties.frames || [];
        const fChar = frames.find(x => x.id === cb.frameCharId);
        const fUser = frames.find(x => x.id === cb.frameUserId);
        const rules = [];
        if (fChar && fChar.url) {
            rules.push(`.bunny-qq-frame-char::after { background-image: url('${fChar.url.replace(/'/g, "\\'")}'); }`);
        }
        if (fUser && fUser.url) {
            rules.push(`.bunny-qq-frame-user::after { background-image: url('${fUser.url.replace(/'/g, "\\'")}'); }`);
        }
        if (frameStyle) frameStyle.textContent = rules.join('\n');
        // 头像对：char/user 两张图（公共库共享）。default 走原 char/persona avatar
        const avatar = (beauties.avatars || []).find(x => x.id === cb.avatarId);
        state.charBeautyAvatars = (avatar && avatar.id !== 'default')
            ? { charUrl: avatar.charUrl || '', userUrl: avatar.userUrl || '' }
            : null;
        if (typeof refreshMessageAvatars === 'function') refreshMessageAvatars();
        // 气泡：注入 user/char 两段 CSS（user 决定 .bunny-qq-bubble-user 形态）
        const bubble = (beauties.bubbles || []).find(x => x.id === cb.bubbleId);
        if (bubbleStyle) {
            bubbleStyle.textContent = (bubble && bubble.id !== 'default')
                ? `${bubble.userCss || ''}\n${bubble.charCss || ''}`
                : '';
        }
        // 背景：优先 char 专属上传（customBackgroundUrl）；否则回退到旧 backgrounds 库
        let bgUrl = cb.customBackgroundUrl || '';
        if (!bgUrl) {
            const libBg = (beauties.backgrounds || []).find(x => x.id === cb.backgroundId);
            if (libBg && libBg.id !== 'default') bgUrl = libBg.url || '';
        }
        if (bgStyle) {
            bgStyle.textContent = bgUrl
                ? `.bunny-qq-bg { background-image: url('${bgUrl.replace(/'/g, "\\'")}'); background-size: cover; background-position: center; }`
                : '';
        }
    } catch (err) {
        console.warn('[chat-settings] apply failed', err);
    }
}

function openChatSettings() {
    const characterId = state.activeChatId;
    if (!characterId) return;
    const modal = $('#chat-settings-modal');
    if (!modal) return;
    state.chatSettingsCharId = characterId;
    modal.classList.remove('hidden');
    state.pageHistory.push('chat-settings');
    notifyNavState();
    renderChatSettings();
}

function closeChatSettings() {
    $('#chat-settings-modal')?.classList.add('hidden');
    if (state.pageHistory[state.pageHistory.length - 1] === 'chat-settings') {
        state.pageHistory.pop();
        notifyNavState();
    }
    state.chatSettingsCharId = null;
}

async function renderChatSettings() {
    const body = $('#chat-settings-body');
    if (!body) return;
    body.innerHTML = `<div class="qq-beauty-loading">加载中...</div>`;
    const charId = state.chatSettingsCharId;
    try {
        const [cbRes, beautyRes] = await Promise.all([
            fetch(`/api/qq/char-beauty/${encodeURIComponent(charId)}`),
            fetch('/api/qq/beauties'),
        ]);
        if (!cbRes.ok || !beautyRes.ok) throw new Error('加载失败');
        const cb = await cbRes.json();
        const beauties = await beautyRes.json();
        const frames = beauties.frames || [];
        const avatars = beauties.avatars || [];
        const bubbles = beauties.bubbles || [];
        const opt = (list, currentId) => list.map(it =>
            `<option value="${it.id}"${it.id === currentId ? ' selected' : ''}>${escapeHtmlText(it.name || it.id)}</option>`
        ).join('');
        body.innerHTML = `
            <div class="qq-chat-settings-tokens" id="chat-settings-tokens">当前 prompt ≈ — tk（估算中...）</div>
            <div class="qq-chat-settings-row">
                <label>头像（一对）</label>
                <select id="chat-settings-avatar">${opt(avatars, cb.avatarId)}</select>
            </div>
            <div class="qq-chat-settings-row">
                <label>char 头像框</label>
                <select id="chat-settings-frame-char">${opt(frames, cb.frameCharId)}</select>
            </div>
            <div class="qq-chat-settings-row">
                <label>user 头像框</label>
                <select id="chat-settings-frame-user">${opt(frames, cb.frameUserId)}</select>
            </div>
            <div class="qq-chat-settings-row">
                <label>气泡组</label>
                <select id="chat-settings-bubble">${opt(bubbles, cb.bubbleId)}</select>
            </div>
            <div class="qq-chat-settings-bg-section">
                <div class="qq-chat-settings-bg-label">聊天背景（此 char 专属，覆盖式）</div>
                <button type="button"
                        class="qq-beauty-bg-single${cb.customBackgroundUrl ? ' has-image' : ''}"
                        id="chat-settings-bg-upload"
                        ${cb.customBackgroundUrl ? `style="background-image:url('${cb.customBackgroundUrl.replace(/'/g, "\\'")}')"` : ''}>
                    ${cb.customBackgroundUrl ? '' : `<div class="qq-beauty-bg-single-hint">
                        <i class="bi bi-plus-lg"></i><div>点击上传聊天背景</div>
                    </div>`}
                </button>
                <input type="file" id="chat-settings-bg-file" accept="image/*" style="display:none">
                ${cb.customBackgroundUrl ? `<button type="button" class="qq-chat-settings-bg-clear" id="chat-settings-bg-clear">清除背景</button>` : ''}
            </div>
            <div class="qq-chat-settings-divider"></div>
            <div class="qq-chat-settings-actions">
                <button type="button" class="qq-chat-settings-action" id="chat-settings-clear">清空聊天记录</button>
                <button type="button" class="qq-chat-settings-action" id="chat-settings-hide">隐藏此聊天</button>
                <button type="button" class="qq-chat-settings-action danger" id="chat-settings-delete">删除聊天</button>
            </div>
        `;
        body.querySelector('#chat-settings-avatar').addEventListener('change', e =>
            onChatSettingsBeautyChange('avatarId', e.target.value)
        );
        body.querySelector('#chat-settings-frame-char').addEventListener('change', e =>
            onChatSettingsBeautyChange('frameCharId', e.target.value)
        );
        body.querySelector('#chat-settings-frame-user').addEventListener('change', e =>
            onChatSettingsBeautyChange('frameUserId', e.target.value)
        );
        body.querySelector('#chat-settings-bubble').addEventListener('change', e =>
            onChatSettingsBeautyChange('bubbleId', e.target.value)
        );
        // 背景上传 / 清除（per-char）
        const bgUploadBtn = body.querySelector('#chat-settings-bg-upload');
        const bgFileInput = body.querySelector('#chat-settings-bg-file');
        if (bgUploadBtn && bgFileInput) {
            bgUploadBtn.addEventListener('click', () => bgFileInput.click());
            bgFileInput.addEventListener('change', e => uploadCharBackground(e.target));
        }
        const bgClearBtn = body.querySelector('#chat-settings-bg-clear');
        if (bgClearBtn) bgClearBtn.addEventListener('click', clearCharBackground);
        // M8 三个按钮
        body.querySelector('#chat-settings-clear')?.addEventListener('click', () => clearChatMessages(charId));
        body.querySelector('#chat-settings-hide')?.addEventListener('click', () => hideChat(charId));
        body.querySelector('#chat-settings-delete')?.addEventListener('click', () => deleteChat(charId));
        // 拉 prompt token 数显示在顶部（粗估，没用 gpt-tokenizer，沿用酒馆 fallback 思路）
        loadChatTokens(charId);
    } catch (err) {
        body.innerHTML = `<div class="qq-beauty-empty">加载失败：${err.message}</div>`;
    }
}

// ========== M8 对话框管理 ==========
async function clearChatMessages(charId) {
    if (!confirm('确定清空这段聊天记录？\n聊天本身保留，但所有消息会删除，不可恢复。')) return;
    try {
        const res = await fetch(`/api/qq/chats/${encodeURIComponent(charId)}/messages`, { method: 'DELETE' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            toast(d.error || '清空失败');
            return;
        }
        const chat = state.chats.find(c => c.characterId === charId);
        if (chat) { chat.messages = []; chat.updated_at = Date.now(); }
        renderChats();
        renderActiveChat();
        closeChatSettings();
        toast('已清空聊天记录');
    } catch (err) {
        toast('清空失败：' + (err.message || '未知错误'));
    }
}

async function hideChat(charId) {
    try {
        const res = await fetch(`/api/qq/chats/${encodeURIComponent(charId)}/hidden`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hidden: true })
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            toast(d.error || '隐藏失败');
            return;
        }
        const chat = state.chats.find(c => c.characterId === charId);
        if (chat) chat.hidden = true;
        // 当前打开的就是它 → 关掉聊天页
        if (state.activeChatId === charId) state.activeChatId = '';
        renderChats();
        renderActiveChat();
        closeChatSettings();
        toast('已隐藏。开关"显示隐藏聊天"可以找回');
    } catch (err) {
        toast('隐藏失败：' + (err.message || '未知错误'));
    }
}

async function deleteChat(charId) {
    const character = state.characters.find(c => c.id === charId);
    if (!confirm(`确定删除与「${character?.name || charId}」的聊天？\n聊天记录 + 该 char 的美化绑定 + 专属背景都会清除，不可恢复（角色卡本身保留）。`)) return;
    try {
        const res = await fetch(`/api/qq/chats/${encodeURIComponent(charId)}`, { method: 'DELETE' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            toast(d.error || '删除失败');
            return;
        }
        state.chats = state.chats.filter(c => c.characterId !== charId);
        if (state.activeChatId === charId) state.activeChatId = '';
        renderChats();
        renderActiveChat();
        closeChatSettings();
        toast('已删除聊天');
    } catch (err) {
        toast('删除失败：' + (err.message || '未知错误'));
    }
}

async function loadChatTokens(charId) {
    const el = $('#chat-settings-tokens');
    if (!el) return;
    try {
        const res = await fetch(`/api/qq/chat-tokens/${encodeURIComponent(charId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        el.textContent = `当前 prompt ≈ ${data.tokens} tk · ${data.messageCount} 段 · ${data.chars} 字（粗估，CJK≈1tk、其余 4 字/tk）`;
    } catch (err) {
        el.textContent = `token 估算失败：${err.message || ''}`;
    }
}

function uploadCharBackground(fileInput) {
    const charId = state.chatSettingsCharId;
    if (!charId) return;
    const file = fileInput?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const res = await fetch(`/api/qq/char-beauty/${encodeURIComponent(charId)}/background`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: reader.result })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { toast(data.error || '上传失败'); return; }
            await applyCharBeauty(charId);
            renderChatSettings();
            toast('已上传聊天背景');
        } catch (err) {
            toast('上传失败：' + (err.message || '未知错误'));
        }
    };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsDataURL(file);
}

async function clearCharBackground() {
    const charId = state.chatSettingsCharId;
    if (!charId) return;
    try {
        const res = await fetch(`/api/qq/char-beauty/${encodeURIComponent(charId)}/background`, { method: 'DELETE' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            toast(d.error || '清除失败');
            return;
        }
        await applyCharBeauty(charId);
        renderChatSettings();
        toast('已清除背景');
    } catch (err) {
        toast('清除失败：' + (err.message || '未知错误'));
    }
}

async function onChatSettingsBeautyChange(field, value) {
    const charId = state.chatSettingsCharId;
    if (!charId) return;
    try {
        const res = await fetch(`/api/qq/char-beauty/${encodeURIComponent(charId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: value })
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            toast(d.error || '保存失败');
            return;
        }
        await applyCharBeauty(charId);
        toast('已更新');
    } catch (err) {
        toast('保存失败：' + (err.message || '未知错误'));
    }
}

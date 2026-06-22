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

        // 头像框：::after background-image
        const frame = (beauties.frames || []).find(x => x.id === cb.frameId);
        if (frameStyle) {
            frameStyle.textContent = (frame && frame.url)
                ? `.bunny-qq-frame::after { background-image: url('${frame.url.replace(/'/g, "\\'")}'); }`
                : '';
        }
        // 气泡（M5 接入）
        const bubble = (beauties.bubbles || []).find(x => x.id === cb.bubbleId);
        if (bubbleStyle) {
            bubbleStyle.textContent = bubble
                ? `${bubble.userCss || ''}\n${bubble.charCss || ''}`
                : '';
        }
        // 背景（M5 接入：M4 暂不注入，避免和 M3 的 mockup 预览冲突）
        if (bgStyle) bgStyle.textContent = '';
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
        const opt = (list, currentId) => list.map(it =>
            `<option value="${it.id}"${it.id === currentId ? ' selected' : ''}>${escapeHtmlText(it.name || it.id)}</option>`
        ).join('');
        body.innerHTML = `
            <div class="qq-chat-settings-row">
                <label>头像框</label>
                <select id="chat-settings-frame">${opt(frames, cb.frameId)}</select>
            </div>
            <div class="qq-chat-settings-row qq-chat-settings-disabled">
                <label>气泡组</label>
                <select disabled><option>M5 落地</option></select>
            </div>
            <div class="qq-chat-settings-row qq-chat-settings-disabled">
                <label>聊天背景</label>
                <select disabled><option>M5 落地</option></select>
            </div>
            <div class="qq-chat-settings-divider"></div>
            <div class="qq-chat-settings-actions">
                <button type="button" class="qq-chat-settings-action" disabled>清空聊天记录 (M8)</button>
                <button type="button" class="qq-chat-settings-action" disabled>隐藏此聊天 (M8)</button>
                <button type="button" class="qq-chat-settings-action danger" disabled>删除聊天 (M8)</button>
            </div>
        `;
        body.querySelector('#chat-settings-frame').addEventListener('change', e =>
            onChatSettingsFrameChange(e.target.value)
        );
    } catch (err) {
        body.innerHTML = `<div class="qq-beauty-empty">加载失败：${err.message}</div>`;
    }
}

async function onChatSettingsFrameChange(frameId) {
    const charId = state.chatSettingsCharId;
    if (!charId) return;
    try {
        const res = await fetch(`/api/qq/char-beauty/${encodeURIComponent(charId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frameId })
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            toast(d.error || '保存失败');
            return;
        }
        await applyCharBeauty(charId);
        toast('已更新头像框');
    } catch (err) {
        toast('保存失败：' + (err.message || '未知错误'));
    }
}

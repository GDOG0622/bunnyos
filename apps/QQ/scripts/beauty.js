// QQ 美化商城 · M3 头像框跑通（样板模块）
// 详见 QQ美化系统计划.md §1.4 §1.6 §8 M3
//
// tab 顺序：皮肤 / 头像 / 头像框 / 气泡
// 背景图改 per-char 直接上传（2026-06-22 二次反转）：从美化商城移除，统一在三个点面板里上传
const BEAUTY_TAB_DEFS = [
    { type: 'skins',       label: '皮肤',   price: 20 },
    { type: 'avatars',     label: '头像',   price: 5 },
    { type: 'frames',      label: '头像框', price: 5 },
    { type: 'bubbles',     label: '气泡',   price: 5 },
];

// 每模块的 mockup 包裹类（§1.6）
// frame 是给 .qq-avatar 外层 wrapper 的，bubble 是 .qq-message 上，bg 是 .qq-chat-view 上，skin 是 body 上
const MOCKUP_HTML = `
    <div class="qq-beauty-mockup-frame bunny-qq-bg">
        <div class="qq-beauty-mockup-row">
            <span class="bunny-qq-frame">
                <span class="qq-avatar lg" data-mockup-avatar="char"><img src="${DEFAULT_AVATAR_URL}" alt=""></span>
            </span>
            <div class="qq-message bunny-qq-bubble bunny-qq-bubble-char">
                <div class="qq-bubble">你好呀～ 这是 char 的气泡示例</div>
            </div>
        </div>
        <div class="qq-beauty-mockup-row qq-beauty-mockup-row-self">
            <div class="qq-message qq-self bunny-qq-bubble bunny-qq-bubble-user">
                <div class="qq-bubble">我是 user 的气泡示例</div>
            </div>
            <span class="bunny-qq-frame">
                <span class="qq-avatar lg" data-mockup-avatar="user"><img src="${DEFAULT_AVATAR_URL}" alt=""></span>
            </span>
        </div>
    </div>
`;

function openBeautyModal() {
    $('#beauty-modal')?.classList.remove('hidden');
    state.pageHistory.push('beauty');
    notifyNavState();
    if (!state.beautyTab) state.beautyTab = 'skins';
    state.beautySelectMode = false;
    state.beautySelected = new Set();
    refreshBeautyBalance();
    renderBeautyTabs();
    loadBeautyPanel(state.beautyTab);
}

function closeBeautyModal() {
    $('#beauty-modal')?.classList.add('hidden');
    closeBeautyEditor(true);
    if (state.pageHistory[state.pageHistory.length - 1] === 'beauty') {
        state.pageHistory.pop();
        notifyNavState();
    }
}

async function refreshBeautyBalance() {
    const el = $('#beauty-balance');
    if (!el) return;
    try {
        const res = await fetch('/api/wallet');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        state.walletBalance = data.balance;
        el.textContent = formatCC(data.balance);
    } catch {
        el.textContent = '—';
    }
}

function renderBeautyTabs() {
    const bar = $('#beauty-tabs');
    if (!bar) return;
    bar.innerHTML = BEAUTY_TAB_DEFS.map(t => `
        <button type="button" class="qq-beauty-tab${t.type === state.beautyTab ? ' active' : ''}"
                data-beauty-tab="${t.type}">${t.label}</button>
    `).join('');
    bar.querySelectorAll('[data-beauty-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.beautyTab === btn.dataset.beautyTab) return;
            state.beautyTab = btn.dataset.beautyTab;
            state.beautySelectMode = false;
            state.beautySelected = new Set();
            updateSelectToggleLabel();
            renderBeautyTabs();
            loadBeautyPanel(state.beautyTab);
        });
    });
}

function updateSelectToggleLabel() {
    const btn = $('#beauty-select-toggle');
    if (!btn) return;
    btn.textContent = state.beautySelectMode ? '完成' : '选择';
}

function toggleBeautySelectMode() {
    state.beautySelectMode = !state.beautySelectMode;
    state.beautySelected = new Set();
    updateSelectToggleLabel();
    loadBeautyPanel(state.beautyTab);
}

async function loadBeautyPanel(type) {
    const panel = $('#beauty-panel');
    if (!panel) return;
    const def = BEAUTY_TAB_DEFS.find(t => t.type === type);
    panel.innerHTML = `<div class="qq-beauty-loading">加载中...</div>`;
    try {
        const res = await fetch(`/api/qq/beauties/${type}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let list = await res.json();
        list = Array.isArray(list) ? list : [];
        // 背景图就一个槽位：恰好保证 1 个非 default 项存在（价格 0，不扣钱）
        if (type === 'backgrounds' && !list.some(x => x.id !== 'default')) {
            try {
                const made = await fetch('/api/qq/beauties/backgrounds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: '背景' })
                });
                if (made.ok) list.push(await made.json());
            } catch {}
        }
        state.beautyListCache = state.beautyListCache || {};
        state.beautyListCache[type] = list;
        renderBeautyPanel(panel, def, list);
    } catch (err) {
        panel.innerHTML = `<div class="qq-beauty-empty">加载失败：${err.message || '未知错误'}</div>`;
    }
}

function renderBeautyPanel(panel, def, list) {
    const isFrame = def.type === 'frames';
    const isBackground = def.type === 'backgrounds';

    // 背景图：就一个 full-width 块用来上传（用户决策 2026-06-22）
    if (isBackground) {
        const bgItem = list.find(x => x.id !== 'default');
        if (!bgItem) {
            panel.innerHTML = `<div class="qq-beauty-empty">初始化失败，请重新进入</div>`;
            return;
        }
        const url = bgItem.url || '';
        const bgStyle = url ? `style="background-image:url('${url.replace(/'/g, "\\'")}')"` : '';
        panel.innerHTML = `
            <button type="button" class="qq-beauty-bg-single${url ? ' has-image' : ''}"
                    id="beauty-bg-single" ${bgStyle}>
                ${url ? '' : `<div class="qq-beauty-bg-single-hint">
                    <i class="bi bi-plus-lg"></i>
                    <div>点击上传聊天背景</div>
                </div>`}
            </button>
            <input type="file" id="beauty-bg-single-file" accept="image/*" style="display:none">
        `;
        const btn = panel.querySelector('#beauty-bg-single');
        const fileInput = panel.querySelector('#beauty-bg-single-file');
        btn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => uploadBeautyBackgroundSingle(bgItem.id, e.target));
        return;
    }

    // 皮肤：无 mockup（皮肤要套到全 App 才能看清效果，通过"预览"按钮跑临时全屏预览）
    let mockup = '';
    if (def.type === 'skins') {
        mockup = `<div class="qq-beauty-section-title">提示：点皮肤槽位的"预览"按钮即时套到 QQ 看效果；"应用"则永久写入全局皮肤设置。</div>`;
    } else {
        mockup = `<div class="qq-beauty-mockup-wrap">
              <div class="qq-beauty-mockup-title">预览</div>
              ${MOCKUP_HTML}
              <style id="beauty-mockup-style"></style>
           </div>`;
    }

    const slots = list.map(it => renderSlotCard(def, it)).join('');
    const addTile = state.beautySelectMode
        ? ''
        : `<button class="qq-beauty-slot qq-beauty-slot-add" data-beauty-add="${def.type}">
              <i class="bi bi-plus-lg"></i>
              <div class="qq-beauty-slot-name">新建 (${def.price}cc)</div>
           </button>`;

    const deleteBar = state.beautySelectMode
        ? `<div class="qq-beauty-delete-bar">
              <button type="button" id="beauty-delete-selected" disabled>删除选中 (0)</button>
           </div>`
        : '';

    const sectionTitle = `<div class="qq-beauty-section-title">${def.label} · ${list.length} 项${isFrame ? '' : '（M3 仅头像框完整可用，其他模块在 M5 落地）'}</div>`;

    panel.innerHTML = `
        ${mockup}
        ${sectionTitle}
        <div class="qq-beauty-grid">
            ${slots}
            ${addTile}
        </div>
        ${deleteBar}
    `;

    // 绑事件
    panel.querySelectorAll('[data-beauty-add]').forEach(btn => {
        btn.addEventListener('click', () => createBeautySlot(btn.dataset.beautyAdd));
    });
    panel.querySelectorAll('[data-beauty-preview]').forEach(btn => {
        btn.addEventListener('click', () => previewSlot(def.type, btn.dataset.beautyPreview));
    });
    panel.querySelectorAll('[data-beauty-apply]').forEach(btn => {
        btn.addEventListener('click', () => applySkin(btn.dataset.beautyApply));
    });
    panel.querySelectorAll('[data-beauty-edit]').forEach(btn => {
        btn.addEventListener('click', () => openBeautyEditor(def.type, btn.dataset.beautyEdit));
    });
    panel.querySelectorAll('[data-beauty-check]').forEach(cb => {
        cb.addEventListener('change', () => onBeautySelectChange(cb.dataset.beautyCheck, cb.checked));
    });
    const delBtn = $('#beauty-delete-selected');
    if (delBtn) delBtn.addEventListener('click', () => deleteSelectedBeauties(def.type));
}

function renderSlotCard(def, it) {
    const isDefault = it.id === 'default';
    const isAvatar = def.type === 'avatars';
    // 头像卡片：左 char、右 user 两张小圆头像并排
    let previewArea;
    if (isAvatar) {
        const c = it.charUrl ? `<img src="${escapeAttr(it.charUrl)}" alt="">` : 'C';
        const u = it.userUrl ? `<img src="${escapeAttr(it.userUrl)}" alt="">` : 'U';
        previewArea = `
            <div class="qq-beauty-slot-preview qq-beauty-avatar-pair">
                <span class="qq-beauty-avatar-pair-cell">${c}</span>
                <span class="qq-beauty-avatar-pair-cell">${u}</span>
            </div>
        `;
    } else {
        const previewSrc = it.preview;
        const previewBg = previewSrc
            ? `style="background-image:url('${previewSrc.replace(/'/g, "\\'")}')"`
            : '';
        const initial = (it.name || '?').slice(0, 1);
        previewArea = `<div class="qq-beauty-slot-preview" ${previewBg}>${previewSrc ? '' : initial}</div>`;
    }
    const checkboxHtml = (state.beautySelectMode && !isDefault)
        ? `<input type="checkbox" class="qq-beauty-slot-check" data-beauty-check="${it.id}"
                  ${state.beautySelected.has(it.id) ? 'checked' : ''}>`
        : '';
    const isSkin = def.type === 'skins';
    const actionsHtml = state.beautySelectMode
        ? ''
        : `<div class="qq-beauty-slot-actions">
              ${isSkin ? `<button type="button" data-beauty-apply="${it.id}">应用</button>` : ''}
              <button type="button" data-beauty-preview="${it.id}">预览</button>
              ${isDefault ? '' : `<button type="button" data-beauty-edit="${it.id}">编辑</button>`}
           </div>`;
    return `
        <div class="qq-beauty-slot${isDefault ? ' is-default' : ''}${state.beautySelected.has(it.id) ? ' selected' : ''}"
             data-id="${it.id}">
            ${checkboxHtml}
            ${previewArea}
            <div class="qq-beauty-slot-name">${escapeHtmlText(it.name || '未命名')}</div>
            ${actionsHtml}
        </div>
    `;
}

function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// 通用：给某个 URL 输入框加"上传图床"按钮（catbox / 自定义 endpoint 后端代理）
function bindImageHostUpload(buttonEl, targetInputEl) {
    if (!buttonEl || !targetInputEl) return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    buttonEl.parentElement?.appendChild(fileInput);
    buttonEl.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const orig = buttonEl.textContent;
            buttonEl.disabled = true;
            buttonEl.textContent = '上传中...';
            try {
                const res = await fetch('/api/upload/image-host', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dataUrl: reader.result })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const detail = Array.isArray(data.detail) ? '\n' + data.detail.join('\n') : '';
                    console.error('[图床上传失败]', data);
                    alert(`图床上传失败 (${res.status})：${data.error || ''}${detail}\n\n如果是 catbox 网络不通（中国大陆访问受限），到 设置→存储配置→图床配置 改用"自定义"并填一个能用的端点。`);
                    return;
                }
                targetInputEl.value = data.url;
                targetInputEl.dispatchEvent(new Event('input', { bubbles: true }));
                toast(`已上传到 ${data.host}`);
            } catch (err) {
                toast('上传失败：' + (err.message || '未知错误'));
            } finally {
                buttonEl.disabled = false;
                buttonEl.textContent = orig;
                fileInput.value = '';
            }
        };
        reader.readAsDataURL(file);
    });
}

function escapeHtmlText(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function onBeautySelectChange(id, checked) {
    if (checked) state.beautySelected.add(id);
    else state.beautySelected.delete(id);
    const btn = $('#beauty-delete-selected');
    if (btn) {
        btn.disabled = state.beautySelected.size === 0;
        btn.textContent = `删除选中 (${state.beautySelected.size})`;
    }
    // 卡片高亮
    const card = document.querySelector(`.qq-beauty-slot[data-id="${id}"]`);
    if (card) card.classList.toggle('selected', checked);
}

async function createBeautySlot(type) {
    const def = BEAUTY_TAB_DEFS.find(t => t.type === type);
    if (def.price > 0 && state.walletBalance !== null && state.walletBalance < def.price) {
        toast(`余额不足，需要 ${def.price}cc`);
        return;
    }
    let name;
    if (type === 'backgrounds') {
        // 背景图不需要命名（用户决策 2026-06-21）
        name = '背景';
    } else {
        const input = prompt(`新建${def.label}的名字：`, '我的' + def.label);
        if (!input) return;
        name = input.trim();
    }
    try {
        const res = await fetch(`/api/qq/beauties/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 402) {
                toast(`余额不足：${data.balance}cc，需要 ${data.price}cc`);
            } else {
                toast(data.error || '创建失败');
            }
            return;
        }
        await refreshBeautyBalance();
        await loadBeautyPanel(type);
        toast(`已创建 ${data.name}（-${def.price}cc）`);
    } catch (err) {
        toast('创建失败：' + (err.message || '未知错误'));
    }
}

function previewSlot(type, id) {
    const list = (state.beautyListCache || {})[type] || [];
    const item = list.find(x => x.id === id);
    if (!item) return;
    // 皮肤特殊：套到全 App + 显示"退出预览"浮窗
    if (type === 'skins') {
        startSkinFullScreenPreview(item);
        return;
    }
    const styleEl = $('#beauty-mockup-style');
    if (!styleEl) return;
    // frames: 透明 PNG 直链覆盖在头像上（::after 实现）
    // bubbles: userCss+charCss；skins: CSS；backgrounds: 不走预览（用户决策）
    // avatars: 直接换 mockup 两张头像 src
    if (type === 'frames') {
        const url = item.url || '';
        styleEl.textContent = url
            ? `.bunny-qq-frame::after { background-image: url('${url.replace(/'/g, "\\'")}'); }`
            : '';
    }
    else if (type === 'avatars') {
        styleEl.textContent = '';
        const charImg = document.querySelector('[data-mockup-avatar="char"] img');
        const userImg = document.querySelector('[data-mockup-avatar="user"] img');
        if (charImg) charImg.src = item.charUrl || DEFAULT_AVATAR_URL;
        if (userImg) userImg.src = item.userUrl || DEFAULT_AVATAR_URL;
    }
    else if (type === 'bubbles') styleEl.textContent = (item.userCss || '') + '\n' + (item.charCss || '');
    else if (type === 'skins') styleEl.textContent = item.css || '';
    else styleEl.textContent = '';
    state.beautyPreviewing = { type, id };
    // 视觉反馈
    document.querySelectorAll('.qq-beauty-slot').forEach(el => el.classList.remove('previewing'));
    const card = document.querySelector(`.qq-beauty-slot[data-id="${id}"]`);
    if (card) card.classList.add('previewing');
}

// ========== 编辑页 ==========
function openBeautyEditor(type, id) {
    const list = (state.beautyListCache || {})[type] || [];
    const item = list.find(x => x.id === id);
    if (!item) return;
    state.beautyEditing = { type, id };
    const editor = $('#beauty-editor');
    if (!editor) return;
    const def = BEAUTY_TAB_DEFS.find(t => t.type === type);
    const isBubble = type === 'bubbles';
    const isBackground = type === 'backgrounds';
    const isFrame = type === 'frames';
    const isSkin = type === 'skins';

    editor.querySelector('#beauty-editor-title').textContent = `编辑${def.label}`;
    // 背景图不需要名字/预览图字段
    const nameField = editor.querySelector('#beauty-field-name');
    const previewField = editor.querySelector('#beauty-field-preview');
    if (isBackground) {
        nameField.style.display = 'none';
        previewField.style.display = 'none';
    } else {
        nameField.style.display = '';
        previewField.style.display = '';
        editor.querySelector('#beauty-editor-name').value = item.name || '';
        editor.querySelector('#beauty-editor-preview').value = item.preview || '';
    }

    const cssArea = editor.querySelector('#beauty-editor-css-area');
    if (isBubble) {
        cssArea.innerHTML = `
            <label class="qq-beauty-editor-label">user 气泡 CSS</label>
            <textarea id="beauty-editor-userCss" spellcheck="false" placeholder=".bunny-qq-bubble.bunny-qq-bubble-user { ... }"></textarea>
            <label class="qq-beauty-editor-label">char 气泡 CSS</label>
            <textarea id="beauty-editor-charCss" spellcheck="false" placeholder=".bunny-qq-bubble.bunny-qq-bubble-char { ... }"></textarea>
        `;
        editor.querySelector('#beauty-editor-userCss').value = item.userCss || '';
        editor.querySelector('#beauty-editor-charCss').value = item.charCss || '';
    } else if (isBackground) {
        // 仿设置 App 的 .wallpaper-pick：方块按钮 → 选文件 → 覆盖式上传
        const hasImage = !!item.url;
        const bgStyle = hasImage ? `style="background-image:url('${item.url.replace(/'/g, "\\'")}')"` : '';
        cssArea.innerHTML = `
            <label class="qq-beauty-editor-label">背景图（点击上传，将覆盖旧文件）</label>
            <button type="button" class="qq-beauty-wallpaper-pick${hasImage ? ' has-image' : ''}"
                    id="beauty-editor-wp-pick" ${bgStyle}>
                ${hasImage ? '' : '<i class="bi bi-plus-lg"></i>'}
            </button>
            <input type="file" id="beauty-editor-wp-file" accept="image/*" style="display:none">
        `;
        editor.querySelector('#beauty-editor-wp-pick').addEventListener('click', () => {
            editor.querySelector('#beauty-editor-wp-file').click();
        });
        editor.querySelector('#beauty-editor-wp-file').addEventListener('change', e => {
            uploadBeautyBackground(id, e.target);
        });
    } else if (isFrame) {
        // 头像框 = 透明 PNG 直链（用户决策 2026-06-21）
        cssArea.innerHTML = `
            <label class="qq-beauty-editor-label">头像框图片直链（透明 PNG，叠在头像上一层）</label>
            <div class="qq-beauty-url-row">
                <input id="beauty-editor-url" type="text" placeholder="https://...">
                <button type="button" class="qq-beauty-host-btn" id="beauty-editor-url-host">上传图床</button>
            </div>
        `;
        editor.querySelector('#beauty-editor-url').value = item.url || '';
        bindImageHostUpload(
            editor.querySelector('#beauty-editor-url-host'),
            editor.querySelector('#beauty-editor-url')
        );
    } else if (type === 'avatars') {
        // 头像 = 成对（charUrl + userUrl），公共库共享
        cssArea.innerHTML = `
            <label class="qq-beauty-editor-label">char 头像直链</label>
            <div class="qq-beauty-url-row">
                <input id="beauty-editor-charUrl" type="text" placeholder="https://...">
                <button type="button" class="qq-beauty-host-btn" id="beauty-editor-charUrl-host">上传图床</button>
            </div>
            <label class="qq-beauty-editor-label">user 头像直链</label>
            <div class="qq-beauty-url-row">
                <input id="beauty-editor-userUrl" type="text" placeholder="https://...">
                <button type="button" class="qq-beauty-host-btn" id="beauty-editor-userUrl-host">上传图床</button>
            </div>
        `;
        editor.querySelector('#beauty-editor-charUrl').value = item.charUrl || '';
        editor.querySelector('#beauty-editor-userUrl').value = item.userUrl || '';
        bindImageHostUpload(
            editor.querySelector('#beauty-editor-charUrl-host'),
            editor.querySelector('#beauty-editor-charUrl')
        );
        bindImageHostUpload(
            editor.querySelector('#beauty-editor-userUrl-host'),
            editor.querySelector('#beauty-editor-userUrl')
        );
    } else if (isSkin) {
        cssArea.innerHTML = `
            <label class="qq-beauty-editor-label">CSS</label>
            <textarea id="beauty-editor-css" spellcheck="false" placeholder=".bunny-qq-skin { ... }"></textarea>
        `;
        editor.querySelector('#beauty-editor-css').value = item.css || '';
    }

    // 绑 debounce 自动保存（背景图走单独上传端点，不在此触发）
    if (!isBackground) {
        editor.querySelectorAll('input, textarea').forEach(el => {
            el.addEventListener('input', () => scheduleBeautyAutoSave());
        });
    }

    editor.classList.remove('hidden');
    state.pageHistory.push('beauty-editor');
    notifyNavState();
}

function closeBeautyEditor(silent) {
    const editor = $('#beauty-editor');
    if (!editor) return;
    if (editor.classList.contains('hidden')) return;
    // 关闭前 flush 一次保存
    if (state.beautyAutoSaveTimer) {
        clearTimeout(state.beautyAutoSaveTimer);
        state.beautyAutoSaveTimer = null;
        flushBeautyAutoSave();
    }
    editor.classList.add('hidden');
    if (!silent && state.pageHistory[state.pageHistory.length - 1] === 'beauty-editor') {
        state.pageHistory.pop();
        notifyNavState();
    }
    state.beautyEditing = null;
    // 编辑完后刷新一下商城列表
    if (state.beautyTab) loadBeautyPanel(state.beautyTab);
}

function scheduleBeautyAutoSave() {
    if (state.beautyAutoSaveTimer) clearTimeout(state.beautyAutoSaveTimer);
    state.beautyAutoSaveTimer = setTimeout(flushBeautyAutoSave, 500);
}

async function flushBeautyAutoSave() {
    state.beautyAutoSaveTimer = null;
    if (!state.beautyEditing) return;
    const { type, id } = state.beautyEditing;
    const editor = $('#beauty-editor');
    if (!editor) return;
    // 背景图通过上传端点写盘，无需 PUT
    if (type === 'backgrounds') return;
    const patch = {
        name: editor.querySelector('#beauty-editor-name')?.value || '',
        preview: editor.querySelector('#beauty-editor-preview')?.value || '',
    };
    if (type === 'bubbles') {
        patch.userCss = editor.querySelector('#beauty-editor-userCss')?.value || '';
        patch.charCss = editor.querySelector('#beauty-editor-charCss')?.value || '';
    } else if (type === 'frames') {
        patch.url = editor.querySelector('#beauty-editor-url')?.value || '';
    } else if (type === 'avatars') {
        patch.charUrl = editor.querySelector('#beauty-editor-charUrl')?.value || '';
        patch.userUrl = editor.querySelector('#beauty-editor-userUrl')?.value || '';
    } else if (type === 'skins') {
        patch.css = editor.querySelector('#beauty-editor-css')?.value || '';
    }
    try {
        const res = await fetch(`/api/qq/beauties/${type}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            toast(data.error || '保存失败');
            return;
        }
        const saved = await res.json();
        // 同步缓存
        const list = (state.beautyListCache || {})[type] || [];
        const idx = list.findIndex(x => x.id === id);
        if (idx >= 0) list[idx] = saved;
        // 标"已保存"指示
        const ind = $('#beauty-editor-save-indicator');
        if (ind) {
            ind.textContent = '已保存 · ' + new Date().toLocaleTimeString();
            ind.classList.add('saved');
            setTimeout(() => ind.classList.remove('saved'), 1500);
        }
    } catch (err) {
        toast('保存失败：' + (err.message || '未知错误'));
    }
}

// 单块上传（背景图 tab 的 full-width 块用）
function uploadBeautyBackgroundSingle(id, fileInput) {
    const file = fileInput?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const res = await fetch(`/api/qq/beauties/backgrounds/${id}/image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: reader.result })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { toast(data.error || '上传失败'); return; }
            const list = state.beautyListCache?.backgrounds || [];
            const idx = list.findIndex(x => x.id === id);
            if (idx >= 0) list[idx] = data;
            const def = BEAUTY_TAB_DEFS.find(t => t.type === 'backgrounds');
            const panel = $('#beauty-panel');
            if (panel && def) renderBeautyPanel(panel, def, list);
            toast('已上传（旧文件已覆盖）');
        } catch (err) {
            toast('上传失败：' + (err.message || '未知错误'));
        }
    };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsDataURL(file);
}

// ========== 背景图上传（覆盖式） ==========
function uploadBeautyBackground(id, fileInput) {
    const file = fileInput?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const res = await fetch(`/api/qq/beauties/backgrounds/${id}/image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: reader.result })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { toast(data.error || '上传失败'); return; }
            // 更新缩略
            const pick = $('#beauty-editor-wp-pick');
            if (pick) {
                pick.classList.add('has-image');
                pick.style.backgroundImage = `url('${data.url.replace(/'/g, "\\'")}')`;
                pick.innerHTML = '';
            }
            // 同步缓存
            const list = state.beautyListCache?.backgrounds || [];
            const idx = list.findIndex(x => x.id === id);
            if (idx >= 0) list[idx] = data;
            toast('已上传（旧文件已覆盖）');
        } catch (err) {
            toast('上传失败：' + (err.message || '未知错误'));
        }
    };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsDataURL(file);
}

// ========== 多选删除 ==========
async function deleteSelectedBeauties(type) {
    if (state.beautySelected.size === 0) return;
    const ids = [...state.beautySelected];
    // 先查每个 id 的使用情况
    const usages = await Promise.all(ids.map(async id => {
        try {
            const r = await fetch(`/api/qq/char-beauty-usage/${type}/${id}`);
            return r.ok ? await r.json() : { count: 0, names: [] };
        } catch { return { count: 0, names: [] }; }
    }));
    const inUse = ids.map((id, i) => ({ id, ...usages[i] })).filter(x => x.count > 0);
    let confirmMsg = `确认删除 ${ids.length} 个美化项？删除不退币。`;
    if (inUse.length) {
        const lines = inUse.map(x => {
            const slotItem = (state.beautyListCache?.[type] || []).find(it => it.id === x.id);
            return `· ${slotItem?.name || x.id}：被 ${x.count} 个 char 使用（${x.names.join('、')}），删除后回归默认`;
        }).join('\n');
        confirmMsg += `\n\n以下项有 char 在使用：\n${lines}`;
    }
    if (!confirm(confirmMsg)) return;
    // 逐个删
    const errors = [];
    for (const id of ids) {
        try {
            const r = await fetch(`/api/qq/beauties/${type}/${id}`, { method: 'DELETE' });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                errors.push(`${id}: ${d.error || r.status}`);
            }
        } catch (err) { errors.push(`${id}: ${err.message}`); }
    }
    if (errors.length) toast(`部分删除失败：${errors.join('；')}`);
    else toast(`已删除 ${ids.length} 项`);
    state.beautySelectMode = false;
    state.beautySelected = new Set();
    updateSelectToggleLabel();
    loadBeautyPanel(type);
}

// ========== 皮肤全局应用 ==========
async function applySkin(skinId) {
    try {
        const res = await fetch('/api/qq/skin', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skinId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { toast(data.error || '应用失败'); return; }
        // 注入到全局皮肤 style 节点
        if (typeof ensureBeautyStyleNodes === 'function') ensureBeautyStyleNodes();
        const node = document.getElementById('bunny-style-skin');
        if (node) node.textContent = data.css || '';
        toast(skinId === 'default' ? '已恢复默认皮肤' : '已应用皮肤');
    } catch (err) {
        toast('应用失败：' + (err.message || '未知错误'));
    }
}

// QQ App 启动时拉一次全局皮肤
async function loadGlobalSkin() {
    try {
        const res = await fetch('/api/qq/skin');
        if (!res.ok) return;
        const data = await res.json();
        if (typeof ensureBeautyStyleNodes === 'function') ensureBeautyStyleNodes();
        const node = document.getElementById('bunny-style-skin');
        if (node) node.textContent = data.css || '';
    } catch {}
}

// ========== 皮肤全屏预览 ==========
function startSkinFullScreenPreview(item) {
    if (typeof ensureBeautyStyleNodes === 'function') ensureBeautyStyleNodes();
    const node = document.getElementById('bunny-style-skin');
    if (!node) return;
    // 存当前值，便于恢复
    state.skinPreviewBackup = node.textContent;
    node.textContent = item.css || '';
    // 关闭商城弹窗以便看到全 App 效果
    closeBeautyModal();
    showSkinPreviewExitBar(item.name);
}

function showSkinPreviewExitBar(name) {
    let bar = document.getElementById('skin-preview-exit');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'skin-preview-exit';
        bar.className = 'qq-skin-preview-exit';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `
        <span>正在预览皮肤：${escapeHtmlText(name || '')}</span>
        <button type="button" id="skin-preview-exit-btn">退出预览</button>
    `;
    bar.querySelector('#skin-preview-exit-btn').addEventListener('click', endSkinFullScreenPreview);
}

function endSkinFullScreenPreview() {
    const node = document.getElementById('bunny-style-skin');
    if (node && state.skinPreviewBackup !== undefined) {
        node.textContent = state.skinPreviewBackup;
    }
    state.skinPreviewBackup = undefined;
    const bar = document.getElementById('skin-preview-exit');
    if (bar) bar.remove();
}

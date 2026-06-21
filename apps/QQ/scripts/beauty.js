// QQ 美化商城。M2 = 骨架：5 tab + 余额条 + 空 panel；后续里程碑往里填模块逻辑。
// 详见 QQ美化系统计划.md §1.4。
//
// tab 顺序：皮肤 / 头像 / 头像框 / 气泡 / 背景图
// 头像不算美化模块（用户决策 2026-06-21）。tab 顺序：皮肤 / 头像框 / 气泡 / 背景图
const BEAUTY_TAB_DEFS = [
    { type: 'skins',       label: '皮肤',   price: 20 },
    { type: 'frames',      label: '头像框', price: 5 },
    { type: 'bubbles',     label: '气泡',   price: 5 },
    { type: 'backgrounds', label: '背景图', price: 0 },
];

function openBeautyModal() {
    $('#beauty-modal')?.classList.remove('hidden');
    state.pageHistory.push('beauty');
    notifyNavState();
    if (!state.beautyTab) state.beautyTab = 'skins';
    refreshBeautyBalance();
    renderBeautyTabs();
    loadBeautyPanel(state.beautyTab);
}

function closeBeautyModal() {
    $('#beauty-modal')?.classList.add('hidden');
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
            state.beautyTab = btn.dataset.beautyTab;
            renderBeautyTabs();
            loadBeautyPanel(state.beautyTab);
        });
    });
}

async function loadBeautyPanel(type) {
    const panel = $('#beauty-panel');
    if (!panel) return;
    const def = BEAUTY_TAB_DEFS.find(t => t.type === type);
    panel.innerHTML = `<div class="qq-beauty-loading">加载中...</div>`;
    try {
        const res = await fetch(`/api/qq/beauties/${type}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = await res.json();
        renderBeautyPanel(panel, def, Array.isArray(list) ? list : []);
    } catch (err) {
        panel.innerHTML = `<div class="qq-beauty-empty">加载失败：${err.message || '未知错误'}</div>`;
    }
}

function renderBeautyPanel(panel, def, list) {
    // M2 骨架：只渲染槽位计数 + 占位提示。M3 起填实际网格。
    const items = list.map(it => `
        <div class="qq-beauty-slot${it.id === 'default' ? ' is-default' : ''}" data-id="${it.id}">
            <div class="qq-beauty-slot-preview">${it.preview ? `<img src="${it.preview}" alt="">` : (it.name || '').slice(0, 1)}</div>
            <div class="qq-beauty-slot-name">${it.name || '未命名'}</div>
        </div>
    `).join('');
    panel.innerHTML = `
        <div class="qq-beauty-section-title">${def.label} · 共 ${list.length} 项 · 新建价 ${def.price}cc</div>
        <div class="qq-beauty-grid">${items}</div>
        <div class="qq-beauty-hint">M3 起此处填入 mockup 预览、教程卡、新建按钮、编辑器。</div>
    `;
}

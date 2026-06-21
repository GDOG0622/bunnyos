async function loadPromptPresetSetting() {
    const select = $('#me-prompt-preset');
    if (!select) return;
    try {
        const res = await fetch('/api/qq/prompt-preset');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        state.promptPresets = Array.isArray(data.presets) ? data.presets : [];
        state.currentPromptPresetId = data.currentPromptPresetId || state.promptPresets[0]?.id || '';
        renderPromptPresetSelect();
    } catch (err) {
        console.warn('[QQ] load prompt preset setting failed', err);
        select.innerHTML = '<option value="">读取失败</option>';
    }
}

function renderPromptPresetSelect() {
    const select = $('#me-prompt-preset');
    if (!select) return;
    select.innerHTML = '';
    if (!state.promptPresets.length) {
        select.appendChild(new Option('暂无预设', ''));
        select.disabled = true;
        return;
    }
    select.disabled = false;
    state.promptPresets.forEach(preset => {
        const option = new Option(preset.name || preset.id, preset.id);
        select.appendChild(option);
    });
    select.value = state.currentPromptPresetId || state.promptPresets[0]?.id || '';
}

async function savePromptPresetSetting(id) {
    if (!id || id === state.currentPromptPresetId) return;
    const previousId = state.currentPromptPresetId;
    state.currentPromptPresetId = id;
    renderPromptPresetSelect();
    try {
        const res = await fetch('/api/qq/prompt-preset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        state.currentPromptPresetId = data.currentPromptPresetId || id;
        toast('QQ 提示词预设已切换');
    } catch (err) {
        console.warn('[QQ] save prompt preset setting failed', err);
        state.currentPromptPresetId = previousId;
        renderPromptPresetSelect();
        toast(err.message || '提示词预设保存失败');
    }
}

function openPromptManager() {
    const modal = $('#prompt-manager-modal');
    const frame = $('#prompt-manager-frame');
    if (!modal || !frame) return;
    if (!frame.src) frame.src = '/apps/prompt-manager/index.html?embedded=qq';
    modal.classList.remove('hidden');
    state.pageHistory.push('prompt-manager');
    notifyNavState();
}

function closePromptManager() {
    $('#prompt-manager-modal')?.classList.add('hidden');
    if (state.pageHistory[state.pageHistory.length - 1] === 'prompt-manager') {
        state.pageHistory.pop();
    }
    loadPromptPresetSetting();
    notifyNavState();
}

const chatToolActions = new Map();
const toolStatusLabels = { pending: '等待你确认', running: '执行中，结果待核对', unknown: '结果未知，请向服务方核对', completed: '已完成', failed: '执行失败', rejected: '已拒绝', expired: '已过期' };
document.getElementById('btn-suki')?.addEventListener('click', () => {
    if (!state.activeChatId) return;
    localStorage.setItem('bunnyos:suki:character', state.activeChatId);
    if (window.parent !== window) window.parent.bunnyosOpenAppAndFocusChat?.('suki', state.activeChatId);
    else location.href = `/index.html?openApp=suki&characterId=${encodeURIComponent(state.activeChatId)}`;
});
async function loadChatToolActions(characterId) {
    try {
        const response = await fetch(`/api/tools/actions?characterId=${encodeURIComponent(characterId)}`);
        if (!response.ok) return;
        const list = await response.json();
        list.forEach(action => chatToolActions.set(action.id, action));
        if (state.activeChatId === characterId) renderActiveChat();
    } catch (error) { console.warn('[QQ tools]', error.message); }
}
function toolActionsHtml(message) {
    return (Array.isArray(message.toolActions) ? message.toolActions : []).map(stored => {
        const action = chatToolActions.get(stored.id) || stored;
        let sources = '';
        try {
            const result = JSON.parse(action.result);
            if (Array.isArray(result.results)) sources = result.results.filter(source => /^https?:\/\//i.test(source.url)).map(source => `<a href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>`).join('');
        } catch { /* Other tools return plain text or their own structured content. */ }
        return `<section class="qq-tool-card"><div class="qq-tool-title"><span>${escapeHtml(action.serverName)} · ${escapeHtml(action.originalName)}</span><small>${escapeHtml(toolStatusLabels[action.status] || action.status)}</small></div><details ${action.status === 'pending' ? 'open' : ''}><summary>调用参数</summary><pre>${escapeHtml(JSON.stringify(action.args, null, 2))}</pre></details>${action.result ? `<details><summary>执行结果</summary><pre>${escapeHtml(action.result)}</pre></details>` : ''}${sources ? `<div class="qq-tool-sources">${sources}</div>` : ''}${action.status === 'pending' ? `<div class="qq-tool-buttons"><button type="button" data-tool-decide="${escapeAttr(action.id)}" data-approve="true">确认执行并继续</button><button type="button" data-tool-decide="${escapeAttr(action.id)}" data-approve="false">拒绝</button></div><small>确认前请核对商品、金额、地址等信息。</small>` : ''}</section>`;
    }).join('');
}
document.addEventListener('click', async event => {
    const button = event.target.closest('[data-tool-decide]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!chat || generationTasks.has(chat.characterId)) return toast('请等当前回复完成');
    button.disabled = true;
    try {
        const response = await fetch(`/api/tools/actions/${encodeURIComponent(button.dataset.toolDecide)}/decide`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve: button.dataset.approve === 'true' })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        chatToolActions.set(data.id, data); renderActiveChat();
        if (button.dataset.approve === 'true' && ['completed', 'failed'].includes(data.status)) await requestAssistantReply(chat);
        else toast(toolStatusLabels[data.status] || data.status);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
}, true);

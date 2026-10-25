const { escape: esc, request, status, handle, openApp } = BunnyApp;
const $ = selector => document.querySelector(selector);
let config, editingId = null, reminderData = [], actionData = [];
const states = { pending: '等待确认', running: '执行中／结果待核对', unknown: '结果未知，请核对服务方记录', completed: '已完成', failed: '执行失败', rejected: '已拒绝', expired: '已过期', scheduled: '等待提醒', fired: '已触发', cancelled: '已取消' };
const dateText = value => new Date(value).toLocaleString('zh-CN');
async function load() {
    const result = await Promise.all([request('/api/tools'), request('/api/reminders'), request('/api/tools/actions')]);
    [config, reminderData, actionData] = result;
    $('#loading').hidden = true; $('#content').hidden = false;
    render();
}
function render() {
    $('#enabled').checked = config.enabled;
    $('#key-state').textContent = config.hasTavilyKey ? '已保存密钥；留空可保留。' : '尚未配置，配置后可在聊天中联网搜索。';
    $('#servers').innerHTML = config.servers.length ? config.servers.map(server => `<article class="card" data-server="${esc(server.id)}"><div class="row"><div class="server-title"><h3>${esc(server.name)}</h3><span class="badge">${server.enabled ? '已启用' : '已停用'}</span></div><small>${esc(server.transport)}</small></div><p class="muted small">${esc(server.url || [server.command, ...server.args].join(' '))}</p><div class="pills" style="margin-top:14px"><button data-test="${esc(server.id)}">测试连接</button><button data-edit="${esc(server.id)}">编辑</button><button data-delete="${esc(server.id)}" class="danger">删除</button></div><div class="connection-result" aria-live="polite"></div></article>`).join('') : '<div class="card empty">还没有外接工具。添加你的第一个 MCP 服务吧。</div>';
    $('#reminder-list').innerHTML = reminderData.length ? [...reminderData].reverse().map(item => `<article class="card"><div class="row"><h3>${esc(item.title)}</h3><span class="badge">${states[item.status] || esc(item.status)}</span></div><p class="reminder-at muted">${esc(dateText(item.at))}</p>${item.status === 'scheduled' ? `<button data-cancel="${esc(item.id)}" style="margin-top:12px">取消提醒</button>` : ''}</article>`).join('') : '<div class="empty">还没有提醒，先为自己记一件事。</div>';
    $('#pending-count').textContent = actionData.filter(item => item.status === 'pending').length;
    $('#action-list').innerHTML = actionData.length ? actionData.map(item => `<article class="card"><div class="row"><h3>${esc(item.serverName)} · ${esc(item.originalName)}</h3><span class="badge">${states[item.status] || esc(item.status)}</span></div><small>${esc(dateText(item.createdAt))}</small><details ${item.status === 'pending' ? 'open' : ''}><summary>查看调用参数</summary><pre>${esc(JSON.stringify(item.args, null, 2))}</pre></details>${item.result ? `<details><summary>查看执行结果</summary><pre>${esc(item.result)}</pre></details>` : ''}${item.status === 'pending' ? `<div class="pills" style="margin-top:12px"><button class="primary" data-decide="${esc(item.id)}" data-approve="true">确认执行</button><button data-decide="${esc(item.id)}" data-approve="false">拒绝</button></div>` : ''}</article>`).join('') : '<div class="card empty">角色调用工具后，过程和结果会留在这里。</div>';
    $('#timezone').textContent = `按本设备时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone} 保存。`;
}
function transportFields() {
    const stdio = $('#server-transport').value === 'stdio';
    $('#command-fields').hidden = !stdio; $('#url-field').hidden = stdio;
    $('#server-url').required = !stdio; $('#server-command').required = stdio;
    $('#secrets-label').firstChild.textContent = stdio ? '环境变量（JSON 字典）' : '请求头（JSON 字典）';
    $('#server-secrets').placeholder = stdio ? '{"TAVILY_API_KEY": "tvly-…"}' : '{"Authorization": "Bearer …"}';
}
function editServer(id = null) {
    editingId = id;
    const server = config.servers.find(item => item.id === id);
    $('#server-title').textContent = server ? '编辑 MCP 服务' : '添加 MCP 服务';
    $('#server-name').value = server?.name || ''; $('#server-transport').value = server?.transport || 'http';
    $('#server-url').value = server?.url || ''; $('#server-command').value = server?.command || '';
    $('#server-args').value = JSON.stringify(server?.args || []); $('#server-secrets').value = '';
    $('#server-enabled').checked = server?.enabled ?? true; $('#server-auto').checked = server?.autoApproveReadOnly || false;
    $('#secrets-note').textContent = server ? '敏感配置不会回显。留空保留原值，输入 {} 清除。' : '敏感配置只保存在本机服务端。';
    transportFields(); $('#server-dialog').showModal();
}
$('#refresh').onclick = handle(load);
$('#add-server').onclick = () => editServer();
$('#cancel-server').onclick = () => $('#server-dialog').close();
$('#server-transport').onchange = transportFields;
$('#enabled').onchange = handle(async () => {
    const enabled = $('#enabled').checked;
    try { config = await request('/api/tools', 'PATCH', { version: config._version, enabled }); }
    catch (error) { $('#enabled').checked = config.enabled; throw error; }
    status(enabled ? '聊天工具已启用' : '聊天工具已停用');
});
$('#search-form').onsubmit = handle(async () => {
    config = await request('/api/tools', 'PATCH', { version: config._version, enabled: config.enabled,
        ...($('#search-key').value.trim() ? { tavilyKey: $('#search-key').value.trim() } : {}) });
    $('#search-key').value = ''; render(); status('搜索配置已保存');
});
$('#clear-key').onclick = handle(async () => { config = await request('/api/tools', 'PATCH', { version: config._version, enabled: config.enabled, tavilyKey: '' }); render(); status('密钥已清除'); });
$('#subscribe').onclick = handle(async () => {
    if (window.parent === window || !window.parent.bunnyosSubscribeWebPush) { openApp('settings'); return; }
    const result = await window.parent.bunnyosSubscribeWebPush();
    if (!result.ok) throw new Error(result.error || '未能开启推送，请检查通知权限');
    status('本设备推送已开启');
});
$('#server-form').onsubmit = handle(async () => {
    const transport = $('#server-transport').value;
    let args = [], secrets;
    try { args = JSON.parse($('#server-args').value || '[]'); if ($('#server-secrets').value.trim()) secrets = JSON.parse($('#server-secrets').value); }
    catch { throw new Error('参数和敏感配置须为有效 JSON'); }
    const server = { name: $('#server-name').value, transport, enabled: $('#server-enabled').checked, autoApproveReadOnly: $('#server-auto').checked,
        ...(transport === 'stdio' ? { command: $('#server-command').value, args, ...(secrets === undefined ? {} : { env: secrets }) }
            : { url: $('#server-url').value, ...(secrets === undefined ? {} : { headers: secrets }) }) };
    config = await request(editingId ? `/api/tools/servers/${encodeURIComponent(editingId)}` : '/api/tools/servers', editingId ? 'PUT' : 'POST', { version: config._version, server });
    $('#server-dialog').close(); render(); status('服务已保存，可以测试连接');
});
$('#servers').onclick = handle(async event => {
    const button = event.target.closest('button'); if (!button) return;
    const id = button.dataset.test || button.dataset.edit || button.dataset.delete;
    if (button.dataset.edit) return editServer(id);
    if (button.dataset.delete) {
        if (!confirm('删除这个 MCP 连接？')) return;
        config = await request(`/api/tools/servers/${encodeURIComponent(id)}`, 'DELETE', { version: config._version }); render(); return;
    }
    if (button.dataset.test) {
        button.disabled = true;
        const output = button.closest('article').querySelector('.connection-result'); output.textContent = '正在连接并发现工具…';
        try { const data = await request(`/api/tools/servers/${encodeURIComponent(id)}/test`, 'POST', {});
            output.innerHTML = `<p class="small">连接成功 · ${data.tools.length} 个工具</p><div class="pills">${data.tools.map(tool => `<span class="badge" title="${esc(tool.description || '')}">${esc(tool.name)}${tool.readOnly ? ' · 只读' : ''}</span>`).join('')}</div>`;
        } catch (error) { output.textContent = error.message; throw error; }
        finally { button.disabled = false; }
    }
});
$('#reminder-form').onsubmit = handle(async () => {
    await request('/api/reminders', 'POST', { title: $('#reminder-title').value, at: new Date($('#reminder-at').value).toISOString() });
    $('#reminder-form').reset(); await load(); status('提醒已保存');
});
$('#reminder-list').onclick = handle(async event => { const id = event.target.closest('[data-cancel]')?.dataset.cancel; if (!id) return; await request(`/api/reminders/${encodeURIComponent(id)}/cancel`, 'POST', {}); await load(); });
$('#action-list').onclick = handle(async event => {
    const button = event.target.closest('[data-decide]'); if (!button) return;
    button.disabled = true;
    try { await request(`/api/tools/actions/${encodeURIComponent(button.dataset.decide)}/decide`, 'POST', { approve: button.dataset.approve === 'true' }); await load(); }
    finally { button.disabled = false; }
});
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach(item => { item.classList.toggle('active', item === button); $('#' + item.dataset.tab).hidden = item !== button; });
});
load().catch(error => { $('#loading').innerHTML = `加载失败：${esc(error.message)} <button onclick="location.reload()">重试</button>`; });

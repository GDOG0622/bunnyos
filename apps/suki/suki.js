const { escape: esc, request, status, handle, openApp } = BunnyApp;
const $ = selector => document.querySelector(selector);
let characters = [], persona = {}, currentId = '', data = null, page = 'home', loadId = 0;
let writing = false;
const pathFor = suffix => `/api/suki/${encodeURIComponent(currentId)}${suffix || ''}`;
const character = () => characters.find(item => item.id === currentId);
const daysLabel = days => days === 0 ? '就是今天' : days < 0 ? `已过 ${-days} 天` : `还有 ${days} 天`;
const avatar = (url, name) => `<span class="avatar">${url && /^(?:https?:\/\/|\/data\/|\/assets\/)/i.test(url) ? `<img src="${esc(url)}" alt="${esc(name)}">` : esc((name || '♡').slice(0, 1))}</span>`;
async function loadSpace() {
    const requestId = ++loadId;
    $('#loading').hidden = false; $('#space').hidden = true; $('#setup').hidden = true; $('#bottom-nav').hidden = true;
    if (!currentId) { data = null; $('#loading').hidden = true; render(); return; }
    const next = await request(pathFor());
    if (requestId !== loadId) return;
    data = next; $('#loading').hidden = true; render();
}
async function mutate(suffix, method, body = {}) {
    if (writing) throw new Error('正在保存上一条记录，请稍候');
    writing = true;
    const requestedId = currentId;
    try {
        const next = await request(pathFor(suffix), method, { ...body, version: data._version });
        if (currentId === requestedId) { data = next; render(); }
        return next;
    } finally { writing = false; }
}
function render() {
    const space = data?.space;
    $('#setup').hidden = !!space; $('#space').hidden = !space; $('#bottom-nav').hidden = !space;
    $('#space-settings').hidden = !space; $('#create-space').hidden = !currentId; $('#go-qq').hidden = !!currentId;
    $('#space-title').textContent = space?.title || '把日子过成我们的故事';
    if (!space) return;
    const partner = character()?.name || 'TA';
    $('#days').textContent = data.daysTogether; $('#since').textContent = `从 ${space.startDate} 开始，和你一起。`;
    $('#today').textContent = data.today.slice(5).replace('-', ' / ');
    $('#couple').innerHTML = `<div class="person">${avatar(persona.avatar, space.userName)}<span>${esc(space.userName)}</span></div><span class="couple-heart" aria-hidden="true">♡</span><div class="person">${avatar(character()?.avatar, partner)}<span>${esc(partner)}</span></div>`;
    document.querySelectorAll('[data-mood]').forEach(button => { const selected = space.moods[data.today] === button.dataset.mood; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    const next = data.anniversaries.find(item => item.next.days >= 0);
    $('#next-anniversary').innerHTML = next ? `<h3>${esc(next.title)}</h3><div class="countdown"><strong>${next.next.days}</strong> 天</div><p class="muted small">${esc(next.next.date)}${next.next.days === 0 ? ' · 就是今天 ♡' : ''}</p>` : '<p class="muted">为你们记下第一个纪念日吧。</p><button data-add-date style="margin-top:12px">＋ 记一个日子</button>';
    const answer = space.answers[data.today];
    $('#question').textContent = data.question;
    // Do not replace a locally edited draft when saving another part of the home page.
    if (document.activeElement !== $('#answer-text') && !$('#answer-text').dataset.dirty) $('#answer-text').value = answer?.user || '';
    $('#answer-view').innerHTML = answer?.partner ? `<div class="partner-answer"><small>${esc(partner)}的回答</small><p class="preserve">${esc(answer.partner)}</p></div>` : '';
    $('#partner-answer').disabled = !answer || !!answer.partner;
    $('#partner-answer').textContent = answer?.partner ? 'TA 已经认真回答了' : '听听 TA 的回答';
    $('#answer-hint').textContent = answer?.partner ? '你们今天的回答已收好；修改你的回答后，可以再次邀请 TA。' : '先写下自己的回答，再邀请角色回应。';
    $('#pet-name').textContent = `我们的小兔子 · ${space.pet.name}`;
    const cared = space.pet.careDates.includes(data.today);
    $('#pet-description').textContent = `已经一起照顾了 ${space.pet.careDates.length} 天 · ${space.pet.careDates.length >= 7 ? '熟悉你们的气息了' : '正在慢慢熟悉这个家'}`;
    $('#care-pet').disabled = cared; $('#care-pet').textContent = cared ? '今天也被好好照顾了 ♡' : '给小兔添一份胡萝卜';
    $('#entries').innerHTML = space.entries.length ? [...space.entries].reverse().map(entry => `<article class="card"><div class="row"><span class="eyebrow">${esc(entry.date)}</span><span class="badge">${esc(entry.mood || '日常碎片')}</span></div><p class="preserve entry-content">${esc(entry.text)}</p>${entry.image ? `<img class="entry-photo" src="${esc(entry.image)}" alt="这一天的照片" loading="lazy">` : ''}${entry.partner ? `<div class="partner-answer"><small>${esc(partner)}留下的话</small><p class="preserve">${esc(entry.partner)}</p></div>` : ''}<div class="pills entry-footer">${entry.partner ? '' : `<button data-respond="${esc(entry.id)}">邀请 TA 留句话</button>`}<button data-remove="${esc(entry.id)}" data-collection="entries" class="quiet danger">删除</button></div></article>`).join('') : '<div class="empty">第一篇日记，就从今天开始吧。</div>';
    $('#anniversaries').innerHTML = data.anniversaries.length ? data.anniversaries.map(item => `<article class="card"><h3>${esc(item.title)}</h3><div class="countdown"><strong>${item.next.days < 0 ? -item.next.days : item.next.days}</strong> 天</div><p class="muted small">${esc(item.next.date)} · ${daysLabel(item.next.days)}${item.yearly ? ' · 每年' : ''}</p><button class="quiet danger" data-remove="${esc(item.id)}" data-collection="anniversaries" style="margin-top:12px">删除</button></article>`).join('') : '<div class="card empty">相遇、生日、第一次说喜欢，都值得被记住。</div>';
    $('#wish-progress').textContent = `${space.wishes.filter(item => item.done).length} / ${space.wishes.length} 件小事，已经成为回忆。`;
    $('#wish-list').innerHTML = space.wishes.length ? space.wishes.map(item => `<article class="card wish-row${item.done ? ' done' : ''}"><label class="check"><input type="checkbox" data-wish="${esc(item.id)}" ${item.done ? 'checked' : ''}>${esc(item.text)}</label><button data-remove="${esc(item.id)}" data-collection="wishes" aria-label="删除 ${esc(item.text)}">×</button></article>`).join('') : '<div class="empty">还有好多事，想和你一起做。</div>';
    switchPage(page);
}
function switchPage(next) {
    page = next;
    document.querySelectorAll('[data-page]').forEach(button => { button.classList.toggle('active', button.dataset.page === page); $('#' + button.dataset.page).hidden = button.dataset.page !== page; });
}
function settings() {
    if (!currentId) return;
    const space = data?.space;
    $('#setting-title').value = space?.title || `和${character()?.name}的小家`;
    $('#setting-user').value = space?.userName || persona.name || '我';
    $('#setting-timezone').value = space?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    $('#setting-start').value = space?.startDate || new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    $('#settings-dialog').showModal();
}
$('#create-space').onclick = settings; $('#space-settings').onclick = settings;
$('#go-qq').onclick = () => openApp('QQ'); $('#chat-partner').onclick = () => openApp('QQ', currentId);
$('#character').onchange = handle(async () => {
    if (writing) { $('#character').value = currentId; throw new Error('请等当前保存完成'); }
    currentId = $('#character').value; $('#answer-text').value = ''; delete $('#answer-text').dataset.dirty;
    localStorage.setItem('bunnyos:suki:character', currentId); await loadSpace();
});
$('#settings-form').onsubmit = handle(async () => {
    await mutate('', 'PATCH', { title: $('#setting-title').value, userName: $('#setting-user').value, startDate: $('#setting-start').value, timeZone: $('#setting-timezone').value });
    $('#settings-dialog').close(); status('小家已经收拾好了 ♡');
});
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $('#' + button.dataset.close).close());
document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { switchPage(button.dataset.page); window.scrollTo({ top: 0 }); });
$('#moods').onclick = handle(async event => { const mood = event.target.closest('[data-mood]')?.dataset.mood; if (mood) await mutate('/mood', 'POST', { mood }); });
$('#care-pet').onclick = handle(async () => { await mutate('/pet', 'POST'); $('.pet-card').classList.remove('cared'); requestAnimationFrame(() => $('.pet-card').classList.add('cared')); status('小兔收到了你们的心意 ♡'); });
$('#answer-text').oninput = () => { $('#answer-text').dataset.dirty = 'true'; };
$('#answer-form').onsubmit = handle(async () => { await mutate('/answer', 'POST', { text: $('#answer-text').value }); delete $('#answer-text').dataset.dirty; status('你的回答已经收好'); });
$('#partner-answer').onclick = handle(async () => { status('TA 正在认真想你的问题…'); await mutate('/generate', 'POST', { kind: 'answer' }); status('TA 的回答来了'); });
$('#diary-image').onchange = () => { $('#photo-name').textContent = $('#diary-image').files[0]?.name || ''; };
$('#diary-form').onsubmit = handle(async () => {
    const file = $('#diary-image').files[0]; let image = '';
    if (file) {
        if (file.size > 20 * 1024 * 1024) throw new Error('照片不能超过 20MB');
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        image = (await request('/api/suki/image', 'POST', { dataUrl })).url;
    }
    await mutate('/entries', 'POST', { text: $('#diary-text').value, image, mood: data.space.moods[data.today] || '' });
    $('#diary-form').reset(); $('#photo-name').textContent = ''; status('这一天，已经替你们收好了');
});
function addAnniversary() { $('#anniversary-dialog').showModal(); }
$('#add-anniversary').onclick = addAnniversary;
$('#next-anniversary').onclick = event => { if (event.target.closest('[data-add-date]')) addAnniversary(); };
$('#anniversary-form').onsubmit = handle(async () => { await mutate('/anniversaries', 'POST', { title: $('#anniversary-title').value, date: $('#anniversary-date').value, yearly: $('#anniversary-yearly').checked }); $('#anniversary-form').reset(); $('#anniversary-dialog').close(); status('这个日子，记住啦'); });
$('#wish-form').onsubmit = handle(async () => { await mutate('/wishes', 'POST', { text: $('#wish-text').value }); $('#wish-form').reset(); });
$('#wish-list').onchange = handle(async event => { const checkbox = event.target.closest('[data-wish]'); if (checkbox) { try { await mutate(`/wishes/${encodeURIComponent(checkbox.dataset.wish)}`, 'PATCH', { done: checkbox.checked }); } catch (error) { checkbox.checked = !checkbox.checked; throw error; } } });
const handleRecordClick = handle(async event => {
    const remove = event.target.closest('[data-remove]');
    if (remove && confirm('删除这条记录？')) await mutate(`/${remove.dataset.collection}/${encodeURIComponent(remove.dataset.remove)}`, 'DELETE');
    const respond = event.target.closest('[data-respond]');
    if (respond) { respond.disabled = true; try { status('TA 正在读你的日记…'); await mutate('/generate', 'POST', { kind: 'entry', entryId: respond.dataset.respond }); status('TA 留下了一句话'); } finally { respond.disabled = false; } }
});
window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'bunnyos:open-chat') return;
    const id = event.data.characterId;
    if (writing || !characters.some(item => item.id === id) || id === currentId) return;
    currentId = id; $('#character').value = id; $('#answer-text').value = ''; delete $('#answer-text').dataset.dirty;
    loadSpace().catch(error => status(error.message));
});
$('#space').addEventListener('click', event => {
    if (event.target.closest('[data-remove], [data-respond]')) handleRecordClick(event);
});
async function init() {
    const [chars, personas] = await Promise.all([request('/api/qq/characters'), request('/api/userpersonas')]);
    characters = chars; persona = personas.personas?.find(item => item.id === personas.currentPersonaId) || personas.personas?.[0] || {};
    const saved = localStorage.getItem('bunnyos:suki:character');
    currentId = chars.some(item => item.id === saved) ? saved : chars[0]?.id || '';
    $('#character').innerHTML = chars.length ? chars.map(item => `<option value="${esc(item.id)}">${esc(item.name || '未命名角色')}</option>`).join('') : '<option value="">还没有角色</option>';
    $('#character').value = currentId; await loadSpace();
}
init().catch(error => { $('#loading').innerHTML = `加载失败：${esc(error.message)} <button onclick="location.reload()">重试</button>`; });

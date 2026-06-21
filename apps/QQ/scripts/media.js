let emojiPickerLoading = null;
async function ensureEmojiPickerLoaded() {
    if (customElements.get('emoji-picker')) return;
    if (!emojiPickerLoading) {
        emojiPickerLoading = import('https://cdn.jsdelivr.net/npm/emoji-picker-element@1.29.0/index.js')
            .catch(err => {
                emojiPickerLoading = null;
                throw err;
            });
    }
    await emojiPickerLoading;
}

async function toggleEmojiPanel() {
    const panel = $('#emoji-panel');
    if (!panel.classList.contains('hidden')) {
        hideEmojiPanel();
        return;
    }
    try {
        await showEmojiPicker();
        panel.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        toast('表情面板加载失败');
    }
}

function hideEmojiPanel() {
    $('#emoji-panel')?.classList.add('hidden');
}

function renderStickerPacks() {
    const strip = $('#sticker-strip');
    strip.querySelectorAll('.qq-sticker-tab[data-pack]:not([data-pack="emoji"])').forEach(el => el.remove());
    for (const pack of state.stickerPacks) {
        const first = pack.items?.[0];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qq-sticker-tab';
        btn.dataset.pack = pack.id;
        btn.title = pack.name || '表情包';
        btn.innerHTML = first ? `<img src="${escapeAttr(first.url)}" alt="">` : '<i class="bi bi-image"></i>';
        btn.addEventListener('click', () => showStickerPack(pack.id));
        strip.insertBefore(btn, $('#btn-add-sticker-pack'));
    }
}

function showStickerPack(packId) {
    const pack = state.stickerPacks.find(item => item.id === packId);
    const wrap = $('.qq-emoji-picker-wrap');
    if (!pack) return;
    wrap.innerHTML = `<div class="qq-custom-stickers"></div>`;
    const grid = wrap.querySelector('.qq-custom-stickers');
    for (const item of pack.items || []) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qq-custom-sticker';
        btn.innerHTML = `<img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.name)}">`;
        btn.addEventListener('click', () => sendSticker(item));
        grid.appendChild(btn);
    }
    $$('.qq-sticker-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.pack === packId));
}

async function showEmojiPicker() {
    await ensureEmojiPickerLoaded();
    $('.qq-emoji-picker-wrap').innerHTML = '<emoji-picker id="emoji-picker"></emoji-picker>';
    $('#emoji-picker').addEventListener('emoji-click', event => {
        $('#chat-input').value += event.detail.unicode;
        $('#chat-input').focus();
    });
    $$('.qq-sticker-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.pack === 'emoji'));
}

async function saveStickerPack() {
    const name = $('#sticker-pack-name').value.trim();
    const lines = $('#sticker-pack-lines').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!name || !lines.length) {
        toast('请填写合集名称和表情包直链');
        return;
    }
    const items = lines.map(line => {
        const idx = line.indexOf(':');
        if (idx < 0) return null;
        return {
            name: line.slice(0, idx).trim(),
            url: line.slice(idx + 1).trim()
        };
    }).filter(item => item?.name && item?.url);
    if (!items.length) {
        toast('格式应为：名字: 图片直链');
        return;
    }
    const pack = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name,
        items,
        created_at: Date.now()
    };
    state.stickerPacks.unshift(pack);
    const res = await fetch('/api/qq/sticker-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.stickerPacks),
    });
    if (!res.ok) {
        toast('保存表情包失败');
        return;
    }
    $('#sticker-pack-name').value = '';
    $('#sticker-pack-lines').value = '';
    closePopModal('sticker-modal');
    renderStickerPacks();
    showStickerPack(pack.id);
}

async function sendSticker(item) {
    if (!state.activeChatId) return;
    await appendChatMessage({ role: 'user', type: 'sticker', text: item.name, image: item.url, created_at: Date.now() });
}

async function onChatImagePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/') || !state.activeChatId) return;
    const image = await fileToDataUrl(file);
    await appendChatMessage({ role: 'user', type: 'image', text: '[图片]', image, created_at: Date.now() });
}

function openPopModal(id) {
    $(`#${id}`).classList.remove('hidden');
}

function closePopModal(id) {
    $(`#${id}`).classList.add('hidden');
}

async function sendTransfer() {
    if (!state.activeChatId) return;
    const amount = $('#transfer-amount').value.trim();
    if (!amount) {
        toast('请填写金额');
        return;
    }
    const currency = $('#transfer-currency').value;
    const note = $('#transfer-note').value.trim();
    await appendChatMessage({ role: 'user', type: 'transfer', text: `转账 ${currency}${amount}${note ? ` ${note}` : ''}`, amount, currency, note, created_at: Date.now() });
    $('#transfer-amount').value = '';
    $('#transfer-note').value = '';
    closePopModal('transfer-modal');
}

// STT：Web Speech API 录音转字，填进输入框，格式 =MM:SS|content=
const voiceState = { rec: null, startAt: 0, finalText: '', stopTimer: null, maxTimer: null, silenceTimer: null, stopping: false };

function setVoiceRecording(active) {
    const b = $('#btn-voice-input');
    b?.classList.toggle('recording', Boolean(active));
    b?.setAttribute('aria-label', active ? '停止语音输入' : '语音输入');
}

function finishVoiceInput(useCurrentInput = false) {
    if (voiceState.stopTimer) {
        clearTimeout(voiceState.stopTimer);
        voiceState.stopTimer = null;
    }
    if (voiceState.maxTimer) {
        clearTimeout(voiceState.maxTimer);
        voiceState.maxTimer = null;
    }
    if (voiceState.silenceTimer) {
        clearTimeout(voiceState.silenceTimer);
        voiceState.silenceTimer = null;
    }
    const rec = voiceState.rec;
    if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try { rec.abort?.(); } catch {}
    }
    const duration = Math.max(1, Math.round((Date.now() - voiceState.startAt) / 1000));
    const mm = String(Math.floor(duration / 60)).padStart(2, '0');
    const ss = String(duration % 60).padStart(2, '0');
    const input = $('#chat-input');
    const preview = input?.dataset.voicePreview ? input.value.trim() : '';
    const content = (voiceState.finalText.trim() || (useCurrentInput ? preview : '')).trim();
    if (input) {
        delete input.dataset.voicePreview;
        input.value = content ? `=${mm}:${ss}|${content}=` : '';
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    voiceState.rec = null;
    voiceState.startAt = 0;
    voiceState.finalText = '';
    voiceState.stopping = false;
    setVoiceRecording(false);
}

function toggleVoiceInput() {
    const btn = $('#btn-voice-input');
    if (btn?.classList.contains('recording')) {
        toast('已结束语音识别');
        finishVoiceInput(true);
        return;
    }
    if (!window.isSecureContext) {
        toast('手机语音需要 HTTPS 域名或 localhost，当前页面不是安全上下文');
        return;
    }
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
        toast('当前浏览器不支持语音识别，建议用 Chrome / Edge 或 Safari');
        return;
    }
    if (voiceState.rec) {
        if (voiceState.stopping) return;
        voiceState.stopping = true;
        finishVoiceInput(true);
        return;
    }
    const rec = new Rec();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    voiceState.rec = rec;
    voiceState.startAt = Date.now();
    voiceState.finalText = '';
    voiceState.stopping = false;
    voiceState.maxTimer = setTimeout(() => {
        toast('语音输入已到 60 秒上限');
        finishVoiceInput(true);
    }, 60000);
    voiceState.silenceTimer = setTimeout(() => {
        if (!voiceState.finalText.trim() && !$('#chat-input')?.dataset.voicePreview) {
            toast('没有收到语音识别结果，当前浏览器语音服务可能不可用');
            finishVoiceInput(true);
        }
    }, 10000);
    setVoiceRecording(true);
    toast('开始录音，再次点击麦克风结束');
    rec.onresult = (event) => {
        let finalPart = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) finalPart += r[0].transcript;
            else interim += r[0].transcript;
        }
        if (finalPart) voiceState.finalText += finalPart;
        const input = $('#chat-input');
        if (input) {
            const live = (voiceState.finalText + interim).trim();
            input.dataset.voicePreview = '1';
            input.value = live;
        }
        if ((voiceState.finalText + interim).trim() && voiceState.silenceTimer) {
            clearTimeout(voiceState.silenceTimer);
            voiceState.silenceTimer = null;
        }
    };
    rec.onerror = (e) => {
        const code = e.error || '未知错误';
        const messages = {
            'not-allowed': '麦克风权限被拒绝：请确认 HTTPS、浏览器麦克风权限，以及系统设置',
            'service-not-allowed': '浏览器禁用了语音识别服务，可换 Chrome / Safari 或检查系统权限',
            'audio-capture': '没有检测到可用麦克风',
            'network': '语音识别网络服务不可用',
            'no-speech': '没有识别到说话声'
        };
        toast(messages[code] || `语音识别失败：${code}`);
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'network') {
            finishVoiceInput(true);
        }
    };
    rec.onend = () => {
        finishVoiceInput(true);
    };
    try {
        rec.start();
    } catch (e) {
        toast('无法启动麦克风，请检查权限');
        rec.onend = null;
        if (voiceState.stopTimer) clearTimeout(voiceState.stopTimer);
        voiceState.stopTimer = null;
        if (voiceState.maxTimer) clearTimeout(voiceState.maxTimer);
        voiceState.maxTimer = null;
        if (voiceState.silenceTimer) clearTimeout(voiceState.silenceTimer);
        voiceState.silenceTimer = null;
        voiceState.rec = null;
        voiceState.stopping = false;
        setVoiceRecording(false);
    }
}

async function sendLinkCard() {
    if (!state.activeChatId) {
        toast('先选个聊天');
        return;
    }
    const url = await askQqText('粘贴链接', '');
    if (!url) return;
    const rawText = String(url).trim();
    const urlMatch = rawText.match(/https?:\/\/[^\s"'<>，。！？、；）)】\]]+/i);
    const trimmed = (urlMatch ? urlMatch[0] : rawText).replace(/[，。！？、；：:）)\]}]+$/g, '');
    if (!/^https?:\/\//i.test(trimmed)) {
        toast('请输入 http(s) 链接');
        return;
    }
    let data;
    try {
        const res = await fetch('/api/qq/link-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: trimmed, rawText })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = err?.error || `HTTP ${res.status}`;
            const cont = await askQqConfirm(`该链接无法预览（${msg}），是否仍然发送纯文本？`);
            if (cont) {
                await appendChatMessage({ role: 'user', type: 'text', text: trimmed, created_at: Date.now() });
            }
            return;
        }
        data = await res.json();
    } catch (e) {
        const cont = await askQqConfirm('该链接无法预览（抓取失败），是否仍然发送纯文本？');
        if (cont) {
            await appendChatMessage({ role: 'user', type: 'text', text: trimmed, created_at: Date.now() });
        }
        return;
    }
    await appendChatMessage({
        role: 'user',
        type: 'link',
        url: data.url || trimmed,
        title: data.title || '',
        description: data.description || '',
        image: data.image || '',
        siteName: data.siteName || '',
        text: `[链接] ${data.title || data.siteName || trimmed}`,
        created_at: Date.now()
    });
}

async function saveChat(chat) {
    const res = await fetch(`/api/qq/chats/${encodeURIComponent(chat.characterId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chat.messages || [] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();
    const idx = state.chats.findIndex(item => item.characterId === saved.characterId);
    if (idx >= 0) state.chats[idx] = saved;
    else state.chats.unshift(saved);
}

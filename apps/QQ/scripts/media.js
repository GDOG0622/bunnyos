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
    const clientImageId = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    state.imageAttachments[clientImageId] = { dataUrl: image, consumed: false, characterId: state.activeChatId };
    await appendChatMessage({
        role: 'user',
        type: 'image',
        text: '[图片]',
        image,
        client_image_id: clientImageId,
        created_at: Date.now()
    });
}

function openPopModal(id) {
    $(`#${id}`).classList.remove('hidden');
}

function closePopModal(id) {
    $(`#${id}`).classList.add('hidden');
}

async function sendTransfer() {
    if (!state.activeChatId) return;
    const amountStr = $('#transfer-amount').value.trim();
    if (!amountStr) {
        toast('请填写金额');
        return;
    }
    const amountNum = Number(amountStr);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
        toast('金额必须是正数');
        return;
    }
    const currency = $('#transfer-currency').value;
    const note = $('#transfer-note').value.trim();
    try {
        await adjustWallet(-amountNum, `transfer to ${state.activeChatId}`);
    } catch (err) {
        if (err.status === 402) {
            toast(`余额不足，当前 ${formatCC(err.balance)} cc`);
        } else {
            toast('扣款失败：' + (err.message || '未知错误'));
        }
        return;
    }
    await appendChatMessage({
        role: 'user',
        type: 'transfer',
        text: `转账 ${currency}${amountStr}${note ? ` ${note}` : ''}`,
        amount: amountStr,
        currency,
        note,
        status: 'pending',
        settled_at: null,
        created_at: Date.now()
    });
    $('#transfer-amount').value = '';
    $('#transfer-note').value = '';
    closePopModal('transfer-modal');
}

// STT：MediaRecorder 录音 → 直传 Groq / 硅基流动 → 回填 =MM:SS|content=
// 上次成功的服务商优先，配额/网络失败自动切对家；Key 无效不切（让用户去修）
const voiceState = { recorder: null, stream: null, chunks: [], startAt: 0, mime: '', stopping: false, maxTimer: null };

const ASR_PROVIDERS = {
    siliconflow: {
        label: '硅基流动',
        url: 'https://api.siliconflow.cn/v1/audio/transcriptions',
        model: 'FunAudioLLM/SenseVoiceSmall',
        keyField: 'asr_siliconflowKey',
    },
    groq: {
        label: 'Groq',
        url: 'https://api.groq.com/openai/v1/audio/transcriptions',
        model: 'whisper-large-v3-turbo',
        keyField: 'asr_groqKey',
    },
};

let voiceElapsedTimer = null;
function setVoiceRecording(active) {
    const b = $('#btn-voice-input');
    b?.classList.toggle('recording', Boolean(active));
    b?.setAttribute('aria-label', active ? '停止录音' : '语音输入');
    const banner = $('#voice-recording-banner');
    banner?.classList.toggle('hidden', !active);
    const elapsed = $('#voice-recording-elapsed');
    if (voiceElapsedTimer) { clearInterval(voiceElapsedTimer); voiceElapsedTimer = null; }
    if (active && elapsed) {
        const tick = () => {
            const s = Math.max(0, Math.round((Date.now() - voiceState.startAt) / 1000));
            elapsed.textContent = `${s}s`;
        };
        tick();
        voiceElapsedTimer = setInterval(tick, 500);
    } else if (elapsed) {
        elapsed.textContent = '0s';
    }
}

function pickRecorderMime() {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/ogg;codecs=opus',
    ];
    for (const m of candidates) {
        if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
    }
    return '';
}

async function getAsrSettings() {
    try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) return {};
        const s = await res.json();
        return {
            groqKey: (s.asr_groqKey || '').trim(),
            siliconflowKey: (s.asr_siliconflowKey || '').trim(),
            lastWorking: s.asr_lastWorking || 'siliconflow',
            raw: s,
        };
    } catch {
        return {};
    }
}

async function saveAsrLastWorking(name) {
    try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) return;
        const s = await res.json();
        if (s.asr_lastWorking === name) return;
        s.asr_lastWorking = name;
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(s),
        });
    } catch {}
}

async function callAsrProvider(name, key, blob, mime) {
    const cfg = ASR_PROVIDERS[name];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const form = new FormData();
    const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'bin';
    form.append('file', new File([blob], `audio.${ext}`, { type: mime }));
    form.append('model', cfg.model);
    let res;
    try {
        res = await fetch(cfg.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
            body: form,
            signal: ctrl.signal,
        });
    } catch (e) {
        clearTimeout(timer);
        const err = new Error(e?.name === 'AbortError' ? '请求超时' : '网络失败');
        err.kind = 'network';
        throw err;
    }
    clearTimeout(timer);
    if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch {}
        const err = new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0, 160) : ''}`);
        if (res.status === 401 || res.status === 403) err.kind = 'auth';
        else if (res.status === 429 || /quota|rate.?limit|insufficient|exceed/i.test(body)) err.kind = 'quota';
        else err.kind = 'http';
        throw err;
    }
    const data = await res.json().catch(() => ({}));
    return (data.text || '').trim();
}

async function transcribeWithFallback(blob, mime) {
    const cfg = await getAsrSettings();
    const all = [
        { name: 'siliconflow', key: cfg.siliconflowKey },
        { name: 'groq', key: cfg.groqKey },
    ].map(p => ({ ...p, label: ASR_PROVIDERS[p.name].label }));
    // 上次成功的优先
    all.sort((a, b) => (a.name === cfg.lastWorking ? -1 : b.name === cfg.lastWorking ? 1 : 0));
    const available = all.filter(p => p.key);
    if (!available.length) {
        toast('请先去 设置 - 语音 填入 Groq 或硅基流动的 API Key');
        return null;
    }
    let lastErr = null;
    for (let i = 0; i < available.length; i++) {
        const p = available[i];
        try {
            const text = await callAsrProvider(p.name, p.key, blob, mime);
            if (!text) {
                lastErr = new Error('识别结果为空');
                lastErr.kind = 'empty';
                if (i < available.length - 1) {
                    toast(`${p.label} 返回为空，切换到 ${available[i + 1].label}`);
                }
                continue;
            }
            if (p.name !== cfg.lastWorking) saveAsrLastWorking(p.name);
            return text;
        } catch (e) {
            lastErr = e;
            if (e.kind === 'auth') {
                toast(`${p.label} Key 无效，请到 设置 - 语音 重填`);
                return null;
            }
            if (i < available.length - 1) {
                const reason = e.kind === 'quota' ? '免费额度用完' : e.kind === 'network' ? '网络失败' : '请求失败';
                toast(`${p.label} ${reason}，切换到 ${available[i + 1].label}`);
            }
        }
    }
    toast(`语音识别失败：${lastErr?.message || '所有服务商均不可用'}`);
    return null;
}

async function startVoiceRecording() {
    if (!window.isSecureContext) {
        toast('需要 HTTPS 或 localhost 环境');
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        toast('当前浏览器不支持 MediaRecorder，请换 Chrome / Edge / Safari');
        return;
    }
    const cfg = await getAsrSettings();
    if (!cfg.groqKey && !cfg.siliconflowKey) {
        toast('请先去 设置 - 语音 填入 Groq 或硅基流动的 API Key');
        return;
    }
    const mime = pickRecorderMime();
    if (!mime) {
        toast('当前浏览器不支持任何可用的音频编码');
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        toast('麦克风权限被拒绝：' + (e?.message || e?.name || '失败'));
        return;
    }
    let recorder;
    try {
        recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch (e) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        toast('无法启动录音：' + (e?.message || e?.name || '失败'));
        return;
    }
    voiceState.recorder = recorder;
    voiceState.stream = stream;
    voiceState.chunks = [];
    voiceState.startAt = Date.now();
    voiceState.mime = mime;
    voiceState.stopping = false;
    recorder.ondataavailable = (e) => { if (e.data?.size) voiceState.chunks.push(e.data); };
    recorder.start();
    setVoiceRecording(true);
    toast('录音中，再点麦克风结束');
    voiceState.maxTimer = setTimeout(() => {
        if (voiceState.recorder) {
            toast('已到 60 秒上限，自动结束');
            stopVoiceRecording();
        }
    }, 60000);
}

async function stopVoiceRecording() {
    const rec = voiceState.recorder;
    const stream = voiceState.stream;
    const mime = voiceState.mime;
    const startAt = voiceState.startAt;
    if (!rec) return;
    if (voiceState.maxTimer) { clearTimeout(voiceState.maxTimer); voiceState.maxTimer = null; }
    voiceState.recorder = null;
    voiceState.stream = null;
    setVoiceRecording(false);
    const stopped = new Promise(resolve => {
        rec.addEventListener('stop', resolve, { once: true });
    });
    try { rec.stop(); } catch {}
    await stopped;
    try { stream?.getTracks?.().forEach(t => t.stop()); } catch {}
    const duration = Math.max(1, Math.round((Date.now() - startAt) / 1000));
    const mm = String(Math.floor(duration / 60)).padStart(2, '0');
    const ss = String(duration % 60).padStart(2, '0');
    const blob = new Blob(voiceState.chunks, { type: mime });
    voiceState.chunks = [];
    if (!blob.size) {
        toast('没录到声音');
        return;
    }
    toast('识别中...');
    const text = await transcribeWithFallback(blob, mime);
    if (!text) return;
    const input = $('#chat-input');
    if (input) {
        input.value = `=${mm}:${ss}|${text}=`;
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function toggleVoiceInput() {
    if (voiceState.recorder) {
        if (voiceState.stopping) return;
        voiceState.stopping = true;
        stopVoiceRecording().finally(() => { voiceState.stopping = false; });
        return;
    }
    startVoiceRecording();
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
    const cleanTitle = String(data.title || '').trim();
    const cleanDescription = String(data.description || '').trim().replace(/^预览受限：.*/, '');
    const linkTextParts = [cleanTitle, cleanDescription]
        .filter(Boolean)
        .filter((part, index, arr) => arr.indexOf(part) === index);
    await appendChatMessage({
        role: 'user',
        type: 'link',
        url: data.url || trimmed,
        title: cleanTitle,
        description: cleanDescription,
        image: data.image || '',
        siteName: data.siteName || '',
        text: `[链接] ${linkTextParts.join('：') || data.siteName || trimmed}`,
        created_at: Date.now()
    });
}

async function saveChat(chat) {
    const persistMessages = (chat.messages || []).map(message => {
        if (message?.type !== 'image') return message;
        const clean = { ...message, text: message.text || '[图片]' };
        delete clean.image;
        delete clean.client_image_id;
        return clean;
    });
    const res = await fetch(`/api/qq/chats/${encodeURIComponent(chat.characterId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: persistMessages }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();
    // 同步 server 端做的 transfer 状态更新（自动退回等），同时保留本地的 image dataURL
    const localMessages = chat.messages || [];
    let walletNeedsRefresh = false;
    const mergedMessages = (saved.messages || []).map((srvMsg, i) => {
        const local = localMessages[i] || {};
        if (srvMsg && srvMsg.type === 'transfer'
            && srvMsg.status === 'returned' && local.status === 'pending') {
            walletNeedsRefresh = true;
        }
        if (srvMsg?.type === 'image' && local.type === 'image' && local.image) {
            return { ...srvMsg, image: local.image, client_image_id: local.client_image_id };
        }
        return srvMsg;
    });
    chat.messages = mergedMessages;
    const idx = state.chats.findIndex(item => item.characterId === saved.characterId);
    const localChat = { ...saved, messages: mergedMessages };
    if (idx >= 0) state.chats[idx] = localChat;
    else state.chats.unshift(localChat);
    if (walletNeedsRefresh) {
        loadWalletBalance().catch(() => {});
        renderActiveChat();
    }
}

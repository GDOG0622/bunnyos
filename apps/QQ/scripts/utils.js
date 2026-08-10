function notifyNavState() {
    const isMobile = document.documentElement.dataset.appLayout !== 'desktop';
    const character = state.characters.find(c => c.id === state.activeChatId);
    const inChat = isMobile && !!state.activeChatId && !!character;
    window.parent?.postMessage({
        type: 'bunnyos:navigation-state',
        // 进对话（竖屏）：外层标题显示角色名，并隐藏外层返回栏，由 QQ 自带头栏当唯一头栏
        title: inChat ? (character.name || '聊天') : 'QQ',
        canGoBack: state.pageHistory.length > 1,
        hideChrome: inChat,
    }, '*');
}

function handleNavigateBack() {
    if (!$('#prompt-manager-modal')?.classList.contains('hidden')) {
        closePromptManager();
        return;
    }
    if (!$('#persona-modal')?.classList.contains('hidden')) {
        closePersonaModal();
        return;
    }
    if (!$('#account-modal')?.classList.contains('hidden')) {
        closeAccountModal();
        return;
    }
    if (!$('#friend-modal').classList.contains('hidden')) {
        closeFriendModal();
        return;
    }
    if (!$('#add-menu').classList.contains('hidden')) {
        hideAddMenu();
    }
}

function messageSummaryText(msg) {
    if (!msg) return '';
    if (msg.type === 'image') return '[图片]';
    if (msg.type === 'sticker') return `[${msg.text || '表情'}]`;
    if (msg.type === 'voice') {
        const voice = parseVoiceText(msg.text);
        return voice ? `[语音 ${voice.duration}] ${voice.content}` : '[语音]';
    }
    if (msg.type === 'transfer') {
        const amount = `${msg.currency || ''}${msg.amount || ''}`.trim();
        return `转账${amount ? ` ${amount}` : ''}${msg.note ? ` ${msg.note}` : ''}`;
    }
    if (msg.type === 'service') {
        const labels = { gift: '礼物', delivery: '外卖', ride: '打车' };
        return `[${labels[msg.serviceType] || '服务'}] ${msg.item || ''}${msg.price ? ` ¥${msg.price}` : ''}`.trim();
    }
    if (msg.type === 'link') {
        return `[${msg.previewType === 'product' ? '商品' : '链接'}] ${msg.title || msg.description || msg.siteName || msg.url || ''}`;
    }
    const voice = parseVoiceText(activeMessageText(msg));
    if (voice) return `[语音 ${voice.duration}] ${voice.content}`;
    return String(activeMessageText(msg) || '').replace(/\s+/g, ' ').slice(0, 80);
}

function summaryForCharacter(c) {
    return (c.role_setting || c.description || '').slice(0, 40);
}

function avatarHtml(src) {
    return src ? `<img src="${escapeAttr(src)}" alt="">` : DEFAULT_AVATAR_HTML;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
}

function parseVoiceText(text) {
    const m = String(text || '').trim().match(/^=([^|=\n]{1,16})\|([\s\S]*?)=$/);
    if (!m) return null;
    const duration = m[1].trim();
    const content = m[2].trim();
    if (!duration || !content) return null;
    return { duration, content };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const CHAT_LAYER_PAGE_SIZE = 20;

function chatLayerRange(chat) {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const layerByMessage = new Array(messages.length).fill(-1);
    let layer = -1;
    let previousRole = '';
    let previousAssistantGroup = '';
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message?.type === 'system') {
            layerByMessage[index] = layer;
            continue;
        }
        const role = message?.role === 'assistant' ? 'assistant' : 'user';
        const assistantGroup = role === 'assistant' ? String(message?.reply_group_id || '') : '';
        const assistantBoundary = role === 'assistant'
            && previousRole === 'assistant'
            && assistantGroup !== previousAssistantGroup
            && Boolean(assistantGroup || previousAssistantGroup);
        if (role !== previousRole || assistantBoundary) layer += 1;
        layerByMessage[index] = layer;
        previousRole = role;
        previousAssistantGroup = assistantGroup;
    }

    const totalLayers = layer + 1;
    state.chatVisibleLayers = state.chatVisibleLayers || {};
    const visibleLayers = Math.max(
        CHAT_LAYER_PAGE_SIZE,
        Number(state.chatVisibleLayers[chat?.characterId]) || CHAT_LAYER_PAGE_SIZE,
    );
    const firstVisibleLayer = Math.max(0, totalLayers - visibleLayers);
    let startIndex = 0;
    if (firstVisibleLayer > 0) {
        const found = layerByMessage.findIndex(value => value >= firstVisibleLayer);
        startIndex = found >= 0 ? found : 0;
    }
    return { startIndex, totalLayers, visibleLayers, hasMore: firstVisibleLayer > 0 };
}

function loadEarlierChatLayers() {
    const chat = state.chats.find(item => item.characterId === state.activeChatId);
    if (!chat?._messagesLoaded || state.loadingEarlierChatLayers) return;
    const range = chatLayerRange(chat);
    if (!range.hasMore) return;
    const box = $('#chat-messages');
    const previousHeight = box?.scrollHeight || 0;
    state.loadingEarlierChatLayers = true;
    state.chatVisibleLayers[chat.characterId] = range.visibleLayers + CHAT_LAYER_PAGE_SIZE;
    renderActiveChat({ preserveScroll: true, previousHeight });
    requestAnimationFrame(() => { state.loadingEarlierChatLayers = false; });
}

function renderChatLoadError(error) {
    const box = $('#chat-messages');
    if (!box) return;
    box.innerHTML = `<div class="qq-empty qq-empty-inline"><div class="qq-empty-title">聊天记录加载失败</div><div class="qq-empty-sub">${escapeHtml(error?.message || '请稍后重试')}</div></div>`;
}

function openQqDialog({ title = '确认', message = '', input = false, value = '', copyText = '' } = {}) {
    return new Promise(resolve => {
        const dialog = $('#qq-dialog');
        const titleEl = $('#qq-dialog-title');
        const messageEl = $('#qq-dialog-message');
        const inputEl = $('#qq-dialog-input');
        const ok = $('#qq-dialog-ok');
        const cancel = $('#qq-dialog-cancel');
        const copy = $('#qq-dialog-copy');
        titleEl.textContent = title;
        messageEl.textContent = message;
        inputEl.classList.toggle('hidden', !input);
        inputEl.value = value;
        copy?.classList.toggle('hidden', !copyText);
        dialog.classList.remove('hidden');
        setTimeout(() => {
            if (input) {
                inputEl.focus();
                inputEl.select();
            } else {
                ok.focus();
            }
        }, 0);

        const cleanup = (result) => {
            dialog.classList.add('hidden');
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            copy?.removeEventListener('click', onCopy);
            dialog.removeEventListener('keydown', onKeydown);
            resolve(result);
        };
        const onOk = () => cleanup(input ? inputEl.value : true);
        const onCancel = () => cleanup(input ? null : false);
        const onCopy = async () => {
            try {
                await navigator.clipboard.writeText(copyText);
                toast('报错详情已复制');
            } catch {
                toast('复制失败，请手动选择报错文字');
            }
        };
        const onKeydown = (event) => {
            if (event.key === 'Enter' && (!input || document.activeElement === inputEl)) onOk();
            if (event.key === 'Escape') onCancel();
        };

        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        copy?.addEventListener('click', onCopy);
        dialog.addEventListener('keydown', onKeydown);
    });
}

function askQqConfirm(message, title = '确认') {
    return openQqDialog({ title, message });
}

function askQqText(title, value = '') {
    return openQqDialog({ title, input: true, value });
}

let toastTimer = null;
function toast(msg) {
    const el = $('#qq-toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}

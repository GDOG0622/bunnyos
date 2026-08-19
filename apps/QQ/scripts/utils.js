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

const navigationFocusOrigins = new Map();

function pushNavigationLayer(key) {
    if (!key || state.pageHistory[state.pageHistory.length - 1] === key) return;
    navigationFocusOrigins.set(key, document.activeElement);
    state.pageHistory.push(key);
    notifyNavState();
    requestAnimationFrame(() => {
        const visibleDialog = [...document.querySelectorAll('[role="dialog"]:not(.hidden)')].pop();
        const focusable = visibleDialog?.querySelector('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        focusable?.focus({ preventScroll: true });
    });
}

function popNavigationLayer(key) {
    const index = state.pageHistory.lastIndexOf(key);
    if (index > 0) state.pageHistory.splice(index, 1);
    notifyNavState();
    const origin = navigationFocusOrigins.get(key);
    navigationFocusOrigins.delete(key);
    requestAnimationFrame(() => {
        if (origin?.isConnected) origin.focus({ preventScroll: true });
    });
}

function isLayerVisible(id) {
    const element = $(`#${id}`);
    return Boolean(element && !element.classList.contains('hidden'));
}

function handleNavigateBack() {
    if (isLayerVisible('qq-dialog')) {
        $('#qq-dialog-cancel')?.click();
        return;
    }
    if (isLayerVisible('beauty-editor')) {
        closeBeautyEditor(false);
        return;
    }
    if (isLayerVisible('prompt-preview-modal')) {
        closePromptPreview();
        return;
    }
    if (isLayerVisible('summary-review-modal')) {
        closeSummaryReview();
        return;
    }
    for (const id of ['service-modal', 'transfer-modal', 'system-msg-modal', 'sticker-modal']) {
        if (isLayerVisible(id)) {
            closePopModal(id);
            return;
        }
    }
    if (isLayerVisible('fav-list-modal')) {
        setFavSelectMode(false);
        $('#fav-list-modal')?.classList.add('hidden');
        popNavigationLayer('favorites');
        return;
    }
    if (isLayerVisible('chat-settings-modal')) {
        closeChatSettings();
        return;
    }
    if (isLayerVisible('wallet-modal')) {
        closeWalletModal();
        return;
    }
    if (isLayerVisible('beauty-modal')) {
        closeBeautyModal();
        return;
    }
    if (isLayerVisible('prompt-manager-modal')) {
        closePromptManager();
        return;
    }
    if (isLayerVisible('persona-modal')) {
        closePersonaModal();
        return;
    }
    if (isLayerVisible('account-modal')) {
        closeAccountModal();
        return;
    }
    if (isLayerVisible('friend-modal')) {
        closeFriendModal();
        return;
    }
    if (isLayerVisible('add-menu')) hideAddMenu();
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
    const characterId = state.activeChatId;
    box.innerHTML = `<div class="qq-empty qq-empty-inline"><div class="qq-empty-title">聊天记录加载失败</div><div class="qq-empty-sub">${escapeHtml(error?.message || '请稍后重试')}</div><button type="button" class="qq-retry-btn">重新加载</button></div>`;
    box.querySelector('.qq-retry-btn')?.addEventListener('click', () => activateChat(characterId));
}

function renderQqCoreLoadError(error) {
    const list = $('#chat-list');
    if (!list) return;
    list.querySelector('.qq-core-load-error')?.remove();
    $('#empty-chats')?.classList.add('hidden');
    const panel = document.createElement('div');
    panel.className = 'qq-empty qq-empty-inline qq-core-load-error';
    panel.innerHTML = `<div class="qq-empty-title">QQ 数据加载失败</div><div class="qq-empty-sub">${escapeHtml(error?.message || '请检查本地服务后重试')}</div><button type="button" class="qq-retry-btn">重新加载</button>`;
    panel.querySelector('.qq-retry-btn')?.addEventListener('click', () => loadData());
    list.appendChild(panel);
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
        pushNavigationLayer('qq-dialog');
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
            popNavigationLayer('qq-dialog');
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
            if (event.key === 'Enter' && (!input || document.activeElement === inputEl)) {
                event.preventDefault();
                event.stopPropagation();
                onOk();
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
            }
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

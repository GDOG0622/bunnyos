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
    if (msg.type === 'link') {
        return `[链接] ${msg.title || msg.description || msg.siteName || msg.url || ''}`;
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

function openQqDialog({ title = '确认', message = '', input = false, value = '' } = {}) {
    return new Promise(resolve => {
        const dialog = $('#qq-dialog');
        const titleEl = $('#qq-dialog-title');
        const messageEl = $('#qq-dialog-message');
        const inputEl = $('#qq-dialog-input');
        const ok = $('#qq-dialog-ok');
        const cancel = $('#qq-dialog-cancel');
        titleEl.textContent = title;
        messageEl.textContent = message;
        inputEl.classList.toggle('hidden', !input);
        inputEl.value = value;
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
            dialog.removeEventListener('keydown', onKeydown);
            resolve(result);
        };
        const onOk = () => cleanup(input ? inputEl.value : true);
        const onCancel = () => cleanup(input ? null : false);
        const onKeydown = (event) => {
            if (event.key === 'Enter' && (!input || document.activeElement === inputEl)) onOk();
            if (event.key === 'Escape') onCancel();
        };

        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
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

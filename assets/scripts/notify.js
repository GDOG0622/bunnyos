// 后台通知：横幅 + 提示音（前台体验） + Service Worker + Web Push（后台体验）
// iframe 通过 postMessage({type:'bunnyos:notify', kind, characterId, characterName, snippet, avatar, sourceAppId}) 通知父
(function () {
    const banner = document.getElementById('bunnyos-banner');
    const titleEl = document.getElementById('bunnyos-banner-title');
    const textEl = document.getElementById('bunnyos-banner-text');
    const avatarImg = document.getElementById('bunnyos-banner-avatar-img');
    const closeBtn = document.getElementById('bunnyos-banner-close');
    const audio = document.getElementById('bunnyos-notify-audio');

    let hideTimer = null;
    let currentTarget = null;
    let swRegistration = null;

    function getSettings() {
        return window.bunnyThemeSettings || {};
    }

    function isAppVisible(appId) {
        const win = document.getElementById('app-window');
        if (!win || !win.classList.contains('active')) return false;
        const ifr = document.querySelector('#iframe-pool iframe[data-app-id="' + appId + '"]');
        return ifr && ifr.style.display !== 'none';
    }

    function showBanner({ appId, characterId, characterName, snippet, avatar, kind }) {
        currentTarget = { appId, characterId };
        titleEl.textContent = characterName || (kind === 'fail' ? 'AI 回复中断' : 'AI 回复完成');
        textEl.textContent = snippet || (kind === 'fail' ? '请打开查看详情' : '');
        avatarImg.src = avatar || '';
        avatarImg.style.visibility = avatar ? 'visible' : 'hidden';
        banner.classList.remove('hidden');
        banner.classList.add('visible');
        banner.dataset.kind = kind || 'success';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hideBanner, 4500);
    }

    function hideBanner() {
        banner.classList.remove('visible');
        banner.classList.add('hidden');
        clearTimeout(hideTimer);
    }

    function playSound(kind) {
        const s = getSettings();
        if (s.notify_enabled === false) return;
        const url = kind === 'fail' ? s.notify_failSoundUrl : s.notify_successSoundUrl;
        if (!url) return;
        try {
            audio.src = url;
            audio.currentTime = 0;
            audio.play().catch(err => console.warn('[notify] sound play failed', err));
        } catch (err) {
            console.warn('[notify] sound error', err);
        }
    }

    // 来自 iframe（QQ）的前台通知：横幅 + 铃声。OS 系统通知由 SW + Web Push 负责
    window.bunnyosNotify = function (data) {
        const { kind, characterId, characterName, snippet, avatar, sourceAppId } = data || {};
        playSound(kind);
        if (!isAppVisible(sourceAppId)) {
            showBanner({ appId: sourceAppId, characterId, characterName, snippet, avatar, kind });
        }
    };

    banner.addEventListener('click', (event) => {
        if (event.target.closest('.bunnyos-banner-close')) return;
        if (!currentTarget) { hideBanner(); return; }
        hideBanner();
        window.bunnyosOpenAppAndFocusChat?.(currentTarget.appId, currentTarget.characterId);
    });
    closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        hideBanner();
    });

    window.bunnyosPreviewNotifySound = function (url) {
        if (!url) return Promise.reject(new Error('empty url'));
        try { audio.src = url; audio.currentTime = 0; return audio.play(); }
        catch (err) { return Promise.reject(err); }
    };

    // ============ Service Worker + Web Push ============
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return null;
        try {
            const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
            swRegistration = reg;
            return reg;
        } catch (err) {
            console.warn('[notify] SW register failed', err);
            return null;
        }
    }

    async function getPushSubscription() {
        const reg = swRegistration || await registerServiceWorker();
        if (!reg) return null;
        return await reg.pushManager.getSubscription();
    }

    async function subscribeWebPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            return { ok: false, error: '浏览器不支持 Web Push' };
        }
        if (Notification.permission !== 'granted') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') return { ok: false, error: '通知权限被拒绝' };
        }
        const reg = swRegistration || await registerServiceWorker();
        if (!reg) return { ok: false, error: 'Service Worker 注册失败' };
        try {
            const { publicKey } = await fetch('/api/notify/vapid-public-key').then(r => r.json());
            const existing = await reg.pushManager.getSubscription();
            const sub = existing || await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
            const json = sub.toJSON();
            await fetch('/api/notify/subscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: json })
            });
            return { ok: true, endpoint: json.endpoint };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    }

    async function unsubscribeWebPush() {
        try {
            const sub = await getPushSubscription();
            if (!sub) return { ok: true };
            const endpoint = sub.endpoint;
            await sub.unsubscribe();
            await fetch('/api/notify/unsubscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint })
            });
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async function getPushStatus() {
        const notifSupported = 'Notification' in window;
        const swSupported = 'serviceWorker' in navigator && 'PushManager' in window;
        const perm = notifSupported ? Notification.permission : 'unsupported';
        const sub = swSupported ? await getPushSubscription() : null;
        return { notifSupported, swSupported, perm, subscribed: !!sub };
    }

    window.bunnyosSubscribeWebPush = subscribeWebPush;
    window.bunnyosUnsubscribeWebPush = unsubscribeWebPush;
    window.bunnyosGetPushStatus = getPushStatus;
    window.bunnyosRequestNotifyPermission = async function () {
        if (!('Notification' in window)) return 'unsupported';
        if (Notification.permission === 'granted') return 'granted';
        if (Notification.permission === 'denied') return 'denied';
        try { return await Notification.requestPermission(); }
        catch { return 'denied'; }
    };
    window.bunnyosNotifyPermission = function () {
        return 'Notification' in window ? Notification.permission : 'unsupported';
    };

    // 启动时静默注册 SW（不申请权限、不订阅）
    registerServiceWorker();

    // SW 点击通知后的跳转消息
    navigator.serviceWorker?.addEventListener?.('message', (event) => {
        if (event.data?.type === 'bunnyos:open-from-push') {
            window.bunnyosOpenAppAndFocusChat?.(event.data.appId, event.data.characterId);
        }
    });

    // URL 参数 ?openApp=&characterId= 用于"OS 通知点击 → 新开窗口"路径
    try {
        const params = new URL(location.href).searchParams;
        const appId = params.get('openApp');
        const cid = params.get('characterId');
        if (appId) {
            setTimeout(() => window.bunnyosOpenAppAndFocusChat?.(appId, cid || ''), 800);
        }
    } catch {}
})();

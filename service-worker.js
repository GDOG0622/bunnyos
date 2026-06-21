// BunnyOS Service Worker —— PWA + Web Push 接收端
// 注册路径：/service-worker.js
// 作用域：/ （根域）

const SW_VERSION = 'bunnyos-sw-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// 接收后端的 web-push 消息
self.addEventListener('push', (event) => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text?.() || '' }; }
    const title = payload.title || 'BunnyOS';
    const body = payload.body || '';
    const data = {
        appId: payload.appId || 'QQ',
        characterId: payload.characterId || '',
        characterName: payload.characterName || ''
    };
    const options = {
        body,
        icon: payload.avatar || '/icon.png',
        badge: '/icon.png',
        tag: 'bunnyos-' + (data.characterId || 'notify'),
        renotify: true,
        data
    };

    // 若有焦点的 BunnyOS 客户端，则不弹 OS 通知（App 内自己有横幅 + 铃声处理）
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            const focused = clients.find(c => c.focused);
            if (focused) return; // 跳过 OS 通知
            return self.registration.showNotification(title, options);
        })
    );
});

// 点击通知：聚焦 / 打开 BunnyOS + 跳转该聊天
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    event.waitUntil(
        (async () => {
            const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            // 优先聚焦已有窗口
            for (const client of clients) {
                if (client.url.includes('/index.html') || client.url.endsWith('/')) {
                    await client.focus();
                    client.postMessage({ type: 'bunnyos:open-from-push', appId: data.appId, characterId: data.characterId });
                    return;
                }
            }
            // 没现成窗口，开一个新的
            const url = `/index.html?openApp=${encodeURIComponent(data.appId || 'QQ')}&characterId=${encodeURIComponent(data.characterId || '')}`;
            await self.clients.openWindow(url);
        })()
    );
});

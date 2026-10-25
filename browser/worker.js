const fs = require('./fs');
const seeds = require('bunnyos-browser-seeds');
const shellFiles = require('bunnyos-browser-assets');
const scope = new URL(self.registration.scope);
const cacheName = 'bunnyos-browser-' + encodeURIComponent(scope.pathname) + '-' + BROWSER_BUILD_ID;
const databaseName = 'bunnyos-browser:' + scope.pathname;
const nativeFetch = self.fetch.bind(self);
globalThis.bunnyBrowserReadAsset = async name => {
    if (!shellFiles.includes(name)) throw new Error('Unknown browser asset');
    const url = new URL(name, scope).href;
    return await (await caches.open(cacheName)).match(url) || nativeFetch(url, { credentials: 'omit' });
};
let starting;

// This fetch belongs to the local application engine (AI, MCP, image hosts).
// It must never send browser credentials or follow relative URLs to the private API.
globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('仅支持 HTTP(S) 接口');
    if (url.origin === scope.origin) throw new Error('网页版外部 API 地址不能指向本站的私人服务');
    try { return await nativeFetch(input, { ...options, credentials: 'omit' }); }
    catch (cause) {
        if (options.signal?.aborted) throw cause;
        throw new Error('无法连接接口：请检查网络、HTTPS 地址，以及接口是否允许浏览器跨域访问（CORS）。', { cause });
    }
};
async function start() {
    if (!starting) starting = (async () => {
        await fs.initialize(databaseName, seeds);
        const engine = require('../server');
        await fs.flush();
        return engine;
    })();
    return starting;
}
globalThis.bunnyBrowserNotify = async payload => {
    await fs.flush();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.postMessage({ type: 'bunnyos:browser-notify', payload });
    if (!clients.some(c => c.focused) && self.Notification?.permission === 'granted') {
        await self.registration.showNotification(payload.title || 'BunnyOS', {
            body: payload.body || '', icon: new URL('icon.png', scope).href,
            tag: payload.reminderId || payload.characterId || 'bunnyos', data: payload
        });
    }
    return { sent: clients.length, removed: 0 };
};
self.addEventListener('install', event => {
    // Do not replace an active worker: it may be finishing a chat or a save.
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shellFiles.map(file => new URL(file, scope).href))));
});
self.addEventListener('activate', event => event.waitUntil((async () => {
    await self.clients.claim();
    // Delete only this installation's obsolete shell caches, never user data.
    for (const key of await caches.keys()) {
        if (key.startsWith('bunnyos-browser-') && key !== cacheName) {
            const cache = await caches.open(key);
            if (await cache.match(new URL('desktop.html', scope).href)) await caches.delete(key);
        }
    }
})()));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const mediaTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };
function localPath(url) {
    return url.pathname.startsWith(scope.pathname) ? '/' + url.pathname.slice(scope.pathname.length) : url.pathname;
}
async function handle(request) {
    const url = new URL(request.url);
    if (url.origin !== scope.origin) return nativeFetch(request);
    const route = localPath(url);
    try {
        if (route.startsWith('/api/')) {
            if (route === '/api/proxy/catbox') {
                const target = new URL(url.searchParams.get('url'));
                if (target.protocol !== 'https:' || !['catbox.moe', 'files.catbox.moe', 'litterbox.catbox.moe'].includes(target.hostname)) return json({ error: '资源地址无效' }, 400);
                return nativeFetch(target.href, { mode: request.mode === 'no-cors' ? 'no-cors' : 'cors', credentials: 'omit' });
            }
            const engine = await start();
            fs.assertHealthy();
            if (route === '/api/runtime') {
                await engine.tickBrowser(); await fs.flush();
                return json({ mode: 'browser', storage: 'indexeddb', build: BROWSER_BUILD_ID, backgroundRequiresOpenPage: true });
            }
            if (route === '/api/notify/test') {
                if (self.Notification?.permission !== 'granted') return json({ error: '请先开启本设备通知权限。' }, 400);
                await self.registration.showNotification('BunnyOS', { body: '本设备通知测试成功。网页版提醒需要保留网页。', icon: new URL('icon.png', scope).href });
                return json({ sent: 1, removed: 0 });
            }
            if (route.startsWith('/api/admin/') || route.startsWith('/api/notify/')) return json({ error: '网页版使用本设备通知，不支持服务器更新或离线推送。' }, 409);
            if (/^\/api\/tools\/servers(?:\/[^/]+)?$/.test(route) && ['POST', 'PUT'].includes(request.method)) {
                const body = await request.clone().json();
                if (body.transport === 'stdio') return json({ error: '网页版支持 HTTP / SSE MCP；本机命令请使用自部署版。' }, 400);
            }
            const localUrl = new URL(route + url.search, scope.origin);
            const result = await engine.app.handle(new Request(localUrl, request));
            return result;
        }
        if (/^\/(data\/|assets\/(backgrounds|app-icons)\/)/.test(route)) {
            await start(); fs.assertHealthy();
            const decoded = decodeURIComponent(route);
            if (decoded.includes('..') || decoded.includes('\\')) return new Response('', { status: 404 });
            const type = mediaTypes[decoded.split('.').pop().toLowerCase()];
            if (!type || !/^\/(data\/(assets|qq\/(beauty-backgrounds|char-backgrounds))|assets\/(backgrounds|app-icons))\//.test(decoded)) return new Response('', { status: 404 });
            if (!fs.existsSync('/storage' + decoded)) return new Response('', { status: 404 });
            const buffer = fs.readFileSync('/storage' + decoded);
            return new Response(buffer, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } });
        }
        let asset = route.slice(1) || 'index.html';
        if (asset === 'app-icon') asset = 'icon.png';
        // Legacy UI links to /index.html must remain in the browser edition.
        if (request.mode === 'navigate' && !url.pathname.startsWith(scope.pathname)) {
            return Response.redirect(new URL((asset === 'index.html' ? 'desktop.html' : asset) + url.search, scope), 302);
        }
        const target = new URL(asset, scope).href;
        if (!shellFiles.includes(asset)) return new Response('Not found', { status: 404 });
        const cached = await (await caches.open(cacheName)).match(target);
        return cached || nativeFetch(target, { credentials: 'omit' });
    } catch (error) {
        console.error('[BunnyOS browser]', error);
        return json({ error: error.message, error_code: error.code }, error.statusCode || 500);
    }
}
self.addEventListener('fetch', event => {
    const result = handle(event.request);
    event.respondWith(result);
    event.waitUntil(result.then(() => fs.flush()).catch(() => {}));
});
self.addEventListener('message', event => {
    if (event.data?.type === 'bunnyos:keepalive') event.waitUntil(start().then(async engine => { await engine.tickBrowser(); await fs.flush(); }));
});
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const data = event.notification.data || {};
    event.waitUntil(self.clients.openWindow(new URL('desktop.html?openApp=' + encodeURIComponent(data.appId || 'QQ') + '&characterId=' + encodeURIComponent(data.characterId || ''), scope).href));
});

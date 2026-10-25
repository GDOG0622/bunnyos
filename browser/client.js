(() => {
    const base = new URL('./', document.currentScript.src);
    window.BunnyBrowser = { base: base.href };
    const nativeFetch = window.fetch.bind(window);
    const controlled = () => navigator.serviceWorker?.controller?.scriptURL === new URL('browser-sw.js', base).href;
    window.fetch = (input, options) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.origin === base.origin && /^\/(api|data)\//.test(url.pathname)) url.pathname = base.pathname + url.pathname.slice(1);
        if (url.origin === base.origin && url.pathname.startsWith(base.pathname + 'api/')) {
            if (!controlled()) return Promise.reject(new Error('本机存储尚未启动，请从网页版入口重新打开；不会连接服务器数据。'));
            input = input instanceof Request ? new Request(url, input) : url.href;
        }
        return nativeFetch(input, options);
    };
    // Local settings changes travel through the one active worker. Polling also
    // handles tab suspension and worker restarts without permanent SSE connections.
    class BrowserEvents extends EventTarget {
        static CLOSED = 2;
        readyState = 1;
        constructor(url) {
            super(); this.url = url; this.version = undefined;
            if (url === '/api/settings/events') {
                const poll = async () => {
                    if (this.readyState === 2) return;
                    try {
                        const res = await fetch('/api/settings'); const settings = await res.json();
                        if (!res.ok) throw new Error(settings.error);
                        if (this.version !== undefined && this.version !== settings._version) this.dispatchEvent(new MessageEvent('settings-updated', { data: JSON.stringify({ type: 'settings-updated' }) }));
                        this.version = settings._version;
                    } catch { this.onerror?.(new Event('error')); }
                };
                poll(); this.timer = setInterval(poll, 2500);
            }
        }
        close() { this.readyState = 2; clearInterval(this.timer); }
    }
    window.EventSource = BrowserEvents;
    if (window === window.top) {
        const heartbeat = () => navigator.serviceWorker?.controller?.postMessage({ type: 'bunnyos:keepalive' });
        setInterval(heartbeat, 15000); window.addEventListener('pageshow', heartbeat);
        navigator.serviceWorker?.addEventListener('message', event => {
            if (event.data?.type !== 'bunnyos:browser-notify') return;
            const p = event.data.payload;
            // Chat completion already has its normal UI notification.
            if (p.kind === 'reminder') window.bunnyosNotify?.({ kind: 'success', characterName: p.title, snippet: p.body, sourceAppId: 'tools', forceBanner: true });
        });
    }
    document.addEventListener('DOMContentLoaded', async () => {
        if (!controlled()) {
            const notice = document.createElement('div');
            notice.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#edf8f2;display:grid;place-content:center;padding:30px;font:16px system-ui';
            const link = document.createElement('a'); link.href = base.href; link.textContent = '点击这里，从 BunnyOS 网页版入口启动'; notice.append(link); document.body.append(notice);
            return;
        }
        const section = document.getElementById('browser-storage-section');
        if (section) {
            section.hidden = false;
            const status = document.getElementById('browser-storage-status');
            async function measure() {
                const estimate = await navigator.storage?.estimate();
                const persistent = await navigator.storage?.persisted();
                status.textContent = `${persistent ? '已获得持久存储权限' : '使用浏览器本机存储'}${estimate ? ' · 此站点约占 ' + (estimate.usage / 1048576).toFixed(1) + ' MB' : ''}。清除站点数据会删除存档，请定期备份。`;
            }
            measure().catch(() => {});
            document.getElementById('browser-persist').onclick = async () => { await navigator.storage?.persist(); await measure(); };
            document.getElementById('browser-export').onclick = async () => {
                try {
                    const res = await fetch('/api/storage/backup/export'); const backup = await res.json();
                    if (!res.ok) throw new Error(backup.error);
                    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
                    const link = document.createElement('a'); link.href = url; link.download = 'BunnyOS-' + new Date().toISOString().slice(0, 10) + '.json'; link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                } catch (error) { status.textContent = error.message; }
            };
            document.getElementById('browser-import').onchange = async event => {
                const file = event.target.files[0]; if (!file) return;
                if (!confirm('导入会替换当前浏览器存档，并保留恢复前的回滚快照。继续吗？')) return;
                try {
                    if (file.size > 150 * 1024 * 1024) throw new Error('备份文件过大');
                    const res = await fetch('/api/storage/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() });
                    const result = await res.json(); if (!res.ok) throw new Error(result.error);
                    window.top.location.reload();
                } catch (error) { status.textContent = error.message; }
                finally { event.target.value = ''; }
            };
        }
        const transport = document.querySelector('#server-transport option[value="stdio"]');
        if (transport) { transport.disabled = true; transport.textContent = '本机命令（仅自部署版）'; }
        const info = document.querySelector('#content');
        if (info && location.pathname.includes('/apps/tools/')) {
            const hint = document.createElement('p'); hint.className = 'muted';
            hint.textContent = '网页版工具直接连接你填写的 HTTP / SSE 服务，需要服务允许跨域访问。提醒需要保留网页，关闭后会在下次打开时检查。'; info.prepend(hint);
        }
    });
})();

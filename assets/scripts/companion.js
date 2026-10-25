(function () {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    let timer;
    function status(message, conflict = false) {
        const target = document.getElementById('status');
        target.textContent = message;
        clearTimeout(timer);
        if (conflict) {
            const button = document.createElement('button'); button.id = 'reload'; button.textContent = '重新加载';
            button.onclick = () => location.reload(); target.append(button);
        } else timer = setTimeout(() => { target.textContent = ''; }, 6000);
    }
    async function request(url, method = 'GET', body) {
        const response = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
        return data;
    }
    function handle(action, onSettled) { return async event => {
        event?.preventDefault(); const button = event?.submitter || event?.currentTarget;
        if (button && 'disabled' in button) button.disabled = true;
        try { await action(event); }
        catch (error) { status(error.message, error.status === 409); }
        finally {
            if (button && 'disabled' in button) button.disabled = false;
            onSettled?.();
        }
    }; }
    function openApp(id, characterId = '') {
        if (window.parent !== window && window.parent.bunnyosOpenAppAndFocusChat) window.parent.bunnyosOpenAppAndFocusChat(id, characterId);
        else location.href = `/index.html?openApp=${encodeURIComponent(id)}&characterId=${encodeURIComponent(characterId)}`;
    }
    window.BunnyApp = { escape, status, request, handle, openApp };
})();

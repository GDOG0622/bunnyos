(function () {
    const modal = document.getElementById('bunnyos-announcement');
    const title = document.getElementById('bunnyos-announcement-title');
    const list = document.getElementById('bunnyos-announcement-list');
    const close = document.getElementById('bunnyos-announcement-close');
    const backupLink = document.getElementById('bunnyos-announcement-backup');
    let currentVersion = '';

    function todayKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function dismiss() {
        localStorage.setItem('bunnyos:announcement-date', todayKey());
        if (currentVersion) localStorage.setItem('bunnyos:announcement-version', currentVersion);
        modal?.classList.add('hidden');
    }

    async function loadAnnouncement() {
        if (!modal) return;
        try {
            const response = await fetch('/assets/announcements.json', { cache: 'no-store' });
            const data = response.ok ? await response.json() : {};
            currentVersion = String(data.version || '');
            const seenToday = localStorage.getItem('bunnyos:announcement-date') === todayKey();
            const seenVersion = !currentVersion || localStorage.getItem('bunnyos:announcement-version') === currentVersion;
            if (seenToday && seenVersion) return;
            title.textContent = data.title || 'BunnyOS 公告';
            const items = Array.isArray(data.items) ? data.items : [];
            list.innerHTML = items.map(item => `<li>${escapeAnnouncementText(item)}</li>`).join('');
            modal.classList.remove('hidden');
        } catch (error) {
            console.warn('[announcement] load failed', error);
        }
    }

    function escapeAnnouncementText(value) {
        const div = document.createElement('div');
        div.textContent = String(value || '');
        return div.innerHTML;
    }

    close?.addEventListener('click', dismiss);
    modal?.addEventListener('click', event => {
        if (event.target === modal) dismiss();
    });
    backupLink?.addEventListener('click', () => {
        dismiss();
        window.bunnyosOpenSettingsPage?.('page-storage');
    });

    window.addEventListener('load', () => setTimeout(loadAnnouncement, 350));
})();

// 默认 App 清单。后端可用时会被 /api/apps 的扫描结果替换。
        const defaultApps = [
            { id: 'settings', name: '设置', entryUrl: 'apps/settings/index.html', icon: 'bi-gear-fill', bg: 'bg-settings', iconColor: '#8E8E93', order: 10 },
            { id: 'QQ', name: 'QQ', entryUrl: '', icon: 'bi-chat-dots-fill', bg: 'bg-qq', iconColor: '#12B7F5', order: 20 },
            { id: 'suki', name: 'Suki', entryUrl: '', icon: 'bi-suit-heart-fill', bg: 'bg-suki', iconColor: '#FF6B6B', order: 30 },
            { id: 'X', name: 'X', entryUrl: '', icon: 'bi-twitter-x', bg: 'bg-x', iconColor: '#000000', order: 40 }
        ];

        // 渲染桌面 App 图标
        const mobileDesktop = document.getElementById('mobile-desktop');
        let installedApps = [];
        window.installedApps = installedApps;

        function createAppItem(app) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'app-item';
            item.dataset.appId = app.id;
            item.classList.toggle('minimized', window.bunnyosMinimizedApps?.has(app.id));
            item.setAttribute('aria-label', `打开${app.name || app.id}`);
            item.addEventListener('click', () => openApp(app));

            const icon = document.createElement('div');
            const iconOverrides = window.bunnyThemeSettings?.appIconOverrides || {};
            const customIcon = iconOverrides[app.id] || iconOverrides[app.folder];
            icon.className = `app-icon ${customIcon ? 'custom-icon' : (app.bg || 'bg-settings')}`;
            if (customIcon) {
                const img = document.createElement('img');
                img.src = customIcon;
                img.alt = app.name || app.id;
                icon.appendChild(img);
            } else {
                icon.innerHTML = `<i class="bi ${app.icon || 'bi-app'}"></i>`;
            }

            const name = document.createElement('div');
            name.className = 'app-name';
            name.innerText = app.name || app.id;

            item.appendChild(icon);
            item.appendChild(name);

            return item;
        }

        function renderApps(apps) {
            installedApps = apps;
            window.installedApps = installedApps;
            mobileDesktop.innerHTML = '';

            apps.forEach(app => {
                mobileDesktop.appendChild(createAppItem(app));
            });
        }

        async function loadApps() {
            try {
                const res = await fetch('/api/apps');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const apps = await res.json();
                const resolvedApps = apps.length ? apps : defaultApps;
                renderApps(resolvedApps);
                schedulePrimaryAppPreload(resolvedApps);
            } catch (e) {
                console.warn('无法读取后端 App 清单，使用默认 App。', e);
                renderApps(defaultApps);
            }
        }

        function schedulePrimaryAppPreload(apps) {
            const primaryApp = apps.find(app => app.id === 'QQ' && app.entryUrl);
            if (!primaryApp || navigator.connection?.saveData) return;
            // QQ 是主 App：桌面图标渲染完就立即在后台建 iframe，不再等最长 1.8 秒的 idle 回调。
            // 用户很快点开时会复用同一个正在加载/已经加载完成的 iframe。
            setTimeout(() => window.bunnyosPreloadApp?.(primaryApp), 80);
        }

        window.renderApps = renderApps;


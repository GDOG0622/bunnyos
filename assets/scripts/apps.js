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
            const item = document.createElement('div');
            item.className = 'app-item';
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
                renderApps(apps.length ? apps : defaultApps);
            } catch (e) {
                console.warn('无法读取后端 App 清单，使用默认 App。', e);
                renderApps(defaultApps);
            }
        }

        window.renderApps = renderApps;


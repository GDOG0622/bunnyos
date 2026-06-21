// 窗口交互逻辑 —— iframe 池版本：每个 App 持久化一个 iframe，切换时只 hide 不卸载
        const appWindow = document.getElementById('app-window');
        const windowHeader = document.querySelector('.window-header');
        const iframePool = document.getElementById('iframe-pool');
        const controlHotzone = document.getElementById('control-hotzone');
        const desktopQuery = window.matchMedia('(min-width: 769px)');
        let activeAppState = { canGoBack: false };
        let hideControlsTimer = null;
        let layoutFrame = null;
        // appId → iframe element（DOM 中持久存在；关闭/切换只切显示）
        const iframes = new Map();
        // 按打开顺序排队，超 2 个时挤掉最早的
        const openOrder = [];
        const MAX_OPEN = 2;
        let activeAppId = '';
        let activeApp = null;

        function getActiveIframe() {
            return activeAppId ? iframes.get(activeAppId) : null;
        }

        function getIframeForApp(appId) {
            return iframes.get(appId) || null;
        }

        function getOrCreateIframe(app) {
            if (iframes.has(app.id)) return iframes.get(app.id);
            const iframe = document.createElement('iframe');
            iframe.dataset.appId = app.id;
            iframe.allow = 'microphone *; camera *; clipboard-read *; clipboard-write *';
            iframe.style.cssText = 'width:100%;height:100%;border:none;position:absolute;inset:0;display:none;';
            if (app.entryUrl) iframe.src = app.entryUrl;
            iframe.addEventListener('load', () => {
                if (iframe === getActiveIframe()) {
                    updateAppLayoutMode();
                    scheduleIframeThemeSync(iframe);
                } else {
                    // 非活跃 iframe 也需要主题（壁纸字体），但 layout 维持后台不刷
                    scheduleIframeThemeSync(iframe);
                }
            });
            iframePool.appendChild(iframe);
            iframes.set(app.id, iframe);
            return iframe;
        }

        function evictOldestIfNeeded(except) {
            while (openOrder.length > MAX_OPEN) {
                const oldest = openOrder.shift();
                if (oldest === except) {
                    // 当前要保留的，放回队首，继续看下一个
                    openOrder.unshift(oldest);
                    break;
                }
                const ifr = iframes.get(oldest);
                if (ifr) ifr.remove();
                iframes.delete(oldest);
            }
        }

        function trackOpen(appId) {
            const i = openOrder.indexOf(appId);
            if (i !== -1) openOrder.splice(i, 1);
            openOrder.push(appId);
            evictOldestIfNeeded(appId);
        }

        function resetWindowInlineStyles() {
            appWindow.style.left = '';
            appWindow.style.top = '';
            appWindow.style.width = '';
            appWindow.style.height = '';
            appWindow.style.maxWidth = '';
            appWindow.style.maxHeight = '';
            appWindow.style.transform = '';
        }

        function openApp(app) {
            resetWindowInlineStyles();
            const prefersPortraitWindow = app.id === 'prompt-manager';
            appWindow.classList.toggle('fullscreen', desktopQuery.matches && !prefersPortraitWindow);
            appWindow.classList.remove('show-controls');
            appWindow.classList.remove('chrome-hidden');
            appWindow.classList.toggle('portrait-default', desktopQuery.matches && prefersPortraitWindow);
            activeAppState = { canGoBack: false };

            const name = app.name || app.id;
            document.getElementById('window-title').innerText = name;
            document.getElementById('app-name-display').innerText = name;

            const contentIcon = document.getElementById('app-content-icon');
            contentIcon.className = `bi ${app.icon || 'bi-app'}`;
            contentIcon.style.color = app.iconColor || '#007AFF';

            const placeholder = document.getElementById('placeholder-ui');

            // 隐藏池里所有 iframe
            iframes.forEach(ifr => { ifr.style.display = 'none'; });

            if (app.entryUrl) {
                const iframe = getOrCreateIframe(app);
                iframe.style.display = 'block';
                iframePool.style.display = 'block';
                placeholder.style.display = 'none';
                trackOpen(app.id);
                activeAppId = app.id;
                activeApp = app;
            } else {
                iframePool.style.display = 'none';
                placeholder.style.display = 'flex';
                activeAppId = '';
                activeApp = app;
            }

            appWindow.classList.add('active');
            requestAnimationFrame(updateAppLayoutMode);
            const active = getActiveIframe();
            if (active) scheduleIframeThemeSync(active);
        }

        function closeApp() {
            appWindow.classList.remove('active');
            appWindow.classList.remove('fullscreen');
            appWindow.classList.remove('show-controls');
            appWindow.classList.remove('chrome-hidden');
            appWindow.classList.remove('portrait-default');
            activeAppState = { canGoBack: false };
            // 不卸载 iframe：让后台任务（如 AI 生成）跑完
            resetWindowInlineStyles();
        }

        function handleMobileBack() {
            const active = getActiveIframe();
            if (activeAppState.canGoBack && active) {
                active.contentWindow?.postMessage({ type: 'bunnyos:navigate-back' }, '*');
                return;
            }
            closeApp();
        }

        function toggleFullscreen() {
            if (!desktopQuery.matches) return;
            resetWindowInlineStyles();
            appWindow.classList.toggle('fullscreen');
            appWindow.classList.remove('show-controls');
            requestAnimationFrame(updateAppLayoutMode);
        }

        function startResize(event) {
            if (window.innerWidth <= 768 || appWindow.classList.contains('fullscreen')) return;

            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            const dir = event.currentTarget.dataset.resize;
            const startRect = appWindow.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const minWidth = 360;
            const minHeight = 320;
            let nextRect = null;
            let resizeFrame = null;

            appWindow.classList.add('resizing');
            appWindow.classList.remove('show-controls');
            appWindow.style.transform = 'none';
            appWindow.style.maxWidth = 'none';
            appWindow.style.maxHeight = 'none';
            appWindow.style.left = `${startRect.left}px`;
            appWindow.style.top = `${startRect.top}px`;
            appWindow.style.width = `${startRect.width}px`;
            appWindow.style.height = `${startRect.height}px`;

            function applyResize() {
                resizeFrame = null;
                if (!nextRect) return;
                appWindow.style.left = `${nextRect.left}px`;
                appWindow.style.top = `${nextRect.top}px`;
                appWindow.style.width = `${nextRect.width}px`;
                appWindow.style.height = `${nextRect.height}px`;
            }

            function onMove(moveEvent) {
                const clientX = moveEvent.clientX;
                const clientY = moveEvent.clientY;
                const dx = clientX - startX;
                const dy = clientY - startY;
                let left = startRect.left;
                let top = startRect.top;
                let width = startRect.width;
                let height = startRect.height;

                if (dir.includes('e')) width = startRect.width + dx;
                if (dir.includes('s')) height = startRect.height + dy;
                if (dir.includes('w')) {
                    width = startRect.width - dx;
                    left = startRect.left + dx;
                }
                if (dir.includes('n')) {
                    height = startRect.height - dy;
                    top = startRect.top + dy;
                }

                if (width < minWidth) {
                    if (dir.includes('w')) left -= minWidth - width;
                    width = minWidth;
                }
                if (height < minHeight) {
                    if (dir.includes('n')) top -= minHeight - height;
                    height = minHeight;
                }

                nextRect = { left, top, width, height };
                if (!resizeFrame) resizeFrame = requestAnimationFrame(applyResize);
            }

            function onUp() {
                if (resizeFrame) { cancelAnimationFrame(resizeFrame); applyResize(); }
                appWindow.classList.remove('resizing');
                requestAnimationFrame(updateAppLayoutMode);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            }

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        }

        document.querySelectorAll('[data-resize]').forEach(handle => {
            handle.addEventListener('pointerdown', startResize);
        });

        function startMove(event) {
            if (!desktopQuery.matches || appWindow.classList.contains('fullscreen')) return;
            if (event.target.closest('.mac-controls, .mobile-back')) return;

            event.preventDefault();
            windowHeader.setPointerCapture?.(event.pointerId);

            const startRect = appWindow.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            let nextPos = null;
            let moveFrame = null;

            appWindow.classList.add('resizing');
            appWindow.classList.remove('show-controls');
            appWindow.style.transform = 'none';
            appWindow.style.maxWidth = 'none';
            appWindow.style.maxHeight = 'none';
            appWindow.style.left = `${startRect.left}px`;
            appWindow.style.top = `${startRect.top}px`;
            appWindow.style.width = `${startRect.width}px`;
            appWindow.style.height = `${startRect.height}px`;

            function applyMove() {
                moveFrame = null;
                if (!nextPos) return;
                appWindow.style.left = `${nextPos.left}px`;
                appWindow.style.top = `${nextPos.top}px`;
            }

            function onMove(moveEvent) {
                const maxLeft = window.innerWidth - 80;
                const maxTop = window.innerHeight - 80;
                const left = Math.min(maxLeft, Math.max(0, startRect.left + moveEvent.clientX - startX));
                const top = Math.min(maxTop, Math.max(0, startRect.top + moveEvent.clientY - startY));
                nextPos = { left, top };
                if (!moveFrame) moveFrame = requestAnimationFrame(applyMove);
            }

            function onUp() {
                if (moveFrame) { cancelAnimationFrame(moveFrame); applyMove(); }
                appWindow.classList.remove('resizing');
                requestAnimationFrame(updateAppLayoutMode);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            }

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        }

        windowHeader.addEventListener('pointerdown', startMove);

        function syncWindowToViewport() {
            if (!appWindow.classList.contains('active')) return;
            resetWindowInlineStyles();
            if (desktopQuery.matches) {
                appWindow.classList.toggle('fullscreen', !appWindow.classList.contains('portrait-default'));
            } else {
                appWindow.classList.remove('fullscreen');
                appWindow.classList.remove('show-controls');
            }
            requestAnimationFrame(updateAppLayoutMode);
        }

        desktopQuery.addEventListener('change', syncWindowToViewport);

        function showWindowControls() {
            if (appWindow.classList.contains('fullscreen')) {
                clearTimeout(hideControlsTimer);
                appWindow.classList.add('show-controls');
            }
        }
        function scheduleHideWindowControls() {
            clearTimeout(hideControlsTimer);
            hideControlsTimer = setTimeout(() => appWindow.classList.remove('show-controls'), 180);
        }

        controlHotzone.addEventListener('mouseenter', showWindowControls);
        controlHotzone.addEventListener('mousemove', showWindowControls);
        controlHotzone.addEventListener('mouseleave', scheduleHideWindowControls);
        windowHeader.addEventListener('mouseenter', showWindowControls);
        windowHeader.addEventListener('mouseleave', scheduleHideWindowControls);

        window.addEventListener('mouseleave', () => {
            if (appWindow.classList.contains('fullscreen')) appWindow.classList.remove('show-controls');
        });

        function updateAppLayoutMode() {
            if (appWindow.classList.contains('resizing')) return;
            if (layoutFrame) return;
            layoutFrame = requestAnimationFrame(() => {
                layoutFrame = null;
                const rect = appWindow.getBoundingClientRect();
                const layout = rect.width < rect.height ? 'mobile' : 'desktop';
                appWindow.dataset.appLayout = layout;
                const active = getActiveIframe();
                if (!active) return;
                try {
                    if (active.contentDocument?.documentElement) {
                        active.contentDocument.documentElement.dataset.appLayout = layout;
                    }
                } catch (e) { /* 跨域忽略 */ }
            });
        }

        function scheduleIframeThemeSync(iframe, attempt = 0) {
            if (!iframe || iframe.style.display === 'none') {
                // 后台 iframe 也试着同步主题，但不强制
                if (!iframe) return;
            }
            window.setTimeout(() => {
                window.applyThemeToIframe?.(iframe);
                if (attempt < 5) scheduleIframeThemeSync(iframe, attempt + 1);
            }, attempt === 0 ? 0 : 180);
        }

        // 主题变化时刷所有 iframe
        function syncThemeToAllIframes() {
            iframes.forEach(ifr => scheduleIframeThemeSync(ifr));
        }
        window.bunnyosSyncThemeToAllIframes = syncThemeToAllIframes;

        new ResizeObserver(updateAppLayoutMode).observe(appWindow);

        // 来自任意 pool iframe 的消息
        window.addEventListener('message', event => {
            // 找出消息来源是哪个 iframe
            let sourceAppId = '';
            for (const [appId, ifr] of iframes) {
                if (event.source === ifr.contentWindow) { sourceAppId = appId; break; }
            }
            const data = event.data;
            if (!data || typeof data !== 'object') return;

            // 后台通知：来自任意 iframe 都触发
            if (data.type === 'bunnyos:notify' && sourceAppId) {
                window.bunnyosNotify?.({ ...data, sourceAppId });
                return;
            }

            // 以下仅对活跃 iframe 处理
            if (!sourceAppId || sourceAppId !== activeAppId) return;

            if (data.type === 'bunnyos:theme-updated') {
                window.applyThemeSettings?.(data.settings || {});
                return;
            }
            if (data.type !== 'bunnyos:navigation-state') return;
            activeAppState = { canGoBack: Boolean(data.canGoBack) };
            if (data.title) document.getElementById('window-title').innerText = data.title;
            appWindow.classList.toggle('chrome-hidden', Boolean(data.hideChrome));
        });

        // 外部（横幅）调用：跳到指定 App 并向其转发 open-chat
        window.bunnyosOpenAppAndFocusChat = async function(appId, characterId) {
            // 找 manifest
            try {
                const apps = await fetch('/api/apps').then(r => r.json());
                const app = apps.find(a => a.id === appId);
                if (!app) return;
                openApp(app);
                const ifr = getIframeForApp(appId);
                const send = () => ifr?.contentWindow?.postMessage({ type: 'bunnyos:open-chat', characterId }, '*');
                // 若 iframe 刚加载完未必接到，延迟重试
                send();
                setTimeout(send, 400);
            } catch (e) { console.error(e); }
        };

        window.bunnyosRequestMicrophonePermission = async function() {
            if (!window.isSecureContext) {
                return { ok: false, error: '麦克风权限需要 HTTPS 域名或 localhost。' };
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                return { ok: false, error: '当前浏览器不支持麦克风权限申请。' };
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e?.message || e?.name || '未知错误' };
            }
        };

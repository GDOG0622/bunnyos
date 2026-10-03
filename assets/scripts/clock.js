// 时钟同步
        function updateTime() {
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            
            document.getElementById('mobile-time').innerText = `${h}:${m}`;
            document.getElementById('mac-time').innerText = `${days[now.getDay()]} ${h}:${m}`;
        }
        async function bootDesktop() {
            updateTime();
            const bootScreen = document.getElementById('boot-screen');
            const bootMessage = document.getElementById('boot-message');
            const bootActions = document.getElementById('boot-actions');
            const retryButton = document.getElementById('boot-retry');
            const enterButton = document.getElementById('boot-enter');
            let qqApp = null;
            let qqIframe = null;

            function setMessage(message) {
                bootMessage.textContent = message;
            }
            function enterDesktop() {
                bootScreen.classList.add('is-ready');
                bootScreen.setAttribute('aria-hidden', 'true');
            }
            function waitForQq(reload = false) {
                return new Promise((resolve, reject) => {
                    const timer = setTimeout(() => finish(new Error('QQ 加载超时，请检查网络后重试')), 20000);
                    function onMessage(event) {
                        if (event.origin !== location.origin || event.source !== qqIframe?.contentWindow) return;
                        if (event.data?.type === 'bunnyos:qq-core-ready') finish();
                        if (event.data?.type === 'bunnyos:qq-core-error') finish(new Error(event.data.message || 'QQ 数据加载失败'));
                    }
                    function finish(error) {
                        clearTimeout(timer);
                        window.removeEventListener('message', onMessage);
                        if (error) reject(error);
                        else resolve();
                    }
                    window.addEventListener('message', onMessage);
                    qqIframe = window.bunnyosPreloadApp?.(qqApp);
                    if (!qqIframe) {
                        finish(new Error('QQ 页面无法加载'));
                    } else if (reload) {
                        qqIframe.src = qqApp.entryUrl;
                    } else {
                        try {
                            if (qqIframe.contentWindow?.bunnyosQqCoreReady) finish();
                        } catch (error) { /* 跨域 App 不读取内部状态 */ }
                    }
                });
            }
            async function start(retry = false) {
                retryButton.disabled = true;
                bootActions.hidden = true;
                bootScreen.classList.remove('has-error');
                try {
                    if (!retry || !qqApp) {
                        setMessage('正在读取桌面设置…');
                        const settings = await window.loadThemeSettings?.();
                        if (!settings) throw new Error('无法读取桌面设置');
                        setMessage('正在准备桌面…');
                        const apps = await loadApps();
                        if (!apps) throw new Error('无法读取 App 列表');
                        qqApp = apps.find(app => app.id === 'QQ' && app.entryUrl);
                        if (!qqApp) throw new Error('QQ App 未安装或缺少入口');
                    }
                    setMessage('正在读取 QQ 联系人和聊天摘要…');
                    await waitForQq(retry && Boolean(qqIframe));
                    enterDesktop();
                } catch (error) {
                    console.warn('[boot] core load failed', error);
                    setMessage(`${error.message}。加载失败不代表记录丢失，可以重试。`);
                    bootScreen.classList.add('has-error');
                    bootActions.hidden = false;
                    retryButton.disabled = false;
                }
            }

            retryButton.addEventListener('click', () => start(true));
            enterButton.addEventListener('click', enterDesktop);
            await start();
        }

        setInterval(updateTime, 1000);
        bootDesktop();


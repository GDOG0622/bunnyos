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
            if (window.loadThemeSettings) {
                await window.loadThemeSettings();
            }
            loadApps();
        }

        setInterval(updateTime, 1000);
        bootDesktop();


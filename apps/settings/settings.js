let settings = {};
        let settingsVersion = 0;
        let settingsReloading = false;
        let settingsApps = [];
        let presets = {};
        
        // --- 页面导航逻辑 ---
        let pageHistory = ['page-main'];
        const pageTitles = {
            'page-main': '设置',
            'page-api': '设置 / 通用 API',
            'page-beauty': '设置 / 美化',
            'page-image': '设置 / 生图功能',
            'page-voice': '设置 / 语音功能',
            'page-storage': '设置 / 存储配置',
            'page-about': '设置 / 关于系统'
        };

        function notifyNavigationState() {
            const currentPageId = pageHistory[pageHistory.length - 1];
            window.parent?.postMessage({
                type: 'bunnyos:navigation-state',
                title: pageTitles[currentPageId] || '设置',
                canGoBack: pageHistory.length > 1
            }, '*');
        }

        function navTo(pageId) {
            const newPage = document.getElementById(pageId);
            if (!newPage) return;

            // 获取当前页面并将其推到左侧隐藏
            const currentPageId = pageHistory[pageHistory.length - 1];
            const currentPage = document.getElementById(currentPageId);
            
            currentPage.style.transform = 'translateX(-100%)';
            currentPage.classList.remove('active');

            // 修复：进入新页面前确保它在右侧就绪
            newPage.style.transition = 'none';
            newPage.style.transform = 'translateX(100%)';
            newPage.classList.remove('active');

            // 强制渲染帧，以便浏览器应用上一步的无动画位移
            void newPage.offsetWidth; 

            // 恢复动画并滑入
            newPage.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
            newPage.classList.add('active');
            newPage.style.transform = ''; // 清除内联以便走CSS里的active状态(translateX(0))

            pageHistory.push(pageId);
            notifyNavigationState();
            if (pageId === 'page-storage') { refreshImageCacheStats(); loadImageHostConfig(); }
        }

        function navBack() {
            if (pageHistory.length <= 1) {
                notifyNavigationState();
                return false;
            }

            const currentPageId = pageHistory.pop();
            const currentPage = document.getElementById(currentPageId);

            const prevPageId = pageHistory[pageHistory.length - 1];
            const prevPage = document.getElementById(prevPageId);

            // 当前页面向右滑出
            currentPage.classList.remove('active');
            currentPage.style.transform = 'translateX(100%)'; 

            // 上一个页面从左滑回到视窗中心
            prevPage.style.transform = 'translateX(0)';
            setTimeout(() => {
                prevPage.classList.add('active');
                prevPage.style.transform = '';
            }, 50); 

            notifyNavigationState();
            return true;
        }

        window.addEventListener('message', event => {
            if (event.data?.type === 'bunnyos:navigate-back') {
                navBack();
            }
        });

        // 动态切换服务商显示面板
        function toggleVendor(type) {
            const selector = document.getElementById(type + '_vendor');
            if(!selector) return;
            const selectedVal = selector.value;
            
            // 隐藏该类型下所有的 provider boxes
            const allBlocks = document.querySelectorAll(`[id^="vendor_${type}_"]`);
            allBlocks.forEach(block => block.style.display = 'none');
            
            // 显示选中的
            const targetBlock = document.getElementById(`vendor_${type}_${selectedVal}`);
            if(targetBlock) targetBlock.style.display = 'block';
        }

        function getApiConfigs() {
            if (!settings.apiConfigs || typeof settings.apiConfigs !== 'object' || Array.isArray(settings.apiConfigs)) {
                settings.apiConfigs = {};
            }
            return settings.apiConfigs;
        }

        function getBeautyPresets(type) {
            if (!settings.beautyPresets || typeof settings.beautyPresets !== 'object' || Array.isArray(settings.beautyPresets)) {
                settings.beautyPresets = {};
            }
            if (!settings.beautyPresets[type] || typeof settings.beautyPresets[type] !== 'object' || Array.isArray(settings.beautyPresets[type])) {
                settings.beautyPresets[type] = {};
            }
            return settings.beautyPresets[type];
        }

        function getAppIconOverrides() {
            if (!settings.appIconOverrides || typeof settings.appIconOverrides !== 'object' || Array.isArray(settings.appIconOverrides)) {
                settings.appIconOverrides = {};
            }
            return settings.appIconOverrides;
        }

        function notifyThemeUpdated() {
            window.parent?.postMessage({ type: 'bunnyos:theme-updated', settings }, '*');
        }

        function applySettingsToForm() {
            renderApiConfigSelects();
            renderBeautyPresetSelects();

            const elements = document.querySelectorAll('input, textarea, select');
            elements.forEach(el => {
                if (el.type === 'file') return;
                if (el.type === 'checkbox') {
                    if (settings[el.id] !== undefined) {
                        el.checked = Boolean(settings[el.id]);
                    }
                    return;
                }
                if (el.tagName === 'SELECT' && settings[el.id]) {
                    const hasOption = Array.from(el.options).some(opt => opt.value === settings[el.id]);
                    if (!hasOption) {
                        const opt = document.createElement('option');
                        opt.value = settings[el.id];
                        opt.textContent = settings[el.id];
                        el.appendChild(opt);
                    }
                }
                if (settings[el.id] !== undefined) {
                    el.value = settings[el.id];
                }
            });

            toggleVendor('voice');
            toggleVendor('image');
            syncAllRangeValues();
            loadApiConfigToEditor();
            renderWallpaperPreviews();
            renderIconGrid();
        }

        async function reloadSettingsIfChanged(force = false) {
            if (settingsReloading) return false;
            settingsReloading = true;
            try {
                const res = await fetch('/api/settings', { cache: 'no-store' });
                if (!res.ok) return false;
                const next = await res.json();
                const nextVersion = Number(next?._updatedAt || 0);
                if (!force && nextVersion && settingsVersion && nextVersion === settingsVersion) return false;
                settings = next || {};
                settingsVersion = Number(settings._updatedAt || Date.now());
                applySettingsToForm();
                notifyThemeUpdated();
                return true;
            } catch (e) {
                console.warn('同步设置失败', e);
                return false;
            } finally {
                settingsReloading = false;
            }
        }

        function readFileAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        async function uploadAsset(payload) {
            const res = await fetch('/api/assets/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '上传失败');
            }
            return data.path;
        }

        function renderWallpaperPreviews() {
            ['portrait', 'landscape'].forEach(type => {
                const id = type === 'portrait' ? 'beauty_portraitWallpaper' : 'beauty_landscapeWallpaper';
                const pick = document.getElementById(`${id}Pick`);
                const value = document.getElementById(id)?.value || settings[id] || "";
                const previewPath = normalizeWallpaperPath(value, type);
                if (!pick) return;

                pick.classList.toggle('has-image', Boolean(previewPath));
                pick.style.backgroundImage = previewPath ? `url("${previewPath}")` : "";
                pick.innerHTML = previewPath
                    ? ""
                    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
            });
        }

        function normalizeWallpaperPath(value, type) {
            if (value && value !== 'custom' && value !== 'default') return value;
            return type === 'portrait'
                ? '/assets/backgrounds/thin-back.png'
                : '/assets/backgrounds/wide-back.png';
        }

        function renderIconGrid() {
            const grid = document.getElementById('beauty_iconGrid');
            if (!grid) return;

            const overrides = getAppIconOverrides();
            grid.innerHTML = '';
            settingsApps.forEach(app => {
                const appId = app.id || app.folder;
                const tile = document.createElement('div');
                tile.className = 'app-icon-tile';

                const button = document.createElement('button');
                button.className = 'app-icon-pick';
                button.type = 'button';
                button.title = `上传 ${app.name || appId} 图标`;
                button.dataset.appId = appId;
                button.onclick = () => {
                    const input = document.getElementById('beauty_appIconUpload');
                    input.dataset.appId = appId;
                    input.value = '';
                    input.click();
                };

                if (overrides[appId]) {
                    const img = document.createElement('img');
                    img.src = overrides[appId];
                    img.alt = app.name || appId;
                    button.appendChild(img);
                } else {
                    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
                }

                const label = document.createElement('div');
                label.className = 'app-icon-label';
                label.textContent = app.name || appId;

                tile.appendChild(button);
                tile.appendChild(label);
                grid.appendChild(tile);
            });
        }

        async function loadBeautyApps() {
            try {
                const res = await fetch('/api/apps');
                settingsApps = res.ok ? await res.json() : [];
            } catch (e) {
                settingsApps = [];
            }
            renderIconGrid();
        }

        function buildModelsUrl(urlStr) {
            if (!urlStr) return "";
            let url = urlStr.trim();
            if (!url) return "";
            if (url.endsWith('/models')) return url;
            if (!url.endsWith('/')) url += '/';
            return url.endsWith('v1/') ? `${url}models` : `${url}models`;
        }

        function renderApiConfigSelects() {
            const configs = getApiConfigs();
            const names = Object.keys(configs).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
            ['apiConfig_select', 'mainApi_config', 'subApi_config'].forEach(id => {
                const select = document.getElementById(id);
                if (!select) return;

                const current = settings[id] || select.value;
                select.innerHTML = '<option value="">--未选择--</option>';
                names.forEach(name => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    select.appendChild(option);
                });
                select.value = configs[current] ? current : "";
            });
        }

        function renderBeautyPresetSelects() {
            ['icon', 'font'].forEach(type => {
                const select = document.getElementById(`beauty_${type}Preset`);
                if (!select) return;
                const presets = getBeautyPresets(type);
                const current = settings[`beauty_${type}Preset`] || select.value;
                select.innerHTML = '<option value="">--未选择--</option>';
                Object.keys(presets).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).forEach(name => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    select.appendChild(option);
                });
                select.value = presets[current] ? current : "";
            });
        }

        async function saveBeautyPreset(type) {
            const select = document.getElementById(`beauty_${type}Preset`);
            const currentName = select?.value || "";
            const name = prompt("请输入配置名称", currentName || "");
            if (!name || !name.trim()) return;

            const cleanName = name.trim();
            const presets = getBeautyPresets(type);
            presets[cleanName] = type === 'font'
                ? {
                    url: document.getElementById('beauty_fontUrl').value.trim(),
                    size: document.getElementById('beauty_fontSize').value.trim(),
                    weight: document.getElementById('beauty_fontWeight').value.trim()
                }
                : { appIconOverrides: { ...getAppIconOverrides() } };

            settings[`beauty_${type}Preset`] = cleanName;
            renderBeautyPresetSelects();
            document.getElementById(`beauty_${type}Preset`).value = cleanName;
            await saveData();
        }

        async function applyBeautyPreset(type) {
            const name = document.getElementById(`beauty_${type}Preset`)?.value || "";
            const preset = getBeautyPresets(type)[name];
            if (!preset) {
                alert("请先选择一个配置");
                return;
            }

            if (type === 'font') {
                document.getElementById('beauty_fontUrl').value = preset.url || "";
                document.getElementById('beauty_fontSize').value = preset.size || "";
                document.getElementById('beauty_fontWeight').value = preset.weight || "";
            } else {
                settings.appIconOverrides = { ...(preset.appIconOverrides || {}) };
                renderIconGrid();
            }

            await saveData();
        }

        async function renameBeautyPreset(type) {
            const select = document.getElementById(`beauty_${type}Preset`);
            const oldName = select?.value || "";
            const presets = getBeautyPresets(type);
            if (!presets[oldName]) {
                alert("请先选择一个配置");
                return;
            }

            const newName = prompt("请输入新的配置名称", oldName);
            if (!newName || !newName.trim()) return;
            const cleanName = newName.trim();
            presets[cleanName] = presets[oldName];
            if (cleanName !== oldName) delete presets[oldName];
            settings[`beauty_${type}Preset`] = cleanName;
            renderBeautyPresetSelects();
            select.value = cleanName;
            await saveData();
        }

        async function deleteBeautyPreset(type) {
            const select = document.getElementById(`beauty_${type}Preset`);
            const name = select?.value || "";
            const presets = getBeautyPresets(type);
            if (!presets[name]) {
                alert("请先选择一个配置");
                return;
            }
            if (!confirm(`删除配置「${name}」？`)) return;

            delete presets[name];
            settings[`beauty_${type}Preset`] = "";
            renderBeautyPresetSelects();
            await saveData();
        }

        async function handleWallpaperUpload(type, input) {
            try {
                const file = input.files?.[0];
                if (!file) return;
                const targetId = type === 'portrait' ? 'beauty_portraitWallpaper' : 'beauty_landscapeWallpaper';
                const dataUrl = await readFileAsDataUrl(file);
                document.getElementById(targetId).value = await uploadAsset({
                    type: 'background',
                    slot: type,
                    dataUrl
                });
                renderWallpaperPreviews();
                await saveData();
            } catch (error) {
                alert(`壁纸上传失败：${error.message}`);
            }
        }

        async function handleAppIconUpload(input) {
            try {
                const file = input.files?.[0];
                const appId = input.dataset.appId;
                if (!file || !appId) return;
                const dataUrl = await readFileAsDataUrl(file);
                getAppIconOverrides()[appId] = await uploadAsset({
                    type: 'app-icon',
                    appId,
                    dataUrl
                });
                renderIconGrid();
                await saveData();
            } catch (error) {
                alert(`图标上传失败：${error.message}`);
            }
        }

        // ===== 图床配置 =====
        async function loadImageHostConfig() {
            try {
                const res = await fetch('/api/settings');
                if (!res.ok) return;
                const all = await res.json();
                const host = all.imageHost || {};
                const sel = document.getElementById('imageHost_primary');
                if (sel) sel.value = host.primary || 'catbox';
                const c = host.custom || {};
                const e = document.getElementById('imageHost_custom_endpoint');
                const k = document.getElementById('imageHost_custom_key');
                const ff = document.getElementById('imageHost_custom_fileField');
                const uf = document.getElementById('imageHost_custom_urlField');
                if (e) e.value = c.endpoint || '';
                if (k) k.value = c.key || '';
                if (ff) ff.value = c.fileField || '';
                if (uf) uf.value = c.urlField || '';
            } catch {}
        }

        async function saveImageHostConfig() {
            const sel = document.getElementById('imageHost_primary');
            const e = document.getElementById('imageHost_custom_endpoint');
            const k = document.getElementById('imageHost_custom_key');
            const ff = document.getElementById('imageHost_custom_fileField');
            const uf = document.getElementById('imageHost_custom_urlField');
            const imageHost = {
                primary: sel?.value || 'catbox',
                custom: {
                    endpoint: e?.value?.trim() || '',
                    key: k?.value?.trim() || '',
                    fileField: ff?.value?.trim() || '',
                    urlField: uf?.value?.trim() || '',
                }
            };
            try {
                // 读现有 settings 合并写回（保留 lastWorking 等字段）
                const cur = await fetch('/api/settings').then(r => r.ok ? r.json() : {});
                const merged = { ...cur, imageHost: { ...(cur.imageHost || {}), ...imageHost } };
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(merged)
                });
            } catch (err) {
                console.warn('saveImageHostConfig failed', err);
            }
        }

        // ===== 缓存管理 =====
        // IndexedDB 数据库由 QQ App (image-cache.js) 创建；这里只读取统计、清空
        function openQqImgDbReadonly() {
            return new Promise((resolve) => {
                const req = indexedDB.open('bunnyos-qq', 1);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
                req.onupgradeneeded = () => {
                    // 如果 DB 不存在，避免在这里创建 schema 污染
                    try { req.transaction.abort(); } catch {}
                    resolve(null);
                };
            });
        }

        async function refreshImageCacheStats() {
            const el = document.getElementById('cache_image_stats');
            if (!el) return;
            try {
                const db = await openQqImgDbReadonly();
                if (!db || !db.objectStoreNames.contains('images')) {
                    el.textContent = '当前：0 张（缓存为空）';
                    return;
                }
                const count = await new Promise((resolve) => {
                    const tx = db.transaction('images', 'readonly');
                    const req = tx.objectStore('images').count();
                    req.onsuccess = () => resolve(req.result || 0);
                    req.onerror = () => resolve(0);
                });
                // 采样估算大小
                let totalBytes = 0, sampled = 0;
                await new Promise((resolve) => {
                    const tx = db.transaction('images', 'readonly');
                    const req = tx.objectStore('images').openCursor();
                    req.onsuccess = (ev) => {
                        const cur = ev.target.result;
                        if (!cur || sampled >= 50) { resolve(); return; }
                        totalBytes += (cur.value || '').length;
                        sampled++;
                        cur.continue();
                    };
                    req.onerror = () => resolve();
                });
                db.close();
                const avg = sampled ? totalBytes / sampled : 0;
                const est = Math.round(avg * count);
                const mb = (est / (1024 * 1024)).toFixed(1);
                el.textContent = `当前：${count} 张 · 估算 ${mb} MB`;
            } catch {
                el.textContent = '统计失败';
            }
        }

        async function clearChatImageCache() {
            if (!confirm('清空聊天图片缓存？\n旧消息里的图片缩略会变成 [图片] 占位，但聊天本身、新发图不受影响。')) return;
            try {
                const db = await openQqImgDbReadonly();
                if (!db || !db.objectStoreNames.contains('images')) {
                    alert('缓存已经是空的');
                    return;
                }
                await new Promise((resolve, reject) => {
                    const tx = db.transaction('images', 'readwrite');
                    tx.objectStore('images').clear();
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
                db.close();
                alert('已清空聊天图片缓存');
                refreshImageCacheStats();
            } catch (err) {
                alert('清空失败：' + (err.message || '未知错误'));
            }
        }

        async function clearSiteCache() {
            if (!confirm('清空浏览器站点缓存？\n下次加载页面会重新从服务器拉资源（HTML/CSS/JS/字体），首次加载会慢一点。\n聊天数据、设置不受影响。')) return;
            try {
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
                alert('已清空站点缓存，刷新页面后生效');
            } catch (err) {
                alert('清空失败：' + (err.message || '未知错误'));
            }
        }

        async function handleCarrotImport(input) {
            const file = input.files?.[0];
            const resultEl = document.getElementById('carrot-import-result');
            if (!file) return;
            try {
                if (resultEl) resultEl.textContent = '正在解析并导入...';
                const text = await file.text();
                const res = await fetch('/api/qq/import-carrot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: text })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (resultEl) resultEl.textContent = '导入失败：' + (data.error || res.status);
                    return;
                }
                const r = data.report || {};
                const lines = [
                    '✓ 导入完成（未扣 cc）',
                    `· 表情包：新增 ${r.stickerPacks} 组，新增贴纸 ${r.stickerItems} 张` + (r.stickerSkipped ? `（重复跳过 ${r.stickerSkipped} 张）` : ''),
                    `· 头像框：新增 ${r.frames} 条（已按 char/user 拆分）` + (r.frameSkipped ? `（重复跳过 ${r.frameSkipped} 条）` : ''),
                    `· 头像对：新增 ${r.avatars} 对` + (r.avatarSkipped ? `（重复跳过 ${r.avatarSkipped} 对）` : ''),
                    `· 字体定义：${r.fonts || 0} 条（存到 settings.json.imported_carrot，待字体模块上线）`,
                    `· 提示音：${r.notifSounds || 0} 条（同上）`,
                ];
                if (Array.isArray(r.skipped) && r.skipped.length) {
                    lines.push(`· 跳过的字段：${r.skipped.join('、')}`);
                }
                if (resultEl) resultEl.textContent = lines.join('\n');
            } catch (err) {
                if (resultEl) resultEl.textContent = '导入失败：' + (err.message || '未知错误');
            } finally {
                input.value = '';
            }
        }

        function loadApiConfigToEditor() {
            const selectedName = document.getElementById('apiConfig_select')?.value || "";
            const config = getApiConfigs()[selectedName];
            if (!config) return;

            document.getElementById('apiConfig_url').value = config.url || "";
            document.getElementById('apiConfig_key').value = config.key || "";
            setSelectValue('apiConfig_model', config.model || "");
        }

        async function saveApiConfig() {
            const url = document.getElementById('apiConfig_url').value.trim();
            const key = document.getElementById('apiConfig_key').value.trim();
            const model = document.getElementById('apiConfig_model').value.trim();
            const currentName = document.getElementById('apiConfig_select').value;
            const name = prompt("请输入 API 配置名称", currentName || "");

            if (!name || !name.trim()) return;
            const cleanName = name.trim();
            settings.apiConfigs = getApiConfigs();
            settings.apiConfigs[cleanName] = { url, key, model };
            settings.apiConfig_select = cleanName;

            renderApiConfigSelects();
            document.getElementById('apiConfig_select').value = cleanName;
            await saveData();
            alert("API 配置已保存");
        }

        async function editApiConfig() {
            const select = document.getElementById('apiConfig_select');
            const oldName = select.value;
            const configs = getApiConfigs();
            const oldConfig = configs[oldName];

            if (!oldConfig) {
                alert("请先选择一个 API 配置");
                return;
            }

            const name = prompt("配置名称", oldName);
            if (!name || !name.trim()) return;
            const url = prompt("接口 URL", oldConfig.url || "");
            if (url === null) return;
            const key = prompt("API Key", oldConfig.key || "");
            if (key === null) return;
            const model = prompt("模型", oldConfig.model || "");
            if (model === null) return;

            const cleanName = name.trim();
            if (cleanName !== oldName) delete configs[oldName];
            configs[cleanName] = { url: url.trim(), key: key.trim(), model: model.trim() };
            settings.apiConfig_select = cleanName;
            if (settings.mainApi_config === oldName) settings.mainApi_config = cleanName;
            if (settings.subApi_config === oldName) settings.subApi_config = cleanName;

            renderApiConfigSelects();
            select.value = cleanName;
            loadApiConfigToEditor();
            await saveData();
        }

        async function deleteApiConfig() {
            const select = document.getElementById('apiConfig_select');
            const name = select.value;
            if (!name || !getApiConfigs()[name]) {
                alert("请先选择一个 API 配置");
                return;
            }
            if (!confirm(`删除 API 配置「${name}」？`)) return;

            delete settings.apiConfigs[name];
            ['apiConfig_select', 'mainApi_config', 'subApi_config'].forEach(id => {
                if (settings[id] === name) settings[id] = "";
            });

            renderApiConfigSelects();
            await saveData();
        }

        async function applyApiConfig(prefix) {
            const configName = document.getElementById(`${prefix}_config`).value;
            const config = getApiConfigs()[configName];
            if (!config) {
                alert("请先选择一个 API 配置");
                return;
            }

            settings[`${prefix}_url`] = config.url || "";
            settings[`${prefix}_key`] = config.key || "";
            settings[`${prefix}_model`] = config.model || "";
            settings[`${prefix}_config`] = configName;
            await saveData();
            alert(`${prefix === 'mainApi' ? '主 API' : '副 API'} 已应用`);
        }

        function setSelectValue(id, value) {
            const select = document.getElementById(id);
            if (!select) return;
            if (value && !Array.from(select.options).some(option => option.value === value)) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                select.appendChild(option);
            }
            select.value = value || "";
        }

        async function requestModelList(url, key) {
            const modelsUrl = buildModelsUrl(url);
            if (!modelsUrl) throw new Error("请先填写接口 URL");
            if (!key) throw new Error("请先填写 API Key");

            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP 异常状态: ${response.status}`);
            }

            const data = await response.json();
            return data.data || [];
        }

        async function connectApiConfig() {
            const url = document.getElementById('apiConfig_url').value;
            const key = document.getElementById('apiConfig_key').value;
            const modelSelect = document.getElementById('apiConfig_model');
            modelSelect.innerHTML = '<option value="">连接中...</option>';

            try {
                const models = await requestModelList(url, key);
                modelSelect.innerHTML = '<option value="">请选择模型...</option>';
                models.forEach(model => {
                    const id = model.id || model.name || model;
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = id;
                    modelSelect.appendChild(option);
                });
                alert(`连接成功，已拉取 ${models.length} 个模型`);
                saveData();
            } catch (error) {
                console.error(error);
                modelSelect.innerHTML = '<option value="">连接失败</option>';
                alert(`连接失败：${error.message}`);
            }
        }

        async function testApiConfig() {
            const url = document.getElementById('apiConfig_url').value;
            const key = document.getElementById('apiConfig_key').value;

            try {
                const models = await requestModelList(url, key);
                alert(`测试成功，可访问模型列表。模型数量：${models.length}`);
            } catch (error) {
                console.error(error);
                alert(`测试失败：${error.message}`);
            }
        }

        function syncRangeValue(input) {
            const output = document.querySelector(`[data-for="${input.id}"]`);
            if (output) output.textContent = Number(input.value).toFixed(2);
        }

        function syncAllRangeValues() {
            document.querySelectorAll('input[type="range"]').forEach(syncRangeValue);
        }

        function clampNumber(input, min, max) {
            if (input.value === "") return;
            const value = Number(input.value);
            if (Number.isNaN(value)) return;
            input.value = Math.min(max, Math.max(min, value));
        }

        async function refreshUserMicStatus() {
            const el = document.getElementById('userMic_status');
            if (!el) return;
            if (!window.isSecureContext) {
                el.textContent = '需要 HTTPS';
                return;
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                el.textContent = '浏览器不支持';
                return;
            }
            if (settings.userMicPermissionGranted) {
                el.textContent = '已允许';
                return;
            }
            try {
                const status = await navigator.permissions?.query?.({ name: 'microphone' });
                if (status?.state === 'granted') el.textContent = '已允许';
                else if (status?.state === 'denied') el.textContent = '已拒绝';
                else el.textContent = '未授权';
            } catch {
                el.textContent = '未授权';
            }
        }

        async function requestUserMicPermission() {
            const statusEl = document.getElementById('userMic_status');
            const button = document.getElementById('userMic_request');
            if (statusEl) statusEl.textContent = '正在申请...';
            if (button) button.disabled = true;
            try {
                if (!window.isSecureContext) throw new Error('需要 HTTPS 或 localhost');
                if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持');
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                settings.userMicPermissionGranted = true;
                if (statusEl) statusEl.textContent = '已允许';
                await saveData();
            } catch (e) {
                settings.userMicPermissionGranted = false;
                if (statusEl) statusEl.textContent = '未允许：' + (e?.message || e?.name || '失败');
                await saveData();
            } finally {
                if (button) button.disabled = false;
            }
        }

        const ASR_HELP = {
            siliconflow: {
                title: '硅基流动 STT Key 获取',
                body: `<p><b>免费 SenseVoice 中文识别，国内直连不需要梯子。</b></p>
<ol>
  <li>打开 <a href="https://cloud.siliconflow.cn" target="_blank" rel="noopener">https://cloud.siliconflow.cn</a>，用手机号注册登录</li>
  <li>左侧菜单「API 密钥」→「新建 API 密钥」→ 复制</li>
  <li>粘贴到下方输入框（实时自动保存）</li>
</ol>
<p class="muted">使用 <code>FunAudioLLM/SenseVoiceSmall</code> 模型，永久免费。中文识别质量比 Whisper 略好。Key 只存在你自己的 BunnyOS 后端，不会上传到任何地方。</p>`,
            },
            groq: {
                title: 'Groq STT Key 获取',
                body: `<p><b>免费 Whisper 语音识别，速度极快（1 秒内出结果）。</b></p>
<ol>
  <li>打开 <a href="https://console.groq.com" target="_blank" rel="noopener">https://console.groq.com</a>，用 Google / GitHub 登录</li>
  <li>左侧「API Keys」→「Create API Key」→ 复制</li>
  <li>粘贴到下方输入框（实时自动保存）</li>
</ol>
<p class="muted">Groq 是美国服务，国内访问需要梯子。免费档每天约 2000 次请求，单人用不完。Key 只存在你自己的 BunnyOS 后端，不会上传到任何地方。</p>`,
            },
        };

        function showAsrHelp(provider) {
            const info = ASR_HELP[provider];
            if (!info) return;
            const modal = document.getElementById('asr-help-modal');
            document.getElementById('asr-help-title').textContent = info.title;
            document.getElementById('asr-help-body').innerHTML = info.body;
            modal?.classList.remove('hidden');
        }

        function closeAsrHelp(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('asr-help-modal')?.classList.add('hidden');
        }


        // 初始化加载数据
        async function init() {
            try {
                // 1. 获取设置表单
                const settingsRes = await fetch('/api/settings', { cache: 'no-store' });
                if (settingsRes.ok) {
                    settings = await settingsRes.json();
                    settingsVersion = Number(settings._updatedAt || Date.now());
                }

                // 2. 获取提示词预设
                const presetsRes = await fetch('/api/presets');
                if (presetsRes.ok) {
                    presets = await presetsRes.json();
                    renderPresets();
                }

                // 初始化时触发布局更新
                await loadBeautyApps();
                applySettingsToForm();
                await refreshUserMicStatus();

            } catch (e) {
                console.error("加载设置失败: ", e);
            }
        }

        // 保存所有当前界面数据
        async function saveData() {
            const elements = document.querySelectorAll('input:not(#preset_name):not([type="file"]), textarea, select');
            elements.forEach(el => {
                settings[el.id] = el.type === 'checkbox' ? el.checked : el.value;
            });
            
            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                if (res.ok) {
                    const data = await res.json().catch(() => null);
                    if (data?.settings) {
                        settings = data.settings;
                        settingsVersion = Number(settings._updatedAt || Date.now());
                    }
                }
                notifyThemeUpdated();
            } catch (error) {
                console.error("无法保存设置到服务器:", error);
            }
        }

        // --- 预设逻辑 ---
        async function savePreset() {
            const name = document.getElementById('preset_name').value.trim();
            if (!name) {
                alert("请输入预设名称");
                return;
            }
            const positive = document.getElementById('prompt_positive').value;
            const negative = document.getElementById('prompt_negative').value;
            
            presets[name] = { positive, negative };
            
            try {
                const res = await fetch('/api/presets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(presets)
                });
                
                if (res.ok) {
                    renderPresets();
                    document.getElementById('prompt_preset_select').value = name;
                    document.getElementById('preset_name').value = '';
                    alert("保存预设成功！");
                    
                    // 保存当前的预设选择状态
                    saveData();
                } else {
                    alert("保存预设失败");
                }
            } catch (error) {
                console.error("无法保存预设到服务器:", error);
                alert("无法连接到服务器");
            }
        }

        function renderPresets() {
            const sel = document.getElementById('prompt_preset_select');
            sel.innerHTML = '<option value="">默认配置</option>';
            for (let name in presets) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                sel.appendChild(opt);
            }
            // 恢复当前选中项
            if (settings['prompt_preset_select']) {
                sel.value = settings['prompt_preset_select'];
            }
        }

        function loadPreset() {
            const name = document.getElementById('prompt_preset_select').value;
            if (name && presets[name]) {
                document.getElementById('prompt_positive').value = presets[name].positive;
                document.getElementById('prompt_negative').value = presets[name].negative;
            } else {
                document.getElementById('prompt_positive').value = '';
                document.getElementById('prompt_negative').value = '';
            }
            saveData();
        }

        // --- 获取模型/配置逻辑（兼容与模拟） ---
        async function fetchModels(prefix) {
            let urlStr = "";
            let keyStr = document.getElementById(prefix + '_key') ? document.getElementById(prefix + '_key').value : "";
            const modelSelect = document.getElementById(prefix + '_model');
            const voiceSelect = document.getElementById(prefix + '_voice'); // 可能为空
            
            // 根据不同平台组织请求 URL，若没有公开标准 URL，则模拟或抛出提示
            if (prefix === 'mainApi' || prefix === 'subApi') {
                urlStr = document.getElementById(prefix + '_url').value;
                if (!urlStr) return alert("请先填写接口 URL");
                if (!urlStr.endsWith('/v1')) {
                    // 提供一点宽容度
                    if (!urlStr.endsWith('/')) urlStr += '/';
                    urlStr += 'models'; 
                } else {
                    urlStr += '/models';
                }
            } else if (prefix === 'voice_silicon') {
                urlStr = 'https://api.siliconflow.cn/v1/models'; // 样例端点
            } else if (prefix === 'voice_minimax') {
                urlStr = 'https://api.minimax.chat/v1/models';
            } else if (prefix === 'voice_11labs') {
                urlStr = 'https://api.elevenlabs.io/v1/models';
            } else if (prefix === 'image_nanobanana') {
                urlStr = 'https://api.nanobanana.com/v1/models';
            } else if (prefix === 'image_novelapi') {
                urlStr = 'https://api.novelapi.com/v1/models';
            }

            if (!keyStr) {
                alert("请先填写 API Key！");
                return;
            }

            const oldText = modelSelect.options[modelSelect.selectedIndex]?.text || "加载中...";
            modelSelect.innerHTML = '<option value="">拉取中...</option>';

            try {
                // 注意：浏览器直接发起跨域请求（CORS）可能会被对应服务器拦截。
                // 如果是标准 OpenAI 规范接口通常支持 CORS，如果遇到拦截，会在控制台报错。
                const response = await fetch(urlStr, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${keyStr}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP 异常状态: ${response.status}`);
                }

                const data = await response.json();
                const modelList = data.data || [];
                
                modelSelect.innerHTML = '<option value="">请选择模型...</option>';
                modelList.forEach(m => {
                    const id = m.id || m.name || m;
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = id;
                    modelSelect.appendChild(opt);
                });

                // 如果有声音选择器，尝试请求声音。由于标准 OpenAI 没有标准的声音列表接口，
                // 对于特定的语音平台，这里应该请求特定端点，这里做简单占位示例：
                if (voiceSelect && prefix === 'voice_11labs') {
                    const vRes = await fetch('https://api.elevenlabs.io/v1/voices', {
                        headers: { 'xi-api-key': keyStr }
                    }).catch(e=>null);
                    if(vRes && vRes.ok) {
                        const vData = await vRes.json();
                        voiceSelect.innerHTML = '<option value="">请选择声音...</option>';
                        (vData.voices || []).forEach(v => {
                            const opt = document.createElement('option');
                            opt.value = v.voice_id;
                            opt.textContent = v.name;
                            voiceSelect.appendChild(opt);
                        });
                    }
                }

                saveData(); // 自动保存恢复之前的选中值，或者更新新的引用
                alert("拉取成功！请在下拉列表中选择。");

            } catch (error) {
                console.error(error);
                modelSelect.innerHTML = `<option value="">拉取失败 (见控制台)</option>`;
                alert(`拉取失败，请检查 URL 和 Key 是否有效，或是否存在跨域拦截 (CORS) 问题。\n错误详情: ${error.message}`);
                
                // 恢复原有选项
                if(settings[modelSelect.id]) {
                    const opt = document.createElement('option');
                    opt.value = settings[modelSelect.id];
                    opt.textContent = settings[modelSelect.id];
                    modelSelect.appendChild(opt);
                    modelSelect.value = settings[modelSelect.id];
                }
            }
        }

        Object.assign(window, {
            navTo,
            navBack,
            toggleVendor,
            fetchModels,
            loadApiConfigToEditor,
            saveApiConfig,
            editApiConfig,
            deleteApiConfig,
            connectApiConfig,
            testApiConfig,
            applyApiConfig,
            clampNumber,
            syncRangeValue,
            requestUserMicPermission,
            showAsrHelp,
            closeAsrHelp,
            saveData,
            loadPreset,
            savePreset,
            handleWallpaperUpload,
            handleAppIconUpload,
            handleCarrotImport,
            clearChatImageCache,
            clearSiteCache,
            refreshImageCacheStats,
            loadImageHostConfig,
            saveImageHostConfig,
            saveBeautyPreset,
            applyBeautyPreset,
            renameBeautyPreset,
            deleteBeautyPreset,
            previewNotifySound,
            showJinaReaderHelp,
            subscribePushHere,
            unsubscribePushHere,
            testPush
        });

        async function refreshPushStatus() {
            const el = document.getElementById('push_status');
            if (!el) return;
            try {
                const get = window.parent?.bunnyosGetPushStatus;
                if (!get) { el.textContent = '不可用'; return; }
                const s = await get();
                const label = !s.swSupported ? '浏览器不支持 Service Worker'
                    : s.perm === 'denied' ? '通知权限被拒'
                    : s.subscribed ? '已订阅本设备'
                    : '未订阅';
                el.textContent = label;
            } catch (e) { el.textContent = '查询失败'; }
        }
        async function subscribePushHere() {
            const fn = window.parent?.bunnyosSubscribeWebPush;
            if (!fn) { alert('父窗口未加载推送模块'); return; }
            const r = await fn();
            await refreshPushStatus();
            alert(r.ok ? '订阅成功' : '订阅失败：' + (r.error || ''));
        }
        async function unsubscribePushHere() {
            const fn = window.parent?.bunnyosUnsubscribeWebPush;
            if (!fn) return;
            const r = await fn();
            await refreshPushStatus();
            alert(r.ok ? '已取消订阅' : '取消失败：' + (r.error || ''));
        }
        async function testPush() {
            try {
                const res = await fetch('/api/notify/test', { method: 'POST' });
                const data = await res.json();
                alert('已向 ' + data.sent + ' 个订阅推送测试。（剔除失效订阅 ' + data.removed + ' 个）');
            } catch (e) { alert('测试推送失败：' + e.message); }
        }
        setTimeout(refreshPushStatus, 600);

        function previewNotifySound(fieldId) {
            const url = (document.getElementById(fieldId)?.value || '').trim();
            if (!url) { alert('请先填写提示音 URL'); return; }
            const previewFn = window.parent?.bunnyosPreviewNotifySound;
            if (typeof previewFn === 'function') {
                Promise.resolve(previewFn(url)).catch(err => {
                    console.warn('试听失败', err);
                    alert('试听失败：' + (err?.message || '浏览器拦截了自动播放'));
                });
            } else {
                // fallback: 在 iframe 内自己播一次
                const audio = new Audio(url);
                audio.play().catch(err => alert('试听失败：' + (err?.message || '')));
            }
        }

        function showJinaReaderHelp() {
            alert('Jina Reader 是内置链接解析兜底：第三方解析失败、原生抓取拿不到标题/摘要时会尝试使用。Token 可选；不填走免 key 模式，填写后用 Bearer Token 请求 Jina。');
        }

        window.onload = init;
        window.addEventListener('focus', () => reloadSettingsIfChanged());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) reloadSettingsIfChanged();
        });
        setInterval(() => {
            if (!document.hidden) reloadSettingsIfChanged();
        }, 30000);
        if ('EventSource' in window) {
            try {
                const settingsEvents = new EventSource('/api/settings/events');
                settingsEvents.addEventListener('settings-updated', () => reloadSettingsIfChanged());
            } catch (e) {
                console.warn('设置实时同步不可用', e);
            }
        }
        document.documentElement.dataset.externalNav = window.parent !== window ? 'true' : 'false';
        notifyNavigationState();

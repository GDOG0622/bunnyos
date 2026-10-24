// IndexedDB 图片缓存：每张发过的图片 dataURL 按 client_image_id 存
// 原图由服务端保存；这里用于预览和旧数据迁移。
const IMG_DB_NAME = 'bunnyos-qq';
const IMG_STORE = 'images';
const IMG_DB_VERSION = 1;
let imgDbPromise = null;

function openImgDb() {
    if (imgDbPromise) return imgDbPromise;
    imgDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IMG_DB_NAME, IMG_DB_VERSION);
        req.onerror = () => { imgDbPromise = null; reject(req.error); };
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE);
        };
    });
    return imgDbPromise;
}

async function putImageBlob(id, dataUrl) {
    if (!id || !dataUrl) throw new Error('缺少图片 ID 或内容');
    const db = await openImgDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(IMG_STORE, 'readwrite');
        tx.objectStore(IMG_STORE).put(dataUrl, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('图片写入失败'));
        tx.onabort = () => reject(tx.error || new Error('图片写入已中止'));
    });
}

async function getImageBlob(id) {
    if (!id) return null;
    try {
        const db = await openImgDb();
        return await new Promise((resolve) => {
            const tx = db.transaction(IMG_STORE, 'readonly');
            const req = tx.objectStore(IMG_STORE).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

async function deleteImageBlob(id) {
    if (!id) return;
    try {
        const db = await openImgDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IMG_STORE, 'readwrite');
            tx.objectStore(IMG_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {}
}

async function clearAllImageBlobs() {
    try {
        const db = await openImgDb();
        return await new Promise((resolve) => {
            const tx = db.transaction(IMG_STORE, 'readwrite');
            tx.objectStore(IMG_STORE).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch { return false; }
}

async function getImageCacheStats() {
    try {
        const db = await openImgDb();
        const count = await new Promise((resolve) => {
            const tx = db.transaction(IMG_STORE, 'readonly');
            const req = tx.objectStore(IMG_STORE).count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        });
        // 估算字节数：粗暴遍历前 50 项算平均
        let totalBytes = 0;
        let sampled = 0;
        await new Promise((resolve) => {
            const tx = db.transaction(IMG_STORE, 'readonly');
            const req = tx.objectStore(IMG_STORE).openCursor();
            req.onsuccess = (ev) => {
                const cur = ev.target.result;
                if (!cur || sampled >= 50) { resolve(); return; }
                totalBytes += (cur.value || '').length;
                sampled++;
                cur.continue();
            };
            req.onerror = () => resolve();
        });
        const avgBytes = sampled ? totalBytes / sampled : 0;
        return { count, estimatedBytes: Math.round(avgBytes * count) };
    } catch { return { count: 0, estimatedBytes: 0 }; }
}

// 一次性把老的 localStorage `qq:img:*` 迁移到 IDB（兼容 v0.x → v1.x）
async function migrateLocalStorageImagesToIdb() {
    let migrated = 0;
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('qq:img:')) keys.push(k);
        }
        if (!keys.length) return 0;
        for (const k of keys) {
            const id = k.slice('qq:img:'.length);
            const dataUrl = localStorage.getItem(k);
            if (!dataUrl) continue;
            await putImageBlob(id, dataUrl);
            if (await getImageBlob(id) !== dataUrl) throw new Error('图片迁移校验失败');
            localStorage.removeItem(k);
            migrated += 1;
        }
        console.log(`[IDB] 迁移了 ${migrated} 张图片从 localStorage → IDB`);
        return migrated;
    } catch (err) {
        console.warn('[IDB migrate]', err);
        return migrated;
    }
}

async function migrateCachedChatImagesToServer() {
    await migrateLocalStorageImagesToIdb();
    const response = await fetch('/api/qq/chats?summary=1');
    if (!response.ok) throw new Error(`读取旧图片记录失败 (HTTP ${response.status})`);
    const summaries = await response.json();
    for (const summary of summaries) {
        if (!summary.missingImageCount) continue;
        const detail = await fetch(`/api/qq/chats/${encodeURIComponent(summary.characterId)}`);
        if (!detail.ok) throw new Error(`读取旧图片聊天失败 (HTTP ${detail.status})`);
        const chat = await detail.json();
        let changed = false;
        for (const message of chat.messages || []) {
            if (message?.type !== 'image' || message.image_url || !message.client_image_id) continue;
            const image = await getImageBlob(message.client_image_id)
                || localStorage.getItem(`qq:img:${message.client_image_id}`);
            if (image) { message.image = image; changed = true; }
        }
        if (!changed) throw new Error('当前浏览器找不到旧原图，请在保存过原图的设备运行迁移');
        const result = await fetch(`/api/qq/chats/${encodeURIComponent(chat.characterId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: chat.messages, version: chat.version })
        });
        if (!result.ok) {
            const data = await result.json().catch(() => ({}));
            throw new Error(data.error || `旧图片上传失败 (HTTP ${result.status})`);
        }
        const saved = await result.json();
        const images = (saved.messages || []).filter(message => message?.type === 'image');
        if (images.length !== (chat.messages || []).filter(message => message?.type === 'image').length
            || images.some(message => !message.image_url)) {
            throw new Error('仍有旧原图未上传，请在保存过原图的设备继续迁移');
        }
    }
}

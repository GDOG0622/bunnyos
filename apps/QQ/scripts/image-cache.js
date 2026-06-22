// IndexedDB 图片缓存：每张发过的图片 dataURL 按 client_image_id 存
// localStorage 5-10MB 太小，IDB 几十 GB；存 dataURL 字符串，简单可靠
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
    if (!id || !dataUrl) return;
    try {
        const db = await openImgDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IMG_STORE, 'readwrite');
            tx.objectStore(IMG_STORE).put(dataUrl, id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('[IDB put]', err);
    }
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
            if (dataUrl) await putImageBlob(id, dataUrl);
            localStorage.removeItem(k);
        }
        console.log(`[IDB] 迁移了 ${keys.length} 张图片从 localStorage → IDB`);
        return keys.length;
    } catch (err) {
        console.warn('[IDB migrate]', err);
        return 0;
    }
}

// 进入聊天前预加载所有图片到 state.imageAttachments，让 renderActiveChat 同步用得到
async function preloadImagesForActiveChat() {
    if (state.imagePreloadInFlight) return;
    state.imagePreloadInFlight = true;
    try {
        const chat = state.chats.find(c => c.characterId === state.activeChatId);
        if (!chat) return;
        const ids = (chat.messages || [])
            .filter(m => m?.type === 'image' && m.client_image_id)
            .map(m => m.client_image_id)
            .filter(id => !state.imageAttachments?.[id]?.dataUrl);
        if (!ids.length) return;
        state.imageAttachments = state.imageAttachments || {};
        const blobs = await Promise.all(ids.map(getImageBlob));
        let changed = false;
        ids.forEach((id, i) => {
            if (blobs[i]) {
                state.imageAttachments[id] = { dataUrl: blobs[i], consumed: true, characterId: state.activeChatId };
                changed = true;
            }
        });
        if (changed && state.activeChatId === chat.characterId) renderActiveChat();
    } finally {
        state.imagePreloadInFlight = false;
    }
}

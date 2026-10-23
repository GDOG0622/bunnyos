const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStoragePath } = require('./storage-path');

function chatVersion(file) {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function requireChatVersion(file, version) {
    // shortcut: compare and write run synchronously in one Node process; use transactions before adding workers.
    if (version === undefined || version !== chatVersion(file)) {
        const error = new Error('聊天已被其他设备或后台更新。当前修改已保留，请复制需要的内容后重新加载聊天再保存。');
        error.statusCode = 409;
        error.code = 'CHAT_VERSION_CONFLICT';
        throw error;
    }
}

function atomicWriteJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, 'wx', 0o600);
        try {
            fs.writeFileSync(descriptor, JSON.stringify(data, null, 2), 'utf8');
            fs.fsyncSync(descriptor);
        } finally { fs.closeSync(descriptor); }
        fs.renameSync(temporary, file);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

function persistChatImages(rootDir, messages) {
    return messages.map(message => {
        if (message?.type !== 'image') return message;
        const clean = { ...message, text: message.text || '[图片]' };
        if (clean.image_url) {
            if (!/^\/data\/assets\/chat-images\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|avif)$/.test(clean.image_url)) throw new Error('聊天图片路径无效');
            safeStoragePath(rootDir, clean.image_url.slice(1));
        } else if (clean.image) {
            const match = /^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(clean.image);
            if (!match || match[2].length > 28 * 1024 * 1024) throw new Error('聊天图片格式无效或超过 20MB');
            const buffer = Buffer.from(match[2], 'base64');
            if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('聊天图片格式无效或超过 20MB');
            const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
            const name = `${crypto.createHash('sha256').update(buffer).digest('hex')}.${extension}`;
            const target = safeStoragePath(rootDir, `data/assets/chat-images/${name}`);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (!fs.existsSync(target)) fs.writeFileSync(target, buffer, { flag: 'wx', mode: 0o600 });
            clean.image_url = `/data/assets/chat-images/${name}`;
        }
        delete clean.image;
        return clean;
    });
}

module.exports = { chatVersion, requireChatVersion, atomicWriteJson, persistChatImages };

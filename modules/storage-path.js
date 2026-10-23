const fs = require('fs');
const path = require('path');

function validateFileId(id) {
    if (typeof id !== 'string' || !id || id.length > 120
        || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(id) || /^[. ]|[. ]$/.test(id)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)
        || ['__proto__', 'constructor', 'prototype'].includes(id)) {
        const error = new Error('ID 包含不允许的文件名字符');
        error.statusCode = 400;
        throw error;
    }
    return id;
}

function safeStoragePath(rootDir, relativePath) {
    const root = path.resolve(rootDir);
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`存储路径越界：${relativePath}`);
    }
    let current = root;
    for (const part of ['', ...relative.split(path.sep)]) {
        if (part) current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`存储路径不能包含符号链接：${relativePath}`);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return target;
}

function fileForId(directory, id, extension = '.json') {
    return safeStoragePath(directory, `${validateFileId(id)}${extension}`);
}

module.exports = { validateFileId, safeStoragePath, fileForId };

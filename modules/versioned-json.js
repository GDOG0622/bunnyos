const crypto = require('crypto');

function versionOf(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requireVersion(current, version, code = 'VERSION_CONFLICT') {
    if (version === undefined || version !== versionOf(current)) {
        const error = new Error('数据已被其他设备或后台修改，请重新加载后再保存。当前草稿已保留。');
        error.statusCode = 409;
        error.code = code;
        throw error;
    }
}

function applyFieldPatch(current, changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)
        || Object.keys(changes).some(key => ['__proto__', 'constructor', 'prototype', '_version', '_updatedAt'].includes(key))) {
        const error = new Error('无效的局部修改');
        error.statusCode = 400;
        throw error;
    }
    return { ...current, ...changes };
}

module.exports = { versionOf, requireVersion, applyFieldPatch };

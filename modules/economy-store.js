const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./chat-storage');
const { safeStoragePath } = require('./storage-path');

// One Node writer: balance, transaction identity and recovery work commit in one rename.
function createEconomyStore({ rootDir, file }) {
    function read() {
        const state = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Number.isFinite(state.balance) || state.balance < 0) throw new Error('钱包数据无效');
        state.transactions ||= [];
        return state;
    }

    function effectPath(relative) {
        if (!/^data\/(?:chats\/qq\/[^/]+\.json|qq\/beauties\.json)$/.test(relative)) throw new Error('无效的交易落盘路径');
        return safeStoragePath(rootDir, relative);
    }

    function recover() {
        const state = read();
        if (!state.pending?.length) return state;
        for (const effect of state.pending) atomicWriteJson(effectPath(effect.path), effect.data);
        delete state.pending;
        atomicWriteJson(file, state);
        return state;
    }

    function find(id) {
        return recover().transactions.find(transaction => transaction.id === id);
    }

    function commit({ id, delta, details, result = {}, effects = [] }) {
        if (typeof id !== 'string' || !id || id.length > 512 || !Number.isFinite(delta)) throw new Error('无效的交易');
        const state = recover();
        const existing = state.transactions.find(transaction => transaction.id === id);
        if (existing) {
            if (existing.delta !== delta || JSON.stringify(existing.details) !== JSON.stringify(details)) {
                const error = new Error('交易 ID 已用于不同的操作');
                error.statusCode = 409;
                throw error;
            }
            return existing;
        }
        if (state.balance + delta < 0) {
            const error = new Error('余额不足');
            error.statusCode = 402;
            error.balance = state.balance;
            throw error;
        }
        const pending = effects.map(effect => {
            const relative = path.relative(rootDir, effect.file).split(path.sep).join('/');
            effectPath(relative);
            return { path: relative, data: effect.data };
        });
        const transaction = { id, delta, details, result, created_at: Date.now() };
        state.balance += delta;
        state.updated_at = transaction.created_at;
        state.transactions.push(transaction);
        state.pending = pending;
        atomicWriteJson(file, state);
        recover();
        return transaction;
    }

    return { read: recover, recover, find, commit };
}

module.exports = { createEconomyStore };

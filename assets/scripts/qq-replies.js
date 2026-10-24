(function(root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('crypto').randomUUID : () => globalThis.crypto.randomUUID());
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QqReplies = api;
})(globalThis, function(randomUUID) {
    const clone = value => JSON.parse(JSON.stringify(value));
    const newId = randomUUID;
    function snapshot(message) {
        const copy = clone(message);
        for (const key of ['reply_group_versions', 'reply_group_version_index', 'versions', 'version_index']) delete copy[key];
        return copy;
    }

    function parseSegments(segments, groupId, now = Date.now()) {
        return segments.map((value, index) => {
            const text = String(value || '').trim();
            if (!text) return null;
            const base = { id: `${groupId}:${index}`, role: 'assistant', type: 'text', text, created_at: now + index, reply_group_id: groupId };
            if (/^\[🧧领取\]$/.test(text)) return { ...base, type: 'transfer-receipt' };
            const transfer = /^\[🧧([^\d|\]]*)([\d.]+)\|([^\]]*)\]$/.exec(text);
            if (transfer && Number.isFinite(Number(transfer[2])) && Number(transfer[2]) > 0) {
                const [, currency, amount, note] = transfer;
                return { ...base, type: 'transfer', currency: currency.trim(), amount, note: note.trim(), status: 'pending', settled_at: null,
                    transaction_id: base.id, text: `转账 ${currency.trim()}${amount}${note.trim() ? ` ${note.trim()}` : ''}` };
            }
            const service = /^\[(🎁|🛵|🚕)([^|\]]+)\|([\d]+(?:\.\d{1,2})?)\|([^|\]]+?)(?:\|([^\]]*))?\]$/.exec(text);
            if (service) {
                const definitions = { '🎁': ['gift', '淘宝'], '🛵': ['delivery', '美团'], '🚕': ['ride', '滴滴'] };
                const [, icon, platform, price, item, note = ''] = service;
                if (platform.trim() === definitions[icon][1]) return { ...base, type: 'service', icon, serviceType: definitions[icon][0],
                    platform: platform.trim(), price, item: item.trim(), note: note.trim(), text: `${platform.trim()} ¥${price} ${item.trim()}${note.trim() ? ` ${note.trim()}` : ''}` };
            }
            return base;
        }).filter(Boolean);
    }

    function getReplyGroup(chat, index) {
        const message = chat.messages[index];
        let start = index, end = index;
        const id = message?.reply_group_id || '';
        const same = other => other?.role === 'assistant' && (other.reply_group_id || '') === id;
        if (message?.role === 'assistant') {
            while (start > 0 && same(chat.messages[start - 1])) start--;
            while (end < chat.messages.length - 1 && same(chat.messages[end + 1])) end++;
        }
        return { start, end, id: id || `rg_${newId()}` };
    }

    function activeGroupVersionIndex(chat, group) {
        const carrier = chat.messages[group.start];
        return Math.max(0, Number(carrier.reply_group_version_index ?? carrier.version_index) || 0);
    }

    function normalizedGroupVersions(chat, group) {
        const carrier = chat.messages[group.start];
        const stored = carrier.reply_group_versions?.length ? carrier.reply_group_versions : carrier.versions?.length
            ? carrier.versions.map(version => ({ segments: [version.text || ''], created_at: version.created_at })) : [{}];
        const active = Math.min(activeGroupVersionIndex(chat, group), stored.length - 1);
        return stored.map((version, index) => ({
            messages: index === active ? chat.messages.slice(group.start, group.end + 1).map(snapshot)
                : version.messages ? version.messages.map(snapshot)
                    : parseSegments(version.segments || [], `${group.id}:v${index}`, version.created_at || carrier.created_at).map(snapshot),
            created_at: version.created_at || carrier.created_at,
            ...(version.updated_at ? { updated_at: version.updated_at } : {})
        }));
    }

    function ensureGroupVersions(chat, group) {
        const carrier = chat.messages[group.start];
        for (let index = group.start; index <= group.end; index++) chat.messages[index].reply_group_id = group.id;
        const versions = normalizedGroupVersions(chat, group);
        carrier.reply_group_versions = versions;
        carrier.reply_group_version_index = Math.min(activeGroupVersionIndex(chat, group), versions.length - 1);
        delete carrier.versions;
        delete carrier.version_index;
        return versions;
    }

    function installVersion(chat, group, versions, index) {
        const selected = Math.max(0, Math.min(index, versions.length - 1));
        const messages = versions[selected].messages.map(message => ({ ...snapshot(message), reply_group_id: group.id, reply_group_version_index: selected }));
        if (messages.length) messages[0].reply_group_versions = versions;
        chat.messages.splice(group.start, group.end - group.start + 1, ...messages);
    }

    function replaceReplyGroupWithVersion(chat, group, index) {
        installVersion(chat, group, ensureGroupVersions(chat, group), index);
    }

    function appendReply(chat, segments, replaceIndex) {
        const group = Number.isInteger(replaceIndex) ? getReplyGroup(chat, replaceIndex)
            : { start: chat.messages.length, end: chat.messages.length - 1, id: `rg_${newId()}` };
        const versions = Number.isInteger(replaceIndex) ? ensureGroupVersions(chat, group) : [];
        const messages = parseSegments(segments, `${group.id}:v${versions.length}`);
        if (!messages.length) throw new Error('回复没有有效消息');
        messages.forEach(message => { message.reply_group_id = group.id; });
        for (const receipt of messages.filter(message => message.type === 'transfer-receipt')) {
            const pending = chat.messages.slice(0, group.start).findLast(message => message.role === 'user' && message.type === 'transfer' && message.status === 'pending');
            if (pending) {
                pending.status = 'received';
                pending.settled_at = Date.now();
                receipt.received_message_id = pending.id || pending.transaction_id;
            }
        }
        versions.push({ messages: messages.map(snapshot), created_at: Date.now() });
        installVersion(chat, group, versions, versions.length - 1);
        chat.updated_at = Date.now();
        return messages;
    }

    return { parseSegments, snapshot, getReplyGroup, normalizedGroupVersions, activeGroupVersionIndex, ensureGroupVersions, replaceReplyGroupWithVersion, appendReply };
});

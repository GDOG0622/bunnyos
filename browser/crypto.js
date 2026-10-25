const { sha256 } = require('@noble/hashes/sha2.js');
const { Buffer } = require('buffer');
module.exports = {
    randomUUID: () => globalThis.crypto.randomUUID(),
    randomBytes(length) { const bytes = new Uint8Array(length); globalThis.crypto.getRandomValues(bytes); return Buffer.from(bytes); },
    createHash(algorithm) {
        if (algorithm !== 'sha256') throw new Error('Unsupported hash: ' + algorithm);
        const hash = sha256.create();
        return { update(value) { hash.update(Buffer.from(value)); return this; },
            digest(encoding) { const result = Buffer.from(hash.digest()); return encoding ? result.toString(encoding) : result; } };
    },
    timingSafeEqual(a, b) { if (a.length !== b.length) return false; let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0; }
};

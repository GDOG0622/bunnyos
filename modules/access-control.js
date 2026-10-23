const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { safeStoragePath } = require('./storage-path');

function secretEquals(actual, expected) {
    const digest = value => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(actual), digest(expected));
}

function installAccessControl(app, { rootDir, env = process.env }) {
    let password = env.BUNNYOS_PASSWORD;
    if (!password) {
        const authFile = safeStoragePath(rootDir, 'data/access.json');
        fs.mkdirSync(path.dirname(authFile), { recursive: true });
        if (!fs.existsSync(authFile)) {
            fs.writeFileSync(authFile, JSON.stringify({ password: crypto.randomBytes(24).toString('base64url') }), { mode: 0o600, flag: 'wx' });
        }
        password = JSON.parse(fs.readFileSync(authFile, 'utf8')).password;
        if (typeof password !== 'string' || password.length < 16) throw new Error('data/access.json 中的登录密码无效');
        console.log('[BunnyOS] 登录用户名：bunnyos；密码保存在 data/access.json，可用 BUNNYOS_PASSWORD 设置。');
    }
    if (password.length < 16) throw new Error('BUNNYOS_PASSWORD 至少需要 16 个字符');
    const configuredUrl = env.BUNNYOS_ORIGIN ? new URL(env.BUNNYOS_ORIGIN) : null;
    if (configuredUrl && !/^https?:$/.test(configuredUrl.protocol)) throw new Error('BUNNYOS_ORIGIN 必须使用 http 或 https');
    const configuredOrigin = configuredUrl?.origin;

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        const origin = req.get('origin');
        const expectedOrigin = configuredOrigin || `${req.protocol}://${req.get('host')}`;
        // Basic credentials are reused by browsers, so reject cross-site requests before authentication.
        if ((origin && origin !== expectedOrigin) || req.get('sec-fetch-site') === 'cross-site') {
            return res.status(403).json({ error: '不允许跨站访问' });
        }
        if (req.path === '/api/admin/update-from-github') return next();
        const authorization = req.get('authorization') || '';
        if (authorization.startsWith('Basic ')) {
            const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
            if (secretEquals(credentials, `bunnyos:${password}`)) return next();
        }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('WWW-Authenticate', 'Basic realm="BunnyOS", charset="UTF-8"');
        return res.status(401).json({ error: '请使用 BunnyOS 密码登录' });
    });
}

function installStaticFiles(app, rootDir) {
    const mediaPrefixes = ['/data/assets/', '/data/qq/beauty-backgrounds/', '/data/qq/char-backgrounds/', '/assets/backgrounds/', '/assets/app-icons/'];
    app.use((req, res, next) => {
        let requested;
        try { requested = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }
        if (requested.startsWith('/api/')) return next();
        const normalized = path.posix.normalize(requested.replace(/\\/g, '/')).toLowerCase();
        if (mediaPrefixes.some(prefix => normalized.startsWith(prefix))) {
            if (!/\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp3|wav|ogg|m4a|mp4|webm|woff2?|ttf|otf)$/i.test(requested)) return res.sendStatus(404);
            res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
            res.setHeader('Cache-Control', 'private, no-store');
        }
        try { safeStoragePath(rootDir, requested.replace(/^\/+/, '') || 'index.html'); } catch { return res.sendStatus(404); }
        next();
    });
    const options = {
        dotfiles: 'deny',
        setHeaders(res, filePath) {
            if (['.html', '.json', '.webmanifest'].includes(path.extname(filePath).toLowerCase())) {
                res.setHeader('Cache-Control', 'private, no-store');
            } else if (!res.getHeader('Cache-Control')) {
                res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
            }
        }
    };
    for (const directory of ['apps', 'assets', 'data/assets', 'data/qq/beauty-backgrounds', 'data/qq/char-backgrounds']) {
        app.use(`/${directory}`, express.static(path.join(rootDir, directory), options));
    }
    for (const name of ['index.html', 'service-worker.js', 'manifest.webmanifest', 'icon.png', 'icon.jpg', 'icon.jpeg', 'icon.gif', 'icon.webp', 'icon.svg', 'icon.ico']) {
        app.get(name === 'index.html' ? ['/', '/index.html'] : `/${name}`, (req, res) => {
            res.setHeader('Cache-Control', 'private, no-store');
            res.sendFile(path.join(rootDir, name));
        });
    }
}

module.exports = { installAccessControl, installStaticFiles, secretEquals };

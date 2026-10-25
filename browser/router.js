// The shared API handlers run locally. This adapter implements only their routing
// contract; it never opens a port or forwards a request to the hosting server.
const fs = require('./fs');
function matcher(pattern, prefix) {
    const keys = [];
    const source = pattern.split('/').map(part => {
        if (part.startsWith(':')) { keys.push(part.slice(1)); return '([^/]+)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');
    return { regex: new RegExp('^' + source + (prefix ? '(?=/|$)' : '/?$')), keys };
}
function express() {
    const layers = [], parameters = new Map();
    const app = { disable() {}, param(name, fn) { parameters.set(name, fn); },
        listen(_port, callback) { queueMicrotask(callback); return { address: () => ({ port: 'browser' }), on() {} }; },
        use(pattern, ...handlers) {
            if (typeof pattern === 'function') { handlers.unshift(pattern); pattern = ''; }
            for (const fn of handlers) layers.push({ ...matcher(pattern, true), fn, prefix: true });
        },
        async handle(request) {
            fs.assertHealthy();
            const url = new URL(request.url);
            const raw = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
            const body = raw ? JSON.parse(raw) : undefined;
            const req = { path: url.pathname, originalUrl: url.pathname + url.search, method: request.method,
                query: Object.fromEntries(url.searchParams), body, params: {}, headers: Object.fromEntries(request.headers),
                protocol: 'https', get: name => request.headers.get(name), on() {} };
            const headers = new Headers({ 'Cache-Control': 'no-store' });
            let status = 200, result, finished = false;
            const res = { get headersSent() { return finished; },
                status(value) { status = value; return this; },
                set(name, value) { headers.set(name, value); return this; },
                setHeader(name, value) { headers.set(name, value); }, getHeader(name) { return headers.get(name); },
                json(value) { headers.set('Content-Type', 'application/json; charset=utf-8'); result = JSON.stringify(value); finished = true; return this; },
                send(value) { result = value; finished = true; return this; },
                sendStatus(value) { status = value; return this.send(String(value)); },
                sendFile(name) { try { return this.send(fs.readFileSync(name)); } catch { return this.sendStatus(404); } },
                redirect(location) { status = 302; headers.set('Location', location); return this.send(''); }
            };
            const calledParams = new Set();
            async function dispatch(index, raised) {
                if (finished) return;
                for (; index < layers.length; index++) {
                    const layer = layers[index];
                    if (layer.method && layer.method !== 'ALL' && layer.method !== request.method) continue;
                    if (!!raised !== (layer.fn.length === 4)) continue;
                    const match = layer.regex.exec(url.pathname);
                    if (!match) continue;
                    req.path = layer.prefix ? url.pathname.slice(match[0].length) || '/' : url.pathname;
                    req.params = Object.fromEntries(layer.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
                    let nextCall;
                    const next = err => { nextCall = dispatch(index + 1, err); return nextCall; };
                    try {
                        for (const [key, value] of Object.entries(req.params)) {
                            if (!parameters.has(key) || calledParams.has(key + ':' + value)) continue;
                            calledParams.add(key + ':' + value);
                            let paramError;
                            parameters.get(key)(req, res, err => { paramError = err; }, value);
                            if (paramError) throw paramError;
                            if (finished) return;
                        }
                        await (raised ? layer.fn(raised, req, res, next) : layer.fn(req, res, next));
                        if (nextCall) await nextCall;
                    } catch (error) { if (!finished) { status = error.statusCode || 500; res.json({ error: error.message }); } }
                    return;
                }
                status = raised?.statusCode || 404; res.json({ error: raised?.message || '接口不存在' });
            }
            await dispatch(0);
            await fs.flush();
            return new Response(result ?? '', { status, headers });
        }
    };
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) app[method] = (patterns, ...handlers) => {
        for (const pattern of [].concat(patterns)) for (const fn of handlers) layers.push({ ...matcher(pattern, false), fn, method: method.toUpperCase() });
    };
    return app;
}
express.json = express.urlencoded = () => (_req, _res, next) => next();
module.exports = express;

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { once } = require('events');

function copyDirectory(source, target) {
    fs.mkdirSync(target, { recursive: true });
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, item.name), to = path.join(target, item.name);
        if (item.isDirectory()) copyDirectory(from, to);
        else fs.copyFileSync(from, to);
    }
}

async function testServer(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnyos-integrity-'));
    const code = path.join(directory, 'code');
    const storage = path.join(directory, 'storage');
    const repo = path.resolve(__dirname, '../..');
    fs.mkdirSync(code);
    fs.copyFileSync(path.join(repo, 'server.js'), path.join(code, 'server.js'));
    for (const item of ['modules', 'assets/scripts', 'scripts']) copyDirectory(path.join(repo, item), path.join(code, item));
    fs.writeFileSync(path.join(code, 'index.html'), '<html>BunnyOS</html>');
    fs.writeFileSync(path.join(code, 'runner.cjs'), `
        const fs = require('fs');
        const path = require('path');
        const originalRename = fs.renameSync;
        let fault = null;
        fs.renameSync = (from, to) => {
            if (fault && to === path.join(process.env.BUNNYOS_STORAGE_DIR, fault.path)) {
                const crash = fault.crash;
                fault = null;
                if (crash) process.exit(86);
                throw new Error('injected disk failure');
            }
            return originalRename(from, to);
        };
        const lookup = require('dns').promises.lookup;
        require('dns').promises.lookup = (host, options) => host.endsWith('.example.test') || host === 'www.xiaohongshu.com'
            ? Promise.resolve(options?.all ? [{ address: '93.184.216.34', family: 4 }] : { address: '93.184.216.34', family: 4 }) : lookup(host, options);
        const realFetch = global.fetch;
        global.fetch = (url, options) => String(url).startsWith('https://r.jina.ai/')
            ? Promise.resolve(new Response('', { status: 404 })) : realFetch(url, options);
        require('web-push').sendNotification = async (_subscription, payload) => {
            const notification = JSON.parse(payload);
            const file = path.join(process.env.BUNNYOS_STORAGE_DIR, 'data/chats/qq', notification.characterId + '.json');
            process.send({ event: 'push', notification, chat: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null });
            return { statusCode: 201 };
        };
        process.on('message', message => { fault = message.fault; process.send({ ack: message.id }); });
        const { bunnyosHttpServer } = require('./server');
        bunnyosHttpServer.on('listening', () => process.send({ port: bunnyosHttpServer.address().port }));
    `);
    let child, base, output = '';
    const pushes = [];
    async function start() {
        child = fork(path.join(code, 'runner.cjs'), [], {
            cwd: code,
            env: { ...process.env, PORT: '0', BUNNYOS_STORAGE_DIR: storage, BUNNYOS_PASSWORD: 'integrity-password-123456789',
                BUNNYOS_ORIGIN: '', BUNNYOS_UPDATE_TOKEN: '', NODE_PATH: path.join(repo, 'node_modules') },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        child.on('message', message => { if (message.event === 'push') pushes.push(message); });
        const [{ port }] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error(output); })]);
        base = `http://127.0.0.1:${port}`;
    }
    async function stop() {
        if (child?.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
    }
    t.after(async () => {
        await stop();
        if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory');
        fs.rmSync(directory, { recursive: true, force: true });
    });
    await start();
    const request = (url, method = 'GET', body, options = {}) => fetch(base + url, {
        method, ...options,
        headers: { Authorization: `Basic ${Buffer.from('bunnyos:integrity-password-123456789').toString('base64')}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {
        code, storage, pushes, request,
        json: async (url, method, body) => {
            const response = await request(url, method, body);
            const data = await response.json();
            if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
            return data;
        },
        fault: async (relative, crash = false) => {
            const ack = once(child, 'message');
            child.send({ id: 'fault', fault: { path: relative, crash } });
            await ack;
        },
        restart: async () => { await stop(); await start(); }
    };
}

module.exports = { testServer };

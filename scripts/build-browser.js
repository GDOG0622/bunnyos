const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/browser');
// The output is disposable generated code only, never a user storage path.
if (path.relative(root, output) !== path.join('dist', 'browser')) throw new Error('Unexpected output directory');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const assets = [], seeds = {};
function copy(file) {
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let data = fs.readFileSync(path.join(root, file));
    if (file.endsWith('.html')) {
        const clientPath = path.posix.relative(path.posix.dirname(file), 'browser-client.js');
        const iconsPath = path.posix.relative(path.posix.dirname(file), 'vendor/bootstrap-icons.css');
        data = Buffer.from(data.toString('utf8').replace('<head>', `<head>\n    <script src="${clientPath}"></script>`)
            .replace('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css', iconsPath)
            .replace('新图片已保存到服务器。', '新图片已保存在当前浏览器。')
            .replace('迁移旧图片到服务器', '迁移旧图片到当前存档'));
    }
    fs.writeFileSync(target, data); assets.push(file);
}
function walk(dir) {
    for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const name = path.posix.join(dir, item.name);
        if (['assets/backgrounds', 'assets/app-icons'].includes(name)) continue;
        if (item.isSymbolicLink()) throw new Error('Public build cannot include symlinks: ' + name);
        if (item.isDirectory()) walk(name);
        else if (/\.(js|css|html|json|png|jpe?g|webp|svg|ico|woff2?)$/.test(name)) copy(name);
    }
}
walk('assets'); walk('apps'); copy('icon.png');
for (const folder of fs.readdirSync(path.join(root, 'apps'))) {
    const file = `apps/${folder}/manifest.json`;
    if (fs.existsSync(path.join(root, file))) seeds[file] = fs.readFileSync(path.join(root, file)).toString('base64');
}
let shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
shell = shell.replace('<head>', '<head>\n    <script src="browser-client.js"></script>')
    .replaceAll('href="/app-icon"', 'href="icon.png"').replaceAll('href="/manifest.webmanifest"', 'href="manifest.webmanifest"');
shell = shell.replace('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css', 'vendor/bootstrap-icons.css');
fs.writeFileSync(path.join(output, 'desktop.html'), shell); assets.push('desktop.html');
for (const [from, to] of [['browser/launcher.html', 'index.html'], ['browser/client.js', 'browser-client.js']]) {
    fs.copyFileSync(path.join(root, from), path.join(output, to)); assets.push(to);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
Object.assign(manifest, { name: 'BunnyOS 网页版', description: '保存在你自己浏览器里的小手机', start_url: './', scope: './', id: './' });
manifest.icons.forEach(icon => { icon.src = './icon.png'; });
fs.writeFileSync(path.join(output, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2)); assets.push('manifest.webmanifest');
fs.writeFileSync(path.join(output, '.nojekyll'), '');
for (const [from, to] of [['font/bootstrap-icons.min.css', 'vendor/bootstrap-icons.css'],
    ['font/fonts/bootstrap-icons.woff2', 'vendor/fonts/bootstrap-icons.woff2'], ['font/fonts/bootstrap-icons.woff', 'vendor/fonts/bootstrap-icons.woff'], ['LICENSE', 'vendor/bootstrap-icons-LICENSE.txt']]) {
    fs.mkdirSync(path.dirname(path.join(output, to)), { recursive: true });
    fs.copyFileSync(path.join(root, 'node_modules/bootstrap-icons', from), path.join(output, to)); assets.push(to);
}
fs.writeFileSync(path.join(output, 'tokenizer-o200k.json'), JSON.stringify(require('js-tiktoken/ranks/o200k_base')));
assets.push('tokenizer-o200k.json');
const aliases = {
    fs: 'browser/fs.js', path: 'node_modules/path-browserify/index.js', crypto: 'browser/crypto.js', express: 'browser/router.js',
    https: 'browser/unavailable.js', net: 'browser/network-address.js', dns: 'browser/network-address.js',
    'child_process': 'browser/unavailable.js', 'web-push': 'browser/unavailable.js',
    '@modelcontextprotocol/sdk/client/stdio.js': 'browser/unavailable.js'
};
const buildId = crypto.randomBytes(10).toString('hex');
esbuild.build({ entryPoints: [path.join(root, 'browser/worker.js')], outfile: path.join(output, 'browser-sw.js'),
    bundle: true, platform: 'browser', target: ['chrome100', 'safari16.4', 'firefox115'], format: 'iife', minify: true,
    inject: [path.join(root, 'browser/platform.js')],
    define: { __dirname: '"/app"', BUNNYOS_BROWSER: 'true', BROWSER_BUILD_ID: JSON.stringify(buildId) },
    plugins: [{ name: 'browser-platform', setup(build) {
        build.onResolve({ filter: /^(bunnyos-browser-seeds|bunnyos-browser-assets)$/ }, args => ({ path: args.path, namespace: 'generated' }));
        build.onLoad({ filter: /.*/, namespace: 'generated' }, args => ({ contents: 'module.exports = ' + JSON.stringify(args.path.endsWith('seeds') ? seeds : assets), loader: 'js' }));
        build.onResolve({ filter: /.*/ }, args => {
            if (aliases[args.path]) return { path: path.join(root, aliases[args.path]) };
            if (args.path === './modules/access-control') return { path: path.join(root, 'browser/access-control.js') };
            if (args.path === './modules/st-context/tokenizer') return { path: path.join(root, 'browser/tokenizer.js') };
        });
    } }]
}).then(() => console.log(`Browser build: ${output} (${assets.length} public assets; no user data)`)).catch(() => { process.exitCode = 1; });

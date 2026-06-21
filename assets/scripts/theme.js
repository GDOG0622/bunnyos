// 全局主题设置：壁纸、字体，以及传给 App iframe 的字体注入。
let bunnyThemeSettings = {};

function getWallpaperForViewport(settings = bunnyThemeSettings) {
    const isPortrait = window.innerWidth <= window.innerHeight;
    const type = isPortrait ? "portrait" : "landscape";
    const value = isPortrait ? settings.beauty_portraitWallpaper : settings.beauty_landscapeWallpaper;
    return normalizeWallpaperPath(value, type);
}

function normalizeWallpaperPath(value, type) {
    if (value && value !== "custom" && value !== "default") return value;
    return type === "portrait"
        ? "/assets/backgrounds/thin-back.png"
        : "/assets/backgrounds/wide-back.png";
}

function escapeCssUrl(url) {
    return String(url || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function removeNode(id, root = document) {
    root.getElementById(id)?.remove();
}

function getFontFormat(url) {
    const clean = String(url || "").split("?")[0].toLowerCase();
    if (clean.endsWith(".woff2")) return "woff2";
    if (clean.endsWith(".woff")) return "woff";
    if (clean.endsWith(".ttf")) return "truetype";
    if (clean.endsWith(".otf")) return "opentype";
    return "woff2";
}

function getCssFontFamily(url) {
    try {
        const family = new URL(url, window.location.href).searchParams.get("family");
        if (family) return `"${family.split(":")[0].replace(/\+/g, " ")}"`;
    } catch (e) {
        // 普通字符串或 Data URL 无法解析时，用默认约定名。
    }
    return '"BunnyCustomFont"';
}

function getPositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function getFontWeight(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 && number <= 1000 ? Math.round(number) : null;
}

function getTypographyRules(settings = bunnyThemeSettings, fontFamily = null) {
    const fontSize = getPositiveNumber(settings.beauty_fontSize);
    const fontWeight = getFontWeight(settings.beauty_fontWeight);
    const rules = [];

    if (fontFamily) {
        rules.push(`--bunny-font-family: ${fontFamily}, -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;`);
    }
    if (fontSize) {
        rules.push(`--bunny-font-size: ${fontSize}px;`);
    }
    if (fontWeight) {
        rules.push(`--bunny-font-weight: ${fontWeight};`);
    }

    const css = [];
    if (rules.length) {
        css.push(`:root { ${rules.join(" ")} }`);
    }
    if (fontFamily) {
        css.push(`
body,
body *:not(i):not(svg):not(path):not(.bi):not([class^="bi-"]):not([class*=" bi-"]),
button,
input,
textarea,
select {
    font-family: var(--bunny-font-family) !important;
}
`);
    }
    if (fontSize) {
        // 只控制正文字号；不碰 button / 图标，避免图标尺寸跟着字号缩放
        css.push(`body, input, textarea, select { font-size: var(--bunny-font-size) !important; }`);
    }
    if (fontWeight) {
        css.push(`body, button, input, textarea, select { font-weight: var(--bunny-font-weight) !important; }`);
    }

    return css.join("\n");
}

function injectFont(root, settings = bunnyThemeSettings) {
    const fontUrl = (settings.beauty_fontUrl || "").trim();
    removeNode("bunny-custom-font-css", root);
    removeNode("bunny-custom-font-style", root);

    if (!fontUrl) {
        const typographyRules = getTypographyRules(settings);
        if (typographyRules) {
            const style = root.createElement("style");
            style.id = "bunny-custom-font-style";
            style.textContent = typographyRules;
            root.head.appendChild(style);
        }
        return;
    }

    if (/\.css($|\?)/i.test(fontUrl)) {
        const link = root.createElement("link");
        link.id = "bunny-custom-font-css";
        link.rel = "stylesheet";
        link.crossOrigin = "anonymous";
        link.href = fontUrl;
        root.head.appendChild(link);

        const style = root.createElement("style");
        style.id = "bunny-custom-font-style";
        style.textContent = getTypographyRules(settings, getCssFontFamily(fontUrl));
        root.head.appendChild(style);
        return;
    }

    const style = root.createElement("style");
    style.id = "bunny-custom-font-style";
    style.textContent = `
@font-face {
    font-family: "BunnyCustomFont";
    src: url("${escapeCssUrl(fontUrl)}") format("${getFontFormat(fontUrl)}");
    font-style: normal;
    font-weight: normal;
    font-display: swap;
    unicode-range: U+0000-10FFFF;
}
${getTypographyRules(settings, '"BunnyCustomFont"')}
`;
    root.head.appendChild(style);
}

function injectDarkMode(root, enabled) {
    root.documentElement.classList.toggle("bunny-dark-mode", Boolean(enabled));
    let style = root.getElementById("bunny-dark-mode-style");
    if (!style) {
        style = root.createElement("style");
        style.id = "bunny-dark-mode-style";
        style.textContent = `
html.bunny-dark-mode {
    --text-main: #f5f5f7;
    --text-sub: #c7c7cc;
    --bg-color: #1c1c1e;
    --card-bg: #2c2c2e;
    --border-color: rgba(255,255,255,0.16);
    color-scheme: dark;
    background: #000;
}
html.bunny-dark-mode body {
    background-color: #000 !important;
    color: #f5f5f7 !important;
}
html.bunny-dark-mode body,
html.bunny-dark-mode body *:not(svg):not(path) {
    color: #f5f5f7 !important;
}
html.bunny-dark-mode input,
html.bunny-dark-mode textarea,
html.bunny-dark-mode select {
    background-color: #1c1c1e !important;
    color: #fff !important;
}
html.bunny-dark-mode .section,
html.bunny-dark-mode .list,
html.bunny-dark-mode .item,
html.bunny-dark-mode .window-content,
html.bunny-dark-mode .placeholder-ui {
    background-color: rgba(28,28,30,0.94) !important;
    border-color: rgba(255,255,255,0.16) !important;
}
html.bunny-dark-mode .mac-menu,
html.bunny-dark-mode .window-header {
    background-color: rgba(28,28,30,0.72) !important;
    border-color: rgba(255,255,255,0.14) !important;
}
html.bunny-dark-mode .chevron,
html.bunny-dark-mode .range-value {
    color: #c7c7cc !important;
}
`;
        root.head.appendChild(style);
    }
}

function applyThemeSettings(settings = bunnyThemeSettings) {
    bunnyThemeSettings = settings || {};
    window.bunnyThemeSettings = bunnyThemeSettings;

    const wallpaper = getWallpaperForViewport(bunnyThemeSettings);
    if (wallpaper) {
        document.body.style.backgroundImage = `url("${escapeCssUrl(wallpaper)}")`;
    } else {
        document.body.style.backgroundImage = "";
    }

    injectDarkMode(document, bunnyThemeSettings.beauty_darkMode);
    injectFont(document, bunnyThemeSettings);
    // 池里所有 iframe 都要刷
    document.querySelectorAll("#iframe-pool iframe").forEach(applyThemeToIframe);

    if (typeof window.renderApps === "function" && Array.isArray(window.installedApps)) {
        window.renderApps(window.installedApps);
    }
}

function applyThemeToIframe(iframe) {
    if (!iframe) return;
    try {
        const doc = iframe.contentDocument;
        if (doc?.head) {
            injectDarkMode(doc, bunnyThemeSettings.beauty_darkMode);
            injectFont(doc, bunnyThemeSettings);
        }
    } catch (e) {
        // 未来如果有跨域 App，跳过字体注入。
    }
}

async function loadThemeSettings() {
    try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const settings = await res.json();
        applyThemeSettings(settings);
        return settings;
    } catch (e) {
        console.warn("无法读取主题设置。", e);
        return {};
    }
}

window.bunnyThemeSettings = bunnyThemeSettings;
window.applyThemeSettings = applyThemeSettings;
window.applyThemeToIframe = applyThemeToIframe;
window.loadThemeSettings = loadThemeSettings;

window.addEventListener("resize", () => applyThemeSettings(bunnyThemeSettings));

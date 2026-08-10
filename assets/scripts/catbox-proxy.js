(function initBunnyCatboxProxy(global) {
    'use strict';

    const CATBOX_HOSTS = new Set(['catbox.moe', 'files.catbox.moe', 'litterbox.catbox.moe']);
    const PROXY_PREFIX = '/api/proxy/catbox?url=';
    const URL_ATTRS = ['src', 'href', 'poster'];
    const ATTR_FILTER = [...URL_ATTRS, 'srcset', 'style'];
    const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

    function isCatboxHost(hostname) {
        return CATBOX_HOSTS.has(String(hostname || '').toLowerCase());
    }

    function proxyUrl(originalUrl) {
        return `${PROXY_PREFIX}${encodeURIComponent(originalUrl)}`;
    }

    function rewriteUrl(raw, baseHref = global.location?.href) {
        const value = String(raw || '');
        if (!value || value.startsWith(PROXY_PREFIX)) return value;
        let parsed;
        try { parsed = new URL(value, baseHref); } catch { return value; }
        if (!/^https?:$/.test(parsed.protocol) || !isCatboxHost(parsed.hostname)) return value;
        return proxyUrl(parsed.toString());
    }

    function rewriteCssText(cssText) {
        const text = String(cssText || '');
        if (!text.toLowerCase().includes('catbox')) return text;
        return text.replace(CSS_URL_RE, (whole, quote, url) => {
            const next = rewriteUrl(url);
            return next === url ? whole : `url(${quote}${next}${quote})`;
        });
    }

    function rewriteSrcset(value) {
        return String(value || '').split(',').map((part) => {
            const trimmed = part.trim();
            if (!trimmed) return part;
            const spaceAt = trimmed.search(/\s/);
            const url = spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt);
            const descriptor = spaceAt === -1 ? '' : trimmed.slice(spaceAt);
            return `${rewriteUrl(url)}${descriptor}`;
        }).join(', ');
    }

    function rewriteElement(element) {
        if (!element || element.nodeType !== 1 || element.tagName === 'BASE') return;
        if (element.tagName === 'STYLE') {
            const next = rewriteCssText(element.textContent);
            if (next !== element.textContent) element.textContent = next;
            return;
        }
        for (const attr of URL_ATTRS) {
            const value = element.getAttribute?.(attr);
            if (!value) continue;
            const next = rewriteUrl(value);
            if (next !== value) element.setAttribute(attr, next);
        }
        const srcset = element.getAttribute?.('srcset');
        if (srcset) {
            const next = rewriteSrcset(srcset);
            if (next !== srcset) element.setAttribute('srcset', next);
        }
        const style = element.getAttribute?.('style');
        if (style) {
            const next = rewriteCssText(style);
            if (next !== style) element.setAttribute('style', next);
        }
    }

    function rewriteWithin(root) {
        if (!root) return;
        if (root.nodeType === 1) rewriteElement(root);
        root.querySelectorAll?.(
            '[src*="catbox" i],[href*="catbox" i],[poster*="catbox" i],[srcset*="catbox" i],[style*="catbox" i],style',
        ).forEach(rewriteElement);
    }

    let observer = null;
    function start(documentRef = global.document) {
        if (observer || !documentRef?.documentElement) return observer;
        const pending = new Set();
        let flushHandle = 0;
        const flush = () => {
            flushHandle = 0;
            const items = Array.from(pending);
            pending.clear();
            items.forEach((node) => {
                if (node.isConnected) rewriteWithin(node);
            });
        };
        const schedule = () => {
            if (flushHandle) return;
            flushHandle = typeof global.requestAnimationFrame === 'function'
                ? global.requestAnimationFrame(flush)
                : global.setTimeout(flush, 16);
        };
        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    pending.add(mutation.target);
                    continue;
                }
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) pending.add(node);
                    else if (node.nodeType === 3 && node.parentElement?.tagName === 'STYLE') pending.add(node.parentElement);
                });
            }
            if (pending.size) schedule();
        });
        rewriteWithin(documentRef.documentElement);
        observer.observe(documentRef.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ATTR_FILTER,
        });
        return observer;
    }

    global.BunnyCatboxProxy = { isCatboxHost, proxyUrl, rewriteUrl, rewriteCssText, rewriteWithin, start };
    if (global.document?.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', () => start(), { once: true });
    } else {
        start();
    }
})(window);

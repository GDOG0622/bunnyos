# Architecture

## Entrypoints

- Desktop shell: `index.html`
- Backend: `server.js`
- Global settings: `settings.json`
- App folders: `apps/*`
- Main styles/scripts: `assets/styles/*.css`, `assets/scripts/*.js`

## Desktop App Model

The desktop scans `apps/*/manifest.json` through `GET /api/apps`.

Important manifest behavior:

- `entry` maps to `apps/<folder>/<entry>`.
- `hidden: true` hides an App from the desktop list.
- `apps/prompt-manager/manifest.json` is hidden because prompt-manager is QQ-internal.

`assets/scripts/apps.js` has a fallback `defaultApps` list for backend failures. Keep this fallback aligned with visible Apps.

## Window Behavior

`assets/scripts/window-manager.js` owns app window open/close, iframe mounting, fullscreen behavior, and layout mode propagation.

`updateAppLayoutMode()` writes layout state to both:

- outer `#app-window.dataset.appLayout`
- same-origin iframe `documentElement.dataset.appLayout`

Use CSS selectors such as:

```css
html[data-app-layout="desktop"] ...
html[data-app-layout="mobile"] ...
```

Do not infer App layout only from browser viewport width.

## Current App Roles

| Folder | Role |
| --- | --- |
| `apps/settings/` | Global settings and API config. Still contains old browser `alert` calls. |
| `apps/QQ/` | Main chat App and current product focus. |
| `apps/prompt-manager/` | QQ-internal prompt manager loaded in a QQ iframe modal. |
| `apps/suki/`, `apps/X/` | Placeholder Apps. |

## Server Restart

After editing `server.js`, restart the local `node server.js` process. Running servers do not pick up changes automatically.

# BunnyOS Architecture

BunnyOS is a local “小手机” Apple-OS-style AI chat shell, also called 萝卜机. The project separates App code, user data, and global settings:

- `apps/` contains installable App packages.
- `data/` contains character, chat, preset, persona, world, and backup data.
- `settings.json` stores global settings.
- `assets/` contains desktop CSS/JS plus user-facing uploaded wallpapers and App icons.

## Startup

Use:

```bash
npm install
npm start
```

Open `http://localhost:3000/index.html`.

`package.json` defines dependencies and scripts. `npm start` runs `node server.js`. `package-lock.json` locks dependency versions.

## File Map

```text
BunnyOS/
├─ index.html
├─ server.js
├─ settings.json
├─ assets/
│  ├─ backgrounds/
│  ├─ app-icons/
│  ├─ styles/base.css, desktop.css, window.css
│  └─ scripts/theme.js, apps.js, window-manager.js, clock.js
├─ apps/
│  ├─ settings/index.html, styles.css, settings.js, manifest.json
│  ├─ QQ/manifest.json
│  ├─ suki/manifest.json
│  ├─ X/manifest.json
│  └─ prompt-manager/manifest.json
└─ data/
   ├─ characters/
   ├─ chats/
   ├─ presets/image-prompts.json
   ├─ userpersonas/
   ├─ worlds/
   ├─ assets/
   └─ backups/
```

## Responsibilities

| Path | Role |
| --- | --- |
| `index.html` | Main BunnyOS desktop shell, status bars, App window, iframe mount. |
| `server.js` | Express static server and JSON/API persistence. |
| `settings.json` | Global settings persisted by the Settings App. |
| `assets/scripts/apps.js` | Load `/api/apps`, render desktop App icons, apply icon overrides. |
| `assets/scripts/window-manager.js` | Open/close/fullscreen/resize/move App window and handle iframe messages. |
| `assets/scripts/theme.js` | Apply global wallpaper, font, dark mode, and icon theme settings. |
| `apps/settings/` | Settings App UI and logic. |
| `apps/*/manifest.json` | App package metadata consumed by `/api/apps`. |

## App Package Manifest

Each App folder has a `manifest.json`:

```json
{
  "id": "settings",
  "name": "设置",
  "entry": "index.html",
  "icon": "bi-gear-fill",
  "bg": "bg-settings",
  "iconColor": "#8E8E93",
  "order": 10
}
```

`server.js` adds:

- `folder`: folder name under `apps/`
- `entryUrl`: iframe-ready path such as `apps/settings/index.html`

Empty `entry` means the desktop opens the built-in placeholder UI.


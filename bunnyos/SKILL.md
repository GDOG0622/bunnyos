---
name: bunnyos
description: Use when working on the BunnyOS local Apple-OS-style AI chat shell, also called 萝卜机 or 小手机, including desktop UI, app windows, settings app, persistent settings, asset uploads, app manifests, storage layout, backend routes, or BunnyOS README/architecture maintenance.
---

# BunnyOS

Use this skill when the task touches the BunnyOS project. Treat it as a project onboarding and maintenance guide for future AI agents.

## First Steps

1. Work in the BunnyOS repository root, usually `D:\OneDrive\BunnyOS`.
2. Read project docs and Chinese Markdown as UTF-8.
3. If a request is ambiguous or could produce the wrong architecture, ask the user before guessing.
4. Prefer the existing split files and naming patterns over creating new architecture.
5. After code edits, run focused checks such as `node --check server.js`, `node --check assets/scripts/theme.js`, or `node --check apps/settings/settings.js`.

## What To Read

Open only the reference that matches the task:

| Task | Reference |
| --- | --- |
| Overall file map, project purpose, or App package concept | `references/architecture.md` |
| `server.js`, `/api/*`, uploads, JSON persistence | `references/api-routes.md` |
| Desktop icons, window frame, resize/move, iframe communication | `references/desktop-window.md` |
| Settings UI, API page, beauty page, form save logic | `references/settings-app.md` |
| `settings.json`, `data/`, wallpapers, icons, persistent asset naming | `references/storage.md` |

## Editing Targets

- Main desktop shell: `index.html`, `assets/styles/*.css`, `assets/scripts/apps.js`, `assets/scripts/window-manager.js`, `assets/scripts/theme.js`, `assets/scripts/clock.js`.
- Settings app: `apps/settings/index.html`, `apps/settings/styles.css`, `apps/settings/settings.js`.
- Backend and persistence: `server.js`, `settings.json`, `data/presets/image-prompts.json`, `assets/backgrounds/`, `assets/app-icons/`.
- Installed App metadata: `apps/*/manifest.json`.

## Validation

- Static JavaScript checks:
  - `node --check server.js`
  - `node --check apps/settings/settings.js`
  - `node --check assets/scripts/theme.js`
  - `node --check assets/scripts/window-manager.js`
- Local app URL: `http://127.0.0.1:3000` or `http://localhost:3000/index.html`.
- If backend routes changed, restart `node server.js`; an already running process will not pick up changes.


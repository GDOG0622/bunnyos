---
name: bunnyos
description: Maintain the BunnyOS local Apple-OS-style AI chat shell, also called 萝卜机 or 小手机. Use when working on BunnyOS desktop/window behavior, QQ chat UI, QQ user personas, SillyTavern-compatible prompt presets, worldbook/summary systems, JSON storage, localhost API routes, README/roadmap maintenance, or project-specific UI conventions.
---

# BunnyOS

Use this skill for BunnyOS maintenance. Work in `D:\OneDrive\BunnyOS` unless the user says otherwise.

## Always

1. Read Chinese Markdown as UTF-8.
2. Read `references/status.md` before planning substantial work.
3. Read `references/roadmap.md` when the user asks what to do next or asks to update planning.
4. Then read only the topic reference matching the task.
5. Prefer the existing split files and API/data patterns over new architecture.
6. Do not revert user changes. Treat the working tree as potentially dirty.

## Routing

| Task | Read |
| --- | --- |
| Current completed work, avoid redoing old tasks | `references/status.md` |
| Next steps, priorities, planning cleanup | `references/roadmap.md` |
| Project map, desktop shell, App manifest/window behavior | `references/architecture.md` |
| QQ UI, chat, personas, message actions | `references/qq.md` |
| Prompt presets, markers, variables, worldbook/summary | `references/prompt-system.md` |
| API routes, JSON files, persistent settings | `references/storage-api.md` |
| Visual behavior, modals, layout preferences | `references/ui-conventions.md` |

## Hard Rules

- `apps/prompt-manager/` is QQ-internal. Do not treat it as a standalone desktop App.
- QQ current prompt preset is saved in `data/qq/settings.json` as `currentPromptPresetId`.
- QQ current user persona is saved in `data/qq/settings.json` as `currentPersonaId`.
- Do not use browser-native `prompt`, `confirm`, or `alert` in QQ or prompt-manager.
- Prompt-manager main screen opens full-screen inside QQ; its edit/preview/input/confirm dialogs are centered cards.
- If `server.js` changes, restart the local server before claiming runtime behavior is updated.

## Validation

Run focused checks based on touched files:

```powershell
D:\NodeJS\node.exe --check server.js
D:\NodeJS\node.exe --check apps\QQ\scripts\<changed>.js
D:\NodeJS\node.exe --check apps\prompt-manager\prompt-manager.js
D:\NodeJS\node.exe --check assets\scripts\window-manager.js
```

Local URL: `http://127.0.0.1:3000/index.html`.

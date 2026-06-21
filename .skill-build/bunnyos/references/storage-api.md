# Storage And API

## Storage Layout

| Path | Purpose |
| --- | --- |
| `settings.json` | Global settings, theme, API config. |
| `data/qq/settings.json` | QQ-specific settings such as `currentPersonaId` and `currentPromptPresetId`. |
| `data/userpersonas/` | One user persona JSON per file. Chinese names are allowed; invalid filename chars are sanitized. |
| `data/characters/` | QQ character/friend JSON files. |
| `data/chats/qq/` | QQ one-on-one chat JSON files. |
| `data/qq/groups.json` | QQ group list. |
| `data/qq/sticker-packs.json` | QQ sticker pack definitions. |
| `data/presets/st-presets/` | SillyTavern-compatible preset work copies. |
| `data/presets/st-presets-settings.json` | Prompt-manager global current preset. |
| `data/worlds/worldbooks.json` | Simplified worldbook list. |
| `data/assets/avatars/` | Character and user persona avatar files. |

## Important API Routes

| Route | Purpose |
| --- | --- |
| `GET /api/apps` | Visible App manifests; skips `hidden: true`. |
| `GET/POST /api/settings` | Global settings. |
| `GET /api/st-presets` | List ST preset work copies. |
| `GET/POST /api/st-presets/:id` | Read/save a preset. |
| `POST /api/st-presets/:id/refresh-default` | Overwrite work copy from source `Liminal_online.json`. |
| `POST /api/st-presets/current` | Set prompt-manager global current preset. |
| `GET/POST /api/qq/prompt-preset` | Read/set QQ current prompt preset. |
| `GET/POST/PUT/DELETE /api/userpersonas` | User persona management. |
| `GET/POST/PUT/DELETE /api/qq/characters` | QQ character/friend management. |
| `GET/POST /api/qq/chats/:characterId` | Read/save chat history. |
| `POST /api/qq/reply` | Generate QQ assistant reply. |
| `GET/POST /api/worldbooks` | Simplified worldbook storage. |
| `POST /api/prompt/render` | Render prompt variables. |

## Storage Guidance

Keep the current localhost API + JSON-file pattern for now. If data grows, consider adding SQLite behind the API for indexing/search while preserving JSON import/export for portability and manual edits.

Do not let frontend code write files directly; route persistence through `server.js` APIs.

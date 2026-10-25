# BunnyOS Backend And API Routes

Backend file: `server.js`.

The server uses Express on `PORT` (default `3000`). Authenticated static serving exposes frontend files and sandboxed media only. User data and PM2 configuration live in `BUNNYOS_STORAGE_DIR`, outside the program directory.

## Important Constants

| Constant | Path |
| --- | --- |
| `APPS_DIR` | `apps/` |
| `STORAGE_ROOT` | `BUNNYOS_STORAGE_DIR`, default `<code-directory>-data` |
| `DATA_DIR` | `data/` |
| `ASSETS_DIR` | `assets/` |
| `BACKGROUNDS_DIR` | `assets/backgrounds/` |
| `APP_ICONS_DIR` | `assets/app-icons/` |
| `SETTINGS_FILE` | `settings.json` |
| `PRESETS_FILE` | `data/presets/image-prompts.json` |

`ensureFileExist(filePath, defaultData = {})` creates missing parent directories and JSON files.
All paths except `APPS_DIR` in the table are relative to `STORAGE_ROOT`.

## Routes

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/api/apps` | Scan `apps/*/manifest.json`, add `folder` and `entryUrl`, sort by `order`. |
| `GET` | `/api/settings` | Read settings and `_version`. |
| `PATCH` | `/api/settings` | Apply `{version, changes}`; reject stale writes with 409. |
| `PATCH` | `/api/worldbooks/books/:id` | Apply versioned name/entries changes to one book. |
| `POST` | `/api/qq/prompt-preview` | Build the selected preset against a character's saved chat using the generation context builder. |
| `POST` | `/api/qq/reply` | Generate, validate chat version and save structured reply versions before responding or notifying. |
| `GET / PATCH` | `/api/tools` | Read redacted tool configuration / update with version; chat tool use defaults off. |
| `POST / PUT / DELETE` | `/api/tools/servers[/:id]` | Manage versioned MCP connections; secrets are not echoed. |
| `POST` | `/api/tools/servers/:id/test` | Connect through SDK and discover tools. |
| `GET / POST` | `/api/tools/actions`, `/api/tools/actions/:id/decide` | Read execution records / approve or reject one immutable, expiring action. |
| `GET / POST` | `/api/reminders`, `/api/reminders/:id/cancel` | Read, create and cancel persistent reminders. |
| `GET` | `/api/reminders/events` | Authenticated SSE for foreground reminders. |
| `GET / PATCH` | `/api/suki/:characterId` | Read or configure a versioned character couple space. |
| `POST` | `/api/suki/:characterId/{entries,anniversaries,wishes,mood,pet,answer,generate}` | Add records, update daily interactions or ask the configured role to respond. |
| `POST` | `/api/suki/image` | Persist a diary photo using the existing protected image asset store. |
| `POST` | `/api/assets/upload` | Upload beauty assets from image Data URLs. |
| `GET` | `/api/qq/chats?summary=1` | Return chat metadata, last message, message count, and favorite count without returning full histories. |
| `GET` | `/api/qq/chats/:characterId` | Return one complete chat after the user opens it. |
| `GET` | `/api/proxy/catbox?url=...` | Stream Catbox resources through a strict host allowlist; try VPS direct, then the carrot Cloudflare Worker, then wsrv for supported images. |
| `GET` | `/api/presets` | Read `data/presets/image-prompts.json`. |
| `POST` | `/api/presets` | Replace `data/presets/image-prompts.json` with request body. |

## Asset Upload Rules

`/api/assets/upload` accepts JSON:

```json
{
  "type": "background",
  "slot": "portrait",
  "dataUrl": "data:image/png;base64,..."
}
```

or:

```json
{
  "type": "app-icon",
  "appId": "settings",
  "dataUrl": "data:image/png;base64,..."
}
```

Rules:

- JSON body limit is currently `200mb`.
- Only image Data URLs are accepted.
- Backgrounds are slot based:
  - portrait -> `assets/backgrounds/thin-back.<ext>`
  - landscape -> `assets/backgrounds/wide-back.<ext>`
- Uploading a background deletes older files for the same slot before writing the new one.
- App icons use unique filenames:
  - `assets/app-icons/<safeAppId>-<timestamp>-<random>.<ext>`
- Response returns a static URL path stored in `settings.json`.

If `server.js` changes, restart the backend. A running `node server.js` process will not reload route or body-limit changes.

## Catbox Resource Proxy

`assets/scripts/catbox-proxy.js` rewrites Catbox URLs only when rendering them; saved character, sticker, beauty, and font URLs remain unchanged. The script covers `src`, `href`, `poster`, `srcset`, inline styles, and CSS `url(...)` values in the desktop, QQ, Settings, and Prompt Manager documents.

The backend route accepts only HTTPS URLs on `catbox.moe`, `files.catbox.moe`, or `litterbox.catbox.moe`. It streams without disk caching, limits each response to 30MB, applies a five-minute direct-connect circuit breaker, and falls back to `BUNNYOS_CATBOX_RELAY_URL` or the shared carrot Worker.

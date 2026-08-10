# BunnyOS Backend And API Routes

Backend file: `server.js`.

The server uses Express on fixed port `3000` and serves the entire project root through:

```js
app.use(express.static(path.join(__dirname)));
```

## Important Constants

| Constant | Path |
| --- | --- |
| `APPS_DIR` | `apps/` |
| `DATA_DIR` | `data/` |
| `ASSETS_DIR` | `assets/` |
| `BACKGROUNDS_DIR` | `assets/backgrounds/` |
| `APP_ICONS_DIR` | `assets/app-icons/` |
| `SETTINGS_FILE` | `settings.json` |
| `PRESETS_FILE` | `data/presets/image-prompts.json` |

`ensureFileExist(filePath, defaultData = {})` creates missing parent directories and JSON files.

## Routes

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/api/apps` | Scan `apps/*/manifest.json`, add `folder` and `entryUrl`, sort by `order`. |
| `GET` | `/api/settings` | Read root `settings.json`. |
| `POST` | `/api/settings` | Replace root `settings.json` with request body. |
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

- JSON body limit is currently `100mb`.
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

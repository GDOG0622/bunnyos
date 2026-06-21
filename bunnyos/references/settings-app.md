# BunnyOS Settings App

Settings App files:

- `apps/settings/index.html`: DOM structure and inline event attributes.
- `apps/settings/styles.css`: Settings-only visual styles.
- `apps/settings/settings.js`: All settings logic.

The Settings App runs in `#app-iframe` and persists via backend APIs.

## Page IDs

Each screen is a `.page`:

| ID | Page |
| --- | --- |
| `page-main` | Settings main menu. |
| `page-api` | General API. |
| `page-beauty` | Wallpaper, icon, font, dark mode. |
| `page-image` | Image generation settings. |
| `page-voice` | Voice settings. |
| `page-storage` | Storage placeholder. |
| `page-about` | About placeholder. |

## Navigation

- `navTo(pageId)`: slide into another `.page`, push current page to `pageHistory`.
- `navBack()`: return one level; on main page, parent back closes the App.
- `notifyNavigationState()`: post `{ type: "bunnyos:navigation-state", title, canGoBack }` to parent.

Because `index.html` still uses `onclick` / `oninput` attributes, `settings.js` must expose handler functions on `window` near the end of the file.

## Saving

`settings` is loaded from `/api/settings`.

`saveData()` scans:

```js
document.querySelectorAll('input:not(#preset_name):not([type="file"]), textarea, select')
```

It writes each element by `id` into `settings`, preserves checkbox booleans, posts `/api/settings`, then sends `bunnyos:theme-updated` to the parent.

`presets` is loaded from `/api/presets` and saved to `data/presets/image-prompts.json`.

## General API Page

The API page includes:

- API config library: `apiConfig_select`, save/edit/delete buttons.
- API input area: `apiConfig_url`, `apiConfig_key`, `apiConfig_model`, connect/test buttons.
- Main API and Sub API cards, side-by-side on wide screens.

Saved API configs live in `settings.apiConfigs`:

```json
{
  "配置名": {
    "url": "https://example.com/v1",
    "key": "sk-...",
    "model": "model-id"
  }
}
```

Important functions:

- `renderApiConfigSelects()`
- `loadApiConfigToEditor()`
- `saveApiConfig()`
- `editApiConfig()`
- `deleteApiConfig()`
- `applyApiConfig(prefix)`
- `connectApiConfig()`
- `testApiConfig()`

## Beauty Page

Beauty settings include:

- `beauty_darkMode`: global dark mode.
- `beauty_portraitWallpaper`: path to portrait wallpaper.
- `beauty_landscapeWallpaper`: path to landscape wallpaper.
- `appIconOverrides`: App id -> icon path.
- `beauty_fontUrl`: global font URL, direct font file or CSS URL.
- `beauty_fontSize`: number, applied in px.
- `beauty_fontWeight`: number such as 100, 200, 400.
- `beautyPresets.icon` / `beautyPresets.font`: saved beauty presets.

Important functions:

- `uploadAsset(payload)`: call `/api/assets/upload`.
- `handleWallpaperUpload(type, input)`: upload portrait/landscape wallpaper and write returned path.
- `loadBeautyApps()` / `renderIconGrid()`: fetch `/api/apps` and create one icon upload tile per App.
- `handleAppIconUpload(input)`: upload icon for selected App id and update `appIconOverrides`.
- `saveBeautyPreset(type)` / `applyBeautyPreset(type)` / `renameBeautyPreset(type)` / `deleteBeautyPreset(type)`.

Settings UI should follow the existing iOS/macOS-inspired thin rows. Avoid making large chunky bars or oversized icons.


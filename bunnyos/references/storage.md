# BunnyOS Storage And Assets

BunnyOS is single-user. Persistent state should live in local project files, not browser `localStorage`.

## Primary Storage

| Path | Purpose |
| --- | --- |
| `settings.json` | Global settings saved by Settings App. |
| `data/characters/` | Character cards. |
| `data/chats/` | Chat histories. |
| `data/presets/image-prompts.json` | Image prompt presets. |
| `data/userpersonas/` | User personas. |
| `data/worlds/` | World/lorebook data. |
| `data/assets/` | Media resource pool for future user/imported assets. |
| `data/backups/` | Backups. |
| `assets/backgrounds/` | Currently used desktop wallpaper files. |
| `assets/app-icons/` | Currently used uploaded App icon files. |

## Settings Fields

Important `settings.json` fields:

| Field | Meaning |
| --- | --- |
| `apiConfigs` | Saved API configs by name. |
| `mainApi_*` / `subApi_*` | Main/sub API runtime config. |
| `beauty_darkMode` | Global dark mode. |
| `beauty_portraitWallpaper` | Static path to portrait wallpaper. |
| `beauty_landscapeWallpaper` | Static path to landscape wallpaper. |
| `appIconOverrides` | Object mapping App id to uploaded icon path. |
| `beauty_fontUrl` | Global font URL. |
| `beauty_fontSize` | Global font size in px. |
| `beauty_fontWeight` | Global font weight number. |
| `beautyPresets` | Saved icon/font beauty presets. |
| `voice_*` | Voice provider settings. |
| `image_*` | Image generation provider settings. |
| `prompt_*` | Prompt editing and selected preset state. |

## Wallpaper Naming

Wallpapers are fixed slots:

- Portrait / narrow: `assets/backgrounds/thin-back.<ext>`
- Landscape / wide: `assets/backgrounds/wide-back.<ext>`

Uploading a new image for a slot removes old files with the same slot prefix, then writes the new file. `settings.json` stores the returned path. `theme.js` also falls back to `/assets/backgrounds/thin-back.png` and `/assets/backgrounds/wide-back.png` for empty, `custom`, or `default` legacy values.

## App Icon Naming

App icon filenames must be unique:

```text
assets/app-icons/<safeAppId>-<timestamp>-<random>.<ext>
```

`settings.appIconOverrides` maps App id to the static path:

```json
{
  "settings": "/assets/app-icons/settings-1710000000000-ab12cd.png"
}
```

The desktop reads this object when rendering icons. Adding a new App manifest automatically adds a new tile to the Settings beauty page icon grid.

## Theme Application

`assets/scripts/theme.js` reads settings and applies:

- wallpaper based on viewport orientation
- custom font direct files through `@font-face`
- CSS font links through `<link rel="stylesheet">`
- font size and weight through injected CSS variables
- dark mode rules to parent document and same-origin iframe
- App icon overrides by triggering `renderApps(installedApps)`


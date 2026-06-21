# BunnyOS Desktop And Window System

Main files:

- `index.html`
- `assets/styles/base.css`
- `assets/styles/desktop.css`
- `assets/styles/window.css`
- `assets/scripts/apps.js`
- `assets/scripts/window-manager.js`
- `assets/scripts/theme.js`
- `assets/scripts/clock.js`

## Desktop Modes

BunnyOS simulates two shells:

- Narrow screen: iPhone-like home screen, compact icons, full-screen App window.
- Wide screen: macOS-like menu bar, left vertical App bar, App window.

In wide screen, opening an App defaults to fullscreen and covers the BunnyOS desktop top bar. The red/yellow/green controls appear only when the cursor enters the top hotzone.

## Main DOM

| Selector | Meaning |
| --- | --- |
| `.mobile-status` | Narrow-screen status bar. |
| `.mac-menu` | Wide-screen menu bar. |
| `#mobile-desktop` | App icon container; grid on narrow screen, left vertical bar on wide screen. |
| `#app-window` | Outer App window shell. |
| `.window-header` | Window header/title/back/control area. |
| `.mac-controls` | Red/yellow/green controls. |
| `.control-hotzone` | Small top-left hover region that reveals controls in fullscreen. |
| `#placeholder-ui` | Built-in placeholder for Apps without `entryUrl`. |
| `#app-iframe` | Same-origin App iframe. |
| `.resize-handle` | Eight resize handles for non-fullscreen desktop windows. |

## Key Functions

From `assets/scripts/apps.js`:

- `loadApps()`: fetch `/api/apps`, fallback to `defaultApps`.
- `renderApps(apps)`: render icons into `#mobile-desktop`.
- `createAppItem(app)`: build one desktop icon, applying `settings.appIconOverrides` when present.

From `assets/scripts/window-manager.js`:

- `openApp(app)`: reset window state, load iframe or placeholder.
- `closeApp()`: close active window and clear fullscreen/show-controls state.
- `toggleFullscreen()`: green control behavior on wide screen.
- `handleMobileBack()`: send `bunnyos:navigate-back` to iframe if possible, otherwise close App.
- `startResize(event)`: resize non-fullscreen windows with pointer events and `requestAnimationFrame`.
- `startMove(event)`: drag non-fullscreen window by header.
- `updateAppLayoutMode()`: write `data-app-layout="mobile|desktop"` to the outer window and same-origin iframe document element.

## Iframe Communication

Settings and future Apps can send:

```js
window.parent.postMessage({
  type: "bunnyos:navigation-state",
  title: "设置 / 美化",
  canGoBack: true
}, "*");
```

The parent stores `canGoBack` and updates `#window-title`.

The parent can send:

```js
iframe.contentWindow.postMessage({ type: "bunnyos:navigate-back" }, "*");
```

Settings listens for this and calls its internal `navBack()`.

Theme updates use:

```js
window.parent.postMessage({ type: "bunnyos:theme-updated", settings }, "*");
```

The parent then calls `applyThemeSettings(settings)`.

## Performance Note

During resize/move, `#app-window` gets `.resizing`; CSS disables transitions and iframe pointer events. Keep pointermove handlers write-only where possible. Do not repeatedly read iframe layout inside pointermove.


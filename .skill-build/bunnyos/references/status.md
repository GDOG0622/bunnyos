# Current Status

Use this before planning so completed work is not repeated.

## Completed

- BunnyOS Apple-style desktop shell, App scanning, iframe window mounting.
- Global custom font injection into root and same-origin iframes; recommend `.woff2`.
- QQ Telegram-like UI: left rail in landscape, right main region, chat list/chat panel split, fixed chat header, Telegram-style bubbles.
- QQ contacts/friends, character edit, avatar upload, local chat JSON files.
- QQ user personas:
  - `data/userpersonas/<name>.json`, one persona per file.
  - current QQ persona stored in `data/qq/settings.json` as `currentPersonaId`.
  - persona UI in QQ “我” page, account switcher, delete/new persona, inline signature edit.
- QQ message features:
  - local messages, image/sticker/transfer messages
  - right-click/long-press action bar
  - edit/favorite/delete/reply draft
  - reply group versions and reroll/swipe only on the latest assistant reply group
  - batch delete mode
- Prompt manager:
  - SillyTavern-compatible preset UI
  - prompt order drag/sort
  - built-in locked marker entries
  - group creation by selecting two endpoints
  - read-only row viewer
  - single text assembly preview with `<!-- role · name -->` comments and no numeric ordering
  - project-native centered input/confirm/edit/preview dialogs
- Prompt manager is QQ-internal:
  - desktop App entry hidden
  - QQ “我” page opens prompt manager full-screen inside QQ
  - prompt-manager edit/preview/input/confirm dialogs remain centered cards
- QQ prompt preset selection:
  - UI in QQ “我” page below wallet
  - stored in `data/qq/settings.json` as `currentPromptPresetId`
  - `/api/qq/reply` prefers QQ current ST preset and falls back to legacy backend prompt if needed
- Prompt variables include base time/user/char plus char/user prompt fields and `{{lastmes}}`.

## Known Not Done

- Worldbook keyword/condition matching is not connected to QQ replies yet.
- Summary module is represented by a locked marker but has no generation/update flow.
- `rp_rules` tail emphasis exists, but true post-history/tail injection still needs refinement.
- `reply_to` is saved in messages but not yet injected into prompts.
- Prompt groups cannot yet be moved as whole groups and group-internal drag is limited.
- Settings App still has browser-native `alert` calls.

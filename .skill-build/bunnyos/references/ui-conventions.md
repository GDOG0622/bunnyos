# UI Conventions

## General

- Use project-native modals/toasts, not browser-native `prompt`, `confirm`, or `alert`, in QQ and prompt-manager.
- Keep UI text inside buttons compact. Prefer icons for obvious actions.
- Use existing icon libraries such as Bootstrap Icons or lucide if already present.
- Avoid nested cards and decorative gradients unless the existing design requires them.

## QQ

- Landscape layout: left rail and right content are separate regions.
- Rail top avatar is the user persona entry.
- Contacts page can show an add button by search; messages page should not show a global plus.
- Chat header stays at top of the right conversation panel.
- Do not show user signature/name in the removed global desktop topbar area.
- Message actions should not resize or shift bubbles.

## Prompt Manager

- Prompt manager main screen is full-screen inside QQ.
- Prompt row click opens read-only actual sent content.
- Pencil icon opens edit only for editable entries.
- Edit/preview/input/confirm dialogs are centered cards, not full-screen.
- Assembly preview may include comments like `<!-- system · 条目名 -->`, but must not add numeric order prefixes.
- Locked marker entries are visible and draggable but not editable/copyable/deletable.

## Modals

Use centered dialogs for:

- input text such as group names or preset names
- confirm destructive operations
- prompt-manager edit/preview

Full-screen panels are acceptable for:

- QQ prompt manager main screen
- full edit pages that behave as app pages, not temporary dialogs

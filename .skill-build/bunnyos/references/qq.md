# QQ App

## Files

| File | Role |
| --- | --- |
| `apps/QQ/index.html` | QQ structure, panels, modals, chat input, “我” page. |
| `apps/QQ/styles.css` | QQ visual system, landscape layout, bubbles, modals. |
| `apps/QQ/QQ.js` | DOMContentLoaded initialization. |
| `apps/QQ/scripts/state.js` | Shared state and constants. |
| `apps/QQ/scripts/utils.js` | Dialogs, toast, escaping, helpers. |
| `apps/QQ/scripts/navigation.js` | Tabs, menus, parent navigation state. |
| `apps/QQ/scripts/api.js` | Initial data loading. |
| `apps/QQ/scripts/personas.js` | User persona UI and account switching. |
| `apps/QQ/scripts/prompt-settings.js` | QQ prompt preset selector and prompt-manager launch. |
| `apps/QQ/scripts/contacts.js` | Contacts, groups, friend editor. |
| `apps/QQ/scripts/chat-render.js` | Chat list and message rendering. |
| `apps/QQ/scripts/message-actions.js` | Sending, generation, reroll/swipe, edit/delete/reply. |
| `apps/QQ/scripts/media.js` | Emoji, stickers, image, transfer. |
| `apps/QQ/scripts/events.js` | DOM event binding. |

## UI Rules

- Landscape QQ has one left rail region and one right main region.
- The rail top avatar is the current user persona entry.
- Only contacts page has the add-friend plus button near search.
- Message list page does not show the global plus.
- “我” page includes avatar, name, status, signature, wallet, prompt preset selector, prompt manager, switch account.
- Prompt manager opens full-screen inside QQ.
- Prompt manager internal edit/preview/input/confirm dialogs are centered cards.
- Do not use browser-native dialogs in QQ.

## Message Rules

- Reroll/swipe buttons show only for the last assistant reply group / latest assistant message.
- If later messages are deleted and the new tail is an assistant reply, actions become visible for that new tail.
- User messages store a `persona` snapshot so later account switches do not rewrite old messages.
- `reply_to` exists but still needs prompt injection.

## User Personas

- Persona files: `data/userpersonas/<name>.json`
- Current QQ persona: `data/qq/settings.json` -> `currentPersonaId`
- `status`, `signature`, and `note` are UI-only and not injected into prompt.

Injected user prompt shape:

```text
<user_info>
名字：xxx
性别：xxx
生日：xxx
用户人设：xxx
</user_info>
```

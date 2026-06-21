# Prompt System

## Prompt Manager

`apps/prompt-manager/` is QQ-internal. It is not a standalone desktop App.

QQ opens it at:

```text
/apps/prompt-manager/index.html?embedded=qq
```

Main screen is full-screen inside QQ. Its edit/preview/input/confirm dialogs are centered cards.

## SillyTavern Presets

- Source preset: `apps/prompt-manager/Liminal_online.json`
- Work copies: `data/presets/st-presets/*.json`
- Current global prompt-manager preset: `data/presets/st-presets-settings.json`
- Current QQ prompt preset: `data/qq/settings.json` -> `currentPromptPresetId`

Initial import happens only if `data/presets/st-presets/` is empty. Later edits read/write the work copy. The refresh icon overwrites the current work copy from `apps/prompt-manager/Liminal_online.json`.

## Built-In Locked Markers

These marker prompts are always present, locked from edit/copy/delete, but draggable:

- `实时模式`
- `CHAR人设`
- `USER人设`
- `世界书`
- `总结内容`
- `场景信息`
- `示例聊天`
- `聊天记录`

Export includes them in current order.

## Prompt Shapes

Character:

```text
<character_info>
角色名：{{char}}
角色设定：
{{char_role_setting}}
角色语气 / RP规则：
{{char_rp_rules}}
其它设定：{{char_other_setting}}
</character_info>
```

User:

```text
<user_info>
名字：{{user}}
性别：{{user_gender}}
生日：{{user_birthday}}
用户人设：{{user_persona}}
</user_info>
```

Chat history:

```text
<chat_history>
{{chat_history}}
</chat_history>
```

Last user message:

```text
<user_input>
{{last user message text}}
</user_input>
```

`{{lastmes}}` already returns the `<user_input>` wrapper.

## QQ Reply Assembly

`/api/qq/reply`:

1. Reads the selected QQ prompt preset.
2. Follows `prompt_order[0].order`.
3. Renders enabled prompts and marker content.
4. If `chatHistory` marker is enabled, injects `<chat_history>` and does not append duplicate OpenAI history messages.
5. Falls back to legacy `buildCharacterSystemPrompt()` if preset assembly fails.

## Current Gaps

- Worldbook matching/injection is not implemented.
- Summary generation/update is not implemented.
- RP rules are repeated at system end today; true tail/post-history injection is future work.
- Reply references are not injected yet.

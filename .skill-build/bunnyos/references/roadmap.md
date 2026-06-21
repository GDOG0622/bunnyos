# Roadmap

Use this when asked “下一步做什么” or when updating planning.

## Completed And Removed From Next Steps

- QQ user persona system.
- QQ current prompt preset selector.
- Prompt manager merged into QQ.
- Prompt-manager main screen full-screen inside QQ.
- Prompt-manager edit/preview/input/confirm dialogs centered.
- QQ reply uses QQ current ST preset when available.

## Priorities

| Priority | Task | Notes |
| --- | --- | --- |
| P0 | Connect worldbook to QQ replies | Implement matching, ordering, and injection through `世界书` marker. Decide global/character/chat binding. |
| P0 | Build summary module | `总结内容` marker exists. Need storage, generation, update policy, and injection. |
| P1 | Refine RP rules tail injection | Current implementation repeats `rp_rules` at system prompt end. Later make it a true tail/post-history preset injection behavior. |
| P1 | Inject reply references | `reply_to` exists on messages. Render referenced content into prompt with a clear structure. |
| P1 | Improve preset grouping | Whole-group drag, group editing, and more SillyTavern-like batch operations. |
| P2 | Replace Settings native alerts | QQ and prompt-manager already use project dialogs; settings still has old `alert`. |
| P2 | Storage layer cleanup | Current pattern is localhost API + JSON files. Consider SQLite indexing later while keeping JSON import/export. |

## Planning Rule

When updating README or planning docs, remove completed items from “next” lists and keep only actionable undone work.

# Decisions: Animation timeline

Newest first. See the [index](../decisions.md).

## 2026-11-05 (issue #203, Timeline summary row)
- **One Summary row at the top of the key lanes, no per-group rows.** It summarizes every key drawn in the lanes (collapsed groups included, events excluded); keys within 1e-6 s, the commands' same-time tolerance, share one summary key. Reason: dope-sheet convention, and the owner wants it simple; the lanes are flat joint rows today, so per-group summaries add nothing yet. (DESIGN §5.8)
- **A summary key is a group proxy for its keys under the key rules.** Outlined, half filled or filled for none, some or all selected; click modifiers (none, SHIFT toggle, CTRL remove, read at the press) apply to its keys as a group; only a fully selected summary key drags, moving the whole selection through `moveKeys` (same snapping, clip clamp and same-track replacement, one undo step); Delete keys acts on the selection. Reason: one selection model and one move command, no summary-specific state or hotkeys. (DESIGN §5.8)
- **Key click modifiers made explicit and read at the press**, matching the Hierarchy: none selects only an unselected key and keeps an existing selection otherwise, so a drag moves it; SHIFT toggles; CTRL removes. Reason: §5.8 only said "SHIFT multi-selects", and the summary row needs the same rules. (DESIGN §5.8)

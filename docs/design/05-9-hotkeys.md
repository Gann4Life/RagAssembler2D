# 5.9 Hotkeys (defaults)

| Key | Action | Key | Action |
|---|---|---|---|
| V / B / D | Select / Select box / Pose | C / R / N / H | Circle / Box / Polygon / Hinge |
| S | Toggle sprite edit (Select) | Del | Delete |
| Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y | Undo / Redo | Ctrl+S / Ctrl+O | Save / Load |
| Ctrl+G / Ctrl+Shift+G / Alt+G | Group / Ungroup / Split ([§2.2](02-object-model.md#22-bodies-and-shapes)) | Ctrl+D | Duplicate selection ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) |
| Space | Play / Pause | . | Next frame |
| K | Key selected | F / Home | Frame selection / all |
| Esc | Abort tool / clear selection | Z | Pivot mode: center / last selected (Select) |
| F2 | Rename the single selected object ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) | | |

- Z (without modifiers) and Ctrl+Z (Undo) are different hotkeys, since modifiers must match exactly. While CTRL is held during a Select rotation to force the body origin, pressing Z is therefore Undo, which aborts the drag ([§5.5](05-5-tools.md#55-tools)).
- Hotkeys are ignored while focus is in a text field. Space also goes to a focused button or control instead of Play/Pause.
- On macOS, Cmd acts as Ctrl. Keys match the character the keyboard layout produces (letters case-insensitive), and modifiers must match exactly. Exception: a hotkey with Alt and a letter also matches the physical key of that letter, because Alt (Option on macOS) changes the character it produces (Option+G gives "©").
- A matched hotkey always suppresses the browser's own shortcut (e.g. Ctrl+S never opens the browser's save dialog), even when its action is currently disabled.
- Holding a key repeats only Undo, Redo and Next frame; other hotkeys act once per press.
- While a drag or scrub is in progress, hotkeys that edit the document (Delete, Group, Duplicate, Key selected, …) do nothing; Undo and Esc cancel the drag.
- While focus is in a toolbar, a tab list, a tree (the Hierarchy, [§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)), a resize handle or an open menu, their navigation keys (arrows, Home, End, Space, Enter, Esc) do not trigger global hotkeys. The Hierarchy tree handles arrows, Home, End and Space; Del, Esc, F and F2 stay hotkeys there.
- F2 is a global hotkey: it acts with focus anywhere outside text fields (which keep their own F2) and never depends on Hierarchy focus; the pointer only decides where its field opens ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)).
- In the viewport, Space + left drag pans. A Space press without a drag toggles Play/Pause when Space is released; a left press while Space is held counts as a drag, even without movement.

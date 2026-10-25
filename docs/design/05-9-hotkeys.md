# 5.9 Hotkeys (defaults)

Hotkeys are accelerators only ([§5](05-editor.md#visible-controls-and-feedback)): every hotkey runs an action that also has the visible control listed here, and that control's tooltip shows the hotkey. Esc is the only hotkey without a control of its own: it is the universal cancel key, and what it does is also reachable with the pointer (choosing another tool aborts the operation, a click on empty space clears the selection).

| Key | Action | Visible control |
|---|---|---|
| V, B, D | Select, Select Box, Pose tools | Tools overlay ([§5.5](05-5-tools.md#55-tools)) |
| C, R, N, H | Circle, Box, Polygon, Hinge Joint tools | Tools overlay |
| S | Toggle sprite edit (Select) | Header Rig › Sprite edit ([§5.3](05-3-header.md#53-header)) |
| Del | Delete ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) | Hierarchy Delete button; Rig › Delete |
| Ctrl+C, Ctrl+V, Del (while keys hold the selection focus) | Copy keys, Paste keys at the playhead, Delete keys ([§5.8](05-8-animation-timeline.md#58-animation-timeline)) | Timeline Copy, Paste, Delete keys (not built yet: today only Del or Backspace in the focused key lanes deletes keys, [§5.8](05-8-animation-timeline.md#58-animation-timeline)) |
| Ctrl+Z | Undo | Header Undo |
| Ctrl+Shift+Z, Ctrl+Y | Redo | Header Redo |
| Ctrl+S, Ctrl+O | Save, Load | Header Save, Load |
| Ctrl+G, Ctrl+Shift+G, Alt+G | Group, Ungroup, Split ([§2.2](02-object-model.md#22-bodies-and-shapes)) | Rig › Group, Ungroup, Split |
| Ctrl+D | Duplicate selection ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) | Rig › Duplicate |
| F2 | Rename the single selected object ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) | Rig › Rename |
| Shift+R | Set as root body ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) | Rig › Set as root body |
| Space | Play / Pause | Header Play, Pause; Timeline Play button ([§5.8](05-8-animation-timeline.md#58-animation-timeline)) |
| . | Next frame | Header Next frame |
| K | Key selected ([§5.8](05-8-animation-timeline.md#58-animation-timeline)) | Timeline ◆ Key selected |
| F, Home | Frame selection, frame all ([§5.4](05-4-viewport.md#54-viewport)) | Header View › Frame selection, Frame all |
| Z | Pivot mode: center / last selected (Select) | Settings › Gizmo › Pivot |
| Esc | Abort tool / clear selection | none (cancel key, above) |

- A hotkey whose action is unavailable shows "*Label*: *reason*" in the status line ([§5](05-editor.md#visible-controls-and-feedback)), except while a drag or scrub is in progress or a confirmation is open.
- Navigation keys are not hotkeys and are not listed: Space + drag, `+`, `=` and `-` in the viewport ([§5.4](05-4-viewport.md#54-viewport)), and the keys a focused control handles itself (toolbars, tab lists, trees, menus, the ruler, text fields).

- Z (without modifiers) and Ctrl+Z (Undo) are different hotkeys, since modifiers must match exactly. While CTRL is held during a Select rotation to force the body origin, pressing Z is therefore Undo, which aborts the drag ([§5.5](05-5-tools.md#55-tools)).
- Hotkeys are ignored while focus is in a text field. Space also goes to a focused button or control instead of Play/Pause.
- On macOS, Cmd acts as Ctrl. Keys match the character the keyboard layout produces (letters case-insensitive), and modifiers must match exactly. Exception: a hotkey with Alt and a letter also matches the physical key of that letter, because Alt (Option on macOS) changes the character it produces (Option+G gives "©").
- A matched hotkey always suppresses the browser's own shortcut (e.g. Ctrl+S never opens the browser's save dialog), even when its action is currently disabled.
- While keys hold the selection focus (the last selection made was of Timeline keys), Del deletes the selected keys and never the Hierarchy selection, and Ctrl+C / Ctrl+V copy and paste keys; otherwise Del is the Hierarchy Delete, and Ctrl+C / Ctrl+V do nothing outside text fields.
- Holding a key repeats only Undo, Redo and Next frame; other hotkeys act once per press.
- While a drag or scrub is in progress, hotkeys that edit the document (Delete, Group, Duplicate, Key selected, …) do nothing; Undo and Esc cancel the drag.
- While focus is in a toolbar, a tab list, a tree (the Hierarchy, [§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)), a resize handle or an open menu, their navigation keys (arrows, Home, End, Space, Enter, Esc) do not trigger global hotkeys. The Hierarchy tree handles arrows, Home, End and Space; Del, Esc, F and F2 stay hotkeys there.
- F2 is a global hotkey: it acts with focus anywhere outside text fields (which keep their own F2) and never depends on Hierarchy focus; the pointer only decides where its field opens ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)).
- In the viewport, Space + left drag pans. A Space press without a drag toggles Play/Pause when Space is released; a left press while Space is held counts as a drag, even without movement.

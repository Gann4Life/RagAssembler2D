# 5.3 Header
Location: top, full width. One toolbar row with four button groups divided by separators:

| Group | Buttons, in order | Alignment |
|---|---|---|
| File | New, Load, Save | Left |
| History | Undo, Redo | Left, after File |
| Playback | Play, Pause, Next frame, Stop | Left, after History |
| Workspace | Window, Settings | Right end |

- **Buttons** are text-labelled. Each tooltip shows the label, plus the hotkey from [§5.9](05-9-hotkeys.md#59-hotkeys-defaults) if one exists. Buttons without a §5.9 hotkey show none.
- **Keyboard:** the header is a single Tab stop (`role="toolbar"`, roving tabindex). Left/Right move between buttons and wrap around, and Home/End jump to the first/last button. These keys do not trigger global hotkeys ([§5.9](05-9-hotkeys.md#59-hotkeys-defaults)).
- **Unavailable actions** use `aria-disabled` and stay focusable, so keyboard users can still reach them. The tooltip adds the reason: "(not available yet)" for an action that is not built, "(not available in *Mode* mode)" for one the mode policy disables ([§5.1](05-1-modes.md#51-editor-modes)), and nothing when only the current state disables it (e.g. Undo with nothing to undo).
- If the window is narrower than the row, the header scrolls horizontally. Buttons never wrap.

- **New**: new empty ragdoll. Asks for confirmation if there are unsaved changes.
- **Load**: imports a `.rag.json` from disk (file picker, or drag & drop onto the Viewport panel, Tools overlay included).
  - Older format versions are migrated.
  - Invalid files are rejected with a list of errors.
  - Sprite images are resolved relative to the file. The browser cannot read sibling files on its own, so the editor asks for the asset folder (directory picker where supported, multi-file picker otherwise). Missing images are drawn as placeholders and listed in Problems.
- **Save**: exports the `.rag.json`, and optionally the sprite images under their `src` paths (directory save where supported, otherwise a download of each). Blocked while there are validation **errors**. **Warnings** are allowed.
- **Undo / Redo**: step back or forward through the command stack ([§1](01-conventions.md#1-conventions)). Enabled when there is a step to undo or redo, and not in Simulate mode.
- **Play / Pause / Next frame / Stop**:
  - Next frame advances one fixed step (1/60 s).
  - Stop restores the pose and time that were active before Play.
- **Window** menu: one checkbox per panel in the order Viewport, Hierarchy, Assets, Problems, Inspector, Timeline (Viewport is always checked and disabled), a separator, then *Reset layout* ([§5.2](05-2-panels.md#52-panels)). The Tools overlay is not listed ([§5.5](05-5-tools.md#55-tools)). Checking a panel reopens it and activates its tab (expanding the Timeline); unchecking closes it. The menu opens below the button, aligned to its right edge. Enter, Space or Down open it on the first item, Up on the last; Up/Down wrap and Home/End jump; Esc closes it and returns focus to the button; Tab closes it and moves on; Left/Right close it and move along the header. Choosing an item or clicking outside closes it. When a closed panel had focus, focus moves to the new active tab of its stack, or else to the viewport.
- **Settings** opens a popover below the button, aligned to its right edge: `role="dialog"` labelled "Settings", not modal. Focus moves to its first control; Tab and Shift+Tab move through its controls and wrap. Esc or the Settings button closes it and returns focus to the button; a press outside closes it without moving focus. Controls, in order:
  - **Grid:** Show grid (checkbox, default on), Grid size (default 1 m, 0.01–100 m), Subdivisions (integer 1–20, default 10) ([§5.4](05-4-viewport.md#54-viewport));
  - **Snapping:** Snap to grid (checkbox, default off);
  - **Display:** Shapes / Sprites / Both (radio group, default Both);
  - **Overlays:** Names, Centers of mass, Contacts (checkboxes, default off; Contacts only draws in Simulate mode) ([§5.4](05-4-viewport.md#54-viewport));
  - **Document:** Pixels per meter (the root's `units.pixelsPerMeter`, [§5.7](05-7-inspector.md#57-inspector--properties-panel)).

  Grid size is shown in px at the current `pixelsPerMeter` and stored in meters. Checkboxes and radios apply at once; number fields apply on commit (Enter or blur), and an invalid value is marked `aria-invalid` and reverted on blur. Closing the popover with the Settings button or a press outside commits a pending number like blur does; Esc reverts the field being edited, then closes. Pixels per meter is a document edit: one undo step per commit, read-only outside Edit mode ([§5.1](05-1-modes.md#51-editor-modes)). Every other control is an **editor setting**: per browser, saved at once, restored on load (a stored value that is missing or invalid falls back to its default, with a console warning for invalid ones; a stored record of another or no version is ignored as a whole, with one warning), not undoable, available in every mode. If browser storage is unavailable, settings live only for the session. The Select tool's pivot mode ([§5.5](05-5-tools.md#55-tools)) is an editor setting under the same rules, toggled with Z and not shown in the popover.

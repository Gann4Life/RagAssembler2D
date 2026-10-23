# 5.3 Header
Location: top, full width. One toolbar row with six button groups divided by separators:

| Group | Buttons, in order | Alignment |
|---|---|---|
| File | New, Load, Save | Left |
| History | Undo, Redo | Left, after File |
| Rig | Rig (menu) | Left, after History |
| Mode | Edit, Animate, Simulate (mode switch) | Left, after Rig |
| Playback | Play, Pause, Next frame, Stop | Left, after Mode |
| Workspace | View (menu), Window (menu), Settings | Right end |

- **Buttons** are text-labelled. Each tooltip shows the label, plus the hotkey from [§5.9](05-9-hotkeys.md#59-hotkeys-defaults) if one exists. Buttons without a §5.9 hotkey show none.
- **Keyboard:** the header is a single Tab stop (`role="toolbar"`, roving tabindex). Left/Right move between buttons (the mode segments included) and wrap around, and Home/End jump to the first/last button. These keys do not trigger global hotkeys ([§5.9](05-9-hotkeys.md#59-hotkeys-defaults)).
- **Unavailable actions** use `aria-disabled` and stay focusable, so keyboard users can still reach them. The tooltip adds the reason, and activating them shows it in the status line, as [§5](05-editor.md#visible-controls-and-feedback) states for every control.
- If the window is narrower than the row, the header scrolls horizontally. Buttons never wrap.

**Mode switch.** A segmented control (`role="group"` labelled "Mode") of three text buttons, Edit, Animate and Simulate, joined without gaps. The segment of the current mode has `aria-pressed="true"` and the selected look, the others `"false"`; in Simulate mode, playing or paused, Simulate is pressed. It works the same whether the Timeline is expanded, folded or closed. Pressing the current mode's segment does nothing. Otherwise:
- **Edit** enters Edit mode (as "(rest pose)" in the clip selector). From Simulate it stops first (as Stop) ([§5.1](05-1-modes.md#51-editor-modes)). Tooltip "Edit mode: rest pose and rig".
- **Animate** enters Animate mode on a clip, chosen in this order: the **last opened clip** when it still exists ([§5.1](05-1-modes.md#51-editor-modes)); else the first clip in `clips` order; else a **new clip**, created as New clip does ([§5.8](05-8-animation-timeline.md#58-animation-timeline)), one undo step ("New clip"), with the status message "Created clip *name*". From Simulate it stops first (as Stop), which restores Animate when the run started there. The tooltip says what it will do: "Animate mode: opens *name*" or "Animate mode: creates a new clip"; in Animate mode "Animate mode: *name*".
- **Simulate** starts a live run ([§5.1](05-1-modes.md#51-editor-modes)): of the rest pose from Edit, of the open clip from 0 from Animate. Disabled, with the reason, when the document cannot be simulated. Tooltip "Simulate mode: live physics test".
- Edit and Animate are unavailable, with no reason, while a drag or scrub is in progress or a confirmation is open.

**Rig menu.** A menu button, always enabled, that opens below the button aligned to its left edge, kept inside the window, with the Window menu's keyboard rules (below). Items, with separators between groups:
1. Rename (F2), Duplicate (Ctrl+D), Delete (Del) ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels));
2. Group (Ctrl+G), Ungroup (Ctrl+Shift+G), Split (Alt+G) ([§2.2](02-object-model.md#22-bodies-and-shapes));
3. Set as root body (Shift+R), Fit motor torque (Shift+M) ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels));
4. Sprite edit (S), a checkbox item, checked while sprite edit is on ([§5.5](05-5-tools.md#55-tools)).

Each item runs the same action as its hotkey, with the same enabled rule, and shows the hotkey right-aligned in the muted text color. Enabled state is read when the menu opens. A disabled item is dimmed, stays focusable and has the reason as its accessible description; while it is hovered (after 400 ms) or focused from the keyboard, the custom tooltip ([§5.5](05-5-tools.md#55-tools)) shows "*Label* (*Key*) (*reason*)" 8 px to its right. Choosing a disabled item keeps the menu open and shows the reason in the status line. Choosing Rename opens the rename popup ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)), and Enter or Esc in it return focus to the Rig button.

**View menu.** Items Frame selection (F) and Frame all (Home) ([§5.4](05-4-viewport.md#54-viewport)), available in every mode, built like the Rig menu items; it opens below the button, aligned to its right edge.

- **Unsaved changes** means the document differs from its state at the last Save, New or Load (Undo back to that state clears it).
- **Messages** (load errors, load notes, save errors) open in a modal message dialog with a title, a sentence, a list and a single OK button; Enter, Esc or OK close it. The list shows at most 50 lines, then "and *N* more". A problem line reads `<path>: <message>`, or only the message when the path is empty ([§6.4](06-file-format.md#64-validation)).
- **New**: new empty ragdoll. Asks for confirmation if there are unsaved changes.
- **Load**: imports a `.rag.json` from disk (file picker filtered to `.rag.json` and `.json`, or drag & drop of one file onto the Viewport panel, Tools overlay included; only the first file of a drop is read, and a file dropped anywhere else in the window is ignored instead of being opened by the browser).
  - Once the file is chosen, Load asks for confirmation if there are unsaved changes, like New. Cancelling keeps the document.
  - Older format versions are migrated.
  - Invalid files (not JSON, unknown format or version, validation **errors**) are rejected: a message lists the errors and the document is unchanged. A file that cannot be read gives the same message without a list.
  - After a successful load, migration notes and **warnings** (dropped unknown fields included) are listed in a message; they never block the load. No message when there are none.
  - A loaded document has no unsaved changes, and history is cleared.
  - Sprite images are resolved relative to the file. The browser cannot read sibling files on its own, so the editor asks for the asset folder (directory picker where supported, multi-file picker otherwise). Missing images are drawn as placeholders and listed in Problems.
- **Save**: exports the `.rag.json`, and optionally the sprite images under their `src` paths (directory save where supported, otherwise a download of each). Where the browser offers a save-file picker, the user chooses the name and place, with `<name>.rag.json` suggested; otherwise the file is downloaded under that name. Blocked while there are validation **errors**: a message lists them and nothing is written. **Warnings** are allowed and shown nowhere by Save. The file is written in canonical form, with `meta` derived from the root name and the running editor version ([§6.5](06-file-format.md#65-round-trip-guarantee)).
  - The suggested (or downloaded) file name is `<name>.rag.json`, where `<name>` is the root `name` with each control character and each of `< > : " / \ | ? *` replaced by `_`, whitespace runs collapsed to one space, cut to its first 100 code points, then spaces and dots trimmed from both ends. When the result is empty, or its part before the first dot is a reserved Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, any case), `<name>` is `ragdoll`. Examples: `Humanoid` → `Humanoid.rag.json`; `a/b: c` → `a_b_ c.rag.json`; `" .. "` → `ragdoll.rag.json`; `con` → `ragdoll.rag.json`.
  - Cancelling the save-file picker cancels the save: no message, and the document keeps its unsaved changes. A file that cannot be written shows a message and keeps them too. Once the file is written, or the download starts, the document has no unsaved changes (the editor cannot know whether the browser finished a download). New, Load and Save are disabled while a save is pending.
- **New, Load, Save** follow the mode policy ([§5.1](05-1-modes.md#51-editor-modes)) and are disabled while a drag is in progress or a confirmation is open.
- **Undo / Redo**: step back or forward through the command stack ([§1](01-conventions.md#1-conventions)). Enabled when there is a step to undo or redo, and not in Simulate mode.
- **Play / Pause / Next frame / Stop** act on the current mode and never change the tool ([§5.1](05-1-modes.md#51-editor-modes)):
  - **Animate:** clip playback without leaving Animate mode (Playback in Animate). Stop puts the playhead back where Play started.
  - **Edit:** Play enters Simulate with the rest pose.
  - **Simulate:** Play resumes, Pause holds the live run, Next frame advances one fixed step (1/60 s), Stop ends it and restores the mode, clip and playhead active before it.
- **Window** menu: one checkbox per panel in the order Viewport, Hierarchy, Assets, Problems, Inspector, Timeline (Viewport is always checked and disabled), a separator, then *Reset layout* ([§5.2](05-2-panels.md#52-panels)). The Tools overlay is not listed ([§5.5](05-5-tools.md#55-tools)). Checking a panel reopens it and activates its tab (expanding the Timeline); unchecking closes it. The menu opens below the button, aligned to its right edge. Enter, Space or Down open it on the first item, Up on the last; Up/Down wrap and Home/End jump; Esc closes it and returns focus to the button; Tab closes it and moves on; Left/Right close it and move along the header. Choosing an item or clicking outside closes it. When a closed panel had focus, focus moves to the new active tab of its stack, or else to the viewport.
- **Settings** opens a popover below the button, aligned to its right edge: `role="dialog"` labelled "Settings", not modal. Focus moves to its first control; Tab and Shift+Tab move through its controls and wrap. Esc or the Settings button closes it and returns focus to the button; a press outside closes it without moving focus. Controls, in order:
  - **Grid:** Show grid (checkbox, default on), Grid size (default 1 m, 0.01–100 m), Subdivisions (integer 1–20, default 10) ([§5.4](05-4-viewport.md#54-viewport));
  - **Snapping:** Snap to grid (checkbox, default off);
  - **Display:** Shapes / Sprites / Both (radio group, default Both);
  - **Overlays:** Names, Centers of mass, Contacts (checkboxes, default off; Contacts only draws in Simulate mode) ([§5.4](05-4-viewport.md#54-viewport));
  - **Gizmo:** Pivot: Center / Last selected (radio group, default Center; the Select tool's pivot mode, also toggled with Z, [§5.5](05-5-tools.md#55-tools));
  - **Document:** Pixels per meter (the root's `units.pixelsPerMeter`, [§5.7](05-7-inspector.md#57-inspector--properties-panel)).

  Grid size is shown in px at the current `pixelsPerMeter` and stored in meters. Checkboxes and radios apply at once; number fields apply on commit (Enter or blur), and an invalid value is marked `aria-invalid` and reverted on blur. Closing the popover with the Settings button or a press outside commits a pending number like blur does; Esc reverts the field being edited, then closes. Pixels per meter is a document edit: one undo step per commit, read-only outside Edit mode ([§5.1](05-1-modes.md#51-editor-modes)). Every other control is an **editor setting**: per browser, saved at once, restored on load (a stored value that is missing or invalid falls back to its default, with a console warning for invalid ones; a stored record of another or no version is ignored as a whole, with one warning), not undoable, available in every mode. If browser storage is unavailable, settings live only for the session. The Select tool's pivot mode (Gizmo, above) is one of them; Z changes it while the popover is closed too, and an open popover follows.

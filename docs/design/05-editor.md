# 5. Editor

Tech: vanilla JavaScript ES modules, no build step. The viewport is rendered with **PIXI.js** (sprites and gizmos via `PIXI.Graphics`), and simulation uses liquidfun.js through RagImporter. The editor uses the same renderer and runtime as production.

## Visible controls and feedback

These rules hold everywhere in the editor ([§5.1](05-1-modes.md#51-editor-modes)–[§5.10](05-10-inverse-kinematics.md)).

- **No hidden actions.** Every action, tool, mode and toggle has a visible control: a button, menu item, segment, checkbox or field in the header, a panel or the Tools overlay. A hotkey is only an accelerator for a visible control: the control's tooltip shows it (menu items also show it right-aligned), and [§5.9](05-9-hotkeys.md#59-hotkeys-defaults) names the control of every hotkey. Esc, the universal cancel key, is the only exception. An action is specified together with its control; an action without one is not built.
- **The user decides tools and modes.**
  - The active tool changes only when the user chooses a tool (its Tools overlay button or its hotkey). A mode change never changes it: when the new mode disables the active tool, it stays active and is shown disabled ([§5.5](05-5-tools.md#55-tools)).
  - The mode changes only through explicit controls: the header mode switch ([§5.3](05-3-header.md#53-header)), Play and Stop, the Timeline clip selector and New clip ([§5.8](05-8-animation-timeline.md#58-animation-timeline)). Two document events also return to Edit mode, each stated where it happens: New and Load (a new document), and the removal of the open clip, which leaves nothing to animate and reports it in the status line ([§5.1](05-1-modes.md#51-editor-modes)).
- **Disabled controls explain themselves.** A disabled control stays visible and focusable (`aria-disabled`), and its tooltip ends with the reason in parentheses:
  - "(not available yet)" for an action that is not built;
  - "(only in Edit mode)", "(only in Edit and Animate modes)", "(only in Simulate mode)", …, naming the modes that allow it, for an action the mode policy refuses ([§5.1](05-1-modes.md#51-editor-modes));
  - otherwise a **state reason** that says what to do (table below).

  No reason is given while a drag or scrub is in progress or a confirmation is open: the control comes back by itself when that ends.
- **Activating a disabled control** (a click, Enter or Space on it, its hotkey, or a viewport press with a disabled active tool) changes nothing and shows "*Label*: *reason*" in the status line, e.g. "Set as root body: select one body" or "Circle: only in Edit mode". Nothing is shown while a drag or scrub is in progress or a confirmation is open.
- **Status line.** Results that are not visible where the user is looking are reported in one line at the bottom center of the Viewport panel, 8 px above its bottom edge and kept inside it: panel surface at 92 % opacity, 4 px radius, 12 px text, cut with an ellipsis when too long. It is a polite live region (`role="status"`), never takes focus or pointer input, and hides 4 s after its last message; a new message replaces the current one. Each action states its message where it is specified.

**State reasons** (shown only when the mode allows the action):

| Action | Disabled when | Reason |
|---|---|---|
| Undo, Redo | the stack has no step that way | "nothing to undo", "nothing to redo" |
| Play | already playing | "already playing" |
| Pause | Simulate is paused | "already paused" |
| Delete | no body, shape or joint is selected | "select a body, shape or joint" |
| Delete | only the root is selected | "the ragdoll root cannot be deleted" |
| Duplicate | nothing duplicable is selected ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) | "select a body, shape or non-loop joint" |
| Rename | not exactly one object is selected | "select one object" |
| Group | fewer than two bodies in the selection; invalid geometry ([§2.2](02-object-model.md#22-bodies-and-shapes)) | "select shapes of two or more bodies"; "a shape has invalid geometry" |
| Ungroup | no selected body has two or more shapes | "each selected body has a single shape" |
| Split | no body has some, not all, of its shapes selected | "select some, not all, shapes of a body" |
| Set as root body | not exactly one body in the selection; that body is already `rootBody` | "select one body"; "already the root body" |
| Sprite edit | Select is not the active tool; no single shape with a sprite is selected | "choose the Select tool"; "select one shape with a sprite" |
| Delete clip, scrub | no clip is open | "open a clip" |

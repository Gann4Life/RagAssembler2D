# 5.2 Panels
The workspace below the header is tiled by panels: Viewport, Hierarchy, Assets, Problems, Inspector and Timeline. Panels never overlap. If the window is smaller than the sum of the minimum sizes, the workspace scrolls (see *Window resize* below). The Tools are not a panel: they float over the Viewport ([§5.5](05-5-tools.md#55-tools)).

- **Viewport is fixed.** It cannot be closed, tabbed or dragged, and nothing can be dropped onto its center; other panels dock around its edges. If every other panel is closed, it fills the workspace.
- **Stacks and tabs.** Panels that share a slot form a stack. Every stack shows a tab bar, even with one panel; the tab is the panel's title and its drag handle. The tab bar is a tab list with a roving tabindex (Left/Right wrap, Home/End, activation follows focus). An overflowing tab bar scrolls horizontally, also with the vertical mouse wheel, shows a 12 px fade on each clipped edge, and keeps the active tab visible, also after a resize.
- **Docking.** Dragging a tab (more than 4 px) moves that panel. Dropping it on a tab bar inserts it as a tab at the insertion point the bar shows; on the center of a stack it becomes that stack's last tab (the preview shows the stack area plus the insertion point after its last tab); on an edge of a stack, or of the Viewport, it splits that area and takes half of it; on a 16 px strip at a workspace edge it docks across the full width or height with its default size, capped at 1/3 of the workspace. **Tab bars win over edge strips:** where a tab bar touches a workspace edge, a drop on the bar is a tab drop. So, while the Timeline is folded along the bottom edge, docking to that edge requires expanding it first. Sizes never go below the minimums. The resulting area is previewed while dragging. Esc, or a drop where nothing can be docked (the Viewport center, or the panel's own stack when it is its only tab), cancels.
- **Resize handles.** Neighbouring panels are separated by a 4 px gutter. The whole shared edge is draggable; a grip, with at least 3:1 contrast against the gutter, marks its middle. A handle resizes the area on its side away from the **fill area** of its split: the area holding the Viewport, or the last area of a split without it. Its accessible name is that area's name plus the dimension, e.g. "Timeline height", "Hierarchy width"; an area holding the Viewport is named "Viewport", any other area after its first panel in layout order (its active tab). Sizes are clamped to the minimums below, and Esc during a drag restores the previous size. Handles are focusable separators: arrows move the handle ±10 px in their direction, Shift + arrows ±50 px, and Home/End give the area it resizes its minimum/maximum size.
- **Keyboard order.** Tab follows the layout: areas in layout order (left to right, top to bottom within each split), each followed by the handle after it. Inside a stack: its tab list, its fold button if shown, then the panel. Inside the Viewport: the Tools overlay, then the viewport host. Focus on a tab, a handle or a fold button survives layout changes that keep that element.
- **Folding the Timeline.** Only the Timeline can be folded; no other panel has a fold control. A folded Timeline shows only its 28 px tab bar and keeps its stored size for when it expands.
  - The Timeline is **foldable** while it is the active tab of its stack and that stack is a fixed area (not the fill area) of a top-to-bottom split. Otherwise it shows no fold control and the folded state is ignored, but kept.
  - A 24 × 24 px fold button sits at the right end of the tab bar, outside the scrolling tab area: ▾ while expanded, ▸ while folded, with `aria-expanded` and `aria-controls` pointing to the Timeline panel. Double-clicking an empty part of that tab bar also toggles it.
  - Clicking a tab of a folded stack expands it; clicking the active tab of an expanded stack does nothing. Every other activation of a panel in the Timeline's stack (Window menu, keyboard, a tab dropped into it, future programmatic activation) and every move or reopen of the Timeline expand it.
  - While folded, the handle that would resize the Timeline is not shown and cannot be focused; the 4 px gutter remains. If focus was inside the Timeline panel when it folds, it moves to the fold button.
  - The folded state is part of the saved layout, is not undoable, and the Window menu checkbox only means "open", folded or not.
- **Window resize.** Only the fill area grows or shrinks. Once it reaches its minimum, the other areas of that split shrink in proportion to their size above their own minimums; only when every area is at its minimum does the workspace scroll. These shrunk sizes are not stored: the stored sizes return when the window grows again. The exception is a handle resize: it stores the on-screen sizes of every fixed area of its split, except a folded Timeline, so the resized area starts from what the user sees.
- **Window menu.** Panels are closed with the × on their tab (or a middle click), and reopened or closed from the **Window** menu ([§5.3](05-3-header.md#53-header)). A reopened panel returns to its previous stack and position if that stack still exists; otherwise it joins a stack holding a panel of its default group; otherwise it docks to its default workspace edge with its default size.
- **Persistence.** The layout is saved per browser after every change and restored on load. A stored layout that cannot be read is ignored with a console warning, and the default is used; this includes layouts from before the Tools left the dock, which still name a Tools panel. Panels missing from it are added by the reopen rule. If browser storage is unavailable, the layout lives only for the session.
- **Reset layout** restores the default immediately (Timeline expanded, as on a first run), with no confirmation, and forgets the stored layout. Layout changes, including Reset and folding, are not undoable.

Default layout. The positions given as "Default location" in [§5.6–5.8](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels) refer to it:

```
┌──────────────────────── Header ──────────────────────────┐
├──────────────────────────────────┬───────────────────────┤
│ ┌──┐                             │ Hierarchy|Assets|Prob │
│ │T │        Viewport             ├───────────────────────┤
│ └──┘                             │ Inspector             │
├──────────────────────────────────┴───────────────────────┤
│ Timeline                                             [▾] │  expanded
└──────────────────────────────────────────────────────────┘
T: Tools overlay (§5.5), not a panel.
```

| Panel | Default group and edge | Default size | Minimum (w × h) |
|---|---|---|---|
| Viewport | fixed, center | the remaining area | 240 × 168 px (fits the two-column Tools overlay, [§5.5](05-5-tools.md#55-tools)) |
| Hierarchy, Assets, Problems | one stack, right top | 300 px wide; half the right column | 200 × 96 px |
| Inspector | own stack, right bottom | 300 px wide; the rest of the right column | 200 × 96 px |
| Timeline | own stack, bottom, full width | 220 px high; starts **expanded** on a first run and after Reset layout (a restored layout keeps its folded state) | 320 × 120 px (28 px high while folded) |

Minimum heights include the 28 px tab bar. "Half the right column" is measured with the Timeline folded (the sizes are computed folded, then the Timeline is expanded). Panels that are not built yet show a centered "*Name* (not available yet)" placeholder.

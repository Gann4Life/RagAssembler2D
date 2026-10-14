# Decisions

Dated log of design and technical decisions. Newest first. Each entry gives the decision, its reason and where it is specified.

## 2026-10-14
- **The header is a full-width toolbar with per-group alignment.** File, History and Playback sit on the left in that order, and Workspace (Window, Settings) sits at the right end. It has a single Tab stop with a roving tabindex. Unavailable actions use `aria-disabled` and stay focusable, and tooltips only show §5.9 hotkeys. Reason: "top center" did not say how the groups line up, and the shell built for #7 follows the usual editor layout, with document and playback actions near the tools and workspace settings out of the way. (DESIGN §5.3)
- **The viewport host stays `role="group"` until the viewport handles keys itself, then becomes `role="application"`.** Reason: screen readers use single-key hotkeys (V, B, M, F, Space…) for browse-mode navigation unless the focused region is an application, and an application role is not justified before there are keys to pass through. Its scope is limited to the viewport host. (DESIGN §5.4)
- **liquidfun.js is the doebi/liquidfun.js v1.1.0 Emscripten (asm.js) build**, reached through its `Box2D` namespace global with WebIDL accessors; RagImporter never assumes global `b2*` names. `RagImporter.configure` accepts `{ Box2D }` as well as `{ PIXI }`, both optional. It is the build the project owner uses, is self-contained and matches the reference demo byte for byte; injecting the namespace mirrors the PIXI handling and lets tests and module-based hosts supply it without a global. (DESIGN §7, §12)
- **PIXI.js is pinned to 8.21.0** after verifying `Assets`, `sortableChildren`/`zIndex` and `eventMode` + `pointermove`. (DESIGN §7, §12)
- **RagImporter targets LiquidFun + PIXI.js directly**, with no engine/renderer adapter layer. The project only targets this stack; an adapter layer can be added later if needed. (DESIGN §7)
- **Procedural joint control lives in RagImporter**; authoring (`aimAxis`) and preview live in the editor. Targets come from runtime data the editor cannot key. (DESIGN §4.8)
- **Shapes carry sprites** (offset, angle, scale, z), and the timeline can swap them through a discrete `sprite` channel. (DESIGN §2.3, §4.2)
- **The root is a world object** that parents everything and owns the global `strength`/`gain`/`damping` channels. These are 0–1 multipliers, never overrides, so a "dead" clip needs a single track. (DESIGN §2.1)
- **Springs are emulated with joint motors** (PD over motor speed, torque scaled by strength), because LiquidFun revolute joints have no spring. (DESIGN §3)
- **Layers:** the higher index wins; override by default, additive optional; no masks, since a clip only affects the tracks it has. (DESIGN §4.4)
- **Transitions** use per-clip `fadeIn`/`fadeOut`; a transition matrix is backlog. (DESIGN §4.1)
- **Grouping replaces FixedJoint**: a body can have several fixtures. (DESIGN §2.2)
- **The editor's Simulate mode uses RagImporter**, so preview equals production. (DESIGN §3, §5.1)

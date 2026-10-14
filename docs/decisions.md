# Decisions

Dated log of design and technical decisions. Newest first. Each entry gives the decision, its reason and where it is specified.

## 2026-10-14
- **RagImporter targets LiquidFun + PIXI.js directly**, with no engine/renderer adapter layer. The project only targets this stack; an adapter layer can be added later if needed. (DESIGN §7)
- **Procedural joint control lives in RagImporter**; authoring (`aimAxis`) and preview live in the editor. Targets come from runtime data the editor cannot key. (DESIGN §4.8)
- **Shapes carry sprites** (offset, angle, scale, z), and the timeline can swap them through a discrete `sprite` channel. (DESIGN §2.3, §4.2)
- **The root is a world object** that parents everything and owns the global `strength`/`gain`/`damping` channels. These are 0–1 multipliers, never overrides, so a "dead" clip needs a single track. (DESIGN §2.1)
- **Springs are emulated with joint motors** (PD over motor speed, torque scaled by strength), because LiquidFun revolute joints have no spring. (DESIGN §3)
- **Layers:** the higher index wins; override by default, additive optional; no masks, since a clip only affects the tracks it has. (DESIGN §4.4)
- **Transitions** use per-clip `fadeIn`/`fadeOut`; a transition matrix is backlog. (DESIGN §4.1)
- **Grouping replaces FixedJoint**: a body can have several fixtures. (DESIGN §2.2)
- **The editor's Simulate mode uses RagImporter**, so preview equals production. (DESIGN §3, §5.1)

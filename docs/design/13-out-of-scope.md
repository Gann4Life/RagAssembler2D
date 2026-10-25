# 13. Out of scope for v1 (backlog)

- Inverse kinematics and chain aiming (spine → neck → head distribution).
- Concave polygon decomposition.
- Weld, prismatic and other joint types.
- A transition matrix (per source → destination durations). For now, transitions use per-clip `fadeIn`/`fadeOut` plus runtime overrides.
- Runtime scaling of a ragdoll (it requires consistent scaling of mass and torque).
- Spritesheet/atlas authoring in the editor (the runtime already supports atlases through the texture resolver).
- Animating sprite offset, angle, scale, tint or z.
- A root position channel (animated `rootBody` offset). The physics ragdoll gets its position from legs and contacts; an offset would need an external force (or teleport) and would only help the FK preview, which keeps `rootBody`'s center of mass fixed ([§5.1](05-1-modes.md#51-editor-modes)).
- Procedural overrides of the root `bodyAngle` (a runtime `setBodyAngle`), and balance that reacts to the support polygon (center of mass over the feet).
- Physics engines other than LiquidFun and renderers other than PIXI.js.
- Multiple ragdolls per file.

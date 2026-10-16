# 13. Out of scope for v1 (backlog)

- Inverse kinematics and chain aiming (spine → neck → head distribution).
- Concave polygon decomposition.
- Weld, prismatic and other joint types.
- A transition matrix (per source → destination durations). For now, transitions use per-clip `fadeIn`/`fadeOut` plus runtime overrides.
- Runtime scaling of a ragdoll (it requires consistent scaling of mass and torque).
- Spritesheet/atlas authoring in the editor (the runtime already supports atlases through the texture resolver).
- Animating sprite offset, angle, scale, tint or z.
- Physics engines other than LiquidFun and renderers other than PIXI.js.
- Multiple ragdolls per file.

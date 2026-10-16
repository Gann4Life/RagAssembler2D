# 2. Object model

Every ragdoll is a tree of world objects whose parent is the **root**.

```
ragdoll (root)            world object: transform + global animation channels
├── body                  rigid body, made of one or more shapes
│   └── shape (fixture)   circle | box | polygon, optionally with a sprite
├── joint                 revolute (hinge) joint between two bodies
├── clip                  animation: tracks + events
└── sprite asset          image referenced by shapes and sprite tracks
```

## 2.1 Root (the ragdoll itself)
The root is a **parent object in the world**, not a physics body.

- It has its own transform (`position`, `angle`). It is drawn in the viewport as a pivot gizmo and can be selected and moved/rotated with the Select tool ([§5.5](05-5-tools.md#55-tools)). Moving it moves all its children.
- Body positions, body angles and joint anchors are stored **local to the root**.
- It has its own inspector and is always the first node in the Hierarchy.
- It owns the **global animation channels** `strength`, `gain` and `damping` ([§4.2](04-animation-model.md#42-channels)). They are **multipliers in 0–1, default 1**, and they never replace joint values. This is how a whole ragdoll can go limp from a single track, without keying every joint.
- At runtime, the spawn transform (`x`, `y`, `angle`, `flipX`) is applied to the root. After spawning, `rag.position` / `rag.angle` follow `rootBody`.

`rootBody` is the body from which the joint tree is built (usually the torso or pelvis). It is used for the Hierarchy tree, forward-kinematics preview and the runtime position. While it is `null` (a new ragdoll), the first body created becomes `rootBody`. Deleting the `rootBody` body sets it to the first remaining body in `bodies` order, or `null` when none is left.

## 2.2 Bodies and shapes
- In the UI a **shape** is what the user draws. A **body** owns one or more shapes (Box2D fixtures).
- Creating a shape creates a new body with that single shape. The body is placed at the shape's center (circle and box center, polygon centroid) with the opposite of the root's angle, so the shape keeps the orientation it was drawn with on screen; the shape is stored around the body origin (`center` `[0, 0]`, box `angle` 0, polygon vertices relative to the centroid).
- **Grouping** (Ctrl+G) merges the selected shapes' bodies into one body with several fixtures. Joints pointing to merged bodies are redirected to the group. Joints between two merged bodies are deleted, with a warning.
- **Ungroup** (Ctrl+Shift+G) splits a body back into one body per shape.
- Grouping replaces the FixedJoint/weld idea. Weld joints are out of scope for v1.
- A body never stays without shapes in the editor: deleting the last shapes of a body deletes the body ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)).
- All bodies are dynamic.

Shape types and their **local frame** (the origin and orientation used by the shape's sprite):

| Type | Data | Rules | Local frame |
|---|---|---|---|
| `circle` | `center`, `radius` | `radius > 0` | Origin at `center`, angle 0. |
| `box` | `center`, `width`, `height`, `angle` | `width > 0`, `height > 0` | Origin at `center`, rotated by `angle`. |
| `polygon` | `vertices` | Convex, counter-clockwise, 3–8 vertices (Box2D limit), no degenerate edges. Concave input is rejected on close. Automatic decomposition is backlog. | Origin at the centroid, angle 0. |

## 2.3 Sprites
A shape may have **one sprite**. The sprite is visual only and never affects physics.

| Property | Default | Meaning |
|---|---|---|
| `asset` | — | Sprite asset id, or `null` for no image. |
| `offset` | `[0, 0]` | Vector2 in meters, in the shape's local frame. |
| `angle` | `0` | Radians, relative to the shape's local frame. |
| `scale` | `[1, 1]` | Multiplies the native pixel size. |
| `z` | `0` | Integer draw order **across the whole ragdoll**: higher is drawn on top (e.g. far arm behind the torso, near arm in front). |
| `visible` | `true` | Shows or hides the sprite. |

- The sprite anchor is the texture center (PIXI anchor 0.5, 0.5).
- The sprite's image can be changed by the timeline through the shape's `sprite` channel ([§4.2](04-animation-model.md#42-channels)). Offset, angle, scale and z are the same for every image of that shape.
- **Sprite assets** live in a file-level table (`sprites[]`: `id`, `name`, `src`). `src` is a path **relative to the `.rag.json` file** (e.g. `humanoid/head.png`). The editor imports PNG/WebP/JPEG images. Spritesheets/atlases are handled by the host's texture resolver at runtime ([§7.3](07-ragimporter.md#73-sprites-and-rendering)); editor-side atlas support is backlog.
- Shapes without a sprite are invisible in production, unless the instance was spawned with `debug: true`.

## 2.4 Joints
v1 supports **revolute (hinge) joints** only.

- `bodyA` is the **parent**, closer to `rootBody` in the joint tree. `bodyB` is the **child**. The Hinge tool assigns them on creation ([§5.5](05-5-tools.md#55-tools)): of the two bodies, the one with fewer joints between it and `rootBody` becomes bodyA, counting joints in either direction (a joint connects its two bodies whichever is bodyA); a body not connected to `rootBody` counts as farthest; on a tie, the body earlier in `bodies` order becomes bodyA. Creating a joint never reorients existing ones, and the user can swap bodyA and bodyB in the inspector.
- `anchor` is root-local, in rest pose.
- The reference angle is **not stored**: it is derived from the rest pose (`bodyB.angle − bodyA.angle`). A joint angle of 0 therefore always means rest.
- Limits are relative to rest and must satisfy `lower ≤ 0 ≤ upper`, so the rest pose is always valid. The editor draws and edits them from the joint's zero direction, the root's +X at rest ([§5.4](05-4-viewport.md#54-viewport)); it is a display reference only and is not stored.
- `aimAxis` (radians, local to bodyB, default 0 = bodyB's +X) is the direction that counts as "forward" for that limb, e.g. where the head's face or the arm points. It is used by procedural aiming ([§4.8](04-animation-model.md#48-procedural-joint-control)).
- If the joint graph has cycles, joints outside the spanning tree from `rootBody` are flagged as **loop joints**. They are simulated normally but ignored by FK preview.
- **Parent joint and subtree.** A body's **parent joint** links it toward `rootBody`:
  - for a body connected to `rootBody`, it is the joint through which the spanning tree from `rootBody` reaches it; `rootBody` has none, and loop joints are never parent joints;
  - for a body not connected to `rootBody`, it is the first joint in `joints` order that has it as bodyB and another body as bodyA, or none.

  A body's **subtree** is the body itself plus every body whose chain of parent joints leads to it. The Select tool moves and rotates subtrees and pivots around parent joint anchors ([§5.5](05-5-tools.md#55-tools)).

## 2.5 Collision rules
- **Self-collision:** two shapes of the *same* ragdoll instance collide only if **both** have `selfCollide = true` (default `false`).
- **Connected bodies:** two bodies connected by a joint never collide unless that joint has `collideConnected = true` (default `false`). This applies even when both shapes have `selfCollide`. Box2D enforces it with its own joint check, before any contact filter runs.
- **Other objects:** shapes of different instances, or against the environment, collide according to the normal Box2D filter data, which applies even within one instance: `categoryBits` and `maskBits`, which the user sets per shape, and `groupIndex`, which the file does not store (always 0 at spawn) but a host may set through `rag.shape(name)`.
- RagImporter (and the editor's Simulate mode) reproduces these rules in one of two modes, chosen per world:
  - **Contact filter** (default): RagImporter installs one `Box2D.JSContactFilter` per world, shared by every instance in that world and by the host's bodies. Installing it replaces Box2D's default filtering, so its `ShouldCollide` evaluates, in order: (1) Box2D's default rule, reimplemented: equal non-zero `groupIndex` → collide if positive, else not; otherwise `(maskA & categoryB) ≠ 0 && (maskB & categoryA) ≠ 0`, all bit fields `& 0xffff`; (2) the self-collision rule above, for two shapes of the same instance; (3) the host's predicate, if set. A pair collides only if every step allows it. Installation, the shape registry and host integration are in [§7.5](07-ragimporter.md#75-contact-filter-and-host-integration).
  - **`groupIndex` fallback**, when the build has no `Box2D.JSContactFilter` or the host disables the filter (`RagImporter.configure({ contactFilter: false })`): every shape of an instance gets `groupIndex = −instanceId`, which disables *all* self-collision while instances still collide with each other and with the host. A warning is logged once per `RagDef` that has a shape with `selfCollide = true`.

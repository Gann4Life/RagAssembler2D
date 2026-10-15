# RagAssembler's Design

RagAssembler is a ragdoll editor for visually designing characters and creatures for **LiquidFun** (liquidfun.js, Box2D 2.3 API) rendered with **PIXI.js**. **RagImporter** is our runtime library: it loads exported files into a host project, builds the ragdoll in a LiquidFun world, renders it with PIXI sprites and drives it.

- Ragdolls are exported as `.rag.json` files (one ragdoll per file), plus the sprite images they reference.
- Ragdolls can be imported back into the editor, modified and re-exported. This must be lossless (see [Round-trip guarantee](#65-round-trip-guarantee)).
- Ragdolls are animated through **joint motors**, not by moving shapes. An animation describes *what pose the ragdoll tries to hold, how hard it tries, and which sprites it shows*. Physics always has the last word.
- Game code can also take **procedural control** of individual joints (e.g. a head that looks at the cursor), blended with the animation by a weight.

```
 ┌──────────────┐   export    ┌────────────────────┐  load    ┌──────────────────────────────┐
 │ RagAssembler │ ──────────▶ │ name.rag.json      │ ───────▶ │ Host JS project              │
 │   (editor)   │ ◀────────── │ + sprite images    │          │  RagImporter                 │
 └──────────────┘   import    └────────────────────┘          │  + liquidfun.js + PIXI.js    │
                                                              └──────────────────────────────┘
```

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Units (file and physics) | Meters, kilograms, seconds, radians. Torque in N·m, density in kg/m². |
| Units (editor UI) | Pixels and degrees. Multiplier channels are shown as 0–100 %. |
| Pixels per meter | `units.pixelsPerMeter` converts meters to pixels **in the editor and at runtime**. A sprite at scale 1 is drawn at its texture's native pixel size under this ratio, so at 32 px/m a 32 px image covers 1 m. |
| Axes | Physics: Y up, CCW-positive angles (Box2D). PIXI: Y down, CW-positive rotation. RagImporter converts: `sprite.x = x·ppm`, `sprite.y = −y·ppm`, `sprite.rotation = −angle`. |
| Identity | Every body, shape, joint and sprite asset has a stable `id` (unique across the file, never reused, used for references) and a human `name` (used for lookup by code). `root` is a reserved id. The editor generates ids as a kind prefix plus a counter (`b_3`, `f_3`, `j_3`, `s_3`), above any id of that prefix seen in the session (as an id or as a reference), and never changes an existing id. "Never reused" holds within an editing session: an id that was deleted and is absent from the saved file may be generated again after a reload. |
| Clip identity | Clips are referenced by `key`: lower-case, `[a-z0-9_]+`, unique. **The key is the contract with game code.** Renaming a clip's `name` never breaks code. Changing its `key` does, and the inspector warns about it. |
| Rest pose | The pose built in the editor is the **rest pose**. All joint angles are measured relative to it, so every joint's angle is `0` at rest. |
| Undo / Redo | Every data mutation (including keys, events and sprite edits) goes through a command stack (minimum 200 steps; the oldest are dropped). One user operation is one step: a compound operation (delete with its cascade, group, ungroup, duplicate) and a continuous gesture (a drag from press to release, a slider or field scrub) each undo at once. Esc or Undo during a gesture reverts it without leaving a step and undoes nothing else; Redo during a gesture does nothing. A gesture that ends where it started leaves no step. A new step clears Redo. New and Load clear both. Selection, camera, panel layout, mode, playhead and editor settings (except `pixelsPerMeter`) are not undoable, and Undo/Redo never change them, except that objects that no longer exist leave the selection and a clip that no longer exists is closed ([§5.1](#51-editor-modes)). |
| Autosave | The editor stores a draft in browser storage every 30 s and on page unload, and offers to recover it on the next start. |

---

## 2. Object model

Every ragdoll is a tree of world objects whose parent is the **root**.

```
ragdoll (root)            world object: transform + global animation channels
├── body                  rigid body, made of one or more shapes
│   └── shape (fixture)   circle | box | polygon, optionally with a sprite
├── joint                 revolute (hinge) joint between two bodies
├── clip                  animation: tracks + events
└── sprite asset          image referenced by shapes and sprite tracks
```

### 2.1 Root (the ragdoll itself)
The root is a **parent object in the world**, not a physics body.

- It has its own transform (`position`, `angle`). It is drawn in the viewport as a pivot gizmo and can be selected and moved/rotated with the Manipulate tool. Moving it moves all its children.
- Body positions, body angles and joint anchors are stored **local to the root**.
- It has its own inspector and is always the first node in the Hierarchy.
- It owns the **global animation channels** `strength`, `gain` and `damping` ([§4.2](#42-channels)). They are **multipliers in 0–1, default 1**, and they never replace joint values. This is how a whole ragdoll can go limp from a single track, without keying every joint.
- At runtime, the spawn transform (`x`, `y`, `angle`, `flipX`) is applied to the root. After spawning, `rag.position` / `rag.angle` follow `rootBody`.

`rootBody` is the body from which the joint tree is built (usually the torso or pelvis). It is used for the Hierarchy tree, forward-kinematics preview and the runtime position. While it is `null` (a new ragdoll), the first body created becomes `rootBody`. Deleting the `rootBody` body sets it to the first remaining body in `bodies` order, or `null` when none is left.

### 2.2 Bodies and shapes
- In the UI a **shape** is what the user draws. A **body** owns one or more shapes (Box2D fixtures).
- Creating a shape creates a new body with that single shape.
- **Grouping** (Ctrl+G) merges the selected shapes' bodies into one body with several fixtures. Joints pointing to merged bodies are redirected to the group. Joints between two merged bodies are deleted, with a warning.
- **Ungroup** (Ctrl+Shift+G) splits a body back into one body per shape.
- Grouping replaces the FixedJoint/weld idea. Weld joints are out of scope for v1.
- All bodies are dynamic.

Shape types and their **local frame** (the origin and orientation used by the shape's sprite):

| Type | Data | Rules | Local frame |
|---|---|---|---|
| `circle` | `center`, `radius` | `radius > 0` | Origin at `center`, angle 0. |
| `box` | `center`, `width`, `height`, `angle` | `width > 0`, `height > 0` | Origin at `center`, rotated by `angle`. |
| `polygon` | `vertices` | Convex, counter-clockwise, 3–8 vertices (Box2D limit), no degenerate edges. Concave input is rejected on close. Automatic decomposition is backlog. | Origin at the centroid, angle 0. |

### 2.3 Sprites
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
- The sprite's image can be changed by the timeline through the shape's `sprite` channel ([§4.2](#42-channels)). Offset, angle, scale and z are the same for every image of that shape.
- **Sprite assets** live in a file-level table (`sprites[]`: `id`, `name`, `src`). `src` is a path **relative to the `.rag.json` file** (e.g. `humanoid/head.png`). The editor imports PNG/WebP/JPEG images. Spritesheets/atlases are handled by the host's texture resolver at runtime ([§7.3](#73-sprites-and-rendering)); editor-side atlas support is backlog.
- Shapes without a sprite are invisible in production, unless the instance was spawned with `debug: true`.

### 2.4 Joints
v1 supports **revolute (hinge) joints** only.

- `bodyA` is the **parent**, closer to `rootBody` in the joint tree. `bodyB` is the **child**. The editor assigns this on creation, and the user can swap it in the inspector.
- `anchor` is root-local, in rest pose.
- The reference angle is **not stored**: it is derived from the rest pose (`bodyB.angle − bodyA.angle`). A joint angle of 0 therefore always means rest.
- Limits are relative to rest and must satisfy `lower ≤ 0 ≤ upper`, so the rest pose is always valid.
- `aimAxis` (radians, local to bodyB, default 0 = bodyB's +X) is the direction that counts as "forward" for that limb, e.g. where the head's face or the arm points. It is used by procedural aiming ([§4.8](#48-procedural-joint-control)).
- If the joint graph has cycles, joints outside the spanning tree from `rootBody` are flagged as **loop joints**. They are simulated normally but ignored by FK preview.

### 2.5 Collision rules
- **Self-collision:** two shapes of the *same* ragdoll instance collide only if **both** have `selfCollide = true` (default `false`).
- **Connected bodies:** two bodies connected by a joint never collide unless that joint has `collideConnected = true` (default `false`). This applies even when both shapes have `selfCollide`. Box2D enforces it with its own joint check, before any contact filter runs.
- **Other objects:** shapes of different instances, or against the environment, collide according to the normal Box2D filter data, which applies even within one instance: `categoryBits` and `maskBits`, which the user sets per shape, and `groupIndex`, which the file does not store (always 0 at spawn) but a host may set through `rag.shape(name)`.
- RagImporter (and the editor's Simulate mode) reproduces these rules in one of two modes, chosen per world:
  - **Contact filter** (default): RagImporter installs one `Box2D.JSContactFilter` per world, shared by every instance in that world and by the host's bodies. Installing it replaces Box2D's default filtering, so its `ShouldCollide` evaluates, in order: (1) Box2D's default rule, reimplemented: equal non-zero `groupIndex` → collide if positive, else not; otherwise `(maskA & categoryB) ≠ 0 && (maskB & categoryA) ≠ 0`, all bit fields `& 0xffff`; (2) the self-collision rule above, for two shapes of the same instance; (3) the host's predicate, if set. A pair collides only if every step allows it. Installation, the shape registry and host integration are in [§7.5](#75-contact-filter-and-host-integration).
  - **`groupIndex` fallback**, when the build has no `Box2D.JSContactFilter` or the host disables the filter (`RagImporter.configure({ contactFilter: false })`): every shape of an instance gets `groupIndex = −instanceId`, which disables *all* self-collision while instances still collide with each other and with the host. A warning is logged once per `RagDef` that has a shape with `selfCollide = true`.

---

## 3. Physics drive model (springs via motors)

LiquidFun (Box2D 2.3) has no spring on revolute joints. RagImporter emulates one with the joint **motor** and runs this every step, for every joint:

```
target   = resolved angle (rad, relative to rest): clip layers, then procedural overrides (§4.4)
error    = target − jointAngle
S        = jointStrength × rootStrength × runtimeStrength
G        = jointGain     × rootGain     × runtimeGain    × motor.gain
D        = jointDamping  × rootDamping  × runtimeDamping × motor.damping

motorSpeed     = clamp(G · error − D · jointSpeed, −motor.maxSpeed, motor.maxSpeed)
maxMotorTorque = S · motor.maxTorque
enableMotor    = S > 0
```

- `motor.maxTorque` (N·m), `motor.gain` (1/s), `motor.damping` (unitless) and `motor.maxSpeed` (rad/s) are per-joint **base values** set in the inspector.
- The channels `strength`, `gain` and `damping` (joint and root) are **multipliers in 0–1, default 1**.
- `S = 0` → the joint is fully limp, but **limits are still enforced**.
- `jointAngle` and `jointSpeed` are `GetJointAngle()` and `GetJointSpeed()` of the `b2RevoluteJoint` (rad, rad/s, relative to the reference angle, so 0 at rest). The outputs go to `SetMotorSpeed`, `SetMaxMotorTorque` and `EnableMotor`. These methods exist only on the `b2RevoluteJoint` wrapper ([§7.2](#72-spawn-and-flipx)). This loop allocates nothing on the Emscripten heap ([§7.4](#74-native-memory)).
- This model is the same in the editor and at runtime. The editor's Simulate mode uses RagImporter itself, so **preview equals production**.

---

## 4. Animation model

### 4.1 Clips

| Property | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | `"New Clip"` | Display name. |
| `key` | string | slug of `name` | Code identifier, `[a-z0-9_]+`, unique. It follows `name` automatically while it still equals the slug generated from `name`; editing it by hand to anything else stops this. The slug rule is in `docs/schema.md`. |
| `loop` | bool | `true` | Loops at `length`. |
| `hold` | bool | `true` | Non-loop only. `true`: the clip stays active holding its last frame until it is stopped or replaced. `false`: it stops itself on completion, using `fadeOut`. |
| `layer` | int ≥ 0 | `0` | **The higher index wins.** Many clips can share a layer (e.g. `idle`, `walk` and `run` on layer 0), but only one is active per layer at a time. |
| `blend` | `override` \| `additive` | `override` | How the clip combines with the layers below. |
| `length` | s > 0 | `1` | Clip duration. |
| `fadeIn` | s ≥ 0 | `0` | Crossfade time when the clip enters its layer. Can be overridden at runtime. |
| `fadeOut` | s ≥ 0 | `0` | Fade time when the clip is stopped without an explicit fade, or auto-stops (`hold = false`). |
| `speed` | > 0 | `1` | Playback rate. Multiplied by the runtime `speed` option. |

A clip contains **tracks** (one per `target + channel`) and **events**.

### 4.2 Channels

| Target | Channel | Kind | Default when nothing animates it |
|---|---|---|---|
| joint | `angle` | radians, relative to rest | `0` (rest pose) |
| joint | `strength` | multiplier 0–1 | `1` |
| joint | `gain` | multiplier 0–1 | `1` |
| joint | `damping` | multiplier 0–1 | `1` |
| root | `strength` | global multiplier 0–1 | `ragdoll.channels.strength` (default 1) |
| root | `gain` | global multiplier 0–1 | `ragdoll.channels.gain` (default 1) |
| root | `damping` | global multiplier 0–1 | `ragdoll.channels.damping` (default 1) |
| shape | `sprite` | **discrete**: sprite asset id, or `null` (hidden) | the shape's `sprite.asset` |

Body and shape physics are never animated. The only animatable property of a shape is which image its sprite shows (e.g. a face that swaps between `face_normal`, `face_pain` and `face_dead`).

### 4.3 Keys and interpolation
- A key is `{ t, v, interp }`. `interp` describes the segment from this key to the next one:
  - `linear`: straight interpolation;
  - `step`: holds the value until the next key;
  - `ease`: smoothstep.
- **Discrete channels** (`sprite`) always use `step`, and the editor only offers that option for them.
- New keys use `linear` (`step` on discrete channels).
- Before the first key the first value is held, after the last key the last value is held. A track with a single key is constant. A track with no keys (just added with "+ Track") has no effect on its channel.
- Angles are interpolated linearly in radians, without wrapping, so a key can go beyond ±180°.
- Keys are sorted by `t`, there is at most one key per `t` per track, and `0 ≤ t ≤ length`.

### 4.4 Channel resolution
Each channel of each target is resolved independently, every step:

1. Start from the channel default ([§4.2](#42-channels)).
2. Walk the active layers from **lowest to highest** index. A layer only affects the channels its clip has a track for. There are **no masks**: the tracks *are* the mask.
   - **override:** `value = lerp(below, clipValue, w)`
   - **additive:**
     - `angle`: `value = below + clipValue · w` (the clip stores offsets);
     - multipliers: `value = below · lerp(1, clipValue, w)`.
   - **discrete** (`sprite`): always override, regardless of `blend`. The clip's value is taken when `w ≥ 0.5`, so the image switches at the middle of a fade.

   `w` is the clip's effective weight: fade progress × runtime weight.
3. Apply **procedural overrides** ([§4.8](#48-procedural-joint-control)) on top of all layers.
4. Clamp multiplier channels to 0–1.
5. Apply the root multipliers to every joint ([§3](#3-physics-drive-model-springs-via-motors)). **The root never replaces joint values, it only scales them.**

**Crossfade on the same layer.** When a clip enters a layer that already has an active clip, both are evaluated against the same `below`:

```
layerResult = lerp(outgoingResult, incomingResult, t / fadeIn)
```

When the crossfade ends, the outgoing clip is removed. A clip entering an empty layer fades from `below`. Stopping with a fade does the reverse.

### 4.5 Playback rules
- `play(key)` on a layer whose active clip is the same key is a no-op, unless `restart: true` is passed. It may still update `weight` / `speed`.
- `queue(key)` starts the clip on its layer:
  - immediately, if the layer is empty;
  - when the active clip completes, if it is non-loop;
  - at the end of the current cycle, if it loops.

  Queues are FIFO per layer.
- A non-loop clip completes once when its time reaches `length`. Depending on `hold`, it then holds its last frame or stops itself.

### 4.6 Canonical example

| Clip | Layer | Blend | Loop / hold | Tracks |
|---|---|---|---|---|
| `walk` | 0 | override | loop | `angle` on hips, knees, shoulders |
| `alive` | 99 | override | loop | `root.strength = 1` (single key); head shape `sprite = face_normal` |
| `pain` | 100 | override | non-loop, `hold = false`, 0.8 s, `fadeIn` 0.1, `fadeOut` 0.3 | `angle` on spine/arms (curl in), joint `strength = 0.3` on those joints; head `sprite = face_pain` |
| `dead` | 200 | override | non-loop, `hold = true`, 5 s | `root.strength`: 1 → 0, linear; head `sprite = face_dead` at `t = 0` |

Evaluated by hand with the rules above:
- **Walking and hit:**
  - Knees keep `walk`'s angles, because `pain` has no knee tracks.
  - Spine and arms take `pain`'s angles at strength `0.3 × root 1 = 0.3`, so they are loose and wobbly: "pain".
  - The face switches to `face_pain` once the 0.1 s fade-in passes half.
  - After 0.8 s, `pain` fades out over 0.3 s and the face returns to `face_normal`.
- **Killed at time T:**
  - The face shows `face_dead` immediately.
  - At T + 2.5 s, `root.strength = 0.5`, so every joint runs at half torque (pain joints at 0.15).
  - At T + 5 s everything is at 0: a limp ragdoll that still respects its limits. `dead` holds.
- **Head looking at the cursor while alive** ([§4.8](#48-procedural-joint-control)): the procedural target replaces the neck angle by its weight. When killed, the look-at still sets the target, but `root.strength` takes the neck's torque to 0, so a dead character stops looking without any extra code.
- **Revive:** `stop('dead', { fadeOut: 1 })` brings `root.strength` back to `alive`'s 1 over one second. The face returns to `face_normal` at the middle of the fade.
- **Why `alive` exists:** with default base channels it equals "no clip". It makes the conscious state explicit, and it matters when the ragdoll's base `strength` is below 1 (e.g. an NPC that spawns unconscious with base 0).

### 4.7 Events
- Custom events are `{ t, name, data }`. `data` is any JSON value or `null`. Examples: footsteps, sounds, a "fully_dead" gameplay hook.
- Built-in events: `start`, `loop`, `complete`, `stop`.
- An event fires **exactly once each time playback crosses its time**: the interval is `(prevTime, currTime]`, and an event at `t = 0` fires on start and on every loop wrap. This holds for large `dt` and for loops wrapped within one step.
- In loop clips, events must satisfy `t < length`, so `t = length` and `t = 0` don't fire twice. In non-loop clips, `0 ≤ t ≤ length`.
- Events fire synchronously inside `rag.update(dt)`.

### 4.8 Procedural joint control
Game code can force a joint toward an angle computed at runtime (look at the cursor, aim a weapon, track an enemy). The rotation is still produced **by physics**: the override only changes the motor's target (and optionally its strength). The body is never teleported.

**Where it lives.**
- **Runtime → RagImporter.** The target comes from gameplay data that only exists at runtime (cursor, enemy positions), so the editor cannot key it. A fixed "look this way" is already possible with `angle` keys.
- **Authoring and preview → RagAssembler.** The editor stores each joint's `aimAxis` ([§2.4](#24-joints)), which tells the runtime where the limb's "forward" is. It also offers a preview in Simulate mode ([§5.8](#58-animation-timeline)) so the result can be tuned before it reaches code.

**Resolution.** Overrides are applied after all clip layers (step 3 of [§4.4](#44-channel-resolution)). Joints are independent: aiming the head and an arm at the same time is two overrides.

```
// aim mode (lookAt): computed from the current physics state every update
dir          = targetWorld − jointAnchorWorld
desiredB     = atan2(dir.y, dir.x) − aimAxis            // world angle bodyB should have
procAngle    = wrapToPi(desiredB − bodyA.angle − referenceAngle)
procAngle    = clamp(procAngle, lower, upper)           // if limits are enabled
// angle mode: procAngle is given directly (radians, relative to rest)

angle        = clipAngle + shortestDelta(clipAngle, procAngle) · weight
strength     = opts.strength == null ? clipStrength : lerp(clipStrength, opts.strength, weight)
```

- **`weight` (0–1)** sets how much of the pose comes from the override versus the animation, i.e. how hard or soft the override is. The host can change it every frame, and `fadeIn` / `fadeOut` options ramp it automatically.
- **`strength`** is optional. It decides how hard the motor pushes while overriding, e.g. an arm that aims firmly even during `pain`. It is still multiplied by root and runtime strength ([§3](#3-physics-drive-model-springs-via-motors)), so `dead` always wins.
- With `flipX`, the aim axis is mirrored (`π − aimAxis`) and angles are negated, so the same code works for both facings.
- Aiming a whole chain (spine → neck → head distributing the angle) and true IK are backlog. v1 aims single joints.

---

## 5. Editor

Tech: vanilla JavaScript ES modules, no build step. The viewport is rendered with **PIXI.js** (sprites and gizmos via `PIXI.Graphics`), and simulation uses liquidfun.js through RagImporter. The editor uses the same renderer and runtime as production.

### 5.1 Editor modes

| Mode | Entered by | Viewport shows | Edits affect |
|---|---|---|---|
| **Edit** | Timeline clip selector = "(rest pose)" | Rest pose | Rest pose / object properties |
| **Animate** | Selecting a clip in the timeline | FK pose and sprites of the evaluated clip (plus the preview stack) at the playhead | Keys of the open clip |
| **Simulate** | Play | Live physics through RagImporter | Nothing (read-only). Stop returns to the previous mode |

**FK preview:** in Animate mode the viewport places bodies by forward kinematics:
- `rootBody` stays at its rest transform;
- each child is rotated around its joint anchor by the evaluated `angle`.

Multiplier channels don't move anything. They are shown as the fill of the joint gizmo (grey 0 % → saturated 100 %). Sprite channels swap images live.

**Mode policy.** What each mode allows (✓) or disables (—). Disabled controls stay visible and use `aria-disabled`; disabled inspector fields are read-only.

| Capability | Edit | Animate | Simulate |
|---|---|---|---|
| Select, Select Box, Hierarchy selection | ✓ | ✓ | ✓ |
| Manipulate, Pose | ✓ | ✓ (into keys, below) | — |
| Creation tools: Circle, Box, Polygon, Hinge | ✓ | — | — |
| Rest-pose and object edits: inspector fields of root, bodies, shapes, sprites, joints and sprite assets (and `pixelsPerMeter` in Settings); Hierarchy add/delete; Group, Ungroup, Duplicate; Manipulate move, joint anchor, `aimAxis` and sprite edit | ✓ | — | — |
| Animation edits: clip properties, tracks, keys, events, key buttons ◆, autokey, Key selected (K), Manipulate rotate → parent joint `angle`, Pose → keys | — | ✓ | — |
| Asset import | ✓ | ✓ | — |
| Asset delete | ✓ | — | — |
| Clip selector, New clip | ✓ | ✓ | — |
| Scrub | — | ✓ | — |
| Preview stack | — | ✓ | ✓ |
| Procedural preview | — | — | ✓ |
| New, Load, Save; Undo, Redo | ✓ | ✓ | — |
| Play | ✓ | ✓ | — |
| Pause, Next frame, Stop | — | — | ✓ |
| Editor settings (grid, snapping, display), panels, navigation | ✓ | ✓ | ✓ |

- In Animate mode, inspector fields that are not animatable are shown read-only, and animatable ones show the evaluated value with their key button. Manipulate only rotates (no move handles).
- Changing mode cancels the tool operation in progress (as Esc). If the active tool is disabled in the new mode, the Select tool becomes active.
- **Playhead and open clip.** Opening a different clip puts the playhead at 0; the playhead always stays within `[0, length]` of the open clip, also when `length` changes. When the open clip stops existing (deleted, or its creation undone) the editor returns to Edit mode. New and Load return to Edit mode with the playhead at 0. Stop restores the mode, clip and playhead that were active before Play.

### 5.2 Panels
The workspace below the header is tiled by panels: Viewport, Hierarchy, Assets, Problems, Inspector and Timeline. Panels never overlap. If the window is smaller than the sum of the minimum sizes, the workspace scrolls (see *Window resize* below). The Tools are not a panel: they float over the Viewport ([§5.5](#55-tools)).

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
- **Window menu.** Panels are closed with the × on their tab (or a middle click), and reopened or closed from the **Window** menu ([§5.3](#53-header)). A reopened panel returns to its previous stack and position if that stack still exists; otherwise it joins a stack holding a panel of its default group; otherwise it docks to its default workspace edge with its default size.
- **Persistence.** The layout is saved per browser after every change and restored on load. A stored layout that cannot be read is ignored with a console warning, and the default is used; panels missing from it are added by the reopen rule. If browser storage is unavailable, the layout lives only for the session.
- **Reset layout** restores the default immediately (Timeline folded), with no confirmation, and forgets the stored layout. Layout changes, including Reset and folding, are not undoable.

Default layout. The positions given as "Default location" in [§5.6–5.8](#56-hierarchy-assets-and-problems-panels) refer to it:

```
┌──────────────────────── Header ──────────────────────────┐
├──────────────────────────────────┬───────────────────────┤
│ ┌──┐                             │ Hierarchy|Assets|Prob │
│ │T │        Viewport             ├───────────────────────┤
│ └──┘                             │ Inspector             │
├──────────────────────────────────┴───────────────────────┤
│ Timeline                                             [▸] │  folded
└──────────────────────────────────────────────────────────┘
T: Tools overlay (§5.5), not a panel.
```

| Panel | Default group and edge | Default size | Minimum (w × h) |
|---|---|---|---|
| Viewport | fixed, center | the remaining area | 240 × 160 px |
| Hierarchy, Assets, Problems | one stack, right top | 300 px wide; half the right column | 200 × 96 px |
| Inspector | own stack, right bottom | 300 px wide; the rest of the right column | 200 × 96 px |
| Timeline | own stack, bottom, full width | 220 px high when expanded; starts **folded** (28 px) | 320 × 120 px (28 px high while folded) |

Minimum heights include the 28 px tab bar. "Half the right column" is measured with the Timeline folded. Panels that are not built yet show a centered "*Name* (not available yet)" placeholder.

### 5.3 Header
Location: top, full width. One toolbar row with four button groups divided by separators:

| Group | Buttons, in order | Alignment |
|---|---|---|
| File | New, Load, Save | Left |
| History | Undo, Redo | Left, after File |
| Playback | Play, Pause, Next frame, Stop | Left, after History |
| Workspace | Window, Settings | Right end |

- **Buttons** are text-labelled. Each tooltip shows the label, plus the hotkey from [§5.9](#59-hotkeys-defaults) if one exists. Buttons without a §5.9 hotkey show none.
- **Keyboard:** the header is a single Tab stop (`role="toolbar"`, roving tabindex). Left/Right move between buttons and wrap around, and Home/End jump to the first/last button. These keys do not trigger global hotkeys ([§5.9](#59-hotkeys-defaults)).
- **Unavailable actions** use `aria-disabled` and stay focusable, so keyboard users can still reach them. The tooltip adds the reason: "(not available yet)" for an action that is not built, "(not available in *Mode* mode)" for one the mode policy disables ([§5.1](#51-editor-modes)), and nothing when only the current state disables it (e.g. Undo with nothing to undo).
- If the window is narrower than the row, the header scrolls horizontally. Buttons never wrap.

- **New**: new empty ragdoll. Asks for confirmation if there are unsaved changes.
- **Load**: imports a `.rag.json` from disk (file picker, or drag & drop onto the Viewport panel, Tools overlay included).
  - Older format versions are migrated.
  - Invalid files are rejected with a list of errors.
  - Sprite images are resolved relative to the file. The browser cannot read sibling files on its own, so the editor asks for the asset folder (directory picker where supported, multi-file picker otherwise). Missing images are drawn as placeholders and listed in Problems.
- **Save**: exports the `.rag.json`, and optionally the sprite images under their `src` paths (directory save where supported, otherwise a download of each). Blocked while there are validation **errors**. **Warnings** are allowed.
- **Undo / Redo**: step back or forward through the command stack ([§1](#1-conventions)). Enabled when there is a step to undo or redo, and not in Simulate mode.
- **Play / Pause / Next frame / Stop**:
  - Next frame advances one fixed step (1/60 s).
  - Stop restores the pose and time that were active before Play.
- **Window** menu: one checkbox per panel in the order Viewport, Hierarchy, Assets, Problems, Inspector, Timeline (Viewport is always checked and disabled), a separator, then *Reset layout* ([§5.2](#52-panels)). The Tools overlay is not listed ([§5.5](#55-tools)). Checking a panel reopens it and activates its tab (expanding the Timeline); unchecking closes it. The menu opens below the button, aligned to its right edge. Enter, Space or Down open it on the first item, Up on the last; Up/Down wrap and Home/End jump; Esc closes it and returns focus to the button; Tab closes it and moves on; Left/Right close it and move along the header. Choosing an item or clicking outside closes it. When a closed panel had focus, focus moves to the new active tab of its stack, or else to the viewport.
- **Settings** opens a popover below the button, aligned to its right edge: `role="dialog"` labelled "Settings", not modal. Focus moves to its first control; Tab and Shift+Tab move through its controls and wrap. Esc or the Settings button closes it and returns focus to the button; a press outside closes it without moving focus. Controls, in order:
  - **Grid:** Show grid (checkbox, default on), Grid size (default 1 m, 0.01–100 m), Subdivisions (integer 1–20, default 10) ([§5.4](#54-viewport));
  - **Snapping:** Snap to grid (checkbox, default off);
  - **Display:** Shapes / Sprites / Both (radio group, default Both);
  - **Document:** Pixels per meter (the root's `units.pixelsPerMeter`, [§5.7](#57-inspector--properties-panel)).

  Grid size is shown in px at the current `pixelsPerMeter` and stored in meters. Checkboxes and radios apply at once; number fields apply on commit (Enter or blur), and an invalid value is marked `aria-invalid` and reverted on blur. Closing the popover with the Settings button or a press outside commits a pending number like blur does; Esc reverts the field being edited, then closes. Pixels per meter is a document edit: one undo step per commit, read-only outside Edit mode ([§5.1](#51-editor-modes)). Every other control is an **editor setting**: per browser, saved at once, restored on load (a stored value that is missing or invalid falls back to its default, with a console warning for invalid ones; a stored record of another or no version is ignored as a whole, with one warning), not undoable, available in every mode. If browser storage is unavailable, settings live only for the session. Overlay toggles ([§5.4](#54-viewport)) are added to this popover when the overlays are built.

### 5.4 Viewport
- **Camera:** a `center` in meters and a `scale` in CSS px per meter, independent of `pixelsPerMeter`. Screen coordinates are CSS px from the top-left corner of the viewport host, Y down:

  ```
  screen.x = (x − center.x) · scale + width / 2
  screen.y = (center.y − y) · scale + height / 2        screen angle = −angle
  ```

  - `scale` is clamped to 2–10 000 px/m, and each coordinate of `center` to ±10 000 m.
  - Changing `pixelsPerMeter` keeps the camera: shapes stay in place on screen and sprites change size ([§1](#1-conventions)).
  - Resizing the viewport keeps `center` and `scale`.
  - The camera is not saved and not undoable. After New, Load and draft recovery, and when the editor starts, the view frames everything.
- **Navigation** works in every mode and never reaches the active tool. A press on the canvas focuses the viewport host.
  - **Pan:** middle-button drag, or Space + left drag while the viewport has focus. The world point under the pointer follows it. The cursor is `grab`, and `grabbing` while dragging. Panning or zooming during a tool gesture does not end the gesture.
  - **Zoom:** the mouse wheel zooms around the pointer, keeping the world point under it fixed: `scale · 2^(−Δy / 400)`, with Δy in px (line deltas × 16, page deltas × the viewport height). A wheel with Ctrl (trackpad pinch) uses `2^(−Δy / 100)`. A wheel over the viewport never scrolls or zooms the page. With the viewport focused, `+` (or `=`) and `-` zoom by √2 around the viewport center, and keep zooming while held (they are navigation keys, not [§5.9](#59-hotkeys-defaults) hotkeys).
  - **Framing:** `F` frames the selection, or everything when the selection has nothing to frame; `Home` frames everything. The framed box is the world bounding box of the shapes as displayed (rest pose in Edit, FK pose in Animate, live bodies in Simulate), the joint anchors (in Animate, each anchor moves with its `bodyA`) and the root's position. Of the selection, a body counts its shapes, a shape itself, a joint its anchor and the root its position; other objects count nothing. Sprite images are not included. The box is grown around its center to at least 1 × 1 m (4 × 4 m around the root when the ragdoll has no bodies and no joints), then fitted as large as the scale limits allow into the viewport minus insets of 16 px at the top, right and bottom and, at the left, the Tools overlay width plus 16 px, so nothing framed sits under the overlay. Framing is instant.
- **Grid:** world-space lines behind everything, with the X axis (`y = 0`) in red and the Y axis (`x = 0`) in green over them. Its major spacing is the *grid size* setting (default 1 m) and its minor spacing that size divided by *subdivisions* (default 10, so 0.1 m) ([§5.3](#53-header)). *Show grid* hides it, axes included.
  - **Levels:** the minor spacing, the major spacing, then the major spacing × 10ⁿ for n ≥ 1, equal spacings counted once. At most two levels are drawn: the finest level whose lines are at least 8 px apart on screen, whose opacity ramps from 0 at 8 px to full at 32 px, and the next coarser level, drawn stronger. Zooming out therefore turns 1 m lines into the fine level under 10 m lines.
  - Lines are 1 CSS px wide at every zoom, aligned to device pixels.
- **Snapping:**
  - **Grid snap** (*Snap to grid*, default off) rounds the points that tools place or drag to the nearest multiple of the minor spacing, in world coordinates, whether the grid is shown or not: creation points and polygon vertices, the Hinge anchor, and the position a Manipulate move reaches (root position, body position with its subtree following, joint anchor). Sizes follow from snapped points, and a circle's radius is rounded to the minor spacing, never below it. Sprite edit, Pose, inspector fields and Hierarchy additions do not snap.
  - **Angle snap:** SHIFT while rotating (Manipulate rotate handle, `aimAxis` handle, sprite edit ring) rounds the resulting angle to a multiple of 15°: the body's root-local `angle` in Edit mode, the parent joint's `angle` channel in Animate mode, `aimAxis` and the sprite `angle` in their own frames.
- **Display modes** (Settings, default Both), in every editor mode:

  | Mode | Sprites | Shapes |
  |---|---|---|
  | Shapes | Hidden | Filled with `editor.color` at 40 % opacity, outlined in `editor.color` |
  | Sprites | Shown | Hidden, except hover and selection outlines |
  | Both | Shown | Outlined in `editor.color` at 60 % opacity, no fill, over the sprites |

  Outlines are 1 CSS px wide at every zoom. Hit testing does not depend on the display mode, so a hidden shape can still be hovered and selected. A sprite whose image is missing is drawn as a placeholder whenever sprites are shown.
- **Gizmos:**
  - root: pivot cross + ring;
  - joints: circle at the anchor, an arc from `lower` to `upper` relative to bodyA, a needle for the current angle, the strength fill in Animate mode, and an `aimAxis` arrow when selected;
  - sprite handles in sprite-edit mode ([§5.5](#55-tools)).
- **Feedback:** hover highlight, selection outline, invalid objects outlined red.
- **Overlays (toggles):** names, centers of mass, contacts (Simulate mode).
- **Preview environment** (editor only; never exported, except `preview.gravity`):
  - optional ground line, by default at the lowest point of the rest pose;
  - *pin rootBody* option to hang the ragdoll;
  - gravity.
- **Accessibility:** the viewport host is focusable (`tabindex="0"`) and labelled "Viewport". Since it handles keys itself (navigation above), it uses `role="application"`, with `aria-roledescription="viewport"` and `aria-describedby` pointing to a visually hidden summary of its keys: "Space and drag, or middle drag, pans. Wheel, plus and minus zoom. F frames the selection, Home frames everything." Features that add viewport keys extend the summary. That way screen readers pass single-key hotkeys ([§5.9](#59-hotkeys-defaults)) to the editor instead of using them for browse-mode navigation. The role applies only to the viewport host, never to the page or a panel.

### 5.5 Tools
The tools live in a **floating toolbar overlay inside the Viewport panel**, not in a dock panel. It is always visible, has no toggle and is not listed in the Window menu.

**Layout.**
- A sibling of the viewport host inside the Viewport panel, stacked over it in the same grid cell, top-left with an 8 px margin. The Viewport panel isolates its stacking context, so the overlay never covers other panels or popups.
- A vertical strip: panel surface at 92 % opacity, 1 px border, 6 px radius, 4 px padding; 32 × 32 px buttons with 20 px icons and 2 px gaps; 40 × 299 px.
- Buttons in four groups with separators: selection (Select, Select Box), manipulation (Manipulate, Pose), creation (Circle, Box, Polygon), joints (Hinge Joint).
- When the viewport host is shorter than 315 px, the strip switches to two columns (76 × 149 px). This requires a Viewport minimum of 240 × 168 px; the issue that builds the overlay raises the §5.2 minimum to that value.
- Loading by drag & drop listens on the whole Viewport panel, so a drop on the overlay also loads ([§5.3](#53-header)).

**Icons.** Inline SVG drawn in the repository: `viewBox` 24, stroke `currentColor` at 1.5, round caps.

| Tool | Glyph |
|---|---|
| Select | Arrow cursor. |
| Select Box | Dashed rectangle plus a small cursor. |
| Manipulate | Four-way move cross plus a 270° rotation arc. |
| Pose | Bent limb of three dots plus a drag arrow. |
| Circle | Circle, r = 8. |
| Box | Solid 16 × 12 rectangle. |
| Polygon | Convex pentagon with vertex dots. |
| Hinge Joint | Two overlapping bars, a pin and a small arc. |

**States.**
- The active tool has `aria-pressed="true"`; exactly one button is pressed. Select is active on load. The active tool is not persisted.
- Tools that are not built yet, or that the current mode disables ([§5.1](#51-editor-modes)), use `aria-disabled` and stay focusable. Until the tool registry exists, every button is disabled and none is pressed.
- **Tooltip:** "*Label* (*Key*)", built like the header tooltips ([§5.3](#53-header)), plus " (not available yet)" or " (not available in *Mode* mode)" when disabled. It is a custom tooltip, shown after 400 ms of hover or immediately on keyboard focus, hidden from assistive technology (`aria-hidden`); buttons have an accessible name and no `title` attribute.

**Keyboard.**
- `role="toolbar"`, labelled "Tools", `aria-orientation="vertical"`, one Tab stop whose roving stop is the active tool. Up/Down and Left/Right move and wrap, Home/End jump, Enter/Space activate. These keys do not trigger global hotkeys ([§5.9](#59-hotkeys-defaults)).
- Tab order: inside the Viewport, Tools come before the viewport host; the Viewport takes its place in the layout order ([§5.2](#52-panels)). In the default layout this is header → Tools → viewport host → the other panels.
- A mouse click activates the tool and moves focus to the viewport host. Tool hotkeys work wherever focus is, except in text fields.

**Tools.**

- **Select** (`V`): click to select world objects (root, shapes, joints). SHIFT + click adds to or removes from the selection. SHIFT + drag starts a selection box.
- **Select Box** (`B`): drag to multi-select. With multiple shapes selected, they can be grouped (Ctrl+G) into one body.
- **Manipulate** (`M`): move and rotate.
  - **Root:** dragging moves the whole ragdoll.
  - **Body:** dragging moves the body **and its joint subtree** (child bodies and the connecting joints), so moving an upper arm carries the forearm and hand. ALT + drag moves only the selected body.
  - **Rotate handle:** rotates around the body's parent joint anchor if it has one, otherwise around its center. CTRL forces the center.
  - **Joint:** dragging moves only its anchor. A warning is raised if the anchor ends outside both bodies' shapes. A second handle rotates `aimAxis`.
  - **Sprite edit** (toggle `S` while a shape with a sprite is selected): the handles edit the sprite instead of the shape. Dragging changes `offset`, the ring changes `angle`, the corners change `scale` (SHIFT keeps proportions). Physics is untouched.
  - **In Animate mode:** rotating a body sets the `angle` of its parent joint at the playhead (keyed if autokey is on).
- **Pose** (`P`): simulates physics while the mouse is held, with **no gravity**. The grabbed body is pulled by a mouse joint, and the other joints hold their current pose at moderate strength.
  - In **Edit mode** the result is discarded on release (testing only). It never overrides the rest pose.
  - In **Animate mode** the result becomes the FK pose at the playhead. With **autokey** on, `angle` keys are created for every joint whose angle changed by more than 0.1°.
- **Circle** (`C`): press to create at the click point, drag to resize, release to finish. The anchor is the center. Esc aborts.
- **Box** (`R`): press to create, drag to define the rectangle, release to finish. The anchor can be any of the four corners, and the final size is never negative.
  - SHIFT enforces a square.
  - ALT enforces symmetry.
  - CTRL puts the anchor at the center.
  - Esc aborts.
- **Polygon** (`N`):
  - Click adds a vertex linked to the previous one.
  - Double click closes the shape (last vertex to first).
  - Right click deletes the last vertex.
  - Esc aborts.
  - The shape must be convex with at most 8 vertices. Invalid edges are drawn red while drawing, and closing an invalid polygon is refused.
- **Hinge Joint** (`H`): click where two shapes of different bodies overlap (the two topmost under the cursor). The body closer to `rootBody` becomes bodyA.
  - Click and release creates a "pin" joint with no limits.
  - Dragging away from the anchor enables symmetric limits ±θ, with θ = drag distance at 1 px = 1°, clamped to 0–180°. The arc gizmo is shown while dragging.
  - Limits can be fine-tuned in the inspector.

### 5.6 Hierarchy, Assets and Problems panels
Default location ([§5.2](#52-panels)): right top, as tabs of one stack.

**Hierarchy**
- **Tree:**
  - The root node comes first.
  - Below it is the joint tree from `rootBody`, in the order body → joint → child body.
  - Grouped bodies expand to show their shapes.
  - Shapes with a sprite show its thumbnail.
  - Bodies not connected to `rootBody` are listed under **Unlinked**, with a warning.
  - Loop joints are marked.
- **Search field:** fuzzy filter by name or id. Matches keep their ancestors visible.
- **Selection** is synchronized with the viewport and the inspector.
- **Delete** (Del): deletes the selected objects. Deleting a body also deletes its joints and any tracks that target them or its shapes, after confirmation listing what will be removed. If it was `rootBody`, `rootBody` moves as described in [§2.1](#21-root-the-ragdoll-itself). The whole deletion is one undo step.
- **Add shape:** creates a box body at (0, 0) root-local.
- **Add joint:** creates an unassigned hinge joint at (0, 0) with no limits. It is invalid (error) until `bodyA` / `bodyB` are set in the inspector.

**Assets**
- Lists the sprite assets as thumbnails with their name and `src`.
- **Import** adds images (button or drag & drop).
- **Drag** an asset onto a shape in the viewport or in the Hierarchy to assign it as that shape's sprite.
- **Delete** is blocked while an asset is in use; the panel lists where it is used.

**Problems**: live list of validation errors and warnings ([§6.4](#64-validation)). Clicking one selects the object.

### 5.7 Inspector / Properties panel
Default location ([§5.2](#52-panels)): right bottom. The inspector always shows the public properties of the selection and lets the user edit them. With multiple objects of the same type selected, it edits shared fields, and mixed values are shown as `—`.

- **Display units:** pixels and degrees in the UI, meters and radians in the file. Multipliers are shown as %.
- **Animation:** in Animate mode, animatable properties show a **key button ◆**. It is filled when a key exists at the playhead; clicking inserts or updates the key, and right-click removes it. The field shows the evaluated value at the playhead.

**Ragdoll (root)**

| Property | Notes |
|---|---|
| name | Ragdoll name. |
| id | `root`, read-only. |
| position, angle | Editor scene placement. |
| rootBody | Dropdown of bodies. |
| pixelsPerMeter | Editor and runtime render scale. |
| preview gravity | Editor preview only. |
| strength, gain, damping ◆ | Base global multipliers (0–100 %). Animatable as root channels. |

**Body**

| Property | Notes |
|---|---|
| name, id (read-only) | |
| position, angle | Root-local, rest pose. |
| linearDamping, angularDamping | ≥ 0. |
| fixedRotation, bullet | bool. |
| mass | Read-only, computed from shapes. |
| shapes | List; clicking one selects it. |

**Shape (fixture)**

| Property | Notes |
|---|---|
| name, id (read-only), type (read-only) | |
| circle: center, radius | |
| box: center, width, height, angle | |
| polygon: vertex list | Editable x/y rows, validated convex. |
| density, friction, restitution | Defaults 1, 0.6, 0. |
| isSensor | bool. |
| selfCollide | bool, default false ([§2.5](#25-collision-rules)). |
| categoryBits, maskBits | 16-bit checkbox grid. |
| color | Editor and debug-draw only. |
| **Sprite:** asset ◆ | Dropdown with thumbnails, or "(none)". Animatable as the `sprite` channel. |
| **Sprite:** offset, angle, scale, z, visible | [§2.3](#23-sprites). |

**Joint (revolute)**

| Property | Notes |
|---|---|
| name, id (read-only), type (read-only) | |
| bodyA, bodyB | Dropdowns, plus a swap button. |
| anchor | Root-local. |
| collideConnected | Default false. |
| limits: enabled, lower, upper | Degrees in the UI, `lower ≤ 0 ≤ upper`. |
| motor: maxTorque, gain, damping, maxSpeed | Base values ([§3](#3-physics-drive-model-springs-via-motors)). |
| aimAxis | Degrees in the UI ([§4.8](#48-procedural-joint-control)). |
| angle ◆, strength ◆, gain ◆, damping ◆ | Animated channels at the playhead. |

**Sprite asset**

| Property | Notes |
|---|---|
| name, id (read-only) | |
| src | Relative path. |
| size | Native pixel size and size in meters, read-only. |
| used by | Read-only list. |

**Clip**: all properties of [§4.1](#41-clips). Editing `key` shows a warning that game code referencing the old key will break.

**Key** (selected in the timeline)

| Property | Notes |
|---|---|
| time | Snapped to the timeline step unless snap is off. |
| value | Degrees for `angle`, % for multipliers, an asset dropdown for `sprite`. |
| interp | linear / step / ease (`step` only for `sprite`). |

**Event** (selected in the timeline)

| Property | Notes |
|---|---|
| time | |
| name | Required. |
| data | Text field. Parsed as JSON when valid, otherwise stored as a string. |

### 5.8 Animation timeline
Default location ([§5.2](#52-panels)): bottom, full width. Modeled after Godot's animation panel.

```
┌ [clip ▾ walk] [+ New] [⧉ Duplicate] [🗑]  length [1.00]s  snap [1/30]  [⟲ loop]  [● autokey]  [◆ Key selected (K)] ┐
│ Preview stack: [✓ alive] [ pain] [ dead] ...     Procedural: [ Look at cursor] weight ──○──          zoom ──○──   │
├──────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────┤
│                          │ 0.0     0.2     0.4     0.6     0.8     1.0     ▼ playhead                             │
│ ▾ ragdoll (root)         │                                                                                       │
│     strength             │ ◆───────────────────────────────◆                                                     │
│ ▾ knee_l                 │                                                                                       │
│     angle                │ ◆───────◆───────◆───────◆                                                             │
│     strength             │                                                                                       │
│ ▸ hip_l                  │                                                                                       │
│ ▾ head (shape)           │                                                                                       │
│     sprite               │ ▣face_normal                    ▣face_blink                                           │
│ Events                   │         ▮footstep                       ▮footstep                                     │
└──────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Clip selector:** "(rest pose)" = Edit mode, plus every clip. New / Duplicate / Delete buttons. The selected clip's properties appear in the inspector.
- **Tracks:**
  - The root track group always comes first.
  - Then one group per joint, with sub-tracks for the channels that have keys.
  - Then one group per shape that has a `sprite` track. Its keys are drawn as image thumbnails and always use `step`.
  - "+ Track" adds a channel for the selected joint or shape.
  - Deleting a track removes its keys.
- **Keys:**
  - Shown as diamonds, styled by interpolation.
  - Click selects, SHIFT / box select multi-selects, and dragging moves them (snapped).
  - Ctrl+C / Ctrl+V copy and paste at the playhead; Del deletes.
  - Double-clicking an empty spot in a track inserts a key with the evaluated value.
  - Dropping an asset from the Assets panel onto a sprite track inserts a key with that image.
- **Events track:**
  - Double click adds an event.
  - Events are drawn as markers with their name, can be dragged, and are edited in the inspector.
- **Playhead / scrub:**
  - Click or drag on the ruler.
  - Scrubbing updates the FK preview and the sprites live.
  - The snap step defaults to 1/30 s.
- **Loop toggle and length field** mirror the clip properties.
- **Autokey (●):** while it is on, Pose and Manipulate changes in Animate mode create keys automatically.
- **Key selected (K):** keys the `angle` of all selected joints, or of all joints of the selected bodies, at the playhead.
- **Preview stack:** checkboxes for other clips to evaluate together with the open clip, in both FK preview and Simulate mode (e.g. `alive` + `pain`). During Simulate, clicking a clip name calls `play(key)` on the running instance, so the user can rehearse how game code will trigger clips.
- **Procedural preview** (Simulate mode): *Look at cursor* applies `lookAt` to the selected joints toward the mouse, with a weight slider and an optional strength value. It runs the same RagImporter code as production and is used to tune `aimAxis`, limits and motor values.

### 5.9 Hotkeys (defaults)

| Key | Action | Key | Action |
|---|---|---|---|
| V / B / M / P | Select / Select box / Manipulate / Pose | C / R / N / H | Circle / Box / Polygon / Hinge |
| S | Toggle sprite edit (Manipulate) | Del | Delete |
| Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y | Undo / Redo | Ctrl+S / Ctrl+O | Save / Load |
| Ctrl+G / Ctrl+Shift+G | Group / Ungroup | Ctrl+D | Duplicate selection |
| Space | Play / Pause | . | Next frame |
| K | Key selected | F / Home | Frame selection / all |
| Esc | Abort tool / clear selection | | |

- Hotkeys are ignored while focus is in a text field. Space also goes to a focused button or control instead of Play/Pause.
- On macOS, Cmd acts as Ctrl. Keys match the character the keyboard layout produces (letters case-insensitive), and modifiers must match exactly.
- A matched hotkey always suppresses the browser's own shortcut (e.g. Ctrl+S never opens the browser's save dialog), even when its action is currently disabled.
- Holding a key repeats only Undo, Redo and Next frame; other hotkeys act once per press.
- While a drag or scrub is in progress, hotkeys that edit the document (Delete, Group, Duplicate, Key selected, …) do nothing; Undo and Esc cancel the drag.
- While focus is in a toolbar, a tab list, a resize handle or an open menu, their navigation keys (arrows, Home, End, Space, Enter, Esc) do not trigger global hotkeys.
- In the viewport, Space + left drag pans. A Space press without a drag toggles Play/Pause when Space is released; a left press while Space is held counts as a drag, even without movement.

### 5.10 Inverse kinematics
Out of scope for v1. It was considered mostly for feet placement, but not all ragdolls have feet and not all are humanoid. Procedural joint control ([§4.8](#48-procedural-joint-control)) covers the single-joint cases (look at, aim). If IK is added later, it should be a runtime helper in RagImporter that produces procedural `angle` targets for a chain, not an editor-only feature.

---

## 6. File format (`.rag.json`)

### 6.1 Complete example

```json
{
  "format": "ragassembler",
  "version": 1,
  "meta": { "name": "humanoid", "editorVersion": "0.1.0" },
  "units": { "pixelsPerMeter": 32 },
  "preview": { "gravity": [0, -10] },
  "ragdoll": {
    "id": "root",
    "name": "humanoid",
    "position": [0, 0],
    "angle": 0,
    "rootBody": "b_torso",
    "channels": { "strength": 1, "gain": 1, "damping": 1 }
  },
  "sprites": [
    { "id": "s_torso", "name": "torso", "src": "humanoid/torso.png" },
    { "id": "s_face_normal", "name": "face_normal", "src": "humanoid/face_normal.png" },
    { "id": "s_face_dead", "name": "face_dead", "src": "humanoid/face_dead.png" }
  ],
  "bodies": [
    {
      "id": "b_torso",
      "name": "torso",
      "position": [0, 1.2],
      "angle": 0,
      "linearDamping": 0,
      "angularDamping": 0.1,
      "fixedRotation": false,
      "bullet": false,
      "fixtures": [
        {
          "id": "f_torso",
          "name": "torso",
          "shape": { "type": "box", "center": [0, 0], "width": 0.4, "height": 0.7, "angle": 0 },
          "density": 1,
          "friction": 0.6,
          "restitution": 0,
          "isSensor": false,
          "selfCollide": false,
          "filter": { "categoryBits": 1, "maskBits": 65535 },
          "sprite": { "asset": "s_torso", "offset": [0, 0.02], "angle": 0, "scale": [1, 1], "z": 10, "visible": true },
          "editor": { "color": "#c8a07a" }
        }
      ]
    }
  ],
  "joints": [
    {
      "id": "j_knee_l",
      "name": "knee_l",
      "type": "revolute",
      "bodyA": "b_thigh_l",
      "bodyB": "b_shin_l",
      "anchor": [-0.1, 0.5],
      "collideConnected": false,
      "limits": { "enabled": true, "lower": -2.4, "upper": 0 },
      "motor": { "maxTorque": 80, "gain": 10, "damping": 0.5, "maxSpeed": 20 },
      "aimAxis": 0
    }
  ],
  "clips": [
    {
      "key": "dead",
      "name": "Dead",
      "loop": false,
      "hold": true,
      "layer": 200,
      "blend": "override",
      "length": 5,
      "fadeIn": 0,
      "fadeOut": 0,
      "speed": 1,
      "tracks": [
        {
          "target": "root",
          "channel": "strength",
          "keys": [
            { "t": 0, "v": 1, "interp": "linear" },
            { "t": 5, "v": 0, "interp": "linear" }
          ]
        },
        {
          "target": "f_head",
          "channel": "sprite",
          "keys": [{ "t": 0, "v": "s_face_dead", "interp": "step" }]
        }
      ],
      "events": [{ "t": 5, "name": "fully_dead", "data": null }]
    }
  ]
}
```

(The example is abbreviated: a valid file would also contain `b_thigh_l`, `b_shin_l` and the head body with shape `f_head`.)

### 6.2 Field reference
- **Coordinate spaces:**
  - `shape` coordinates are local to the body;
  - `sprite.offset/angle` are local to the shape's frame ([§2.2](#22-bodies-and-shapes));
  - `bodies[].position/angle` and `joints[].anchor` are local to the root, in rest pose;
  - `joints[].aimAxis` is local to bodyB;
  - `ragdoll.position/angle` is the root's placement in the editor scene and is **ignored by runtime spawn**, which uses its own transform.
- **`ragdoll.channels`**: base values of the global multipliers when no clip animates them.
- **`sprites[].src`**: path relative to the `.rag.json` file. It is used as the texture key unless the host provides a resolver ([§7.3](#73-sprites-and-rendering)).
- **`fixtures[].sprite`**: optional; `null` or absent means no sprite.
- **`tracks[].target`**: `"root"`, a joint id or a shape id.
  - Valid channels for `root`: `strength | gain | damping`.
  - Valid channels for a joint: `angle | strength | gain | damping`.
  - Valid channel for a shape: `sprite` (key values are a sprite asset id or `null`).
- **Editor-only data:** `editor` objects (on fixtures), `preview` and `ragdoll.position/angle`. RagImporter ignores them, except `editor.color`, which is used by `debug` drawing.
- **Explicit values:** every field is written explicitly, even when it equals its default, so files are self-describing. A missing field is an error, except `fixtures[].sprite` (absent means `null`).
- **Field schema:** the type, default (for new objects), range or enum, unit and editor-only flag of every field, in canonical key order, are listed in `docs/schema.md`. That table and its code version (`lib/schema.js`) must agree with this section and [§6.1](#61-complete-example).

### 6.3 Versioning
- `version` is an integer and increases on any breaking change.
- The editor migrates older versions on load and always saves the latest one.
- RagImporter declares the versions it supports and **throws** on any other version, with a clear message.
- Unknown fields:
  - RagImporter ignores them;
  - the editor drops them with a warning.

### 6.4 Validation
Shared by the editor (Problems panel, load, save) and RagImporter (`parse`), via `RagImporter.validate(json) → { errors, warnings }`.

**Errors** (block save / parse):
- `format` is not `"ragassembler"`, or `version` is unsupported.
- A missing field, a field of the wrong type, or a value outside the range or enum given for it in `docs/schema.md`.
- Duplicate ids (across bodies, shapes, joints and sprite assets), use of the reserved `root` id, or a missing (`null`) or unknown `rootBody`.
- A body without fixtures.
- A joint with a missing `bodyA`/`bodyB`, or `bodyA == bodyB`.
- `lower > 0` or `upper < 0` when limits are enabled.
- A non-positive size or radius.
- A polygon that is not convex or CCW, has fewer than 3 or more than 8 vertices, or is degenerate.
- A sprite that references an unknown asset, or has a scale of 0.
- A duplicate or invalid clip `key`.
- A track with an unknown target, a channel invalid for its target, or more than one track for the same `target + channel` in a clip.
- Keys unsorted, duplicated in `t`, or outside `[0, length]`.
- A multiplier value outside 0–1.
- A `sprite` key whose value is not an existing asset id or `null`, or whose `interp` is not `step`.
- `length ≤ 0`, `speed ≤ 0`, or `fadeIn`/`fadeOut < 0`.
- An event with an empty `name`, or a `t` out of range ([§4.7](#47-events)).

**Warnings:**
- A body not connected to `rootBody`.
- A joint anchor outside both bodies' shapes.
- A body with zero mass.
- Loop joints.
- An empty clip (no tracks and no events).
- A sprite asset that is unused, or whose image is missing in the editor.

### 6.5 Round-trip guarantee
**Load → Save produces a byte-identical file** for any valid file written by the same format version. To achieve this:
- Key order follows the example above.
- Arrays keep editor order: sprite assets in Assets panel order; bodies, joints and clips in hierarchy/list order; fixtures in body order; keys sorted by `t`; events sorted by `t`.
- Numbers are rounded to 1e-5 and written without trailing zeros. `-0` is written as `0`.
- 2-space indentation, `\n` line endings, final newline.
- Sprite images are written back unchanged (same bytes, same paths).

---

## 7. RagImporter

RagImporter is the `lib/` folder of ES modules, with `lib/ragimporter.js` as its only public entry point. It is built **specifically for LiquidFun and PIXI.js**:

- It parses files, builds the ragdoll in a LiquidFun world, creates and syncs PIXI sprites, and drives the ragdoll with the animation model and procedural overrides above.
- It bundles neither library. It uses the host's liquidfun.js and PIXI.js, each taken from `RagImporter.configure` when passed there, otherwise from its global:
  - liquidfun.js: the `Box2D` namespace (`globalThis.Box2D`, or `configure({ Box2D })`). Classes and constants live on it (`Box2D.b2World`, `Box2D.b2RevoluteJointDef`, `Box2D.b2_dynamicBody`); there are no global `b2*` names.
  - PIXI.js: `globalThis.PIXI`, or `configure({ PIXI })`.
- The supported liquidfun.js build is the Emscripten (asm.js) port pinned in `vendor/` (`docs/development.md`). Its objects use WebIDL accessors for fields (`bd.set_type(Box2D.b2_dynamicBody)`, `body.GetPosition().get_y()`); methods keep their Box2D names (`world.Step`, `body.ApplyLinearImpulse`). In this document, `b2Xxx` names a class of that namespace (`Box2D.b2Xxx`).
- `parse` and `validate` need neither library. `spawn` resolves both and throws an `Error` naming the missing one.
- The editor uses these same modules for validation, evaluation, Simulate mode and rendering. It may also import the internal `lib/` modules (schema, serializer, emitter); host projects and `demo/` use only `lib/ragimporter.js`.

```js
import { RagImporter } from './lib/ragimporter.js';
// liquidfun.js (global Box2D) and PIXI.js v8 (global PIXI) loaded by the host with <script> tags.

const app   = new PIXI.Application(); await app.init({ resizeTo: window });
const gravity = new Box2D.b2Vec2(0, -10);
const world = new Box2D.b2World(gravity);
Box2D.destroy(gravity);                                       // copied by the world (§7.4)

const json = await (await fetch('assets/humanoid.rag.json')).json();
const def  = RagImporter.parse(json);                         // validates; throws on errors or unsupported version
await PIXI.Assets.load(def.spriteUrls('assets/'));            // preload images relative to the .rag.json location

const rag = def.spawn(world, { parent: app.stage, x: 2, y: 0, angle: 0, flipX: false });

rag.play('alive');
rag.play('walk');
rag.on('event', e => { if (e.name === 'footstep') playSound(); });   // e: { rag, clip, layer, name, data, time }

function onHit()    { rag.play('pain', { fadeIn: 0.1, restart: true }); }
function onDeath()  { rag.play('dead'); }
function onRevive() { rag.stop('dead', { fadeOut: 1 }); }

// head follows the cursor, softly
app.stage.eventMode = 'static';
app.stage.on('pointermove', ev => rag.lookAt('neck', rag.toWorld(ev.global), { weight: 0.7 }));

// game loop, fixed step recommended
app.ticker.add(() => {
  rag.update(dt);           // animation + procedural → motors
  world.Step(dt, 8, 3);
  rag.sync();               // physics → PIXI sprites
});
```

### 7.1 API

**`RagImporter`**

| Member | Description |
|---|---|
| `RagImporter.configure({ Box2D, PIXI, contactFilter })` | Optional; every key optional. Sets the liquidfun.js `Box2D` namespace and/or the PIXI module to use instead of the globals. `contactFilter` (default `true`): `false` selects the `groupIndex` fallback ([§2.5](#25-collision-rules)) for worlds not yet in use. A key that is omitted keeps its previous setting. |
| `RagImporter.setContactFilter(world, predicate)` | Sets or clears (`null`) the host's predicate `(fixtureA, fixtureB) → boolean` for that world's contact filter, installing the filter if needed ([§7.5](#75-contact-filter-and-host-integration)). Throws in fallback mode. |
| `RagImporter.releaseWorld(world)` | Destroys the world's remaining instances, uninstalls and destroys its contact filter and forgets the world. Call it right before `Box2D.destroy(world)`. No-op for a world RagImporter never used. |
| `RagImporter.parse(json) → RagDef` | Validates and builds an immutable definition. Throws `RagFormatError` with the error list. |
| `RagImporter.validate(json) → { errors, warnings }` | Validation without throwing. |
| `RagImporter.supportedVersions` | e.g. `[1]`. |

**`RagDef`** (one per file; can spawn many instances)

| Member | Description |
|---|---|
| `def.name`, `def.pixelsPerMeter` | From the file. |
| `def.clips` | Array of `{ key, name, loop, layer, length }`. |
| `def.spriteUrls(baseUrl) → string[]` | Image URLs to preload. |
| `def.spawn(world, opts) → RagInstance` | Creates bodies, fixtures and joints at the spawn transform in rest pose, plus a PIXI container with the sprites. Options below. |

`spawn` options:
- `parent`: PIXI container to add the view to;
- `x`, `y`, `angle`: spawn transform (meters, radians);
- `flipX`;
- `textures`: `(src, asset) → PIXI.Texture` resolver; default `PIXI.Assets.get(baseUrl + src)`;
- `debug`: draw shapes with `editor.color` and joint gizmos.

**`RagInstance`**

| Member | Description |
|---|---|
| `play(key, { fadeIn, weight = 1, speed = 1, restart = false })` | Starts the clip on its layer (crossfading the current one). |
| `queue(key, opts)` | See [§4.5](#45-playback-rules). |
| `stop(key, { fadeOut })` / `stopLayer(layer, { fadeOut })` / `stopAll()` | Stops a clip, a layer or everything. |
| `setWeight(key, w)` | Changes the runtime weight of an active clip. |
| `isPlaying(key)` | Whether the clip is active. |
| `activeClip(layer)` | Key of the clip active on a layer. |
| `setStrength(v)` / `setGain(v)` / `setDamping(v)` | Runtime global multipliers, 0–1, default 1. |
| `lookAt(jointName, worldPoint, { weight, strength, fadeIn })` | Procedural aim ([§4.8](#48-procedural-joint-control)). Calling it again updates the target and options. |
| `setJointAngle(jointName, angle, { weight, strength, fadeIn })` | Procedural override with a direct angle (radians, relative to rest). |
| `clearJointOverride(jointName, { fadeOut })` / `clearAllOverrides()` | Removes overrides. |
| `toWorld(pixiPoint) → { x, y }` / `toPixi(worldPoint)` | Coordinate conversion through `pixelsPerMeter` and the view's parent transform. |
| `on(type, fn)` / `off(type, fn)` | Types: `event` (custom), `start`, `loop`, `complete`, `stop`. `on` returns a function that removes the listener. |
| `update(dt)` | Advances clips, fires events, resolves fades and queues, evaluates channels and overrides, writes the motors and sprite images. Call it once per physics step, **before** `world.Step`. |
| `sync()` | Copies body transforms to the sprites. Call it **after** `world.Step`. |
| `view` | The instance's `PIXI.Container`, with `sortableChildren` on and sprite `zIndex = z`. |
| `body(name)` / `joint(name)` / `shape(name)` / `sprite(shapeName)` | Native LiquidFun (`Box2D.b2Body`, `Box2D.b2RevoluteJoint`, `Box2D.b2Fixture`) / PIXI objects, looked up by name. |
| `bodies` / `joints` | Maps id → native object. |
| `position`, `angle` | Follow `rootBody`. |
| `destroy()` | Removes its shapes from the contact filter registry, then joints, then bodies, from the world ([§7.4](#74-native-memory), [§7.5](#75-contact-filter-and-host-integration)), destroys the view and clears listeners and overrides. Native objects obtained from the instance are invalid afterwards. The host never destroys an instance's bodies or joints itself. |

### 7.2 Spawn and flipX
- Every body's world transform is `spawnTransform × rootLocal`. Joints are created with `Box2D.b2RevoluteJointDef` and its `Initialize(bodyA, bodyB, anchorWorld)` while the bodies are at rest, so LiquidFun computes the reference angle that matches the rest pose (`referenceAngle = angleB − angleA`).
- `world.CreateJoint` returns a base `b2Joint`. Spawn casts it once with `Box2D.castObject(joint, Box2D.b2RevoluteJoint)` and stores that wrapper; it is what `rag.joint(name)` and `rag.joints` return. Casts and `wrapPointer` return cached wrappers for the same pointer, so the cast is never repeated in `update()`.
- Filter data is written with `fixture.GetFilterData()`, its `set_categoryBits` / `set_maskBits` / `set_groupIndex`, then `fixture.SetFilterData(filter)`. The 16-bit bit fields read back signed (`maskBits` defaults to −1), so values read from LiquidFun are masked with `& 0xffff`.
- Boolean getters of the binding (`IsMotorEnabled`, `IsLimitEnabled`, …) return `1`/`0`, not `true`/`false`.
- `flipX` mirrors the ragdoll horizontally:
  - x coordinates and body angles are negated;
  - polygon vertex order is reversed (to stay CCW);
  - limits become `(−upper, −lower)`;
  - `angle` channel values are negated during evaluation;
  - `aimAxis` becomes `π − aimAxis`;
  - each sprite's horizontal scale and its offset x are negated.
- Self-collision is set up at spawn time following [§2.5](#25-collision-rules) and [§7.5](#75-contact-filter-and-host-integration): each fixture is registered right after `CreateFixture`, before any `world.Step` can pair it.

### 7.3 Sprites and rendering
- Each shape with a sprite gets one `PIXI.Sprite` (anchor 0.5) inside `rag.view`.
- `sync()` computes, for every sprite: world transform = body transform × shape local frame × sprite `offset/angle`. It converts that to PIXI coordinates ([§1](#1-conventions)) and applies `scale` (mirrored when `flipX`).
- `update()` applies the resolved `sprite` channel by swapping `sprite.texture` (or hiding the sprite when the value is `null`). Textures are resolved once per asset and cached per `RagDef`.
- **Atlases:** the default resolver uses `src` as a URL. A host that packs sprites in a spritesheet passes `textures: (src, asset) => PIXI.Texture.from(asset.name)` (or any mapping). The file stays the same.
- With `debug: true`, a `PIXI.Graphics` layer draws shapes (`editor.color`), joint anchors and limits.

### 7.4 Native memory
The pinned liquidfun.js build has a **fixed 16 MiB heap that cannot grow**. Every object created with `new Box2D.*` lives there until `Box2D.destroy`. When the heap runs out, the module aborts ("Cannot enlarge memory arrays") and is unusable until the page reloads. RagImporter therefore follows these rules (the editor's Simulate mode and `demo/` follow them too):

1. **Copied inputs are destroyed right away.** Body, fixture and joint defs, shapes and `b2Filter` objects are copied by the world: `Box2D.destroy` them right after the `Create*` / `Set*` call that uses them.
2. **Vectors passed to setters are copied** (`set_position`, `set_target`, `SetTransform`, `ApplyLinearImpulse`), so they can be overwritten or destroyed afterwards.
3. **World-owned objects and getter results are never passed to `Box2D.destroy`:** bodies, fixtures and joints (use `world.DestroyBody` / `DestroyJoint`), the results of `GetFilterData`, `GetPosition`, `GetLinearVelocity` and similar, and an installed contact filter.
4. **`update()` and `sync()` allocate nothing.** Vector arguments use one scratch `b2Vec2`, per instance or per module, written with `set_x` / `set_y`.
5. **By-value vector getters share one static temporary** (`GetLinearVelocity`, `GetWorldPoint`, …): read its components into numbers before the next such call.
6. **Teardown destroys joints before bodies** and drops the cached wrappers. `DestroyBody` removes attached joints natively, but their JS wrappers stay and point at freed memory.
7. **The contact filter lives as long as the world.** RagImporter creates it on the world's first `spawn` or `setContactFilter` and keeps it installed when the last instance is destroyed. Only `releaseWorld` uninstalls it (`world.SetContactFilter(null)`) and then destroys it; destroying a filter that is still installed is a use-after-free on the next `Step`.
8. **Unused worlds are destroyed.** A `b2World` takes a large part of the heap; about 15 live worlds abort `Step`. Hosts, the editor's Simulate mode and tests call `releaseWorld(world)` and then `Box2D.destroy(world)` for every world they discard.

Under these rules the heap does not grow: `tests/liquidfun-api.test.js` checks 20,000 create/destroy cycles of two bodies and a joint, and 10⁶ `SetTransform` + `ApplyLinearImpulse` calls with one reused `b2Vec2`. A leaked `b2Vec2` costs 16 bytes, so about 676,000 leaks, under 10 minutes of one leak per joint per step for a 20-joint ragdoll at 60 Hz, abort the module.

### 7.5 Contact filter and host integration
The binding has no `b2World.GetContactFilter`, and a world holds one filter: a second `SetContactFilter` replaces the first, and `SetContactFilter(null)` leaves the world with **no filtering at all** (Box2D's default rule is not restored). RagImporter therefore owns the filter of every world it spawns into, and the host plugs into it instead of installing its own. Verified in Node by `tests/liquidfun-contact-filter.test.js`.

- **Per-world state.** RagImporter keeps, per `b2World` wrapper, one `JSContactFilter`, a registry and the host predicate. One filter serves every instance in the world.
- **Registry.** Fixture `userData` only stores an integer, so shapes are identified by pointer: the registry maps `Box2D.getPointer(fixture)` (stable, and equal to the pointer `ShouldCollide` receives) to `{ instance, selfCollide }`. `spawn` adds an entry per fixture; `destroy` removes them **before** `DestroyBody`, because freed fixture memory is reused by later fixtures. Fixtures not in the registry (host bodies) skip the self-collision rule.
- **`ShouldCollide(ptrA, ptrB)`** wraps both pointers with `Box2D.wrapPointer(ptr, Box2D.b2Fixture)` and applies the three steps of [§2.5](#25-collision-rules), stopping at the first that refuses. It allocates nothing. Box2D calls it only when a pair of fixtures starts overlapping, so it costs little per step (20 humanoids of 10 shapes: about 120 calls per step, +8 % step time).
- **Host predicate.** `RagImporter.setContactFilter(world, (fixtureA, fixtureB) => boolean)` is called only for pairs that passed steps 1 and 2, including host–host pairs. It can only exclude pairs, never make the default rule collide pairs it rejects. It must not throw and must not change the world. Setting or clearing it affects only pairs that start overlapping afterwards; existing contacts are kept. Calling it before any `spawn` installs the filter, so a host can route all its filtering through RagImporter from the start.
- **Host rules.** A host never calls `world.SetContactFilter` on a world RagImporter uses: before the first spawn RagImporter's filter replaces it, after it RagImporter's filter is silently dropped, together with self-collision and the default rule. A host that needs its own filter (for example to collide pairs the default rule excludes) uses `configure({ contactFilter: false })` and gets the `groupIndex` fallback.
- **Fallback.** With no filter, RagImporter only writes `groupIndex = −instanceId` on the instance's fixtures. Instance ids are the smallest unused positive integer; `spawn` throws when 32,767 instances are alive in fallback mode (16-bit `groupIndex`). `setContactFilter` throws in this mode.
- **Teardown.** `releaseWorld(world)` destroys the world's remaining instances, calls `world.SetContactFilter(null)`, `Box2D.destroy`s the filter and forgets the world ([§7.4](#74-native-memory) rules 7 and 8). The world is left with no filtering, so the host destroys it next. Spawning into the same world again starts a new filter.

---

## 8. Integration workflow (separate JS project)

1. **Author** the ragdoll, sprites and clips in RagAssembler, then save `name.rag.json` together with its sprite folder.
2. **Copy** into the host project:
   - the whole `lib/` folder (import only `lib/ragimporter.js`; the other files are internal);
   - the `.rag.json` and its sprite folder, keeping the relative paths.

   The host already loads liquidfun.js and PIXI.js.
3. **Load once:** `fetch` → `RagImporter.parse` → `PIXI.Assets.load(def.spriteUrls(base))`. Keep the `RagDef`.
4. **Spawn** one `RagInstance` per character with `def.spawn(world, { parent, … })`. For collision filtering beyond `categoryBits` / `maskBits` / `groupIndex`, pass a predicate to `RagImporter.setContactFilter(world, …)`; never call `world.SetContactFilter` ([§7.5](#75-contact-filter-and-host-integration)).
5. **Drive it from game logic** with `play` / `queue` / `stop` by **clip key**, for example:
   - spawn → `alive` + `idle`;
   - movement → `walk` / `run` on layer 0;
   - damage → `pain`;
   - death → `dead`.
6. **Procedural control:** use `lookAt` / `setJointAngle` with a weight for aiming and looking. Fade the weight to blend in and out.
7. **React** to clip events (`footstep`, `fully_dead`, …) with `rag.on`.
8. **Access physics and visuals directly** through `rag.body(name)`, `rag.joint(name)` and `rag.sprite(name)` for gameplay (impulses on hit, damage zones by body name, attachments, tinting).
9. **Each frame:** `rag.update(dt)` → `world.Step(dt, …)` → `rag.sync()`.
10. **Tear down:** `rag.destroy()` for a single character; for the whole world, `RagImporter.releaseWorld(world)` → `Box2D.destroy(world)`.
11. **Iterate:** re-exporting from the editor never breaks code **as long as clip keys and body/joint/shape names are kept**. A changed format version is reported by `parse` with a clear error.

---

## 9. Project layout

```
index.html                 editor entry point
js/main.js                 editor bootstrap
js/editor.js               editor composition root (model, commands, modes, tools)
js/…                       model, commands, tools, viewport, panels
lib/ragimporter.js         runtime public entry: validate, parse, spawn, drive, render sync
lib/…                      runtime and shared pure modules (schema, emitter, validation, serializer, evaluator)
docs/                      how the code is built; the module map is docs/architecture.md
vendor/liquidfun.js        physics engine build (editor and demo)
vendor/pixi.min.js         PIXI.js build, pinned version (editor and demo)
tests/                     round-trip and evaluator tests (Node, ES modules)
demo/                      production preview (§10)
```

---

## 10. Demo

`demo/` simulates a **production preview**: a host page that uses only the public RagImporter API with liquidfun.js and PIXI.js, the way an external project would. It must not import anything from `js/` (the editor).

- **Asset:** `demo/assets/humanoid.rag.json` with its sprite folder, a generic humanoid **created and exported with the editor** (not hand-written).
  - Clips: `idle`, `walk`, `alive`, `pain` and `dead` from [§4.6](#46-canonical-example), plus a `footstep` event in `walk`.
  - Face sprites: `face_normal`, `face_pain` and `face_dead`, swapped by the timeline.
  - `aimAxis` set on the neck and the right shoulder.
- **Scene:**
  - ground and two walls;
  - two instances, the second spawned with `flipX`, to show both cross-instance collision and the self-collision rules.
- **Controls:**
  - Walk toggle;
  - Hit (`pain`), Kill (`dead`), Revive (`stop('dead', { fadeOut: 1 })`);
  - global strength slider (`setStrength`);
  - **Look at cursor** toggle (neck) and **Aim arm** toggle (right shoulder), each with a weight slider;
  - Debug draw toggle;
  - Respawn;
  - click on a body applies an impulse, and dragging uses a mouse joint.
- **Event log:** lists `start` / `loop` / `complete` / `stop` and custom events as they fire.

---

## 11. Roadmap and acceptance criteria

| Phase | Scope | Done when |
|---|---|---|
| 1. Editor – rigging | Panels, header, PIXI viewport, tools, hierarchy, assets, sprites and sprite edit, inspector, undo/redo, validation + Problems, save/load with sprites | The demo humanoid can be built from scratch with sprites and saved/loaded. |
| 2. Editor – animation | Timeline, clips, tracks (including `sprite`), keys, events, FK preview, autokey, preview stack. The evaluator is written in `lib/` (`lib/evaluate.js`, pure, no physics) | The canonical clips can be authored and scrubbed, with face swaps. |
| 3. Round-trip verification | Tests over a fixture set (humanoid, groups, polygons, sprites, all channels, additive clips, events) | Load → save is byte-identical for every fixture. Each invalid fixture is rejected with the expected error. The evaluator gives the hand-computed values from §4.6. |
| 4. RagImporter runtime | Spawn, motor controller, layers/fades/queues, events, procedural overrides, flipX, PIXI sprite sync, self-collision. Editor Simulate mode and procedural preview run on it | Editor Simulate and a host page show the same behavior. The event tests pass (no missed or duplicated events with large `dt` and loop wraps). `lookAt` respects limits and `dead`. |
| 5. Demo | §10 | Every control works with the exported asset, and no editor code is imported. |

---

## 12. Open items / to verify

- **Contact filter edge cases:** verify in the pinned build that the joint `collideConnected` check runs before the JS filter (as in upstream Box2D), and what an exception thrown by `ShouldCollide` (for example by a host predicate) does to `world.Step` and the module ([§7.5](#75-contact-filter-and-host-integration)).
- **Resolved – contact filter integration:** RagImporter installs one `JSContactFilter` per world that reimplements Box2D's default rule, adds the self-collision rule through a pointer-keyed registry and ANDs an optional host predicate; `releaseWorld` uninstalls and destroys it; the `groupIndex` fallback remains for builds without `JSContactFilter` and hosts that opt out ([§2.5](#25-collision-rules), [§7.5](#75-contact-filter-and-host-integration)). Verified in Node by `tests/liquidfun-contact-filter.test.js`.
- **Resolved – liquidfun.js API surface:** the pinned build exposes `b2RevoluteJointDef.Initialize`, the `b2RevoluteJoint` motor, limit, angle and speed methods (after `Box2D.castObject`), fixture filter data, `b2MouseJointDef` / `b2MouseJoint.SetTarget`, `world.DestroyBody` / `DestroyJoint`, `getPointer`, `compare` and `Box2D.destroy` (§3, §7.2). Heap behavior and allocation rules are in §7.4. Verified in Node by `tests/liquidfun-api.test.js`. Side effect: in Node the build installs a `process.on('uncaughtException')` handler.
- **Resolved – liquidfun.js build:** pinned to the doebi/liquidfun.js v1.1.0 Emscripten (asm.js) build. It exposes a single global `Box2D` namespace with WebIDL accessors (§7). Checksum and provenance in `docs/development.md`.
- **Resolved – PIXI.js version:** pinned to 8.21.0. `Assets`, `sortableChildren`/`zIndex` and `eventMode` + `pointermove` were verified in the browser (`docs/development.md`).
- **Motor stability:** verify the PD-over-motor behavior with high `gain` and light bodies, and with procedural overrides that jump far from the clip angle. Tune the default `motor` values for the demo humanoid. Consider velocity/position iterations ≥ 8/3.
- **Sprite file access in the browser:** directory pickers are not available in every browser. The multi-file fallback must be usable with 20+ images.
- **Performance:** measure the cost of `update()` + `sync()` with many instances (target: 20 humanoids at 60 Hz without noticeable cost).
- **`meta` on Save:** decide whether Save rewrites `meta.name` (from `ragdoll.name`) and `meta.editorVersion` (to the running editor), and how that fits the byte-identical round-trip of [§6.5](#65-round-trip-guarantee) across editor versions. Until then the serializer writes the loaded values unchanged.
- **Mode switching with a folded Timeline:** Edit/Animate mode is chosen with the Timeline clip selector ([§5.1](#51-editor-modes)), which is hidden while the Timeline is folded, as it is by default. Decide whether the folded tab bar shows a summary (mode and open clip) or another control exposes the clip selector, before the Timeline panel is built.
- **Viewport input and line rendering:** verify in the browser, with the pinned PIXI.js 8.21.0, that strokes stay 1 CSS px and crisp under a scaled world container and at `devicePixelRatio` > 1 (`pixelLine` strokes or a redraw with width `1 / scale`), and that redrawing the grid on every camera change is cheap; that the wheel factors of [§5.4](#54-viewport) feel alike for mouse wheels and trackpad pinch (`ctrlKey`) in Chromium, Firefox and Safari, and that a non-passive `wheel` listener prevents page zoom; and that a middle-button press does not start autoscroll or, on Linux, paste. Also that with `sharedTicker: true` the application's render runs on `Ticker.shared` after the viewport's redraw callbacks (added at normal priority, render at low), so scene and grid changes appear in the same frame, and that destroying the application leaves `Ticker.shared` running.
- **Determinism:** the same file plus the same inputs should give the same simulation on the same machine, so the editor preview can be compared against the host page.

## 13. Out of scope for v1 (backlog)

- Inverse kinematics and chain aiming (spine → neck → head distribution).
- Concave polygon decomposition.
- Weld, prismatic and other joint types.
- A transition matrix (per source → destination durations). For now, transitions use per-clip `fadeIn`/`fadeOut` plus runtime overrides.
- Runtime scaling of a ragdoll (it requires consistent scaling of mass and torque).
- Spritesheet/atlas authoring in the editor (the runtime already supports atlases through the texture resolver).
- Animating sprite offset, angle, scale, tint or z.
- Physics engines other than LiquidFun and renderers other than PIXI.js.
- Multiple ragdolls per file.

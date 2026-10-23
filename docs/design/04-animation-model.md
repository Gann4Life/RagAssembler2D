# 4. Animation model

## 4.1 Clips

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

## 4.2 Channels

| Target | Channel | Kind | Default when nothing animates it |
|---|---|---|---|
| joint | `angle` | radians, relative to rest | `0` (rest pose) |
| joint | `strength` | multiplier 0–1 | `1` |
| joint | `gain` | multiplier 0–1 | `1` |
| joint | `damping` | multiplier 0–1 | `1` |
| root | `strength` | global multiplier 0–1 | `ragdoll.channels.strength` (default 1) |
| root | `gain` | global multiplier 0–1 | `ragdoll.channels.gain` (default 1) |
| root | `damping` | global multiplier 0–1 | `ragdoll.channels.damping` (default 1) |
| root | `bodyAngle` | radians, world orientation of `rootBody` relative to its rest orientation in the root frame | `0` (rest orientation) |
| shape | `sprite` | **discrete**: sprite asset id, or `null` (hidden) | the shape's `sprite.asset` |

- **`bodyAngle`** is the target of the balance controller at runtime ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)) and the rotation of `rootBody` in the FK preview ([§5.1](05-1-modes.md#51-editor-modes)). Positive is counter-clockwise; `0.3` means "`rootBody` turned 0.3 rad counter-clockwise from how it was spawned". It is an angle channel like a joint's `angle`: same interpolation, same additive rule, no base field in `ragdoll.channels`. It is not the root's own `ragdoll.angle` (the locked editor placement, [§2.1](02-object-model.md#21-root-the-ragdoll-itself)), hence the distinct name.
- There is no root position channel: under physics the ragdoll's position comes from its legs and contacts, never from an animated offset ([§13](13-out-of-scope.md#13-out-of-scope-for-v1-backlog)).

Body and shape physics are never animated. The only animatable property of a shape is which image its sprite shows (e.g. a face that swaps between `face_normal`, `face_pain` and `face_dead`).

## 4.3 Keys and interpolation
- A key is `{ t, v, interp }`. `interp` describes the segment from this key to the next one:
  - `linear`: straight interpolation;
  - `step`: holds the value until the next key;
  - `ease`: smoothstep.
- **Discrete channels** (`sprite`) always use `step`, and the editor only offers that option for them.
- New keys use `linear` (`step` on discrete channels).
- Before the first key the first value is held, after the last key the last value is held. A track with a single key is constant. A track with no keys (just added with "+ Track") has no effect on its channel.
- Angles are interpolated linearly in radians, without wrapping, so a key can go beyond ±180°.
- Keys are sorted by `t`, there is at most one key per `t` per track, and `0 ≤ t ≤ length`.

## 4.4 Channel resolution
Each channel of each target is resolved independently, every step:

1. Start from the channel default ([§4.2](#42-channels)).
2. Walk the active layers from **lowest to highest** index. A layer only affects the channels its clip has a track for. There are **no masks**: the tracks *are* the mask.
   - **override:** `value = lerp(below, clipValue, w)`
   - **additive:**
     - `angle` and `bodyAngle`: `value = below + clipValue · w` (the clip stores offsets);
     - multipliers: `value = below · lerp(1, clipValue, w)`.
   - **discrete** (`sprite`): always override, regardless of `blend`. The clip's value is taken when `w ≥ 0.5`, so the image switches at the middle of a fade.

   `w` is the clip's effective weight: fade progress × runtime weight.
3. Apply **procedural overrides** ([§4.8](#48-procedural-joint-control)) on top of all layers.
4. Clamp multiplier channels to 0–1.
5. Apply the root multipliers to every joint ([§3](03-physics-drive-model.md#3-physics-drive-model-springs-via-motors)) and to the balance controller ([§3.2](03-physics-drive-model.md#32-balance-controller-rootbody-orientation)). **The root never replaces joint values, it only scales them.** Root `bodyAngle` is not a multiplier: it feeds only the balance controller and FK. Procedural overrides never touch it.

**Crossfade on the same layer.** When a clip enters a layer that already has an active clip, both are evaluated against the same `below`:

```
layerResult = lerp(outgoingResult, incomingResult, t / fadeIn)
```

When the crossfade ends, the outgoing clip is removed. A clip entering an empty layer fades from `below`. Stopping with a fade does the reverse.

## 4.5 Playback rules
- `play(key)` on a layer whose active clip is the same key is a no-op, unless `restart: true` is passed. It may still update `weight` / `speed`.
- `queue(key)` starts the clip on its layer:
  - immediately, if the layer is empty;
  - when the active clip completes, if it is non-loop;
  - at the end of the current cycle, if it loops.

  Queues are FIFO per layer.
- A non-loop clip completes once when its time reaches `length`. Depending on `hold`, it then holds its last frame or stops itself.

## 4.6 Canonical example

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

## 4.7 Events
- Custom events are `{ t, name, data }`. `data` is any JSON value or `null`. Examples: footsteps, sounds, a "fully_dead" gameplay hook.
- Built-in events: `start`, `loop`, `complete`, `stop`.
- An event fires **exactly once each time playback crosses its time**: the interval is `(prevTime, currTime]`, and an event at `t = 0` fires on start and on every loop wrap. This holds for large `dt` and for loops wrapped within one step.
- In loop clips, events must satisfy `t < length`, so `t = length` and `t = 0` don't fire twice. In non-loop clips, `0 ≤ t ≤ length`.
- Events fire synchronously inside `rag.update(dt)`.

## 4.8 Procedural joint control
Game code can force a joint toward an angle computed at runtime (look at the cursor, aim a weapon, track an enemy). The rotation is still produced **by physics**: the override only changes the motor's target (and optionally its strength). The body is never teleported.

**Where it lives.**
- **Runtime → RagImporter.** The target comes from gameplay data that only exists at runtime (cursor, enemy positions), so the editor cannot key it. A fixed "look this way" is already possible with `angle` keys.
- **Authoring and preview → RagAssembler.** The editor stores each joint's `aimAxis` ([§2.4](02-object-model.md#24-joints)), which tells the runtime where the limb's "forward" is. It also offers a preview in Simulate mode ([§5.8](05-8-animation-timeline.md#58-animation-timeline)) so the result can be tuned before it reaches code.

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
- **`strength`** is optional. It decides how hard the motor pushes while overriding, e.g. an arm that aims firmly even during `pain`. It is still multiplied by root and runtime strength ([§3](03-physics-drive-model.md#3-physics-drive-model-springs-via-motors)), so `dead` always wins.
- With `flipX`, the aim axis is mirrored (`π − aimAxis`) and angles are negated, so the same code works for both facings.
- Aiming a whole chain (spine → neck → head distributing the angle) and true IK are backlog. v1 aims single joints.

# 3. Physics drive model (springs via motors)

LiquidFun (Box2D 2.3) has no spring on revolute joints. RagImporter emulates one with the joint **motor** and runs this every step, for every joint:

```
target   = resolved angle at the step's clip time t (rad, relative to rest): clip layers, then procedural overrides (§4.4)
rate     = resolved angular velocity of that target at t (rad/s; Target rate below)
S        = jointStrength × rootStrength × runtimeStrength
G        = jointGain     × rootGain     × runtimeGain    × motor.gain
D        = jointDamping  × rootDamping  × runtimeDamping × motor.damping
error    = target − jointAngle

correction     = clamp(G · error − D · (jointSpeed − rate), −motor.maxSpeed, motor.maxSpeed)
motorSpeed     = rate + correction
maxMotorTorque = S · motor.maxTorque
enableMotor    = S > 0
```

- `motor.maxTorque` (N·m), `motor.gain` (1/s), `motor.damping` (unitless) and `motor.maxSpeed` (rad/s) are per-joint **base values** set in the inspector. `motor.maxSpeed` limits the **correction** only (how fast the motor chases an error: a far procedural target, a revive, a push); the keyed `rate` always passes, so a key is never slowed below the speed it was authored with. Torque, contacts and limits still bound the achieved speed.
- The channels `strength`, `gain` and `damping` (joint and root) are **multipliers in 0–1, default 1**.
- `S = 0` → the joint is fully limp, but **limits are still enforced**.
- `jointAngle` and `jointSpeed` are `GetJointAngle()` and `GetJointSpeed()` of the `b2RevoluteJoint` (rad, rad/s, relative to the reference angle, so 0 at rest). The outputs go to `SetMotorSpeed`, `SetMaxMotorTorque` and `EnableMotor`. These methods exist only on the `b2RevoluteJoint` wrapper ([§7.2](07-ragimporter.md#72-spawn-and-flipx)). This loop allocates nothing on the Emscripten heap ([§7.4](07-ragimporter.md#74-native-memory)).
- **Velocity feed-forward (keyframe intent, #209).** The motor is told the keyed speed (`rate`) and only corrects the error on top of it. If the motor reaches its speed, the error obeys `d(error)/dt = −G / (1 + D) · error`: it decays with time constant `(1 + D) / G` (0.15 s at the defaults) and a steady ramp is tracked with no lag at all. A joint keyed to move 97° in 0.1 s is therefore driven at about 17 rad/s from the first step of that segment and arrives at the keyed time with that speed, so a strike lands as an impact; slow segments (cushioning returns, holds) move at their own keyed speed, unchanged. Damping acts on `jointSpeed − rate`, so it resists leaving the keyed motion, not the motion itself; with `rate = 0` (a hold, no clip) the law is exactly the former PD, so holding, pushes and settling are unchanged.
  - `t` is the clip time **after** the step's advance, the time the step ends at, so the step moves the joint toward where it must be when the step is over. There is no look-ahead: the former `lead` (sampling `(1 + D) / G − dt` ahead to hide the lag) is removed, since feed-forward removes the lag itself and the look-ahead blurred fast segments.
  - **Finite torque.** At a key where the keyed speed jumps (any `linear` key between segments of different slopes), the motor needs more than its torque to change speed in one step. It accelerates at its limit and falls behind; the error term then drives it faster than `rate` until it catches up. The arrival error is about `Δrate² / (2 · α_avail)` decayed over the rest of the segment, where `α_avail` is the motor torque left after the load, divided by the moving side's inertia; hence the inertial term of [§3.1](#31-suggested-motor-torque).
  - **Overshoot is allowed.** A joint arriving at speed at a key followed by a slow or still segment brakes at its torque limit and passes the key by about `Δrate² / (2 · α_avail)` before the error term brings it back: the follow-through of a real strike. It is not shaped or limited by the controller (limits and contacts still stop it). Authored follow-through (a control of how much a joint passes its key) is out of scope ([§12](12-open-items.md#12-open-items--to-verify)).
- **Target rate.** `rate` is the time derivative of the resolved target, evaluated with the same rules as the target (`lib/evaluate.js`):
  - **Track rate** at clip time `t`, on the segment that contains `t` under [§4.3](04-animation-model.md#43-keys-and-interpolation) (left key `a`, right key `b`, span `d`, `u = (t − t_a) / d`; the wrap segment of a looping clip with its own `d`): `linear` → `(v_b − v_a) / d`; `ease` → `6u(1 − u) · (v_b − v_a) / d`; `step` → `0`. It is `0` for a track with one key, before the first key and from the last key on in a non-loop clip (held values), and for discrete channels. The segment rule is the evaluator's: `t_a ≤ t < t_b`, so at a key's exact time the rate is the outgoing segment's.
  - **Clip rate** = track rate × clip `speed` × play `speed` (clip seconds to real seconds). A non-loop clip holding after completion has rate `0`.
  - **Blending** applies the [§4.4](04-animation-model.md#44-channel-resolution) rule to rates with the weights taken as constant: channel default `0`; override `lerp(rateBelow, clipRate, w)`; additive `rateBelow + clipRate · w`; a procedural override is a target without a rate, `lerp(rateBelow, 0, w)`. Changes of weight over time (fades) add no rate. `flipX` negates `rate` like the angle.
  - Not clamped: a keyed rate the joint cannot reach is limited by torque, by Box2D's per-step rotation cap (`b2_maxRotation`, 0.5π rad per step: about 750 rad/s at the 1/480 s substep) and by limits.
- **Acceptance (#209, headless, editor stepping of [§3.1](#31-suggested-motor-torque), gravity −10, suggested torques, defaults G 10, D 0.5).** A punch on a humanoid test rig standing on the preview ground with the balance on: shoulder held at 60°, keyed `linear` 60° → 156° over 0.1 s, elbow 13° → 82° in the same 0.1 s, then both return `ease` over 0.4 s and hold. Measured on joint angles:
  - **M1 arrival:** at the fast key's time, `|achieved − keyed| ≤ 5°` for both joints;
  - **M2 impact speed:** mean joint speed over the last 1/60 s before that key `≥ 0.8 ×` the keyed segment speed;
  - **M3 slow segment:** RMS error over the second half of the `ease` return `≤ 3°`; the overshoot past the fast key `≤ 15°` and back within 2° of the track 0.2 s after the key;
  - **M4 ramp:** on a steady `linear` ramp of 2 rad/s, error at mid-segment `≤ 0.5°`;
  - **M5 no regression:** the stability, hold and firmness tests of [§3.1](#31-suggested-motor-torque) and [§12](12-open-items.md#12-open-items--to-verify) pass unchanged (held poses within 1°, peak kinetic energy at rest < 0.05 J, push deflection < 2° settling in < 0.15 s), and the clip-simulation key errors measured for the look-ahead (keyed pole 6.3°, demo sample 23°, humanoid clip RMS 14.6°) do not get worse.
- This model is the same in the editor and at runtime. The editor's Simulate mode uses RagImporter itself, so **preview equals production**.

## 3.1 Suggested motor torque
Every motorized joint must hold its target firmly whatever happens: gravity in any orientation, carrying the other limbs, a limb pressed into the ground lifting the whole ragdoll, pushes and impacts. The editor therefore suggests, per joint, the torque of the worst static case it can face plus an inertial term. RagImporter never computes it: the file's `motor.maxTorque` is always used as written.

Computed in the rest pose, root-local, meters, by `motorTorqueSuggestions(doc)` (pure, `lib/motor.js`; shared by the editor and validation):

```
sides       remove joint j from the joint graph (§6.4 edge rule); side A = bodies connected to bodyA,
            side B = bodies connected to bodyB; if bodyB is still connected to bodyA (j lies on a loop),
            side A = {bodyA} and side B = {bodyB}
M           mass of every body connected to j (both sides; the whole loop for a loop joint)
I_s         Σ_{b∈s} (I_b + m_b · |c_b − anchor|²)          inertia of side s about the anchor
I_eff       = I_A · I_B / (I_A + I_B)
R_s         reach of side s with its joints straightened: from the anchor, along the anchors of the joints
            inside s (sum of anchor-to-anchor distances), to the farthest non-sensor fixture point
suggestion  = roundUp2(I_eff · α + k · M · g · min(R_A, R_B)),  at least τ_min
```

- `m_b`, `c_b` and `I_b` are each body's mass, root-local center of mass and rotational inertia about that center, as Box2D computes them from its fixtures (area × density, sensors included; `bodyMassData` in `lib/geometry.js`). Fixture points are circle centers plus radius, box corners and polygon vertices.
- **Worst case.** The torque at j equals the moment, about the anchor, of every external force on one side. Contacts can only push on fixtures, and at most with the weight of the whole ragdoll, so `M · g · R_s` bounds it from either side in any pose and orientation: a hand pressed into the ground lifting the body, a leg holding the body alone, a body hanging from a limb. The bound from the shorter side is the tighter one. **k = 2** is the margin for dynamic loads (impacts, pushes, clip accelerations).
- Constants: **α = 1000 rad/s²** (target angular acceleration of the effective inertia: even with no gravity margin left, a joint reaches 20 rad/s in 0.02 s, so keyed strikes driven by the feed-forward of §3 land on time; was 100 before #209, which took 0.2 s), **g = 10 m/s²** (reference gravity; `preview.gravity` is editor-only and the host's gravity is unknown), **k = 2**, **τ_min = 0.001 N·m**. `roundUp2` rounds up to two significant digits (0.00357 → 0.0036, 12.43 → 13), so the value stays readable and never falls below the computed need.
- No suggestion (`null`) for a joint whose `bodyA` or `bodyB` is not a body id, whose bodies are the same, or whose side A or side B has zero mass. `doc` is `{ bodies, joints }` in file shape; the function never throws and skips bodies and fixtures it cannot read.
- Example (density 4): two 0.5 × 0.5 m boxes of 1 kg, at (0, 0) and (0, 0.5), hinged at (0, 0.25). Each `I_b = 1 · (0.5² + 0.5²) / 12 ≈ 0.04167`, each side `I_s = 0.04167 + 1 · 0.25² ≈ 0.10417`, `I_eff ≈ 0.05208`; `M = 2`; each reach is the anchor to a far corner, `√(0.25² + 0.5²) ≈ 0.5590`. Suggestion `roundUp2(0.05208 · 1000 + 2 · 2 · 10 · 0.5590) = roundUp2(52.08 + 22.36) = 75 N·m` (28 N·m with the former α = 100). Rig-level values (creature, humanoid, biped) are asserted in `tests/motor.test.js`, not repeated here.
- **Validation of files saved before #209.** The new suggestion is at most 10 × the former one (only the inertial term grows, 10 ×), so a file whose torques were at the former suggestion never falls below 0.1 × the new one and `W_MOTOR_UNDERPOWERED` does not fire on it. The editor rewrites the torques on Load as for any formula change ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)); a host file not re-saved keeps its lower torques and lands fast keys later.
- **Stepping (required).** A velocity motor converges only as far as Box2D's iterative solver gets in a step. When a light body sits between heavier ones (a 20 g thigh between a 94 g pelvis and a 126 g foot), the joints of the chain fight through it, the motors fall short of their speed far below their torque, and the PD of §3 then oscillates with a growing amplitude: the "jelly" pose. More velocity iterations help slowly (a robot holding a bent-knee pose: 55° error at 16, 4° at 64); shorter steps help much more, because the PD runs on each one. The editor (Simulate and the clip simulation) therefore splits every 1/60 s step into **8 substeps of `update(dt / 8)` and `world.Step(dt / 8, 8, 3)`**. These values are RagImporter's `STEP_SETTINGS` and the editor steps through its `stepWorld`; hosts **must** step with `stepWorld` too ([§7](07-ragimporter.md)). Without substeps these torques make light rigs gain energy on contact (the creature above: 11.6 J peak), which is what the earlier, lighter suggestion avoided at the cost of firmness.
- Measured with the editor's stepping (`tests/liquidfun-firmness.test.js`, `tests/liquidfun-hold.test.js`): held poses within 1° (the robot's bent-knee pose 0.6°, was 37°), no energy gain or trembling at rest (peak kinetic energy < 0.05 J), a 3 m/s push on a limb end or on `rootBody` deflects under 2° and settles in under 0.15 s without ringing (was up to 37° on a humanoid hand), and a light limb keyed into the ground lifts the ragdoll lying beside it by 79–104% of the depth (was 0–3% for arms and knees).
- Cheap enough to run on every edit (about 0.2 ms for 14 joints, 4 ms for a 100-body chain).
- Used by the Hinge tool for new joints ([§5.5](05-5-tools.md#55-tools)), by the automatic motor torque ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and by `W_MOTOR_OVERPOWERED` ([§6.4](06-file-format.md#64-validation)).

## 3.2 Balance controller (rootBody orientation)
Joint motors only drive relative angles, so nothing in §3 sets the world orientation of `rootBody`: under gravity the whole ragdoll tips over. The **balance controller** tracks the root `bodyAngle` channel ([§4.2](04-animation-model.md#42-channels)) by turning the whole ragdoll every step, in `update()`, after the joint motors:

```
R        = rootBody and every body connected to it with mass > 0 (§6.4 edge rule)
C, V     = mass-weighted world center and velocity of R;  r_b = c_b − C for each body b of R
I        = Σ (I_b + m_b · |r_b|²)                          current inertia of R about C
ω        = Σ (I_b · ω_b + m_b · r_b × (v_b − V)) / I        angular velocity of R as one piece
target   = root bodyAngle resolved at the step's clip time t as in §3 (rad, relative to rest; negated with flipX)
rate     = its target rate as in §3 (rad/s; negated with flipX)
θ*       = θ₀ + target                     θ₀ = rootBody's world angle right after spawn
error    = wrapToPi(θ* − rootBody.GetAngle())
S        = rootStrength × runtimeStrength
G        = rootGain     × runtimeGain     × balance.gain
D        = rootDamping  × runtimeDamping  × balance.damping

ω*       = rate + clamp(G · error − D · (ω − rate), −balance.maxSpeed, balance.maxSpeed)
torque   = clamp(I · (ω* − ω) / dt, −S · balance.maxTorque, S · balance.maxTorque)
α        = torque / I
apply    = balance.enabled and the instance's balance switch is on and S > 0 and dt > 0 and I > 0
           → for each body b of R: b.ApplyTorque(I_b · α, true) and
             b.ApplyForce(m_b · α · (−r_b.y, r_b.x), c_b, true)
```

- `balance.gain` (1/s), `balance.damping` (unitless), `balance.maxSpeed` (rad/s) and `balance.maxTorque` (N·m) are ragdoll-level base values (`ragdoll.balance`, [§6.2](06-file-format.md#62-field-reference)) with the same meaning as a joint's motor values: the controller is a motor between `rootBody` and the world frame. Root `strength`, `gain` and `damping` and the runtime multipliers scale it as they scale every joint, so `dead` (root `strength` → 0) also releases the balance. There are no joint-level multipliers here.
- `m_b` and `I_b` (inertia about the body's own center of mass) come from `bodyMassData` at `parse` and never change; no native inertia getter is used (`b2Body.GetInertia` is about the body origin). `c_b`, `v_b` and `ω_b` are read every step (`GetWorldCenter`, `GetLinearVelocity`, `GetAngularVelocity`).
- The torque is spread as the wrench that turns `R` rigidly about `C` at `α`: a torque and a force per body whose forces sum to zero. The joints therefore carry no load from the controller, and the controller's damping uses the angular velocity of the whole ragdoll, not of `rootBody` alone. Applying the whole torque to `rootBody` (the earlier rule) made a light `rootBody` spin past its joints, which then fought it: trembling, tipping and abrupt turns.
- The error is wrapped to (−π, π], so a ragdoll that tumbled while limp turns back the short way when it revives. A keyed full turn still works as long as the body follows its target within half a turn.
- **This is an external torque, not a physical one.** Nothing pushes back on the ground or the world: it is the standard active-ragdoll trick (an invisible hand keeping `rootBody` oriented). It does not move the ragdoll, so it never holds it up against gravity by itself: legs and contacts do that. Turn it off per ragdoll with `balance.enabled = false` (a passive ragdoll driven only by joint motors, as before format version 2) or per instance at runtime with `setBalance(false)` ([§7.1](07-ragimporter.md#71-api)).
- The loop allocates nothing ([§7.4](07-ragimporter.md#74-native-memory)): the force goes through one scratch `b2Vec2` per instance, created at `spawn` and destroyed by `destroy`.
- Without a `bodyAngle` track the target is `0`: the controller keeps `rootBody` at its spawn orientation.

**Suggested balance torque.** `balanceTorqueSuggestion(doc)` (pure, `lib/motor.js`) uses the constants of [§3.1](#31-suggested-motor-torque), except **α = 100 rad/s²** (`MOTOR_TORQUE.balanceAlpha`): the balance is an external torque, and a larger one would hold poses the feet cannot support, so it keeps the value it had before #209:

```
bodies      R = rootBody and every body connected to it (§6.4 edge rule); O = R without rootBody
M_O, C_O    mass and mass-weighted center of O; c_root = rootBody's center of mass
I_tot       = Σ_{b∈R} (I_b + m_b · |c_b − C_R|²)       C_R = mass-weighted center of R
suggestion  = roundUp2(I_tot · α + M_O · g · |C_O − c_root|),  at least τ_min
```

`null` when `rootBody` is not a body id or `R` has zero mass. Example (density 4): `rootBody` a 0.5 × 0.5 m box at (0, 0) and one jointed 0.5 × 0.5 m box at (0, 0.5), 1 kg each: `I_tot = 2 · (1/24 + 1 · 0.25²) ≈ 0.2083 kg·m²`, gravity term `1 · 10 · 0.5 = 5`, suggestion `roundUp2(20.83 + 5) = 26 N·m`. Used by the automatic motor torque ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and by the 1 → 2 migration ([§6.3](06-file-format.md#63-versioning)).

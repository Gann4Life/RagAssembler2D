# 3. Physics drive model (springs via motors)

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
- `jointAngle` and `jointSpeed` are `GetJointAngle()` and `GetJointSpeed()` of the `b2RevoluteJoint` (rad, rad/s, relative to the reference angle, so 0 at rest). The outputs go to `SetMotorSpeed`, `SetMaxMotorTorque` and `EnableMotor`. These methods exist only on the `b2RevoluteJoint` wrapper ([§7.2](07-ragimporter.md#72-spawn-and-flipx)). This loop allocates nothing on the Emscripten heap ([§7.4](07-ragimporter.md#74-native-memory)).
- This model is the same in the editor and at runtime. The editor's Simulate mode uses RagImporter itself, so **preview equals production**.

## 3.1 Suggested motor torque
A `motor.maxTorque` far above what a joint's bodies need makes light ragdolls gain energy on contact: the motor reaches any `motorSpeed` in one step and its reaction impulses fight contacts and limits. The editor therefore suggests a torque per joint that scales with the mass it drives. RagImporter never computes it: the file's `motor.maxTorque` is always used as written.

Computed in the rest pose, root-local, meters, by `motorTorqueSuggestions(doc)` (pure, `lib/motor.js`; shared by the editor and validation):

```
sides       remove joint j from the joint graph (§6.4 edge rule); side A = bodies connected to bodyA,
            side B = bodies connected to bodyB; if bodyB is still connected to bodyA (j lies on a loop),
            side A = {bodyA} and side B = {bodyB}
per side s  M_s = Σ m_b
            I_s = Σ (I_b + m_b · |c_b − anchor|²)        inertia about the anchor
            r_s = |C_s − anchor|                           C_s = mass-weighted center of the side
I_eff       = I_A · I_B / (I_A + I_B)
feet        bodies whose lowest non-sensor point is within β · H of the rest pose's lowest point
            (H = rest pose height); a foot is a set of such bodies joined by joints between them
L           j between two bodies of one foot, or no foot on either side: the side with the smaller I_s
            (B on a tie); otherwise the side away from a foot, the larger M_s · r_s when both sides hold one
suggestion  = roundUp2(I_eff · α + M_L · g · r_L),  at least τ_min
```

- `m_b`, `c_b` and `I_b` are each body's mass, root-local center of mass and rotational inertia about that center, as Box2D computes them from its fixtures (area × density, sensors included; `bodyMassData` in `lib/geometry.js`).
- Constants: **α = 100 rad/s²** (target angular acceleration of the effective inertia), **g = 10 m/s²** (reference gravity; `preview.gravity` is editor-only and the host's gravity is unknown), **τ_min = 0.001 N·m**, **β = 0.05** (foot band). `roundUp2` rounds up to two significant digits (0.00357 → 0.0036, 12.43 → 13), so the value stays readable and never falls below the computed need.
- `I_eff · α` bounds the angular impulse per step by what the lighter side can absorb, whichever body is `rootBody`; `M_L · g · r_L` lets the joint hold its load side against gravity at full extension. The load is the side the joint carries when the ragdoll stands on its feet: an ankle, knee or hip carries everything above it (each foot of a biped counts, so a leg can hold the body alone), while a free limb, a joint inside a foot and a ragdoll lying flat (one foot spans the whole body) keep the lighter side.
- No suggestion (`null`) for a joint whose `bodyA` or `bodyB` is not a body id, whose bodies are the same, or whose side A or side B has zero mass. `doc` is `{ bodies, joints }` in file shape; the function never throws and skips bodies and fixtures it cannot read.
- Examples (density 1): a 6 g fingertip circle (radius 0.044 m, center 0.036 m from the anchor) on a 1.6 kg creature gives 0.0036 N·m; that creature's hip (leg side 0.48 kg, I ≈ 0.14 kg·m²; rest I ≈ 0.41 kg·m²) about 13 N·m; a 4.4 m humanoid of 0.09–0.82 kg bodies (5.6 kg) gets 0.33 N·m at the hands, 110 N·m at the ankles and knees and 180 N·m at the hips.
- Limit: Box2D's solver converges poorly when a very light body carries a heavy one. A rig standing on pieces about 1/100 of the mass above them (11–23 g foot pieces under 1.6 kg) still trembles at 8 velocity iterations and only settles at about 40 ([§12](12-open-items.md)). A humanoid standing on one foot (a 0.19 kg foot under 5.6 kg) hops in a steady 0.08 m cycle at 8 and stands still from 14 on, so the editor (Simulate and the clip simulation) steps with **16 velocity and 3 position iterations**, and hosts should too.
- Cheap enough to run on every edit (about 0.25 ms for 14 joints, 1.5 ms for 100).
- Used by the Hinge tool for new joints ([§5.5](05-5-tools.md#55-tools)), by the automatic motor torque ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and by `W_MOTOR_OVERPOWERED` ([§6.4](06-file-format.md#64-validation)).

## 3.2 Balance controller (rootBody orientation)
Joint motors only drive relative angles, so nothing in §3 sets the world orientation of `rootBody`: under gravity the whole ragdoll tips over. The **balance controller** tracks the root `bodyAngle` channel ([§4.2](04-animation-model.md#42-channels)) by turning the whole ragdoll every step, in `update()`, after the joint motors:

```
R        = rootBody and every body connected to it with mass > 0 (§6.4 edge rule)
C, V     = mass-weighted world center and velocity of R;  r_b = c_b − C for each body b of R
I        = Σ (I_b + m_b · |r_b|²)                          current inertia of R about C
ω        = Σ (I_b · ω_b + m_b · r_b × (v_b − V)) / I        angular velocity of R as one piece
target   = resolved root bodyAngle (rad, relative to rest; negated with flipX)
θ*       = θ₀ + target                     θ₀ = rootBody's world angle right after spawn
error    = wrapToPi(θ* − rootBody.GetAngle())
S        = rootStrength × runtimeStrength
G        = rootGain     × runtimeGain     × balance.gain
D        = rootDamping  × runtimeDamping  × balance.damping

ω*       = clamp(G · error − D · ω, −balance.maxSpeed, balance.maxSpeed)
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

**Suggested balance torque.** `balanceTorqueSuggestion(doc)` (pure, `lib/motor.js`) uses the constants of [§3.1](#31-suggested-motor-torque):

```
bodies      R = rootBody and every body connected to it (§6.4 edge rule); O = R without rootBody
M_O, C_O    mass and mass-weighted center of O; c_root = rootBody's center of mass
I_tot       = Σ_{b∈R} (I_b + m_b · |c_b − C_R|²)       C_R = mass-weighted center of R
suggestion  = roundUp2(I_tot · α + M_O · g · |C_O − c_root|),  at least τ_min
```

`null` when `rootBody` is not a body id or `R` has zero mass. Example (density 4): `rootBody` a 0.5 × 0.5 m box at (0, 0) and one jointed 0.5 × 0.5 m box at (0, 0.5), 1 kg each: `I_tot = 2 · (1/24 + 1 · 0.25²) ≈ 0.2083 kg·m²`, gravity term `1 · 10 · 0.5 = 5`, suggestion `roundUp2(20.83 + 5) = 26 N·m`. Used by the automatic motor torque ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and by the 1 → 2 migration ([§6.3](06-file-format.md#63-versioning)).

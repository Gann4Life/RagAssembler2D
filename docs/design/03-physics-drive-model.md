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
L           = the side with the smaller I_s (B on a tie)
suggestion  = roundUp2(I_eff · α + M_L · g · r_L),  at least τ_min
```

- `m_b`, `c_b` and `I_b` are each body's mass, root-local center of mass and rotational inertia about that center, as Box2D computes them from its fixtures (area × density, sensors included; `bodyMassData` in `lib/geometry.js`).
- Constants: **α = 100 rad/s²** (target angular acceleration of the effective inertia), **g = 10 m/s²** (reference gravity; `preview.gravity` is editor-only and the host's gravity is unknown), **τ_min = 0.001 N·m**. `roundUp2` rounds up to two significant digits (0.00357 → 0.0036, 12.43 → 13), so the value stays readable and never falls below the computed need.
- `I_eff · α` bounds the angular impulse per step by what the lighter side can absorb, whichever body is `rootBody`; `M_L · g · r_L` lets the joint hold its lighter side against gravity at full extension.
- No suggestion (`null`) for a joint whose `bodyA` or `bodyB` is not a body id, whose bodies are the same, or whose side A or side B has zero mass. `doc` is `{ bodies, joints }` in file shape; the function never throws and skips bodies and fixtures it cannot read.
- Examples (density 1): a 6 g fingertip circle (radius 0.044 m, center 0.036 m from the anchor) on a 1.6 kg creature gives 0.0036 N·m; that creature's hip (leg side 0.48 kg, I ≈ 0.14 kg·m²; rest I ≈ 0.41 kg·m²) about 13 N·m; a humanoid of 0.3–1.4 kg bodies gets about 4–70 N·m.
- Used by the Hinge tool for new joints ([§5.5](05-5-tools.md#55-tools)), by Fit motor torque ([§5.6](05-6-hierarchy-assets-problems.md#56-hierarchy-assets-and-problems-panels)) and by `W_MOTOR_OVERPOWERED` ([§6.4](06-file-format.md#64-validation)).

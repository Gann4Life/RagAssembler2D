# 7. RagImporter

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

## 7.1 API

**`RagImporter`**

| Member | Description |
|---|---|
| `RagImporter.configure({ Box2D, PIXI, contactFilter })` | Optional; every key optional. Sets the liquidfun.js `Box2D` namespace and/or the PIXI module to use instead of the globals. `contactFilter` (default `true`): `false` selects the `groupIndex` fallback ([§2.5](02-object-model.md#25-collision-rules)) for worlds not yet in use. A key that is omitted keeps its previous setting. |
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
| `queue(key, opts)` | See [§4.5](04-animation-model.md#45-playback-rules). |
| `stop(key, { fadeOut })` / `stopLayer(layer, { fadeOut })` / `stopAll()` | Stops a clip, a layer or everything. |
| `setWeight(key, w)` | Changes the runtime weight of an active clip. |
| `isPlaying(key)` | Whether the clip is active. |
| `activeClip(layer)` | Key of the clip active on a layer. |
| `setStrength(v)` / `setGain(v)` / `setDamping(v)` | Runtime global multipliers, 0–1, default 1. |
| `lookAt(jointName, worldPoint, { weight, strength, fadeIn })` | Procedural aim ([§4.8](04-animation-model.md#48-procedural-joint-control)). Calling it again updates the target and options. |
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

## 7.2 Spawn and flipX
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
- Self-collision is set up at spawn time following [§2.5](02-object-model.md#25-collision-rules) and [§7.5](#75-contact-filter-and-host-integration): each fixture is registered right after `CreateFixture`, before any `world.Step` can pair it.

## 7.3 Sprites and rendering
- Each shape with a sprite gets one `PIXI.Sprite` (anchor 0.5) inside `rag.view`.
- `sync()` computes, for every sprite: world transform = body transform × shape local frame × sprite `offset/angle`. It converts that to PIXI coordinates ([§1](01-conventions.md#1-conventions)) and applies `scale` (mirrored when `flipX`).
- `update()` applies the resolved `sprite` channel by swapping `sprite.texture` (or hiding the sprite when the value is `null`). Textures are resolved once per asset and cached per `RagDef`.
- **Atlases:** the default resolver uses `src` as a URL. A host that packs sprites in a spritesheet passes `textures: (src, asset) => PIXI.Texture.from(asset.name)` (or any mapping). The file stays the same.
- With `debug: true`, a `PIXI.Graphics` layer draws shapes (`editor.color`), joint anchors and limits.

## 7.4 Native memory
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

## 7.5 Contact filter and host integration
The binding has no `b2World.GetContactFilter`, and a world holds one filter: a second `SetContactFilter` replaces the first, and `SetContactFilter(null)` leaves the world with **no filtering at all** (Box2D's default rule is not restored). RagImporter therefore owns the filter of every world it spawns into, and the host plugs into it instead of installing its own. Verified in Node by `tests/liquidfun-contact-filter.test.js`.

- **Per-world state.** RagImporter keeps, per `b2World` wrapper, one `JSContactFilter`, a registry and the host predicate. One filter serves every instance in the world.
- **Registry.** Fixture `userData` only stores an integer, so shapes are identified by pointer: the registry maps `Box2D.getPointer(fixture)` (stable, and equal to the pointer `ShouldCollide` receives) to `{ instance, selfCollide }`. `spawn` adds an entry per fixture; `destroy` removes them **before** `DestroyBody`, because freed fixture memory is reused by later fixtures. Fixtures not in the registry (host bodies) skip the self-collision rule.
- **`ShouldCollide(ptrA, ptrB)`** wraps both pointers with `Box2D.wrapPointer(ptr, Box2D.b2Fixture)` and applies the three steps of [§2.5](02-object-model.md#25-collision-rules), stopping at the first that refuses. It allocates nothing. Box2D calls it only when a pair of fixtures starts overlapping, so it costs little per step (20 humanoids of 10 shapes: about 120 calls per step, +8 % step time).
- **Host predicate.** `RagImporter.setContactFilter(world, (fixtureA, fixtureB) => boolean)` is called only for pairs that passed steps 1 and 2, including host–host pairs. It can only exclude pairs, never make the default rule collide pairs it rejects. It must not throw and must not change the world. Setting or clearing it affects only pairs that start overlapping afterwards; existing contacts are kept. Calling it before any `spawn` installs the filter, so a host can route all its filtering through RagImporter from the start.
- **Host rules.** A host never calls `world.SetContactFilter` on a world RagImporter uses: before the first spawn RagImporter's filter replaces it, after it RagImporter's filter is silently dropped, together with self-collision and the default rule. A host that needs its own filter (for example to collide pairs the default rule excludes) uses `configure({ contactFilter: false })` and gets the `groupIndex` fallback.
- **Fallback.** With no filter, RagImporter only writes `groupIndex = −instanceId` on the instance's fixtures. Instance ids are the smallest unused positive integer; `spawn` throws when 32,767 instances are alive in fallback mode (16-bit `groupIndex`). `setContactFilter` throws in this mode.
- **Teardown.** `releaseWorld(world)` destroys the world's remaining instances, calls `world.SetContactFilter(null)`, `Box2D.destroy`s the filter and forgets the world ([§7.4](#74-native-memory) rules 7 and 8). The world is left with no filtering, so the host destroys it next. Spawning into the same world again starts a new filter.

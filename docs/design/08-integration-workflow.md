# 8. Integration workflow (separate JS project)

1. **Author** the ragdoll, sprites and clips in RagAssembler, then save `name.rag.json` together with its sprite folder.
2. **Copy** into the host project:
   - the whole `lib/` folder (import only `lib/ragimporter.js`; the other files are internal);
   - the `.rag.json` and its sprite folder, keeping the relative paths.

   The host already loads liquidfun.js and PIXI.js.
3. **Load once:** `fetch` → `RagImporter.parse` → `PIXI.Assets.load(def.spriteUrls(base))`. Keep the `RagDef`.
4. **Spawn** one `RagInstance` per character with `def.spawn(world, { parent, … })`. For collision filtering beyond `categoryBits` / `maskBits` / `groupIndex`, pass a predicate to `RagImporter.setContactFilter(world, …)`; never call `world.SetContactFilter` ([§7.5](07-ragimporter.md#75-contact-filter-and-host-integration)).
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

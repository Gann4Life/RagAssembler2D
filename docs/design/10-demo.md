# 10. Demo

`demo/` simulates a **production preview**: a host page that uses only the public RagImporter API with liquidfun.js and PIXI.js, the way an external project would. It must not import anything from `js/` (the editor).

- **Asset:** `demo/assets/humanoid.rag.json` with its sprite folder, a generic humanoid **created and exported with the editor** (not hand-written).
  - Clips: `idle`, `walk`, `alive`, `pain` and `dead` from [§4.6](04-animation-model.md#46-canonical-example), plus a `footstep` event in `walk`.
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

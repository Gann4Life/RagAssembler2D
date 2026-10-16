# Overview

RagAssembler is a ragdoll editor for visually designing characters and creatures for **LiquidFun** (liquidfun.js, Box2D 2.3 API) rendered with **PIXI.js**. **RagImporter** is our runtime library: it loads exported files into a host project, builds the ragdoll in a LiquidFun world, renders it with PIXI sprites and drives it.

- Ragdolls are exported as `.rag.json` files (one ragdoll per file), plus the sprite images they reference.
- Ragdolls can be imported back into the editor, modified and re-exported. This must be lossless (see [Round-trip guarantee](06-file-format.md#65-round-trip-guarantee)).
- Ragdolls are animated through **joint motors**, not by moving shapes. An animation describes *what pose the ragdoll tries to hold, how hard it tries, and which sprites it shows*. Physics always has the last word.
- Game code can also take **procedural control** of individual joints (e.g. a head that looks at the cursor), blended with the animation by a weight.

```
 ┌──────────────┐   export    ┌────────────────────┐  load    ┌──────────────────────────────┐
 │ RagAssembler │ ──────────▶ │ name.rag.json      │ ───────▶ │ Host JS project              │
 │   (editor)   │ ◀────────── │ + sprite images    │          │  RagImporter                 │
 └──────────────┘   import    └────────────────────┘          │  + liquidfun.js + PIXI.js    │
                                                              └──────────────────────────────┘
```

# RagAssembler

A browser-based editor for building and animating **active ragdolls** for **LiquidFun** (Box2D) games rendered with **PIXI.js**. It ships with **RagImporter**, a runtime library that loads exported ragdolls into any game.

> Status: **pre-alpha, design phase.** The spec is complete; implementation has not started. See [TODO.md](TODO.md).

## What it does

- **Rigging:** draw circle, box and convex polygon shapes, group them into bodies, connect them with hinge joints and limits, and attach sprites.
- **Animation:** Godot-style timeline whose clips drive joint motors instead of moving shapes.
  - Animate target angles, joint strength/gain/damping, global multipliers on the ragdoll root, and sprite swaps.
  - Layers (override/additive), fades, loop/hold and clip events.
- **Preview equals production:** the editor simulates with the same runtime the game uses.
- **Runtime control:** play clips by key, react to events, and take procedural control of joints (look at, aim) with a blend weight.

```js
const def = RagImporter.parse(await (await fetch('assets/hero.rag.json')).json());
await PIXI.Assets.load(def.spriteUrls('assets/'));
const rag = def.spawn(world, { parent: app.stage, x: 2, y: 0 });

rag.play('alive');
rag.play('walk');
rag.lookAt('neck', target, { weight: 0.7 });

app.ticker.add(() => { rag.update(dt); world.Step(dt, 8, 3); rag.sync(); });
```

## Repository layout

```
index.html, js/      editor
lib/                 RagImporter runtime (planned)
vendor/              pinned liquidfun.js v1.1.0 and PIXI.js 8.21.0 builds
demo/                production preview using only RagImporter (planned)
tests/               round-trip and runtime tests (planned)
docs/                architecture and development documentation
```

## Getting started

Requires a static file server. Node 24 is only needed for the local server and tests.

```powershell
npx http-server -c-1 .     # editor: http://localhost:8080
node --test tests/
```

## Documentation

- [DESIGN.md](DESIGN.md): full product spec (object model, animation model, file format, runtime API).
- [docs/](docs/README.md): architecture, development setup and design decisions.
- [CHANGELOG.md](CHANGELOG.md) and [TODO.md](TODO.md).
- [CLAUDE.md](CLAUDE.md): contribution guidelines.

## License

TBD.

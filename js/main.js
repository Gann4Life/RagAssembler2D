import { createHeader } from './header.js';
import { createViewport } from './viewport.js';

const { PIXI, Box2D } = globalThis;
if (!PIXI) throw new Error('PIXI.js is not loaded: expected the global PIXI from vendor/pixi.min.js');
if (!Box2D) throw new Error('liquidfun.js is not loaded: expected the global Box2D from vendor/liquidfun.js');

document.getElementById('header').replaceWith(createHeader(document));

await createViewport(PIXI, document.getElementById('viewport-host'));

import { RagImporter, RagFormatError, STEP_SETTINGS, stepWorld } from '../lib/ragimporter.js';
import { drawPhysics } from './debug-draw.js';
import { createJointAim } from './joint-aim.js';
import { createBodyGrab } from './body-grab.js';

const DISPLAY_PIXELS_PER_METER = 80;
const DEFAULT_PIXELS_PER_METER = 32;
const CLICK_TOLERANCE_PX = 5;
const STEP = STEP_SETTINGS.dt;
const MAX_FRAME = 0.25;
const SAMPLE_URL = './assets/sample.rag.json';
const SPAWN_X = 0;
const GROUND_CLEARANCE = 0.02;

const stage = document.getElementById('stage');
const fileInput = document.getElementById('file-input');
const fileName = document.getElementById('file-name');
const respawnButton = document.getElementById('respawn');
const strengthSlider = document.getElementById('strength');
const strengthValue = document.getElementById('strength-value');
const clipsPanel = document.getElementById('clips');
const errorBox = document.getElementById('error');
const dropHint = document.getElementById('drop-hint');

const lookAim = createJointAim({
  toggle: document.getElementById('look-toggle'),
  select: document.getElementById('look-joint'),
  slider: document.getElementById('look-weight'),
  output: document.getElementById('look-weight-value'),
  patterns: [/^neck$/i, /neck|head/i],
});
const armAim = createJointAim({
  toggle: document.getElementById('aim-toggle'),
  select: document.getElementById('aim-joint'),
  slider: document.getElementById('aim-weight'),
  output: document.getElementById('aim-weight-value'),
  patterns: [/^shoulder_?r$|right.*shoulder|shoulder.*right|^r(ight)?[_ .-]?shoulder/i, /shoulder|arm/i],
});

RagImporter.configure({ Box2D, PIXI });

const app = new PIXI.Application();
await app.init({ resizeTo: stage, background: 0x1b1d22, antialias: true });
stage.appendChild(app.canvas);

const camera = new PIXI.Container();
const sceneRoot = new PIXI.Container();
const physicsView = new PIXI.Graphics();
sceneRoot.addChild(physicsView);
camera.addChild(sceneRoot);
app.stage.addChild(camera);
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;

const gravity = new Box2D.b2Vec2(0, -10);
const world = new Box2D.b2World(gravity);
Box2D.destroy(gravity);
const ground = createGround();
const grab = createBodyGrab(Box2D, world, ground);

let def = null;
let instance = null;
let accumulator = 0;
let clipButtons = [];
let cursor = null;
let pointerDown = null;

function createGround() {
  const bodyDef = new Box2D.b2BodyDef();
  const body = world.CreateBody(bodyDef);
  Box2D.destroy(bodyDef);
  const shape = new Box2D.b2PolygonShape();
  const center = new Box2D.b2Vec2(0, -0.25);
  shape.SetAsBox(40, 0.25, center, 0);
  body.CreateFixture(shape, 0);
  Box2D.destroy(center);
  Box2D.destroy(shape);
  return body;
}

function sceneScale() {
  return def?.pixelsPerMeter ?? DEFAULT_PIXELS_PER_METER;
}

function layoutScene() {
  const pixelsPerMeter = sceneScale();
  camera.scale.set(DISPLAY_PIXELS_PER_METER / pixelsPerMeter);
  camera.position.set(app.screen.width / 2, app.screen.height - 80);
  physicsView.scale.set(pixelsPerMeter, -pixelsPerMeter);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

function describeError(error) {
  if (error instanceof RagFormatError) {
    const lines = error.errors.slice(0, 10).map((item) => `${item.code} ${item.path}: ${item.message}`);
    const rest = error.errors.length - lines.length;
    if (rest > 0) lines.push(`... and ${rest} more`);
    return [error.message, ...lines].join('\n');
  }
  if (error instanceof SyntaxError) return `Not valid JSON: ${error.message}`;
  return error.message ?? String(error);
}

function lowestPoint(rag) {
  let lowest = Infinity;
  for (const body of rag.bodies.values()) {
    for (let fixture = body.GetFixtureList(); Box2D.getPointer(fixture) !== 0; fixture = fixture.GetNext()) {
      lowest = Math.min(lowest, fixture.GetAABB(0).get_lowerBound().get_y());
    }
  }
  return Number.isFinite(lowest) ? lowest : 0;
}

function spawnOnGround() {
  const probe = def.spawn(world, { x: SPAWN_X, y: 0 });
  const lift = GROUND_CLEARANCE - lowestPoint(probe);
  probe.destroy();
  return def.spawn(world, { parent: sceneRoot, x: SPAWN_X, y: lift });
}

function respawn() {
  if (def === null) return;
  grab.release();
  pointerDown = null;
  instance?.destroy();
  instance = null;
  instance = spawnOnGround();
  instance.setStrength(Number(strengthSlider.value));
  lookAim.bind(instance);
  armAim.bind(instance);
  accumulator = 0;
}

function buildClipButtons() {
  clipsPanel.replaceChildren();
  clipButtons = def.clips.map((clip) => {
    const row = document.createElement('div');
    row.className = 'clip';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      if (instance.isPlaying(clip.key)) instance.stop(clip.key);
      else instance.play(clip.key, { restart: true });
    });
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.textContent = 'Restart';
    restart.addEventListener('click', () => instance.play(clip.key, { restart: true }));
    row.append(toggle, restart);
    clipsPanel.appendChild(row);
    return { clip, toggle };
  });
}

function refreshClipButtons() {
  for (const { clip, toggle } of clipButtons) {
    const playing = instance?.isPlaying(clip.key) ?? false;
    const label = playing ? `Stop ${clip.name}` : `Play ${clip.name}`;
    if (toggle.textContent !== label) toggle.textContent = label;
    toggle.classList.toggle('active', playing);
  }
}

function jointNames(json) {
  return [...new Set(json.joints.map((joint) => joint.name))];
}

function loadText(text, label) {
  try {
    const json = JSON.parse(text);
    const nextDef = RagImporter.parse(json);
    def = nextDef;
    fileName.textContent = label;
    layoutScene();
    lookAim.setJoints(jointNames(json));
    armAim.setJoints(jointNames(json));
    buildClipButtons();
    respawn();
    clearError();
  } catch (error) {
    showError(`${label}: ${describeError(error)}`);
  }
}

async function loadFile(file) {
  loadText(await file.text(), file.name);
}

async function loadSample() {
  try {
    const response = await fetch(SAMPLE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${SAMPLE_URL}`);
    loadText(await response.text(), 'sample.rag.json');
  } catch (error) {
    showError(describeError(error));
  }
}

function hasFiles(event) {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (file) await loadFile(file);
});

window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropHint.hidden = false;
});

window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) dropHint.hidden = true;
});

window.addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dropHint.hidden = true;
  const [file] = event.dataTransfer.files;
  if (file) await loadFile(file);
});

respawnButton.addEventListener('click', respawn);

strengthSlider.addEventListener('input', () => {
  const value = Number(strengthSlider.value);
  strengthValue.textContent = value.toFixed(2);
  instance?.setStrength(value);
});

app.stage.on('pointermove', (event) => {
  cursor = { x: event.global.x, y: event.global.y };
  if (pointerDown === null || instance === null) return;
  if (Math.hypot(event.global.x - pointerDown.x, event.global.y - pointerDown.y) > CLICK_TOLERANCE_PX) pointerDown.moved = true;
  grab.drag(instance.toWorld(event.global));
});

app.stage.on('pointerdown', (event) => {
  if (instance === null) return;
  const point = instance.toWorld(event.global);
  const body = grab.pick(instance, point);
  if (body === null) return;
  grab.grab(body, point);
  pointerDown = { x: event.global.x, y: event.global.y, body, point, moved: false };
});

function endPointer(event) {
  if (pointerDown === null) return;
  const { body, point, moved } = pointerDown;
  pointerDown = null;
  grab.release();
  if (!moved && instance !== null && !instance.destroyed) grab.push(body, point);
}

app.stage.on('pointerup', endPointer);
app.stage.on('pointerupoutside', endPointer);

app.renderer.on('resize', layoutScene);
layoutScene();

app.ticker.add((ticker) => {
  if (instance !== null && cursor !== null) {
    const target = instance.toWorld(cursor);
    lookAim.apply(target);
    armAim.apply(target);
  }
  accumulator = Math.min(accumulator + ticker.deltaMS / 1000, MAX_FRAME);
  while (accumulator >= STEP) {
    stepWorld(world, instance === null ? [] : [instance], STEP);
    accumulator -= STEP;
  }
  drawPhysics(Box2D, physicsView, instance, ground);
  refreshClipButtons();
});

await loadSample();

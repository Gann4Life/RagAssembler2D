import { RagImporter, RagFormatError } from '../lib/ragimporter.js';
import { drawPhysics } from './debug-draw.js';

const PIXELS_PER_METER = 80;
const STEP = 1 / 60;
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

RagImporter.configure({ Box2D, PIXI });

const app = new PIXI.Application();
await app.init({ resizeTo: stage, background: 0x1b1d22, antialias: true });
stage.appendChild(app.canvas);

const sceneRoot = new PIXI.Container();
const physicsView = new PIXI.Graphics();
sceneRoot.addChild(physicsView);
app.stage.addChild(sceneRoot);

const world = new Box2D.b2World(new Box2D.b2Vec2(0, -10));
const ground = createGround();

let def = null;
let instance = null;
let accumulator = 0;
let clipButtons = [];

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

function layoutScene() {
  sceneRoot.scale.set(PIXELS_PER_METER, -PIXELS_PER_METER);
  sceneRoot.position.set(app.screen.width / 2, app.screen.height - 80);
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
  instance?.destroy();
  instance = spawnOnGround();
  instance.setStrength(Number(strengthSlider.value));
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

function loadText(text, label) {
  try {
    const nextDef = RagImporter.parse(JSON.parse(text));
    def = nextDef;
    fileName.textContent = label;
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

app.renderer.on('resize', layoutScene);
layoutScene();

app.ticker.add((ticker) => {
  accumulator = Math.min(accumulator + ticker.deltaMS / 1000, MAX_FRAME);
  while (accumulator >= STEP) {
    instance?.update(STEP);
    world.Step(STEP, 8, 3);
    accumulator -= STEP;
  }
  drawPhysics(Box2D, physicsView, instance, ground);
  refreshClipButtons();
});

await loadSample();

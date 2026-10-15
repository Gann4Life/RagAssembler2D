import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenize, importsOf } from './helpers/scan.js';
import {
  parseArchitecture,
  isCore,
  isUi,
  checkImports,
  checkPureGlobals,
  checkModelMutationCalls,
  checkNoComments,
  pureModulePaths,
  definedForbiddenGlobals,
  checkModulesLoad,
} from './helpers/architecture.js';

const architecture = {
  corePatterns: ['js/editor.js', 'js/model/*', 'js/panels/layout.js', 'js/viewport/camera.js'],
  pureLib: ['emitter', 'schema', 'geometry'],
  testableUi: ['js/header.js'],
};

const file = (path, source) => [{ path, source }];

test('tokenizer: comment markers inside strings, templates, regexes and URLs are not comments', () => {
  const source = [
    "const a = 'http://example.test/*x*/';",
    'const b = "// not a comment";',
    'const c = `${a}//${`/*`}`;',
    'const d = /\\/\\/[/*]/g;',
    'const e = x / 2 / 3;',
    'const f = (x++) / 2;',
  ].join('\n');
  assert.deepEqual(checkNoComments(file('js/x.js', source)), []);
});

test('tokenizer: comments are found with their line', () => {
  const source = 'const a = 1;\n\nconst b = 2; // note\n/* block\nspanning */\n/** doc */\n';
  assert.deepEqual(checkNoComments(file('js/x.js', source)), [
    'js/x.js:3: line comment (only JSDoc blocks are allowed)',
    'js/x.js:4: block comment (only JSDoc blocks are allowed)',
  ]);
});

test('tokenizer: lines are counted across template literals and multi-line strings', () => {
  const source = 'const a = `one\ntwo\n${1}\nthree`;\n// late\n';
  assert.deepEqual(checkNoComments(file('js/x.js', source)), [
    'js/x.js:5: line comment (only JSDoc blocks are allowed)',
  ]);
});

test('comments: an empty block comment is not JSDoc', () => {
  assert.equal(checkNoComments(file('js/x.js', 'const a = 1; /**/\n')).length, 1);
});

test('imports: static, multi-line, side-effect, re-export, dynamic and require forms are found', () => {
  const source = [
    "import a from './a.js';",
    'import {',
    '  b,',
    "} from './b.js';",
    "import './c.js';",
    "export { d } from './d.js';",
    "export * from './e.js';",
    "const f = await import('./f.js');",
    "const g = require('./g.js');",
    "export { h };",
    "const i = import.meta.dirname;",
    "// import z from './z.js';",
  ].join('\n');
  assert.deepEqual(
    importsOf(tokenize(source)).map((ref) => `${ref.specifier}@${ref.line}`),
    ['./a.js@1', './b.js@4', './c.js@5', './d.js@6', './e.js@7', './f.js@8', './g.js@9'],
  );
});

test('layers: layout.js is core and menu.js is UI', () => {
  assert.equal(isCore('js/panels/layout.js', architecture), true);
  assert.equal(isUi('js/menu.js', architecture), true);
  assert.equal(isUi('js/panels/dock.js', architecture), true);
  assert.equal(isCore('js/model/io.js', architecture), true);
});

test('imports: lib importing js or demo fails with file and line', () => {
  const violations = checkImports(file('lib/x.js', "import a from './emitter.js';\nimport b from '../js/menu.js';\n"), architecture);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^lib\/x\.js:2: /);
  assert.equal(checkImports(file('lib/x.js', "import b from '../demo/a.js';"), architecture).length, 1);
});

test('imports: demo may import only lib/ragimporter.js', () => {
  assert.equal(checkImports(file('demo/a.js', "import { R } from '../lib/ragimporter.js';"), architecture).length, 0);
  assert.equal(checkImports(file('demo/a.js', "import { E } from '../lib/emitter.js';"), architecture).length, 1);
  assert.equal(checkImports(file('demo/a.js', "import { m } from '../js/menu.js';"), architecture).length, 1);
});

test('imports: a core module may not import a UI module', () => {
  const violations = checkImports(file('js/model/io.js', "import { Model } from './model.js';\nimport { m } from '../menu.js';"), architecture);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^js\/model\/io\.js:2: /);
  assert.equal(checkImports(file('js/model/io.js', "import { Emitter } from '../../lib/emitter.js';"), architecture).length, 0);
});

test('imports: a UI module may import core and lib', () => {
  assert.equal(checkImports(file('js/menu.js', "import { Model } from './model/model.js';\nimport { E } from '../lib/emitter.js';"), architecture).length, 0);
});

test('imports: panel modules may not import other panels or the dock modules', () => {
  assert.equal(checkImports(file('js/panels/inspector.js', "import { x } from './hierarchy.js';"), architecture).length, 1);
  assert.equal(checkImports(file('js/panels/inspector.js', "import { x } from './dock.js';"), architecture).length, 1);
  assert.equal(checkImports(file('js/panels/inspector.js', "import { x } from './layout.js';"), architecture).length, 1);
  assert.equal(checkImports(file('js/panels/inspector.js', "import { x } from '../model/model.js';"), architecture).length, 0);
  assert.equal(checkImports(file('js/panels/dock.js', "import { x } from './layout.js';"), architecture).length, 0);
});

test('imports: tests may import core and listed UI modules only', () => {
  assert.equal(checkImports(file('tests/a.test.js', "import { x } from '../js/menu.js';"), architecture).length, 1);
  assert.equal(checkImports(file('tests/a.test.js', "import { x } from '../js/header.js';"), architecture).length, 0);
  assert.equal(checkImports(file('tests/a.test.js', "import { x } from '../js/model/model.js';"), architecture).length, 0);
  assert.equal(checkImports(file('tests/a.test.js', "import { x } from './helpers/scan.js';"), architecture).length, 0);
});

test('imports: only liquidfun verification tests may load vendor/liquidfun.js', () => {
  const load = "const Box2D = require('../vendor/liquidfun.js');";
  assert.deepEqual(checkImports(file('tests/liquidfun-api.test.js', load), architecture), []);
  assert.deepEqual(checkImports(file('tests/liquidfun-contact-filter.test.js', load), architecture), []);
  const rejected = checkImports(file('tests/model.test.js', `\n${load}`), architecture);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0], /^tests\/model\.test\.js:2: imports vendor\/liquidfun\.js: only tests\/liquidfun-/);
  assert.equal(checkImports(file('tests/helpers/x.js', "import b from '../../vendor/liquidfun.js';"), architecture).length, 1);
  assert.equal(checkImports(file('tests/liquidfun.test.js', load), architecture).length, 1);
});

test('imports: tests may not import demo/ or vendor/pixi.min.js', () => {
  const demo = checkImports(file('tests/a.test.js', "import { x } from '../demo/main.js';"), architecture);
  assert.equal(demo.length, 1);
  assert.match(demo[0], /^tests\/a\.test\.js:1: imports demo\/main\.js: tests\/ may not import demo\//);
  assert.equal(checkImports(file('tests/liquidfun-api.test.js', "require('../vendor/pixi.min.js');"), architecture).length, 1);
  assert.equal(checkImports(file('tests/a.test.js', "import '../vendor/pixi.min.js';"), architecture).length, 1);
  assert.equal(checkImports(file('tests/a.test.js', "import { x } from '../lib/ragimporter.js';"), architecture).length, 0);
});

test('imports: non-relative specifiers are rejected outside tests', () => {
  const url = checkImports(file('lib/x.js', "import a from 'https://example.com/a.js';"), architecture);
  assert.equal(url.length, 1);
  assert.match(url[0], /^lib\/x\.js:1: .*external or non-relative imports are not allowed/);
  assert.equal(checkImports(file('js/a.js', "import fs from 'node:fs';"), architecture).length, 1);
  assert.equal(checkImports(file('demo/a.js', "import x from 'some-package';"), architecture).length, 1);
  assert.equal(checkImports(file('tests/a.test.js', "import { test } from 'node:test';"), architecture).length, 0);
  assert.equal(checkImports(file('tests/a.test.js', "import x from 'some-package';"), architecture).length, 1);
});

test('globals: pure modules may not reference document, window, PIXI, Box2D or b2 names', () => {
  const source = 'const a = 1;\nconst b = document.body;\nconst c = new Box2D.b2World();\nconst d = b2Vec2;\nconst e = window;\nconst f = PIXI;\n';
  const violations = checkPureGlobals(file('js/model/x.js', source), architecture);
  assert.deepEqual(
    violations.map((entry) => entry.split(': ')[0]),
    ['js/model/x.js:2', 'js/model/x.js:3','js/model/x.js:4', 'js/model/x.js:5', 'js/model/x.js:6'],
  );
  assert.equal(checkPureGlobals(file('lib/geometry.js', 'const a = document;'), architecture).length, 1);
});

test('globals: property names, keys, strings and comments are not references', () => {
  const source = "const a = { document: [], window: 1 };\nconst b = x.document;\nconst c = 'document';\nconst d = `window ${1}`;\n/** document PIXI */\nconst e = obj?.window;\n";
  assert.deepEqual(checkPureGlobals(file('lib/schema.js', source), architecture), []);
});

test('globals: UI and runtime modules are not checked', () => {
  assert.deepEqual(checkPureGlobals(file('js/menu.js', 'const a = document;'), architecture), []);
  assert.deepEqual(checkPureGlobals(file('lib/def.js', 'const a = new Box2D.b2World();'), architecture), []);
});

test('mutation calls: applyOps, batch and reset on a model are restricted to their owners', () => {
  const source = 'model.applyOps([]);\nthis.model.batch(() => {});\neditor.model?.reset(snapshot);\ndock.reset();\nthis.reset();\n';
  const violations = checkModelMutationCalls(file('js/tools/box.js', source));
  assert.deepEqual(
    violations.map((entry) => entry.split(': ')[0]),
    ['js/tools/box.js:1', 'js/tools/box.js:2', 'js/tools/box.js:3'],
  );
  assert.deepEqual(checkModelMutationCalls(file('js/commands/history.js', 'model.applyOps(ops);\nmodel.batch(fn);')), []);
  assert.equal(checkModelMutationCalls(file('js/commands/history.js', 'model.reset(s);')).length, 1);
  assert.deepEqual(checkModelMutationCalls(file('js/model/io.js', 'model.reset(s);')), []);
  assert.equal(checkModelMutationCalls(file('js/model/io.js', 'model.batch(fn);')).length, 1);
  assert.deepEqual(checkModelMutationCalls(file('tests/model.test.js', 'model.reset(s);\nmodel.applyOps([]);')), []);
});

test('architecture doc: parsing fails loudly when a section is missing', () => {
  assert.throws(() => parseArchitecture('# nothing'), /not found/);
});

const layersRows = [
  '| Core | `js/editor.js` |',
  '| `tests/` | `js/header.js` |',
].join('\n');

const diagram = ['```', '│  Pure:    emitter · schema │', '│  Runtime: ragimporter │', '```'].join('\n');

const documentWith = ({ before = '', block = diagram, after = '', heading = '## Components' } = {}) =>
  [layersRows, before, heading, '', block, after].join('\n');

test('architecture doc: Pure and Runtime lines outside the component diagram do not change the result', () => {
  const expected = parseArchitecture(documentWith()).pureLib;
  assert.deepEqual(expected, ['emitter', 'schema']);
  const stray = 'Pure: bogus · other\nRuntime: nothing\n';
  assert.deepEqual(parseArchitecture(documentWith({ before: stray })).pureLib, expected);
  assert.deepEqual(parseArchitecture(documentWith({ after: stray })).pureLib, expected);
  assert.deepEqual(parseArchitecture(documentWith({ before: stray, after: stray })).pureLib, expected);
});

test('architecture doc: a missing Components heading, diagram block, Pure line or Runtime line is reported', () => {
  assert.throws(() => parseArchitecture(documentWith({ heading: '## Other' })), /Components heading not found/);
  assert.throws(() => parseArchitecture(documentWith({ block: 'no block here' })), /diagram block not found/);
  assert.throws(() => parseArchitecture(documentWith({ block: '```\nPure: a\n' })), /not closed/);
  assert.throws(() => parseArchitecture(documentWith({ block: '```\nRuntime: a\n```' })), /Pure line not found/);
  assert.throws(() => parseArchitecture(documentWith({ block: '```\nPure: a\n```' })), /Runtime line not found/);
  assert.throws(
    () => parseArchitecture(documentWith({ block: '```\nx\n```', after: 'Pure: a\nRuntime: b' })),
    /Pure line not found/,
  );
});

test('load check: pure modules on disk are listed, planned ones and UI modules are not', () => {
  const files = [
    { path: 'js/model/model.js', source: '' },
    { path: 'js/editor.js', source: '' },
    { path: 'js/header.js', source: '' },
    { path: 'lib/schema.js', source: '' },
    { path: 'lib/ragimporter.js', source: '' },
    { path: 'tests/x.test.js', source: '' },
  ];
  assert.deepEqual(pureModulePaths(files, architecture), ['js/editor.js', 'js/model/model.js', 'lib/schema.js']);
});

test('load check: a module that throws on import is reported with its path and error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rag-load-'));
  try {
    mkdirSync(join(root, 'js'));
    writeFileSync(join(root, 'js', 'ok.js'), 'export const value = 1;\n');
    writeFileSync(join(root, 'js', 'bad.js'), "const el = document.createElement('div');\nexport default el;\n");
    const failures = await checkModulesLoad(root, ['js/ok.js', 'js/bad.js']);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^js\/bad\.js: failed to load: ReferenceError: document is not defined$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('load check: a module that reaches a global through an alias fails the load', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rag-load-'));
  try {
    mkdirSync(join(root, 'js'));
    writeFileSync(join(root, 'js', 'alias.js'), "const g = globalThis;\nexport const w = g['win' + 'dow'].innerWidth;\n");
    const failures = await checkModulesLoad(root, ['js/alias.js']);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^js\/alias\.js: failed to load: TypeError/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('load check: defined forbidden globals are detected', () => {
  assert.deepEqual(definedForbiddenGlobals(), []);
  globalThis.PIXI = {};
  try {
    assert.deepEqual(definedForbiddenGlobals(), ['PIXI']);
  } finally {
    delete globalThis.PIXI;
  }
});

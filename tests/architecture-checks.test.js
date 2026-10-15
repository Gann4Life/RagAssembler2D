import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, importsOf } from './helpers/scan.js';
import {
  parseArchitecture,
  isCore,
  isUi,
  checkImports,
  checkPureGlobals,
  checkModelMutationCalls,
  checkNoComments,
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

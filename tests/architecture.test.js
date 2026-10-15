import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSources } from './helpers/scan.js';
import {
  parseArchitecture,
  checkImports,
  checkPureGlobals,
  checkModelMutationCalls,
  checkNoComments,
  pureModulePaths,
  definedForbiddenGlobals,
  checkModulesLoad,
} from './helpers/architecture.js';

const root = join(import.meta.dirname, '..');
const architecture = parseArchitecture(readFileSync(join(root, 'docs', 'architecture.md'), 'utf8'));
const files = readSources(root);

function assertNoViolations(violations) {
  assert.equal(violations.length, 0, `\n${violations.join('\n')}`);
}

test('architecture: layer classification is parsed from docs/architecture.md', () => {
  assert.ok(architecture.corePatterns.includes('js/panels/layout.js'));
  assert.ok(architecture.corePatterns.includes('js/model/*'));
  assert.ok(!architecture.corePatterns.includes('js/menu.js'));
  assert.deepEqual(architecture.pureLib.slice(0, 2), ['emitter', 'schema']);
  assert.ok(architecture.pureLib.includes('evaluate'));
  assert.ok(architecture.testableUi.includes('js/header.js'));
  assert.ok(architecture.testableUi.includes('js/storage.js'));
});

test('architecture: imports follow the dependency rules and layers', () => {
  assertNoViolations(checkImports(files, architecture));
});

test('architecture: pure modules do not reference DOM, PIXI or LiquidFun globals', () => {
  assertNoViolations(checkPureGlobals(files, architecture));
});

test('architecture: applyOps, batch and reset are called only by their owners', () => {
  assertNoViolations(checkModelMutationCalls(files));
});

test('architecture: source files contain only JSDoc comments', () => {
  assertNoViolations(checkNoComments(files));
});

test('architecture: core and pure modules on disk load without DOM, PIXI or LiquidFun globals', async () => {
  const paths = pureModulePaths(files, architecture);
  assert.ok(paths.includes('js/model/model.js') && paths.includes('lib/schema.js'), 'expected modules not enumerated');
  assert.deepEqual(definedForbiddenGlobals(), [], 'forbidden globals are defined before loading');
  const failures = await checkModulesLoad(root, paths);
  assert.deepEqual(definedForbiddenGlobals(), [], 'a module defined a forbidden global while loading');
  assertNoViolations(failures);
});
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importsOf, tokenize } from './scan.js';

const FORBIDDEN_GLOBALS = new Set(['document', 'window', 'PIXI', 'Box2D']);

const MODEL_CALL_OWNERS = new Map([
  ['applyOps', 'js/commands/history.js'],
  ['batch', 'js/commands/history.js'],
  ['reset', 'js/model/io.js'],
]);

/**
 * @typedef {object} Architecture
 * @property {string[]} corePatterns `js/` core modules; an entry ending in `/*` matches a folder prefix.
 * @property {string[]} pureLib Names of the pure `lib/` modules (without folder or extension).
 * @property {string[]} testableUi `js/` UI modules that tests may import.
 */

function backtickedCells(markdown, rowStart, cellIndex) {
  const row = markdown.split(/\r?\n/).find((line) => line.startsWith(rowStart));
  if (!row) throw new Error(`docs/architecture.md: row starting with ${rowStart} not found`);
  const cell = row.split('|')[cellIndex] ?? '';
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function componentDiagramLines(markdown) {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+Components\s*$/.test(line));
  if (heading === -1) throw new Error('docs/architecture.md: Components heading not found');
  const open = lines.findIndex((line, index) => index > heading && line.startsWith('```'));
  if (open === -1) throw new Error('docs/architecture.md: component diagram block not found');
  const close = lines.findIndex((line, index) => index > open && line.startsWith('```'));
  if (close === -1) throw new Error('docs/architecture.md: component diagram block is not closed');
  return lines.slice(open + 1, close);
}

/**
 * Extracts the layer classification from `docs/architecture.md`: the Core row of the layers table, the
 * `Pure:` line of the component diagram and the `js/` modules named in the `tests/` row of the dependency table.
 * @param {string} markdown Content of `docs/architecture.md`.
 * @returns {Architecture} Parsed classification.
 * @throws {Error} When a part cannot be found or is empty.
 */
export function parseArchitecture(markdown) {
  const corePatterns = backtickedCells(markdown, '| Core |', 2).filter((token) => /^js\/.*(\.js|\/\*)$/.test(token));
  const testableUi = backtickedCells(markdown, '| `tests/` |', 2).filter((token) => /^js\/.*\.js$/.test(token));

  const lines = componentDiagramLines(markdown);
  const pureStart = lines.findIndex((line) => line.includes('Pure:'));
  const runtimeStart = lines.findIndex((line) => line.includes('Runtime:'));
  if (pureStart === -1) throw new Error('docs/architecture.md: Pure line not found in the component diagram');
  if (runtimeStart <= pureStart) throw new Error('docs/architecture.md: Runtime line not found after the Pure line in the component diagram');
  const pureLib = lines
    .slice(pureStart, runtimeStart)
    .join(' ')
    .replace(/[│┌┐└┘─]/g, ' ')
    .replace('Pure:', ' ')
    .split(/[·\s]+/)
    .filter((name) => /^[a-z]+$/.test(name));

  if (corePatterns.length === 0) throw new Error('docs/architecture.md: no core modules found in the layers table');
  if (pureLib.length === 0) throw new Error('docs/architecture.md: no pure lib modules found in the diagram');
  return { corePatterns, pureLib, testableUi };
}

/**
 * Tells whether a repository path is a `js/` core module.
 * @param {string} path Repository-relative path.
 * @param {Architecture} architecture Parsed classification.
 * @returns {boolean} True for core modules.
 */
export function isCore(path, architecture) {
  return architecture.corePatterns.some((pattern) =>
    pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  );
}

/**
 * Tells whether a repository path is a `js/` UI module: any other `js/` file.
 * @param {string} path Repository-relative path.
 * @param {Architecture} architecture Parsed classification.
 * @returns {boolean} True for UI modules.
 */
export function isUi(path, architecture) {
  return path.startsWith('js/') && !isCore(path, architecture);
}

/**
 * Tells whether a path is a pure module: a pure `lib/` module or a `js/` core module.
 * @param {string} path Repository-relative path.
 * @param {Architecture} architecture Parsed classification.
 * @returns {boolean} True for pure modules.
 */
export function isPure(path, architecture) {
  return isCore(path, architecture) || architecture.pureLib.some((name) => path === `lib/${name}.js`);
}

/**
 * Lists the pure modules present on disk: the `lib/` pure set and the `js/` core. Planned modules that do not
 * exist yet are not listed.
 * @param {import('./scan.js').SourceFile[]} files Source files, as read by `readSources`.
 * @param {Architecture} architecture Parsed classification.
 * @returns {string[]} Sorted repository-relative paths.
 */
export function pureModulePaths(files, architecture) {
  return files
    .map((file) => file.path)
    .filter((path) => (path.startsWith('js/') || path.startsWith('lib/')) && isPure(path, architecture))
    .sort();
}

/**
 * Returns the forbidden browser and runtime globals currently defined on `globalThis`.
 * @returns {string[]} Names among `document`, `window`, `PIXI` and `Box2D`.
 */
export function definedForbiddenGlobals() {
  return [...FORBIDDEN_GLOBALS].filter((name) => name in globalThis);
}

/**
 * Dynamically imports each module (a fresh evaluation of the module itself) and collects the failures.
 * @param {string} root Absolute repository root.
 * @param {string[]} paths Repository-relative module paths.
 * @returns {Promise<string[]>} One `path: failed to load: <error>` entry per module that threw.
 */
export async function checkModulesLoad(root, paths) {
  const failures = [];
  for (const path of paths) {
    const url = `${pathToFileURL(join(root, path)).href}?load-check`;
    try {
      await import(url);
    } catch (error) {
      failures.push(`${path}: failed to load: ${error?.name ?? 'Error'}: ${error?.message ?? error}`);
    }
  }
  return failures;
}

function isPanelContent(path) {
  return /^js\/panels\/[^/]+\.js$/.test(path) && path !== 'js/panels/layout.js' && path !== 'js/panels/dock.js';
}

function resolveTarget(path, specifier) {
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(path), specifier));
  if (specifier.startsWith('/')) return specifier.slice(1);
  return null;
}

function externalImportViolation(path, specifier) {
  if (path.startsWith('tests/')) return specifier.startsWith('node:') ? null : 'tests/ may import only relative paths and node: built-ins';
  return 'external or non-relative imports are not allowed';
}

function importViolation(path, architecture, target) {
  if (path.startsWith('lib/')) {
    return target.startsWith('lib/') ? null : 'lib/ may import only lib/ modules';
  }
  if (path.startsWith('demo/')) {
    if (target.startsWith('demo/') || target.startsWith('vendor/') || target === 'lib/ragimporter.js') return null;
    return 'demo/ may import only lib/ragimporter.js';
  }
  if (path.startsWith('tests/')) {
    if (target === 'vendor/liquidfun.js' && !/^tests\/liquidfun-[^/]*\.test\.js$/.test(path)) {
      return 'only tests/liquidfun-*.test.js may load vendor/liquidfun.js';
    }
    if (target === 'vendor/pixi.min.js' || target.startsWith('demo/')) {
      return 'tests/ may not import demo/ or vendor/pixi.min.js';
    }
    if (isUi(target, architecture) && !architecture.testableUi.includes(target)) {
      return 'tests/ may import only js/ core modules and the listed DOM-free UI modules';
    }
    return null;
  }
  if (path.startsWith('js/')) {
    if (target.startsWith('lib/')) return null;
    if (!target.startsWith('js/')) return 'js/ may import only lib/ and js/ modules';
    if (isCore(path, architecture) && !isCore(target, architecture)) {
      return 'a core module may import only lib/ and other core modules';
    }
    if (isPanelContent(path) && target.startsWith('js/panels/')) {
      return 'a panel module may not import other panel modules or the dock modules';
    }
  }
  return null;
}

/**
 * Checks the import direction and layer rules of `docs/architecture.md` (Dependency rules).
 * @param {import('./scan.js').SourceFile[]} files Source files to check.
 * @param {Architecture} architecture Parsed classification.
 * @returns {string[]} One `path:line: message` entry per violation.
 */
export function checkImports(files, architecture) {
  const violations = [];
  for (const { path, source } of files) {
    for (const { specifier, line } of importsOf(tokenize(source))) {
      const target = resolveTarget(path, specifier);
      if (target === null) {
        const external = externalImportViolation(path, specifier);
        if (external) violations.push(`${path}:${line}: imports ${specifier}: ${external}`);
        continue;
      }
      const reason = importViolation(path, architecture, target);
      if (reason) violations.push(`${path}:${line}: imports ${target}: ${reason}`);
    }
  }
  return violations;
}

function isPropertyKey(tokens, index) {
  const before = tokens[index - 1];
  const after = tokens[index + 1];
  return (
    after?.type === 'punct' && after.value === ':' && before?.type === 'punct' && (before.value === '{' || before.value === ',')
  );
}

/**
 * Checks that pure modules do not reference the `document`, `window`, `PIXI` or `Box2D` globals, or a `b2*` name.
 * Property accesses (`x.document`) and object keys are not references.
 * @param {import('./scan.js').SourceFile[]} files Source files to check; non-pure files are skipped.
 * @param {Architecture} architecture Parsed classification.
 * @returns {string[]} One `path:line: message` entry per violation.
 */
export function checkPureGlobals(files, architecture) {
  const violations = [];
  for (const { path, source } of files) {
    if (!isPure(path, architecture)) continue;
    const tokens = tokenize(source).filter((token) => token.type !== 'comment');
    tokens.forEach((token, index) => {
      if (token.type !== 'ident') return;
      if (!FORBIDDEN_GLOBALS.has(token.value) && !/^b2[A-Za-z_]/.test(token.value)) return;
      const before = tokens[index - 1];
      if (before?.type === 'punct' && ['.', '?.', '#'].includes(before.value)) return;
      if (isPropertyKey(tokens, index)) return;
      violations.push(`${path}:${token.line}: pure module references the global ${token.value}`);
    });
  }
  return violations;
}

const OPENERS = new Set(['(', '[', '{', '${']);
const CLOSERS = new Set([')', ']', '}']);
const CONDITION_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'with']);
const DECLARATION_KEYWORDS = new Set(['const', 'let', 'var', 'function', 'class']);

function isPunct(token, value) {
  return token?.type === 'punct' && token.value === value;
}

function matchingCloser(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'punct') continue;
    if (OPENERS.has(token.value)) depth++;
    else if (CLOSERS.has(token.value) && --depth === 0) return index;
  }
  return tokens.length - 1;
}

function enclosingBlockEnd(tokens, fromIndex) {
  let depth = 0;
  for (let index = fromIndex; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'punct') continue;
    if (OPENERS.has(token.value)) depth++;
    else if (CLOSERS.has(token.value) && --depth < 0) return index;
  }
  return tokens.length - 1;
}

function arrowBodyEnd(tokens, bodyStart) {
  if (isPunct(tokens[bodyStart], '{')) return matchingCloser(tokens, bodyStart);
  let depth = 0;
  for (let index = bodyStart; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'punct') continue;
    if (OPENERS.has(token.value)) depth++;
    else if (CLOSERS.has(token.value) && --depth < 0) return index - 1;
    else if (depth === 0 && (token.value === ',' || token.value === ';')) return index - 1;
  }
  return tokens.length - 1;
}

function isParameterList(tokens, open, close) {
  const before = tokens[open - 1];
  if (before?.type === 'ident' && CONDITION_KEYWORDS.has(before.value)) return false;
  return isPunct(tokens[close + 1], '{') || (isPunct(tokens[close + 1], '=') && isPunct(tokens[close + 2], '>'));
}

function bindsInParameters(tokens, open, close, name) {
  let parenDepth = 0;
  for (let index = open; index <= close; index++) {
    const token = tokens[index];
    if (isPunct(token, '(')) parenDepth++;
    else if (isPunct(token, ')')) parenDepth--;
    if (token.type !== 'ident' || token.value !== name || parenDepth !== 1) continue;
    const before = tokens[index - 1];
    const after = tokens[index + 1];
    const startsBinding = ['(', ',', '{', '[', '.'].some((value) => isPunct(before, value));
    const endsBinding = [',', ')', '=', '}', ']'].some((value) => isPunct(after, value));
    if (startsBinding && endsBinding) return true;
  }
  return false;
}

function boundRanges(tokens, name) {
  const ranges = [];
  tokens.forEach((token, index) => {
    if (token.type === 'ident' && token.value === name) {
      const before = tokens[index - 1];
      if (before?.type === 'ident' && DECLARATION_KEYWORDS.has(before.value)) {
        ranges.push([index, enclosingBlockEnd(tokens, index)]);
      }
      return;
    }
    if (!isPunct(token, '(')) return;
    const close = matchingCloser(tokens, index);
    if (!isParameterList(tokens, index, close) || !bindsInParameters(tokens, index, close, name)) return;
    const isArrow = isPunct(tokens[close + 1], '=');
    const bodyStart = isArrow ? close + 3 : close + 1;
    ranges.push([index, isArrow ? arrowBodyEnd(tokens, bodyStart) : matchingCloser(tokens, bodyStart)]);
  });
  return ranges;
}

/**
 * Checks that no `js/` module other than `js/main.js` references the `PIXI` or `Box2D` globals; they are received as
 * parameters. Property accesses and object keys are not references, and a name bound by a function parameter or a
 * `const`/`let`/`var` declaration is not the global within the scope of that binding.
 * @param {import('./scan.js').SourceFile[]} files Source files to check; files outside `js/` are skipped.
 * @returns {string[]} One `path:line: message` entry per violation.
 */
export function checkMainOnlyGlobals(files) {
  const violations = [];
  for (const { path, source } of files) {
    if (!path.startsWith('js/') || path === 'js/main.js') continue;
    const tokens = tokenize(source).filter((token) => token.type !== 'comment');
    const ranges = new Map(['PIXI', 'Box2D'].map((name) => [name, boundRanges(tokens, name)]));
    tokens.forEach((token, index) => {
      if (token.type !== 'ident' || !ranges.has(token.value)) return;
      const before = tokens[index - 1];
      if (before?.type === 'punct' && ['.', '?.', '#'].includes(before.value)) return;
      if (isPropertyKey(tokens, index)) return;
      if (ranges.get(token.value).some(([start, end]) => index >= start && index <= end)) return;
      violations.push(`${path}:${token.line}: only js/main.js may reference the global ${token.value}; receive it as a parameter`);
    });
  }
  return violations;
}

/**
 * Checks that `applyOps` and `batch` are called on a model only by `js/commands/history.js`, and `reset` only by
 * `js/model/io.js`. A call counts when its receiver is an identifier ending in `model` (`model.reset(…)`,
 * `this.model.batch(…)`, `editor.model.applyOps(…)`). Files under `tests/` are skipped.
 * @param {import('./scan.js').SourceFile[]} files Source files to check.
 * @returns {string[]} One `path:line: message` entry per violation.
 */
export function checkModelMutationCalls(files) {
  const violations = [];
  for (const { path, source } of files) {
    if (path.startsWith('tests/')) continue;
    const tokens = tokenize(source).filter((token) => token.type !== 'comment');
    tokens.forEach((token, index) => {
      const owner = MODEL_CALL_OWNERS.get(token.value);
      if (token.type !== 'ident' || !owner || path === owner) return;
      const dot = tokens[index - 1];
      const receiver = tokens[index - 2];
      const open = tokens[index + 1];
      if (dot?.type !== 'punct' || (dot.value !== '.' && dot.value !== '?.')) return;
      if (open?.type !== 'punct' || open.value !== '(') return;
      if (receiver?.type !== 'ident' || !/model$/i.test(receiver.value)) return;
      violations.push(`${path}:${token.line}: ${token.value} may only be called from ${owner}`);
    });
  }
  return violations;
}

/**
 * Checks that files contain no comments other than `/** … *\/` JSDoc blocks.
 * @param {import('./scan.js').SourceFile[]} files Source files to check.
 * @returns {string[]} One `path:line: message` entry per violation.
 */
export function checkNoComments(files) {
  const violations = [];
  for (const { path, source } of files) {
    for (const token of tokenize(source)) {
      if (token.type !== 'comment') continue;
      const isJsDoc = token.value.startsWith('/**') && token.value.length > 4 && token.value.endsWith('*/');
      if (!isJsDoc) {
        const kind = token.value.startsWith('//') ? 'line comment' : 'block comment';
        violations.push(`${path}:${token.line}: ${kind} (only JSDoc blocks are allowed)`);
      }
    }
  }
  return violations;
}

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_ROOTS = ['js', 'lib', 'demo', 'tests'];

const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

const NO_REGEX_AFTER_PUNCT = new Set([')', ']', '}', '++', '--']);

/**
 * @typedef {object} Token
 * @property {'ident' | 'number' | 'string' | 'template' | 'regex' | 'punct' | 'comment'} type
 * @property {string} value Source text of the token (string contents for strings).
 * @property {number} line 1-based line where the token starts.
 */

/**
 * @typedef {object} SourceFile
 * @property {string} path Repository-relative path with forward slashes.
 * @property {string} source File content.
 */

/**
 * @typedef {object} ImportRef
 * @property {string} specifier Module specifier as written.
 * @property {number} line 1-based line of the specifier.
 */

function isIdentStart(char) {
  return /[A-Za-z_$]/.test(char) || char > '\x7f';
}

function isIdentPart(char) {
  return /[\w$]/.test(char) || char > '\x7f';
}

/**
 * Splits JavaScript source into tokens. Strings, template literals, regex literals and comments are
 * single tokens, so their contents are never mistaken for code.
 * @param {string} source JavaScript module source.
 * @returns {Token[]} Tokens in source order, comments included.
 */
export function tokenize(source) {
  const tokens = [];
  const braces = [];
  const length = source.length;
  let index = 0;
  let line = 1;
  let previous = null;

  const emit = (type, value, startLine) => {
    const token = { type, value, line: startLine };
    tokens.push(token);
    if (type !== 'comment') previous = token;
  };

  const regexAllowed = () => {
    if (!previous) return true;
    if (previous.type === 'punct') return !NO_REGEX_AFTER_PUNCT.has(previous.value);
    if (previous.type === 'ident') return KEYWORDS_BEFORE_REGEX.has(previous.value);
    return false;
  };

  const scanTemplateBody = () => {
    const startLine = line;
    const start = index;
    while (index < length) {
      const char = source[index];
      if (char === '\\') {
        if (source[index + 1] === '\n') line++;
        index += 2;
      } else if (char === '`') {
        emit('template', source.slice(start, index), startLine);
        index++;
        return;
      } else if (char === '$' && source[index + 1] === '{') {
        emit('template', source.slice(start, index), startLine);
        emit('punct', '${', line);
        braces.push('template');
        index += 2;
        return;
      } else {
        if (char === '\n') line++;
        index++;
      }
    }
    emit('template', source.slice(start, index), startLine);
  };

  const scanString = (quote) => {
    const startLine = line;
    const start = ++index;
    while (index < length && source[index] !== quote && source[index] !== '\n') {
      if (source[index] === '\\') {
        if (source[index + 1] === '\n') line++;
        index++;
      }
      index++;
    }
    emit('string', source.slice(start, index), startLine);
    if (source[index] === quote) index++;
  };

  const scanRegex = () => {
    const start = index;
    let cursor = index + 1;
    let inClass = false;
    while (cursor < length) {
      const char = source[cursor];
      if (char === '\n') return false;
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) break;
      cursor++;
    }
    if (cursor >= length) return false;
    cursor++;
    while (cursor < length && /[a-z]/.test(source[cursor])) cursor++;
    emit('regex', source.slice(start, cursor), line);
    index = cursor;
    return true;
  };

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '\n') {
      line++;
      index++;
    } else if (/\s/.test(char)) {
      index++;
    } else if (char === '/' && next === '/') {
      const start = index;
      while (index < length && source[index] !== '\n') index++;
      emit('comment', source.slice(start, index), line);
    } else if (char === '/' && next === '*') {
      const start = index;
      const startLine = line;
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? length : end + 2;
      const text = source.slice(start, index);
      for (const character of text) if (character === '\n') line++;
      emit('comment', text, startLine);
    } else if (char === '"' || char === "'") {
      scanString(char);
    } else if (char === '`') {
      index++;
      scanTemplateBody();
    } else if (char === '}' && braces.at(-1) === 'template') {
      braces.pop();
      index++;
      scanTemplateBody();
    } else if (isIdentStart(char)) {
      const start = index;
      while (index < length && isIdentPart(source[index])) index++;
      emit('ident', source.slice(start, index), line);
    } else if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(next ?? ''))) {
      const start = index;
      while (index < length && /[\w.]/.test(source[index])) index++;
      emit('number', source.slice(start, index), line);
    } else if (char === '/' && regexAllowed() && scanRegex()) {
      continue;
    } else if (char === '?' && next === '.' && !/[0-9]/.test(source[index + 2] ?? '')) {
      emit('punct', '?.', line);
      index += 2;
    } else if ((char === '+' || char === '-') && next === char) {
      emit('punct', char + char, line);
      index += 2;
    } else {
      if (char === '{') braces.push('block');
      else if (char === '}') braces.pop();
      emit('punct', char, line);
      index++;
    }
  }
  return tokens;
}

/**
 * Lists the module specifiers of static imports, re-exports, dynamic `import('…')` and `require('…')`
 * calls with a string argument.
 * @param {Token[]} tokens Output of `tokenize`.
 * @returns {ImportRef[]} References in source order.
 */
export function importsOf(tokens) {
  const code = tokens.filter((token) => token.type !== 'comment');
  const refs = [];
  const isPunct = (token, value) => token?.type === 'punct' && token.value === value;
  const isIdent = (token, value) => token?.type === 'ident' && token.value === value;

  for (let i = 0; i < code.length; i++) {
    const token = code[i];
    if (token.type !== 'ident') continue;
    const before = code[i - 1];
    if (isPunct(before, '.') || isPunct(before, '?.') || isPunct(before, '#')) continue;
    const next = code[i + 1];

    if (token.value === 'import' || token.value === 'require') {
      if (isPunct(next, '(') && code[i + 2]?.type === 'string') {
        refs.push({ specifier: code[i + 2].value, line: code[i + 2].line });
      } else if (token.value === 'import' && next?.type === 'string') {
        refs.push({ specifier: next.value, line: next.line });
      } else if (token.value === 'import' && !isPunct(next, '(') && !isPunct(next, '.')) {
        refs.push(...specifierAfterFrom(code, i + 1));
      }
    } else if (token.value === 'export') {
      if (isPunct(next, '*')) {
        refs.push(...specifierAfterFrom(code, i + 1));
      } else if (isPunct(next, '{')) {
        let close = i + 2;
        while (close < code.length && !isPunct(code[close], '}')) close++;
        if (isIdent(code[close + 1], 'from') && code[close + 2]?.type === 'string') {
          refs.push({ specifier: code[close + 2].value, line: code[close + 2].line });
        }
      }
    }
  }
  return refs;
}

function specifierAfterFrom(code, start) {
  for (let i = start; i < code.length; i++) {
    if (code[i].type === 'punct' && code[i].value === ';') return [];
    if (code[i].type === 'ident' && code[i].value === 'from' && code[i + 1]?.type === 'string') {
      return [{ specifier: code[i + 1].value, line: code[i + 1].line }];
    }
  }
  return [];
}

/**
 * Reads every `.js` file under `js/`, `lib/`, `demo/` and `tests/` (never `vendor/`). Missing folders are skipped.
 * @param {string} root Absolute repository root.
 * @returns {SourceFile[]} Files sorted by path.
 */
export function readSources(root) {
  const files = [];
  for (const folder of SOURCE_ROOTS) {
    const directory = join(root, folder);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { recursive: true })) {
      if (!entry.endsWith('.js')) continue;
      const path = `${folder}/${entry.replaceAll('\\', '/')}`;
      files.push({ path, source: readFileSync(join(root, path), 'utf8') });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

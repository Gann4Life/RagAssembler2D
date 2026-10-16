import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');
const SKIPPED_FOLDERS = new Set(['vendor', 'node_modules', '.git']);

function markdownFiles(folder) {
  return readdirSync(folder).flatMap((name) => {
    const full = join(folder, name);
    if (statSync(full).isDirectory()) return SKIPPED_FOLDERS.has(name) ? [] : markdownFiles(full);
    return name.endsWith('.md') ? [full] : [];
  });
}

function slugify(text) {
  return text
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function bodyLines(markdown) {
  let fenced = false;
  return markdown.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return null;
    }
    return fenced ? null : line;
  });
}

const anchorCache = new Map();

function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const used = new Map();
    const anchors = new Set();
    for (const line of bodyLines(readFileSync(file, 'utf8'))) {
      const match = line === null ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (!match) continue;
      const base = slugify(match[1]);
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      anchors.add(count ? `${base}-${count}` : base);
    }
    anchorCache.set(file, anchors);
  }
  return anchorCache.get(file);
}

function brokenLinks(file) {
  const problems = [];
  const name = relative(root, file).split(sep).join('/');
  bodyLines(readFileSync(file, 'utf8')).forEach((line, index) => {
    if (line === null) return;
    const text = line.replace(/`[^`]*`/g, '');
    for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const hash = target.indexOf('#');
      const pathPart = hash === -1 ? target : target.slice(0, hash);
      const anchor = hash === -1 ? '' : decodeURIComponent(target.slice(hash + 1));
      const targetFile = pathPart ? resolve(dirname(file), pathPart) : file;
      if (!existsSync(targetFile)) {
        problems.push(`${name}:${index + 1} missing file ${target}`);
      } else if (anchor && targetFile.endsWith('.md') && !anchorsOf(targetFile).has(anchor)) {
        problems.push(`${name}:${index + 1} missing anchor ${target}`);
      }
    }
  });
  return problems;
}

test('every relative markdown link points to an existing file and anchor', () => {
  const problems = markdownFiles(root).flatMap(brokenLinks);
  assert.deepEqual(problems, []);
});

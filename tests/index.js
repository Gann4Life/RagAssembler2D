import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const testsDir = import.meta.dirname;
const entries = await readdir(testsDir, { recursive: true });
const testFiles = entries.filter((entry) => entry.endsWith('.test.js')).sort();

for (const file of testFiles) {
  await import(pathToFileURL(join(testsDir, file)).href);
}

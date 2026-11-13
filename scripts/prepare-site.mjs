import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = resolve(root, 'site/vendor');
await mkdir(vendor, { recursive: true });
for (const [name, filename, license] of [
  ['marked', 'marked.js', 'LICENSE'],
  ['dompurify', 'purify.js', 'LICENSE'],
]) {
  const entry = fileURLToPath(import.meta.resolve(name));
  await copyFile(entry, resolve(vendor, filename));
  await copyFile(resolve(dirname(entry), '..', license), resolve(vendor, name + '-LICENSE.txt'));
}

const orbEntry = fileURLToPath(import.meta.resolve('thinking-orbs/engine'));
const orbDirectory = dirname(orbEntry);
await mkdir(resolve(vendor, 'thinking-orbs'), { recursive: true });
for (const name of await readdir(orbDirectory)) {
  if (name.endsWith('.js'))
    await copyFile(resolve(orbDirectory, name), resolve(vendor, 'thinking-orbs', name));
}
await copyFile(resolve(orbDirectory, '../LICENSE'), resolve(vendor, 'thinking-orbs-LICENSE.txt'));

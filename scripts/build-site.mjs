import './prepare-site.mjs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { extname } from 'node:path';

await rm('site-dist', { recursive: true, force: true });
await mkdir('site-dist', { recursive: true });
// The website hosts the demo UI; its local Node service remains source code only.
await cp('site', 'site-dist', {
  recursive: true,
  filter: (source) => extname(source) !== '.ts',
});
console.log('Static site prepared in site-dist/.');

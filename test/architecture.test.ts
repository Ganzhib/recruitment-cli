import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? sources(join(directory, entry.name)) : [join(directory, entry.name)],
      ),
    )
  )
    .flat()
    .filter((file) => file.endsWith('.ts'));
}
test('shared layers do not import concrete platform implementations', async () => {
  for (const layer of ['core', 'runtime', 'services']) {
    for (const file of await sources(join('src', layer))) {
      const source = await readFile(file, 'utf8');
      assert.equal(/from\s+['"][^'"]*platform\//.test(source), false, file);
    }
  }
});

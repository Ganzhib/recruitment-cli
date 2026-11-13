import { spawnSync } from 'node:child_process';
import { chmod, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'],
  {
    stdio: 'inherit',
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await chmod('dist/recruit.js', 0o755);

await cp('site', 'dist/site', { recursive: true, filter: (source) => !source.endsWith('.ts') });

import { spawnSync } from 'node:child_process';
import { chmod } from 'node:fs/promises';
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

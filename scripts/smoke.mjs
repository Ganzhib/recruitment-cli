import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRecruitmentClient, createCompanySitePlatform } from '../dist/index.js';

for (const args of [
  ['--json', 'platform', 'list'],
  ['--json', 'schema', 'greet'],
]) {
  const result = spawnSync(process.execPath, ['dist/recruit.js', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(result.stderr, '');
}
assert.equal(createRecruitmentClient().registry.get('boss').id, 'boss');
assert.equal(typeof createCompanySitePlatform, 'function');
console.log('Offline CLI discovery and root SDK imports passed.');

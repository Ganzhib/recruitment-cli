import test from 'node:test';
import assert from 'node:assert/strict';
import { runRecruitCli } from '../src/cli/program.js';
import { fakePlatform, temporaryHome } from './helpers.js';

async function invoke(args: string[]) {
  let stdout = '';
  let stderr = '';
  const exit = await runRecruitCli(args, {
    streams: {
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: (text) => {
          stderr += text;
        },
      },
    },
  });
  return { exit, stdout, stderr };
}
test('offline discovery and schema do not require browser or login', async () => {
  for (const args of [
    ['--json', 'platform', 'list'],
    ['--json', 'schema', 'greet'],
  ]) {
    const result = await invoke(args);
    assert.equal(result.exit, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.equal(result.stderr, '');
  }
});
test('invalid input produces one structured error and no success output', async () => {
  const result = await invoke(['--json', 'platform', 'exec', 'boss', 'contact.send']);
  assert.equal(result.exit, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).ok, false);
});
test('greet dry run freezes a plan without sending and CLI flags use common schemas', async () =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    const streams = {
      stdout: { write: (_text: string) => {} },
      stderr: { write: (_text: string) => {} },
    };
    assert.equal(
      await runRecruitCli(['--home', home, '--json', 'auth', 'login', 'test'], {
        platforms: [platform],
        streams,
      }),
      0,
    );
    assert.equal(
      await runRecruitCli(
        ['--home', home, '--json', 'greet', 'TypeScript', '--platform', 'test', '--dry-run'],
        { platforms: [platform], streams },
      ),
      0,
    );
    assert.deepEqual(state.sends, []);
  }));

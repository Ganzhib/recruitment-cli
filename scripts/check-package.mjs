import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'recruit-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd = process.cwd()) => {
  const result = spawnSync(npm, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};
try {
  const [archive] = JSON.parse(
    run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory]),
  );
  const files = archive.files.map((file) => file.path);
  for (const expected of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/recruit.js',
    'dist/runtime/demo-server.js',
    'dist/services/demo-agent.js',
    'dist/site/demo/index.html',
    'dist/site/demo/demo.js',
    'dist/site/vendor/marked.js',
    'dist/site/vendor/purify.js',
    'dist/site/vendor/thinking-orbs/engine.es.js',
    'dist/site/demo/orb.js',
    'README.md',
    'LICENSE',
  ])
    assert.ok(files.includes(expected), expected);
  assert.equal(
    files.some((file) => /(^|\/)(test|\.git|node_modules|browser-profile)(\/|$)/.test(file)),
    false,
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run(
    [
      'install',
      '--registry=https://registry.npmjs.org/',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(directory, archive.filename),
    ],
    directory,
  );
  await writeFile(
    join(directory, 'consumer.mjs'),
    `
    import { createRecruitmentClient, definePlatform, defineCapability, createCompanySitePlatform } from '@ganzhibin/recruitment-cli';
    if (createRecruitmentClient().registry.get('boss').id !== 'boss') throw new Error('Root import failed');
    for (const value of [definePlatform, defineCapability, createCompanySitePlatform]) if (typeof value !== 'function') throw new Error('Missing extension export');
  `,
  );
  const consumer = spawnSync(process.execPath, ['consumer.mjs'], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(consumer.status, 0, consumer.stderr);
  const packageJson = JSON.parse(
    await readFile(join(directory, 'node_modules/@ganzhibin/recruitment-cli/package.json'), 'utf8'),
  );
  assert.equal(packageJson.bin.recruit, 'dist/recruit.js');
  const executable = join(
    directory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'recruit.cmd' : 'recruit',
  );
  const command = spawnSync(executable, ['--json', 'platform', 'list'], {
    cwd: directory,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).ok, true);
  // Start the installed executable outside the repository to prove the demo is self-contained.
  const { createServer } = await import('node:net');
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const demo = spawn(
    process.execPath,
    [
      join(directory, 'node_modules/@ganzhibin/recruitment-cli/dist/recruit.js'),
      'demo',
      '--port',
      String(port),
    ],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Packaged demo did not start')), 15000);
      demo.stdout.once('data', () => {
        clearTimeout(timeout);
        resolve();
      });
      demo.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      demo.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error('Demo exited: ' + code));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    for (const path of [
      '/demo/',
      '/demo/demo.js',
      '/demo/demo.css',
      '/vendor/marked.js',
      '/vendor/purify.js',
      '/vendor/thinking-orbs/engine.es.js',
      '/demo/orb.js',
      '/index.html',
    ]) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    assert.equal((await (await fetch(base + '/api/tools')).json()).tools.length > 0, true);
  } finally {
    if (demo.exitCode === null && demo.signalCode === null) {
      const exited = new Promise((resolve) => demo.once('exit', resolve));
      demo.kill();
      await exited;
    }
  }
  console.log(`Packaged CLI and root SDK imports passed (${files.length} files).`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

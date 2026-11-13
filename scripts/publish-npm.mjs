import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const dryRun = process.argv.includes('--dry-run');
if (!process.argv[2] || !process.env.npm_execpath) {
  throw new Error('Use npm run publish:npm -- <release.tgz> [--dry-run].');
}
const archive = resolve(process.argv[2]);
const integrity = `sha512-${createHash('sha512')
  .update(await readFile(archive))
  .digest('base64')}`;
const registry = 'https://registry.npmjs.org/';
const response = await fetch(`${registry}${encodeURIComponent(pkg.name)}`);
if (!response.ok) throw new Error(`Cannot read npm package metadata: HTTP ${response.status}`);
const metadata = await response.json();
const published = metadata.versions[pkg.version];
const latest = metadata['dist-tags'].latest;
const parts = (value) => {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Expected a stable version: ${value}`);
  return value.split('.').map(Number);
};
const desired = parts(pkg.version);
const current = parts(latest);
const difference = desired.map((value, index) => value - current[index]).find((value) => value);
if (difference < 0) {
  console.log(`npm latest is already ${latest}; refusing to downgrade to ${pkg.version}.`);
  process.exit(0);
}
if (published && published.dist.integrity !== integrity) {
  throw new Error(
    `npm ${pkg.version} differs from the GitHub Release archive; refusing to replace it.`,
  );
}
const args = published
  ? latest === pkg.version
    ? null
    : ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, 'latest']
  : ['publish', archive, '--access', 'public', '--tag', 'latest', '--ignore-scripts'];
if (!args) {
  console.log(`npm latest already matches the release: ${pkg.version}.`);
} else if (dryRun) {
  if (args[0] === 'publish') {
    execFileSync(
      process.execPath,
      [process.env.npm_execpath, ...args, '--dry-run', `--registry=${registry}`],
      { stdio: 'inherit' },
    );
  } else {
    console.log(`Would run: npm ${args.join(' ')}`);
  }
} else {
  execFileSync(process.execPath, [process.env.npm_execpath, ...args, `--registry=${registry}`], {
    stdio: 'inherit',
  });
  const actual = execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'view', `${pkg.name}@latest`, 'version', `--registry=${registry}`],
    { encoding: 'utf8' },
  ).trim();
  if (actual !== pkg.version) throw new Error(`npm latest verification failed: ${actual}`);
  console.log(`Verified npm latest: ${pkg.version}`);
}

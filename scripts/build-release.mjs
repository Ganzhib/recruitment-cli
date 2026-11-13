import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  throw new Error('Release packaging requires a stable x.y.z version.');
}
const directory = new URL('../release-artifacts/', import.meta.url);
await mkdir(directory, { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script using npm run pack:release.');
const output = execFileSync(
  process.execPath,
  [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', 'release-artifacts'],
  { encoding: 'utf8' },
);
const [{ filename }] = JSON.parse(output);
const digest = createHash('sha256')
  .update(await readFile(join('release-artifacts', filename)))
  .digest('hex');
const tag = `v${pkg.version}`;
const url = `https://github.com/Ganzhib/recruitment-cli/releases/download/${tag}/${filename}`;
await writeFile(new URL('SHA256SUMS', directory), `${digest}  ${filename}\n`);
await writeFile(
  new URL('manifest.json', directory),
  `${JSON.stringify({ tag, filename, sha256: digest }, null, 2)}\n`,
);
await writeFile(
  new URL('RELEASE_NOTES.md', directory),
  `## 安装 CLI 与本地 AI Demo

需要 Node.js ${pkg.engines.node}，使用 BOSS 功能时需要 Chrome 或 Chromium。
此安装包适用于 Windows、macOS 和 Linux，包含编译后的 CLI、SDK、Demo 和使用文档。

\`\`\`bash
npm install -g ${url}
recruit --version
recruit demo
\`\`\`

也可以下载 \`${filename}\`，然后执行 \`npm install -g ./文件名.tgz\`。
安装时 npm 会下载运行依赖。发布流程随后将同一个安装包同步到 npm 的 latest 标签，完成后也可以运行 \`npm install -g ${pkg.name}@latest\` 安装。

附件 \`SHA256SUMS\` 提供安装包的 SHA-256 校验值。
`,
);
console.log(`Release package ready: ${filename}\nSHA-256: ${digest}`);

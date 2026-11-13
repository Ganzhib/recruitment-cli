import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createDemoServer } from '../runtime/demo-server.js';
import { Command, CommanderError } from 'commander';
import { z } from 'zod';
import type { Platform } from '../core/platform.js';
import {
  capabilitySchemas,
  targetSchema,
  type CapabilityInput,
  type SelectionInput,
} from '../core/schemas.js';
import { RecruitmentClient } from '../services/client.js';
import { defaultPlatforms, createDemoPlatforms } from '../platform/builtins.js';
import { companySiteSchema } from '../platform/company-site/config.js';
import { recruitmentHome } from '../runtime/accounts.js';
import { browserExecutable } from '../runtime/browser.js';
import { RecruitmentError } from '../shared/errors.js';
import { describeCommand } from './commands/schema.js';

export interface CliStreams {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}
export interface ProgramOptions {
  streams?: CliStreams;
  platforms?: Platform[];
}
export async function jsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(file), 'utf8'));
}
interface SearchFlags {
  platform: string;
  account: string;
  city?: string;
  activeWithin: string;
  limit: string;
  maxPages: string;
  options?: string;
}
function selectionOptions(command: Command): Command {
  return command
    .requiredOption('--platform <id>', '平台 ID')
    .option('--account <alias>', '账号别名', 'main')
    .option('--city <city>', '城市；BOSS 求职端可使用城市代码或常见城市名称')
    .option('--active-within <duration>', '最近活跃上限：online、30m、24h、7d、any', '7d')
    .option('-n, --limit <count>', '最多联系或返回数量', '10')
    .option('--max-pages <count>', '最多扫描页数', '3')
    .option('--options <file>', '平台参数 JSON，BOSS 招聘端指定 {"job":"岗位 ID 或完整名称"}');
}
async function selection(query: string, flags: SearchFlags): Promise<SelectionInput> {
  return {
    query,
    city: flags.city,
    activeWithin: flags.activeWithin,
    limit: Number(flags.limit),
    maxPages: Number(flags.maxPages),
    options: flags.options ? ((await jsonFile(flags.options)) as Record<string, unknown>) : {},
  };
}
export function createRecruitProgram(options: ProgramOptions = {}): Command {
  const streams = options.streams ?? process;
  const program = new Command('recruit')
    .description('面向求职者和招聘者的多平台招聘 CLI')
    .version('0.1.2')
    .option('--json', '输出单个 JSON 文档')
    .option('--home <directory>', '账号、计划和回执目录', recruitmentHome())
    .option('--sites <file>', '公司官网适配配置 JSON 数组')
    .exitOverride();
  program.configureOutput({
    writeOut: (text) => {
      streams.stdout.write(text);
    },
    writeErr: (text) => {
      if (!program.opts().json) streams.stderr.write(text);
    },
  });
  const emit = (value: unknown): void => {
    streams.stdout.write(
      JSON.stringify({ ok: true, data: value }, null, program.opts().json ? undefined : 2) + '\n',
    );
  };
  const client = async (lifecycle?: { close?: () => Promise<void> }) => {
    const flags = program.opts<{ home: string; sites?: string }>();
    const sites = flags.sites ? z.array(companySiteSchema).parse(await jsonFile(flags.sites)) : [];
    const demo = lifecycle && !options.platforms ? createDemoPlatforms(sites) : undefined;
    if (lifecycle && demo) lifecycle.close = demo.close;
    return new RecruitmentClient({
      home: flags.home,
      platforms: options.platforms ?? demo?.platforms ?? defaultPlatforms(sites),
    });
  };
  program
    .command('demo')
    .description('启动 API Key 驱动的本地 AI 招聘工作台')
    .option('--port <number>', '本地端口', process.env.RECRUIT_DEMO_PORT ?? '4318')
    .action(async (flags: { port: string }) => {
      const port = z.coerce.number().int().min(1024).max(65535).parse(flags.port);
      let root = fileURLToPath(new URL('../site/', import.meta.url));
      try {
        await access(resolve(root, 'demo/index.html'));
      } catch {
        root = fileURLToPath(new URL('../../site/', import.meta.url));
        await access(resolve(root, 'demo/index.html'));
      }
      const lifecycle: { close?: () => Promise<void> } = {};
      const server = createDemoServer({ client: await client(lifecycle), root });
      server.once('close', () => {
        void lifecycle.close?.();
      });
      const stop = () => {
        server.close();
        server.closeAllConnections();
        void lifecycle.close?.();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      emit({ url: `http://127.0.0.1:${port}/demo/` });
    });
  const platform = program.command('platform').description('平台能力发现');
  platform.command('list').action(async () => emit((await client()).registry.describe()));
  platform
    .command('exec <platform> <capability>')
    .option('--account <alias>', '账号别名', 'main')
    .option('--input <file>', '能力输入 JSON')
    .action(
      async (platform: string, capability: string, flags: { account: string; input?: string }) => {
        const parsed = z
          .enum(
            Object.keys(capabilitySchemas) as [
              keyof typeof capabilitySchemas,
              ...Array<keyof typeof capabilitySchemas>,
            ],
          )
          .parse(capability);
        if (parsed === 'contact.send')
          throw new RecruitmentError('INPUT', 'contact.send 只能通过 greet 或 plan run 执行。');
        const input = (flags.input ? await jsonFile(flags.input) : {}) as CapabilityInput<
          typeof parsed
        >;
        emit(await (await client()).invoke({ platform, account: flags.account }, parsed, input));
      },
    );
  const auth = program.command('auth').description('扫码登录与身份识别');
  auth
    .command('login <platform>')
    .option('--account <alias>', '账号别名', 'main')
    .action(async (platform: string, flags: { account: string }) => {
      if (!program.opts().json)
        streams.stderr.write('请在打开的浏览器中扫码登录，并进入对应身份的主页。\n');
      emit(await (await client()).login({ platform, account: flags.account }));
    });
  auth
    .command('status <platform>')
    .option('--account <alias>', '账号别名', 'main')
    .action(async (platform: string, flags: { account: string }) =>
      emit(await (await client()).status({ platform, account: flags.account })),
    );
  program
    .command('accounts')
    .description('列出本地账号绑定')
    .action(async () => emit(await (await client()).accounts.list()));
  selectionOptions(
    program.command('search <query>').description('按当前身份搜索，并按最近活跃筛选'),
  ).action(async (query: string, flags: SearchFlags) =>
    emit(await (await client()).search(flags, await selection(query, flags))),
  );
  program
    .command('positions')
    .requiredOption('--platform <id>', '目标平台')
    .option('--account <alias>', '账号别名', 'main')
    .description('读取招聘方可关联的岗位')
    .action(async (flags: SearchFlags) =>
      emit(await (await client()).invoke(flags, 'position.list', {})),
    );
  program
    .command('detail <file>')
    .requiredOption('--platform <id>', '目标平台')
    .option('--account <alias>', '账号别名', 'main')
    .description('读取保存的单条 target JSON 的详情')
    .action(async (file: string, flags: SearchFlags) =>
      emit(await (await client()).detail(flags, targetSchema.parse(await jsonFile(file)))),
    );
  const plan = program.command('plan').description('筛选快照与联系计划');
  selectionOptions(plan.command('create <query>')).action(
    async (query: string, flags: SearchFlags) =>
      emit(await (await client()).prepare(flags, await selection(query, flags))),
  );
  plan
    .command('get <id>')
    .action(async (id: string) => emit(await (await client()).outreach.get(id)));
  plan
    .command('run <id>')
    .option('--interval-ms <number>', '逐条发送间隔，至少 1000ms', '3000')
    .action(async (id: string, flags: { intervalMs: string }) => {
      const result = await (await client()).run(id, { intervalMs: Number(flags.intervalMs) });
      if (result.status === 'attention')
        throw new RecruitmentError('INDETERMINATE', '部分发送结果待核实，已停止批次。', { result });
      emit(result);
    });
  selectionOptions(
    program.command('greet <query>').description('筛选后批量使用平台预制招呼语发起沟通'),
  )
    .option('--dry-run', '生成筛选计划，不发送招呼')
    .option('--interval-ms <number>', '逐条发送间隔，至少 1000ms', '3000')
    .action(
      async (query: string, flags: SearchFlags & { dryRun?: boolean; intervalMs: string }) => {
        const service = await client();
        const input = await selection(query, flags);
        if (flags.dryRun) {
          emit(await service.prepare(flags, input));
          return;
        }
        const result = await service.greet(flags, input, { intervalMs: Number(flags.intervalMs) });
        if (result.status === 'attention')
          throw new RecruitmentError('INDETERMINATE', '部分发送结果待核实，已停止批次。', {
            result,
          });
        emit(result);
      },
    );
  program
    .command('history')
    .requiredOption('--platform <id>', '目标平台')
    .option('--account <alias>', '账号别名', 'main')
    .action(async (flags: SearchFlags) => emit(await (await client()).history(flags)));
  program
    .command('schema [path...]')
    .description('从实际命令和 Zod 契约生成结构说明')
    .action(async (path: string[] = []) => {
      let command = program;
      for (const name of path) {
        const child = command.commands.find((child) => child.name() === name);
        if (!child) throw new RecruitmentError('INPUT', '命令不存在：' + path.join(' '));
        command = child;
      }
      emit({ command: describeCommand(command), platforms: (await client()).registry.describe() });
    });
  program
    .command('doctor')
    .description('检查运行环境与浏览器')
    .action(async () =>
      emit({
        node: process.version,
        browser: await browserExecutable(),
        home: resolve(program.opts().home as string),
      }),
    );
  return program;
}
export async function runRecruitCli(args: string[], options: ProgramOptions = {}): Promise<number> {
  try {
    await createRecruitProgram(options).parseAsync(args, { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    const code = error instanceof RecruitmentError ? error.code : 'INPUT';
    let message = String(error);
    if (error instanceof Error) message = error.message;
    if (error instanceof z.ZodError) message = z.prettifyError(error);
    (options.streams ?? process).stderr.write(
      JSON.stringify({
        ok: false,
        error: {
          code,
          message,
          details: error instanceof RecruitmentError ? error.details : undefined,
        },
      }) + '\n',
    );
    return code === 'INDETERMINATE' ? 2 : 1;
  }
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nameSchema, selectionSchema } from '../core/schemas.js';
import { RecruitmentError } from '../shared/errors.js';
import type { RecruitmentClient } from './client.js';

export interface RecruitmentToolEvent {
  type: 'tool.start' | 'tool.result' | 'tool.error';
  id: string;
  name: string;
  command: string;
  input?: unknown;
  result?: unknown;
  error?: string;
  errorCode?: RecruitmentError['code'];
  errorDetails?: Record<string, unknown>;
  durationMs?: number;
}
export interface ToolPolicy {
  allowContact?: boolean;
}
interface ToolDefinition {
  name: string;
  description: string;
  effect: 'read' | 'local-write' | 'remote-write';
  schema: z.ZodType;
  command(input: unknown): string;
  execute(input: unknown): Promise<unknown>;
}
const accountSchema = z.object({ platform: nameSchema, account: nameSchema.default('main') });
const searchSchema = selectionSchema.extend(accountSchema.shape);
const planIdSchema = z.object({ planId: z.uuid() });

function defineTool<I>(
  definition: Omit<ToolDefinition, 'schema' | 'command' | 'execute'> & {
    schema: z.ZodType<I>;
    command(input: I): string;
    execute(input: I): Promise<unknown>;
  },
): ToolDefinition {
  return {
    ...definition,
    command: (input) => definition.command(input as I),
    execute: (input) => definition.execute(input as I),
  };
}
function searchCommand(name: string, input: z.output<typeof searchSchema>): string {
  const parts = [
    'recruit',
    name,
    JSON.stringify(input.query),
    '--platform',
    input.platform,
    '--active-within',
    input.activeWithin,
    '-n',
    String(input.limit),
  ];
  if (input.city) parts.push('--city', JSON.stringify(input.city));
  if (Object.keys(input.options).length) parts.push('--options', '<options.json>');
  return parts.join(' ');
}

export function createRecruitmentTools(
  client: RecruitmentClient,
  onEvent: (event: RecruitmentToolEvent) => void = () => {},
) {
  const definitions: ToolDefinition[] = [
    defineTool({
      name: 'recruit_platforms',
      description: 'Discover supported recruitment platforms and their real capability schemas.',
      effect: 'read',
      schema: z.object({}),
      command: () => 'recruit platform list',
      execute: async () => client.registry.describe(),
    }),
    defineTool({
      name: 'recruit_accounts',
      description: 'List local account aliases and stable identities without exposing credentials.',
      effect: 'read',
      schema: z.object({}),
      command: () => 'recruit accounts',
      execute: async () => client.accounts.list(),
    }),
    defineTool({
      name: 'recruit_login',
      description:
        'Open the local browser for the user to scan a QR code. The logged-in role is detected automatically.',
      effect: 'local-write',
      schema: accountSchema,
      command: (input) => `recruit auth login ${input.platform} --account ${input.account}`,
      execute: (input) => client.login(input),
    }),
    defineTool({
      name: 'recruit_status',
      description: 'Verify the currently authenticated account and role.',
      effect: 'read',
      schema: accountSchema,
      command: (input) => `recruit auth status ${input.platform} --account ${input.account}`,
      execute: (input) => client.status(input),
    }),
    defineTool({
      name: 'recruit_positions',
      description: 'List the recruiter’s positions before selecting a job for candidate discovery.',
      effect: 'read',
      schema: accountSchema,
      command: (input) => `recruit positions --platform ${input.platform}`,
      execute: (input) => client.invoke(input, 'position.list', {}),
    }),
    defineTool({
      name: 'recruit_search',
      description:
        'Search jobs or candidates and filter by the other person’s recent activity. Unknown activity is excluded unless activeWithin is any. Recruiters provide options.job from recruit_positions.',
      effect: 'read',
      schema: searchSchema,
      command: (input) => searchCommand('search', input),
      execute: (input) => client.search(input, input),
    }),
    defineTool({
      name: 'recruit_plan',
      description: 'Prepare and persist a contact plan for review. Does not send messages.',
      effect: 'local-write',
      schema: searchSchema,
      command: (input) => searchCommand('plan create', input),
      execute: (input) => client.prepare(input, input),
    }),
    defineTool({
      name: 'recruit_plan_get',
      description: 'Read a prepared contact plan by its exact ID.',
      effect: 'read',
      schema: planIdSchema,
      command: (input) => `recruit plan get ${input.planId}`,
      execute: (input) => client.outreach.get(input.planId),
    }),
    defineTool({
      name: 'recruit_run_plan',
      description:
        'Execute an existing contact plan using the platform’s current preset greeting. Requires allowContact=true in the caller’s execution policy. Never retries indeterminate deliveries.',
      effect: 'remote-write',
      schema: planIdSchema,
      command: (input) => `recruit plan run ${input.planId}`,
      execute: (input) => client.run(input.planId),
    }),
    defineTool({
      name: 'recruit_history',
      description: 'Read persisted contact receipts and uncertain outcomes.',
      effect: 'read',
      schema: accountSchema,
      command: (input) => `recruit history --platform ${input.platform}`,
      execute: (input) => client.history(input),
    }),
  ];
  const tools = new Map(definitions.map((tool) => [tool.name, tool]));
  return {
    describe: () =>
      definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        effect: tool.effect,
        inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }),
      })),
    functions: () =>
      definitions.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.schema, { io: 'input' }),
          strict: false,
        },
      })),
    execute: async (name: string, raw: unknown, policy: ToolPolicy = {}): Promise<unknown> => {
      const tool = tools.get(name);
      if (!tool) throw new RecruitmentError('UNSUPPORTED', 'Agent 工具不存在：' + name);
      const input = tool.schema.parse(raw);
      if (tool.effect === 'remote-write' && !policy.allowContact)
        throw new RecruitmentError(
          'INPUT',
          '当前会话未开启发起沟通权限，请先展示计划并由使用者开启权限。',
        );
      const id = randomUUID();
      const command = tool.command(input);
      const started = Date.now();
      onEvent({ type: 'tool.start', id, name, command, input });
      try {
        const result = await tool.execute(input);
        onEvent({
          type: 'tool.result',
          id,
          name,
          command,
          result,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onEvent({
          type: 'tool.error',
          id,
          name,
          command,
          error: message,
          ...(error instanceof RecruitmentError
            ? { errorCode: error.code, errorDetails: error.details }
            : {}),
          durationMs: Date.now() - started,
        });
        throw error;
      }
    },
  };
}
export type RecruitmentTools = ReturnType<typeof createRecruitmentTools>;

import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { PlatformSession } from '../core/platform.js';
import {
  identitySchema,
  roleSchema,
  selectionSchema,
  targetSchema,
  receiptSchema,
  type AccountIdentity,
  type SelectionInput,
} from '../core/schemas.js';
import { readJson, writeJson } from '../runtime/storage.js';
import { RecruitmentError } from '../shared/errors.js';
import { discover, matchesActivity } from './discovery.js';

export const planSchema = z.object({
  schema: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  identity: identitySchema,
  role: roleSchema,
  selection: selectionSchema,
  targets: z.array(targetSchema),
  scanned: z.number(),
  excluded: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export const operationSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  planId: z.uuid(),
  identity: identitySchema,
  role: roleSchema,
  target: targetSchema,
  state: z.enum(['pending', 'sent', 'skipped', 'indeterminate']),
  updatedAt: z.iso.datetime(),
  receipt: receiptSchema.optional(),
  reason: z.string().optional(),
  failure: z
    .object({
      code: z.string(),
      reason: z.string().optional(),
      endpoint: z.string().optional(),
      platformCode: z.number().optional(),
      httpStatus: z.number().optional(),
      requestObserved: z.boolean().optional(),
    })
    .optional(),
});
export type ContactPlan = z.infer<typeof planSchema>;
export type ContactOperation = z.infer<typeof operationSchema>;
export interface OutreachResult {
  planId: string;
  status: 'complete' | 'attention';
  operations: ContactOperation[];
}

export class OutreachService {
  constructor(readonly home: string) {}
  async prepare(
    identity: AccountIdentity,
    session: PlatformSession,
    input: SelectionInput,
  ): Promise<ContactPlan> {
    const result = await discover(session, input);
    const plan: ContactPlan = {
      schema: 1,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      identity,
      role: session.profile.role,
      ...result,
    };
    await writeJson(join(this.home, 'plans', plan.id + '.json'), plan);
    return plan;
  }
  async get(id: string): Promise<ContactPlan> {
    z.uuid().parse(id);
    const saved = await readJson(join(this.home, 'plans', id + '.json'));
    if (!saved) throw new RecruitmentError('NOT_FOUND', '联系计划不存在。');
    const plan = planSchema.parse(saved);
    if (plan.id !== id) throw new RecruitmentError('INPUT', '计划文件标识不一致。');
    return plan;
  }
  private key(plan: ContactPlan, targetId: string): string {
    return createHash('sha256')
      .update(
        JSON.stringify([plan.identity.platformId, plan.identity.accountId, plan.role, targetId]),
      )
      .digest('hex');
  }
  private file(bindingId: string, id: string) {
    return join(this.home, 'operations', bindingId, id + '.json');
  }
  async run(
    plan: ContactPlan,
    session: PlatformSession,
    intervalMs = 3000,
  ): Promise<OutreachResult> {
    if (session.profile.id !== plan.identity.accountId || session.profile.role !== plan.role) {
      throw new RecruitmentError('AUTH', '当前账号或身份已变化，请重新筛选生成计划。');
    }
    z.number().int().min(1000).parse(intervalMs);
    const operations: ContactOperation[] = [];
    for (const target of plan.targets) {
      const id = this.key(plan, target.id);
      const file = this.file(plan.identity.bindingId, id);
      const existing = await readJson(file);
      if (existing) {
        const operation = operationSchema.parse(existing);
        // A process can die after dispatch. A pending receipt must never authorize another click.
        if (operation.state === 'pending') {
          operation.state = 'indeterminate';
          operation.reason = 'interrupted-after-dispatch';
          operation.updatedAt = new Date().toISOString();
          await writeJson(file, operation);
        }
        operations.push(operation);
        continue;
      }
      const prepared = await session.invoke('contact.prepare', { target });
      const operation: ContactOperation = {
        id,
        planId: plan.id,
        identity: plan.identity,
        role: plan.role,
        target: prepared.target,
        state: 'pending',
        updatedAt: new Date().toISOString(),
      };
      if (!prepared.ready || !matchesActivity(prepared.target, plan.selection.activeWithin)) {
        operation.state = 'skipped';
        operation.reason = 'activity-changed';
        if (!prepared.ready) operation.reason = prepared.reason ?? 'unavailable';
        // This is a pre-dispatch observation, so a later plan may reconsider the target.
        operations.push(operation);
        continue;
      }
      await writeJson(file, operation);
      try {
        const receipt = await session.invoke('contact.send', { target: prepared.target });
        operation.receipt = receipt;
        operation.state = receipt.state === 'sent' ? 'sent' : 'skipped';
      } catch (error) {
        operation.state = 'indeterminate';
        operation.reason =
          error instanceof RecruitmentError ? error.code : 'dispatch-result-unknown';
        if (error instanceof RecruitmentError) {
          const { reason, endpoint, platformCode, httpStatus, requestObserved } =
            error.details ?? {};
          operation.failure = {
            code: error.code,
            ...(typeof reason === 'string' ? { reason } : {}),
            ...(typeof endpoint === 'string' ? { endpoint: endpoint.split('?')[0] } : {}),
            ...(typeof platformCode === 'number' ? { platformCode } : {}),
            ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
            ...(typeof requestObserved === 'boolean' ? { requestObserved } : {}),
          };
        }
        operation.updatedAt = new Date().toISOString();
        await writeJson(file, operation);
        operations.push(operation);
        break;
      }
      operation.updatedAt = new Date().toISOString();
      await writeJson(file, operation);
      operations.push(operation);
      if (operations.length < plan.targets.length)
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return {
      planId: plan.id,
      status: operations.some((operation) => operation.state === 'indeterminate')
        ? 'attention'
        : 'complete',
      operations,
    };
  }
  async history(identity: AccountIdentity): Promise<ContactOperation[]> {
    const { readdir } = await import('node:fs/promises');
    const directory = join(this.home, 'operations', identity.bindingId);
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => operationSchema.parse(await readJson(join(directory, file)))),
    );
  }
}

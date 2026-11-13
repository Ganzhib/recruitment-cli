import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineCapability, definePlatform } from '../src/core/platform.js';
import type { AccountProfile, Target } from '../src/core/schemas.js';

export function target(id = 'job-1', minutes: number | null = 60): Target {
  return {
    id,
    kind: 'job',
    title: 'TypeScript 工程师',
    name: '招聘者',
    organization: '示例公司',
    location: '北京',
    summary: 'TypeScript',
    url: 'https://example.test/jobs/' + id,
    activity: { label: minutes === null ? '' : '1小时内活跃', withinMinutes: minutes },
    contactState: 'available',
    context: {},
  };
}
export async function temporaryHome(action: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'recruit-test-'));
  try {
    await action(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
export function fakePlatform() {
  const state = {
    profile: { id: 'fabricated-user', name: '测试用户', role: 'seeker' } as AccountProfile,
    targets: [target()],
    sends: [] as string[],
    fail: false,
    ready: true,
    detailReads: 0,
  };
  const capability = defineCapability<{ profile: AccountProfile }>();
  const platform = definePlatform({
    id: 'test',
    name: '测试平台',
    authentication: 'required',
    login: async () => state.profile,
    withSession: async (_scope, action) => action({ profile: state.profile }),
    capabilities: [
      capability({
        id: 'opportunity.search',
        description: 'search',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: async () => ({ targets: state.targets, hasMore: false }),
      }),
      capability({
        id: 'opportunity.detail',
        description: 'detail',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: async (_session, { target }) => {
          state.detailReads++;
          return { target, description: target.summary };
        },
      }),
      capability({
        id: 'contact.prepare',
        description: 'prepare',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: async (_session, { target }) => ({
          target,
          ready: state.ready,
          reason: 'not-ready',
        }),
      }),
      capability({
        id: 'contact.send',
        description: 'send',
        effect: 'remote-write',
        roles: ['seeker', 'recruiter'],
        execute: async (_session, { target }) => {
          state.sends.push(target.id);
          if (state.fail) throw new Error('simulated disconnect after dispatch');
          return { state: 'sent', evidence: { source: 'fixture', message: 'ok' } };
        },
      }),
    ],
  });
  return { platform, state };
}

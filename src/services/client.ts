import { resolve } from 'node:path';
import type { Platform, PlatformSession } from '../core/platform.js';
import { PlatformRegistry } from '../core/registry.js';
import {
  capabilitySchemas,
  type CapabilityId,
  type CapabilityInput,
  type CapabilityPayload,
  type SelectionInput,
  type Target,
} from '../core/schemas.js';
import { AccountRepository, recruitmentHome } from '../runtime/accounts.js';
import { discover } from './discovery.js';
import { OutreachService } from './outreach.js';
import { RecruitmentError } from '../shared/errors.js';

export interface RecruitmentClientOptions {
  home?: string;
  platforms: Platform[];
}
export interface AccountTarget {
  platform: string;
  account?: string;
}
export class RecruitmentClient {
  readonly home: string;
  readonly registry: PlatformRegistry;
  readonly accounts: AccountRepository;
  readonly outreach: OutreachService;
  constructor(options: RecruitmentClientOptions) {
    this.home = resolve(options.home ?? recruitmentHome());
    this.registry = new PlatformRegistry(options.platforms);
    this.accounts = new AccountRepository(this.home);
    this.outreach = new OutreachService(this.home);
  }
  login({ platform, account = 'main' }: AccountTarget) {
    const adapter = this.registry.get(platform);
    if (adapter.authentication === 'public')
      throw new RecruitmentError('UNSUPPORTED', '公开官网职位无需登录。');
    return this.accounts.login(platform, account, (directory) => adapter.login(directory));
  }
  private async session<T>(
    target: AccountTarget,
    action: (session: PlatformSession) => Promise<T>,
  ): Promise<T> {
    const platform = this.registry.get(target.platform);
    if (platform.authentication === 'public') return platform.withSession(undefined, action);
    const identity = await this.accounts.resolve(target.platform, target.account);
    return this.accounts.use(identity, (scope) => platform.withSession(scope, action));
  }
  status(target: AccountTarget) {
    return this.session(target, async (session) => session.profile);
  }
  search(target: AccountTarget, input: SelectionInput) {
    return this.session(target, (session) => discover(session, input));
  }
  detail(target: AccountTarget, opportunity: Target) {
    return this.session(target, (session) =>
      session.invoke('opportunity.detail', { target: opportunity }),
    );
  }
  async prepare(target: AccountTarget, input: SelectionInput) {
    this.registry.require(target.platform, 'contact.send');
    const identity = await this.accounts.resolve(target.platform, target.account);
    return this.accounts.use(identity, (scope) =>
      this.registry
        .get(target.platform)
        .withSession(scope, (session) => this.outreach.prepare(identity, session, input)),
    );
  }
  async run(planId: string, options: { intervalMs?: number } = {}) {
    const plan = await this.outreach.get(planId);
    const platform = this.registry.require(plan.identity.platformId, 'contact.send');
    return this.accounts.use(plan.identity, (scope) =>
      platform.withSession(scope, (session) =>
        this.outreach.run(plan, session, options.intervalMs),
      ),
    );
  }
  async greet(target: AccountTarget, input: SelectionInput, options: { intervalMs?: number } = {}) {
    const plan = await this.prepare(target, input);
    return this.run(plan.id, options);
  }
  async history(target: AccountTarget) {
    return this.outreach.history(await this.accounts.resolve(target.platform, target.account));
  }
  invoke<K extends Exclude<CapabilityId, 'contact.send'>>(
    target: AccountTarget,
    capability: K,
    input: CapabilityInput<K>,
  ) {
    if (
      this.registry.require(target.platform, capability).capabilities.get(capability)!.effect !==
      'read'
    ) {
      throw new RecruitmentError('INPUT', '写操作需要通过联系计划执行。');
    }
    const payload = capabilitySchemas[capability].input.parse(input) as CapabilityPayload<K>;
    return this.session(target, (session) => session.invoke(capability, payload));
  }
}

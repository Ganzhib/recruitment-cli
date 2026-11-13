import { RecruitmentClient, type RecruitmentClientOptions } from './services/client.js';
import { defaultPlatforms } from './platform/builtins.js';
import type { CompanySiteConfig } from './platform/company-site/config.js';

export interface ClientOptions extends Partial<RecruitmentClientOptions> {
  sites?: CompanySiteConfig[];
}
export function createRecruitmentClient(options: ClientOptions = {}): RecruitmentClient {
  return new RecruitmentClient({
    home: options.home,
    platforms: options.platforms ?? defaultPlatforms(options.sites),
  });
}
export {
  RecruitmentClient,
  type AccountTarget,
  type RecruitmentClientOptions,
} from './services/client.js';
export {
  OutreachService,
  type ContactPlan,
  type ContactOperation,
  type OutreachResult,
} from './services/outreach.js';
export {
  discover,
  matchesActivity,
  activityLimit,
  type DiscoveryResult,
} from './services/discovery.js';
export {
  defineCapability,
  definePlatform,
  type Platform,
  type PlatformSession,
  type AccountScope,
  type SessionProfile,
  type Capability,
} from './core/platform.js';
export { PlatformRegistry } from './core/registry.js';
export * from './core/schemas.js';
export { AccountRepository, recruitmentHome, type AccountBinding } from './runtime/accounts.js';
export { createBossPlatform, type BossPlatformOptions } from './platform/boss/adapter.js';
export { createCompanySitePlatform } from './platform/company-site/adapter.js';
export { companySiteSchema, type CompanySiteConfig } from './platform/company-site/config.js';
export { defaultPlatforms } from './platform/builtins.js';
export { RecruitmentError, type ErrorCode } from './shared/errors.js';
export {
  createRecruitmentTools,
  type RecruitmentTools,
  type RecruitmentToolEvent,
  type ToolPolicy,
} from './services/agent-tools.js';

export { createDemoServer } from './runtime/demo-server.js';
export { runDemoAgent, type AgentConfig, type AgentMessage } from './services/demo-agent.js';

import { z } from 'zod';
import { RecruitmentError } from '../shared/errors.js';
import {
  capabilitySchemas,
  type AccountIdentity,
  type AccountProfile,
  type CapabilityId,
  type CapabilityPayload,
  type CapabilityOutput,
  type Role,
} from './schemas.js';

export interface AccountScope {
  identity: AccountIdentity;
  directory: string;
}
export interface SessionProfile {
  profile: AccountProfile;
}
export interface Capability<S> {
  id: CapabilityId;
  description: string;
  effect: 'read' | 'remote-write';
  roles: readonly Role[];
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  execute(session: S, input: unknown): Promise<unknown>;
}
export function defineCapability<S>() {
  return <K extends CapabilityId>(definition: {
    id: K;
    description: string;
    effect: K extends 'contact.send' ? 'remote-write' : 'read';
    roles: readonly Role[];
    execute(
      session: S,
      input: z.output<(typeof capabilitySchemas)[K]['input']>,
    ): Promise<CapabilityOutput<K>>;
  }): Capability<S> => ({
    ...definition,
    inputSchema: capabilitySchemas[definition.id].input,
    outputSchema: capabilitySchemas[definition.id].output,
    execute: (session, input) =>
      definition.execute(session, input as z.output<(typeof capabilitySchemas)[K]['input']>),
  });
}
export interface PlatformSession extends SessionProfile {
  invoke<K extends CapabilityId>(id: K, input: CapabilityPayload<K>): Promise<CapabilityOutput<K>>;
}
export interface Platform {
  id: string;
  name: string;
  authentication: 'required' | 'public';
  capabilities: ReadonlyMap<CapabilityId, Omit<Capability<never>, 'execute'>>;
  login(directory: string): Promise<AccountProfile>;
  withSession<T>(
    account: AccountScope | undefined,
    action: (session: PlatformSession) => Promise<T>,
  ): Promise<T>;
}

export function definePlatform<S extends SessionProfile>(definition: {
  id: string;
  name: string;
  authentication: 'required' | 'public';
  capabilities: Capability<S>[];
  login(directory: string): Promise<AccountProfile>;
  withSession<T>(account: AccountScope | undefined, action: (session: S) => Promise<T>): Promise<T>;
}): Platform {
  const capabilities = new Map(
    definition.capabilities.map((capability) => [capability.id, capability]),
  );
  if (capabilities.size !== definition.capabilities.length)
    throw new Error('Duplicate capability: ' + definition.id);
  return {
    ...definition,
    capabilities,
    withSession: (account, action) =>
      definition.withSession(account, (session) => {
        if (
          account &&
          (account.identity.platformId !== definition.id ||
            account.identity.accountId !== session.profile.id)
        ) {
          throw new RecruitmentError('AUTH', '浏览器账号与绑定身份不一致，请重新登录。');
        }
        return action({
          profile: session.profile,
          invoke: async <K extends CapabilityId>(
            id: K,
            input: CapabilityPayload<K>,
          ): Promise<CapabilityOutput<K>> => {
            const capability = capabilities.get(id);
            if (!capability || !capability.roles.includes(session.profile.role)) {
              throw new RecruitmentError(
                'UNSUPPORTED',
                `${definition.name} 当前身份不支持 ${id}。`,
              );
            }
            return (await capability.execute(session, input)) as CapabilityOutput<K>;
          },
        });
      }),
  };
}

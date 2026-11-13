import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { z } from 'zod';
import type { AccountScope } from '../core/platform.js';
import {
  identitySchema,
  nameSchema,
  profileSchema,
  type AccountIdentity,
  type AccountProfile,
} from '../core/schemas.js';
import { RecruitmentError } from '../shared/errors.js';
import { readJson, withLock, writeJson } from './storage.js';

export const bindingSchema = z.object({
  identity: identitySchema,
  profile: profileSchema,
  sessionId: z.uuid(),
});
export type AccountBinding = z.infer<typeof bindingSchema>;
export function recruitmentHome(): string {
  return resolve(process.env.RECRUIT_HOME ?? join(homedir(), '.config', 'recruitment-cli'));
}
export function accountIdentity(platformId: string, accountId: string): AccountIdentity {
  const bindingId = createHash('sha256')
    .update(JSON.stringify([platformId, accountId]))
    .digest('hex')
    .slice(0, 32);
  return { platformId, accountId, bindingId };
}
export class AccountRepository {
  constructor(readonly home: string) {}
  private directory(identity: AccountIdentity) {
    return join(this.home, 'accounts', identity.bindingId);
  }
  private aliasFile(platform: string, alias: string) {
    return join(
      this.home,
      'aliases',
      nameSchema.parse(platform),
      nameSchema.parse(alias) + '.json',
    );
  }
  async resolve(platform: string, alias = 'main'): Promise<AccountIdentity> {
    const saved = await readJson(this.aliasFile(platform, alias));
    if (!saved)
      throw new RecruitmentError(
        'AUTH',
        `请先运行 recruit auth login ${platform} --account ${alias}。`,
      );
    return identitySchema.parse(saved);
  }
  async use<T>(
    identity: AccountIdentity,
    action: (account: AccountScope) => Promise<T>,
  ): Promise<T> {
    identitySchema.parse(identity);
    if (accountIdentity(identity.platformId, identity.accountId).bindingId !== identity.bindingId)
      throw new RecruitmentError('AUTH', '账号绑定无效。');
    return withLock(this.directory(identity), async () => {
      const saved = bindingSchema.parse(
        await readJson(join(this.directory(identity), 'account.json')),
      );
      if (saved.identity.bindingId !== identity.bindingId)
        throw new RecruitmentError('AUTH', '账号记录身份不一致。');
      return action({
        identity,
        directory: join(this.directory(identity), 'sessions', saved.sessionId),
      });
    });
  }
  async login(
    platform: string,
    alias: string,
    authenticate: (directory: string) => Promise<AccountProfile>,
  ): Promise<AccountBinding> {
    const aliasFile = this.aliasFile(platform, alias);
    return withLock(aliasFile + '.write', async () => {
      const sessionId = randomUUID();
      const staging = join(this.home, 'login', sessionId);
      await mkdir(staging, { recursive: true, mode: 0o700 });
      try {
        const profile = profileSchema.parse(await authenticate(staging));
        const existing = await readJson(aliasFile);
        const identity = accountIdentity(platform, profile.id);
        if (existing && identitySchema.parse(existing).accountId !== profile.id) {
          throw new RecruitmentError(
            'AUTH',
            '该别名已绑定其他账号，请使用新的 --account 别名登录。',
          );
        }
        return await withLock(this.directory(identity), async () => {
          const sessions = join(this.directory(identity), 'sessions');
          await mkdir(sessions, { recursive: true, mode: 0o700 });
          await rename(staging, join(sessions, sessionId));
          const binding: AccountBinding = { identity, profile, sessionId };
          await writeJson(join(this.directory(identity), 'account.json'), binding);
          await writeJson(aliasFile, identity);
          return binding;
        });
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }
  async list(): Promise<{ platform: string; alias: string; identity: AccountIdentity }[]> {
    const root = join(this.home, 'aliases');
    let platforms;
    try {
      platforms = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const accounts = [];
    for (const platform of platforms.filter((entry) => entry.isDirectory())) {
      for (const file of await readdir(join(root, platform.name))) {
        if (!file.endsWith('.json')) continue;
        const alias = file.slice(0, -5);
        accounts.push({
          platform: platform.name,
          alias,
          identity: await this.resolve(platform.name, alias),
        });
      }
    }
    return accounts;
  }
}

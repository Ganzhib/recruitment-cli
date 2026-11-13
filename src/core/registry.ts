import { z } from 'zod';
import type { Platform } from './platform.js';
import type { CapabilityId } from './schemas.js';
import { nameSchema } from './schemas.js';
import { RecruitmentError } from '../shared/errors.js';

export class PlatformRegistry {
  private readonly platforms = new Map<string, Platform>();
  constructor(platforms: Platform[]) {
    for (const platform of platforms) {
      nameSchema.parse(platform.id);
      if (this.platforms.has(platform.id)) throw new Error('Duplicate platform: ' + platform.id);
      this.platforms.set(platform.id, platform);
    }
  }
  get(id: string): Platform {
    const platform = this.platforms.get(id);
    if (!platform) throw new RecruitmentError('INPUT', '未知平台：' + id);
    return platform;
  }
  require(id: string, capability: CapabilityId): Platform {
    const platform = this.get(id);
    if (!platform.capabilities.has(capability))
      throw new RecruitmentError('UNSUPPORTED', `${platform.name} 未提供 ${capability}。`);
    return platform;
  }
  describe(id?: string) {
    return (id ? [this.get(id)] : [...this.platforms.values()]).map((platform) => ({
      id: platform.id,
      name: platform.name,
      authentication: platform.authentication,
      capabilities: [...platform.capabilities.values()].map((capability) => ({
        id: capability.id,
        description: capability.description,
        effect: capability.effect,
        roles: capability.roles,
        inputSchema: z.toJSONSchema(capability.inputSchema, { io: 'input' }),
        outputSchema: z.toJSONSchema(capability.outputSchema),
      })),
    }));
  }
}

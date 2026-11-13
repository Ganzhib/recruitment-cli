import type { PlatformSession } from '../core/platform.js';
import {
  selectionSchema,
  type Selection,
  type SelectionInput,
  type Target,
} from '../core/schemas.js';

export function activityLimit(value: string): number {
  if (value === 'any') return Infinity;
  if (value === 'online') return 0;
  const match = /^([1-9]\d*)([mhd])$/.exec(value);
  if (!match) throw new Error('Selection must be validated before activityLimit');
  return Number(match[1]) * { m: 1, h: 60, d: 1440 }[match[2] as 'm' | 'h' | 'd'];
}
export function matchesActivity(target: Target, activeWithin: string): boolean {
  if (activeWithin === 'any') return true;
  return (
    target.activity.withinMinutes !== null &&
    target.activity.withinMinutes <= activityLimit(activeWithin)
  );
}
export interface DiscoveryResult {
  selection: Selection;
  targets: Target[];
  scanned: number;
  excluded: { id: string; reason: string }[];
}
export async function discover(
  session: PlatformSession,
  input: SelectionInput,
): Promise<DiscoveryResult> {
  const selection = selectionSchema.parse(input);
  const seen = new Set<string>();
  const targets: Target[] = [];
  const excluded: DiscoveryResult['excluded'] = [];
  for (let page = 1; page <= selection.maxPages; page++) {
    const result = await session.invoke('opportunity.search', {
      query: selection.query,
      city: selection.city,
      page,
      options: selection.options,
    });
    for (let target of result.targets) {
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      // Search cards may omit activity; the platform's detail view owns that evidence.
      if (selection.activeWithin !== 'any' && target.activity.withinMinutes === null) {
        target = (await session.invoke('opportunity.detail', { target })).target;
      }
      if (!matchesActivity(target, selection.activeWithin)) {
        excluded.push({
          id: target.id,
          reason: target.activity.withinMinutes === null ? 'activity-unknown' : 'inactive',
        });
      } else if (target.contactState === 'contacted') {
        excluded.push({ id: target.id, reason: 'already-contacted' });
      } else {
        targets.push(target);
      }
    }
    if (targets.length >= selection.limit || !result.hasMore) break;
  }
  targets.sort(
    (left, right) =>
      (left.activity.withinMinutes ?? Infinity) - (right.activity.withinMinutes ?? Infinity),
  );
  return { selection, targets: targets.slice(0, selection.limit), scanned: seen.size, excluded };
}

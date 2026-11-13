import type { Target } from '../../core/schemas.js';

const activityUnitMinutes: Record<string, number> = {
  分钟: 1,
  小时: 60,
  天: 1440,
  日: 1440,
  周: 10080,
  月: 44640,
};

export function bossActivity(label: string): Target['activity'] {
  const text = label.replace(/\s/g, '');
  if (/^(当前)?在线$/.test(text)) return { label, withinMinutes: 0 };
  if (/刚刚/.test(text)) return { label, withinMinutes: 1 };
  if (/今日|今天|当天/.test(text)) return { label, withinMinutes: 1440 };
  if (/昨日|昨天/.test(text)) return { label, withinMinutes: 2880 };
  if (/本周|一周/.test(text)) return { label, withinMinutes: 10080 };
  if (/本月|一个月/.test(text)) return { label, withinMinutes: 44640 };
  const relative = /(\d+)(分钟|小时|天|日|周|月)(?:内|前)?(?:活跃)?/.exec(text);
  if (relative) {
    return {
      label,
      withinMinutes: Number(relative[1]) * activityUnitMinutes[relative[2]],
    };
  }
  return { label, withinMinutes: null };
}

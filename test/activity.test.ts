import test from 'node:test';
import assert from 'node:assert/strict';
import { bossActivity } from '../src/platform/boss/activity.js';
import { roleFromUrl } from '../src/platform/boss/session.js';

test('BOSS labels use conservative activity bounds and do not guess unknown values', () => {
  for (const [label, minutes] of [
    ['在线', 0],
    ['刚刚活跃', 1],
    ['今日活跃', 1440],
    ['3日内活跃', 4320],
    ['3日前活跃', 4320],
    ['本周活跃', 10080],
    ['2周内活跃', 20160],
    ['11周内活跃', 110880],
    ['半年前活跃', null],
    ['活跃', null],
  ] as const) {
    assert.equal(bossActivity(label).withinMinutes, minutes, label);
  }
});
test('identity comes from the authenticated application surface and exact trusted origin', () => {
  assert.equal(roleFromUrl('https://www.zhipin.com/web/geek/job'), 'seeker');
  assert.equal(roleFromUrl('https://www.zhipin.com/web/chat/index'), 'recruiter');
  assert.equal(roleFromUrl('https://www.zhipin.com/web/user/'), undefined);
  assert.equal(roleFromUrl('https://www.zhipin.com.attacker.test/web/chat/index'), undefined);
});

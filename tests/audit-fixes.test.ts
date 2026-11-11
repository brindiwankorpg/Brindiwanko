/**
 * @file Fixes of the October 2026 audit that can be checked without a server: script commands written
 * with string parameters stay in quarantine, parallel login attempts count against the limit, a lock is
 * not escalated by attempts started before it, and the rate limiter keeps the keys held back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BranchType, Cmd, type EventCommand } from '../shared/events.js';
import { isScriptCommand, quarantineList } from '../shared/quarantine.js';
import { LoginThrottle } from '../server/auth/throttle.js';
import { SlidingWindowLimiter } from '../server/http/rate-limit.js';

test('script commands whose type is written as a string are put in quarantine too', () => {
  const list: EventCommand[] = [
    { code: Cmd.If, indent: 0, parameters: [String(BranchType.Script), 'true'] },
    { code: Cmd.ControlVariables, indent: 0, parameters: [1, 1, 0, '4', '1 + 1'] },
    { code: Cmd.ControlVariables, indent: 0, parameters: [1, 1, 0, '0', 5] },
  ];
  assert.equal(isScriptCommand(list[0]!), true);
  assert.equal(isScriptCommand(list[1]!), true);
  assert.equal(isScriptCommand(list[2]!), false, 'a constant operand is no script');
  assert.equal(quarantineList(list), 2);
});

test('attempts in flight count against the login limit, and a lock is not escalated by them', () => {
  let now = 0;
  const throttle = new LoginThrottle({ maxFailures: 5, windowMs: 60_000, lockMs: 1000, maxLockMs: 64_000 }, () => now);
  // A burst of 30 parallel attempts: only 5 get past the check.
  const attempts = Array.from({ length: 30 }, () => throttle.begin('user:victim'));
  const started = attempts.filter((a) => a.locked === 0);
  assert.equal(started.length, 5);
  for (const a of started) {
    a.end();
    throttle.fail('user:victim');
  }
  // One lock of the first duration, not six escalated ones.
  assert.equal(throttle.lockedFor('user:victim'), 1000);
  throttle.fail('user:victim');
  assert.equal(throttle.lockedFor('user:victim'), 1000, 'failures while locked do not lock further');
  now += 1001;
  assert.equal(throttle.begin('user:victim').locked, 0, 'free again once the lock ended');
});

test('the rate limiter keeps a key at its limit when the table is full of new keys', () => {
  const limiter = new SlidingWindowLimiter(2, 60_000, () => 0);
  limiter.record('attacker');
  limiter.record('attacker');
  assert.ok(limiter.retryAfter('attacker') > 0);
  for (let i = 0; i < 10_050; i++) limiter.record(`flood${i}`);
  assert.ok(limiter.retryAfter('attacker') > 0, 'still held back');
});

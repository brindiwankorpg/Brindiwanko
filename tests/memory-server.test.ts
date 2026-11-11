/** @file Regressions for player state and timers retained after their owner leaves. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../server/config.js';
import { closeContext, createContext } from '../server/context.js';
import { EventRunner } from '../server/game/events.js';
import { PartyService } from '../server/game/party.js';
import type { PlayerSession, World } from '../server/game/world.js';
import { Cmd } from '../shared/events.js';

test('leaving without running parallel events releases the character registry', () => {
  let live: PlayerSession | undefined;
  const runner = new EventRunner({
    isLive: (p: PlayerSession) => live === p,
    ctx: { gameData: { list: () => [] } },
  } as unknown as World);
  const state = runner as unknown as { parallels: Map<number, Set<string>> };
  for (let id = 1; id <= 1000; id++) {
    live = { characterId: id, events: new Map(), busy: false } as PlayerSession;
    runner.startTriggers(live);
    live = undefined;
    runner.forget(id);
  }
  assert.equal(state.parallels.size, 0, 'departed characters must not accumulate empty sets');
});

test('an old parallel run cannot remove the registry of a reconnected character', async (t) => {
  const common = { id: 1, trigger: 'parallel', switchId: 0, list: [{ code: Cmd.End, indent: 0, parameters: [] }] };
  let live: PlayerSession | undefined;
  const runner = new EventRunner({
    isLive: (p: PlayerSession) => live === p,
    ctx: { gameData: { list: () => [common], get: () => common } },
  } as unknown as World);
  const state = runner as unknown as { parallels: Map<number, Set<string>> };
  const first = { characterId: 1, events: new Map(), busy: false, mapGen: 0 } as PlayerSession;
  const second = { ...first };
  // Hold each loop at its minimum pause, then finish the old session first.
  const pauses: (() => void)[] = [];
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void) => {
    pauses.push(callback);
    return { unref: () => undefined };
  }) as unknown as typeof setTimeout);
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  live = first;
  runner.startTriggers(first);
  await flush();
  assert.equal(pauses.length, 1);
  live = undefined;
  runner.forget(1);
  live = second;
  runner.startTriggers(second);
  await flush();
  const current = state.parallels.get(1);
  assert.ok(current?.has('c1'), 'the new session starts its own parallel run');
  pauses.shift()!();
  await flush();
  assert.equal(state.parallels.get(1), current, 'old cleanup must leave the new run registered');
  runner.startTriggers(second);
  assert.equal(pauses.length, 1, 'refreshing must not start a duplicate parallel run');
  live = undefined;
  runner.forget(1);
  pauses.shift()!();
  await flush();
  assert.equal(state.parallels.size, 0);
});

test('closing contexts cancels every interval, including party and instance updates', (t) => {
  const active = new Set<ReturnType<typeof setInterval>>();
  const start = globalThis.setInterval;
  const stop = globalThis.clearInterval;
  t.mock.method(globalThis, 'setInterval', ((callback: () => void, ms: number) => {
    const timer = start(callback, ms);
    active.add(timer);
    return timer;
  }) as typeof setInterval);
  t.mock.method(globalThis, 'clearInterval', ((timer: ReturnType<typeof setInterval>) => {
    active.delete(timer);
    stop(timer);
  }) as typeof clearInterval);
  t.after(() => { for (const timer of active) stop(timer); });
  for (let i = 0; i < 3; i++) {
    const ctx = createContext({ ...config, dbPath: ':memory:', sessionSecret: 'memory-test' }, { bcryptRounds: 4 });
    assert.ok(active.size > 0, 'the context starts its background services');
    closeContext(ctx);
    assert.equal(active.size, 0, 'no background interval may retain the closed context');
  }
});

test('closing parties also cancels pending reconnection callbacks', (t) => {
  const active = new Set<ReturnType<typeof setTimeout>>();
  const start = globalThis.setTimeout;
  const stop = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void, ms: number) => {
    const timer = start(callback, ms);
    active.add(timer);
    return timer;
  }) as typeof setTimeout);
  t.mock.method(globalThis, 'clearTimeout', ((timer: ReturnType<typeof setTimeout>) => {
    active.delete(timer);
    stop(timer);
  }) as typeof clearTimeout);
  t.after(() => { for (const timer of active) stop(timer); });
  const players = [1, 2].map((id) => ({ characterId: id, name: `Player${id}`, socket: { emit() {} } }) as unknown as PlayerSession);
  const world = {
    social: { commands: new Map(), ignores: () => false },
    ctx: { settings: { get: (_key: string, fallback: unknown) => fallback } },
    player: (id: number) => players.find((p) => p.characterId === id),
    isLive: () => true,
    maxVitals: () => ({ maxHp: 100, maxMp: 50 }),
  } as unknown as World;
  const parties = new PartyService(world);
  t.after(() => parties.close());
  parties.invite(players[0], 2);
  parties.respond(players[1], true);
  assert.ok(parties.info(players[0]), 'a party was created through the normal invitation flow');
  parties.playerLeft(players[0]);
  assert.equal(active.size, 1, 'the departure starts a reconnection grace period');
  parties.close();
  parties.close();
  assert.equal(active.size, 0, 'closing is idempotent and cancels the pending callback');
  assert.equal(parties.info(players[0]), null);
});

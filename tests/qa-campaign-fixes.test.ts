/**
 * @file Regression tests of the anomalies found by the browser test campaign of 1.0.0-beta.2: a file uploaded
 * in the editor that the players already in game never received (3.6), the empty HP bar of another player
 * in the target frame (6.2), the damage numbers shown to an attacker while its target was still under the
 * arrival protection (6.2), and the jerky walk of the other players (seen by the author in multiplayer).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { FOLLOW_DELAY_FRAMES, FOLLOW_MAX_QUEUE, MapCharacter } from '../client/engine/character.js';
import type { DamageView } from '../shared/combat.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js';
import { DEMO_MAPS } from '../server/db/demo-map.js';
import { STEP_MS, TICK_HZ, type PlayerSession } from '../server/game/world.js';
import { PATHS } from '../server/paths.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(10);
  }
}

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

interface Player {
  client: TestClient;
  csrf: string;
  socket: ClientSocket;
  session: PlayerSession;
  /** Hits and heals this player was shown. */
  damage: DamageView[];
  /** Times the server said the resources changed. */
  resourcesChanged: number;
}

/** Registers an account (the first one of the server is its administrator), creates a character and enters the game. */
async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.social.findByName(name)!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const csrf = await client.csrf('/characters');
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { client, csrf, socket, damage: [], resourcesChanged: 0 } as unknown as Player;
  socket.on('damage', (views) => player.damage.push(...views));
  socket.on('resourcesChanged', () => player.resourcesChanged++);
  await new Promise<void>((resolve, reject) => {
    socket.on('enterWorld', () => resolve());
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(id)!;
  return player;
}

test('a file uploaded or deleted in the editor reaches the players already in game (QA 3.6)', async () => {
  const maker = await newPlayer('Maker');
  const walker = await newPlayer('Walker');
  assert.equal(server.ctx.accounts.findByUsername('Maker')!.role, 'admin', 'the first account is the administrator');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#c33"/></svg>';
  const upload = await maker.client.request('/api/editor/resources?kind=pictures&name=QaBadge', {
    method: 'POST',
    headers: { 'x-csrf-token': maker.csrf, 'content-type': 'image/svg+xml' },
    body: svg,
  });
  assert.equal(upload.status, 200);
  await until(() => walker.resourcesChanged > 0);
  // What the client then reads again lists the new file.
  const { resources } = (await (await walker.client.request('/api/resources')).json()) as { resources: { id: string }[] };
  assert.ok(resources.some((r) => r.id === 'pictures/QaBadge'), 'the manifest lists the uploaded picture');

  const told = walker.resourcesChanged;
  const removed = await maker.client.request('/api/editor/resources/pictures/QaBadge', { method: 'DELETE', headers: { 'x-csrf-token': maker.csrf } });
  assert.equal(removed.status, 200);
  await until(() => walker.resourcesChanged > told);
  for (const p of [maker, walker]) p.socket.close();
});

test('a hidden gauge is not drawn: the target frame of another player shows no empty HP bar (QA 6.2)', () => {
  const css = readFileSync(join(PATHS.root, 'client', 'styles', 'game.css'), 'utf8');
  // `.gauge { display: grid }` wins over the browser's own rule for `[hidden]` unless the style sheet says otherwise.
  assert.match(css, /\.gauge\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

test('on a PvP map, a player under the arrival protection is missed: no damage number, no state (QA 6.2)', async () => {
  const world = server.ctx.world;
  const [ann, cal] = [await newPlayer('Striker'), await newPlayer('Newcomer')];
  const [a, c] = [ann.session, cal.session];
  const map = world.mapRuntime(DEMO_MAPS.forest)!.map;
  map.mmo.pvp = true;
  try {
    for (const p of [a, c]) assert.ok(world.transfer(p, DEMO_MAPS.forest, 14, 28, 8));
    a.combat.protectedUntil = 0;
    c.combat.protectedUntil = Date.now() + 60_000;
    [c.x, c.y] = [a.x, a.y - 1];
    a.direction = 8;
    // The attacker must see the target to be shown the results.
    await wait(150);
    const onCal = () => ann.damage.filter((v) => v.target.kind === 'player' && v.target.id === c.characterId);
    const hp = c.hp;
    for (let i = 0; i < 8; i++) {
      a.combat.nextAttackAt = 0;
      a.combat.globalReadyAt = 0;
      world.combat.attack(a);
    }
    a.combat.globalReadyAt = 0;
    world.combat.useSkill(a, 1);
    await until(() => onCal().length >= 9);
    assert.equal(c.hp, hp, 'no HP lost');
    assert.ok(
      onCal().every((v) => v.kind === 'miss' && v.amount === 0),
      'every blow is shown as missed',
    );
    assert.equal(c.combat.states.size, 0, 'no state added');

    // Once the protection is over, the same blows hurt and show their damage.
    c.combat.protectedUntil = 0;
    for (let i = 0; i < 20 && c.hp === hp; i++) {
      a.combat.nextAttackAt = 0;
      a.combat.globalReadyAt = 0;
      world.combat.attack(a);
    }
    assert.ok(c.hp < hp, 'hurt after the protection');
    await until(() => onCal().some((v) => v.kind === 'hp_damage' && v.amount > 0));
  } finally {
    map.mmo.pvp = false;
    for (const p of [ann, cal]) p.socket.close();
  }
});

/**
 * Plays the positions of another player walking right as the server sends them (one step every `STEP_MS`, sent at
 * the next tick of the world, then delayed by the network) on a client drawing at 60 frames a second, and returns
 * the drawn position after each frame.
 */
function walkSeenByAnotherPlayer(steps: number, jitterMs: (step: number) => number): number[] {
  const c = new MapCharacter();
  c.locate(0, 0);
  const tickMs = 1000 / TICK_HZ;
  const arrivals = [...Array(steps).keys()].map((k) => ({ at: Math.ceil((k * STEP_MS) / tickMs) * tickMs + jitterMs(k), x: k + 1 }));
  const drawn: number[] = [];
  for (let frame = 0; frame < 600 && (drawn.at(-1) ?? 0) < steps; frame++) {
    const now = (frame * 1000) / 60;
    while (arrivals.length && arrivals[0]!.at <= now) c.follow(arrivals.shift()!.x, 0, 6, (fx, fy, tx, ty) => Math.abs(tx - fx) + Math.abs(ty - fy) === 1);
    c.update();
    drawn.push(c.realX);
  }
  return drawn;
}

test('another player walks smoothly: positions sent at uneven times are chained without jumps nor stops (multiplayer)', () => {
  const perFrame = new MapCharacter().distancePerFrame();
  // Network delay that changes from one message to the next (0 to 40 ms), always the same for the test.
  for (const jitter of [() => 0, (k: number) => (k * 37) % 41]) {
    const drawn = walkSeenByAnotherPlayer(12, jitter);
    assert.equal(drawn.at(-1), 12, 'the walk reaches the last cell');
    const start = drawn.findIndex((x) => x > 0);
    assert.ok(start <= FOLLOW_DELAY_FRAMES + 2, 'the walk starts a few frames after the first position');
    const moves = drawn.slice(start).map((x, i, all) => x - (i === 0 ? 0 : all[i - 1]!));
    // Before: a position arriving early made the drawn player jump to the end of its step, one arriving late stopped it.
    assert.ok(moves.every((d) => d > 0), 'never stops in the middle of the walk');
    assert.ok(moves.every((d) => d <= perFrame * 1.5 + 1e-9), 'never jumps');
  }
});

test('another player who teleports, turns or falls far behind is shown where the server says', () => {
  const isStep = (fx: number, fy: number, tx: number, ty: number) => Math.abs(tx - fx) + Math.abs(ty - fy) === 1;
  const c = new MapCharacter();
  c.locate(5, 5);
  // A teleport is shown at once.
  c.follow(9, 9, 2, isStep);
  assert.deepEqual([c.x, c.y, c.realX, c.realY, c.direction], [9, 9, 9, 9, 2]);
  // A turn on the spot comes after the steps still to walk.
  c.follow(10, 9, 6, isStep);
  c.follow(10, 9, 8, isStep);
  assert.equal(c.direction, 2, 'not turned before the step');
  for (let i = 0; i < 40; i++) c.update();
  assert.deepEqual([c.x, c.realX, c.direction], [10, 10, 8], 'stepped right, then turned up');
  // Far behind (a hidden tab, a long freeze): the player is put on the last position instead of running after it.
  for (let i = 1; i <= FOLLOW_MAX_QUEUE + 1; i++) c.follow(10 + i, 9, 6, isStep);
  assert.equal(c.queuedSteps, 0);
  assert.deepEqual([c.x, c.realX], [10 + FOLLOW_MAX_QUEUE + 1, 10 + FOLLOW_MAX_QUEUE + 1]);
});

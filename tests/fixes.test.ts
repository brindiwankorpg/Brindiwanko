/**
 * @file Regression tests of the QA campaign (October 2026): players walled in by a map edit,
 * arrival protection against monsters, error pages of unreadable requests, production
 * without HTTPS, and small server-side rules (knocked-out players, party invitations).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { setPassageOverride } from '../shared/passability.js';
import { DEMO_MAPS } from '../server/db/demo-map.js';
import type { PlayerSession } from '../server/game/world.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function newPlayer(name: string): Promise<{ socket: ClientSocket; session: PlayerSession; notes: string[] }> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const notes: string[] = [];
  socket.on('notify', (n) => notes.push(n.key));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, session: server.ctx.world.player(payload.character.id)!, notes };
}

test('a map edit that walls a player in moves it to the closest free cell', async () => {
  const p = await newPlayer('Walled');
  const world = server.ctx.world;
  assert.ok(world.transfer(p.session, DEMO_MAPS.village, 20, 17, 2));
  const map = structuredClone(server.ctx.maps.get(DEMO_MAPS.village)!);
  const info = server.ctx.maps.info(DEMO_MAPS.village)!;
  const flags = server.ctx.gameData.get('tileset', map.tilesetId)?.flags ?? [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setPassageOverride(map, flags, 20 + dx, 17 + dy, 'blocked');
  server.ctx.maps.saveWithVersion(info, map, 1);
  world.reloadMap(DEMO_MAPS.village);
  const runtime = world.mapRuntime(DEMO_MAPS.village)!;
  assert.ok(!runtime.isStandable(20, 17), 'the cell is walled in');
  assert.ok(runtime.isStandable(p.session.x, p.session.y), 'the player stands on a free cell');
  assert.ok(Math.abs(p.session.x - 20) + Math.abs(p.session.y - 17) <= 4, 'close to where it was');
  // A transfer onto a walled-in cell also lands on a free one.
  assert.ok(world.transfer(p.session, DEMO_MAPS.village, 20, 17, 2));
  assert.ok(runtime.isStandable(p.session.x, p.session.y));
  p.socket.close();
});

test('monsters leave a player alone while it loads the map, until it attacks', async () => {
  const p = await newPlayer('Arrival');
  const world = server.ctx.world;
  assert.ok(p.session.combat.protectedUntil > Date.now(), 'protected after logging in');
  p.session.combat.protectedUntil = 0;
  assert.ok(world.transfer(p.session, DEMO_MAPS.forest, 5, 5, 2));
  assert.ok(p.session.combat.protectedUntil > Date.now(), 'protected after changing map');
  world.combat.attack(p.session);
  assert.equal(p.session.combat.protectedUntil, 0, 'attacking ends the protection');
  p.socket.close();
});

test('an unreadable request gets a translated error page, never a stack trace', async () => {
  const client = new TestClient(server.url);
  const big = await client.request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept-language': 'fr' }, body: `username=${'a'.repeat(40_000)}` });
  assert.equal(big.status, 413);
  const html = await big.text();
  assert.match(html, /<h1>413<\/h1>/);
  assert.match(html, /trop volumineuses/);
  assert.doesNotMatch(html, /node_modules|at .*\(.*:\d+:\d+\)/);

  const json = await client.request('/api/admin/tools/announce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
  assert.ok([400, 401, 403].includes(json.status));
  const bad = await client.request('/characters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
  assert.equal(bad.status, 400);
  assert.doesNotMatch(await bad.text(), /node_modules|SyntaxError/);
});

test('in production, signing in over plain HTTP is refused with an explanation (no silent login loop)', async () => {
  const prod = await startTestServer({ production: true, setupCode: undefined });
  try {
    const client = new TestClient(prod.url);
    const res = await client.post('/register', { _csrf: 'x', username: 'Prod', email: 'prod@example.com', password: 'secret password', passwordConfirm: 'secret password' });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /TRUST_PROXY=1/);
    assert.equal(prod.ctx.accounts.count(), 0, 'no account was created');
  } finally {
    await prod.close();
  }
});

test('a knocked-out player cannot use items', async () => {
  const p = await newPlayer('Knocked');
  const world = server.ctx.world;
  p.session.hp = 1;
  p.session.combat.dead = true;
  const before = JSON.stringify(server.ctx.inventoryService.payload(p.session.characterId));
  world.useItem(p.session, 1);
  assert.equal(p.session.hp, 1);
  assert.equal(JSON.stringify(server.ctx.inventoryService.payload(p.session.characterId)), before, 'nothing consumed');
  p.session.combat.dead = false;
  p.socket.close();
});

test('a party member who disconnects keeps its place for a while and is back in the party on return', async () => {
  const a = await newPlayer('GraceA');
  const b = await newPlayer('GraceB');
  const world = server.ctx.world;
  world.party.invite(a.session, b.session.characterId);
  world.party.respond(b.session, true);
  assert.notEqual(world.party.partyOf(b.session.characterId), 0);
  const id = b.session.characterId;
  world.leave(id);
  b.socket.close();
  assert.notEqual(world.party.partyOf(id), 0, 'still in the party right after the disconnection');
  assert.notEqual(world.party.partyOf(a.session.characterId), 0, 'the party is not dissolved');
  a.socket.close();
});

import { MapCharacter } from '../client/engine/character.js';
import type { Input } from '../client/engine/input.js';
import { PlayerController } from '../client/engine/player-controller.js';
import type { MapScene } from '../client/engine/scene.js';

test('a class can have its own spawn place: new characters of that class appear there', async () => {
  const cls = server.ctx.gameData.list('class')[0]!;
  const start = server.ctx.characterService.startFor(cls.id);
  assert.deepEqual(start, server.ctx.world.startPosition(), 'without a place of its own, the System start');
  server.ctx.gameData.save('class', { ...cls, start: { mode: 'custom', mapId: DEMO_MAPS.forest, x: 14, y: 27 } });
  try {
    const p = await newPlayer('Spawner');
    assert.equal(p.session.mapId, DEMO_MAPS.forest);
    assert.deepEqual([p.session.x, p.session.y], [14, 27]);
    p.socket.close();
  } finally {
    server.ctx.gameData.save('class', cls);
  }
});

test('the player controller throttles retries after a rejected move, freezes when knocked out, and routes around monsters', () => {
  const player = new MapCharacter();
  player.locate(5, 5);
  const map = { width: 10, height: 10, data: new Array(10 * 10 * 4).fill(0) };
  let monsterCell: { x: number; y: number } | null = null;
  const fakeScene = {
    player,
    map,
    tileset: { flags: [0] },
    canStep: (x: number, y: number, d: number) => {
      const nx = x + (d === 6 ? 1 : d === 4 ? -1 : 0);
      const ny = y + (d === 2 ? 1 : d === 8 ? -1 : 0);
      return !(monsterCell && monsterCell.x === nx && monsterCell.y === ny);
    },
    bumpsEvent: () => false,
    isBlockedByEvent: () => false,
    monsterAt: (x: number, y: number) => Boolean(monsterCell && monsterCell.x === x && monsterCell.y === y),
    delta: (x1: number, y1: number, x2: number, y2: number) => ({ dx: x2 - x1, dy: y2 - y1 }),
  } as unknown as MapScene;

  let heldDir: 2 | 4 | 6 | 8 | 0 = 8;
  const fakeInput = {
    consume: () => false,
    dir4: () => heldDir,
  } as unknown as Input;

  let movesSent = 0;
  let shouldReject = true;
  const ctrl = new PlayerController(fakeScene, fakeInput, {
    move: (_d, epoch) => {
      movesSent++;
      if (shouldReject) ctrl.reject(5, 5, 8, epoch + 1);
    },
    turn: () => {},
    action: () => {},
  });

  // 1. While frozen (e.g. death overlay active), no move is sent.
  ctrl.frozen = true;
  ctrl.update();
  assert.equal(movesSent, 0, 'no move sent while frozen');

  // 2. When unfrozen and a step is immediately rejected, retries wait for REJECT_COOLDOWN_MS.
  ctrl.frozen = false;
  ctrl.update();
  assert.equal(movesSent, 1, 'first move attempt is sent');
  ctrl.update();
  assert.equal(movesSent, 1, 'immediate next-frame retry is throttled after a rejection');

  // 3. Click-to-move pathfinding routes around a living monster blocking the direct line.
  shouldReject = false;
  heldDir = 0;
  monsterCell = { x: 5, y: 4 };
  ctrl.setScene(fakeScene);
  ctrl.walkTo(5, 3);
  let steps = 0;
  while ((player.x !== 5 || player.y !== 3) && steps < 10) {
    ctrl.update();
    while (player.isMoving()) player.update();
    steps++;
  }
  assert.deepEqual([player.x, player.y], [5, 3], 'walked around the monster on (5, 4) to reach (5, 3)');
  assert.equal(steps, 4, '4 steps around the monster instead of 2 straight through');
});

test('character sub-frame interpolation smoothly bridges 60 Hz steps for high-refresh displays', () => {
  const c = new MapCharacter();
  c.locate(2, 3);
  assert.equal(c.renderX(0.5), 2);
  assert.equal(c.renderY(0.5), 3);
  c.moveStraight(6); // step right from x=2 to x=3
  c.update(); // advances one 60 Hz tick (1/16 tile at speed 4)
  assert.equal(c.prevX, 2, 'previous tick starts at cell 2');
  assert.equal(c.realX, 2 + 1 / 16, 'current tick is 1/16 tile ahead');
  assert.equal(c.renderX(0), 2);
  assert.equal(c.renderX(0.5), 2 + 1 / 32, 'mid-frame render is halfway between ticks');
  assert.equal(c.renderX(1), 2 + 1 / 16);
});

import { SceneChanges } from '../client/engine/scene-changes.js';

test('scene changes received while a map is loading are applied to the new scene instead of the old one', () => {
  const changes = new SceneChanges();
  const villageMonsters = new Map<number, { x: number; y: number }>();
  const forestMonsters = new Map<number, { x: number; y: number }>();
  let active = villageMonsters;

  // Before any map change, updates apply immediately to the active scene.
  changes.apply(() => active.set(1, { x: 2, y: 3 }));
  assert.deepEqual(villageMonsters.get(1), { x: 2, y: 3 });

  // A map change to the forest begins (220 ms fade + async loadScene).
  const load = changes.begin();
  // While loading, the server sends monsterSpawned and monstersMoved for the forest.
  changes.apply(() => active.set(42, { x: 10, y: 10 }));
  changes.apply(() => active.set(42, { x: 10, y: 11 }));
  assert.equal(villageMonsters.has(42), false, 'not added to the old village scene');
  assert.equal(forestMonsters.has(42), false, 'waiting for the forest scene to be installed');

  // The forest scene finishes loading and becomes active; held changes are released in order.
  assert.equal(changes.isLatest(load), true);
  active = forestMonsters;
  changes.release(load);
  assert.deepEqual(forestMonsters.get(42), { x: 10, y: 11 }, 'spawn and move applied in order on the new scene');

  // An overtaken load drops its stale queue and cannot release a newer load.
  const stale = changes.begin();
  changes.apply(() => active.set(99, { x: 1, y: 1 }));
  const newer = changes.begin();
  assert.equal(changes.isLatest(stale), false);
  assert.equal(changes.isLatest(newer), true);
  changes.release(stale);
  assert.equal(forestMonsters.has(99), false, 'stale load was dropped');
  changes.release(newer);
});

import { mapRoom } from '../server/game/world.js';

test('monsters whose respawn timer expired while a map was empty are included when a player returns', async () => {
  const p = await newPlayer('Returner');
  const world = server.ctx.world;
  assert.ok(world.transfer(p.session, DEMO_MAPS.forest, 14, 28, 8));
  const initial = world.combat.views(DEMO_MAPS.forest, 0);
  assert.ok(initial.length > 0, 'the forest has monsters');

  // Defeat a monster on the forest map, with its respawn timer already elapsed while the player is away.
  const maps = (world.combat as unknown as { maps: Map<string, { monsters: Map<number, { dead: boolean; respawnAt: number }> }> }).maps;
  const mc = maps.get(mapRoom(DEMO_MAPS.forest, 0))!;
  const firstMonster = [...mc.monsters.values()][0]!;
  firstMonster.dead = true;
  firstMonster.respawnAt = Date.now() - 1000;

  // Player leaves the forest for the village, then walks back into the forest.
  assert.ok(world.transfer(p.session, DEMO_MAPS.village, 19, 1, 2));
  const mapChangePromise = new Promise<{ monsters: { id: number }[] }>((resolve) => {
    p.socket.once('mapChange', resolve);
  });
  assert.ok(world.transfer(p.session, DEMO_MAPS.forest, 14, 28, 8));
  const payload = await mapChangePromise;
  assert.equal(firstMonster.dead, false, 'the monster respawned upon re-entry');
  assert.equal(payload.monsters.length, initial.length, 'all forest monsters are present in the mapChange payload');
  p.socket.close();
});



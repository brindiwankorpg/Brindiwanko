/**
 * @file Map rules and world tests: passability (layers, star tiles,
 * directional bits), A* pathfinding, autotile refresh, message code parsing,
 * and the server-side movement validation / dialogue flow over a socket.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { refreshAllAutotiles } from '../shared/autotile-shapes.js';
import { Trigger } from '../shared/events.js';
import { createMap, setTileAt, tileAt } from '../shared/map.js';
import { canMove, checkPassage, findPath, setPassageOverride } from '../shared/passability.js';
import { resizeMap, validateMap } from '../shared/map-validation.js';
import type { ClientToServerEvents, EnterWorldPayload, MessagePayload, ServerToClientEvents } from '../shared/protocol.js';
import { FLAG_BLOCK_DOWN, FLAG_DAMAGE, FLAG_IMPASSABLE, FLAG_LADDER, FLAG_STAR, TILE_ID_A2, autotileShape } from '../shared/tiles.js';
import { parseMessage } from '../client/ui/text-codes.js';
import { AoiGrid } from '../server/game/aoi-grid.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

const GROUND = TILE_ID_A2;
const WALL = 5; // B tile used as an obstacle
const STAR_TILE = 6;
const ONE_WAY = 7; // cannot be left downwards

function smallMap() {
  const map = createMap(6, 5, 1);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) setTileAt(map, x, y, 0, GROUND);
  const flags = new Array<number>(8192).fill(0);
  flags[0] = FLAG_STAR;
  flags[WALL] = FLAG_IMPASSABLE;
  flags[STAR_TILE] = FLAG_STAR | FLAG_IMPASSABLE;
  flags[ONE_WAY] = FLAG_BLOCK_DOWN;
  return { map, flags };
}

test('passability: impassable tiles block, star tiles are ignored, direction bits apply', () => {
  const { map, flags } = smallMap();
  setTileAt(map, 2, 1, 2, WALL);
  setTileAt(map, 3, 1, 2, STAR_TILE);
  setTileAt(map, 4, 1, 2, ONE_WAY);
  assert.equal(canMove(map, flags, 1, 1, 6), false, 'cannot enter a wall');
  assert.equal(canMove(map, flags, 3, 0, 2), true, 'a star tile above never blocks');
  assert.equal(canMove(map, flags, 4, 1, 2), false, 'one-way tile cannot be left downwards');
  assert.equal(canMove(map, flags, 4, 2, 8), false, 'the blocked bottom edge also stops entering from below');
  assert.equal(canMove(map, flags, 4, 0, 2), true, 'entering from above is allowed');
  assert.equal(canMove(map, flags, 0, 0, 8), false, 'map edge');
});

test('pathfinding goes around obstacles and stops next to unreachable goals', () => {
  const { map, flags } = smallMap();
  for (let y = 0; y < 4; y++) setTileAt(map, 3, y, 2, WALL);
  const path = findPath(map, flags, { x: 1, y: 1 }, { x: 5, y: 1 })!;
  assert.ok(path);
  let x = 1;
  let y = 1;
  for (const d of path) {
    assert.ok(canMove(map, flags, x, y, d));
    x += d === 4 ? -1 : d === 6 ? 1 : 0;
    y += d === 8 ? -1 : d === 2 ? 1 : 0;
  }
  assert.deepEqual([x, y], [5, 1]);
  const toWall = findPath(map, flags, { x: 1, y: 1 }, { x: 3, y: 1 })!;
  assert.equal(toWall.length, 1, 'walks to the closest reachable cell');
});

test('autotile refresh gives edges to patch borders and fill to the inside', () => {
  const map = createMap(5, 5, 1);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) setTileAt(map, x, y, 1, GROUND);
  refreshAllAutotiles(map);
  assert.equal(autotileShape(tileAt(map, 2, 2, 1)), 0, 'centre is fully surrounded');
  assert.equal(autotileShape(tileAt(map, 1, 1, 1)), 34, 'top-left corner');
  assert.equal(autotileShape(tileAt(map, 3, 3, 1)), 38, 'bottom-right corner');
});

test('message control codes are parsed', () => {
  assert.deepEqual(parseMessage('Hi \\C[2]there\\C[0]!\\.\nNext \\I[16] \\\\'), [
    { type: 'text', text: 'Hi ' },
    { type: 'color', index: 2 },
    { type: 'text', text: 'there' },
    { type: 'color', index: 0 },
    { type: 'text', text: '!' },
    { type: 'pause', frames: 15 },
    { type: 'newline' },
    { type: 'text', text: 'Next ' },
    { type: 'icon', index: 16 },
    { type: 'text', text: ' \\' },
  ]);
});

test('the area-of-interest grid finds everything within the radius, through the edges of looping maps', () => {
  const radius = 24;
  for (const [width, height, loopX, loopY] of [[30, 30, false, false], [100, 61, false, false], [100, 50, true, false], [50, 100, true, true], [10, 10, true, true], [256, 256, false, true]] as const) {
    const delta = (a: number, b: number, size: number, loop: boolean) => {
      const d = b - a;
      if (!loop) return d;
      const m = ((d % size) + size) % size;
      return m > size / 2 ? m - size : m;
    };
    const points = Array.from({ length: 300 }, (_, i) => ({ i, x: Math.floor(Math.random() * width), y: Math.floor(Math.random() * height) }));
    const grid = new AoiGrid<{ i: number; x: number; y: number }>(width, height, radius, loopX, loopY);
    for (const p of points) grid.add(p.x, p.y, p);
    for (const v of points.slice(0, 50)) {
      const near = new Set(grid.near(v.x, v.y).flat().map((p) => p.i));
      for (const p of points) {
        const within = Math.abs(delta(v.x, p.x, width, loopX)) <= radius && Math.abs(delta(v.y, p.y, height, loopY)) <= radius;
        if (within) assert.ok(near.has(p.i), `${width}×${height}: (${p.x}, ${p.y}) is near (${v.x}, ${v.y})`);
      }
    }
  }
});

// --- Server world --------------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function playerSocket(name: string): Promise<{ socket: ClientSocket; payload: EnterWorldPayload; client: TestClient }> {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: `${name}Hero`, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload, client };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('entering the world sends the map, its tileset and the event views', async () => {
  const { socket, payload } = await playerSocket('Mapper');
  assert.equal(payload.map.id, 1);
  assert.equal(payload.map.data.length, payload.map.width * payload.map.height * 6);
  assert.equal(payload.tileset.flags.length, 8192);
  assert.ok(payload.events.some((e) => e.image.characterName === 'People1'));
  assert.deepEqual([payload.character.x, payload.character.y], [20, 17]);
  socket.close();
});

test('the server applies valid steps, rejects blocked or too fast ones, and saves the position', async () => {
  const { socket, payload } = await playerSocket('Runner');
  const id = payload.character.id;
  const rejections: { x: number; y: number; epoch: number }[] = [];
  socket.on('moveRejected', (r) => rejections.push(r));

  socket.emit('move', 8, 0); // (20,16), free plaza
  await wait(300);
  assert.deepEqual([server.ctx.world.player(id)?.x, server.ctx.world.player(id)?.y], [20, 16]);

  // The well occupies (22..23, 11..12); its top row is the roof (star tile, walkable),
  // its bottom row is solid: stand next to the solid part and bump into it.
  const p = server.ctx.world.player(id)!;
  p.x = 21;
  p.y = 12;
  socket.emit('move', 6, 0);
  await wait(100);
  assert.equal(rejections.length, 1, 'blocked step is rejected');
  assert.deepEqual([rejections[0]!.x, rejections[0]!.y], [21, 12]);
  const epoch = rejections[0]!.epoch;

  // A stale epoch is ignored silently.
  socket.emit('move', 2, 0);
  await wait(100);
  assert.deepEqual([p.x, p.y], [21, 12]);

  // Speed hack: 10 instant steps; only the burst allowance passes.
  for (let i = 0; i < 10; i++) socket.emit('move', 2, epoch);
  await wait(200);
  assert.ok(p.y - 12 <= 3, `moved ${p.y - 12} cells instantly`);
  assert.ok(rejections.length >= 2);

  socket.close();
  await wait(150);
  const saved = server.ctx.characters.findById(id)!;
  assert.deepEqual([saved.x, saved.y], [p.x, p.y], 'position saved at disconnection');
});

test('talking to an NPC runs its dialogue and freezes the player until acknowledged', async () => {
  const { socket, payload } = await playerSocket('Talker');
  const p = server.ctx.world.player(payload.character.id)!;
  // Tomas stands at (17,16): face him from (18,16).
  p.x = 18;
  p.y = 16;
  socket.emit('turn', 4);
  await wait(50);
  const messages: MessagePayload[] = [];
  const busyStates: boolean[] = [];
  socket.on('busy', (b) => busyStates.push(b));
  const turned = new Promise<number>((resolve) => socket.on('eventUpdate', (u) => u.direction && resolve(u.direction)));
  socket.on('showMessage', (m, ack) => {
    messages.push(m);
    setTimeout(() => ack(0), 50);
  });
  socket.emit('action');
  assert.equal(await turned, 6, 'the NPC turns to face the player');
  await wait(100);
  assert.equal(p.busy, true);
  socket.emit('move', 8, 0);
  await wait(50);
  assert.deepEqual([p.x, p.y], [18, 16], 'cannot walk away during the dialogue');
  await wait(300);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.speaker, 'Tomas');
  assert.equal(messages[0]!.faceName, 'People1');
  assert.equal(p.busy, false);
  assert.deepEqual(busyStates, [true, false], 'client is notified when a non-parallel event starts and finishes');
  socket.close();
});

/** Gives a player their own copy of Tomas' definition, with the active page tweaked (other tests keep the original). */
function tweakTomas(p: ReturnType<typeof server.ctx.world.player>, change: (page: { trigger: number; priorityType: number; moveType: number }) => void) {
  const tomas = [...p!.events.values()].find((e) => e.def.x === 17 && e.def.y === 16)!;
  (tomas as { def: unknown }).def = structuredClone(tomas.def);
  change(tomas.def.pages[tomas.pageIndex]!);
  return tomas;
}

test('walking into a solid touch-triggered event makes the server start it', async () => {
  const { socket, payload } = await playerSocket('Bumper');
  const p = server.ctx.world.player(payload.character.id)!;
  tweakTomas(p, (page) => {
    page.trigger = Trigger.PlayerTouch;
    page.priorityType = 1;
  });
  p.x = 18;
  p.y = 16;
  const messages: MessagePayload[] = [];
  socket.on('showMessage', (m, ack) => {
    messages.push(m);
    setTimeout(() => ack(0), 20);
  });
  socket.emit('move', 4, p.epoch); // into Tomas at (17,16), without pressing Action
  await wait(400);
  assert.ok(messages.length >= 1, 'the dialogue started');
  assert.deepEqual([p.x, p.y], [18, 16], 'the step itself is refused');
  socket.close();
});

test('an event with the "event touch" trigger starts once when it reaches the player', async () => {
  const { socket, payload } = await playerSocket('Touched');
  const p = server.ctx.world.player(payload.character.id)!;
  tweakTomas(p, (page) => {
    page.trigger = Trigger.EventTouch;
    page.moveType = 2; // towards the player
  });
  const messages: MessagePayload[] = [];
  socket.on('showMessage', (m, ack) => {
    messages.push(m);
    setTimeout(() => ack(0), 20);
  });
  p.x = 18;
  p.y = 16; // next to Tomas
  await wait(1200);
  assert.equal(messages.length, 2, 'the two messages of the dialogue, once');
  await wait(800);
  assert.equal(messages.length, 2, 'no restart while the event stays next to the player');
  socket.close();
});

test('using a skill still recharging tells the player', async () => {
  const { socket, payload } = await playerSocket('Cooler');
  const p = server.ctx.world.player(payload.character.id)!;
  p.combat.cooldowns.set(1, Date.now() + 5000);
  const notified = new Promise<{ key: string; params?: Record<string, string | number> }>((resolve) => socket.on('notify', resolve));
  socket.emit('useSkill', 1);
  const n = await notified;
  assert.equal(n.key, 'error.combat.skill_cooldown');
  assert.ok(Number(n.params?.seconds) >= 1 && Number(n.params?.seconds) <= 5);
  socket.close();
});

test('a second connection with the same character replaces the first', async () => {
  const { socket, client, payload } = await playerSocket('Twin');
  const kicked = new Promise<string>((resolve) => socket.on('errorMessage', (e) => resolve(e.key)));
  const second: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  await new Promise((r) => second.on('enterWorld', r));
  assert.equal(await kicked, 'error.net.replaced');
  await wait(100);
  assert.equal(server.ctx.world.player(payload.character.id)?.socket.connected, true);
  second.close();
});

test('passability mode: cells blocked or opened by hand, whatever their tiles', () => {
  const { map, flags } = smallMap();
  setTileAt(map, 3, 2, 2, WALL);
  // A free cell blocked by hand, then clicked again: back to its tiles.
  setPassageOverride(map, flags, 1, 1, 'blocked');
  assert.deepEqual(map.mmo.blocked, [1 * 6 + 1]);
  assert.equal(canMove(map, flags, 0, 1, 6), false, 'cannot enter the blocked cell');
  assert.equal(canMove(map, flags, 1, 0, 2), false);
  setPassageOverride(map, flags, 1, 1, 'open');
  assert.equal(map.mmo.blocked, undefined, 'asking for what the tiles give removes the override');
  assert.equal(canMove(map, flags, 0, 1, 6), true);
  // A wall opened by hand.
  setPassageOverride(map, flags, 3, 2, 'open');
  assert.deepEqual(map.mmo.opened, [2 * 6 + 3]);
  assert.equal(canMove(map, flags, 2, 2, 6), true, 'the opened wall can be walked on');
  assert.equal(checkPassage(map, flags, 3, 2, 0x8), true);
  assert.equal(validateMap(map, () => true), null);
  assert.equal(validateMap({ ...map, mmo: { ...map.mmo, blocked: [999] } }, () => true), 'mmo.passage');
  // Resizing keeps the overrides on their cells.
  setPassageOverride(map, flags, 5, 4, 'blocked');
  const smaller = resizeMap(map, 4, 3);
  assert.deepEqual(smaller.mmo.opened, [2 * 4 + 3]);
  assert.equal(smaller.mmo.blocked, undefined, 'the cell cut off is dropped');
});

test('a player out of range is told to the others, which stop showing it until it comes back', async () => {
  const seer = await playerSocket('Seer');
  const seen = await playerSocket('Seen');
  const world = server.ctx.world;
  const [a, b] = [world.player(seer.payload.character.id)!, world.player(seen.payload.character.id)!];
  const moves: number[] = [];
  const gone: number[] = [];
  seer.socket.on('playersMoved', (list) => moves.push(...list.map((m) => m[0])));
  seer.socket.on('outOfSight', (ids) => gone.push(...ids));
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await wait(10);
    assert.ok(check());
  };
  [a.x, a.y, b.x, b.y] = [20, 17, 22, 17];
  world.tick();
  await until(() => moves.includes(b.characterId));
  // Far away on the same map (village 40 cells wide): no more positions, and the client is told why.
  b.x = 38;
  a.x = 2;
  world.tick();
  await until(() => gone.includes(b.characterId));
  moves.length = 0;
  b.x = 10;
  world.tick();
  await until(() => moves.includes(b.characterId));
  seer.socket.close();
  seen.socket.close();
});

test('a damage floor hurts at each step without knocking out; on a ladder the player faces up', async () => {
  const { socket, payload } = await playerSocket('Climber');
  const world = server.ctx.world;
  const p = world.player(payload.character.id)!;
  const runtime = world.mapRuntime(1)!;
  const flags = runtime.flags as number[];
  // The plaza ground (20, 16) becomes a damage floor and a ladder for this test.
  const tile = tileAt(runtime.map, 20, 16, 0);
  const before = flags[tile]!;
  try {
    flags[tile] = before | FLAG_DAMAGE | FLAG_LADDER;
    const step = () => {
      [p.x, p.y, p.stepTokens] = [21, 16, 3];
      assert.ok(world.move(p, 4, p.epoch), 'step left onto (20, 16)');
    };
    p.hp = 15;
    step();
    assert.equal(p.hp, 5, '10 HP lost');
    assert.equal(p.direction, 8, 'facing up on the ladder');
    step();
    assert.equal(p.hp, 1, 'never below 1 HP');
    assert.equal(p.combat.dead, false);
  } finally {
    flags[tile] = before;
    socket.close();
  }
});

test('maps nobody stands on are freed after a while; maps in play stay loaded', async () => {
  const { socket, payload } = await playerSocket('Keeper');
  const world = server.ctx.world;
  const loaded = (world as unknown as { maps: Map<number, unknown> }).maps;
  const house = world.mapRuntime(3)!;
  assert.ok(loaded.has(3) && loaded.has(payload.map.id));
  const now = Date.now();
  world.releaseIdleMaps(now);
  world.releaseIdleMaps(now + 11 * 60_000);
  assert.equal(loaded.has(3), false, 'the empty house is freed');
  assert.ok(loaded.has(payload.map.id), 'the map of the player stays');
  assert.notEqual(world.mapRuntime(3), house, 'read again when needed');
  assert.ok(world.mapRuntime(3)!.map.width > 0);
  socket.close();
});

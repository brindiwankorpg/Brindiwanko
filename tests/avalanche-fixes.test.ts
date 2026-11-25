/**
 * @file Regression tests of the repairs made after the second opinion on the 360° audit (Aerith): a failing
 * database write while a player enters or leaves (#01, #02, #03, #31), global switches refreshed once per tick
 * (#04), the limit of game connections (#61), the API answers (#67, #68, #70), the daily limit of "forgotten
 * password" e-mails (#21), the gate in front of bcrypt (#29), names and texts (#44, #45), the settings read
 * without a copy (#58), the equipment kept in memory (#53) and the occupation of a map shown to the editor (#38).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { mixesScripts, nameKey } from '../shared/names.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js';
import { HASH_BUSY, HashGate } from '../server/auth/hash-gate.js';
import { resolveText } from '../server/events/interpreter.js';
import type { PlayerSession } from '../server/game/world.js';
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

/** An account with a character selected for play (the first account of a server is its administrator). */
async function account(target: TestServer, name: string): Promise<{ client: TestClient; accountId: number; characterId: number; api: (method: string, path: string, body?: unknown) => Promise<Response> }> {
  const client = new TestClient(target.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const html = await (await client.request('/characters')).text();
  const characterId = Number([...html.matchAll(/action="\/characters\/(\d+)\/play"/g)].at(-1)![1]);
  await client.post(`/characters/${characterId}/play`, { _csrf: await client.csrf('/characters') });
  const csrf = await client.csrf('/characters');
  const api = (method: string, path: string, body?: unknown) =>
    client.request(path, { method, headers: { 'x-csrf-token': csrf, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { client, accountId: target.ctx.accounts.findByUsername(name)!.id, characterId, api };
}

/** Opens the game connection of a client: resolves when it enters the world, or with why it could not. */
function open(target: TestServer, client: TestClient): { socket: ClientSocket; outcome: Promise<{ entered: true } | { entered: false; reason: string }> } {
  const socket: ClientSocket = connect(target.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const outcome = new Promise<{ entered: true } | { entered: false; reason: string }>((resolve) => {
    socket.on('enterWorld', () => resolve({ entered: true }));
    socket.on('connect_error', (err) => resolve({ entered: false, reason: err.message }));
    socket.on('errorMessage', (e) => resolve({ entered: false, reason: e.key }));
  });
  return { socket, outcome };
}

/** Replaces a method of an object for the time of a block, then puts the original back. */
async function failing<T extends object, K extends keyof T>(target: T, key: K, run: () => Promise<void>): Promise<void> {
  const own = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key];
  (target as Record<K, unknown>)[key] = () => {
    throw new Error('simulated database failure (disk full)');
  };
  const quiet = console.error;
  console.error = () => undefined;
  try {
    await run();
  } finally {
    console.error = quiet;
    if (own) target[key] = original;
    else delete (target as Record<K, unknown>)[key];
  }
}

test('#01 a database write failing while a player enters turns that player away; the server goes on', async () => {
  const a = await account(server, 'Entrant');
  await failing(server.ctx.admin, 'logConnection', async () => {
    const { socket, outcome } = open(server, a.client);
    assert.deepEqual(await outcome, { entered: false, reason: 'error.http.server' });
    await until(() => socket.disconnected);
    assert.equal(server.ctx.world.player(a.characterId), undefined, 'no half-joined session stays in the world');
  });
  const again = open(server, a.client);
  assert.deepEqual(await again.outcome, { entered: true }, 'the next connection works');
  // Leaving while the connection log cannot be written still takes the player out of the world.
  await failing(server.ctx.admin, 'logConnection', async () => {
    again.socket.close();
    await until(() => server.ctx.world.player(a.characterId) === undefined);
  });
});

test('#02 a handshake failing on the database is answered with an error instead of hanging', async () => {
  const a = await account(server, 'Handshake');
  await failing(server.ctx.accounts, 'findById', async () => {
    const { socket, outcome } = open(server, a.client);
    assert.deepEqual(await outcome, { entered: false, reason: 'error.http.server' });
    socket.close();
  });
});

test('#03 #31 a save refused when a player is kicked still takes it out, and keeps its play time for the next save', async () => {
  const a = await account(server, 'Kicked');
  const { socket, outcome } = open(server, a.client);
  assert.deepEqual(await outcome, { entered: true });
  const p = server.ctx.world.player(a.characterId)!;
  p.savedAt = Date.now() - 5000;
  const before = p.savedAt;
  await failing(server.ctx.characters, 'saveStates', async () => {
    server.ctx.world.checkpoint(p);
    assert.equal(p.savedAt, before, 'the seconds played are not counted as saved');
    server.ctx.world.kickAccount(a.accountId, 'error.net.kicked');
  });
  assert.equal(server.ctx.world.player(a.characterId), undefined);
  await until(() => socket.disconnected);
});

test('#04 #05 a global switch flipped many times refreshes the other players once, at the next tick', async () => {
  const [a, b] = [await account(server, 'Flipper'), await account(server, 'Watcher')];
  const sa = open(server, a.client);
  const sb = open(server, b.client);
  assert.deepEqual(await sa.outcome, { entered: true });
  assert.deepEqual(await sb.outcome, { entered: true });
  const world = server.ctx.world;
  const declared = server.ctx.settings.get('switches', []);
  server.ctx.settings.set('switches', [{ name: 'World', global: true }]);
  world.systemChanged();
  const pa = world.player(a.characterId)!;
  const pb = world.player(b.characterId)!;
  let refreshed = 0;
  const original = world.refreshEvents.bind(world);
  world.refreshEvents = (p: PlayerSession) => {
    if (p === pb) refreshed++;
    original(p);
  };
  try {
    for (let i = 0; i < 10; i++) world.setSwitch(pa, 1, i % 2 === 0);
    world.setVariable(pa, 1, 1);
    assert.equal(refreshed, 0, 'nothing for the others before the tick');
    world.tick();
    assert.equal(refreshed, 1, 'one refresh for the whole tick');
    world.tick();
    assert.equal(refreshed, 1, 'nothing more without a new change');
  } finally {
    delete (world as { refreshEvents?: unknown }).refreshEvents;
    server.ctx.settings.set('switches', declared);
    world.systemChanged();
    sa.socket.close();
    sb.socket.close();
  }
});

test('#61 an account reconnecting in a loop is held back', async () => {
  const limited = await startTestServer({ socketConnectionsPerMin: 2 });
  try {
    const a = await account(limited, 'Looper');
    for (let i = 0; i < 2; i++) {
      const { socket, outcome } = open(limited, a.client);
      assert.deepEqual(await outcome, { entered: true });
      socket.close();
      await until(() => limited.ctx.world.player(a.characterId) === undefined);
    }
    const third = open(limited, a.client);
    assert.deepEqual(await third.outcome, { entered: false, reason: 'error.net.too_many_connections' });
    third.socket.close();
  } finally {
    await limited.close();
  }
});

test('#67 #68 #70 the API answers: unknown paths in JSON, ids checked, only applied changes in the log', async () => {
  const admin = await account(server, 'Operator');
  server.ctx.accounts.setRole(admin.accountId, 'admin');
  const unknown = await admin.api('GET', '/api/no-such-thing');
  assert.equal(unknown.status, 404);
  assert.match(unknown.headers.get('content-type') ?? '', /json/);
  assert.deepEqual(await unknown.json(), { error: 'error.http.not_found' });

  for (const id of ['1.5', '1e15', '0']) assert.equal((await admin.api('DELETE', `/api/editor/db/item/${id}`)).status, 400, `id ${id}`);

  const { socket, outcome } = open(server, admin.client);
  assert.deepEqual(await outcome, { entered: true });
  const res = await admin.api('POST', '/api/admin/tools/progress', { characterId: admin.characterId, switchId: 3, switchValue: true, junk: 'x'.repeat(5000) });
  assert.equal(res.status, 200);
  const details = server.ctx.db.prepare<[], string>("SELECT details FROM admin_log WHERE action = 'progress' ORDER BY id DESC LIMIT 1").pluck().get()!;
  assert.deepEqual(JSON.parse(details), { switchId: 3, switchValue: true });

  // #38: the editor learns who would lose their fight before saving a map.
  const occupancy = await admin.api('GET', '/api/editor/maps/1/occupancy');
  assert.equal(occupancy.status, 200);
  const counts = (await occupancy.json()) as { players: number; instances: number };
  assert.equal(counts.instances, 0);
  assert.ok(counts.players >= 0);
  socket.close();
});

test('#21 one account receives a few "forgotten password" e-mails a day, whoever asks', async () => {
  await account(server, 'Mailbox');
  const t0 = Date.now();
  const minutes = (n: number) => t0 + n * 60_000;
  for (let i = 0; i < 5; i++) assert.ok(server.ctx.auth.createPasswordReset('Mailbox', minutes(i * 3)), `e-mail ${i + 1}`);
  assert.equal(server.ctx.auth.createPasswordReset('Mailbox', minutes(30)), null, 'the sixth of the day is not sent');
  assert.ok(server.ctx.auth.createPasswordReset('Mailbox', minutes(24 * 60 + 1)), 'the next day it is');
});

test('#29 the hashing gate runs a few hashes at once and turns away the excess', async () => {
  const gate = new HashGate(1, 1);
  let release: () => void = () => undefined;
  const first = gate.run(() => new Promise<string>((resolve) => (release = () => resolve('first'))));
  const second = gate.run(async () => 'second');
  assert.equal(await gate.run(async () => 'third'), HASH_BUSY, 'beyond the waiting line, refused at once');
  assert.equal(gate.active, 1);
  assert.equal(gate.queued, 1);
  release();
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.equal(gate.active, 0);
});

test('#44 #45 look-alike letters of other alphabets and replacement patterns in texts', () => {
  assert.equal(mixesScripts('Mօderateur'), true, 'Armenian o among Latin letters');
  assert.equal(nameKey('մօdերատ'), nameKey('մodերատ'), 'Armenian look-alikes share the Latin key');
  assert.equal(nameKey('𝖬oderateur'), 'moderateur');
  const host = { getVariable: () => 0, playerName: () => 'Ann', currencyName: () => '$& coins' };
  assert.equal(resolveText('\\G and \\P', host), '$& coins and Ann');
});

test('#58 settings read without a copy are frozen; a copy to change is still given by get()', () => {
  const settings = server.ctx.settings;
  settings.set('weaponTypes', ['None', 'Sword']);
  const shared = settings.peek<string[]>('weaponTypes', []);
  assert.ok(Object.isFrozen(shared));
  assert.throws(() => shared.push('Axe'), TypeError);
  const copy = settings.get<string[]>('weaponTypes', []);
  copy.push('Axe');
  assert.deepEqual(settings.peek<string[]>('weaponTypes', []), ['None', 'Sword']);
});

test('#53 the equipment is kept in memory until it changes', async () => {
  const a = await account(server, 'Wearer');
  const progression = server.ctx.progression;
  const id = a.characterId;
  const before = progression.equipment(id);
  // A change made behind the repository's back is only seen once the cache is told...
  server.ctx.db.prepare('DELETE FROM character_equipment WHERE character_id = ? AND slot = ?').run(id, 'accessory');
  progression.forgetEquipment([id]);
  const without = progression.equipment(id);
  server.ctx.db.prepare('INSERT INTO character_equipment (character_id, slot, item_kind, item_id) VALUES (?, ?, ?, ?)').run(id, 'accessory', 'armor', 1);
  assert.deepEqual(progression.equipment(id), without);
  progression.forgetEquipment([id]);
  assert.deepEqual(progression.equipment(id).get('accessory'), { kind: 'armor', id: 1 });
  // ...and a copy handed out cannot change the cache.
  progression.equipment(id).clear();
  assert.equal(progression.equipment(id).size, without.size + 1);
  assert.ok(before.size >= 0);
});

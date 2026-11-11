/**
 * @file Administration panel tests: rights (players refused, moderators
 * limited), the step criterion (a moderator mutes and bans a player and reads
 * its trade history), game tools, logs, backups and the automatic backups schedule.
 */
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChatMessage } from '../shared/social.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(10);
  }
}

interface Account {
  client: TestClient;
  id: number;
  api: <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
}

async function account(name: string): Promise<Account> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  const csrf = await client.csrf('/characters');
  const api = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await client.request(`/api/admin${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const isJson = res.headers.get('content-type')?.includes('json');
    return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
  };
  return { client, id: server.ctx.accounts.findByUsername(name)!.id, api };
}

interface Player {
  socket: ClientSocket;
  session: PlayerSession;
  chat: ChatMessage[];
  errors: string[];
  disconnected: boolean;
}

async function play(a: Account, name: string): Promise<Player> {
  await a.client.post('/characters', { _csrf: await a.client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(a.id)[0]!.id;
  await a.client.post(`/characters/${id}/play`, { _csrf: await a.client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: a.client.cookieHeader() } });
  const p = { socket, chat: [], errors: [], disconnected: false } as unknown as Player;
  socket.on('chat', (m) => p.chat.push(m));
  socket.on('errorMessage', (e) => p.errors.push(e.key));
  socket.on('disconnect', () => (p.disconnected = true));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  p.session = server.ctx.world.player(payload.character.id)!;
  return p;
}

test('criterion: a moderator moderates a player and reads its trade history', async () => {
  const admin = await account('Boss'); // first account: administrator
  const mod = await account('Modo');
  const bad = await account('Troll');
  const buddy = await account('Buddy');
  server.ctx.accounts.setRole(mod.id, 'moderator');

  // A player cannot use the panel.
  assert.equal((await bad.api('GET', '/dashboard')).status, 403);
  const page = await bad.client.request('/admin');
  assert.notEqual(page.status, 200);

  // The troll trades with a buddy (logged), then is reported.
  const troll = await play(bad, 'Troll');
  const friend = await play(buddy, 'Buddy');
  server.ctx.world.changeItems(troll.session, 'item', 1, 2);
  assert.equal(server.ctx.social.trade(troll.session.characterId, friend.session.characterId, { items: [{ kind: 'item', id: 1, quantity: 2 }], gold: 0 }, { items: [], gold: 10 }, () => 99, 48), null);

  // Dashboard and search.
  const dash = await mod.api<{ players: { name: string }[]; server: { accounts: number } }>('GET', '/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.body.players.some((p) => p.name === 'Troll'));
  const found = await mod.api<{ accounts: { id: number }[] }>('GET', '/accounts?q=trol');
  assert.deepEqual(found.body.accounts.map((a) => a.id), [bad.id]);

  // Mute: the chat is refused.
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/mute`, { minutes: 30, reason: 'insultes' })).status, 200);
  troll.socket.emit('chat', 'bla bla', 'map');
  await until(() => troll.chat.some((m) => m.key === 'error.chat.muted_reason'));
  await wait(50);
  assert.ok(!friend.chat.some((m) => m.text === 'bla bla'));

  // The account page shows the trade history (and the connections).
  const detail = await mod.api<{ logs: Record<string, Record<string, unknown>[]>; account: { mutedUntil: string; email: string } }>('GET', `/accounts/${bad.id}`);
  assert.ok(detail.body.account.mutedUntil);
  assert.equal(detail.body.logs.trades!.length, 1);
  assert.equal(detail.body.logs.trades![0]!.a, 'Troll');
  assert.equal(detail.body.logs.trades![0]!.aItems, `${server.ctx.gameData.get('item', 1)!.name} (#1) ×2`, 'items shown by name');
  assert.ok(detail.body.logs.connections!.some((l) => l.event === 'login'));
  // Personal data: a moderator sees the e-mail masked and no IP address; an administrator sees them.
  assert.equal(detail.body.account.email, 't***@example.com');
  assert.ok(detail.body.logs.connections!.every((l) => !('ip' in l)));
  const full = await admin.api<{ logs: Record<string, Record<string, unknown>[]>; account: { email: string } }>('GET', `/accounts/${bad.id}`);
  assert.equal(full.body.account.email, 'troll@example.com');
  assert.ok(full.body.logs.connections!.every((l) => 'ip' in l));

  // A moderator cannot ban for good, nor sanction an administrator.
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/ban`, { permanent: true })).status, 403);
  assert.equal((await mod.api('POST', `/accounts/${admin.id}/mute`, { minutes: 5 })).status, 403);
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/role`, { role: 'admin' })).status, 403);

  // A one-day ban: kicked at once, refused at the next connection.
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/ban`, { minutes: 1440, reason: 'récidive' })).status, 200);
  await until(() => troll.disconnected);
  assert.ok(troll.errors.includes('error.auth.banned_reason'));
  const again = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: bad.client.cookieHeader() } });
  const refusal = await new Promise<string>((resolve) => again.on('connect_error', (e) => resolve(e.message)));
  assert.match(refusal, /error\.(auth\.banned|auth\.not_authenticated)/);
  again.close();

  // Every action is in the administrator log.
  const adminLog = await admin.api<{ lines: { action: string }[] }>('GET', '/logs/admin');
  assert.deepEqual(adminLog.body.lines.map((l) => l.action).slice(0, 2), ['ban', 'mute']);
  assert.equal((await mod.api('POST', `/accounts/${bad.id}/unban`)).status, 200);
  friend.socket.close();
});

test('a moderator cannot lift an administrator sanction, nor sanctions of its peers', async () => {
  const boss = await account('Boss4');
  server.ctx.accounts.setRole(boss.id, 'admin');
  const mod = await account('Modo3');
  server.ctx.accounts.setRole(mod.id, 'moderator');
  const peer = await account('Modo4');
  server.ctx.accounts.setRole(peer.id, 'moderator');
  const cheat = await account('Cheater');

  // A permanent ban given by an administrator stays.
  assert.equal((await boss.api('POST', `/accounts/${cheat.id}/ban`, { permanent: true })).status, 200);
  assert.equal((await mod.api('POST', `/accounts/${cheat.id}/unban`)).status, 403);
  assert.ok(server.ctx.admin.account(cheat.id)!.bannedUntil);
  // A ban a moderator could have given can be lifted by a moderator.
  assert.equal((await boss.api('POST', `/accounts/${cheat.id}/ban`, { minutes: 60 })).status, 200);
  assert.equal((await mod.api('POST', `/accounts/${cheat.id}/unban`)).status, 200);
  assert.equal(server.ctx.admin.account(cheat.id)!.bannedUntil, null);

  // Sanctions of an equal or higher rank are out of reach.
  server.ctx.admin.setMute(peer.id, '9999-12-31 23:59:59', null);
  assert.equal((await mod.api('POST', `/accounts/${peer.id}/unmute`)).status, 403);
  assert.equal((await boss.api('POST', `/accounts/${peer.id}/unmute`)).status, 200);
});

test('a promotion applies at once in game, a demotion too (and frees the editor)', async () => {
  const boss = await account('Boss6');
  server.ctx.accounts.setRole(boss.id, 'admin');
  const member = await account('Member');
  const p = await play(member, 'Member');
  const roles: string[] = [];
  p.socket.on('roleChanged', ({ role }) => roles.push(role));

  assert.equal((await boss.api('POST', `/accounts/${member.id}/role`, { role: 'admin' })).status, 200);
  await until(() => roles.includes('admin'));
  assert.equal(p.session.socket.data.role, 'admin');
  // The editor answers right away, without logging in again.
  const csrf = await member.client.csrf('/characters');
  assert.equal((await member.client.request('/api/editor/bootstrap', { headers: { 'x-csrf-token': csrf } })).status, 200);
  server.ctx.editLocks.acquire(1, member.id, 'Member');

  assert.equal((await boss.api('POST', `/accounts/${member.id}/role`, { role: 'player' })).status, 200);
  await until(() => roles.at(-1) === 'player');
  assert.equal(p.session.socket.data.role, 'player');
  assert.equal(server.ctx.editLocks.holder(1), undefined, 'the edit lock is released');
  assert.equal((await member.client.request('/api/editor/bootstrap', { headers: { 'x-csrf-token': csrf } })).status, 403);
  p.socket.close();
});

test('resetting a password logs the account out of every web session', async () => {
  const boss = await account('Boss5');
  server.ctx.accounts.setRole(boss.id, 'admin');
  const victim = await account('Victim');
  assert.equal((await victim.client.request('/characters')).status, 200);

  const reset = await boss.api<{ password: string }>('POST', `/accounts/${victim.id}/reset-password`);
  assert.equal(reset.status, 200);
  // The old session (maybe a thief's) is gone: the next page asks to log in.
  assert.equal((await victim.client.request('/characters')).status, 303);

  // An administrator resetting its own password keeps its current session.
  assert.equal((await boss.api('POST', `/accounts/${boss.id}/reset-password`)).status, 200);
  assert.equal((await boss.client.request('/characters')).status, 200);
});

test('game tools, sales log and backups (administrators)', async () => {
  const boss2 = await account('Boss3');
  server.ctx.accounts.setRole(boss2.id, 'admin');
  const mod = await account('Modo2');
  server.ctx.accounts.setRole(mod.id, 'moderator');
  const user = await account('Player1');
  const p = await play(user, 'Player1');
  const me = await play(boss2, 'Boss3');
  const world = server.ctx.world;

  // Tools are for administrators only.
  assert.equal((await mod.api('POST', '/tools/give', { characterId: p.session.characterId, gold: 100 })).status, 403);
  const gold = server.ctx.inventory.gold(p.session.characterId);
  assert.equal((await boss2.api('POST', '/tools/give', { characterId: p.session.characterId, kind: 'item', id: 1, quantity: 3, gold: 100 })).status, 200);
  assert.equal(server.ctx.inventory.gold(p.session.characterId), gold + 100);
  assert.equal(server.ctx.inventory.quantity(p.session.characterId, 'item', 1), 3);
  assert.equal((await boss2.api('POST', '/tools/progress', { characterId: p.session.characterId, switchId: 7, switchValue: true, variableId: 3, variableValue: 42 })).status, 200);
  assert.equal(world.getSwitch(p.session, 7), true);
  assert.equal(world.getVariable(p.session, 3), 42);
  assert.equal((await boss2.api('POST', '/tools/teleport', { characterId: p.session.characterId, mapId: 2, x: 14, y: 27 })).status, 200);
  assert.equal(p.session.mapId, 2);
  assert.equal((await boss2.api('POST', '/tools/teleport', { characterId: 'self', toCharacterId: p.session.characterId })).status, 200);
  assert.equal(me.session.mapId, 2);
  // Joining a player inside a dungeon copy: the administrator arrives in that very copy.
  assert.equal((await boss2.api('POST', '/tools/teleport', { characterId: p.session.characterId, mapId: DEMO_MAPS.dungeon, x: 12, y: 19 })).status, 200);
  assert.ok(p.session.instance > 0);
  assert.equal((await boss2.api('POST', '/tools/teleport', { characterId: 'self', toCharacterId: p.session.characterId })).status, 200);
  assert.deepEqual([me.session.mapId, me.session.instance], [DEMO_MAPS.dungeon, p.session.instance]);
  assert.equal((await boss2.api('POST', '/tools/teleport', { characterId: p.session.characterId, mapId: 2, x: 14, y: 27 })).status, 200);
  assert.equal((await boss2.api('POST', '/tools/invisible', { on: true })).status, 200);
  assert.equal(me.session.invisible, true);
  assert.equal((await boss2.api('POST', '/tools/announce', { text: 'Maintenance à 22 h' })).status, 200);
  await until(() => p.chat.some((m) => m.key === 'notify.announce'));

  // Shop sales are logged.
  server.ctx.admin.logSale(p.session.characterId, 'sell', 'item', 1, 1, 15);
  const sales = await mod.api<{ lines: unknown[] }>('GET', `/logs/sales?account=${user.id}`);
  assert.equal(sales.body.lines.length, 1);

  // Backup: a SQLite file; restore refuses anything else.
  assert.equal((await mod.api('GET', '/backup')).status, 403);
  const backup = await boss2.api<ArrayBuffer>('GET', '/backup');
  assert.equal(backup.status, 200);
  assert.equal(Buffer.from(backup.body).subarray(0, 15).toString('latin1'), 'SQLite format 3');
  const junk = await boss2.client.request('/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': await boss2.client.csrf('/characters') }, body: 'not a database' });
  assert.equal(junk.status, 400);

  // Daily automatic backups: the hour and the days kept are set by administrators.
  assert.equal((await mod.api('GET', '/backups')).status, 403);
  assert.equal((await mod.api('POST', '/backups/schedule', { hour: 2, keep: 7 })).status, 403);
  const auto = await boss2.api<{ schedule: { hour: number; keep: number }; backups: unknown[] }>('GET', '/backups');
  assert.deepEqual(auto.body.schedule, { hour: 4, keep: 31 }, 'every day at 4, 31 days kept by default');
  assert.equal((await boss2.api('POST', '/backups/schedule', { hour: 2, keep: 30 })).status, 400, 'only 1, 7, 14 or 31 days');
  assert.equal((await boss2.api('POST', '/backups/schedule', { hour: 24, keep: 7 })).status, 400);
  assert.equal((await boss2.api('POST', '/backups/schedule', { hour: 2, keep: 7 })).status, 200);
  assert.deepEqual((await boss2.api<{ schedule: unknown }>('GET', '/backups')).body.schedule, { hour: 2, keep: 7 });
  p.socket.close();
  me.socket.close();
});

test('a downloaded backup holds no session and no server secret', async () => {
  const keeper = await account('Keeper');
  server.ctx.accounts.setRole(keeper.id, 'admin');
  const secret = server.ctx.settings.secret('device');
  // The session id of the administrator downloading the backup (cookie "s:<id>.<signature>").
  const sid = /^s:([^.]+)\./.exec(decodeURIComponent(keeper.client.cookies.get('brindiwanko.sid')!))![1]!;
  const backup = await keeper.api<ArrayBuffer>('GET', '/backup');
  assert.equal(backup.status, 200);
  const bytes = Buffer.from(backup.body);
  assert.equal(bytes.includes(secret), false, 'no server secret in the file');
  assert.equal(bytes.includes(sid), false, 'no session id in the file');
  const file = join(tmpdir(), `brindiwanko-backup-test-${Date.now()}.db`);
  writeFileSync(file, bytes);
  const copy = new Database(file, { readonly: true });
  try {
    assert.equal(copy.prepare('SELECT COUNT(*) FROM sessions').pluck().get(), 0);
    assert.equal(copy.prepare('SELECT COUNT(*) FROM server_secrets').pluck().get(), 0);
    assert.ok((copy.prepare('SELECT COUNT(*) FROM accounts').pluck().get() as number) > 0, 'the game data is all there');
  } finally {
    copy.close();
    rmSync(file, { force: true });
  }
  assert.ok((server.ctx.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get() as number) > 0, 'the live database is untouched');
});

test('the server owner keeps its role and password whatever another administrator does', async () => {
  // The owner is the first account of the server (Founder when this test runs alone).
  const founder = await account('Founder');
  const other = await account('Usurper');
  const deputy = await account('Deputy');
  for (const a of [founder, other, deputy]) server.ctx.accounts.setRole(a.id, 'admin');
  const ownerId = server.ctx.accounts.ownerId();
  assert.ok(ownerId <= founder.id);
  server.ctx.accounts.setRole(ownerId, 'admin');
  const demote = await other.api<{ error: string }>('POST', `/accounts/${ownerId}/role`, { role: 'player' });
  assert.equal(demote.status, 403);
  assert.equal(demote.body.error, 'error.admin.owner');
  assert.equal((await other.api('POST', `/accounts/${ownerId}/reset-password`)).status, 403);
  assert.equal(server.ctx.accounts.findById(ownerId)!.role, 'admin');
  // The other administrators still manage each other.
  assert.equal((await other.api('POST', `/accounts/${deputy.id}/role`, { role: 'moderator' })).status, 200);
});

test('closing a server stops every repeating timer it started, the lag monitor of the dashboard included', async () => {
  const started = new Set<NodeJS.Timeout>();
  const { setInterval: set, clearInterval: clear } = globalThis;
  globalThis.setInterval = ((...args: Parameters<typeof set>) => {
    const timer = set(...args);
    started.add(timer);
    return timer;
  }) as typeof set;
  globalThis.clearInterval = ((timer: NodeJS.Timeout) => {
    started.delete(timer);
    clear(timer);
  }) as typeof clear;
  try {
    const other = await startTestServer();
    assert.ok(started.size > 0);
    await other.close();
  } finally {
    globalThis.setInterval = set;
    globalThis.clearInterval = clear;
  }
  assert.equal(started.size, 0, 'no timer left running after close');
});

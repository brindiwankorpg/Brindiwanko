/**
 * @file Regression tests of the final audit (October 2026): a session replaced by a new connection,
 * a player leaving while knocked out, event commands that knock out, item effects other than HP and
 * MP, whispers to names with spaces, the ignore list hiding one's presence, the marked zones of
 * a boss, and the administration rules (rank, hidden e-mail addresses, database import, items deleted
 * anyway taken from their owners).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { Cmd } from '../shared/events.js';
import { sanitizeEmblem } from '../shared/guild.js';
import type { ChatMessage, FriendsPayload } from '../shared/social.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
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

interface Player {
  client: TestClient;
  socket: ClientSocket;
  session: PlayerSession;
  payload: EnterWorldPayload;
  chat: ChatMessage[];
  notes: string[];
  friends: FriendsPayload | null;
}

/** Registers an account, creates a character and selects it. */
async function account(username: string, characterName = username): Promise<{ client: TestClient; id: number }> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username, email: `${username.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: characterName, classId: '1' });
  const id = server.ctx.social.findByName(characterName)!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  return { client, id };
}

/** Opens a game connection for the character selected by a client. */
async function enter(client: TestClient): Promise<Player> {
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { client, socket, chat: [], notes: [], friends: null } as unknown as Player;
  socket.on('chat', (m) => player.chat.push(m));
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('friends', (f) => (player.friends = f));
  player.payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(player.payload.character.id)!;
  return player;
}

async function newPlayer(username: string, characterName = username): Promise<Player> {
  return enter((await account(username, characterName)).client);
}

/** Hurts a player through the combat rules (death included). */
function hurt(p: PlayerSession, amount: number): void {
  type Internals = { applyVitals(target: unknown, kind: string, amount: number, source: unknown): void };
  (server.ctx.world.combat as unknown as Internals).applyVitals({ kind: 'player', p }, 'hp_damage', amount, null);
}

test('a new connection replacing the session of the same character goes on from its current state', async () => {
  const a = await newPlayer('Twin');
  const p = a.session;
  // Changed since the last save: a step and lost HP.
  p.x += 1;
  p.hp = 7;
  const b = await enter(a.client);
  assert.equal(b.payload.character.x, p.x, 'no step back to the last autosave');
  assert.equal(b.payload.character.hp, 7, 'the HP lost are not given back');
  b.socket.close();
});

test('a player leaving while knocked out comes back at its respawn point, still down for the time left, then with full HP', async () => {
  const a = await newPlayer('Fallen');
  const p = a.session;
  const start = server.ctx.world.startPosition(p.classId);
  server.ctx.progression.setRespawn(p.characterId, start.mapId, start.x + 1, start.y);
  p.x = start.x + 3;
  hurt(p, 9999);
  assert.equal(p.combat.dead, true);
  a.socket.close();
  await until(() => !server.ctx.world.player(p.characterId));
  const b = await enter(a.client);
  assert.deepEqual([b.payload.character.mapId, b.payload.character.x, b.payload.character.y], [start.mapId, start.x + 1, start.y], 'at the respawn point, not where it fell');
  // Reloading the page does not skip the knockout delay...
  assert.equal(b.session.combat.dead, true, 'still knocked out');
  // ...which ends as usual, with full HP.
  await until(() => !b.session.combat.dead, 10_000);
  assert.ok(b.session.hp > 0);
  b.socket.close();
});

test('a key item cannot be stored in the personal bank (events only look at the bag)', async () => {
  const a = await newPlayer('Locksmith');
  const p = a.session;
  server.ctx.world.changeItems(p, 'item', 6, 1);
  p.ui = { kind: 'bank' };
  server.ctx.world.sheet.bankMove(p, 'item', 6, 1, true);
  assert.equal(server.ctx.inventory.quantity(p.characterId, 'item', 6), 1, 'still in the bag');
  await until(() => a.notes.includes('error.item.cannot_bank'));
  p.ui = null;
  a.socket.close();
});

test('reloading the page in a fight keeps the cooldowns and states, and no arrival protection is given', async () => {
  const a = await newPlayer('Reloader');
  const p = a.session;
  const now = Date.now();
  p.combat.cooldowns.set(1, now + 60_000);
  p.combat.states.set(1, now + 60_000);
  p.combat.lastHurt = now;
  a.socket.close();
  await until(() => !server.ctx.world.player(p.characterId));
  const b = await enter(a.client);
  assert.ok((b.session.combat.cooldowns.get(1) ?? 0) > Date.now(), 'cooldown kept');
  assert.ok(b.session.combat.states.has(1), 'state kept');
  assert.ok(b.session.combat.protectedUntil <= Date.now(), 'no protection: the monsters keep chasing');
  b.socket.close();
});

test('the event command "Change HP" allowing a knockout knocks the player out', async () => {
  const a = await newPlayer('Trapped');
  const died = new Promise<number>((resolve) => a.socket.on('playerDied', (d) => resolve(d.seconds)));
  await server.ctx.world.runner.runCommonList(a.session, [
    { code: Cmd.ChangeHp, indent: 0, parameters: [0, 0, 1, 0, 99999, true] },
    { code: 0, indent: 0, parameters: [] },
  ]);
  assert.equal(a.session.hp, 0);
  assert.equal(a.session.combat.dead, true, 'knocked out, it will reappear');
  assert.ok((await died) > 0);
  // Without the knockout allowed, the player keeps 1 HP.
  const b = await newPlayer('Scratched');
  await server.ctx.world.runner.runCommonList(b.session, [
    { code: Cmd.ChangeHp, indent: 0, parameters: [0, 0, 1, 0, 99999, false] },
    { code: 0, indent: 0, parameters: [] },
  ]);
  assert.equal(b.session.hp, 1);
  assert.equal(b.session.combat.dead, false);
  for (const p of [a, b]) p.socket.close();
});

test('an item used from the bag applies all its effects: the medicinal herb cures poison', async () => {
  const a = await newPlayer('Herbalist');
  const world = server.ctx.world;
  const herb = server.ctx.gameData.list('item').find((i) => i.effects.some((e) => e.kind === 'remove_state'))!;
  const poison = herb.effects.find((e) => e.kind === 'remove_state')!.value;
  world.changeItems(a.session, 'item', herb.id, 2);
  // Not poisoned: the herb would do nothing, it is kept.
  world.useItem(a.session, herb.id);
  assert.equal(server.ctx.inventory.quantity(a.session.characterId, 'item', herb.id), 2);
  await until(() => a.notes.includes('error.item.no_effect'));
  a.session.combat.states.set(poison, Date.now() + 60_000);
  world.useItem(a.session, herb.id);
  assert.equal(a.session.combat.states.has(poison), false, 'the poison is cured');
  assert.equal(server.ctx.inventory.quantity(a.session.characterId, 'item', herb.id), 1, 'one herb used');
  a.socket.close();
});

test('whispers reach players whose name contains spaces', async () => {
  const jean = await newPlayer('JeanP', 'Jean Pierre');
  const tom = await newPlayer('Whisperer');
  tom.socket.emit('chat', '/w Jean Pierre salut toi', 'map');
  await until(() => jean.chat.some((m) => m.channel === 'private'));
  const message = jean.chat.find((m) => m.channel === 'private')!;
  assert.equal(message.text, 'salut toi');
  assert.equal(message.from?.name, 'Whisperer');
  for (const p of [jean, tom]) p.socket.close();
});

test('a player who ignores another one appears offline in its friends list', async () => {
  const fan = await newPlayer('Fan');
  const star = await newPlayer('Star');
  fan.socket.emit('friendAdd', 'Star');
  await until(() => fan.friends?.friends.some((f) => f.name === 'Star' && f.online) ?? false);
  star.socket.emit('ignore', 'Fan');
  await until(() => fan.friends?.friends.some((f) => f.name === 'Star' && !f.online && f.location === '') ?? false);
  // Coming back later is not told either.
  fan.notes.length = 0;
  star.socket.close();
  await until(() => !server.ctx.world.player(star.session.characterId));
  const again = await enter(star.client);
  await wait(100);
  assert.ok(!fan.notes.includes('notify.friend_online'));
  for (const p of [fan, again]) p.socket.close();
});

test('the marked zones of a boss spare players still loading the map and invisible ones', async () => {
  const [loading, hidden, fighter] = [await newPlayer('Loading'), await newPlayer('Hidden'), await newPlayer('Fighter')];
  const world = server.ctx.world;
  const start = world.startPosition();
  for (const p of [loading, hidden, fighter]) {
    p.session.x = start.x;
    p.session.y = start.y;
    p.session.combat.protectedUntil = 0;
  }
  loading.session.combat.protectedUntil = Date.now() + 60_000;
  world.setInvisible(hidden.session, true);
  type Internals = { mapCombat(mapId: number, instance: number): unknown; strike(mc: unknown, x: number, y: number, radius: number, damage: number): void };
  const combat = world.combat as unknown as Internals;
  const hp = [loading, hidden, fighter].map((p) => p.session.hp);
  combat.strike(combat.mapCombat(start.mapId, 0), start.x, start.y, 2, 5);
  await wait(1700);
  assert.equal(loading.session.hp, hp[0], 'still loading: untouched');
  assert.equal(hidden.session.hp, hp[1], 'invisible: untouched');
  assert.equal(fighter.session.hp, hp[2]! - 5, 'the others are hit');
  world.setInvisible(hidden.session, false);
  for (const p of [loading, hidden, fighter]) p.socket.close();
});

/** JSON API of the panel or of the editor, as a logged-in account. */
function apiOf(client: TestClient) {
  let csrf = '';
  return async <T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    csrf ||= await client.csrf('/characters');
    const res = await client.request(path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };
}

test('administration: moderators keep to their rank and do not search the e-mail addresses they cannot see', async () => {
  const chief = await account('Chief');
  const warden = await account('Warden');
  const pawn = await account('Pawn');
  const admin = server.ctx.admin;
  admin.setRole(server.ctx.accounts.findByUsername('Chief')!.id, 'admin');
  admin.setRole(server.ctx.accounts.findByUsername('Warden')!.id, 'moderator');
  const asChief = apiOf(chief.client);
  const asWarden = apiOf(warden.client);
  type Found = { accounts: { username: string; email: string }[] };
  const names = (r: { body: Found }) => r.body.accounts.map((a) => a.username);
  assert.deepEqual(names(await asWarden<Found>('GET', '/api/admin/accounts?q=chief%40exa')), [], 'no search in hidden addresses');
  assert.deepEqual(names(await asWarden<Found>('GET', '/api/admin/accounts?q=Chief')), ['Chief'], 'names are searched');
  assert.deepEqual(names(await asChief<Found>('GET', '/api/admin/accounts?q=chief%40exa')), ['Chief'], 'administrators search the addresses');
  // Sending a character back to the start follows the rank rule.
  assert.equal((await asWarden('POST', `/api/admin/characters/${chief.id}/reset-position`, {})).status, 403);
  assert.equal((await asWarden('POST', `/api/admin/characters/${pawn.id}/reset-position`, {})).status, 200);
  assert.equal((await asWarden('POST', `/api/admin/characters/${warden.id}/reset-position`, {})).status, 200, 'its own character');
});

test('a database import may not take away a class that characters still play', async () => {
  const keeper = await account('Keeper');
  server.ctx.admin.setRole(server.ctx.accounts.findByUsername('Keeper')!.id, 'admin');
  const api = apiOf(keeper.client);
  const exported = await api<{ version: number; database: Record<string, { id: number }[]>; system: unknown }>('GET', '/api/editor/db-export');
  const played = server.ctx.characters.findById(keeper.id)!.classId;
  const without = { ...exported.body, database: { ...exported.body.database, class: exported.body.database.class!.filter((c) => c.id !== played) } };
  const refused = await api<{ error: string }>('POST', '/api/editor/db-import', without);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'error.db.import_class_in_use');
  assert.ok(server.ctx.gameData.get('class', played), 'nothing was replaced');
  assert.equal((await api('POST', '/api/editor/db-import', exported.body)).status, 200, 'the full export still imports');
});

test('an item deleted anyway is also taken from the bags, banks, equipment and guild banks of its owners', async () => {
  const hoarder = await account('Hoarder');
  server.ctx.admin.setRole(server.ctx.accounts.findByUsername('Hoarder')!.id, 'admin');
  const api = apiOf(hoarder.client);
  const item = (await api<{ record: { id: number } }>('POST', '/api/editor/db/item', {})).body.record.id;
  const weapon = (await api<{ record: { id: number } }>('POST', '/api/editor/db/weapon', {})).body.record.id;
  const db = server.ctx.db;
  server.ctx.inventory.add(hoarder.id, 'item', item, 2, 99);
  server.ctx.inventory.add(hoarder.id, 'item', 1, 1, 99);
  server.ctx.inventory.addToBank(hoarder.id, 'item', item, 3);
  db.prepare('INSERT INTO character_equipment (character_id, slot, item_kind, item_id) VALUES (?, ?, ?, ?)').run(hoarder.id, 'weapon', 'weapon', weapon);
  const created = server.ctx.guilds.create(hoarder.id, 'Hoard', 'HRD', sanitizeEmblem({}), 0);
  assert.ok(created.ok);
  db.prepare('INSERT INTO guild_bank_items (guild_id, item_kind, item_id, quantity) VALUES (?, ?, ?, ?)').run(created.guild.id, 'item', item, 4);
  const owned = (kind: string, id: number) =>
    ['character_items', 'character_bank', 'character_equipment', 'guild_bank_items'].map((table) => db.prepare<[string, number], number>(`SELECT COUNT(*) FROM ${table} WHERE item_kind = ? AND item_id = ?`).pluck().get(kind, id));

  const asked = await api<{ error: string }>('DELETE', `/api/editor/db/item/${item}`);
  assert.equal(asked.status, 409, 'still owned: the editor asks first');
  assert.deepEqual(owned('item', item), [1, 1, 0, 1], 'nothing removed before the confirmation');
  assert.equal((await api('DELETE', `/api/editor/db/item/${item}?force=1`)).status, 200);
  assert.deepEqual(owned('item', item), [0, 0, 0, 0], 'no hidden copy left to take room in a bag');
  assert.equal(server.ctx.inventory.quantity(hoarder.id, 'item', 1), 1, 'other items stay');
  assert.equal((await api('DELETE', `/api/editor/db/weapon/${weapon}?force=1`)).status, 200);
  assert.deepEqual(owned('weapon', weapon), [0, 0, 0, 0], 'the equipped weapon too');
});

test('adding oneself as a friend (or ignoring oneself) says so, instead of "no such character"', async () => {
  const me = await newPlayer('Narcissus');
  me.socket.emit('friendAdd', 'narcissus');
  me.socket.emit('ignore', 'Narcissus');
  await until(() => me.chat.filter((m) => m.key === 'error.social.self').length === 2);
  assert.ok(!me.chat.some((m) => m.key === 'error.social.unknown_player'));
  me.socket.close();
});

test('whisper commands without a name, without a text or without anybody to answer explain how to use them', async () => {
  const lone = await newPlayer('Lonely');
  for (const line of ['/w', '/w Lonely', '/r salut']) lone.socket.emit('chat', line, 'map');
  await until(() => lone.chat.filter((m) => m.key === 'error.chat.usage.w').length === 2 && lone.chat.some((m) => m.key === 'error.chat.no_reply'));
  assert.ok(!lone.chat.some((m) => m.key === 'error.chat.offline'));
  lone.socket.close();
});

test('pages and API answers that depend on the visitor are never cached; static files are', async () => {
  const { client } = await account('Cachey');
  for (const path of ['/characters', '/game', '/login', '/api/resources']) {
    const res = await client.request(path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
  }
  const statics = await client.request('/locales/fr.json');
  assert.notEqual(statics.headers.get('cache-control'), 'no-store');
});

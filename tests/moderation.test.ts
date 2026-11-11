/**
 * @file Chat moderation and game sessions: the staff commands (`/kick`,
 * `/mute`, `/unmute`, `/ban`, `/unban`) follow the rules of the
 * administration panel, players cannot use them nor the world channel, and an
 * account plays one character at a time.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChatMessage } from '../shared/social.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { parseDuration } from '../server/game/moderation-commands.js';
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
  characterId: number;
  accountId: number;
  chat: ChatMessage[];
  notes: string[];
  errors: { key: string; params?: Record<string, string | number> }[];
  disconnected: boolean;
}

/** Registers an account (with the given role) and creates its first character. */
async function newAccount(username: string, role: 'player' | 'moderator' | 'admin' = 'player'): Promise<TestClient> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username, email: `${username.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  const accountId = server.ctx.accounts.findByUsername(username)!.id;
  server.ctx.admin.setRole(accountId, role);
  return client;
}

/** Creates a character on the account of a client. */
async function newCharacter(client: TestClient, name: string): Promise<number> {
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const character = server.ctx.social.findByName(name);
  assert.ok(character, `character ${name} created`);
  return character.id;
}

/** Selects a character and enters the game with it. */
async function play(client: TestClient, characterId: number): Promise<Player> {
  await client.post(`/characters/${characterId}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { client, socket, characterId, chat: [], notes: [], errors: [], disconnected: false } as unknown as Player;
  socket.on('chat', (m) => player.chat.push(m));
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('errorMessage', (e) => player.errors.push(e));
  socket.on('disconnect', () => (player.disconnected = true));
  await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.accountId = server.ctx.characters.findById(characterId)!.accountId;
  return player;
}

const keys = (p: Player) => p.chat.map((m) => m.key ?? '');
/** Types a chat line, letting the anti-flood bucket refill between lines. */
async function type(p: Player, line: string): Promise<void> {
  const session = server.ctx.world.player(p.characterId);
  if (session) session.social.tokens = 5;
  p.socket.emit('chat', line, 'map');
  await wait(30);
}

test('durations of the staff commands', () => {
  assert.equal(parseDuration('30'), 30);
  assert.equal(parseDuration('30m'), 30);
  assert.equal(parseDuration('2h'), 120);
  assert.equal(parseDuration('7j'), 7 * 24 * 60);
  assert.equal(parseDuration('3D'), 3 * 24 * 60);
  assert.equal(parseDuration('perm'), 'permanent');
  assert.equal(parseDuration('spam'), null);
});

test('staff chat commands: kick, mute, ban with the rules of the panel; players cannot use them', async () => {
  // The first account is the server owner (administrator).
  await newAccount('Owner', 'admin');
  const ownerClient = await newAccount('Boss', 'admin');
  const boss = await play(ownerClient, await newCharacter(ownerClient, 'Boss'));
  const modClient = await newAccount('Modo', 'moderator');
  const modo = await play(modClient, await newCharacter(modClient, 'Modo'));
  const evaClient = await newAccount('Eva');
  const eva = await play(evaClient, await newCharacter(evaClient, 'Jean Pierre'));
  const tomClient = await newAccount('Tom');
  const tom = await play(tomClient, await newCharacter(tomClient, 'Tom'));
  const admin = server.ctx.admin;

  // A player: no moderation at all, `/kick` included; `/pkick` removes a party member.
  await type(tom, '/mute Jean Pierre 10m');
  await until(() => keys(tom).includes('error.chat.staff_only'));
  await type(tom, '/kick Jean Pierre');
  await until(() => keys(tom).filter((k) => k === 'error.chat.staff_only').length === 2);
  assert.equal(eva.disconnected, false, 'a player cannot disconnect another one');
  await type(tom, '/pkick Jean Pierre');
  await until(() => keys(tom).includes('error.chat.no_party'));
  assert.equal(admin.muteInfo(eva.accountId), null);

  // Mute (a name with a space, a duration, a reason), then unmute.
  await type(modo, '/mute Jean Pierre 2h insultes répétées');
  await until(() => eva.notes.includes('notify.muted'));
  assert.ok(keys(modo).includes('notify.mod.muted'));
  assert.equal(admin.muteInfo(eva.accountId)?.reason, 'insultes répétées');
  await type(eva, 'je parle quand même');
  await until(() => keys(eva).includes('error.chat.muted_reason'));
  assert.ok(!tom.chat.some((m) => m.text === 'je parle quand même'), 'a muted player is not heard');
  await type(modo, '/unmute jean pierre');
  await until(() => keys(modo).includes('notify.mod.unmuted'));
  assert.equal(admin.muteInfo(eva.accountId), null);

  // Rank: a moderator cannot touch an administrator, nor ban for good or longer than a week.
  await type(modo, '/kick Boss');
  await until(() => keys(modo).includes('error.admin.rank'));
  await type(modo, '/ban Tom perm');
  await until(() => keys(modo).includes('error.admin.ban_too_long'));
  await type(modo, '/ban Tom 30j');
  await until(() => keys(modo).filter((k) => k === 'error.admin.ban_too_long').length === 2);
  assert.equal(admin.account(tom.accountId)!.bannedUntil, null);
  await type(modo, '/mute');
  await until(() => keys(modo).includes('error.chat.usage.mute'));
  await type(modo, '/ban Personne 1h');
  await until(() => keys(modo).includes('error.social.unknown_player'));

  // Kick with a reason: the player is told why and disconnected.
  await type(modo, '/kick Tom calme-toi un peu');
  await until(() => tom.disconnected);
  assert.deepEqual(tom.errors.at(-1), { key: 'error.net.kicked_reason', params: { reason: 'calme-toi un peu' } });
  assert.ok(keys(modo).includes('notify.mod.kicked'));

  // Ban (offline target too), then unban; the administrator bans for good.
  await type(modo, '/ban Tom 2h triche');
  await until(() => keys(modo).includes('notify.mod.banned'));
  assert.equal(admin.account(tom.accountId)!.banReason, 'triche');
  await type(modo, '/unban Tom');
  await until(() => keys(modo).includes('notify.mod.unbanned'));
  assert.equal(admin.account(tom.accountId)!.bannedUntil, null);
  await type(boss, '/ban Jean Pierre perm');
  await until(() => eva.disconnected);
  assert.equal(eva.errors.at(-1)?.key, 'error.auth.banned_forever');
  assert.ok(keys(boss).includes('notify.mod.banned_forever'));

  // Everything is in the administrator log, like the panel actions.
  const actions = admin.logs('admin', 0, 200).filter((l) => l.admin === 'Modo').map((l) => l.action);
  for (const action of ['mute', 'unmute', 'kick', 'ban', 'unban']) assert.ok(actions.includes(action), action);
  // The staff sees the moderation help; players only the usual one.
  await type(modo, '/help');
  await until(() => keys(modo).includes('notify.chat_help_staff'));
  for (const p of [boss, modo]) p.socket.close();
});

test('an account plays one character at a time: a new character replaces the one in the game', async () => {
  const client = await newAccount('Multi');
  const first = await newCharacter(client, 'Premier');
  const second = await newCharacter(client, 'Second');
  const a = await play(client, first);
  const b = await play(client, second);
  await until(() => a.disconnected);
  assert.deepEqual(a.errors.at(-1), { key: 'error.net.other_character', params: { name: 'Second' } });
  assert.equal(server.ctx.world.player(first), undefined, 'the first character left the world');
  assert.ok(server.ctx.world.player(second), 'the second one is in the game');
  assert.equal(b.disconnected, false);
  // Other accounts are not affected.
  const other = await newAccount('Autre');
  const c = await play(other, await newCharacter(other, 'Autre'));
  await wait(100);
  assert.equal(b.disconnected, false);
  for (const p of [b, c]) p.socket.close();
});

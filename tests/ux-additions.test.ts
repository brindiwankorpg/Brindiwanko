/**
 * @file Server side of the clearer screens: the directory of guilds, the facts of the character
 * selection page (place, gold, time played) and the class profiles of the creation page.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { GUILD_DIRECTORY_PAGE, type GuildDirectoryPage } from '../shared/guild.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { withProfiles } from '../server/game/character-routes.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

async function player(name: string): Promise<{ client: TestClient; socket: ClientSocket; characterId: number }> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const accountId = server.ctx.accounts.findByUsername(name)!.id;
  const characterId = server.ctx.characters.listByAccount(accountId)[0]!.id;
  await client.post(`/characters/${characterId}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { client, socket, characterId };
}

test('players without a guild get the directory of the guilds, with their leader', async () => {
  const founder = await player('Founder');
  const seeker = await player('Seeker');
  const ask = (search = '', page = 0) => new Promise<GuildDirectoryPage>((resolve) => seeker.socket.emit('guildDirectory', { search, page }, resolve));
  assert.deepEqual((await ask()).guilds, []);
  server.ctx.inventory.changeGold(founder.characterId, 5000);
  const created = server.ctx.guilds.create(founder.characterId, 'La Flamme Éternelle', 'FLAM', { shape: 0, pattern: 1, primary: 4, secondary: 2, symbol: 0, symbolColor: 7 }, 1000);
  assert.ok(created.ok);
  const list = await ask();
  assert.equal(list.total, 1);
  assert.deepEqual([list.guilds[0]!.name, list.guilds[0]!.tag, list.guilds[0]!.members, list.guilds[0]!.leader], ['La Flamme Éternelle', 'FLAM', 1, 'Founder']);
  // The search ignores case and accents, in names and tags.
  assert.equal((await ask('eternelle')).total, 1);
  assert.equal((await ask('flam')).total, 1);
  assert.equal((await ask('nothing like it')).total, 0);
  founder.socket.close();
  seeker.socket.close();
});

test('the directory of guilds is sent one page at a time, however many guilds there are', () => {
  const db = server.ctx.db;
  const insert = db.prepare("INSERT INTO guilds (name, tag, emblem, name_key, tag_key) VALUES (?, ?, '{}', ?, ?)");
  db.transaction(() => {
    for (let i = 0; i < 500; i++) insert.run(`Guilde ${String(i).padStart(3, '0')}`, `G${i}`, `guilde ${i}`, `g${i}`);
  })();
  const first = server.ctx.guilds.directory('', 0);
  assert.equal(first.guilds.length, GUILD_DIRECTORY_PAGE);
  assert.ok(first.total >= 500);
  const lastPage = Math.ceil(first.total / GUILD_DIRECTORY_PAGE) - 1;
  // A page past the end gives the last one.
  const last = server.ctx.guilds.directory('', 100_000);
  assert.equal(last.page, lastPage);
  assert.ok(last.guilds.length > 0 && last.guilds.length <= GUILD_DIRECTORY_PAGE);
  // Every guild can be found by its name, not only the first ones.
  const found = server.ctx.guilds.directory('guilde 499', 0);
  assert.deepEqual(found.guilds.map((g) => g.name), ['Guilde 499']);
});

test('the character selection page tells where each character is, its gold and its time played', async () => {
  const { client, socket, characterId } = await player('Roamer');
  socket.close();
  await new Promise((r) => setTimeout(r, 100));
  server.ctx.inventory.changeGold(characterId, 321 - server.ctx.inventory.gold(characterId));
  const html = await (await client.request('/characters')).text();
  const character = server.ctx.characters.findById(characterId)!;
  const mapName = server.ctx.maps.peek(character.mapId)!.displayName;
  assert.ok(html.includes(mapName), 'the map where the character stands');
  assert.match(html, /321 /, 'its gold');
  assert.match(html, /data-server-time="\d{4}-\d{2}-\d{2} /, 'its last game, converted to local time by the page');
});

test('class profiles compare the classes: the warrior attacks, the mage casts', () => {
  const classes = withProfiles(server.ctx.gameData.list('class'));
  for (const c of classes) for (const k of ['attack', 'magic', 'survival'] as const) assert.ok(c.profile[k] > 0 && c.profile[k] <= 1, `${c.name} ${k}`);
  const warrior = classes.find((c) => c.id === 1)!;
  const mage = classes.find((c) => c.id === 2)!;
  assert.ok(warrior.profile.attack > mage.profile.attack);
  assert.ok(mage.profile.magic > warrior.profile.magic);
  assert.equal(mage.profile.role, 'magic');
});

/**
 * @file Character tests: name rules, creation limits, deletion confirmation,
 * ownership checks, and entering the world through the socket.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect } from 'socket.io-client';
import { validateCharacterName } from '../shared/characters.js';
import { mixesScripts, nameKey } from '../shared/names.js';
import type { EnterWorldPayload } from '../shared/protocol.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

async function registered(username: string): Promise<TestClient> {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username,
    email: `${username.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  return client;
}

async function createCharacter(client: TestClient, name: string, classId = '1', extra: Record<string, string> = {}) {
  return client.post('/characters', {
    _csrf: await client.csrf('/characters/new'),
    name,
    classId,
    body: 'female',
    skin: '2',
    hair: 'long',
    hairColor: '3',
    outfitColor: '1',
    ...extra,
  });
}

test('character names follow the shared rules', () => {
  for (const ok of ['Aria', 'Élodie', 'Jean-Luc', "O'Neil", 'Kai 2', 'Ælfred', 'Влад', 'Νίκη']) assert.equal(validateCharacterName(ok), null, ok);
  for (const bad of ['Al', '1Bob', 'Bob  Two', 'A'.repeat(17), 'Bad<Name>', ' Lead']) {
    assert.equal(validateCharacterName(bad), 'error.character.name_invalid', bad);
  }
  // Latin, Cyrillic and Greek letters can look alike: a name uses one of these alphabets only.
  assert.equal(validateCharacterName('Аdmin'), 'error.character.name_mixed_scripts', 'Cyrillic А in a Latin name');
  assert.equal(validateCharacterName('Bοb'), 'error.character.name_mixed_scripts', 'Greek ο in a Latin name');
});

test('names that look the same are the same name', () => {
  assert.equal(nameKey('Élodie'), nameKey('éLODIE'), 'case is ignored in every alphabet');
  assert.equal(nameKey('ＢＯＢ'), nameKey('bob'), 'full-width letters are plain letters');
  assert.equal(nameKey('АВС'), nameKey('abc'), 'Cyrillic letters drawn like Latin ones');
  assert.notEqual(nameKey('Élodie'), nameKey('Elodie'), 'accents still count');
  assert.equal(mixesScripts('Аdmin'), true);
  assert.equal(mixesScripts('Ærøskøbing'), false);
});

test('default classes are seeded', () => {
  const classes = server.ctx.gameData.list('class');
  assert.deepEqual(classes.map((c) => c.outfit), ['warrior', 'mage', 'archer', 'priest']);
  assert.ok(server.ctx.gameData.list('tileset').length >= 3, 'default tilesets are seeded');
});

test('a player creates a character with the class outfit imposed and full HP', async () => {
  const client = await registered('Creator');
  const res = await createCharacter(client, 'Lyra', '2', { outfit: 'guard' } as Record<string, string>);
  assert.equal(res.status, 303);
  const account = server.ctx.accounts.findByUsername('Creator')!;
  const [lyra] = server.ctx.characters.listByAccount(account.id);
  assert.equal(lyra?.name, 'Lyra');
  assert.equal(lyra?.appearance.outfit, 'mage', 'outfit comes from the class, not from the form');
  assert.equal(lyra?.appearance.body, 'female');
  assert.equal(lyra?.hp, 70);
  const start = server.ctx.settings.get('startPosition', { mapId: 0, x: 0, y: 0 });
  assert.deepEqual([lyra?.mapId, lyra?.x, lyra?.y], [start.mapId, start.x, start.y]);
  assert.match(await (await client.request('/characters')).text(), /Lyra/);
});

test('names are unique (case and look-alike letters included) and the per-account limit is enforced', async () => {
  const client = await registered('Collector');
  const dup = await createCharacter(client, 'lyra');
  assert.equal(dup.status, 400);
  assert.match(await dup.text(), /déjà pris|already taken/);
  // SQLite only ignores the case of ASCII letters: the name key covers the others.
  const other = await registered('Lookalike');
  assert.equal((await createCharacter(other, 'Élise')).status, 303);
  const again = await createCharacter(other, 'éLISE');
  assert.equal(again.status, 400, 'same name with other accented capitals');
  assert.match(await again.text(), /déjà pris|already taken/);
  assert.equal((await createCharacter(other, 'Élise')).status, 400, 'same name typed with a separate accent mark');
  assert.equal(server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername('Lookalike')!.id).length, 1);
  const limit = server.ctx.config.maxCharactersPerAccount;
  for (let i = 0; i < limit; i++) assert.equal((await createCharacter(client, `Hero${'abcdefgh'[i]}`)).status, 303);
  const over = await createCharacter(client, 'Toomany');
  assert.equal(over.status, 400);
});

test('deletion requires retyping the name; playing requires ownership', async () => {
  const owner = await registered('Owner');
  await createCharacter(owner, 'Brann');
  const brann = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername('Owner')!.id)[0]!;

  const thief = await registered('Thief');
  const play = await thief.post(`/characters/${brann.id}/play`, { _csrf: await thief.csrf('/characters') });
  assert.equal(play.status, 404);
  const steal = await thief.post(`/characters/${brann.id}/delete`, { _csrf: await thief.csrf('/characters'), confirmName: 'Brann' });
  assert.equal(steal.status, 400);

  const wrong = await owner.post(`/characters/${brann.id}/delete`, { _csrf: await owner.csrf('/characters'), confirmName: 'brann' });
  assert.equal(wrong.status, 400);
  assert.ok(server.ctx.characters.findById(brann.id));
  const ok = await owner.post(`/characters/${brann.id}/delete`, { _csrf: await owner.csrf('/characters'), confirmName: 'Brann' });
  assert.equal(ok.status, 303);
  assert.equal(server.ctx.characters.findById(brann.id), undefined);
});

test('sockets need a session and a selected character; entering sends the character', async () => {
  const anonymous = connect(server.url, { transports: ['websocket'], reconnection: false });
  assert.equal(await new Promise<string>((r) => anonymous.on('connect_error', (e) => r(e.message))), 'error.auth.not_authenticated');
  anonymous.close();

  const client = await registered('Walker');
  const noChar = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  assert.equal(await new Promise<string>((r) => noChar.on('connect_error', (e) => r(e.message))), 'error.character.not_selected');
  noChar.close();

  await createCharacter(client, 'Wanderer', '3');
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername('Walker')!.id)[0]!.id;
  const play = await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  assert.equal(play.headers.get('location'), '/game');
  assert.equal((await client.request('/game')).status, 200);

  const socket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  assert.equal(payload.character.name, 'Wanderer');
  assert.equal(payload.character.className, 'Archer');
  assert.equal(payload.role, 'player');
  socket.close();
});

test('every control of the appearance form has a name screen readers can announce', async () => {
  const client = await registered('Labels');
  const html = await (await client.request('/characters/new')).text();
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  // The hair style list is named by its label.
  const select = /<select\b[^>]*\bname="hair"[^>]*>/.exec(html)?.[0] ?? '';
  const selectId = /\bid="([^"]+)"/.exec(select)?.[1];
  assert.ok(selectId, 'the hair style list has an id');
  assert.match(html, new RegExp(`<label for="${selectId}">[^<]+</label>`));
  // Each group of choices is named by its heading, and each colour by its number.
  for (const name of ['body', 'skin', 'hairColor', 'outfitColor']) {
    const at = html.indexOf(`name="${name}"`);
    const row = html.lastIndexOf('<div class="option-row"', at);
    const group = /aria-labelledby="([^"]+)"/.exec(html.slice(row, html.indexOf('>', row)))?.[1];
    assert.ok(group && ids.has(group), `the ${name} choices are a named group`);
  }
  for (const input of html.matchAll(/<input type="radio" name="(skin|hairColor|outfitColor)"[^>]*>/g)) {
    assert.match(input[0], /aria-label="[^"]+ \d+"/, `${input[1]} colour named`);
  }
});

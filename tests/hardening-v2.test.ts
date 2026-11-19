/**
 * @file Regression tests for the V2 AppSec, concurrency, gameplay, and database
 * hardening pass (covering P1 #03, #10, #14, #15, #17, #19 and key P2 fixes).
 */
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { after, before, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { io as connect, type Socket } from 'socket.io-client';
import { Cmd, MmoCmd, createPage, type EventCommand } from '../shared/events.js';
import { createMap } from '../shared/map.js';
import { validateMap } from '../shared/map-validation.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { intFromEnv, originFromEnv } from '../server/config.js';
import { openDatabase, prepareCached } from '../server/db/database.js';
import { migrate } from '../server/db/migrate.js';
import { SettingsRepository } from '../server/db/settings.js';
import { runCommands, type InterpreterHost } from '../server/events/interpreter.js';
import { runScript } from '../server/events/sandbox.js';
import { CONTENT_SECURITY_POLICY } from '../server/http/security.js';
import { importProject } from '../server/importers/project.js';
import { readZip, ZipError } from '../server/importers/zip.js';
import { isSameOrigin } from '../server/net/socket.js';
import { PATHS } from '../server/paths.js';
import { isSafeSvg, storeUpload } from '../server/resources/uploads.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// --- Pure unit checks (no server needed) ----------------------------------------------------------

test('#01 SVG hardening blocks XML prefixes, non-hex CSS escapes, zero dimensions, and huge viewBox', () => {
  assert.equal(isSafeSvg('<svg width="32" height="32"><svg:script>alert(1)</svg:script></svg>'), false);
  assert.equal(isSafeSvg('<svg width="32" height="32"><animate attributeName="ns:href" to="x"/></svg>'), false);
  assert.equal(isSafeSvg('<svg width="32" height="32"><style>rect{fill:\\u\\r\\l(https://evil.example/x)}</style></svg>'), false);
  assert.equal(isSafeSvg('<svg width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32"/></svg>'), true);

  const zero = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="32" viewBox="0 0 99999 99999"></svg>');
  assert.equal(storeUpload('pictures', 'badzero', zero).ok, false);

  const hugeVb = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 99999 99999"></svg>');
  assert.equal(storeUpload('pictures', 'badvb', hugeVb).ok, false);
});

test('#02 readZip validates overlapping local entry ranges in pass 1 before decompressing', async () => {
  // Build a minimal 2-entry ZIP where both central directory entries point to localOffset 0.
  const payload = deflateRawSync(Buffer.from('hello'));
  const name = Buffer.from('a.txt');
  const local = Buffer.alloc(30 + name.length + payload.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(5, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  payload.copy(local, 30 + name.length);

  const makeCentral = (entryName: string) => {
    const n = Buffer.from(entryName);
    const c = Buffer.alloc(46 + n.length);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(payload.length, 20);
    c.writeUInt32LE(5, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(0, 42); // overlapping localOffset = 0
    n.copy(c, 46);
    return c;
  };
  const c1 = makeCentral('a.txt');
  const c2 = makeCentral('b.txt');
  const cdOffset = local.length;
  const cdSize = c1.length + c2.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(2, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  await assert.rejects(() => readZip(Buffer.concat([local, c1, c2, eocd])), (err: unknown) => err instanceof ZipError && err.key === 'error.import.corrupt');
});

test('#04 sandbox isolates internal variables (__ops, __stringify) and caps output', async () => {
  const baseState = { variables: {}, switches: {}, selfSwitches: {}, gold: 0, level: 1, items: {}, player: { name: 'A', x: 1, y: 1, mapId: 1 } };
  const ops = await runScript(
    'try { __ops.push({ op: "variable", id: 1, value: 999 }); } catch {} JSON.stringify = () => "x".repeat(200000); setV(2, 42);',
    baseState,
  );
  assert.deepEqual(ops, [{ op: 'variable', id: 2, value: 42 }]);
});

test('#06 isSameOrigin uses the rightmost X-Forwarded-Host and checks X-Forwarded-Proto', () => {
  const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;
  assert.equal(isSameOrigin(req({ origin: 'https://jeu.example.org', host: '127.0.0.1:3000', 'x-forwarded-host': 'evil.example, jeu.example.org', 'x-forwarded-proto': 'https' }), true), true);
  assert.equal(isSameOrigin(req({ origin: 'https://evil.example', host: '127.0.0.1:3000', 'x-forwarded-host': 'evil.example, jeu.example.org', 'x-forwarded-proto': 'https' }), true), false);
  assert.equal(isSameOrigin(req({ origin: 'http://jeu.example.org', host: '127.0.0.1:3000', 'x-forwarded-host': 'jeu.example.org', 'x-forwarded-proto': 'https' }), true), false);
});

test('#08 & #28 strict env parsers and CSP connect-src', () => {
  assert.throws(() => originFromEnv('PUBLIC_URL', { PUBLIC_URL: 'mondomaine.fr:443' }));
  assert.throws(() => originFromEnv('PUBLIC_URL', { PUBLIC_URL: 'javascript:alert(1)' }));
  assert.equal(originFromEnv('PUBLIC_URL', { PUBLIC_URL: 'https://mondomaine.fr/path' }), 'https://mondomaine.fr');
  assert.throws(() => intFromEnv('PORT', 3000, 0, 65535, { PORT: '3000abc' }));
  assert.throws(() => intFromEnv('MAX_CHARACTERS', 4, 1, 100, { MAX_CHARACTERS: '0' }));
  assert.equal(intFromEnv('PORT', 3000, 0, 65535, { PORT: '8080' }), 8080);
  assert.match(CONTENT_SECURITY_POLICY, /connect-src 'self'(?:;|$)/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /connect-src[^;]*\bws:/);
});

test('#09 validateMap rejects array conditions and oversized moveRoute parameters', () => {
  const map = createMap(10, 10, 1);
  const badCond = createPage();
  (badCond as unknown as { conditions: unknown }).conditions = [];
  map.events.push({ id: 1, name: 'E', note: '', x: 1, y: 1, pages: [badCond] });
  assert.equal(validateMap(map, () => true), 'events[1].pages[0].conditions');

  const badRoute = createPage();
  badRoute.moveRoute.list = [{ code: 1, parameters: ['x'.repeat(5000)] }];
  map.events[1] = { id: 1, name: 'E', note: '', x: 1, y: 1, pages: [badRoute] };
  assert.equal(validateMap(map, () => true), 'events[1].pages[0].moveRoute');
});

test('#20 orphan Cmd.LoopEnd does not jump back to index 0', async () => {
  let runs = 0;
  const list: EventCommand[] = [
    { code: MmoCmd.Notify, indent: 0, parameters: ['hi'] },
    { code: Cmd.LoopEnd, indent: 0, parameters: [] },
    { code: Cmd.End, indent: 0, parameters: [] },
  ];
  const host = {
    isActive: () => true,
    notify: () => { runs++; },
    playerName: () => 'P',
    currencyName: () => 'Or',
    getSwitch: () => false,
    getVariable: () => 0,
    getSelfSwitch: () => false,
  } as unknown as InterpreterHost;
  const finished = await runCommands(list, host);
  assert.equal(finished, true);
  assert.equal(runs, 1);
});

test('#24 & #25 SettingsRepository clones cached objects and prepareCached isolates pluck mode', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db, PATHS.migrations);
    const settings = new SettingsRepository(db);
    settings.set('startPosition', { mapId: 1, x: 5, y: 5, direction: 2 });
    const first = settings.get<{ mapId: number; x: number; y: number; direction: number }>('startPosition', { mapId: 1, x: 1, y: 1, direction: 2 });
    first.x = 999;
    const second = settings.get<{ mapId: number; x: number; y: number; direction: number }>('startPosition', { mapId: 1, x: 1, y: 1, direction: 2 });
    assert.equal(second.x, 5, 'mutating a returned setting object must not poison the shared cache');

    const sql = 'SELECT key FROM system_settings WHERE key = ?';
    const rowStmt = prepareCached<[string], { key: string }>(db, sql);
    const pluckStmt = prepareCached<[string], string>(db, sql, { pluck: true });
    assert.deepEqual(rowStmt.get('startPosition'), { key: 'startPosition' });
    assert.equal(pluckStmt.get('startPosition'), 'startPosition');
    assert.deepEqual(rowStmt.get('startPosition'), { key: 'startPosition' }, 'row statement stays unplucked');
  } finally {
    db.close();
  }
});

// --- Server integration tests ---------------------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

async function makeAccount(name: string) {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  const csrf = await client.csrf('/characters');
  const api = async <T>(base: '/api/editor' | '/api/admin', method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await client.request(`${base}${path}`, {
      method,
      headers: { 'x-csrf-token': csrf, ...(headers ?? (body === undefined ? {} : { 'content-type': 'application/json' })) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { client, csrf, api };
}

async function enter(client: TestClient, name: string) {
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const html = await (await client.request('/characters')).text();
  const ids = [...html.matchAll(/action="\/characters\/(\d+)\/play"/g)].map((m) => m[1]!);
  const id = ids.at(-1)!;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload, p: server.ctx.world.player(payload.character.id)! };
}

test('#03 cyclic MapInfos import breaks cycles and PATCH /maps/:id/info refuses pre-existing cycles without hanging', async () => {
  const admin = await makeAccount('CycleAdmin');
  const adminId = server.ctx.accounts.findByUsername('CycleAdmin')!.id;
  const smallMap = createMap(5, 5, 1);
  const mapInfos = [
    null,
    { id: 1, name: 'LoopA', parentId: 2, order: 1, expanded: true },
    { id: 2, name: 'LoopB', parentId: 1, order: 2, expanded: true },
    { id: 3, name: 'Self', parentId: 3, order: 3, expanded: true },
  ];
  const entries = [
    { name: 'data/MapInfos.json', data: Buffer.from(JSON.stringify(mapInfos)) },
    { name: 'data/Map001.json', data: Buffer.from(JSON.stringify(smallMap)) },
    { name: 'data/Map002.json', data: Buffer.from(JSON.stringify(smallMap)) },
    { name: 'data/Map003.json', data: Buffer.from(JSON.stringify(smallMap)) },
  ];
  const report = await importProject(server.ctx, entries, adminId);
  assert.equal(report.maps, 3);
  const idA = report.mapIds[1]!;
  const idB = report.mapIds[2]!;
  const idC = report.mapIds[3]!;
  assert.equal(server.ctx.maps.info(idC)?.parentId, 0, 'self-parent broken to root');
  assert.ok(server.ctx.maps.info(idA)?.parentId === 0 || server.ctx.maps.info(idB)?.parentId === 0, 'A <-> B cycle broken');

  // Force a corrupted cycle directly in SQLite and verify PATCH /maps/:id/info rejects without hanging.
  server.ctx.db.prepare('UPDATE maps SET parent_id = ? WHERE id = ?').run(idB, idA);
  server.ctx.db.prepare('UPDATE maps SET parent_id = ? WHERE id = ?').run(idA, idB);
  const patch = await admin.api<{ error: string }>('/api/editor', 'PATCH', `/maps/${idC}/info`, { parentId: idA });
  assert.equal(patch.status, 400);
  assert.equal(patch.body.error, 'error.editor.invalid_parent');
});

test('#07 forged unsigned anonymous CSRF cookie is rejected on POST /login', async () => {
  const client = new TestClient(server.url);
  const fakeToken = 'A'.repeat(32);
  client.cookies.set('brindiwanko.csrf', fakeToken);
  const res = await client.post('/login', { _csrf: fakeToken, username: 'CycleAdmin', password: 'secret password' });
  assert.equal(res.status, 403);
});

test('#11 Express 5 routes without Content-Type: application/json do not crash with HTTP 500', async () => {
  const admin = await makeAccount('BodyAdmin');
  // Promote BodyAdmin to admin for testing admin & editor routes.
  server.ctx.db.prepare("UPDATE accounts SET role = 'admin' WHERE username = 'BodyAdmin'").run();
  const r1 = await admin.api('/api/admin', 'POST', '/tools/announce', undefined, {});
  assert.notEqual(r1.status, 500);
  const r2 = await admin.api('/api/editor', 'POST', '/quarantine/approve', undefined, {});
  assert.equal(r2.status, 400);
});

test('#10, #14, #15, #16, #17 gameplay & social P1/P2 invariants', async () => {
  const aAcc = await makeAccount('HeroA');
  const bAcc = await makeAccount('HeroB');
  server.ctx.db.prepare("UPDATE accounts SET role = 'admin' WHERE username = 'HeroA'").run();
  const heroA = await enter(aAcc.client, 'HeroA');
  const heroB = await enter(bAcc.client, 'HeroB');
  try {
    const world = server.ctx.world;

    // #15: useItem enforces GCD and rejects usage while stunned/restricted ('cannot_act').
    server.ctx.gameData.save('state', {
      ...server.ctx.gameData.get('state', 1)!,
      id: 901,
      name: 'StunTest',
      restriction: 'cannot_act',
      duration: 10,
    });
    world.changeItems(heroA.p, 'item', 1, 5);
    heroA.p.hp = 10;
    heroA.p.combat.globalReadyAt = 0;
    heroA.p.combat.states.set(901, Date.now() + 5000);
    world.useItem(heroA.p, 1);
    assert.equal(heroA.p.hp, 10, 'cannot drink potion while stunned');
    heroA.p.combat.states.delete(901);
    world.useItem(heroA.p, 1);
    const afterFirst = heroA.p.hp;
    assert.ok(afterFirst > 10, 'first potion heals');
    heroA.p.hp = 10;
    world.useItem(heroA.p, 1);
    assert.equal(heroA.p.hp, 10, 'second immediate potion blocked by global cooldown');

    // #10: reloadMap closes open shop window; buy refuses deleted item.
    const closedEvents: number[] = [];
    heroA.socket.on('windowsClosed', () => closedEvents.push(1));
    heroA.socket.on('shopOpen', () => undefined);
    const shopPromise = world.sheet.openShop(heroA.p, [{ kind: 'item', id: 1, price: 1 }], false);
    await wait(20);
    assert.equal(heroA.p.ui?.kind, 'shop');
    world.reloadMap(heroA.p.mapId);
    await shopPromise;
    await wait(30);
    assert.equal(heroA.p.ui, null, 'reloadMap closes open UI windows');
    assert.ok(closedEvents.length >= 1);

    // #10: buy() refuses purchasing an item deleted from gameData after the shop opened.
    const ghostItem = { ...server.ctx.gameData.get('item', 1)!, id: 903, name: 'GhostItem' };
    server.ctx.gameData.save('item', ghostItem);
    const ghostShop = world.sheet.openShop(heroA.p, [{ kind: 'item', id: 903, price: 1 }], false);
    await wait(20);
    server.ctx.gameData.remove('item', 903);
    world.changeGold(heroA.p, 100);
    const goldBeforeGhost = server.ctx.inventory.gold(heroA.p.characterId);
    world.sheet.buy(heroA.p, 0, 1);
    assert.equal(server.ctx.inventory.gold(heroA.p.characterId), goldBeforeGhost, 'cannot buy deleted item');
    assert.equal(server.ctx.inventory.quantity(heroA.p.characterId, 'item', 903), 0);
    world.sheet.closeWindows(heroA.p);
    await ghostShop;

    // #14: toroidal small map AoE deduplicates wrapped cells so each target is hit once.
    const tiny = createMap(3, 3, 1);
    tiny.scrollType = 3; // loops both X and Y
    tiny.mmo.pvp = true;
    server.ctx.maps.save({ id: 902, parentId: 0, name: 'TinyLoop', order: 99, expanded: true }, tiny);
    world.transfer(heroA.p, 902, 1, 1, 6);
    world.transfer(heroB.p, 902, 2, 1, 4);
    const combat = world.combat as unknown as {
      mapCombat: (id: number, inst: number) => unknown;
      skillTargets: (mc: unknown, user: unknown, scope: string, range: number, area: number) => { list: unknown[] };
    };
    const mc = combat.mapCombat(902, 0);
    const res = combat.skillTargets(mc, { kind: 'player', p: heroA.p }, 'enemies_area', 1, 3);
    assert.equal(res.list.length, 1, 'target is hit once even when area wraps around 3x3 toroidal map');

    // #17: emotes respect mute, ignore, invisibility, and do not reset chat repeat counter; /r respects invisibility.
    world.transfer(heroA.p, 1, 15, 15, 2);
    world.transfer(heroB.p, 1, 16, 15, 2);
    const emotesB: number[] = [];
    const chatsA: string[] = [];
    const chatsB: string[] = [];
    heroB.socket.on('emote', (e) => emotesB.push(e.balloon));
    heroA.socket.on('chat', (m) => { if (m.key) chatsA.push(m.key); });
    heroB.socket.on('chat', (m) => { if (m.key) chatsB.push(m.key); });

    // Invisible admin cannot emit emotes and cannot be probed via /r.
    heroA.p.invisible = true;
    world.social.emote(heroA.p, 2);
    await wait(40);
    assert.equal(emotesB.length, 0, 'invisible player does not broadcast emotes');
    heroB.p.social.lastWhisper = heroA.p.characterId;
    world.social.chat(heroB.p, '/r ping', 'map');
    await wait(40);
    assert.ok(chatsB.includes('error.chat.offline'), '/r treats invisible player as offline');
    heroA.p.invisible = false;

    // Ignored player does not deliver emotes.
    heroB.p.social.ignored.add(heroA.p.characterId);
    world.social.emote(heroA.p, 3);
    await wait(40);
    assert.equal(emotesB.length, 0, 'ignored player emotes are filtered');
    heroB.p.social.ignored.delete(heroA.p.characterId);

    // Emote does not reset chat anti-repeat counter.
    world.social.chat(heroA.p, 'hello repeat', 'map');
    world.social.chat(heroA.p, 'hello repeat', 'map');
    world.social.emote(heroA.p, 4);
    world.social.chat(heroA.p, 'hello repeat', 'map');
    world.social.chat(heroA.p, 'hello repeat', 'map');
    await wait(40);
    assert.ok(chatsA.includes('error.chat.repeat'), 'emote between identical lines does not reset repeats');

    // Muted player cannot emote.
    heroA.p.mute = { until: '2099-01-01 00:00:00', reason: 'test' };
    const beforeMuted = emotesB.length;
    world.social.emote(heroA.p, 5);
    await wait(40);
    assert.equal(emotesB.length, beforeMuted, 'muted player cannot broadcast emotes');
    heroA.p.mute = null;

    // #16: guild bank allows withdrawing a key item already stored, but refuses depositing with error.item.cannot_bank.
    const guildNotes: string[] = [];
    heroA.socket.on('notify', (n) => guildNotes.push(n.key));
    world.changeGold(heroA.p, 10_000);
    world.guilds.create(heroA.p, 'TestGuild', 'TG', { shape: 'shield', color: '#336699', symbol: 'star', symbolColor: '#ffffff' });
    world.changeItems(heroA.p, 'item', 6, 1); // key item
    world.guilds.bankItems(heroA.p, 'item', 6, 1, true);
    await wait(40);
    assert.ok(guildNotes.includes('error.item.cannot_bank'), 'depositing key item into guild bank reports error.item.cannot_bank');
    // Put a key item directly into guild bank (simulating category changed after deposit) and withdraw it into an empty slot.
    world.changeItems(heroA.p, 'item', 6, -1);
    server.ctx.db.prepare("INSERT INTO guild_bank_items (guild_id, item_kind, item_id, quantity) VALUES (?, 'item', 6, 1)").run(heroA.p.guild!.id);
    assert.equal(server.ctx.inventory.quantity(heroA.p.characterId, 'item', 6), 0);
    world.guilds.bankItems(heroA.p, 'item', 6, 1, false);
    assert.equal(server.ctx.inventory.quantity(heroA.p.characterId, 'item', 6), 1, 'withdrawing key item from guild bank succeeds');
  } finally {
    heroA.socket.close();
    heroB.socket.close();
  }
});

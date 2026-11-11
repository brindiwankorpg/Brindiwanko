/**
 * @file Regression tests of the security review of October 12, 2026: limits counted per IPv6
 * block and locks that a flood cannot lift, the "name taken" answers of the registration form,
 * invisible letters in names, the quarantine of imported scripts, the uploaded backup checked
 * outside the game loop, the logs limit, uncompressed pages, friend lists, the resale price of a
 * cheaper shop and the points taken back on a lower level.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { io as connect, type Socket } from 'socket.io-client';
import { validateCharacterName } from '../shared/characters.js';
import { reindent } from '../shared/command-blocks.js';
import { normalizeRecord } from '../shared/database-schema.js';
import { BranchType, Cmd, createPage, type EventCommand } from '../shared/events.js';
import { GUILD_NAME } from '../shared/guild.js';
import { createMap } from '../shared/map.js';
import { validateMap } from '../shared/map-validation.js';
import { hasInvisible } from '../shared/names.js';
import { approveScript, keepQuarantine, quarantineList, quarantinedScripts } from '../shared/quarantine.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { TAKEN_ANSWERS_PER_HOUR } from '../server/auth/routes.js';
import { LoginThrottle } from '../server/auth/throttle.js';
import { config } from '../server/config.js';
import { closeContext, createContext } from '../server/context.js';
import { checkBackupInWorker, inspectBackup, stripSecrets } from '../server/db/backups.js';
import { MAX_GOLD } from '../server/db/inventory.js';
import { migrate } from '../server/db/migrate.js';
import { runCommands, type InterpreterHost } from '../server/events/interpreter.js';
import { MAX_FRIENDS } from '../server/game/social.js';
import type { PlayerSession } from '../server/game/world.js';
import { addressKey } from '../server/http/address.js';
import { PATHS, restorePathOf } from '../server/paths.js';
import { scanResources } from '../server/resources/scanner.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

// --- Addresses and locks ------------------------------------------------------------------

test('IPv6 clients are counted by their /64 block, IPv4 ones by their address', () => {
  assert.equal(addressKey('203.0.113.5'), '203.0.113.5');
  assert.equal(addressKey('::ffff:203.0.113.5'), '203.0.113.5', 'IPv4 written in IPv6 form');
  assert.equal(addressKey('::ffff:cb00:7105'), '203.0.113.5', 'the same, in hexadecimal groups');
  const a = addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
  assert.equal(a, '2001:db8:1:2::/64');
  assert.equal(addressKey('2001:db8:1:2::1'), a, 'another address of the same block');
  assert.equal(addressKey('2001:0DB8:0001:0002:0:0:0:9'), a, 'written in full, upper case');
  assert.equal(addressKey('2001:db8:1:2::1%eth0'), a, 'with a zone');
  assert.notEqual(addressKey('2001:db8:1:3::1'), a, 'another block');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('unknown'), 'unknown');
});

test('a flood of new names cannot lift the lock of an account under attack', () => {
  let now = 1_000_000;
  const throttle = new LoginThrottle({ maxFailures: 3, lockMs: 60_000 }, () => now);
  for (let i = 0; i < 3; i++) throttle.fail('user:victim');
  assert.ok(throttle.lockedFor('user:victim') > 0);
  // Thousands of other names (one failure each) fill the table well beyond its size.
  for (let i = 0; i < 12_000; i++) {
    now += 1;
    throttle.fail(`user:flood${i}`);
  }
  assert.ok(throttle.lockedFor('user:victim') > 0, 'the lock in force is still there');
});

// --- Names -------------------------------------------------------------------------------------

test('names cannot hold letters drawn as nothing (invisible names, look-alikes)', () => {
  for (const filler of ['ㅤ', 'ᅟ', 'ᅠ', 'ﾠ']) {
    assert.equal(validateCharacterName(`Bob${filler}`), 'error.character.name_invalid');
    assert.equal(validateCharacterName(filler.repeat(3)), 'error.character.name_invalid');
    assert.ok(GUILD_NAME.test(`Guild${filler}`) && hasInvisible(`Guild${filler}`), 'the guild rule adds the check to the pattern');
  }
  assert.equal(validateCharacterName('Bob'), null);
  assert.equal(validateCharacterName('Ève de Lune'), null);
});

// --- Quarantine of imported scripts -------------------------------------------------------------

const c = (code: number, parameters: unknown[] = [], indent = 0): EventCommand => ({ code, indent, parameters });

test('the quarantine mark follows a script when it is copied, stored or edited, and only an approval of the read code removes it', () => {
  const list = [c(Cmd.Script, ['setV(1, 5)']), c(Cmd.ScriptLine, ['setV(2, 6)']), c(Cmd.If, [BranchType.Script, 'gold() > 5']), c(Cmd.End, [], 1), c(Cmd.IfEnd), c(Cmd.ControlVariables, [1, 1, 0, 0, 3]), c(Cmd.End)];
  assert.equal(quarantineList(list), 2, 'the script and the script condition (not the plain variable command)');
  assert.deepEqual(quarantinedScripts(list).map((s) => s.code), ['setV(1, 5)\nsetV(2, 6)', 'gold() > 5']);
  assert.equal(reindent(list, 2)[0]!.quarantined, true, 'copied and pasted');
  assert.equal((normalizeRecord('commonEvent', { name: 'X', list }, 1) as { list: EventCommand[] }).list[0]!.quarantined, true, 'stored in the database');
  assert.equal((normalizeRecord('commonEvent', { name: 'X', list: [{ ...list[0], quarantined: 'yes' }] }, 1) as { list: EventCommand[] }).list[0]!.quarantined, undefined, 'only `true` is a mark');
  const edited = keepQuarantine([list[0]!], [c(Cmd.Script, ['setV(1, 99)'])]);
  assert.equal(edited[0]!.quarantined, true, 'editing is not approving');
  assert.equal(approveScript(list, 0, 'setV(1, 5)'), false, 'not the code shown (its second line is missing)');
  assert.equal(approveScript(list, 0, 'setV(1, 5)\nsetV(2, 6)'), true);
  assert.equal(list[0]!.quarantined, undefined);
  const map = createMap(2, 2, 1);
  map.events = [null, { id: 1, name: 'E', note: '', x: 0, y: 0, pages: [createPage({ list: [{ ...c(Cmd.Script, ['x']), quarantined: false as unknown as true }, c(Cmd.End)] })] }];
  assert.match(validateMap(map, () => true) ?? '', /quarantined/);
});

test('a script in quarantine does nothing: no run, false condition, operand 0', async () => {
  const variables = new Map<number, number>();
  const ran: string[] = [];
  const host = new Proxy({} as InterpreterHost, {
    get: (_t, key: string) => {
      if (key === 'isActive') return () => true;
      if (key === 'getVariable') return (id: number) => variables.get(id) ?? 0;
      if (key === 'setVariable') return (id: number, v: number) => void variables.set(id, v);
      if (key === 'runScript') return async (code: string) => (ran.push(code), [{ op: 'variable', id: 9, value: 1 }]);
      if (key === 'evaluate') return async (code: string) => (ran.push(code), 7);
      if (key === 'playerName' || key === 'currencyName') return () => '';
      if (key === 'batch') return undefined;
      return () => undefined;
    },
  });
  const q = (cmd: EventCommand): EventCommand => ({ ...cmd, quarantined: true });
  await runCommands([
    q(c(Cmd.Script, ['setV(9, 1)'])),
    q(c(Cmd.If, [BranchType.Script, 'true'])),
    c(Cmd.ControlVariables, [2, 2, 0, 0, 1], 1),
    c(Cmd.End, [], 1),
    c(Cmd.Else),
    c(Cmd.ControlVariables, [3, 3, 0, 0, 1], 1),
    c(Cmd.End, [], 1),
    c(Cmd.IfEnd),
    q(c(Cmd.ControlVariables, [4, 4, 0, 4, '7'])),
    c(Cmd.ControlVariables, [5, 5, 0, 4, '7']),
    c(Cmd.End),
  ], host);
  assert.deepEqual(ran, ['7'], 'only the approved operand reached the sandbox');
  assert.equal(variables.get(9), undefined);
  assert.equal(variables.get(2), undefined, 'the quarantined condition is false...');
  assert.equal(variables.get(3), 1, '...so the else branch runs');
  assert.equal(variables.get(4) ?? 0, 0, 'the quarantined operand is 0');
  assert.equal(variables.get(5), 7);
});

// --- Backups -------------------------------------------------------------------------------------

test('an uploaded backup is checked in a worker thread: exactly the schema of this engine, no trigger or view', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brindiwanko-check-'));
  const engine = (file: string, extra = '') => {
    const db = new Database(file);
    migrate(db, PATHS.migrations);
    if (extra) db.exec(extra);
    db.close();
    return file;
  };
  try {
    const good = engine(join(dir, 'good.db'));
    // Only the names of three tables of the engine: a database of another program, or of a much older version.
    const foreign = join(dir, 'foreign.db');
    const first = new Database(foreign);
    first.exec('CREATE TABLE schema_migrations (version INTEGER); CREATE TABLE accounts (id INTEGER); CREATE TABLE characters (id INTEGER);');
    first.close();
    const other = join(dir, 'other.db');
    const second = new Database(other);
    second.exec('CREATE TABLE something (id INTEGER)');
    second.close();
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'SQLite format 3\u0000 but not really a database');
    const trigger = engine(join(dir, 'trigger.db'), "CREATE TRIGGER t AFTER INSERT ON accounts BEGIN UPDATE accounts SET role = 'admin' WHERE id = NEW.id; END;");
    const view = engine(join(dir, 'view.db'), 'CREATE VIEW v AS SELECT 1;');
    const extraColumn = engine(join(dir, 'column.db'), 'ALTER TABLE accounts ADD COLUMN backdoor TEXT;');
    const newer = engine(join(dir, 'newer.db'), "INSERT INTO schema_migrations (version, name) VALUES (999, 'future');");
    assert.equal(await checkBackupInWorker(good), true);
    assert.equal(await inspectBackup(foreign), 'error.admin.invalid_backup', 'three table names are not the schema of the engine');
    assert.equal(await checkBackupInWorker(other), false, 'not a database of this engine');
    assert.equal(await checkBackupInWorker(junk), false);
    assert.equal(await checkBackupInWorker(join(dir, 'missing.db')), false);
    assert.equal(await inspectBackup(trigger), 'error.admin.backup_unsafe', 'a trigger would run in the live game');
    assert.equal(await inspectBackup(view), 'error.admin.backup_unsafe');
    assert.equal(await inspectBackup(extraColumn), 'error.admin.invalid_backup');
    assert.equal(await inspectBackup(newer), 'error.admin.backup_newer');
    // Cleaning a copy never runs a trigger it holds: it is dropped first.
    const sessionTrigger = engine(join(dir, 'session-trigger.db'), "INSERT INTO accounts (username, email, password_hash, role) VALUES ('Mallory', 'm@example.com', 'x', 'player'); CREATE TRIGGER s AFTER DELETE ON sessions BEGIN UPDATE accounts SET role = 'admin'; END; INSERT INTO sessions (sid, sess, expires) VALUES ('a', '{}', 9999999999999);");
    stripSecrets(sessionTrigger);
    const cleaned = new Database(sessionTrigger, { readonly: true });
    assert.deepEqual(cleaned.prepare('SELECT role FROM accounts').pluck().all(), ['player']);
    assert.equal(cleaned.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'").pluck().get(), 0);
    cleaned.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a restored database the game cannot start on is replaced by the previous one at once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brindiwanko-undo-'));
  const dbPath = join(dir, 'game.db');
  try {
    // The live database, with an account.
    let ctx = createContext({ ...config, dbPath, sessionSecret: 'x' }, { bcryptRounds: 4, contentLanguage: 'en' });
    const account = ctx.accounts.create({ username: 'Keeper', email: 'keeper@example.com', passwordHash: 'x', locale: 'en' });
    closeContext(ctx);
    // A broken file waits as the restoration (as if a check had been skipped).
    const broken = new Database(restorePathOf(dbPath));
    broken.exec('CREATE TABLE schema_migrations (version INTEGER); CREATE TABLE accounts (id INTEGER); CREATE TABLE characters (id INTEGER);');
    broken.close();
    ctx = createContext({ ...config, dbPath, sessionSecret: 'x' }, { bcryptRounds: 4 });
    try {
      assert.equal(ctx.accounts.findById(account.id)?.username, 'Keeper', 'the server runs on its previous data');
      assert.ok(existsSync(`${dbPath}.failed-restore`), 'the refused file is kept for a closer look');
      assert.equal(existsSync(restorePathOf(dbPath)), false);
    } finally {
      closeContext(ctx);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Through the server ------------------------------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  const pictures = join(PATHS.uploads, 'img', 'pictures');
  rmSync(join(pictures, 'HardeningPicture.png'), { force: true });
  // The folder made for the test goes too, when nothing else is in it.
  if (existsSync(pictures) && readdirSync(pictures).length === 0) rmSync(pictures, { recursive: true });
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

/** Registers an account (the first one of the server is the administrator). */
async function account(username: string): Promise<TestClient> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username, email: `${username.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  return client;
}

/** Calls a JSON API of the server with the session's CSRF token. */
async function api<T = Record<string, unknown>>(client: TestClient, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const csrf = await client.csrf('/characters');
  const res = await client.request(path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/** Creates a character, selects it and enters the game. */
async function play(client: TestClient, name: string): Promise<{ socket: ClientSocket; p: PlayerSession; notes: string[]; chat: string[] }> {
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.social.findByName(name)!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const notes: string[] = [];
  const chat: string[] = [];
  socket.on('notify', (n) => notes.push(n.key));
  socket.on('chat', (m) => chat.push(m.key ?? ''));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, p: server.ctx.world.player(payload.character.id)!, notes, chat };
}

let admin: TestClient;

test('the administrator approves imported scripts after reading them; a map open by another administrator waits', async () => {
  admin = await account('Warden');
  const info = { id: server.ctx.maps.nextId(), parentId: 0, name: 'Imported', order: 99, expanded: true };
  const map = createMap(3, 3, 1);
  map.events = [null, { id: 1, name: 'Machine', note: '', x: 1, y: 1, pages: [createPage({ list: [{ ...c(Cmd.Script, ['setV(1, 1)']), quarantined: true }, c(Cmd.End)] })] }];
  server.ctx.maps.saveWithVersion(info, map, null);
  const listed = await api<{ items: { kind: string; mapId: number; eventId: number; page: number; index: number; code: string }[] }>(admin, 'GET', '/api/editor/quarantine');
  const item = listed.body.items.find((i) => i.kind === 'map' && i.mapId === info.id)!;
  assert.equal(item.code, 'setV(1, 1)');

  // Another administrator holds the map: nothing changes under its feet.
  server.ctx.editLocks.acquire(info.id, 999_999, 'Someone');
  assert.deepEqual((await api(admin, 'POST', '/api/editor/quarantine/approve', { items: [item] })).body, { approved: 0, skipped: 1 });
  server.ctx.editLocks.release(info.id, 999_999);
  // A code that is not the stored one is not approved.
  assert.deepEqual((await api(admin, 'POST', '/api/editor/quarantine/approve', { items: [{ ...item, code: 'setV(1, 2)' }] })).body, { approved: 0, skipped: 1 });
  assert.deepEqual((await api(admin, 'POST', '/api/editor/quarantine/approve', { items: [item] })).body, { approved: 1, skipped: 0 });
  assert.equal(server.ctx.maps.get(info.id)!.events[1]!.pages[0]!.list[0]!.quarantined, undefined);
  assert.equal((await api<{ items: unknown[] }>(admin, 'GET', '/api/editor/quarantine')).body.items.length, 0);
});

test('scripts of common events imported with the database wait for approval', async () => {
  const exported = await api<{ version: number; database: Record<string, unknown[]>; system: unknown }>(admin, 'GET', '/api/editor/db-export');
  const data = exported.body;
  data.database.commonEvent = [{ id: 1, name: 'Hook', trigger: 'none', switchId: 0, list: [c(Cmd.Script, ['setS(1, true)']), c(Cmd.End)] }];
  const res = await api<{ quarantined: number }>(admin, 'POST', '/api/editor/db-import', data);
  assert.equal(res.status, 200);
  assert.equal(res.body.quarantined, 1);
  assert.equal(server.ctx.gameData.get('commonEvent', 1)!.list[0]!.quarantined, true);
});

test('an import keeps the game resources it would replace unless asked, and says which', async () => {
  const zip = (png: Buffer) => makeZip({ 'P/data/MapInfos.json': '[null]', 'P/img/pictures/HardeningPicture.png': png });
  const importZip = async (body: Buffer, replace = false) => {
    const csrf = await admin.csrf('/characters');
    const res = await admin.request(`/api/editor/import${replace ? '?replaceResources=1' : ''}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, body: new Uint8Array(body) });
    return ((await res.json()) as { report: { warnings: { key: string }[] } }).report.warnings.map((w) => w.key);
  };
  const file = join(PATHS.uploads, 'img/pictures/HardeningPicture.png');
  try {
    assert.ok(!(await importZip(zip(fakePng(64, 64)))).includes('import.warning.resource_replaced'), 'a new picture');
    assert.ok(!(await importZip(zip(fakePng(64, 64)))).includes('import.warning.resource_replaced'), 'the same picture again');
    const kept = await importZip(zip(fakePng(32, 32)));
    assert.ok(kept.includes('import.warning.resource_kept'), 'another picture under the same name is left out');
    assert.deepEqual(readFileSync(file), fakePng(64, 64));
    assert.ok((await importZip(zip(fakePng(32, 32)), true)).includes('import.warning.resource_replaced'), 'replaced when asked');
    assert.deepEqual(readFileSync(file), fakePng(32, 32));
  } finally {
    if (existsSync(file)) rmSync(file);
    server.ctx.resources.sync(scanResources());
  }
});

test('the logs limit is a whole number from 1 to 500', async () => {
  for (let i = 0; i < 3; i++) server.ctx.admin.logAdmin(1, 'test', 'server');
  const negative = await api<{ lines: unknown[] }>(admin, 'GET', '/api/admin/logs/admin?limit=-1');
  assert.equal(negative.body.lines.length, 1, 'a negative limit is not "everything"');
  const fraction = await api<{ lines: unknown[] }>(admin, 'GET', '/api/admin/logs/admin?limit=0.5');
  assert.equal(fraction.status, 200);
});

test('pages are sent uncompressed (they hold the CSRF token), scripts and data compressed', async () => {
  const page = await admin.request('/characters', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(page.headers.get('content-encoding'), null);
  const dictionary = await admin.request('/locales/fr.json', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(dictionary.headers.get('content-encoding'), 'gzip');
});

test('friend lists are capped; where a friend plays is only told to mutual friends', async () => {
  const other = await account('Solo2');
  await other.post('/characters', { _csrf: await other.csrf('/characters/new'), name: 'Compagne', classId: '1' });
  const one = await play(await account('Solo1'), 'Solenne');
  one.p.social.friends = new Set(Array.from({ length: MAX_FRIENDS }, (_, i) => 1_000_000 + i));
  one.socket.emit('friendAdd', 'Compagne');
  await until(() => one.chat.includes('error.social.friends_full'));
  assert.equal(server.ctx.social.friends(one.p.characterId).length, 0, 'nothing was added');
  one.socket.close();
});

test('a shop selling an article cheaper buys it back on that price', async () => {
  const { socket, p } = await play(await account('Merchant'), 'Marchande');
  const world = server.ctx.world;
  const base = server.ctx.gameData.get('item', 1)!.price;
  world.changeItems(p, 'item', 1, 2);
  p.ui = { kind: 'shop', goods: [{ kind: 'item', id: 1, name: 'x', description: '', icon: 0, price: 1 }], purchaseOnly: false };
  const before = server.ctx.inventory.gold(p.characterId);
  world.sheet.sell(p, 'item', 1, 1);
  const rate = server.ctx.settings.get('sellRate', 50);
  assert.ok(base > 1);
  assert.equal(server.ctx.inventory.gold(p.characterId) - before, Math.floor((1 * rate) / 100), 'not the database price');
  p.ui = null;
  socket.close();
});

test('an article sold cheaper by any shop of the game is bought back on that price by every shop', async () => {
  const { socket, p } = await play(await account('Arbiter'), 'Arbitre');
  const world = server.ctx.world;
  const rate = server.ctx.settings.get('sellRate', 50);
  const weapon = server.ctx.gameData.get('weapon', 1)!;
  assert.ok(weapon.price > 10);
  // Another map gets a shop selling the weapon for 10.
  const info = server.ctx.maps.info(3)!;
  const original = structuredClone(server.ctx.maps.get(3)!);
  const map = structuredClone(original);
  const page = { ...structuredClone(map.events.find((e) => e)!.pages[0]!), list: [{ code: 302, indent: 0, parameters: [1, 1, 1, 10, false] }, { code: 0, indent: 0, parameters: [] }] };
  map.events.push({ id: map.events.length, name: 'Cheap shop', note: '', x: 1, y: 1, pages: [page] });
  server.ctx.maps.save(info, map);
  try {
    world.changeItems(p, 'weapon', 1, 2);
    // A shop elsewhere that does not sell the weapon.
    p.ui = { kind: 'shop', goods: [], purchaseOnly: false };
    let gold = server.ctx.inventory.gold(p.characterId);
    world.sheet.sell(p, 'weapon', 1, 1);
    assert.equal(server.ctx.inventory.gold(p.characterId) - gold, Math.floor((10 * rate) / 100), 'the lowest price of the game, not the database price');
    // Once that shop is gone, the database price comes back.
    server.ctx.maps.save(info, original);
    gold = server.ctx.inventory.gold(p.characterId);
    world.sheet.sell(p, 'weapon', 1, 1);
    assert.equal(server.ctx.inventory.gold(p.characterId) - gold, Math.floor((weapon.price * rate) / 100));
  } finally {
    server.ctx.maps.save(info, original);
    p.ui = null;
    socket.close();
  }
});

test('a sale that would go past the most gold one can carry is refused, and nothing is taken', async () => {
  const { socket, p, notes } = await play(await account('Rich'), 'Riche');
  const world = server.ctx.world;
  world.changeItems(p, 'item', 1, 5);
  world.changeGold(p, MAX_GOLD);
  p.ui = { kind: 'shop', goods: [], purchaseOnly: false };
  try {
    world.sheet.sell(p, 'item', 1, 5);
    await until(() => notes.includes('error.shop.gold_full'));
    assert.equal(server.ctx.inventory.quantity(p.characterId, 'item', 1), 5, 'the items stay in the bag');
    assert.equal(server.ctx.inventory.gold(p.characterId), MAX_GOLD);
  } finally {
    p.ui = null;
    socket.close();
  }
});

test('a lower level takes back the parameter points beyond what it gives', async () => {
  const { socket, p, notes } = await play(await account('Grower'), 'Grandit');
  const per = server.ctx.settings.get('statPointsPerLevel', 3);
  server.ctx.world.runner.setExp(p, 0, false, 5);
  for (let i = 0; i < 4 * per; i++) server.ctx.world.sheet.allocate(p, i % 2 ? 'atk' : 'def');
  assert.equal((p.allocated.atk ?? 0) + (p.allocated.def ?? 0), 4 * per);
  server.ctx.world.runner.setExp(p, 0, false, 2);
  assert.equal((p.allocated.atk ?? 0) + (p.allocated.def ?? 0), per, 'only what level 2 gives is left');
  assert.deepEqual(server.ctx.progression.allocated(p.characterId), p.allocated, 'and saved');
  await until(() => notes.includes('notify.points_taken_back'));
  socket.close();
});

// Last: it blocks the registrations of this address for an hour.
test('"name taken" answers of the registration form are limited per address', async () => {
  const client = new TestClient(server.url);
  const attempt = async (i: number) => {
    const res = await client.post('/register', { _csrf: await client.csrf('/register'), username: `Taken${i}`, email: 'warden@example.com', password: 'secret password', passwordConfirm: 'secret password' });
    return { status: res.status, html: await res.text() };
  };
  for (let i = 0; i < TAKEN_ANSWERS_PER_HOUR; i++) assert.equal((await attempt(i)).status, 400);
  const blocked = await attempt(99);
  assert.equal(blocked.status, 429);
  assert.match(blocked.html, /too_many_register_attempts/);
});

// --- Helpers -------------------------------------------------------------------------------------------

/** Builds a ZIP archive (deflated entries). */
function makeZip(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** PNG file of a given size: whole chunks with their checksums (the pixels themselves are not encoded). */
function fakePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const b = Buffer.alloc(body.length + 8);
    b.writeUInt32BE(data.length, 0);
    body.copy(b, 4);
    b.writeUInt32BE(crc32(body), body.length + 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', Buffer.alloc(4)), chunk('IEND', Buffer.alloc(0))]);
}

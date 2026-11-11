/**
 * @file Robustness, security and performance tests: HTTP security headers,
 * session cookie flags, CSRF on API writes, anti-cheat checks (speed, attack
 * reach, items not owned), the area of interest of movements, automatic
 * backups and their restoration, and a short load test.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { applyPendingRestore, backupNow, checkBackup, lastDue, prepareRestore } from '../server/db/backups.js';
import { PATHS, restorePathOf } from '../server/paths.js';
import { backupScheduleOf, DEFAULT_BACKUP_SCHEDULE } from '../shared/settings.js';
import type { PlayerSession } from '../server/game/world.js';
import { clientAddress, isSameOrigin } from '../server/net/socket.js';
import { runLoadTest } from '../scripts/load-test.js';
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

interface Player {
  socket: ClientSocket;
  client: TestClient;
  session: PlayerSession;
  moved: Map<number, [number, number]>;
  rejected: number;
  notes: string[];
}

async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const p = { socket, client, moved: new Map(), rejected: 0, notes: [] } as unknown as Player;
  socket.on('playersMoved', (moves) => moves.forEach(([pid, x, y]) => p.moved.set(pid, [x, y])));
  socket.on('moveRejected', () => p.rejected++);
  socket.on('notify', (n) => p.notes.push(n.key));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  p.session = server.ctx.world.player(payload.character.id)!;
  return p;
}

test('security headers, cookie flags and CSRF on API writes', async () => {
  const client = new TestClient(server.url);
  const res = await client.request('/login');
  assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(res.headers.get('x-permitted-cross-domain-policies'), 'none');
  assert.equal(res.headers.get('x-powered-by'), null);
  // Uploaded files opened directly run nothing, not even styles.
  mkdirSync(PATHS.uploads, { recursive: true });
  writeFileSync(join(PATHS.uploads, 'csp-check.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const upload = await client.request('/uploads/csp-check.svg');
  assert.equal(upload.status, 200);
  assert.match(upload.headers.get('content-security-policy') ?? '', /default-src 'none'.*sandbox/);
  assert.doesNotMatch(upload.headers.get('content-security-policy') ?? '', /unsafe-inline/);
  const cookie = res.headers.getSetCookie().join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i, 'plain HTTP outside production');
  // A server set to production sends its CSRF and language cookies over HTTPS only, whatever the process environment says.
  const secure = await startTestServer({ production: true });
  try {
    const page = new TestClient(secure.url);
    const login = await page.request('/login');
    assert.match(login.headers.getSetCookie().find((c) => c.startsWith('brindiwanko.csrf=')) ?? '', /;\s*Secure/i);
    const lang = await page.request('/lang/en?next=/login');
    assert.match(lang.headers.getSetCookie().find((c) => c.includes('lang')) ?? 'none', /;\s*Secure/i);
  } finally {
    await secure.close();
  }
  // A logged-in administrator without the CSRF header cannot write.
  const admin = await newPlayer('Root');
  const noCsrf = await admin.client.request('/api/admin/tools/announce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
  assert.equal(noCsrf.status, 403);
  const formNoCsrf = await admin.client.post('/characters', { name: 'Sneaky', classId: '1' });
  assert.equal(formNoCsrf.status, 403);
  admin.socket.close();
});

test('anti-cheat: walking speed, attack reach and items are checked by the server', async () => {
  const cheat = await newPlayer('Speedy');
  const p = cheat.session;
  const world = server.ctx.world;
  world.transfer(p, 1, 20, 20, 2);
  const before = p.y;
  // Ten steps at once: only the burst allowance goes through.
  for (let i = 0; i < 10; i++) cheat.socket.emit('move', 2, p.epoch);
  await wait(200);
  assert.ok(p.y - before <= 3, `moved ${p.y - before} cells`);
  assert.ok(cheat.rejected > 0);
  // A melee attack does not reach a monster 3 cells away.
  world.transfer(p, 2, 14, 27, 8);
  const view = world.combat.views(2).find((v) => v.enemyId === 1)!;
  const slime = world.combat.monster(2, view.id)!;
  slime.nextMoveAt = Number.MAX_SAFE_INTEGER;
  p.x = slime.x;
  p.y = slime.y + 3;
  p.direction = 8;
  const hp = slime.hp;
  p.combat.nextAttackAt = 0;
  world.combat.attack(p);
  assert.equal(slime.hp, hp);
  // Using or selling an item not owned does nothing.
  cheat.socket.emit('useItem', 3);
  await wait(100);
  assert.ok(cheat.notes.includes('error.item.not_owned'));
  cheat.socket.close();
});

test('area of interest: far players are not sent, and appear when they come close', async () => {
  const far = await newPlayer('Faraway');
  const near = await newPlayer('Nearby');
  const world = server.ctx.world;
  world.transfer(far.session, 1, 1, 15, 2);
  world.transfer(near.session, 1, 38, 15, 2);
  await wait(150);
  near.moved.clear();
  world.forceMove(far.session, 1, 16, 2);
  await wait(150);
  assert.equal(near.moved.has(far.session.characterId), false, 'beyond the area of interest');
  world.forceMove(near.session, 20, 15, 4);
  await wait(150);
  assert.deepEqual(near.moved.get(far.session.characterId), [1, 16], 'its position is sent once it is close');
  far.socket.close();
  near.socket.close();
});

test('the game socket refuses pages of another site (cross-site WebSocket hijacking)', async () => {
  const p = await newPlayer('Origin1');
  p.socket.close();
  const open = (origin: string) =>
    new Promise<string>((resolve) => {
      const s = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: p.client.cookieHeader(), origin } });
      s.on('enterWorld', () => {
        s.close();
        resolve('entered');
      });
      s.on('connect_error', (e) => {
        s.close();
        resolve(`refused: ${e.message}`);
      });
    });
  assert.match(await open('https://evil.example'), /^refused/);
  assert.equal(await open(server.url), 'entered');
});

test('behind a proxy, the client address and the public origin are read as configured', () => {
  const request = (headers: Record<string, string>, remote = '127.0.0.1') => ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;
  const proxied = request({ 'x-forwarded-for': '198.51.100.9, 203.0.113.5' });
  assert.equal(clientAddress(proxied, true), '203.0.113.5', 'the address the trusted proxy saw');
  assert.equal(clientAddress(proxied, false), '127.0.0.1', 'without TRUST_PROXY the header is ignored');
  assert.equal(clientAddress(request({}, '192.0.2.4'), true), '192.0.2.4');
  // With PUBLIC_URL, only that exact origin may open the game socket.
  const from = (origin: string) => request({ origin, host: 'jeu.example.org', 'x-forwarded-host': 'evil.example' });
  assert.equal(isSameOrigin(from('https://jeu.example.org'), true, 'https://jeu.example.org'), true);
  assert.equal(isSameOrigin(from('http://jeu.example.org'), true, 'https://jeu.example.org'), false, 'another scheme');
  assert.equal(isSameOrigin(from('https://evil.example'), true, 'https://jeu.example.org'), false, 'a forged forwarded host does not help');
});

test('an exception in a socket handler is logged, the server keeps serving', async () => {
  const p = await newPlayer('Crash1');
  const world = server.ctx.world;
  const original = world.action.bind(world);
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  world.action = () => {
    throw new Error('boom');
  };
  try {
    p.socket.emit('action');
    // The same connection still answers afterwards.
    const pong = await p.socket.timeout(2000).emitWithAck('ping', Date.now());
    assert.equal(typeof pong, 'number');
    assert.ok(errors.length > 0);
  } finally {
    world.action = original;
    console.error = log;
    p.socket.close();
  }
});

test('automatic backups copy the database and the resources, and keep the latest ones', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brindiwanko-backups-'));
  const dir = join(root, 'backups');
  const uploads = join(root, 'uploads');
  mkdirSync(join(uploads, 'img', 'characters'), { recursive: true });
  writeFileSync(join(uploads, 'img', 'characters', 'Hero.png'), 'png');
  try {
    // An older version wrote database files only: they are rotated with the folders.
    mkdirSync(dir);
    writeFileSync(join(dir, 'brindiwanko-20251231-000000.db'), '');
    writeFileSync(join(dir, 'brindiwanko-20251231-000001.partial'), '');
    for (let i = 0; i < 4; i++) await backupNow(server.ctx.db, dir, 2, uploads, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    assert.deepEqual(readdirSync(dir).sort(), ['brindiwanko-20260101-000002', 'brindiwanko-20260101-000003'], 'the oldest are replaced, unfinished ones removed');
    const last = join(dir, 'brindiwanko-20260101-000003');
    assert.ok(checkBackup(join(last, 'game.db')), 'a valid database');
    assert.equal(readFileSync(join(last, 'uploads', 'img', 'characters', 'Hero.png'), 'utf8'), 'png', 'with the imported resources');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a daily backup is due once its hour has passed, even after a stop of the server', () => {
  const at = (h: number, m = 0) => new Date(2026, 4, 10, h, m);
  assert.equal(lastDue(4, at(4, 30)), at(4).getTime(), 'today at 4');
  assert.equal(lastDue(4, at(3, 59)), new Date(2026, 4, 9, 4).getTime(), 'before 4: yesterday at 4');
  assert.equal(lastDue(0, at(0)), at(0).getTime());
  assert.deepEqual(backupScheduleOf({ hour: 25, keep: 3 }), DEFAULT_BACKUP_SCHEDULE, 'wrong values fall back to the defaults');
  assert.deepEqual(backupScheduleOf({ hour: 23, keep: 7 }), { hour: 23, keep: 7 });
});

test('a backup put back with the restore command replaces the database and the resources at the next start', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brindiwanko-restore-'));
  const uploads = join(root, 'uploads');
  const dbPath = join(root, 'game.db');
  try {
    mkdirSync(uploads);
    writeFileSync(join(uploads, 'Old.png'), 'old');
    const backup = await backupNow(server.ctx.db, join(root, 'backups'), 31, uploads);
    writeFileSync(join(uploads, 'New.png'), 'new');
    writeFileSync(dbPath, 'current database');
    assert.equal(prepareRestore(join(root, 'nothing.db'), dbPath), null, 'not a backup');
    assert.deepEqual(prepareRestore(backup, dbPath), { uploads: true });
    assert.equal(readFileSync(dbPath, 'utf8'), 'current database', 'nothing changes before the next start');
    assert.equal(applyPendingRestore(dbPath, uploads), true);
    assert.ok(checkBackup(dbPath), 'the database of the backup is in place');
    assert.equal(readFileSync(`${dbPath}.before-restore`, 'utf8'), 'current database', 'the replaced one is kept');
    assert.deepEqual(readdirSync(uploads), ['Old.png'], 'the resources of the backup are back');
    assert.deepEqual(readdirSync(`${uploads}.before-restore`).sort(), ['New.png', 'Old.png']);
    assert.equal(applyPendingRestore(dbPath, uploads), false, 'applied once');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a restore command that fails on the way leaves the previous preparation as it was', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brindiwanko-restore-'));
  const uploads = join(root, 'uploads');
  const dbPath = join(root, 'game.db');
  // The disk fills up while the resources are copied.
  const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
  const copy = fs.cpSync;
  const failing: typeof copy = (from, to, options) => {
    if (String(from).endsWith('uploads')) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    copy(from, to, options);
  };
  try {
    mkdirSync(uploads);
    writeFileSync(join(uploads, 'Old.png'), 'old');
    const backup = await backupNow(server.ctx.db, join(root, 'backups'), 31, uploads);
    assert.deepEqual(prepareRestore(backup, dbPath), { uploads: true });
    const pending = restorePathOf(dbPath);
    const prepared = readFileSync(pending);
    fs.cpSync = failing;
    syncBuiltinESMExports();
    assert.throws(() => prepareRestore(backup, dbPath), /no space/);
    assert.deepEqual(readFileSync(pending), prepared, 'the previous database still waits, unchanged');
    assert.deepEqual(readdirSync(`${dbPath}.restore-pending-uploads`), ['Old.png'], 'with its resources');
    assert.deepEqual(readdirSync(root).filter((f) => f.includes('partial')), [], 'nothing half copied is left');
    // Without a previous preparation, a failed one leaves nothing that would apply at the next start.
    rmSync(pending);
    assert.throws(() => prepareRestore(backup, dbPath), /no space/);
    assert.equal(applyPendingRestore(dbPath, uploads), false);
  } finally {
    fs.cpSync = copy;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test('criterion (short): dozens of clients without noticeable degradation', async () => {
  const report = await runLoadTest(30, 3);
  assert.ok(report.accepted > 0);
  assert.ok(report.lagP95 <= 100, `event loop lag p95 ${report.lagP95} ms`);
  assert.ok(report.tickP95 <= 25, `tick p95 ${report.tickP95} ms`);
});

/**
 * @file Administration panel tools added for clarity: switches and variables named in the tools, the
 * map drawn for the teleport tool, announcement modes, logs searched by name, and the restoration of a
 * backup from the panel, of the server or from a file (behind the administrator's password).
 */
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { backupNow, listBackups, uploadsRestorePathOf } from '../server/db/backups.js';
import { backupsDirOf, restorePathOf } from '../server/paths.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

let server: TestServer;
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    return { status: res.status, body: (await res.json()) as T };
  };
  return { client, id: server.ctx.accounts.findByUsername(name)!.id, api };
}

async function play(a: Account, name: string): Promise<{ socket: ClientSocket; announcements: string[]; notifications: string[] }> {
  await a.client.post('/characters', { _csrf: await a.client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(a.id)[0]!.id;
  await a.client.post(`/characters/${id}/play`, { _csrf: await a.client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: a.client.cookieHeader() } });
  const out = { socket, announcements: [] as string[], notifications: [] as string[] };
  socket.on('announcement', (a) => out.announcements.push(a.text));
  socket.on('notify', (n) => out.notifications.push(n.key));
  await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return out;
}

let admin: Account;
let mod: Account;
let player: Account;
before(async () => {
  server = await startTestServer();
  admin = await account('Chief'); // first account: administrator
  mod = await account('Keeper');
  player = await account('Walker');
  server.ctx.accounts.setRole(mod.id, 'moderator');
});

test('the tools name the switches and variables declared in the System tab', async () => {
  const { status, body } = await admin.api<{ switches: { id: number; name: string }[]; variables: { id: number; name: string }[] }>('GET', '/tools/lookups');
  assert.equal(status, 200);
  const declared = server.ctx.settings.get<{ name: string }[]>('switches', []);
  assert.deepEqual(body.switches.map((s) => [s.id, s.name]), declared.map((s, i) => [i + 1, s.name]));
  assert.equal(body.variables.length, server.ctx.settings.get<unknown[]>('variables', []).length);
});

test('the teleport tool gets the walkable cells of a map (administrators only)', async () => {
  const map = server.ctx.maps.get(1)!;
  const { status, body } = await admin.api<{ width: number; height: number; cells: string }>('GET', '/tools/maps/1/grid');
  assert.equal(status, 200);
  assert.deepEqual([body.width, body.height], [map.width, map.height]);
  assert.equal(body.cells.length, map.width * map.height);
  assert.match(body.cells, /^[01]+$/);
  assert.ok(body.cells.includes('1') && body.cells.includes('0'), 'both walkable and blocked cells');
  assert.equal((await admin.api('GET', '/tools/maps/999999/grid')).status, 404);
  assert.equal((await mod.api('GET', '/tools/maps/1/grid')).status, 403);
});

test('an announcement is shown as asked: banner, chat only, or a window', async () => {
  const p = await play(player, 'Walker');
  assert.equal((await admin.api('POST', '/tools/announce', { text: 'Hello', mode: 'shout' })).status, 400);
  assert.equal((await admin.api('POST', '/tools/announce', { text: 'Restart in 5 minutes', mode: 'popup' })).status, 200);
  assert.equal((await admin.api('POST', '/tools/announce', { text: 'Quiet one', mode: 'chat' })).status, 200);
  await wait(100);
  assert.deepEqual(p.announcements, ['Restart in 5 minutes']);
  assert.ok(!p.notifications.includes('notify.announce'), 'neither the window nor the chat-only mode shows a banner');
  // Without a mode: the banner, as before.
  assert.equal((await admin.api('POST', '/tools/announce', { text: 'Banner' })).status, 200);
  await wait(100);
  assert.ok(p.notifications.includes('notify.announce'));
  p.socket.close();
});

test('logs are searched by the name of an account or of a character', async () => {
  // Walker played above: its connections are logged.
  const byCharacter = await mod.api<{ lines: { account: string }[] }>('GET', '/logs/connections?name=walker');
  assert.equal(byCharacter.status, 200);
  assert.ok(byCharacter.body.lines.length > 0);
  assert.ok(byCharacter.body.lines.every((l) => l.account === 'Walker'));
  const unknown = await mod.api<{ lines: unknown[] }>('GET', '/logs/connections?name=Nobody');
  assert.deepEqual(unknown.body.lines, []);
});

test('a backup of the server is restored from the panel only with the administrator password', async () => {
  const dir = backupsDirOf(server.ctx.config.dbPath);
  await backupNow(server.ctx.db, dir, 3, null);
  const name = listBackups(dir).at(-1)!;
  const pending = restorePathOf(server.ctx.config.dbPath);
  try {
    assert.equal((await mod.api('POST', `/backups/${name}/restore`, { password: 'secret password' })).status, 403, 'moderators cannot');
    assert.equal((await admin.api('POST', '/backups/not-a-backup/restore', { password: 'secret password' })).status, 404);
    const wrong = await admin.api<{ error: string }>('POST', `/backups/${name}/restore`, { password: 'wrong password' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error, 'error.account.wrong_password');
    assert.ok(!existsSync(pending), 'nothing prepared without the password');
    const right = await admin.api<{ ok: boolean }>('POST', `/backups/${name}/restore`, { password: 'secret password' });
    assert.equal(right.status, 200);
    assert.ok(existsSync(pending), 'the restoration waits for the next start');
    const logged = server.ctx.admin.logs('admin', 0, 10).some((l) => l.action === 'restore' && l.admin === 'Chief');
    assert.ok(logged, 'written to the administrator log');
  } finally {
    rmSync(pending, { force: true });
    rmSync(uploadsRestorePathOf(server.ctx.config.dbPath), { recursive: true, force: true });
  }
});

test('a backup file is restored from the panel only with the administrator password', async () => {
  // The file put back is a backup of this very server, downloaded from the panel.
  const download = await admin.client.request('/api/admin/backup');
  assert.equal(download.status, 200);
  const file = await download.arrayBuffer();
  // An administrator whose password is not Latin-1 text: it travels URI-encoded in a header.
  const password = 'mot de passe été ✓';
  const archivist = new TestClient(server.url);
  await archivist.post('/register', { _csrf: await archivist.csrf('/register'), username: 'Archivist', email: 'archivist@example.com', password, passwordConfirm: password });
  server.ctx.accounts.setRole(server.ctx.accounts.findByUsername('Archivist')!.id, 'admin');
  const upload = async (who: TestClient, typed?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'x-csrf-token': await who.csrf('/characters') };
    if (typed !== undefined) headers['x-confirm-password'] = encodeURIComponent(typed);
    const res = await who.request('/api/admin/restore', { method: 'POST', headers, body: file });
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
  };
  const pending = restorePathOf(server.ctx.config.dbPath);
  try {
    assert.equal((await upload(mod.client, 'secret password')).status, 403, 'moderators cannot');
    const missing = await upload(archivist);
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error, 'error.account.wrong_password');
    assert.equal((await upload(archivist, 'wrong password')).status, 403);
    assert.ok(!existsSync(pending), 'nothing prepared without the password');
    const right = await upload(archivist, password);
    assert.equal(right.status, 200);
    assert.ok(existsSync(pending), 'the restoration waits for the next start');
  } finally {
    rmSync(pending, { force: true });
    rmSync(uploadsRestorePathOf(server.ctx.config.dbPath), { recursive: true, force: true });
  }
});

/**
 * @file End-to-end tests of the authentication pages and of the socket
 * handshake: register -> redirect to character selection -> logout -> login,
 * CSRF enforcement, account locale persistence and socket refusal when anonymous.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect } from 'socket.io-client';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

const registration = (username: string) => ({
  username,
  email: `${username.toLowerCase()}@example.com`,
  password: 'secret password',
  passwordConfirm: 'secret password',
});

test('register logs in, redirects to character selection and makes the first account admin', async () => {
  const client = new TestClient(server.url);
  const token = await client.csrf('/register');
  const res = await client.post('/register', { _csrf: token, ...registration('Admin') });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/characters');
  const page = await (await client.request('/characters')).text();
  assert.match(page, /Admin/);
  assert.match(page, /role-admin/);
  assert.equal(server.ctx.accounts.findByUsername('admin')?.role, 'admin');
});

test('posting without a valid CSRF token is refused', async () => {
  const client = new TestClient(server.url);
  await client.csrf('/register');
  const res = await client.post('/register', { _csrf: 'forged', ...registration('Mallory') });
  assert.equal(res.status, 403);
  assert.equal(server.ctx.accounts.findByUsername('Mallory'), undefined);
});

test('logout then login with the saved account locale', async () => {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), ...registration('Player1') });
  assert.equal(server.ctx.accounts.findByUsername('Player1')?.role, 'player');
  // Choose French while logged in: saved into the account.
  await client.request('/lang/fr?next=/');
  assert.equal(server.ctx.accounts.findByUsername('Player1')?.locale, 'fr');
  const logout = await client.post('/logout', { _csrf: await client.csrf('/characters') });
  assert.equal(logout.status, 303);
  assert.equal((await client.request('/characters')).headers.get('location'), '/login?next=%2Fcharacters');

  // A fresh browser (no cookie) logs in: the page switches to the account's language.
  const other = new TestClient(server.url);
  const bad = await other.post('/login', { _csrf: await other.csrf('/login'), username: 'player1', password: 'nope nope' });
  assert.equal(bad.status, 401);
  const good = await other.post('/login', { _csrf: await other.csrf('/login'), username: 'player1', password: 'secret password' });
  assert.equal(good.status, 303);
  assert.equal(other.cookies.get('lang'), 'fr');
  assert.match(await (await other.request('/characters')).text(), /Vos personnages/);
});

test('showing the login and registration forms stores no session; the browser is remembered after a login', async () => {
  const count = () => server.ctx.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get() as number;
  const before = count();
  for (let i = 0; i < 20; i++) await (await new TestClient(server.url).request(i % 2 ? '/login' : '/register')).text();
  assert.equal(count(), before, 'anonymous visits leave nothing in the database');

  // The forms still work: the anti-CSRF token travels in a cookie of the visitor.
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), ...registration('Visitor') });
  await client.post('/logout', { _csrf: await client.csrf('/characters') });
  const token = await client.csrf('/login');
  assert.ok(client.cookies.has('brindiwanko.csrf'));
  const res = await client.post('/login', { _csrf: token, username: 'Visitor', password: 'secret password' });
  assert.equal(res.status, 303);
  assert.ok(client.cookies.has('brindiwanko.device'), 'device cookie for the login limiter');
  assert.equal(client.cookies.has('brindiwanko.csrf'), false, 'the session has its own token now');
  // A token from another visitor's cookie is refused.
  const other = new TestClient(server.url);
  await other.csrf('/login');
  const stolen = await other.post('/login', { _csrf: token, username: 'Visitor', password: 'secret password' });
  assert.equal(stolen.status, 403);
});

test('one address can only create a few accounts per hour', async () => {
  const limited = await startTestServer({ registrationsPerHour: 2 });
  try {
    const register = async (name: string) => {
      const c = new TestClient(limited.url);
      return c.post('/register', { _csrf: await c.csrf('/register'), ...registration(name) });
    };
    assert.equal((await register('First1')).status, 303);
    // A refused form (here, passwords that differ) does not count.
    const c = new TestClient(limited.url);
    assert.equal((await c.post('/register', { _csrf: await c.csrf('/register'), ...registration('Typo1'), passwordConfirm: 'other one' })).status, 400);
    assert.equal((await register('Second2')).status, 303);
    const third = await register('Third3');
    assert.equal(third.status, 429);
    assert.match(await third.text(), /Too many accounts|Trop de comptes/);
    assert.equal(limited.ctx.accounts.findByUsername('Third3'), undefined);
  } finally {
    await limited.close();
  }
});

test('protected pages redirect anonymous visitors to login', async () => {
  const res = await new TestClient(server.url).request('/characters');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login?next=%2Fcharacters');
});

test('the resource page is reserved to administrators; the manifest lists generated sheets', async () => {
  const player = new TestClient(server.url);
  await player.post('/login', { _csrf: await player.csrf('/login'), username: 'Player1', password: 'secret password' });
  assert.equal((await player.request('/dev/assets')).status, 403);
  const manifest = (await (await player.request('/api/resources')).json()) as { resources: { id: string; format: string }[] };
  const a2 = manifest.resources.find((r) => r.id === 'tilesets/Outside_A2');
  assert.equal(a2?.format, 'standard-tileset-a2');

  const admin = new TestClient(server.url);
  await admin.post('/login', { _csrf: await admin.csrf('/login'), username: 'Admin', password: 'secret password' });
  const page = await admin.request('/dev/assets');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Outside_A2/);
});

/**
 * @file "My account" and "forgotten password" pages: changing the password
 * (the other sessions are closed), changing the e-mail address, deleting an
 * account (not the owner's), and the e-mailed reset link (one hour, used once,
 * same answer whether an account exists or not, never built from a foreign
 * Host header).
 */
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { after, before, test } from 'node:test';
import { isLoopbackHost } from '../server/auth/account-routes.js';
import { memoryMailer } from '../server/mail.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

let server: TestServer;
const mailer = memoryMailer();
before(async () => {
  server = await startTestServer({}, { mailer });
});
after(async () => {
  await server.close();
});

/** Registers an account and returns its logged-in client. */
async function register(username: string, password = 'secret password'): Promise<TestClient> {
  const client = new TestClient(server.url);
  const res = await client.post('/register', { _csrf: await client.csrf('/register'), username, email: `${username.toLowerCase()}@example.com`, password, passwordConfirm: password });
  assert.equal(res.status, 303);
  return client;
}

async function login(username: string, password: string): Promise<{ client: TestClient; status: number }> {
  const client = new TestClient(server.url);
  const res = await client.post('/login', { _csrf: await client.csrf('/login'), username, password });
  return { client, status: res.status };
}

test('the account page needs a login and shows the account', async () => {
  const owner = await register('Owner');
  const anonymous = await new TestClient(server.url).request('/account');
  assert.equal(anonymous.status, 303);
  assert.match(anonymous.headers.get('location') ?? '', /^\/login/);
  const page = await (await owner.request('/account')).text();
  assert.match(page, /owner@example\.com/);
  // The server owner cannot delete its account: no deletion form.
  assert.doesNotMatch(page, /action="\/account\/delete"/);
  const refused = await owner.post('/account/delete', { _csrf: await owner.csrf('/account'), confirmName: 'Owner', current: 'secret password' });
  assert.equal(refused.status, 400);
  assert.ok(server.ctx.accounts.findByUsername('Owner'));
});

test('changing the password needs the current one and logs the other sessions out', async () => {
  const first = await register('Alice');
  const { client: second } = await login('Alice', 'secret password');
  const wrong = await first.post('/account/password', { _csrf: await first.csrf('/account'), current: 'not it at all', password: 'brand new pass', passwordConfirm: 'brand new pass' });
  assert.equal(wrong.status, 400);
  const res = await first.post('/account/password', { _csrf: await first.csrf('/account'), current: 'secret password', password: 'brand new pass', passwordConfirm: 'brand new pass' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/account?done=password');
  // This browser stays logged in, the other one is out.
  assert.equal((await first.request('/account')).status, 200);
  assert.equal((await second.request('/account')).status, 303);
  assert.equal((await login('Alice', 'secret password')).status, 401);
  assert.equal((await login('Alice', 'brand new pass')).status, 303);
});

test('changing the e-mail address needs the password and a free address', async () => {
  const bob = await register('Bob');
  const taken = await bob.post('/account/email', { _csrf: await bob.csrf('/account'), current: 'secret password', email: 'alice@example.com' });
  assert.equal(taken.status, 400);
  const ok = await bob.post('/account/email', { _csrf: await bob.csrf('/account'), current: 'secret password', email: 'bob.new@example.com' });
  assert.equal(ok.status, 303);
  assert.equal(server.ctx.accounts.findByUsername('Bob')?.email, 'bob.new@example.com');
});

test('an account is deleted with its characters, after its name and password', async () => {
  const carol = await register('Carol');
  const id = server.ctx.accounts.findByUsername('Carol')!.id;
  const classId = server.ctx.gameData.list('class')[0]!.id;
  const created = server.ctx.characterService.create(id, { name: 'Carolina', classId, appearance: {} });
  assert.ok(created.ok);
  server.ctx.admin.logConnection(id, null, 'login', '203.0.113.7');
  const badName = await carol.post('/account/delete', { _csrf: await carol.csrf('/account'), confirmName: 'Caro', current: 'secret password' });
  assert.equal(badName.status, 400);
  const res = await carol.post('/account/delete', { _csrf: await carol.csrf('/account'), confirmName: 'carol', current: 'secret password' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login?notice=deleted');
  assert.equal(server.ctx.accounts.findByUsername('Carol'), undefined);
  assert.equal(server.ctx.characters.listByAccount(id).length, 0);
  assert.equal((await carol.request('/account')).status, 303);
  // Its connections stay in the log (for the moderators), without the address.
  const ips = server.ctx.db.prepare<[number], string>('SELECT ip FROM connection_log WHERE account_id = ?').pluck().all(id);
  assert.ok(ips.length > 0);
  assert.ok(ips.every((ip) => ip === ''));
});

test('a forgotten password is reset with the e-mailed link, once', async () => {
  await register('Dave');
  const visitor = new TestClient(server.url);
  const unknown = await visitor.post('/forgot-password', { _csrf: await visitor.csrf('/forgot-password'), identifier: 'nobody@example.com' });
  const known = await visitor.post('/forgot-password', { _csrf: await visitor.csrf('/forgot-password'), identifier: 'dave@example.com' });
  assert.equal(unknown.status, known.status, 'same answer whether the account exists or not');
  await new Promise((r) => setImmediate(r));
  const mail = mailer.outbox.find((m) => m.to === 'dave@example.com');
  assert.ok(mail, 'an e-mail was sent to the account');
  assert.equal(mailer.outbox.length, 1);
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  assert.ok(token);
  assert.match(await (await visitor.request(`/reset-password?token=${token}`)).text(), /name="password"/);
  const mismatch = await visitor.post('/reset-password', { _csrf: await visitor.csrf(`/reset-password?token=${token}`), token, password: 'another pass 1', passwordConfirm: 'another pass 2' });
  assert.equal(mismatch.status, 400);
  const res = await visitor.post('/reset-password', { _csrf: await visitor.csrf(`/reset-password?token=${token}`), token, password: 'another pass 1', passwordConfirm: 'another pass 1' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login?notice=reset');
  assert.equal((await login('Dave', 'another pass 1')).status, 303);
  // The link works only once.
  assert.doesNotMatch(await (await visitor.request(`/reset-password?token=${token}`)).text(), /name="password"/);
  // A second request right away sends nothing (one e-mail every few minutes per account).
  await visitor.post('/forgot-password', { _csrf: await visitor.csrf('/forgot-password'), identifier: 'Dave' });
  await new Promise((r) => setImmediate(r));
  assert.equal(mailer.outbox.length, 1);
});

test('a forgotten password link used by two requests at once changes the password only once', async () => {
  await register('Frank');
  const reset = server.ctx.auth.createPasswordReset('Frank')!;
  const [one, two] = [new TestClient(server.url), new TestClient(server.url)];
  const post = async (client: TestClient, password: string) =>
    client.post('/reset-password', { _csrf: await client.csrf(`/reset-password?token=${reset.token}`), token: reset.token, password, passwordConfirm: password });
  const statuses = (await Promise.all([post(one, 'first new pass'), post(two, 'second new pass')])).map((r) => r.status).sort();
  assert.deepEqual(statuses, [303, 400], 'one succeeds, the other finds the link used');
  const logins = [(await login('Frank', 'first new pass')).status, (await login('Frank', 'second new pass')).status].sort();
  assert.deepEqual(logins, [303, 401], 'exactly one of the two passwords works');
});

test('a forgotten password link never takes its address from a Host header naming another site', async () => {
  await register('Erin');
  const visitor = new TestClient(server.url);
  const token = await visitor.csrf('/forgot-password');
  const url = new URL(server.url);
  const body = new URLSearchParams({ _csrf: token, identifier: 'Erin' }).toString();
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: '/forgot-password', method: 'POST', headers: { host: 'attacker.example', cookie: visitor.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(status, 503, 'the page says no e-mail can be sent from there');
  assert.equal(mailer.outbox.some((m) => m.to === 'erin@example.com'), false, 'no link was e-mailed');
  assert.equal(isLoopbackHost('localhost:3000'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('[::1]:8080'), true);
  assert.equal(isLoopbackHost('localhost.attacker.example'), false);
  assert.equal(isLoopbackHost('127.0.0.1.attacker.example'), false);
});

test('the forgotten password page explains when no e-mail can be sent', async () => {
  const offline = await startTestServer({ production: false }, { mailer: { enabled: false, send: () => Promise.reject(new Error('no mail')) } });
  try {
    const page = await (await new TestClient(offline.url).request('/forgot-password')).text();
    assert.doesNotMatch(page, /name="identifier"/);
  } finally {
    await offline.close();
  }
});

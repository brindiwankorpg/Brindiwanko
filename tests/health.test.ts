/**
 * @file Health probes: `/livez` only tells the process runs; `/readyz` (and `/healthz`) answer 503 once the
 * server is shutting down or its database no longer answers, so that a load balancer stops sending players
 * to a server going away.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestServer } from './helpers/server.js';

test('the probes answer 200 while the server runs', async () => {
  const server = await startTestServer();
  try {
    for (const path of ['/livez', '/readyz', '/healthz']) {
      const res = await fetch(server.url + path);
      assert.equal(res.status, 200, path);
      assert.deepEqual(await res.json(), { ok: true }, path);
      assert.equal(res.headers.get('cache-control'), 'no-store', path);
    }
  } finally {
    await server.close();
  }
});

test('readiness fails (503) once the shutdown started, liveness does not', async () => {
  const server = await startTestServer();
  try {
    server.ctx.stopping = true;
    assert.equal((await fetch(`${server.url}/readyz`)).status, 503);
    assert.equal((await fetch(`${server.url}/healthz`)).status, 503);
    assert.equal((await fetch(`${server.url}/livez`)).status, 200);
  } finally {
    await server.close();
  }
});

test('readiness fails (503) when the database is closed', async () => {
  const server = await startTestServer();
  try {
    server.ctx.db.close();
    const res = await fetch(`${server.url}/readyz`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false });
    assert.equal((await fetch(`${server.url}/healthz`)).status, 503);
  } finally {
    await server.close();
  }
});

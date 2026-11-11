/**
 * @file Search engines and link previews: robots.txt keeps them out of the private pages, the sitemap
 * lists the public ones (when the public address is known), and pages carry OpenGraph tags.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestServer } from './helpers/server.js';

test('robots.txt keeps search engines out of the game, the accounts and the administration', async () => {
  const server = await startTestServer();
  try {
    const res = await fetch(`${server.url}/robots.txt`);
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const path of ['/admin', '/api/', '/characters', '/game', '/account']) assert.match(text, new RegExp(`^Disallow: ${path}$`, 'm'));
    assert.doesNotMatch(text, /Sitemap:/, 'no sitemap without a public address');
    assert.equal((await fetch(`${server.url}/sitemap.xml`)).status, 404);
  } finally {
    await server.close();
  }
});

test('with a public address: a sitemap of the public pages, and link previews with an image', async () => {
  const server = await startTestServer({ publicUrl: 'https://game.example' });
  try {
    assert.match(await (await fetch(`${server.url}/robots.txt`)).text(), /^Sitemap: https:\/\/game\.example\/sitemap\.xml$/m);
    const sitemap = await fetch(`${server.url}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get('content-type') ?? '', /xml/);
    const xml = await sitemap.text();
    for (const page of ['/', '/login', '/register']) assert.ok(xml.includes(`<loc>https://game.example${page}</loc>`), page);
    const home = await (await fetch(`${server.url}/`)).text();
    assert.match(home, /<meta property="og:title" content="[^"]+">/);
    assert.match(home, /<meta property="og:description" content="[^"]+">/);
    assert.match(home, /<meta property="og:image" content="https:\/\/game\.example\/img\/system\/AppIcon-512\.png">/);
  } finally {
    await server.close();
  }
});

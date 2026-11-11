/**
 * @file Pages no longer embed the whole dictionary (more than 100 KB sent uncompressed with each page):
 * they give its address, versioned by its content. Asked for with that version, the file is compressed
 * and kept by the browser; without it, the browser checks it again each time.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestServer } from './helpers/server.js';

test('pages give the address of the dictionary instead of embedding it', async () => {
  const server = await startTestServer();
  try {
    const page = await fetch(`${server.url}/login`, { headers: { 'accept-language': 'fr' } });
    const html = await page.text();
    assert.ok(html.length < 20_000, `a light page (${html.length} characters)`);
    const src = /<script id="i18n-data" type="application\/json" data-locale="fr" data-src="([^"]+)"><\/script>/.exec(html)?.[1];
    assert.ok(src, 'the dictionary is named, not embedded');
    assert.match(src, /^\/locales\/fr\.json\?v=[\w-]{16}$/);
    assert.ok(html.includes(`<link rel="preload" href="${src}" as="fetch" crossorigin>`), 'and preloaded');

    const dictionary = await fetch(server.url + src, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(dictionary.status, 200);
    assert.equal(dictionary.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(dictionary.headers.get('content-encoding'), 'gzip');
    assert.equal(typeof ((await dictionary.json()) as Record<string, unknown>).site, 'object');

    // Without the current version (a language switch, an old page): checked again each time.
    for (const path of ['/locales/fr.json', '/locales/fr.json?v=outdated']) {
      assert.equal((await fetch(server.url + path)).headers.get('cache-control'), 'no-cache', path);
    }
  } finally {
    await server.close();
  }
});

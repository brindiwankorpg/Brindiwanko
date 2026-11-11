/**
 * @file Import / export tests: layout conversions, upload checks (type
 * sniffing, SVG safety, kind guessing), ZIP reading, a full project import
 * from a synthetic project archive, and map export round trip.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { convertCharacter16, convertChipset16, convertLegacyAutotile, convertLegacyTileset, tilesetSheetNames } from '../shared/conversions.js';
import { BranchType, Cmd, createPage } from '../shared/events.js';
import { createMap, tileAt } from '../shared/map.js';
import { TILE_ID_A2 } from '../shared/tiles.js';
import { SUPPORTED_COMMANDS, convertMap, exportMap } from '../server/importers/project.js';
import { ZipError, readZip } from '../server/importers/zip.js';
import { PATHS } from '../server/paths.js';
import { guessKind, isSafeSvg, pixelSize, sanitizeName, sniffType, storeUpload } from '../server/resources/uploads.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

// --- Helpers -------------------------------------------------------------------------

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
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
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

// --- Conversions ----------------------------------------------------------------------

test('legacy autotiles map their 3 × 3 patch onto the 2 × 2 standard patch', () => {
  const { A2 } = convertLegacyAutotile(96);
  assert.equal(A2!.ops.length, 2 + 16);
  const patch = A2!.ops.slice(2);
  // Standard quarter (1, 0) of the patch = legacy quarter column 2 (centre tile, left half), row 0 of the patch.
  assert.deepEqual([patch[1]!.sx, patch[1]!.sy, patch[1]!.dx, patch[1]!.dy], [32, 32, 24, 48]);
  // Bottom-right corner quarter comes from the legacy outer ring.
  assert.deepEqual([patch[15]!.sx, patch[15]!.sy], [80, 112]);
});

test('legacy tilesets fill B–E page halves of 16 rows', () => {
  const pages = convertLegacyTileset(256, 32 * 40);
  assert.deepEqual(Object.keys(pages), ['B', 'C']);
  assert.equal(pages.B!.ops.length, 2);
  assert.equal(pages.C!.ops.length, 1, 'rows 32–39 only fill the left half of C');
  assert.equal(pages.C!.ops[0]!.sh, 8 * 32);
});

test('16 px chipsets and character sheets follow their region tables', () => {
  const chip = convertChipset16();
  assert.equal(chip.A2!.ops.length, 12 * 18);
  assert.deepEqual([chip.A5!.ops[0]!.sx, chip.A5!.ops[0]!.sy], [12 * 16, 0], 'first lower tile at column 12');
  assert.deepEqual([chip.A5!.ops[6]!.sx, chip.A5!.ops[6]!.sy], [12 * 16, 16], 'rows of six');
  assert.deepEqual([chip.C!.ops[0]!.sx, chip.C!.ops[0]!.sy], [18 * 16, 8 * 16], 'first upper tile');
  assert.deepEqual([chip.C!.ops[0]!.dx, chip.C!.ops[0]!.dy], [48, 0], 'page tile 0 stays empty');
  const chars = convertCharacter16(288, 256)['0']!;
  // Standard row 0 (facing down) comes from source row 2.
  assert.deepEqual([chars.ops[0]!.sy, chars.ops[0]!.dy, chars.ops[0]!.dh], [64, 0, 96]);
  assert.deepEqual(tilesetSheetNames('Chip', 'chipset16', 480, 256), ['Chip~A2', 'Chip~A5', 'Chip~B', 'Chip~C']);
  assert.deepEqual(tilesetSheetNames('Outside_A2', 'standard-tileset-a2', 768, 576), ['Outside_A2']);
});

// --- Upload checks ------------------------------------------------------------------------

test('uploads are recognised by content; unsafe SVG and names are refused', () => {
  assert.equal(sniffType(fakePng(4, 4)), 'png');
  assert.equal(sniffType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniffType(Buffer.from('hello')), null);
  assert.equal(isSafeSvg('<svg><path fill="#fff" d="M0 0h1v1z"/></svg>'), true);
  assert.equal(isSafeSvg('<svg><script>alert(1)</script></svg>'), false);
  assert.equal(isSafeSvg('<svg onload="x()"></svg>'), false);
  assert.equal(isSafeSvg('<svg><image href="https://evil.example/a.png"/></svg>'), false);
  assert.equal(isSafeSvg('<svg><use href="#a"/></svg>'), true);
  // Tricks that hide a script from a naive filter.
  assert.equal(isSafeSvg('<svg/onload="x()"></svg>'), false);
  assert.equal(isSafeSvg('<svg><a><animate attributeName="href" values="&#106;avascript:alert(1)"/></a></svg>'), false);
  assert.equal(isSafeSvg('<svg><a href="java&#x09;script:alert(1)">x</a></svg>'), false);
  assert.equal(isSafeSvg('<svg><a href="&#106;avascript&colon;alert(1)">x</a></svg>'), false);
  assert.equal(isSafeSvg('<svg><a href=javascript:alert(1)>x</a></svg>'), false);
  assert.equal(isSafeSvg('<svg><style>@import "https://evil.example/x.css";</style></svg>'), false);
  assert.equal(isSafeSvg('<svg><set attributeName="onmouseover" to="alert(1)"/></svg>'), false);
  assert.equal(isSafeSvg('<svg><text>Tom &amp; Jerry &#233;t&#233;</text></svg>'), true);
  assert.equal(sanitizeName('../../etc/$Hero!.png'), '$Hero!');
  assert.equal(guessKind('Outside_A2', 768, 576), 'tilesets');
  assert.equal(guessKind('Chipset', 480, 256), 'tilesets');
  assert.equal(guessKind('$Boss', 432, 512), 'characters');
  assert.equal(guessKind('Actor2', 576, 288), 'faces');
});

test('image sizes are read from their headers; giant images are refused', () => {
  assert.deepEqual(pixelSize(fakePng(768, 576), 'png'), { width: 768, height: 576 });
  // JPEG: SOI, an APP0 segment, then a baseline frame header (SOF0) giving 480 × 640.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x80, 0x01, 0xe0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(pixelSize(jpeg, 'jpg'), { width: 480, height: 640 });
  // WebP, extended format: canvas size minus one on 24 bits.
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBPVP8X', 8, 'ascii');
  webp.writeUIntLE(1999, 24, 3);
  webp.writeUIntLE(99, 27, 3);
  assert.deepEqual(pixelSize(webp, 'webp'), { width: 2000, height: 100 });
  assert.deepEqual(pixelSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" stroke-width="3" width="96px" height="128"></svg>'), 'svg'), { width: 96, height: 128 });
  assert.equal(pixelSize(Buffer.from('<svg width="100%" height="50%"></svg>'), 'svg'), null, 'relative sizes are unknown');

  const huge = storeUpload('parallaxes', 'Huge', fakePng(40_000, 40_000));
  assert.equal(!huge.ok && huge.errorKey, 'error.resources.image_too_large');
  assert.equal(storeUpload('parallaxes', 'Tall', fakePng(100, 20_000)).ok, false, 'one side too long');
});

test('a damaged or cut image never replaces the current one, nor does a write that fails', () => {
  const folder = join(PATHS.uploads, 'img', 'pictures');
  const good = fakePng(16, 16);
  assert.equal(storeUpload('pictures', 'Sign', good).ok, true);
  const file = join(folder, 'Sign.png');
  const flipped = Buffer.from(good);
  flipped[42] ^= 0xff;
  for (const bad of [good.subarray(0, good.length - 6), flipped]) {
    const res = storeUpload('pictures', 'Sign', bad);
    assert.equal(!res.ok && res.errorKey, 'error.resources.damaged_image');
    assert.deepEqual(readFileSync(file), good, 'the current picture is kept');
  }
  // JPEG: SOI, a frame header (SOF0, 16 × 16), a scan, image data, then the end marker.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9]);
  assert.equal(storeUpload('pictures', 'Photo', jpeg).ok, true);
  assert.equal(storeUpload('pictures', 'Photo', jpeg.subarray(0, jpeg.length - 2)).ok, false, 'a cut JPEG is refused');
  assert.equal(storeUpload('pictures', 'Mark', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect')).ok, false, 'a cut SVG is refused');
  // The disk fills up while the new file is written: the current one is still there, whole.
  const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
  const write = fs.writeFileSync;
  fs.writeFileSync = ((path: string, ...rest: unknown[]) => {
    if (String(path).endsWith('.part')) {
      (write as (...a: unknown[]) => void)(path, Buffer.alloc(3));
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    }
    return (write as (...a: unknown[]) => void)(path, ...rest);
  }) as typeof fs.writeFileSync;
  syncBuiltinESMExports();
  try {
    assert.throws(() => storeUpload('pictures', 'Sign', fakePng(32, 32)), /ENOSPC/);
  } finally {
    fs.writeFileSync = write;
    syncBuiltinESMExports();
  }
  assert.deepEqual(readFileSync(file), good);
  assert.ok(!readdirSync(folder).some((f) => f.endsWith('.part')), 'no partial file left');
  // A new type of the same name replaces the old file once it is written.
  assert.equal(storeUpload('pictures', 'Sign', jpeg).ok, true);
  assert.deepEqual(readdirSync(folder).filter((f) => f.startsWith('Sign.')), ['Sign.jpg']);
});

test('ZIP archives are read; garbage and bombs are refused', async () => {
  const zip = makeZip({ 'a/b.txt': 'hello', 'c.json': '{"x":1}' });
  const entries = await readZip(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.data.toString()]), [['a/b.txt', 'hello'], ['c.json', '{"x":1}']]);
  await assert.rejects(readZip(Buffer.from('not a zip at all, clearly')), ZipError);
  const bomb = makeZip({ 'big.txt': Buffer.alloc(5_000_000) });
  await assert.rejects(readZip(bomb), (e: unknown) => e instanceof ZipError && e.key === 'error.import.corrupt');
});

test('map export and re-import give the same map', () => {
  const map = createMap(6, 4, 1);
  map.data[5] = TILE_ID_A2;
  map.displayName = 'Test';
  map.events = [null, { id: 1, name: 'Sign', note: '', x: 2, y: 1, pages: [createPage()] }];
  const back = convertMap(exportMap(map), 1, () => undefined, new Map());
  assert.deepEqual(back.data, map.data);
  assert.equal(back.displayName, 'Test');
  assert.deepEqual(back.events[1], map.events[1]);
});

test('imported maps report the events that contain scripts, and put those scripts in quarantine', () => {
  const map = createMap(3, 2, 1);
  const page = (list: unknown[]) => ({ ...createPage(), list });
  map.events = [
    null,
    { id: 1, name: 'Script', note: '', x: 0, y: 0, pages: [page([{ code: Cmd.Script, indent: 0, parameters: ['setV(1, 2)'] }, { code: 0, indent: 0, parameters: [] }])] },
    { id: 2, name: 'Branch', note: '', x: 1, y: 0, pages: [page([{ code: Cmd.If, indent: 0, parameters: [BranchType.Script, 'gold() > 5'] }, { code: 0, indent: 0, parameters: [] }])] },
    { id: 3, name: 'Operand', note: '', x: 2, y: 0, pages: [page([{ code: Cmd.ControlVariables, indent: 0, parameters: [1, 1, 0, 4, 'level()'] }, { code: 0, indent: 0, parameters: [] }])] },
    { id: 4, name: 'Plain', note: '', x: 0, y: 1, pages: [page([{ code: Cmd.ControlVariables, indent: 0, parameters: [1, 1, 0, 0, 5] }, { code: 0, indent: 0, parameters: [] }])] },
  ] as typeof map.events;
  const scripts: string[] = [];
  const back = convertMap(exportMap(map), 1, () => undefined, new Map(), scripts);
  assert.deepEqual(scripts, ['Script', 'Branch', 'Operand']);
  const first = (id: number) => back.events[id]!.pages[0]!.list[0]!;
  assert.deepEqual([1, 2, 3, 4].map((id) => first(id).quarantined === true), [true, true, true, false], 'only script commands wait for approval');
  // Even a file claiming its scripts were approved gets them in quarantine.
  const claimed = exportMap(map) as { events: { pages: { list: { quarantined?: boolean }[] }[] }[] };
  claimed.events[1]!.pages[0]!.list[0]!.quarantined = false;
  assert.equal(convertMap(claimed, 1, () => undefined, new Map()).events[1]!.pages[0]!.list[0]!.quarantined, true);
});

// --- Project import through the API ---------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  for (const f of ['img/tilesets/ImportTest_A2.png', 'img/characters/ImportHero.png']) {
    const full = join(PATHS.uploads, f);
    if (existsSync(full)) rmSync(full);
  }
});

test('an administrator imports a zipped project: tilesets, tree, maps, resources and a report', async () => {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: 'Importer',
    email: 'importer@example.com',
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  const csrf = await client.csrf('/characters');

  const flags = new Array(8192).fill(0);
  flags[TILE_ID_A2] = 0x0f;
  const map = (displayName: string, events: unknown[]) => ({
    width: 3, height: 2, tilesetId: 7, displayName, data: new Array(3 * 2 * 6).fill(0).map((_, i) => (i < 6 ? TILE_ID_A2 : 0)),
    events, bgm: { name: '', volume: 90, pitch: 100, pan: 0 }, parallaxName: '', note: '', encounterList: [], battleback1Name: '',
  });
  const page = (list: unknown[]) => ({ ...createPage(), list });
  const zip = makeZip({
    'MyGame/data/Tilesets.json': JSON.stringify([null, { id: 7, name: 'Imported', mode: 1, tilesetNames: ['', 'ImportTest_A2', '', '', '', '', '', '', ''], flags, note: '' }]),
    'MyGame/data/MapInfos.json': JSON.stringify([null, { id: 1, name: 'Town', parentId: 0, order: 1, expanded: true }, { id: 2, name: 'Cave', parentId: 1, order: 1, expanded: true }]),
    'MyGame/data/Map001.json': JSON.stringify(map('Town', [null, { id: 1, name: 'Door', note: '', x: 1, y: 1, pages: [page([
      { code: Cmd.TransferPlayer, indent: 0, parameters: [0, 2, 0, 0, 2, 0] },
      { code: 132, indent: 0, parameters: [{ name: '', volume: 90, pitch: 100, pan: 0 }] },
      { code: 356, indent: 0, parameters: ['SomePlugin run'] },
      { code: 0, indent: 0, parameters: [] },
    ])] }])),
    'MyGame/data/Map002.json': JSON.stringify(map('Cave', [null])),
    'MyGame/data/Actors.json': '[]',
    'MyGame/img/tilesets/ImportTest_A2.png': fakePng(768, 576),
    'MyGame/img/characters/ImportHero.png': fakePng(576, 384),
    'MyGame/img/battlebacks1/Grass.png': fakePng(1000, 740),
  });
  const res = await client.request('/api/editor/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, body: new Uint8Array(zip) });
  assert.equal(res.status, 200);
  const { report } = (await res.json()) as { report: { maps: number; tilesets: number; images: number; warnings: { key: string; params?: Record<string, unknown> }[]; mapIds: Record<string, number> } };
  assert.equal(report.tilesets, 1);
  assert.equal(report.maps, 2);
  assert.equal(report.images, 2);
  const keys = report.warnings.map((w) => w.key);
  assert.ok(keys.includes('import.warning.unsupported_command'));
  assert.ok(keys.includes('import.warning.plugin_command'));
  assert.ok(keys.includes('import.warning.folder_ignored'));
  assert.ok(keys.includes('import.warning.database_file'));

  const town = server.ctx.maps.get(report.mapIds[1]!)!;
  const cave = server.ctx.maps.info(report.mapIds[2]!)!;
  assert.equal(cave.parentId, report.mapIds[1], 'the tree structure is kept');
  const transfer = town.events[1]!.pages[0]!.list[0]!;
  assert.equal(transfer.parameters[1], report.mapIds[2], 'transfers point to the new map id');
  const tileset = server.ctx.gameData.get('tileset', town.tilesetId)!;
  assert.equal(tileset.name, 'Imported');
  assert.equal(tileset.flags[TILE_ID_A2], 0x0f);
  assert.equal(tileAt(town, 0, 0, 0), TILE_ID_A2);
  assert.ok(server.ctx.resources.all().some((r) => r.id === 'tilesets/ImportTest_A2' && r.origin === 'uploaded'));

  // Export of the imported map.
  const exported = await client.request(`/api/editor/maps/${report.mapIds[1]}/export`);
  assert.match(exported.headers.get('content-disposition') ?? '', /Map\d{3}\.json/);
  assert.equal(((await exported.json()) as { displayName: string }).displayName, 'Town');
});

test('a map whose parent is missing from the archive is imported at the root of the tree', async () => {
  const client = new TestClient(server.url);
  await client.post('/login', { _csrf: await client.csrf('/login'), username: 'Importer', password: 'secret password' });
  const csrf = await client.csrf('/characters');
  const map = { width: 2, height: 2, tilesetId: 1, displayName: 'Child', data: new Array(2 * 2 * 6).fill(0), events: [null, { id: 1, name: 'Door', note: '', x: 0, y: 0, pages: [{ ...createPage(), list: [{ code: Cmd.TransferPlayer, indent: 0, parameters: [0, 1, 0, 0, 2, 0] }, { code: 0, indent: 0, parameters: [] }] }] }] };
  const zip = makeZip({
    'P/data/MapInfos.json': JSON.stringify([null, { id: 1, name: 'Missing parent', parentId: 0, order: 1 }, { id: 2, name: 'Orphan', parentId: 1, order: 1 }]),
    'P/data/Map002.json': JSON.stringify(map),
  });
  const res = await client.request('/api/editor/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, body: new Uint8Array(zip) });
  assert.equal(res.status, 200);
  const { report } = (await res.json()) as { report: { maps: number; mapIds: Record<string, number>; warnings: { key: string }[] } };
  assert.equal(report.maps, 1);
  assert.ok(report.warnings.some((w) => w.key === 'import.warning.map_missing'));
  assert.equal(report.mapIds[1], undefined, 'no id is reserved for a map that is not in the archive');
  const orphan = server.ctx.maps.info(report.mapIds[2]!)!;
  assert.equal(orphan.parentId, 0, 'shown at the root instead of under a map that does not exist');
  const transfer = server.ctx.maps.get(orphan.id)!.events[1]!.pages[0]!.list[0]!;
  assert.equal(transfer.parameters[1], 0, 'a transfer to a map outside the archive is disabled (its id would name an unrelated map)');
  assert.ok(report.warnings.some((w) => w.key === 'import.warning.transfer_outside'), 'and the report says which events have one');
});

test('the items, equipment and enemies named by imported maps are those of the archive, under their new ids', async () => {
  const client = new TestClient(server.url);
  await client.post('/login', { _csrf: await client.csrf('/login'), username: 'Importer', password: 'secret password' });
  const csrf = await client.csrf('/characters');
  const nextItem = server.ctx.gameData.nextId('item');
  const nextEnemy = server.ctx.gameData.nextId('enemy');
  const command = (code: number, parameters: unknown[]) => ({ code, indent: 0, parameters });
  const conditions = { ...createPage().conditions, itemValid: true, itemId: 2 };
  const map = {
    width: 2, height: 2, tilesetId: 1, displayName: 'Shop', data: new Array(2 * 2 * 6).fill(0),
    mmo: { type: 'field', pvp: false, instance: false, spawns: [{ enemyId: 1, count: 2, region: 0 }, { enemyId: 9, count: 1, region: 0 }] },
    events: [null, { id: 1, name: 'Merchant', note: '', x: 0, y: 0, pages: [{ ...createPage(), conditions, list: [
      command(Cmd.ChangeItems, [2, 0, 0, 1]),
      command(Cmd.If, [BranchType.Item, 1]),
      command(Cmd.ShopProcessing, [0, 2, 0, 0, false]),
      command(Cmd.ShopItem, [0, 1, 0, 0]),
      command(Cmd.BattleProcessing, [0, 1, false, false]),
      // No weapon file in the archive: the number is the game's own.
      command(Cmd.ChangeWeapons, [1, 0, 0, 1]),
      command(Cmd.ChangeItems, [7, 0, 0, 1]),
      command(0, []),
    ] }] }],
  };
  const zip = makeZip({
    'P/data/MapInfos.json': JSON.stringify([null, { id: 1, name: 'Shop', parentId: 0, order: 1 }]),
    'P/data/Map001.json': JSON.stringify(map),
    'P/data/Items.json': JSON.stringify([null, { id: 1, name: 'Herb', price: 10 }, { id: 2, name: 'Elixir', price: 500 }]),
    'P/data/Enemies.json': JSON.stringify([null, { id: 1, name: 'Wolf', params: [50, 0, 8, 4, 0, 0, 5, 0], exp: 3, gold: 2 }]),
  });
  const res = await client.request('/api/editor/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, body: new Uint8Array(zip) });
  assert.equal(res.status, 200);
  const { report } = (await res.json()) as { report: { mapIds: Record<string, number>; warnings: { key: string; params?: Record<string, unknown> }[] } };
  const [herb, elixir, wolf] = [nextItem, nextItem + 1, nextEnemy];
  assert.equal(server.ctx.gameData.get('item', elixir)?.name, 'Elixir');
  assert.equal(server.ctx.gameData.get('enemy', wolf)?.name, 'Wolf');
  const imported = server.ctx.maps.get(report.mapIds[1]!)!;
  const page = imported.events[1]!.pages[0]!;
  assert.deepEqual(page.list.slice(0, 7).map((c) => c.parameters), [
    [elixir, 0, 0, 1],
    [BranchType.Item, herb],
    [0, elixir, 0, 0, false],
    [0, herb, 0, 0],
    [0, wolf, false, false],
    [1, 0, 0, 1],
    [0, 0, 0, 1],
  ]);
  assert.equal(page.conditions.itemId, elixir, 'page conditions too');
  assert.deepEqual(imported.mmo.spawns, [{ enemyId: wolf, count: 2, region: 0 }], 'a spawn of an enemy missing from the archive is removed');
  const warning = (key: string) => report.warnings.find((w) => w.key === key)?.params;
  assert.deepEqual(warning('import.warning.records_outside'), { id: report.mapIds[1], events: 'Merchant' });
  assert.deepEqual(warning('import.warning.spawns_outside'), { id: report.mapIds[1], count: 1 });
});

test('an import that fails leaves nothing behind: no tileset, map, record or file', async () => {
  const client = new TestClient(server.url);
  await client.post('/login', { _csrf: await client.csrf('/login'), username: 'Importer', password: 'secret password' });
  const csrf = await client.csrf('/characters');
  const map = { width: 2, height: 2, tilesetId: 1, displayName: 'Lost', data: new Array(2 * 2 * 6).fill(0), events: [null] };
  const zip = makeZip({
    'P/data/Tilesets.json': JSON.stringify([null, { id: 1, name: 'Never added', mode: 1, tilesetNames: [], flags: [] }]),
    'P/data/MapInfos.json': JSON.stringify([null, { id: 1, name: 'Lost', parentId: 0, order: 1 }]),
    'P/data/Map001.json': JSON.stringify(map),
    'P/data/Items.json': JSON.stringify([null, { id: 1, name: 'Never added', price: 1 }]),
    'P/img/characters/FailedImport.png': fakePng(576, 384),
  });
  const counts = () => ({ tilesets: server.ctx.gameData.count('tileset'), items: server.ctx.gameData.count('item'), maps: server.ctx.maps.count() });
  const before = counts();
  const maps = server.ctx.maps;
  const save = maps.saveWithVersion.bind(maps);
  // The disk fills up while the maps are written.
  maps.saveWithVersion = () => {
    throw new Error('SQLITE_FULL');
  };
  const errors = console.error;
  console.error = () => undefined;
  try {
    const res = await client.request('/api/editor/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, body: new Uint8Array(zip) });
    assert.equal(res.status, 500);
  } finally {
    maps.saveWithVersion = save;
    console.error = errors;
  }
  assert.deepEqual(counts(), before);
  assert.ok(!server.ctx.gameData.list('tileset').some((t) => t.name === 'Never added'), 'the cache holds no record of the cancelled transaction');
  assert.ok(!existsSync(join(PATHS.uploads, 'img/characters/FailedImport.png')), 'the file written is removed');
  assert.ok(!server.ctx.resources.all().some((r) => r.id === 'characters/FailedImport'));
});

test('calls to common events of an imported map are disabled: the common events of the archive are not imported', () => {
  const raw = { width: 1, height: 1, data: [], events: [null, { id: 1, name: 'Healer', x: 0, y: 0, pages: [{ ...createPage(), list: [{ code: Cmd.CommonEvent, indent: 0, parameters: [3] }, { code: 0, indent: 0, parameters: [] }] }] }] };
  const calls: string[] = [];
  const map = convertMap(raw, 1, () => undefined, new Map(), [], [], calls);
  assert.equal(map.events[1]!.pages[0]!.list[0]!.parameters[0], 0, 'its number would name an unrelated common event of the game');
  assert.deepEqual(calls, ['Healer']);
  assert.equal(convertMap(raw, 1, () => undefined, new Map()).events[1]!.pages[0]!.list[0]!.parameters[0], 3, 'kept when the caller does not ask');
});

test('the import report only lists commands the interpreter really ignores', () => {
  for (const code of [101, 102, 111, 121, 122, 123, 205, 213, 230, 302, 402, 404, 411, 412, 1001, 1020]) assert.ok(SUPPORTED_COMMANDS.has(code), `command ${code} is run by the interpreter`);
  for (const code of [132, 340, 342]) assert.ok(!SUPPORTED_COMMANDS.has(code), `command ${code} is ignored`);
});

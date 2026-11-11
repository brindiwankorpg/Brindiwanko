/**
 * @file Tests of the storage foundations: pragmas, migrations bookkeeping,
 * idempotent seed (including default tilesets added later, and deleted demo
 * content that stays deleted) and the settings repository.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { scheduleBackups } from '../server/db/backups.js';
import { openDatabase } from '../server/db/database.js';
import { GameDataRepository } from '../server/db/game-data.js';
import { MapRepository } from '../server/db/maps.js';
import { listMigrations, migrate } from '../server/db/migrate.js';
import { seed } from '../server/db/seed.js';
import { SettingsRepository } from '../server/db/settings.js';
import { PATHS } from '../server/paths.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';
import { TILE_ID_C, TILE_ID_D } from '../shared/tiles.js';

test('migrations apply once and are recorded', () => {
  const db = openDatabase(':memory:');
  const first = migrate(db, PATHS.migrations);
  assert.deepEqual(first, listMigrations(PATHS.migrations).map((m) => m.version));
  assert.deepEqual(migrate(db, PATHS.migrations), [], 'second run applies nothing');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('seed fills defaults without overwriting edited values', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const settings = new SettingsRepository(db);
  assert.equal(settings.get('gameTitle', ''), DEFAULT_SETTINGS.gameTitle);
  settings.set('gameTitle', 'My World');
  seed(db);
  assert.equal(settings.get('gameTitle', ''), 'My World');
});

test('secrets are generated once and stable', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  const settings = new SettingsRepository(db);
  const a = settings.secret('session');
  assert.ok(a.length >= 32);
  assert.equal(settings.secret('session'), a);
});

test('new default tilesets and sheets reach older databases once', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const data = new GameDataRepository(db);
  const settings = new SettingsRepository(db);
  const byName = (name: string) => data.list('tileset').find((t) => t.name === name);
  assert.ok(byName('Jungle') && byName('Sea'), 'biome tilesets are seeded');
  assert.equal(byName('Inside')!.tilesetNames[6], 'Inside_C');

  // A database created before the biomes and the furniture sheet.
  const inside = byName('Inside')!;
  const furnitureFlags = inside.flags.slice(TILE_ID_C, TILE_ID_D);
  data.save('tileset', { ...inside, tilesetNames: inside.tilesetNames.map((n, i) => (i === 6 ? '' : n)), flags: inside.flags.map((f, i) => (i >= TILE_ID_C && i < TILE_ID_D ? 0 : f)) });
  data.remove('tileset', byName('Jungle')!.id);
  settings.set('seededTilesets', []);
  seed(db);
  assert.ok(byName('Jungle'), 'the missing biome is added');
  assert.equal(byName('Inside')!.tilesetNames[6], 'Inside_C', 'the furniture sheet fills the empty slot');
  assert.deepEqual(byName('Inside')!.flags.slice(TILE_ID_C, TILE_ID_D), furnitureFlags);

  // Once offered, a deleted tileset stays deleted.
  data.remove('tileset', byName('Jungle')!.id);
  seed(db);
  assert.equal(byName('Jungle'), undefined);
});

test('demo content deleted by the creator stays deleted at the next start', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const data = new GameDataRepository(db);
  assert.ok(data.count('quest') > 0 && data.count('raid') > 0 && data.count('state') > 0);
  for (const type of ['quest', 'raid', 'state', 'enemy'] as const) for (const r of data.list(type)) data.remove(type, r.id);
  seed(db);
  for (const type of ['quest', 'raid', 'state', 'enemy'] as const) assert.equal(data.count(type), 0, type);

  // A database from before this rule received every kind that holds records: an empty kind is offered once more.
  new SettingsRepository(db).set('seededContent', []);
  seed(db);
  assert.ok(data.count('quest') > 0, 'offered once');
  for (const r of data.list('quest')) data.remove('quest', r.id);
  seed(db);
  assert.equal(data.count('quest'), 0);
});

test('old logs are deleted once a day, even when the backups fail', async (t) => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  const insert = db.prepare("INSERT INTO connection_log (account_id, event, ip, created_at) VALUES (1, 'login', '198.51.100.2', datetime('now', ?))");
  insert.run('-100 days');
  insert.run('-1 days');
  // Backups go to a folder that cannot be created (under a file).
  const file = join(mkdtempSync(join(tmpdir(), 'brindiwanko-')), 'not-a-folder');
  writeFileSync(file, '');
  const errors = console.error;
  console.error = () => undefined;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const stop = scheduleBackups(db, join(file, 'backups'), null, () => ({ hour: 0, keep: 1 }));
  try {
    t.mock.timers.tick(61_000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.prepare('SELECT COUNT(*) FROM connection_log').pluck().get(), 1, 'only the recent line is left');
  } finally {
    stop();
    console.error = errors;
    rmSync(dirname(file), { recursive: true, force: true });
  }
});

test('a map save that fails leaves the stored map in memory, not the refused one', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const maps = new MapRepository(db);
  const info = maps.info(1)!;
  const stored = maps.get(1)!;
  maps.saveWithVersion(info, { ...stored, displayName: 'First edit' }, null);
  // The history cannot be written (full disk...): the whole save is rolled back.
  db.exec("CREATE TRIGGER no_history BEFORE INSERT ON map_versions BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  const heard: string[] = [];
  maps.onChange((_id, map) => heard.push(map?.displayName ?? ''));
  assert.throws(() => maps.saveWithVersion(info, { ...stored, displayName: 'Refused edit' }, null), /disk full/);
  assert.equal(maps.get(1)!.displayName, 'First edit', 'memory matches the database');
  assert.equal(new MapRepository(db).get(1)!.displayName, 'First edit');
  assert.deepEqual(heard, [], 'nobody heard of the refused content');
  db.close();
});

test('records written by a transaction that fails never stay in memory', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const data = new GameDataRepository(db);
  const item = { ...data.get('item', 1)!, name: 'Never stored' };
  assert.throws(() =>
    db.transaction(() => {
      data.save('item', item);
      // Read inside the transaction: the uncommitted record is seen there...
      assert.equal(data.get('item', 1)!.name, 'Never stored');
      throw new Error('disk full');
    })(),
  );
  // ...but not once it is rolled back.
  assert.notEqual(data.get('item', 1)!.name, 'Never stored');
  db.close();
});

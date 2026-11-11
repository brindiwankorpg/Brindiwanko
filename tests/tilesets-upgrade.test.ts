/**
 * @file Default tileset sheets: the first tile of every plain sheet (B–E) and of A5 stays blank,
 * the palette has no hole, the demo village uses the door where it now sits, and a database made
 * before these rules sees its maps follow the moved tiles once (and only once), with the flags of
 * the tiles drawn since.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_MAPS } from '../server/db/demo-map.js';
import { openDatabase } from '../server/db/database.js';
import { GameDataRepository } from '../server/db/game-data.js';
import { MapRepository } from '../server/db/maps.js';
import { migrate } from '../server/db/migrate.js';
import { seed } from '../server/db/seed.js';
import { SettingsRepository } from '../server/db/settings.js';
import { PATHS } from '../server/paths.js';
import { FLAG_STAR, a5TileId, plainTileId } from '../shared/tiles.js';

interface DefaultTileset {
  name: string;
  flags: number[];
  moved: { from: number; to: number }[];
  added: number[];
}
const defaults = (JSON.parse(readFileSync(join(PATHS.assets, 'data', 'tilesets.json'), 'utf8')) as { tilesets: DefaultTileset[] }).tilesets;
const outside = defaults.find((t) => t.name === 'Outside')!;
const doorMove = outside.moved.find((m) => m.from === plainTileId(1, 0, 0))!;

test('the first tile of each sheet is blank and never blocks; moved tiles are listed', () => {
  for (const t of defaults) {
    assert.equal(t.flags[plainTileId(0, 0, 0)], FLAG_STAR, `${t.name} B(0,0)`);
    assert.ok(t.moved.some((m) => m.from === a5TileId(0, 0)), `${t.name}: the A5 void tile moved`);
    assert.ok(t.added.length >= 20, `${t.name}: new objects`);
  }
  assert.ok(doorMove, 'the wooden door left C(0,0)');
  assert.equal(outside.flags[plainTileId(1, 0, 0)], FLAG_STAR);
});

test('the demo village uses the door at its new place', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const village = new MapRepository(db).get(DEMO_MAPS.village)!;
  assert.ok(village.data.includes(doorMove.to), 'doors are drawn');
  assert.ok(!village.data.includes(doorMove.from), 'no tile on the blank C(0,0)');
});

test('an older database: maps follow the moved tiles once, new tiles get their flags', () => {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db);
  const data = new GameDataRepository(db);
  const maps = new MapRepository(db);
  const settings = new SettingsRepository(db);

  // Make it look like a database from before: doors on C(0,0), new tiles without flags, upgrades not offered.
  const info = maps.info(DEMO_MAPS.village)!;
  const village = maps.get(DEMO_MAPS.village)!;
  village.data = village.data.map((v) => (v === doorMove.to ? doorMove.from : v));
  maps.save(info, village);
  const tileset = data.list('tileset').find((t) => t.name === 'Outside')!;
  const flags = [...tileset.flags];
  flags[doorMove.from] = 0;
  for (const id of outside.added) flags[id] = 0;
  data.save('tileset', { ...tileset, flags });
  settings.set('seededTilesets', settings.get<string[]>('seededTilesets', []).filter((k) => !k.startsWith('Outside#')));

  seed(db);
  // A fresh repository, as the server opens after the start-up seed (the one above keeps a cache).
  const upgraded = new MapRepository(db).get(DEMO_MAPS.village)!;
  assert.ok(!upgraded.data.includes(doorMove.from), 'doors moved off C(0,0)');
  assert.ok(upgraded.data.includes(doorMove.to));
  const after = data.list('tileset').find((t) => t.name === 'Outside')!;
  assert.equal(after.flags[doorMove.to], 0, 'the door keeps its (walkable) flags');
  const blocking = outside.added.find((id) => outside.flags[id] !== 0)!;
  assert.equal(after.flags[blocking], outside.flags[blocking], 'new tiles receive their default flags');

  // Once only: a creator who paints C(0,0) again afterwards keeps it.
  const fresh = new MapRepository(db);
  const again = fresh.get(DEMO_MAPS.village)!;
  again.data[0] = doorMove.from;
  fresh.save(info, again);
  seed(db);
  assert.equal(new MapRepository(db).get(DEMO_MAPS.village)!.data[0], doorMove.from);
});

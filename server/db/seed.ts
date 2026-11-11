/**
 * @file Starter data for a brand-new database.
 *
 * Runs at every startup but writes each kind of content only once, so it is idempotent,
 * never overwrites content edited in the admin panel and never brings back what was deleted: system settings, the
 * default classes, skills, items, equipment, enemies, states and quests, the default tilesets (sheet names and flags produced by
 * the graphics generator in `assets/data/tilesets.json`) and the starting village.
 * Default tilesets and sheets added by later versions of the engine (new
 * biomes, extra furniture) are offered once to existing databases too.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TilesetData } from '../../shared/database.js';
import type { Locale } from '../../shared/i18n.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { TILE_ID_A1, TILE_ID_A2, TILE_ID_A3, TILE_ID_A4, TILE_ID_A5, TILE_ID_B, TILE_ID_C, TILE_ID_D, TILE_ID_E, TILE_ID_MAX } from '../../shared/tiles.js';
import { PATHS } from '../paths.js';
import type { Db } from './database.js';
import { DEMO_MAPS, buildDemoDungeon, buildDemoForest, buildDemoHouse, buildDemoVillage } from './demo-map.js';
import { GameDataRepository } from './game-data.js';
import { MapRepository } from './maps.js';
import { DEFAULT_ARMORS, DEFAULT_CLASSES, DEFAULT_ENEMIES, DEFAULT_ITEMS, DEFAULT_QUESTS, DEFAULT_RAIDS, DEFAULT_SKILLS, DEFAULT_STATES, DEFAULT_WEAPONS } from './seed-data.js';
import { localize, localizeMap } from './seed-translations.js';
import { SettingsRepository } from './settings.js';

/** Setting holding the language of the demo content, chosen when the server first ran. */
export const CONTENT_LANGUAGE_KEY = 'contentLanguage';

/** Reads the default tilesets written by `npm run assets:build`. */
function defaultTilesets(): TilesetData[] {
  const file = join(PATHS.assets, 'data', 'tilesets.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { tilesets: TilesetData[] }).tilesets;
}

/** Tile id range of each sheet slot of a tileset, in `tilesetNames` order (A1..E). */
const SLOT_RANGES: [number, number][] = [
  [TILE_ID_A1, TILE_ID_A2],
  [TILE_ID_A2, TILE_ID_A3],
  [TILE_ID_A3, TILE_ID_A4],
  [TILE_ID_A4, TILE_ID_MAX],
  [TILE_ID_A5, TILE_ID_A5 + 128],
  [TILE_ID_B, TILE_ID_C],
  [TILE_ID_C, TILE_ID_D],
  [TILE_ID_D, TILE_ID_E],
  [TILE_ID_E, TILE_ID_E + 256],
];

/** Setting listing the default tilesets and sheets already offered (`Name` and `Name/Sheet`). */
const OFFERED_KEY = 'seededTilesets';

/** Keys of everything a default tileset brings. */
function offerKeys(t: TilesetData): string[] {
  return [t.name, ...t.tilesetNames.filter(Boolean).map((n) => `${t.name}/${n}`)];
}

/**
 * Offers each default tileset or sheet once: a missing tileset is added, and an
 * empty sheet slot of an existing default tileset receives the new sheet with
 * its flags. Anything already offered is never re-added, so a creator can
 * delete or change them freely.
 */
function offerDefaultTilesets(data: GameDataRepository, settings: SettingsRepository, maps: MapRepository, defaults: TilesetData[]): void {
  const offered = new Set(settings.get<string[]>(OFFERED_KEY, []));
  for (const t of defaults) {
    const existing = data.list('tileset').find((e) => e.name === t.name || (e.id === t.id && e.tilesetNames[5] === t.tilesetNames[5]));
    const upgradeKeys = upgradeKeysOf(t);
    if (!existing) {
      if (!offered.has(t.name)) data.save('tileset', { ...t, id: data.get('tileset', t.id) ? data.nextId('tileset') : t.id });
    } else {
      upgradeTileset(data, maps, existing, t, offered);
      const names = [...existing.tilesetNames];
      const flags = [...existing.flags];
      let changed = false;
      t.tilesetNames.forEach((sheet, slot) => {
        if (!sheet || names[slot] || offered.has(`${t.name}/${sheet}`)) return;
        names[slot] = sheet;
        const [from, to] = SLOT_RANGES[slot]!;
        for (let id = from; id < to; id++) flags[id] = t.flags[id] ?? 0;
        changed = true;
      });
      if (changed) data.save('tileset', { ...existing, tilesetNames: names, flags });
    }
    for (const key of [...offerKeys(t), ...upgradeKeys]) offered.add(key);
  }
  settings.set(OFFERED_KEY, [...offered]);
}

/** Sheet slot (0 = A1 … 8 = E) holding a tile id. */
const plainSlot = (id: number): number => SLOT_RANGES.findIndex(([from, to]) => id >= from && id < to);

/** Keys of the one-time upgrades a default tileset brings (moved tiles, new tiles). */
function upgradeKeysOf(t: TilesetData & { moved?: { from: number; to: number }[] }): string[] {
  return [...(t.moved ?? []).map((m) => `${t.name}#move:${m.from}>${m.to}`), `${t.name}#added:${defaultAddedVersion(t)}`];
}

/** Identifies the set of tiles added by this engine version (changes when new tiles are drawn). */
function defaultAddedVersion(t: TilesetData & { added?: number[] }): string {
  return String((t.added ?? []).length);
}

/**
 * Brings an existing default tileset up to the current sheets, once per change:
 * - a tile moved by the engine (the first tile of every sheet is now kept blank) follows on every map
 *   using this tileset, and keeps the flags the creator gave it;
 * - tiles drawn for the first time receive their default flags (walkable, blocking, above characters…),
 *   unless the creator already set some.
 * Only sheets that are still the default ones are touched.
 */
function upgradeTileset(data: GameDataRepository, maps: MapRepository, existing: TilesetData, t: TilesetData & { moved?: { from: number; to: number }[]; added?: number[] }, offered: Set<string>): void {
  const sameSheet = (id: number) => {
    const slot = plainSlot(id);
    return slot >= 0 && !!t.tilesetNames[slot] && existing.tilesetNames[slot] === t.tilesetNames[slot];
  };
  const flags = [...existing.flags];
  let changed = false;
  const moves = new Map<number, number>();
  for (const m of t.moved ?? []) {
    if (offered.has(`${t.name}#move:${m.from}>${m.to}`) || !sameSheet(m.from)) continue;
    moves.set(m.from, m.to);
    flags[m.to] = flags[m.from] ?? t.flags[m.to] ?? 0;
    flags[m.from] = t.flags[m.from] ?? 0;
    changed = true;
  }
  if (!offered.has(`${t.name}#added:${defaultAddedVersion(t)}`)) {
    for (const id of t.added ?? []) {
      if (!sameSheet(id) || (flags[id] ?? 0) !== 0) continue;
      flags[id] = t.flags[id] ?? 0;
      changed = true;
    }
  }
  if (changed) data.save('tileset', { ...existing, flags });
  if (moves.size === 0) return;
  for (const info of maps.infos()) {
    const map = maps.get(info.id);
    if (!map || map.tilesetId !== existing.id) continue;
    let touched = false;
    // Tile layers only (the last two layers hold shadows and regions).
    const tileCells = map.width * map.height * 4;
    for (let i = 0; i < tileCells; i++) {
      const to = moves.get(map.data[i]!);
      if (to !== undefined) {
        map.data[i] = to;
        touched = true;
      }
    }
    for (const event of map.events) {
      for (const page of event?.pages ?? []) {
        const to = moves.get(page.image.tileId);
        if (to !== undefined) {
          page.image.tileId = to;
          touched = true;
        }
      }
    }
    if (touched) maps.save(info, map);
  }
}

/**
 * Setting listing the kinds of demo content already written (`class`, `quest`, `map`…). Each kind is
 * written once: a creator who deletes every quest or the demo raid does not see them come back at the
 * next start. A kind added by a later version of the engine is still offered once to existing databases.
 */
const SEEDED_KEY = 'seededContent';

/** Setting marking the one-time repair of the demo states' HP / MP rates. */
const STATE_RATES_KEY = 'repairedStateRates';

/**
 * Older versions gave a state without HP / MP rates the lowest one (−100 % per second), so the demo
 * states drained or killed whoever they touched ("Cri de guerre" knocked its own user out). Once, the
 * demo states still showing that rate get their intended one back; any other rate is left alone.
 */
function repairStateRates(data: GameDataRepository, settings: SettingsRepository): void {
  if (settings.get(STATE_RATES_KEY, false)) return;
  for (const def of DEFAULT_STATES) {
    const state = data.get('state', def.id);
    if (!state) continue;
    const hpPerSecond = state.hpPerSecond === -100 ? def.hpPerSecond : state.hpPerSecond;
    const mpPerSecond = state.mpPerSecond === -100 ? def.mpPerSecond : state.mpPerSecond;
    if (hpPerSecond !== state.hpPerSecond || mpPerSecond !== state.mpPerSecond) data.save('state', { ...state, hpPerSecond, mpPerSecond });
  }
  settings.set(STATE_RATES_KEY, true);
}

/**
 * Inserts default data that is not present yet.
 *
 * The demo content (classes, items, quests, maps, dialogues, terms) is written in the content
 * language, chosen at the first launch and then stored in the `contentLanguage` setting. A
 * database that already holds content, and has no such setting, is a French one.
 * @param db - Migrated connection.
 * @param language - Language to use if this database is brand new (default: French).
 */
export function seed(db: Db, language: Locale = 'fr'): void {
  const settings = new SettingsRepository(db);
  const data = new GameDataRepository(db);
  const maps = new MapRepository(db);
  db.transaction(() => {
    let lang = settings.get<Locale | null>(CONTENT_LANGUAGE_KEY, null);
    if (lang === null) {
      lang = data.count('class') === 0 && maps.count() === 0 ? language : 'fr';
      settings.set(CONTENT_LANGUAGE_KEY, lang);
    }
    const L = <T>(value: T): T => localize(value, lang);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!settings.has(key)) settings.set(key, L(value));
    }
    const seeded = new Set(settings.get<string[]>(SEEDED_KEY, []));
    // A kind is written when it was never offered and is still empty (a database from before this
    // setting has already received every kind that holds records).
    const offer = (kind: string, empty: boolean, write: () => void) => {
      if (seeded.has(kind)) return;
      if (empty) write();
      seeded.add(kind);
    };
    offer('class', data.count('class') === 0, () => DEFAULT_CLASSES.forEach((r) => data.save('class', L(r))));
    offer('skill', data.count('skill') === 0, () => DEFAULT_SKILLS.forEach((r) => data.save('skill', L(r))));
    offer('item', data.count('item') === 0, () => DEFAULT_ITEMS.forEach((r) => data.save('item', L(r))));
    offer('weapon', data.count('weapon') === 0, () => DEFAULT_WEAPONS.forEach((r) => data.save('weapon', L(r))));
    offer('armor', data.count('armor') === 0, () => DEFAULT_ARMORS.forEach((r) => data.save('armor', L(r))));
    offer('enemy', data.count('enemy') === 0, () => DEFAULT_ENEMIES.forEach((r) => data.save('enemy', L(r))));
    offer('state', data.count('state') === 0, () => DEFAULT_STATES.forEach((r) => data.save('state', L(r))));
    repairStateRates(data, settings);
    offer('quest', data.count('quest') === 0, () => DEFAULT_QUESTS.forEach((r) => data.save('quest', L(r))));
    offerDefaultTilesets(data, settings, maps, defaultTilesets());
    offer('map', maps.count() === 0, () => {
      const demo = (id: number, parentId: number, name: string, order: number, map: ReturnType<typeof buildDemoVillage>) =>
        maps.save({ id, parentId, name: L(name), order, expanded: true }, localizeMap(map, lang));
      demo(DEMO_MAPS.village, 0, 'Village', 1, buildDemoVillage());
      demo(DEMO_MAPS.forest, 0, 'Forêt', 2, buildDemoForest());
      demo(DEMO_MAPS.house, DEMO_MAPS.village, 'Maison de Tomas', 1, buildDemoHouse());
      demo(DEMO_MAPS.dungeon, DEMO_MAPS.forest, 'Grotte (donjon)', 1, buildDemoDungeon());
    });
    // A raid needs its map and its boss: on a database created before raids
    // existed, the demo cave and its king are absent, so the demo raid is skipped.
    offer('raid', data.count('raid') === 0, () => {
      for (const r of DEFAULT_RAIDS) if (maps.get(r.mapId) && data.get('enemy', r.bossEnemyId)) data.save('raid', L(r));
    });
    settings.set(SEEDED_KEY, [...seeded]);
  })();
}

/**
 * @file Map numbers are never given twice: after the last map of the tree is deleted, the next one created
 * must not take its number. What still names it (the self switches of the players, the places of the
 * characters, the transfers of other maps) would point to a stranger: a chest opened on the old map
 * showing open on the new one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMap } from '../shared/map.js';
import type { MapInfo } from '../shared/map.js';
import { AccountRepository } from '../server/db/accounts.js';
import { CharacterRepository, type NewCharacter } from '../server/db/characters.js';
import { openDatabase, type Db } from '../server/db/database.js';
import { MapRepository } from '../server/db/maps.js';
import { migrate } from '../server/db/migrate.js';
import { PATHS } from '../server/paths.js';

function database(): Db {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  return db;
}

const info = (id: number): MapInfo => ({ id, parentId: 0, name: `Map ${id}`, order: id, expanded: true });
const character = (accountId: number, name: string, mapId: number): NewCharacter => ({
  accountId, name, classId: 1, appearance: {} as NewCharacter['appearance'], hp: 1, mp: 1, gold: 0, mapId, x: 0, y: 0, direction: 2,
});

test('a new map never takes the number of a deleted one', () => {
  const maps = new MapRepository(database());
  for (const id of [1, 2, 3]) maps.save(info(id), createMap(4, 4, 1));
  assert.equal(maps.nextId(), 4);
  maps.delete(3);
  assert.equal(maps.nextId(), 4, 'the number of the last map deleted is not given again');
  // The editor creates the map with the number it was given: the next one follows.
  maps.save(info(4), createMap(4, 4, 1));
  maps.delete(4);
  maps.delete(2);
  assert.equal(maps.nextId(), 5);
});

test('the self switches of a deleted map go with it, and do not reach the map created after it', () => {
  const db = database();
  const maps = new MapRepository(db);
  const accounts = new AccountRepository(db);
  const characters = new CharacterRepository(db);
  const account = accounts.create({ username: 'Owner', email: 'owner@example.com', passwordHash: 'x', locale: 'en' });
  const hero = characters.create(character(account.id, 'Hero', 1), 4);
  for (const id of [1, 2]) maps.save(info(id), createMap(4, 4, 1));
  const give = db.prepare('INSERT INTO character_self_switches (character_id, map_id, event_id, letter) VALUES (?, ?, 3, ?)');
  give.run(hero.id, 1, 'A');
  give.run(hero.id, 2, 'A');
  const count = (mapId: number) => db.prepare<[number], number>('SELECT COUNT(*) FROM character_self_switches WHERE map_id = ?').pluck().get(mapId)!;
  maps.delete(2);
  assert.equal(count(2), 0, 'the switches of the deleted map are gone');
  assert.equal(count(1), 1, 'those of the other maps stay');
  const next = maps.nextId();
  maps.save(info(next), createMap(4, 4, 1));
  assert.equal(count(next), 0, 'the new map starts with no chest opened');
});

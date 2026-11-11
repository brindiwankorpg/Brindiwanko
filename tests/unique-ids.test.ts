/**
 * @file Account and character numbers are never given twice: a newcomer must not take the number of a
 * deleted account or character, which the logs (and the game's memory) still use to name it. Otherwise
 * the administration panel shows the newcomer as the author of a former moderator's sanctions, or files
 * the reports made against a deleted character under the newcomer's account.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountRepository } from '../server/db/accounts.js';
import { AdminRepository } from '../server/db/admin.js';
import { CharacterRepository, type NewCharacter } from '../server/db/characters.js';
import { openDatabase, type Db } from '../server/db/database.js';
import { migrate } from '../server/db/migrate.js';
import { PATHS } from '../server/paths.js';

function database(): Db {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  return db;
}

const account = (name: string) => ({ username: name, email: `${name.toLowerCase()}@example.com`, passwordHash: 'x', locale: 'en' });
const character = (accountId: number, name: string): NewCharacter => ({
  accountId, name, classId: 1, appearance: {} as NewCharacter['appearance'], hp: 1, mp: 1, gold: 0, mapId: 1, x: 0, y: 0, direction: 2,
});

test('a new account or character never takes the number of a deleted one', () => {
  const db = database();
  const accounts = new AccountRepository(db);
  const characters = new CharacterRepository(db);
  const admin = new AdminRepository(db);
  const owner = accounts.create(account('Owner'));
  const moderator = accounts.create(account('OldMod'));
  const cheater = characters.create(character(moderator.id, 'Cheater'), 4);
  admin.logAdmin(moderator.id, 'ban', `account:${owner.id}`, { reason: 'abuse' });
  admin.logReport({ id: 999, name: 'Someone' }, { id: cheater.id, name: 'Cheater' }, 'gold duping');
  // The last account (and with it the last character) goes.
  assert.ok(accounts.delete(moderator.id));

  const newcomer = accounts.create(account('Newcomer'));
  const innocent = characters.create(character(newcomer.id, 'Innocent'), 4);
  assert.ok(newcomer.id > moderator.id, 'the deleted account number is not given again');
  assert.ok(innocent.id > cheater.id, 'the deleted character number is not given again');
  // The logs still name the deleted ones, never the newcomer.
  assert.notDeepEqual(admin.logs('admin', 0, 10).map((l) => l.admin), ['Newcomer']);
  assert.deepEqual(admin.logs('reports', newcomer.id, 10), []);
});

test('numbers follow one another, and a refused creation uses none', () => {
  const db = database();
  const accounts = new AccountRepository(db);
  const characters = new CharacterRepository(db);
  const a = accounts.create(account('Alpha'));
  assert.throws(() => accounts.create(account('alpha')));
  const b = accounts.create(account('Bravo'));
  assert.equal(b.id, a.id + 1);
  const first = characters.create(character(a.id, 'First'), 4);
  characters.delete(first.id, a.id);
  const second = characters.create(character(a.id, 'Second'), 4);
  const third = characters.create(character(b.id, 'Third'), 4);
  assert.deepEqual([second.id, third.id], [first.id + 1, first.id + 2]);
});

/**
 * @file Tests of the language chosen at the first launch: the question, the system language and
 * the demo content created in English or in French.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseContentLanguage, isNewDatabase, parseLanguageAnswer, systemLanguage } from '../server/first-run.js';
import { openDatabase } from '../server/db/database.js';
import { GameDataRepository } from '../server/db/game-data.js';
import { MapRepository } from '../server/db/maps.js';
import { migrate } from '../server/db/migrate.js';
import { CONTENT_LANGUAGE_KEY, seed } from '../server/db/seed.js';
import { SettingsRepository } from '../server/db/settings.js';
import { PATHS } from '../server/paths.js';
import type { DatabaseType } from '../shared/database.js';

function seeded(language?: 'fr' | 'en') {
  const db = openDatabase(':memory:');
  migrate(db, PATHS.migrations);
  seed(db, language);
  return { db, data: new GameDataRepository(db), maps: new MapRepository(db), settings: new SettingsRepository(db) };
}

/** Every string of a value, whatever its depth. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

const TYPES: DatabaseType[] = ['class', 'skill', 'item', 'weapon', 'armor', 'enemy', 'state', 'quest', 'raid'];
/** French letters and punctuation; "Léa" is a name, kept as it is. */
const FRENCH = /[éèêëàâçùûôîïœ’«»]/;

test('only EN or FR answers the question, there is no default', () => {
  assert.equal(parseLanguageAnswer(''), null);
  assert.equal(parseLanguageAnswer('  '), null);
  assert.equal(parseLanguageAnswer('EN'), 'en');
  assert.equal(parseLanguageAnswer(' fr '), 'fr');
  assert.equal(parseLanguageAnswer('de'), null);
});

test('the system language is French only for a French system', () => {
  assert.equal(systemLanguage({ LANG: 'fr_FR.UTF-8' }, 'en-US'), 'fr');
  assert.equal(systemLanguage({ LANG: 'en_GB.UTF-8' }, 'fr-FR'), 'en');
  assert.equal(systemLanguage({}, 'fr-FR'), 'fr');
  assert.equal(systemLanguage({}, 'de-DE'), 'en');
});

test('only a database that does not exist yet asks for the language', async () => {
  assert.equal(isNewDatabase(':memory:'), false);
  assert.equal(isNewDatabase(`${PATHS.data}/no-such-database-${Date.now()}.db`), true);
  // An existing database is left alone, and nothing is asked.
  assert.equal(await chooseContentLanguage(':memory:'), undefined);
});

test('a new database gets its demo content in the chosen language, and remembers it', () => {
  const en = seeded('en');
  assert.equal(en.settings.get(CONTENT_LANGUAGE_KEY, ''), 'en');
  assert.equal(en.data.get('class', 1)?.name, 'Warrior');
  assert.equal(en.data.get('item', 1)?.name, 'Potion');
  assert.equal(en.settings.get('currencyName', ''), 'Gold');
  assert.deepEqual(en.maps.infos().map((m) => m.name), ['Village', 'Forest', "Tomas's House", 'Cave (dungeon)']);
  assert.equal(en.maps.get(1)?.displayName, 'Brindiwanko Village');
  const fr = seeded('fr');
  assert.equal(fr.data.get('class', 1)?.name, 'Guerrier');
  assert.equal(fr.settings.get('currencyName', ''), 'Or');
  assert.equal(fr.maps.get(1)?.displayName, 'Village de Brindiwanko');
  // Without a choice (tests, upgrades) the demo stays French.
  assert.equal(seeded().data.get('class', 1)?.name, 'Guerrier');
});

test('the English demo keeps no French wording', () => {
  const { data, maps } = seeded('en');
  const found: string[] = [];
  for (const type of TYPES) for (const record of data.list(type)) found.push(...strings(record));
  for (const info of maps.infos()) {
    const map = maps.get(info.id)!;
    found.push(info.name, map.displayName, ...strings(map.events));
  }
  const french = [...new Set(found.filter((s) => FRENCH.test(s)))].filter((s) => s !== 'Léa');
  assert.deepEqual(french, [], 'French text left in the English demo');
});

test('the language is chosen once: a later start with another one changes nothing', () => {
  const { db, data, settings } = seeded('en');
  seed(db, 'fr');
  assert.equal(settings.get(CONTENT_LANGUAGE_KEY, ''), 'en');
  assert.equal(data.get('class', 1)?.name, 'Warrior');
});

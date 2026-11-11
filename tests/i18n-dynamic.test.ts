/**
 * @file Translation keys built at run time (`db.option.${value}`, `db.tab.${type}`…) cannot be
 * type-checked nor seen by `npm run i18n:check`: a new choice added to a list (an outfit, a trait
 * kind…) without its label showed the raw key in the editor. These tests walk every list the
 * interface turns into such keys and check each label exists in every locale.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { HAIR_STYLES } from '../shared/art/character.js';
import { KIND_GROUPS, SCHEMAS, type Field } from '../shared/database-schema.js';
import { DATABASE_TYPES } from '../shared/database.js';
import { lookup, type Dictionary } from '../shared/i18n.js';
import { PATHS } from '../server/paths.js';

const locales: [string, Dictionary][] = readdirSync(PATHS.locales)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(PATHS.locales, f), 'utf8')) as Dictionary]);

/** Keys missing from at least one locale, as `file: key`. */
function missing(keys: Iterable<string | string[]>): string[] {
  const out: string[] = [];
  for (const [file, dict] of locales) {
    for (const k of keys) {
      // An array lists alternatives: any one of them is enough (a field may have its own wording).
      const choices = Array.isArray(k) ? k : [k];
      if (!choices.some((c) => typeof lookup(dict, c) === 'string')) out.push(`${file}: ${choices.at(-1)}`);
    }
  }
  return out;
}

/** Every select field of the database schemas, groups and lists included. */
function selects(fields: readonly Field[], out: { key: string; options: readonly string[] }[] = []) {
  for (const f of fields) {
    if (f.type === 'select') out.push({ key: f.key, options: f.options });
    if (f.type === 'group' || f.type === 'list') selects(f.fields, out);
  }
  return out;
}

test('every choice of every database list has a label in every language', () => {
  const keys: string[][] = [];
  for (const type of DATABASE_TYPES) {
    for (const s of selects(SCHEMAS[type])) for (const o of s.options) keys.push([`db.option.${s.key}_${o}`, `db.option.${o}`]);
  }
  assert.deepEqual(missing(keys), []);
});

test('database tabs, kind groups and hair styles have a label in every language', () => {
  const keys = [
    ...DATABASE_TYPES.map((t) => `db.tab.${t}`),
    ...Object.values(KIND_GROUPS).flatMap((groups) => groups.map(([family]) => `db.kind_group.${family}`)),
    ...HAIR_STYLES.map((h) => `character_new.hair_style.${h}`),
  ];
  assert.deepEqual(missing(keys), []);
});

test('the themes of the sprite sheets shipped with the game have a label in every language', () => {
  // Same rule as `themeOf` in client/editor/character-picker.ts: the file name without its `!` / `$` flags and number.
  const themes = new Set<string>();
  for (const dir of ['characters', 'faces']) {
    for (const file of readdirSync(join(PATHS.root, 'assets', 'img', dir))) themes.add(file.replace(/\.\w+$/, '').replace(/^[!$]+/, '').replace(/[\s_-]*\d+$/, ''));
  }
  assert.ok(themes.size > 0);
  assert.deepEqual(missing([...themes].map((th) => `editor.theme.${th.toLowerCase()}`)), []);
});

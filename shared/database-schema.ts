/**
 * @file Schema of the editor database.
 *
 * One declaration per record type drives three things:
 * - the editor forms (fields are rendered from the schema);
 * - server-side validation (`normalizeRecord` coerces, clamps and fills every
 *   field, so a stored record always has the full, valid shape);
 * - default values of new records (`defaultRecord`).
 *
 * Field labels are translation keys `db.field.<key>`; option labels are
 * `db.option.<value>`.
 */
import { DEFAULT_APPEARANCE, OUTFITS, sanitizeAppearance } from './art/character.js';
import {
  BOSS_MECHANICS,
  ENEMY_ACTION_CONDITIONS,
  EQUIP_SLOTS,
  OBJECTIVE_KINDS,
  PARAMS,
  noDamage,
  zeroParams,
  type DatabaseType,
  type GameDataTypes,
  type ParamCurve,
  type ParamName,
} from './database.js';
import type { EventCommand } from './events.js';
import { iconIndex } from './icons.js';

/**
 * Shows a field only when a sibling field has one of some values (the value is
 * still stored, with its default, so records keep a fixed shape).
 *
 * A key may be declared several times with different conditions: the first
 * declaration whose condition holds is the one in use (an effect's `value` is
 * an amount, a state or a common event depending on its `kind`). When none
 * holds, the first declaration still gives the stored value its shape.
 */
export interface FieldCondition {
  key: string;
  values: readonly string[];
}

/** Lists of names of the System tab that records point to by index. */
export type SystemList = 'elements' | 'weaponTypes' | 'armorTypes' | 'skillTypes';

/** Field declaration. `label` replaces the key in the label and help translation keys. */
export type Field = FieldBase & { when?: FieldCondition; label?: string };

type FieldBase =
  | { key: string; type: 'text'; max?: number; multiline?: boolean }
  /** A missing value takes `default`, else 0 kept within the bounds. */
  | { key: string; type: 'int'; min: number; max: number; default?: number }
  | { key: string; type: 'number'; min: number; max: number; default?: number }
  | { key: string; type: 'bool' }
  | { key: string; type: 'select'; options: readonly string[] }
  | { key: string; type: 'icon' }
  | { key: string; type: 'resource'; kind: string }
  /**
   * Id of another record. A stored id is kept even when nothing has it any more (0, deleted record):
   * the game ignores it and saving reports it (see `findMissingRef`). `asText` stores the id as a string (trait targets).
   */
  | { key: string; type: 'ref'; ref: DatabaseType; allowNone?: boolean; asText?: boolean }
  /** Index in a list of the System tab (elements, weapon or armor types; 0 = none); `asText` stores it as a string (trait targets). */
  | { key: string; type: 'systemList'; list: SystemList; asText?: boolean }
  /** A switch declared in the Switches tab (ids start at 1; 0 = none when `allowNone`). */
  | { key: string; type: 'switch'; allowNone?: boolean }
  /** Name of a base parameter (`mhp`, `atk`...); an unknown name is stored as `''` and reported on saving. */
  | { key: string; type: 'param' }
  | { key: string; type: 'params' }
  | { key: string; type: 'curves' }
  | { key: string; type: 'group'; fields: Field[] }
  | { key: string; type: 'list'; fields: Field[]; max: number }
  | { key: string; type: 'intList'; min: number; max: number }
  | { key: string; type: 'appearance' }
  | { key: string; type: 'commands' }
  /** A map id (picked from the map list in the editor). */
  | { key: string; type: 'map' }
  /** An event id of the map chosen in the sibling field `mapKey`. */
  | { key: string; type: 'event'; mapKey: string }
  /** Picks a cell of the map chosen in `mapKey` and writes the sibling fields `x` and `y` (stores nothing itself). */
  | { key: string; type: 'cell'; mapKey: string };

const SCOPES = ['none', 'self', 'enemy', 'ally', 'enemies_area', 'allies_area'] as const;
export const TRAIT_KINDS = [
  'param_rate', 'hit_rate', 'evasion', 'critical', 'hp_regen', 'mp_regen',
  'element_rate', 'state_resist', 'attack_element', 'attack_state', 'add_skill', 'exp_rate', 'gold_rate',
] as const;

/** Families of trait and effect kinds, for the "Kind" menus of the editor (`db.kind_group.<family>`). */
export const KIND_GROUPS: Record<'traits' | 'effects', [string, readonly string[]][]> = {
  traits: [
    ['stats', ['param_rate', 'hit_rate', 'evasion', 'critical', 'hp_regen', 'mp_regen']],
    ['resistances', ['element_rate', 'state_resist']],
    ['attack', ['attack_element', 'attack_state']],
    ['skills', ['add_skill']],
    ['gains', ['exp_rate', 'gold_rate']],
  ],
  effects: [
    ['recovery', ['recover_hp', 'recover_mp']],
    ['states', ['add_state', 'remove_state']],
    ['progress', ['gain_xp', 'learn_skill']],
    ['other', ['common_event']],
  ],
};
export const EFFECT_KINDS = ['recover_hp', 'recover_mp', 'add_state', 'remove_state', 'gain_xp', 'learn_skill', 'common_event'] as const;

const kindIs = (...values: string[]) => ({ key: 'kind', values });
const name: Field = { key: 'name', type: 'text', max: 100 };
const description: Field = { key: 'description', type: 'text', max: 500, multiline: true };
const icon: Field = { key: 'icon', type: 'icon' };
/** Free notes of the creator, on every record: found by the editor's search, never read by the game. */
const note: Field = { key: 'note', type: 'text', max: 1000, multiline: true };
/** Traits: the target is a parameter, an element or a state depending on the kind; the value a rate or a bonus. */
const traits: Field = {
  key: 'traits',
  type: 'list',
  max: 30,
  fields: [
    { key: 'kind', type: 'select', options: TRAIT_KINDS },
    { key: 'target', label: 'param', type: 'param', when: kindIs('param_rate') },
    { key: 'target', label: 'element', type: 'systemList', list: 'elements', asText: true, when: kindIs('element_rate', 'attack_element') },
    { key: 'target', label: 'state', type: 'ref', ref: 'state', asText: true, when: kindIs('state_resist', 'attack_state') },
    { key: 'target', label: 'skill', type: 'ref', ref: 'skill', asText: true, when: kindIs('add_skill') },
    { key: 'value', label: 'rate', type: 'number', min: -100, max: 100, default: 1, when: kindIs('param_rate', 'element_rate', 'state_resist', 'exp_rate', 'gold_rate') },
    { key: 'value', label: 'bonus', type: 'number', min: -100, max: 100, when: kindIs('hit_rate', 'evasion', 'critical') },
    { key: 'value', label: 'chance', type: 'number', min: 0, max: 100, default: 100, when: kindIs('attack_state') },
    { key: 'value', label: 'perSecond', type: 'number', min: -100, max: 100, default: 1, when: kindIs('hp_regen', 'mp_regen') },
  ],
};
/** Effects: `value` is an amount, a state or a common event, `percent` a part of the maximum or a chance, depending on the kind. */
const effects: Field = {
  key: 'effects',
  type: 'list',
  max: 20,
  fields: [
    { key: 'kind', type: 'select', options: EFFECT_KINDS },
    { key: 'value', label: 'amount', type: 'int', min: 0, max: 999_999, when: kindIs('recover_hp', 'recover_mp', 'gain_xp') },
    { key: 'value', label: 'state', type: 'ref', ref: 'state', when: kindIs('add_state', 'remove_state') },
    { key: 'value', label: 'skill', type: 'ref', ref: 'skill', when: kindIs('learn_skill') },
    { key: 'value', label: 'commonEvent', type: 'ref', ref: 'commonEvent', when: kindIs('common_event') },
    { key: 'percent', label: 'maxPercent', type: 'int', min: 0, max: 100, when: kindIs('recover_hp', 'recover_mp') },
    // A removal stored with 0 (before removals had a chance) is played as 100 %.
    { key: 'percent', label: 'chance', type: 'int', min: 0, max: 100, default: 100, when: kindIs('add_state', 'remove_state') },
  ],
};
const damage: Field = {
  key: 'damage',
  type: 'group',
  fields: [
    { key: 'type', type: 'select', options: ['none', 'hp_damage', 'mp_damage', 'hp_recover', 'mp_recover'] },
    { key: 'formula', type: 'text', max: 200 },
    { key: 'element', type: 'systemList', list: 'elements' },
    { key: 'variance', type: 'int', min: 0, max: 100 },
    { key: 'critical', type: 'bool' },
  ],
};

const objectives: Field = {
  key: 'objectives',
  type: 'list',
  max: 10,
  fields: [
    { key: 'kind', type: 'select', options: OBJECTIVE_KINDS },
    { key: 'mapId', type: 'map', when: kindIs('talk', 'reach') },
    { key: 'eventId', type: 'event', mapKey: 'mapId', when: kindIs('talk') },
    { key: 'enemyId', type: 'ref', ref: 'enemy', when: kindIs('kill') },
    { key: 'itemId', type: 'ref', ref: 'item', when: kindIs('collect') },
    { key: 'switchId', type: 'switch', when: kindIs('switch') },
    { key: 'cell', type: 'cell', mapKey: 'mapId', when: kindIs('reach') },
    { key: 'x', type: 'int', min: 0, max: 255, when: kindIs('reach') },
    { key: 'y', type: 'int', min: 0, max: 255, when: kindIs('reach') },
    { key: 'radius', type: 'int', min: 0, max: 20, when: kindIs('reach') },
    { key: 'count', type: 'int', min: 1, max: 9999, when: kindIs('kill', 'collect') },
    { key: 'label', type: 'text', max: 120 },
  ],
};

const rewardItems: Field = {
  key: 'rewardItems',
  type: 'list',
  max: 10,
  fields: [
    { key: 'kind', type: 'select', options: ['item', 'weapon', 'armor'] },
    { key: 'item', type: 'ref', ref: 'item', when: kindIs('item') },
    { key: 'weapon', type: 'ref', ref: 'weapon', when: kindIs('weapon') },
    { key: 'armor', type: 'ref', ref: 'armor', when: kindIs('armor') },
    { key: 'count', type: 'int', min: 1, max: 99 },
  ],
};
/** What a new character of a class starts with: items in the bag, weapons and armors possibly worn. */
const startItems: Field = {
  key: 'startItems',
  type: 'list',
  max: 20,
  fields: [
    { key: 'kind', type: 'select', options: ['item', 'weapon', 'armor'] },
    { key: 'id', label: 'item', type: 'ref', ref: 'item', when: kindIs('item') },
    { key: 'id', label: 'weapon', type: 'ref', ref: 'weapon', when: kindIs('weapon') },
    { key: 'id', label: 'armor', type: 'ref', ref: 'armor', when: kindIs('armor') },
    { key: 'count', type: 'int', min: 1, max: 99 },
    { key: 'equip', type: 'bool', when: kindIs('weapon', 'armor') },
  ],
};
const mechanicIs = (...values: string[]) => ({ key: 'mechanic', values });
const conditionIs = (...values: string[]) => ({ key: 'condition', values });

/** Field lists of every database type (after the implicit `id`). */
export const SCHEMAS: Record<DatabaseType, Field[]> = {
  class: [
    name,
    description,
    icon,
    { key: 'outfit', type: 'select', options: OUTFITS },
    { key: 'defaultAppearance', type: 'appearance' },
    { key: 'params', type: 'curves' },
    { key: 'expBase', type: 'int', min: 1, max: 100_000 },
    { key: 'expGrowth', type: 'int', min: 0, max: 200 },
    { key: 'learnings', type: 'list', max: 200, fields: [{ key: 'level', type: 'int', min: 1, max: 999 }, { key: 'skillId', type: 'ref', ref: 'skill' }] },
    { key: 'weaponTypes', type: 'intList', min: 0, max: 99 },
    { key: 'armorTypes', type: 'intList', min: 0, max: 99 },
    traits,
    startItems,
    {
      key: 'start',
      type: 'group',
      fields: [
        { key: 'mode', type: 'select', options: ['system', 'custom'] },
        { key: 'mapId', type: 'map', when: { key: 'mode', values: ['custom'] } },
        { key: 'pick', type: 'cell', mapKey: 'mapId', when: { key: 'mode', values: ['custom'] } },
        { key: 'x', type: 'int', min: 0, max: 255, when: { key: 'mode', values: ['custom'] } },
        { key: 'y', type: 'int', min: 0, max: 255, when: { key: 'mode', values: ['custom'] } },
      ],
    },
    note,
  ],
  skill: [
    name,
    description,
    icon,
    { key: 'skillType', type: 'systemList', list: 'skillTypes' },
    { key: 'mpCost', type: 'int', min: 0, max: 9999 },
    { key: 'cooldown', type: 'number', min: 0, max: 3600 },
    { key: 'range', type: 'int', min: 0, max: 20 },
    { key: 'area', type: 'int', min: 0, max: 10 },
    { key: 'scope', type: 'select', options: SCOPES },
    { key: 'successRate', type: 'int', min: 0, max: 100, default: 100 },
    { key: 'repeats', type: 'int', min: 1, max: 9 },
    { key: 'requiredWeaponType', type: 'systemList', list: 'weaponTypes' },
    damage,
    { key: 'animationId', type: 'ref', ref: 'animation', allowNone: true },
    effects,
    { key: 'message', type: 'text', max: 200 },
    note,
  ],
  item: [
    name,
    description,
    icon,
    { key: 'kind', type: 'select', options: ['regular', 'key', 'quest'] },
    { key: 'price', type: 'int', min: 0, max: 9_999_999 },
    { key: 'consumable', type: 'bool' },
    { key: 'maxStack', type: 'int', min: 1, max: 9999 },
    { key: 'occasion', type: 'select', options: ['always', 'battle', 'menu', 'never'] },
    { key: 'scope', type: 'select', options: SCOPES },
    damage,
    effects,
    { key: 'animationId', type: 'ref', ref: 'animation', allowNone: true },
    note,
  ],
  weapon: [
    name,
    description,
    icon,
    { key: 'weaponType', type: 'systemList', list: 'weaponTypes' },
    { key: 'price', type: 'int', min: 0, max: 9_999_999 },
    { key: 'params', type: 'params' },
    { key: 'range', type: 'int', min: 1, max: 20 },
    { key: 'animationId', type: 'ref', ref: 'animation', allowNone: true },
    traits,
    note,
  ],
  armor: [
    name,
    description,
    icon,
    { key: 'armorType', type: 'systemList', list: 'armorTypes' },
    { key: 'slot', type: 'select', options: EQUIP_SLOTS.filter((s) => s !== 'weapon') },
    { key: 'price', type: 'int', min: 0, max: 9_999_999 },
    { key: 'params', type: 'params' },
    traits,
    note,
  ],
  enemy: [
    name,
    { key: 'characterName', type: 'resource', kind: 'characters' },
    { key: 'characterIndex', type: 'int', min: 0, max: 7 },
    { key: 'params', type: 'params' },
    { key: 'exp', type: 'int', min: 0, max: 9_999_999 },
    { key: 'gold', type: 'int', min: 0, max: 9_999_999 },
    {
      key: 'drops',
      type: 'list',
      max: 20,
      fields: [
        { key: 'kind', type: 'select', options: ['item', 'weapon', 'armor'] },
        // The same `id` is an item, a weapon or an armor depending on the kind.
        { key: 'id', label: 'item', type: 'ref', ref: 'item', when: kindIs('item') },
        { key: 'id', label: 'weapon', type: 'ref', ref: 'weapon', when: kindIs('weapon') },
        { key: 'id', label: 'armor', type: 'ref', ref: 'armor', when: kindIs('armor') },
        { key: 'chance', type: 'number', min: 0, max: 100 },
      ],
    },
    { key: 'ai', type: 'select', options: ['passive', 'aggressive', 'coward'] },
    { key: 'aggroRadius', type: 'int', min: 0, max: 30 },
    {
      key: 'actions',
      type: 'list',
      max: 20,
      fields: [
        { key: 'skillId', type: 'ref', ref: 'skill' },
        { key: 'weight', type: 'int', min: 1, max: 100 },
        // Actions saved before conditions existed are always available.
        { key: 'condition', type: 'select', options: ENEMY_ACTION_CONDITIONS },
        { key: 'hpBelow', type: 'int', min: 1, max: 100, default: 30, when: conditionIs('hp_below') },
        { key: 'stateId', type: 'ref', ref: 'state', when: conditionIs('state') },
        { key: 'switchId', type: 'switch', when: conditionIs('switch') },
      ],
    },
    { key: 'respawn', type: 'int', min: 0, max: 86_400 },
    { key: 'moveSpeed', type: 'int', min: 1, max: 6 },
    traits,
    note,
  ],
  state: [
    name,
    icon,
    { key: 'duration', type: 'number', min: 0, max: 86_400 },
    { key: 'durationMax', type: 'number', min: 0, max: 86_400 },
    { key: 'restriction', type: 'select', options: ['none', 'cannot_move', 'cannot_act', 'cannot_both'] },
    { key: 'priority', type: 'int', min: 0, max: 100, default: 50 },
    { key: 'hpPerSecond', type: 'number', min: -100, max: 100 },
    { key: 'mpPerSecond', type: 'number', min: -100, max: 100 },
    { key: 'removeOnDamage', type: 'bool' },
    // Records saved before the chance existed keep their behaviour: always removed.
    { key: 'removeOnDamageChance', type: 'int', min: 0, max: 100, default: 100, when: { key: 'removeOnDamage', values: ['true'] } },
    { key: 'removeAfterSteps', type: 'int', min: 0, max: 9999 },
    { key: 'animationId', type: 'ref', ref: 'animation', allowNone: true },
    traits,
    { key: 'message', type: 'text', max: 200 },
    { key: 'endMessage', type: 'text', max: 200 },
    note,
  ],
  animation: [
    name,
    { key: 'sheet', type: 'resource', kind: 'animations' },
    { key: 'frameCount', type: 'int', min: 1, max: 100 },
    { key: 'frameSize', type: 'int', min: 8, max: 512 },
    { key: 'fps', type: 'int', min: 1, max: 60 },
    { key: 'sound', type: 'resource', kind: 'se' },
    note,
  ],
  commonEvent: [
    name,
    { key: 'trigger', type: 'select', options: ['none', 'autorun', 'parallel'] },
    // Only automatic and parallel common events wait for a switch.
    { key: 'switchId', type: 'switch', allowNone: true, when: { key: 'trigger', values: ['autorun', 'parallel'] } },
    { key: 'list', type: 'commands' },
    note,
  ],
  quest: [
    name,
    icon,
    description,
    { key: 'category', type: 'text', max: 60 },
    { key: 'level', type: 'int', min: 1, max: 999 },
    { key: 'prerequisite', type: 'ref', ref: 'quest', allowNone: true },
    { key: 'autoComplete', type: 'bool' },
    { key: 'takeItems', type: 'bool' },
    { key: 'steps', type: 'list', max: 20, fields: [{ key: 'description', type: 'text', max: 200 }, objectives] },
    { key: 'rewardGold', type: 'int', min: 0, max: 9_999_999 },
    { key: 'rewardExp', type: 'int', min: 0, max: 9_999_999 },
    rewardItems,
    note,
  ],
  raid: [
    name,
    description,
    { key: 'mapId', type: 'map' },
    { key: 'bossEnemyId', type: 'ref', ref: 'enemy' },
    { key: 'minLevel', type: 'int', min: 1, max: 999 },
    { key: 'minPlayers', type: 'int', min: 1, max: 40 },
    { key: 'maxPlayers', type: 'int', min: 1, max: 40 },
    { key: 'lockout', type: 'select', options: ['weekly', 'daily', 'always'] },
    { key: 'lootMode', type: 'select', options: ['round_robin', 'need_greed'] },
    { key: 'rewardGold', type: 'int', min: 0, max: 9_999_999 },
    { key: 'rewardExp', type: 'int', min: 0, max: 9_999_999 },
    rewardItems,
    {
      key: 'phases',
      type: 'list',
      max: 10,
      fields: [
        { key: 'hpBelow', type: 'int', min: 1, max: 100 },
        { key: 'mechanic', type: 'select', options: BOSS_MECHANICS },
        { key: 'enemyId', type: 'ref', ref: 'enemy', when: mechanicIs('adds') },
        { key: 'count', type: 'int', min: 1, max: 10, when: mechanicIs('adds') },
        { key: 'damage', type: 'int', min: 1, max: 99_999, when: mechanicIs('zone') },
        { key: 'radius', type: 'int', min: 0, max: 5, when: mechanicIs('zone') },
        { key: 'interval', type: 'int', min: 0, max: 600, when: mechanicIs('adds', 'zone') },
      ],
    },
    note,
  ],
};

/** Error raised with the path of the first invalid field. */
export class SchemaError extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

function num(v: unknown, min: number, max: number, integer: boolean, path: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new SchemaError(path);
  const value = integer ? Math.round(n) : n;
  return Math.min(max, Math.max(min, value));
}

/** Tells whether a field applies, given the values of its siblings. */
export function fieldApplies(field: Field, values: Record<string, unknown>): boolean {
  return !field.when || field.when.values.includes(String(values[field.when.key]));
}

/** The declaration of a key in use for some sibling values: the first whose condition holds, else the first one. */
function declarationOf(fields: Field[], key: string, values: Record<string, unknown>): Field {
  const all = fields.filter((f) => f.key === key);
  return all.find((f) => fieldApplies(f, values)) ?? all[0]!;
}

/** Fields shown for some sibling values: one declaration per key, and only where its condition holds. */
export function activeFields(fields: Field[], values: Record<string, unknown>): Field[] {
  return fields.filter((f) => fieldApplies(f, values) && declarationOf(fields, f.key, values) === f);
}

/** Value of a field when the record has none. */
export function fieldDefault(field: Field): unknown {
  return normalizeField(field, undefined, field.key);
}

/**
 * Fills the missing keys of a list item or a group with default values, each from the declaration in use.
 * @param pick - Default chosen by the caller (the editor takes the first existing record), `undefined` for the schema's.
 */
export function completeValues(fields: Field[], values: Record<string, unknown>, pick?: (field: Field) => unknown): Record<string, unknown> {
  for (const f of fields) {
    if (f.type === 'cell' || f.key in values) continue;
    const field = declarationOf(fields, f.key, values);
    values[f.key] = pick?.(field) ?? fieldDefault(field);
  }
  return values;
}

/** Normalises one field value (throws `SchemaError` when it cannot be coerced). */
function normalizeField(field: Field, value: unknown, path: string): unknown {
  switch (field.type) {
    case 'text':
      return typeof value === 'string' ? value.slice(0, field.max ?? 200) : '';
    case 'int':
    case 'number':
      return num(value ?? field.default ?? Math.min(field.max, Math.max(field.min, 0)), field.min, field.max, field.type === 'int', path);
    case 'bool':
      return value === true;
    case 'select':
      return field.options.includes(value as string) ? value : field.options[0];
    case 'icon':
      return num(value ?? 0, 0, 9999, true, path);
    case 'resource':
      return typeof value === 'string' ? value.slice(0, 200) : '';
    case 'ref': {
      // A missing reference takes the first id; a stored one is kept, even 0 (reported on saving, ignored in game).
      // Trait targets were free text: a word that is no number reads as 0 instead of failing.
      let id: number;
      if (value === undefined || value === null) id = field.allowNone ? 0 : 1;
      else if (field.asText) id = Math.min(9999, Math.max(0, Number.parseInt(String(value), 10) || 0));
      else id = num(value, 0, 9999, true, path);
      return field.asText ? String(id) : id;
    }
    case 'systemList': {
      const index = field.asText ? Math.min(99, Math.max(0, Number.parseInt(String(value ?? 0), 10) || 0)) : num(value ?? 0, 0, 99, true, path);
      return field.asText ? String(index) : index;
    }
    case 'switch':
      return num(value ?? (field.allowNone ? 0 : 1), field.allowNone ? 0 : 1, 9999, true, path);
    case 'param': {
      if (value === undefined || value === null) return PARAMS[0];
      const name = String(value).trim().toLowerCase();
      return (PARAMS as readonly string[]).includes(name) ? name : '';
    }
    case 'params': {
      const src = (value ?? {}) as Record<string, unknown>;
      return Object.fromEntries(PARAMS.map((p) => [p, num(src[p] ?? 0, -9999, 99_999, true, `${path}.${p}`)]));
    }
    case 'curves': {
      const src = (value ?? {}) as Record<string, Partial<ParamCurve>>;
      return Object.fromEntries(
        PARAMS.map((p) => [p, { base: num(src[p]?.base ?? 1, 1, 99_999, true, `${path}.${p}`), growth: num(src[p]?.growth ?? 0, 0, 9999, false, `${path}.${p}`) }]),
      ) as Record<ParamName, ParamCurve>;
    }
    case 'group':
      return normalizeFields(field.fields, value, path);
    case 'list': {
      const list = Array.isArray(value) ? value.slice(0, field.max) : [];
      return list.map((item, i) => normalizeFields(field.fields, item, `${path}[${i}]`));
    }
    case 'intList': {
      const list = Array.isArray(value) ? value : [];
      return [...new Set(list.map((v, i) => num(v, field.min, field.max, true, `${path}[${i}]`)))];
    }
    case 'appearance':
      return sanitizeAppearance(value ?? DEFAULT_APPEARANCE);
    case 'commands': {
      const list = Array.isArray(value) ? value : [];
      const commands: EventCommand[] = list.slice(0, 5000).map((c, i) => {
        const cmd = (c ?? {}) as Partial<EventCommand>;
        if (!Array.isArray(cmd.parameters) || JSON.stringify(cmd.parameters).length > 20_000) throw new SchemaError(`${path}[${i}]`);
        const command: EventCommand = { code: num(cmd.code, 0, 99_999, true, `${path}[${i}]`), indent: num(cmd.indent ?? 0, 0, 100, true, `${path}[${i}]`), parameters: cmd.parameters };
        // A script from an imported file waiting for approval keeps its mark (see `quarantine.ts`).
        if (cmd.quarantined === true) command.quarantined = true;
        return command;
      });
      if (commands.length === 0 || commands.at(-1)!.code !== 0) commands.push({ code: 0, indent: 0, parameters: [] });
      return commands;
    }
    case 'map':
      return num(value ?? 1, 1, 1_000_000, true, path);
    case 'event':
      return num(value ?? 1, 1, 9999, true, path);
    case 'cell':
      return undefined;
  }
}

function normalizeFields(fields: Field[], value: unknown, path: string): Record<string, unknown> {
  const src = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    // A cell picker only edits its sibling x / y fields; a key declared several times is normalised once.
    if (f.type === 'cell' || f.key in out) continue;
    // Conditions are read on the values already normalised (the `kind` comes first).
    const field = declarationOf(fields, f.key, { ...src, ...out });
    out[f.key] = normalizeField(field, src[f.key], path ? `${path}.${f.key}` : f.key);
  }
  return out;
}

/** Calls `visit` for every field in use of a record (inside groups and list items too), with its path. */
export function walkFields(fields: Field[], value: unknown, visit: (field: Field, value: unknown, path: string) => void, path = ''): void {
  const src = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  for (const f of activeFields(fields, src)) {
    const v = src[f.key];
    const at = path ? `${path}.${f.key}` : f.key;
    visit(f, v, at);
    if (f.type === 'group') walkFields(f.fields, v, visit, at);
    else if (f.type === 'list' && Array.isArray(v)) v.forEach((item, i) => walkFields(f.fields, item, visit, `${at}[${i}]`));
  }
}

/** A field of a record that designates nothing: a deleted (or never chosen) record, an unknown parameter. */
export interface MissingRef {
  /** Path of the field (`effects[0].value`). */
  path: string;
  field: Field;
  /** Stored id or name. */
  value: unknown;
}

/**
 * First field of a record pointing to nothing, or `null`. Used by the server before saving and by
 * the editor to report it first (the game would silently ignore the effect or trait).
 * @param exists - Tells whether a record exists.
 */
export function findMissingRef(type: DatabaseType, record: unknown, exists: (type: DatabaseType, id: number) => boolean): MissingRef | null {
  let missing: MissingRef | null = null;
  walkFields(SCHEMAS[type], record, (field, value, path) => {
    if (missing) return;
    const id = Number(value);
    if (field.type === 'ref' && !(field.allowNone && id === 0) && !exists(field.ref, id)) missing = { path, field, value };
    else if (field.type === 'param' && !(PARAMS as readonly unknown[]).includes(value)) missing = { path, field, value };
  });
  return missing;
}

/**
 * Validates and completes a record.
 * @param type - Record type.
 * @param raw - Untrusted record.
 * @param id - Id it is stored under.
 * @throws {SchemaError} With the path of an invalid field.
 */
export function normalizeRecord<T extends DatabaseType>(type: T, raw: unknown, id: number): GameDataTypes[T] {
  return { id, ...normalizeFields(SCHEMAS[type], raw, '') } as unknown as GameDataTypes[T];
}

/**
 * A new record with default values.
 * @param type - Record type.
 * @param id - Id of the record.
 */
export function defaultRecord<T extends DatabaseType>(type: T, id: number): GameDataTypes[T] {
  const base = normalizeRecord(type, {}, id) as unknown as Record<string, unknown>;
  base.name = '';
  // New items and skills get a visible icon (index 0 is "no icon", which leaves an empty slot in the bag and skill list).
  if (type === 'item') Object.assign(base, { icon: iconIndex('bag'), consumable: true, maxStack: 99, occasion: 'always', scope: 'self', damage: noDamage() });
  if (type === 'skill') Object.assign(base, { icon: iconIndex('aura'), range: 1, scope: 'enemy', damage: { ...noDamage(), type: 'hp_damage', formula: 'a.atk * 4 - b.def * 2' } });
  if (type === 'class') Object.assign(base, { expBase: 30, expGrowth: 25 });
  if (type === 'weapon') Object.assign(base, { range: 1, params: zeroParams() });
  if (type === 'enemy') Object.assign(base, { characterName: 'Monster1', ai: 'aggressive', aggroRadius: 5, respawn: 30, moveSpeed: 3 });
  if (type === 'animation') Object.assign(base, { frameCount: 5, frameSize: 96, fps: 12 });
  return base as unknown as GameDataTypes[T];
}

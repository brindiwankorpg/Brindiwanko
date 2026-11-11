/**
 * @file Conversion of external database files (`Items.json`, `Weapons.json`,
 * `Armors.json`, `Skills.json`, `Enemies.json`, `States.json`,
 * `Classes.json`) into engine records.
 *
 * Records are appended under new ids (nothing is overwritten) and references
 * between them (skills learnt by classes or used by enemies, dropped items,
 * states added by effects) are remapped. Damage formulas keep their syntax
 * (`a.atk * 4 - b.def * 2`), which the engine evaluates the same way.
 * Enemy battler images are not character sheets: imported enemies get a
 * default sprite and the report says so. Effects calling a common event are
 * left out (common events are not imported) and the report says which.
 */
import { defaultRecord, normalizeRecord } from '../../shared/database-schema.js';
import { PARAMS, type Damage, type DatabaseType, type Effect, type Scope } from '../../shared/database.js';
import type { ServerContext } from '../context.js';
import type { ImportWarning } from './project.js';

type Raw = Record<string, unknown>;

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Scope codes of external files → engine scopes. */
function scopeOf(code: unknown): Scope {
  const c = num(code);
  if (c === 1) return 'enemy';
  if (c >= 2 && c <= 6) return 'enemies_area';
  if (c === 7 || c === 9) return 'ally';
  if (c === 8 || c === 10) return 'allies_area';
  if (c === 11) return 'self';
  return 'none';
}

const DAMAGE_TYPES: Damage['type'][] = ['none', 'hp_damage', 'mp_damage', 'hp_recover', 'mp_recover', 'hp_damage', 'mp_damage'];

function damageOf(raw: unknown): Damage {
  const d = (raw ?? {}) as Raw;
  return {
    type: DAMAGE_TYPES[num(d.type)] ?? 'none',
    formula: str(d.formula) || '0',
    element: Math.max(0, num(d.elementId)),
    variance: num(d.variance, 20),
    critical: d.critical === true,
  };
}

/** Parameter array (8 values, same order as the engine) → parameter object. */
function paramsOf(list: unknown): Record<string, number> {
  const arr = Array.isArray(list) ? list : [];
  return Object.fromEntries(PARAMS.map((p, i) => [p, num(arr[i])]));
}

const FILES: [DatabaseType, string][] = [['state', 'States'], ['skill', 'Skills'], ['item', 'Items'], ['weapon', 'Weapons'], ['armor', 'Armors'], ['enemy', 'Enemies'], ['class', 'Classes']];

/** The database files of a project, with the new ids reserved for their records. */
export interface DatabasePlan {
  lists: Partial<Record<DatabaseType, Raw[]>>;
  ids: Partial<Record<DatabaseType, Map<number, number>>>;
  /**
   * New id of a record of the project: `undefined` when the project has no file of that type (its numbers
   * are then those of the game, kept as they are), 0 for a number its file does not have.
   */
  remap(type: DatabaseType, id: number): number | undefined;
}

/**
 * Reads the database files of a project and reserves new ids for their records, so that the maps and the
 * records themselves can point to them whatever the order they are added in.
 * @param ctx - Server context.
 * @param read - Returns the parsed content of `data/<name>.json`, or `undefined`.
 */
export function planDatabase(ctx: ServerContext, read: (name: string) => unknown): DatabasePlan {
  const lists: DatabasePlan['lists'] = {};
  const ids: DatabasePlan['ids'] = {};
  for (const [type, file] of FILES) {
    const raw = read(file);
    if (!Array.isArray(raw)) continue;
    const list = raw.filter((r): r is Raw => !!r && typeof r === 'object' && str((r as Raw).name) !== '');
    lists[type] = list;
    ids[type] = new Map();
    let next = ctx.gameData.nextId(type);
    for (const r of list) ids[type]!.set(num(r.id), next++);
  }
  return { lists, ids, remap: (type, id) => (ids[type] ? (ids[type]!.get(id) ?? 0) : undefined) };
}

/**
 * Imports the database files of a project, under the ids reserved by `planDatabase`.
 * @param ctx - Server context.
 * @param plan - Files and reserved ids.
 * @param warnings - Receives report remarks.
 * @returns Number of records imported per type.
 */
export function importDatabase(ctx: ServerContext, plan: DatabasePlan, warnings: ImportWarning[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const { ids, lists } = plan;
  const ref = (type: string, id: unknown) => ids[type as DatabaseType]?.get(num(id)) ?? 0;

  // The archive's common events are not imported: an effect calling one would call the unrelated common event of the game with its number.
  const effectsOf = (raw: unknown, name: string): Effect[] => {
    const out: Effect[] = [];
    for (const e of Array.isArray(raw) ? (raw as Raw[]) : []) {
      const code = num(e.code);
      // 11 recover HP, 12 recover MP (value1 = rate, value2 = flat), 21/22 add/remove state, 44 common event.
      if (code === 11 || code === 12) out.push({ kind: code === 11 ? 'recover_hp' : 'recover_mp', value: Math.max(0, Math.round(num(e.value2))), percent: Math.round(num(e.value1) * 100) });
      else if (code === 21 || code === 22) {
        const state = ref('state', e.dataId);
        if (state) out.push({ kind: code === 21 ? 'add_state' : 'remove_state', value: state, percent: Math.round(num(e.value1, 1) * 100) });
      } else if (code === 44) warnings.push({ key: 'import.warning.common_event_effect', params: { name } });
    }
    return out;
  };

  /** Action conditions that make sense in real time (HP up to a ratio, state); the others become "always". */
  const conditionOf = (a: Raw): Raw => {
    const type = num(a.conditionType);
    if (type === 2 && num(a.conditionParam1) <= 0 && num(a.conditionParam2, 1) < 1) {
      return { condition: 'hp_below', hpBelow: Math.max(1, Math.round(num(a.conditionParam2) * 100)) };
    }
    if (type === 4 && ref('state', a.conditionParam1)) return { condition: 'state', stateId: ref('state', a.conditionParam1) };
    return { condition: 'always' };
  };

  for (const [type] of FILES) {
    for (const r of lists[type] ?? []) {
      const id = ids[type]!.get(num(r.id))!;
      const common = { name: str(r.name), description: str(r.description), icon: num(r.iconIndex) };
      let record: Raw = {};
      switch (type) {
        case 'state':
          record = {
            name: str(r.name), icon: num(r.iconIndex), duration: Math.max(0, num(r.minTurns, 3)) * 3,
            restriction: ['none', 'none', 'none', 'none', 'cannot_both'][num(r.restriction)] ?? 'none',
            removeOnDamage: r.removeByDamage === true, message: str(r.message1),
          };
          break;
        case 'skill':
          record = { ...common, mpCost: num(r.mpCost), cooldown: 2, range: num(r.scope) === 11 ? 0 : 4, scope: scopeOf(r.scope), damage: damageOf(r.damage), effects: effectsOf(r.effects, str(r.name)), message: str(r.message1) };
          break;
        case 'item':
          record = {
            ...common, kind: num(r.itypeId, 1) === 2 ? 'key' : 'regular', price: num(r.price), consumable: r.consumable !== false,
            maxStack: 99, occasion: ['always', 'battle', 'menu', 'never'][num(r.occasion)] ?? 'always', scope: scopeOf(r.scope),
            damage: damageOf(r.damage), effects: effectsOf(r.effects, str(r.name)),
          };
          break;
        case 'weapon':
          record = { ...common, weaponType: num(r.wtypeId), price: num(r.price), params: paramsOf(r.params), range: 1 };
          break;
        case 'armor':
          record = {
            ...common, armorType: num(r.atypeId), price: num(r.price), params: paramsOf(r.params),
            slot: ({ 2: 'shield', 3: 'head', 4: 'body', 5: 'accessory' } as Record<number, string>)[num(r.etypeId, 4)] ?? 'body',
          };
          break;
        case 'enemy':
          record = {
            ...defaultRecord('enemy', id), name: str(r.name), params: paramsOf(r.params), exp: num(r.exp), gold: num(r.gold),
            drops: (Array.isArray(r.dropItems) ? (r.dropItems as Raw[]) : [])
              .filter((d) => num(d.kind) > 0)
              .map((d) => {
                const kind = (['', 'item', 'weapon', 'armor'] as const)[num(d.kind)] ?? 'item';
                return { kind, id: ref(kind, d.dataId), chance: Math.round(100 / Math.max(1, num(d.denominator, 1))) };
              })
              .filter((d) => d.id > 0),
            actions: (Array.isArray(r.actions) ? (r.actions as Raw[]) : []).map((a) => ({ skillId: ref('skill', a.skillId), weight: Math.max(1, num(a.rating, 5)), ...conditionOf(a) })).filter((a) => a.skillId > 0),
          };
          if (str(r.battlerName)) warnings.push({ key: 'import.warning.enemy_sprite', params: { name: str(r.name) } });
          break;
        case 'class': {
          // Per-level parameter tables become a base value (level 1) and an average growth.
          const table = Array.isArray(r.params) ? (r.params as unknown[][]) : [];
          const curves = Object.fromEntries(PARAMS.map((p, i) => {
            const row = Array.isArray(table[i]) ? table[i]! : [];
            const base = num(row[1], 10);
            const at99 = num(row[99], base);
            return [p, { base: Math.max(1, base), growth: Math.max(0, (at99 - base) / 98) }];
          }));
          const exp = Array.isArray(r.expParams) ? (r.expParams as number[]) : [];
          record = {
            ...defaultRecord('class', id), name: str(r.name), description: str(r.note).slice(0, 200), params: curves,
            expBase: Math.max(1, num(exp[0], 30)), expGrowth: Math.min(200, Math.max(0, num(exp[1], 20))),
            learnings: (Array.isArray(r.learnings) ? (r.learnings as Raw[]) : []).map((l) => ({ level: num(l.level, 1), skillId: ref('skill', l.skillId) })).filter((l) => l.skillId > 0),
          };
          break;
        }
      }
      ctx.gameData.save(type, normalizeRecord(type, record, id) as never);
      counts[type] = (counts[type] ?? 0) + 1;
    }
  }
  return counts;
}

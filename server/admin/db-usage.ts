/**
 * @file Finds where a database record is used, so the editor can warn before
 * deleting it: other records (through the schema's references, including the
 * fields whose target depends on a sibling `kind`), map spawns and events,
 * common events, and what players own or have started; and where a map is used.
 * Also removes the copies players own of an item, weapon or armor deleted anyway.
 */
import { SCHEMAS, activeFields, walkFields, type Field } from '../../shared/database-schema.js';
import { DATABASE_TYPES, EQUIP_SLOTS, type DatabaseType, type DatabaseUsage } from '../../shared/database.js';
import { BranchType, Cmd, MmoCmd, type EventCommand, type EventConditions } from '../../shared/events.js';
import type { ServerContext } from '../context.js';

type AddRef = (type: DatabaseType, id: unknown) => void;

const ENTRY_KINDS = ['item', 'weapon', 'armor'] as const;
const isEntryKind = (v: unknown): v is (typeof ENTRY_KINDS)[number] => (ENTRY_KINDS as readonly unknown[]).includes(v);

/** Parameters of an event command that name a database record: its type and the index of the parameter. */
export function commandRecordSlots(c: EventCommand): [DatabaseType, number][] {
  const p = Array.isArray(c?.parameters) ? c.parameters : [];
  switch (c?.code) {
    case Cmd.CommonEvent:
      return [['commonEvent', 0]];
    case Cmd.ChangeItems:
      return [['item', 0]];
    case Cmd.ChangeWeapons:
      return [['weapon', 0]];
    case Cmd.ChangeArmors:
      return [['armor', 0]];
    case Cmd.ShowAnimation:
      return [['animation', 1]];
    case Cmd.BattleProcessing:
      return [['enemy', 1]];
    case Cmd.ShopProcessing:
    case Cmd.ShopItem:
      return [[ENTRY_KINDS[Number(p[0])] ?? 'item', 1]];
    case Cmd.ChangeEquipment:
      return Number(p[2]) > 0 ? [[EQUIP_SLOTS[Number(p[1])] === 'weapon' ? 'weapon' : 'armor', 2]] : [];
    case MmoCmd.StartQuest:
    case MmoCmd.AdvanceQuest:
    case MmoCmd.CompleteQuest:
      return [['quest', 0]];
    case Cmd.If:
      if (p[0] === BranchType.Item) return [['item', 1]];
      if (p[0] === BranchType.Weapon) return [['weapon', 1]];
      if (p[0] === BranchType.Armor) return [['armor', 1]];
      if (p[0] === BranchType.Quest) return [['quest', 1]];
      return [];
    default:
      return [];
  }
}

/** References of an event command list. */
function commandRefs(list: unknown, add: AddRef): void {
  if (!Array.isArray(list)) return;
  for (const c of list as EventCommand[]) {
    const p: unknown[] = Array.isArray(c?.parameters) ? c.parameters : [];
    for (const [type, index] of commandRecordSlots(c)) add(type, p[index]);
  }
}

/** Every reference of a database record. */
export function recordRefs(type: DatabaseType, record: unknown, add: AddRef): void {
  // References declared by the schema: `ref` fields in use (inactive ones keep a default value that is
  // not a real reference; effects, traits and drops declare theirs by kind), and command lists.
  walkFields(SCHEMAS[type], record, (f, v) => {
    if (f.type === 'ref') add(f.ref, v);
    else if (f.type === 'commands') commandRefs(v, add);
  });
}

function conditionRefs(c: Partial<EventConditions> | undefined, add: AddRef): void {
  if (!c) return;
  if (c.itemValid) add('item', c.itemId);
  if (c.questValid) add('quest', c.questId);
}

/**
 * Places where a record is used.
 * @param ctx - Server context.
 * @param type - Type of the record.
 * @param id - Id of the record.
 */
export function findUsages(ctx: ServerContext, type: DatabaseType, id: number): DatabaseUsage[] {
  const usages: DatabaseUsage[] = [];
  let hit = false;
  const add: AddRef = (t, ref) => {
    if (t === type && Number(ref) === id) hit = true;
  };

  for (const t of DATABASE_TYPES) {
    for (const record of ctx.gameData.list(t)) {
      if (t === type && record.id === id) continue;
      hit = false;
      recordRefs(t, record, add);
      if (hit) usages.push({ kind: 'record', type: t, id: record.id, name: record.name });
    }
  }

  for (const info of ctx.maps.infos()) {
    // Read once, not kept: every map of the world would otherwise stay in memory.
    const map = ctx.maps.peek(info.id);
    if (!map) continue;
    const spawns = type === 'enemy' && (map.mmo?.spawns ?? []).some((s) => s.enemyId === id);
    const events: string[] = [];
    for (const event of map.events ?? []) {
      if (!event) continue;
      hit = false;
      for (const page of event.pages ?? []) {
        conditionRefs(page.conditions, add);
        commandRefs(page.list, add);
      }
      if (hit) events.push(event.name || `#${event.id}`);
    }
    if (spawns || events.length > 0) usages.push({ kind: 'map', id: info.id, name: info.name, spawns, events });
  }

  if (isEntryKind(type)) {
    const characters = ctx.db
      .prepare<[string, number, string, number, string, number], number>(
        `SELECT COUNT(DISTINCT character_id) FROM (
           SELECT character_id FROM character_items WHERE item_kind = ? AND item_id = ?
           UNION SELECT character_id FROM character_bank WHERE item_kind = ? AND item_id = ?
           UNION SELECT character_id FROM character_equipment WHERE item_kind = ? AND item_id = ?)`,
      )
      .pluck()
      .get(type, id, type, id, type, id) ?? 0;
    if (characters > 0) usages.push({ kind: 'characters', count: characters });
    const guilds = ctx.db.prepare<[string, number], number>('SELECT COUNT(DISTINCT guild_id) FROM guild_bank_items WHERE item_kind = ? AND item_id = ?').pluck().get(type, id) ?? 0;
    if (guilds > 0) usages.push({ kind: 'guildBanks', count: guilds });
  }
  if (type === 'quest') {
    const count = ctx.db.prepare<[number], number>('SELECT COUNT(*) FROM character_quests WHERE quest_id = ?').pluck().get(id) ?? 0;
    if (count > 0) usages.push({ kind: 'questProgress', count });
  }
  return usages;
}

/** Tells whether a command list transfers the player to a map. */
function transfersTo(list: unknown, mapId: number): boolean {
  return Array.isArray(list) && (list as EventCommand[]).some((c) => c?.code === Cmd.TransferPlayer && Array.isArray(c.parameters) && c.parameters[0] === 0 && Number(c.parameters[1]) === mapId);
}

/**
 * Places where a map is used, so the editor can warn before deleting it: records naming it (raids,
 * quest objectives, common events transferring there), events of other maps transferring there, and
 * characters whose respawn point is on it.
 * @param ctx - Server context.
 * @param mapId - Id of the map.
 */
export function findMapUsages(ctx: ServerContext, mapId: number): DatabaseUsage[] {
  const usages: DatabaseUsage[] = [];
  for (const t of DATABASE_TYPES) {
    for (const record of ctx.gameData.list(t)) {
      let hit = false;
      walkFields(SCHEMAS[t], record, (f, v) => {
        if ((f.type === 'map' && Number(v) === mapId) || (f.type === 'commands' && transfersTo(v, mapId))) hit = true;
      });
      if (hit) usages.push({ kind: 'record', type: t, id: record.id, name: record.name });
    }
  }
  for (const info of ctx.maps.infos()) {
    if (info.id === mapId) continue;
    const events: string[] = [];
    for (const event of ctx.maps.peek(info.id)?.events ?? []) {
      if (event && (event.pages ?? []).some((page) => transfersTo(page.list, mapId))) events.push(event.name || `#${event.id}`);
    }
    if (events.length > 0) usages.push({ kind: 'map', id: info.id, name: info.name, spawns: false, events });
  }
  const respawns = ctx.db.prepare<[number], number>('SELECT COUNT(*) FROM characters WHERE respawn_map = ?').pluck().get(mapId) ?? 0;
  if (respawns > 0) usages.push({ kind: 'respawns', count: respawns });
  return usages;
}

/**
 * Takes the references to a record out of the other records, before it is deleted anyway: list rows
 * aimed at it (effects, traits, learned skills, enemy actions, drops, rewards...) are removed, and an
 * optional reference (animation, prerequisite quest) becomes "none". A required reference outside any
 * list (the boss of a raid) is left to the creator, as are map events.
 * @returns The number of records changed.
 */
export function removeReferences(ctx: ServerContext, type: DatabaseType, id: number): number {
  const aimed = (f: Field, v: unknown) => f.type === 'ref' && f.ref === type && Number(v) === id;
  const clean = (fields: Field[], value: Record<string, unknown>): boolean => {
    let changed = false;
    for (const f of activeFields(fields, value)) {
      const v = value[f.key];
      if (f.type === 'ref' && f.allowNone && aimed(f, v)) {
        value[f.key] = f.asText ? '0' : 0;
        changed = true;
      } else if (f.type === 'group' && typeof v === 'object' && v !== null) {
        changed = clean(f.fields, v as Record<string, unknown>) || changed;
      } else if (f.type === 'list' && Array.isArray(v)) {
        const rows = v as Record<string, unknown>[];
        const kept = rows.filter((row) => !activeFields(f.fields, row).some((g) => g.type === 'ref' && !g.allowNone && aimed(g, row[g.key])));
        if (kept.length !== rows.length) {
          value[f.key] = kept;
          changed = true;
        }
        for (const row of kept) changed = clean(f.fields, row) || changed;
      }
    }
    return changed;
  };
  let count = 0;
  for (const t of DATABASE_TYPES) {
    for (const record of ctx.gameData.list(t)) {
      if (t === type && record.id === id) continue;
      // Records read from the repository are shared with the game: the cleaning works on a copy.
      const copy = structuredClone(record) as unknown as Record<string, unknown>;
      if (!clean(SCHEMAS[t], copy)) continue;
      ctx.gameData.save(t, copy as never);
      count++;
    }
  }
  return count;
}

/**
 * Removes every copy of an item, weapon or armor that players own (bags, banks,
 * equipment, guild banks), before the record itself is deleted: afterwards they
 * could neither be seen nor dropped, yet would still take room in the bag.
 * @param ctx - Server context.
 * @param kind - Kind of the deleted record.
 * @param id - Id of the deleted record.
 * @returns The characters and the guilds that lost copies (to refresh their windows).
 */
export function removeOwnedCopies(ctx: ServerContext, kind: 'item' | 'weapon' | 'armor', id: number): { characters: number[]; guilds: number[] } {
  const db = ctx.db;
  return db.transaction(() => {
    const characters = db
      .prepare<[string, number, string, number, string, number], number>(
        `SELECT character_id FROM character_items WHERE item_kind = ? AND item_id = ?
         UNION SELECT character_id FROM character_bank WHERE item_kind = ? AND item_id = ?
         UNION SELECT character_id FROM character_equipment WHERE item_kind = ? AND item_id = ?`,
      )
      .pluck()
      .all(kind, id, kind, id, kind, id);
    const guilds = db.prepare<[string, number], number>('SELECT DISTINCT guild_id FROM guild_bank_items WHERE item_kind = ? AND item_id = ?').pluck().all(kind, id);
    for (const table of ['character_items', 'character_bank', 'character_equipment', 'guild_bank_items']) {
      db.prepare(`DELETE FROM ${table} WHERE item_kind = ? AND item_id = ?`).run(kind, id);
    }
    return { characters, guilds };
  })();
}

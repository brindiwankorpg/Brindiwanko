/**
 * @file Editor API of the game database (administrators only; mounted inside
 * the editor router, which already checks the role and the CSRF header).
 *
 * Every record is normalised with the shared schema before being stored, so
 * the game only ever reads complete, valid records; the records it refers to
 * (states of effects, skills of classes...) must exist. Changes are immediately
 * visible in game: the repository cache is refreshed on every write.
 *
 * Routes: list / create / save / delete records of a type, try an enemy out next
 * to the administrator's character, read and save the
 * System and Terms settings, export and import the whole database as JSON (the
 * scripts of imported common events wait for approval, see `shared/quarantine.ts`).
 * Deleting an item, a weapon or an armor also takes it from the players who own it;
 * a record deleted while still in use can take the references to it along.
 */
import { Router, type Response } from 'express';
import { SchemaError, defaultRecord, findMissingRef, normalizeRecord } from '../../shared/database-schema.js';
import { DATABASE_TYPES, PARAMS, type DatabaseType, type GameDataTypes } from '../../shared/database.js';
import { isValidPosition } from '../../shared/map.js';
import { quarantineList } from '../../shared/quarantine.js';
import { canMove } from '../../shared/passability.js';
import { DEFAULT_SETTINGS, MAX_SWITCHES, SYSTEM_SETTING_KEYS, type DataName, type StartPosition, type SystemSettings, type Terms } from '../../shared/settings.js';
import { currentAccount } from '../auth/middleware.js';
import type { ServerContext } from '../context.js';
import { findUsages, removeOwnedCopies, removeReferences } from './db-usage.js';

/** Version of the database export format. */
export const DATABASE_EXPORT_VERSION = 1;

/** Most usages listed when a deletion is refused. */
export const MAX_USAGES = 20;

/** Types whose edit changes what the skills window of a player in game shows. */
const SKILL_LIST_TYPES: ReadonlySet<string> = new Set(['skill', 'class']);
/** Types whose records make the parameters of the characters (class curves, equipment and state traits). */
const STATS_TYPES: ReadonlySet<string> = new Set(['class', 'weapon', 'armor', 'state']);

const isType = (t: string): t is DatabaseType => (DATABASE_TYPES as readonly string[]).includes(t);

function fail(res: Response, status: number, error: string, params?: Record<string, string | number>): void {
  res.status(status).json({ error, params });
}

/** A text setting; an empty one keeps the current value (titles and terms are shown in game). */
const text = (v: unknown, fallback: string, max = 100) => (typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : fallback);
const int = (v: unknown, fallback: number, min: number, max: number) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : fallback);
const names = (v: unknown, fallback: string[]) =>
  Array.isArray(v) && v.length > 0 ? v.slice(0, 100).map((n, i) => text(n, fallback[i] ?? '', 40)) : fallback;

/** Switch / variable declarations: names trimmed, scope as a boolean, bounded count. */
function dataNames(v: unknown, fallback: DataName[]): DataName[] {
  if (!Array.isArray(v)) return fallback;
  return v.slice(0, MAX_SWITCHES).map((d) => {
    const entry = (typeof d === 'object' && d !== null ? d : {}) as Partial<DataName>;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '';
    // A switch is personal, global or of an instance (instance wins over global).
    return entry.instance === true ? { name, global: false, instance: true } : { name, global: entry.global === true };
  });
}

/**
 * Validates the System / Terms settings sent by the editor.
 * @param raw - Untrusted values.
 * @param current - Current settings (fallbacks).
 */
export function normalizeSystem(raw: Record<string, unknown>, current: SystemSettings): Partial<SystemSettings> {
  const start = (raw.startPosition ?? {}) as Partial<SystemSettings['startPosition']>;
  const terms = (raw.terms ?? {}) as Partial<Terms>;
  const params = (terms.params ?? {}) as Partial<Terms['params']>;
  return {
    gameTitle: text(raw.gameTitle, current.gameTitle),
    startPosition: {
      mapId: int(start.mapId, current.startPosition.mapId, 1, 1_000_000),
      x: int(start.x, current.startPosition.x, 0, 255),
      y: int(start.y, current.startPosition.y, 0, 255),
      direction: ([2, 4, 6, 8] as const).includes(start.direction as 2) ? (start.direction as 2 | 4 | 6 | 8) : current.startPosition.direction,
    },
    currencyName: text(raw.currencyName, current.currencyName, 30),
    maxLevel: int(raw.maxLevel, current.maxLevel, 1, 999),
    maxPartySize: int(raw.maxPartySize, current.maxPartySize, 2, 40),
    maxRaidSize: int(raw.maxRaidSize, current.maxRaidSize, 2, 40),
    instanceIdleMinutes: int(raw.instanceIdleMinutes, current.instanceIdleMinutes, 1, 1440),
    guildCreationCost: int(raw.guildCreationCost, current.guildCreationCost, 0, 99_999_999),
    elements: names(raw.elements, current.elements),
    weaponTypes: names(raw.weaponTypes, current.weaponTypes),
    armorTypes: names(raw.armorTypes, current.armorTypes),
    skillTypes: names(raw.skillTypes, current.skillTypes),
    startingGold: int(raw.startingGold, current.startingGold, 0, 99_999_999),
    statPointsPerLevel: int(raw.statPointsPerLevel, current.statPointsPerLevel, 0, 20),
    sellRate: int(raw.sellRate, current.sellRate, 0, 100),
    bagSize: int(raw.bagSize, current.bagSize, 10, 200),
    terms: {
      level: text(terms.level, current.terms.level, 30),
      hp: text(terms.hp, current.terms.hp, 30),
      mp: text(terms.mp, current.terms.mp, 30),
      xp: text(terms.xp, current.terms.xp, 30),
      params: Object.fromEntries(PARAMS.map((p) => [p, text(params[p], current.terms.params[p], 30)])) as Terms['params'],
    },
    switches: dataNames(raw.switches, current.switches),
    variables: dataNames(raw.variables, current.variables),
  };
}

/**
 * Tells whether new characters can start on a cell: an existing map, a cell
 * inside it, and a cell they can walk out of.
 */
export function isValidStart(ctx: ServerContext, start: StartPosition): boolean {
  const map = ctx.maps.get(start.mapId);
  if (!map || !isValidPosition(map, start.x, start.y)) return false;
  const flags = ctx.gameData.get('tileset', map.tilesetId)?.flags ?? [];
  return ([2, 4, 6, 8] as const).some((d) => canMove(map, flags, start.x, start.y, d));
}

/** Current System / Terms settings. */
export function readSystem(ctx: ServerContext): SystemSettings {
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const key of SYSTEM_SETTING_KEYS) out[key] = ctx.settings.get(key, DEFAULT_SETTINGS[key]);
  return out as unknown as SystemSettings;
}

/**
 * Creates the database router (mounted under `/api/editor`).
 * @param ctx - Server context.
 */
export function databaseRouter(ctx: ServerContext): Router {
  const router = Router();

  router.get('/db/:type', (req, res) => {
    const { type } = req.params;
    if (!isType(type)) {
      fail(res, 404, 'error.db.unknown_type');
      return;
    }
    res.json({ records: ctx.gameData.list(type) });
  });

  router.post('/db/:type', (req, res) => {
    const { type } = req.params;
    if (!isType(type)) {
      fail(res, 404, 'error.db.unknown_type');
      return;
    }
    const id = ctx.gameData.nextId(type);
    const body = req.body as { copyOf?: unknown };
    const source = Number.isInteger(body.copyOf) ? ctx.gameData.get(type, body.copyOf as number) : undefined;
    const record = source ? normalizeRecord(type, { ...source, name: `${source.name} (2)` }, id) : defaultRecord(type, id);
    if (!source) (record as { name: string }).name = `#${id}`;
    ctx.gameData.save(type, record as GameDataTypes[typeof type]);
    res.json({ record });
  });

  router.put('/db/:type/:id', (req, res) => {
    const { type } = req.params;
    const id = Number(req.params.id);
    if (!isType(type) || !Number.isInteger(id) || id < 1 || id > 9999) {
      fail(res, 400, 'error.db.unknown_type');
      return;
    }
    try {
      const record = normalizeRecord(type, (req.body as { record?: unknown }).record, id);
      // Lists, shops and the game show the name: an empty one is refused rather than stored.
      if (record.name.trim() === '') {
        fail(res, 400, 'error.db.name_required');
        return;
      }
      // An effect or a trait aimed at a deleted state (or a reference never chosen) would silently do nothing in game.
      const missing = findMissingRef(type, record, (t, ref) => ctx.gameData.get(t, ref) !== undefined);
      if (missing) {
        fail(res, 400, 'error.db.missing_ref', { field: missing.path, value: String(missing.value) });
        return;
      }
      // A class's own start must be a free cell of an existing map (like the System start).
      const start = type === 'class' ? (record as GameDataTypes['class']).start : undefined;
      if (start?.mode === 'custom' && !isValidStart(ctx, { ...start, direction: 2 })) {
        fail(res, 400, 'error.db.invalid_class_start');
        return;
      }
      ctx.gameData.save(type, record as GameDataTypes[typeof type]);
      if (SKILL_LIST_TYPES.has(type)) ctx.world.skillsContentChanged();
      // The players in game get their new parameters at once, not at their next level or equipment change.
      if (STATS_TYPES.has(type)) ctx.world.statsContentChanged();
      // The monsters already on the maps fight with the new record, not only the next ones.
      if (type === 'enemy') ctx.world.combat.enemiesChanged();
      res.json({ record });
    } catch (err) {
      if (err instanceof SchemaError) fail(res, 400, 'error.db.invalid_field', { field: err.path });
      else throw err;
    }
  });

  router.delete('/db/:type/:id', (req, res) => {
    const { type } = req.params;
    const id = Number(req.params.id);
    if (!isType(type)) {
      fail(res, 404, 'error.db.unknown_type');
      return;
    }
    if (type === 'class') {
      const used = ctx.db.prepare<[number], number>('SELECT COUNT(*) FROM characters WHERE class_id = ?').pluck().get(id) ?? 0;
      if (used > 0) {
        fail(res, 400, 'error.db.class_in_use', { count: used });
        return;
      }
      if (ctx.gameData.count('class') <= 1) {
        fail(res, 400, 'error.db.last_class');
        return;
      }
    }
    // A record still referenced is only deleted once the editor has shown where (`?force=1`).
    if (req.query.force !== '1') {
      const usages = findUsages(ctx, type, id);
      if (usages.length > 0) {
        res.status(409).json({ error: 'error.db.in_use', params: { count: usages.length }, usages: usages.slice(0, MAX_USAGES) });
        return;
      }
    }
    // `?clean=1`: the effects, traits and rows of other records aimed at it go with it.
    const clean = req.query.clean === '1';
    if (type === 'item' || type === 'weapon' || type === 'armor') {
      // The copies players own are removed first: once the record is gone they could
      // neither be seen nor dropped, yet would still take room in the bag.
      const owners = ctx.db.transaction(() => {
        const removed = removeOwnedCopies(ctx, type, id);
        if (clean) removeReferences(ctx, type, id);
        ctx.gameData.remove(type, id);
        return removed;
      })();
      ctx.world.ownedCopiesRemoved(owners.characters, owners.guilds);
    } else {
      ctx.db.transaction(() => {
        if (clean) removeReferences(ctx, type, id);
        // What characters keep of it goes too: a record created later with the same number must not
        // find itself already learned, or a quest already started.
        if (type === 'skill') ctx.db.prepare('DELETE FROM character_skills WHERE skill_id = ?').run(id);
        if (type === 'quest') ctx.db.prepare('DELETE FROM character_quests WHERE quest_id = ?').run(id);
        ctx.gameData.remove(type, id);
      })();
    }
    if (type === 'quest' || type === 'skill') ctx.world.recordDeleted(type, id);
    if (STATS_TYPES.has(type) || clean) ctx.world.statsContentChanged();
    // The monsters of a deleted enemy leave the maps; cleaned references may have changed other enemies.
    if (type === 'enemy' || clean) ctx.world.combat.enemiesChanged();
    res.json({ ok: true });
  });

  // "Test" button of an enemy: it appears next to the administrator's character in game, and attacks it.
  router.post('/db/enemy/:id/test', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !ctx.gameData.get('enemy', id)) {
      fail(res, 404, 'error.db.not_found');
      return;
    }
    const me = currentAccount(res)!;
    const p = [...ctx.world.allPlayers()].find((o) => o.accountId === me.id && ctx.world.isLive(o));
    if (!p) {
      fail(res, 409, 'error.db.test_offline');
      return;
    }
    if (!ctx.world.combat.ambush(p, id)) {
      fail(res, 409, 'error.db.test_no_room');
      return;
    }
    ctx.admin.logAdmin(me.id, 'test_enemy', `character:${p.characterId}`, { enemyId: id, mapId: p.mapId });
    res.json({ ok: true });
  });

  router.get('/system', (_req, res) => {
    res.json({ system: readSystem(ctx) });
  });

  router.put('/system', (req, res) => {
    const current = readSystem(ctx);
    const values = normalizeSystem((req.body as { system?: Record<string, unknown> }).system ?? {}, current);
    // A start on a missing map or a blocked cell would keep every new player out.
    const start = values.startPosition!;
    if (JSON.stringify(start) !== JSON.stringify(current.startPosition) && !isValidStart(ctx, start)) {
      fail(res, 400, 'error.db.invalid_start');
      return;
    }
    ctx.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) ctx.settings.set(key, value);
    })();
    ctx.world.systemChanged();
    res.json({ system: readSystem(ctx) });
  });

  router.get('/db-export', (_req, res) => {
    const data = Object.fromEntries(DATABASE_TYPES.map((t) => [t, ctx.gameData.list(t)]));
    res.setHeader('Content-Disposition', 'attachment; filename="database.json"');
    res.json({ version: DATABASE_EXPORT_VERSION, database: data, system: readSystem(ctx) });
  });

  router.post('/db-import', (req, res) => {
    const body = req.body as { version?: unknown; database?: Record<string, unknown[]>; system?: Record<string, unknown> };
    if (body.version !== DATABASE_EXPORT_VERSION || typeof body.database !== 'object' || body.database === null) {
      fail(res, 400, 'error.db.invalid_export');
      return;
    }
    const records: Partial<{ [T in DatabaseType]: GameDataTypes[T][] }> = {};
    try {
      for (const type of DATABASE_TYPES) {
        const list = body.database[type];
        if (!Array.isArray(list)) continue;
        const seen = new Set<number>();
        const out: unknown[] = [];
        for (const raw of list) {
          const id = Number((raw as { id?: unknown })?.id);
          if (!Number.isInteger(id) || id < 1 || id > 9999 || seen.has(id)) throw new SchemaError(`${type}.id`);
          seen.add(id);
          out.push(normalizeRecord(type, raw, id));
        }
        (records as Record<string, unknown[]>)[type] = out;
      }
    } catch (err) {
      if (err instanceof SchemaError) {
        fail(res, 400, 'error.db.invalid_field', { field: err.path });
        return;
      }
      throw err;
    }
    if (records.class && records.class.length === 0) {
      fail(res, 400, 'error.db.last_class');
      return;
    }
    // A reference to an entry neither in the file nor kept here is imported as it is (a forced deletion can
    // legitimately leave some), but listed so that the administrator can fix it: the game ignores it.
    const idsOf = new Map<DatabaseType, Set<number>>();
    const exists = (t: DatabaseType, id: number) => {
      const incoming = records[t];
      if (!incoming) return ctx.gameData.get(t, id) !== undefined;
      if (!idsOf.has(t)) idsOf.set(t, new Set(incoming.map((r) => r.id)));
      return idsOf.get(t)!.has(id);
    };
    const missing: { type: DatabaseType; id: number; field: string; value: string }[] = [];
    for (const type of DATABASE_TYPES) {
      for (const record of records[type] ?? []) {
        const ref = findMissingRef(type, record, exists);
        if (ref) missing.push({ type, id: record.id, field: ref.path, value: String(ref.value) });
      }
    }
    // Code from a file runs only once an administrator has approved it, whatever the file says (see `shared/quarantine.ts`).
    let quarantined = 0;
    for (const ce of records.commonEvent ?? []) quarantined += quarantineList(ce.list);
    // Like a deletion, an import may not take away a class that characters still play.
    if (records.class) {
      const kept = new Set(records.class.map((c) => c.id));
      const orphans = ctx.db.prepare<[], number>('SELECT class_id FROM characters').pluck().all().filter((id) => !kept.has(id)).length;
      if (orphans > 0) {
        fail(res, 400, 'error.db.import_class_in_use', { count: orphans });
        return;
      }
    }
    // Records an import takes away: the copies players own are removed with them (as for a deletion), otherwise
    // they would stay in the bags, unseen and undroppable.
    // Quests and skills an import takes away: what characters keep of them goes too (as for a deletion).
    const dropped: ['quest' | 'skill', number][] = [];
    const owners = ctx.db.transaction(() => {
      for (const [type, sql] of [['quest', 'DELETE FROM character_quests WHERE quest_id = ?'], ['skill', 'DELETE FROM character_skills WHERE skill_id = ?']] as const) {
        const incoming = records[type];
        if (!incoming) continue;
        const kept = new Set<number>(incoming.map((r) => r.id));
        const remove = ctx.db.prepare(sql);
        for (const old of ctx.gameData.list(type)) {
          if (kept.has(old.id)) continue;
          remove.run(old.id);
          dropped.push([type, old.id]);
        }
      }
      const removed = { characters: new Set<number>(), guilds: new Set<number>() };
      for (const type of ['item', 'weapon', 'armor'] as const) {
        const incoming = records[type];
        if (!incoming) continue;
        const kept = new Set<number>(incoming.map((r) => r.id));
        for (const old of ctx.gameData.list(type)) {
          if (kept.has(old.id)) continue;
          const owned = removeOwnedCopies(ctx, type, old.id);
          owned.characters.forEach((c) => removed.characters.add(c));
          owned.guilds.forEach((g) => removed.guilds.add(g));
        }
      }
      ctx.gameData.replaceAll(records);
      return removed;
    })();
    ctx.world.ownedCopiesRemoved([...owners.characters], [...owners.guilds]);
    for (const [type, id] of dropped) ctx.world.recordDeleted(type, id);
    if (body.system) {
      const current = readSystem(ctx);
      const values = normalizeSystem(body.system, current);
      // A start position made for other maps is not taken: the current one stays.
      if (!isValidStart(ctx, values.startPosition!)) values.startPosition = current.startPosition;
      ctx.db.transaction(() => {
        for (const [key, value] of Object.entries(values)) ctx.settings.set(key, value);
      })();
    }
    ctx.world.systemChanged();
    ctx.world.combat.enemiesChanged();
    ctx.world.statsContentChanged();
    res.json({ ok: true, counts: Object.fromEntries(Object.entries(records).map(([t, l]) => [t, (l as unknown[]).length])), quarantined, missingRefs: { count: missing.length, first: missing.slice(0, 10) } });
  });

  return router;
}

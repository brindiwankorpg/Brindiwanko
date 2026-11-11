/**
 * @file Repository of the `game_data` table: every record authored in the
 * editor's database tabs, stored as JSON and typed through `GameDataTypes`.
 *
 * A small in-memory cache avoids re-parsing JSON on hot paths (the game loop
 * reads classes and tilesets constantly); every write goes through this class
 * and invalidates the cache, so the editor's changes are visible immediately.
 */
import type { Statement } from 'better-sqlite3';
import { normalizeRecord } from '../../shared/database-schema.js';
import { DATABASE_TYPES, type DatabaseType, type GameDataType, type GameDataTypes } from '../../shared/database.js';
import type { Db } from './database.js';
import { SettingsRepository } from './settings.js';

/**
 * Setting keeping, for each type, the highest id a deleted record had: a new record never takes the
 * id of a deleted one (players online may still hold its quest progress or learned skill, and history
 * and logs name records by id).
 */
const LAST_IDS_KEY = 'lastRecordIds';

/** Typed access to editor database records. */
export class GameDataRepository {
  private readonly listStmt: Statement<[string], { data: string }>;
  private readonly upsertStmt: Statement<[string, number, string, string]>;
  private readonly deleteStmt: Statement<[string, number]>;
  private readonly countStmt: Statement<[string], number>;
  private readonly cache = new Map<GameDataType, Map<number, unknown>>();
  /** Number of writes of each type, for caches built from its records. */
  private readonly generations = new Map<GameDataType, number>();
  /**
   * Types written in the transaction under way: their records are not cached until it ends, since it may
   * still be rolled back (the cache would then hold records that were never stored).
   */
  private readonly tentative = new Set<GameDataType>();

  private readonly settings: SettingsRepository;

  constructor(private readonly db: Db) {
    this.settings = new SettingsRepository(db);
    this.listStmt = db.prepare('SELECT data FROM game_data WHERE type = ? ORDER BY id');
    this.upsertStmt = db.prepare(`INSERT INTO game_data (type, id, name, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(type, id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = datetime('now')`);
    this.deleteStmt = db.prepare('DELETE FROM game_data WHERE type = ? AND id = ?');
    this.countStmt = db.prepare<[string], number>('SELECT COUNT(*) FROM game_data WHERE type = ?').pluck();
  }

  private load<T extends GameDataType>(type: T): Map<number, GameDataTypes[T]> {
    this.settle();
    let entries = this.cache.get(type) as Map<number, GameDataTypes[T]> | undefined;
    if (!entries) {
      entries = new Map();
      for (const row of this.listStmt.all(type)) {
        let record = JSON.parse(row.data) as GameDataTypes[T];
        // Records written by older versions are completed with the current schema's defaults.
        if ((DATABASE_TYPES as readonly string[]).includes(type)) {
          record = normalizeRecord(type as DatabaseType, record, record.id) as unknown as GameDataTypes[T];
        }
        entries.set(record.id, record);
      }
      if (!this.tentative.has(type)) this.cache.set(type, entries);
    }
    return entries;
  }

  /**
   * Once the transaction that wrote some types has ended (committed or rolled back), they are read again
   * from the database, and the caches built on them are told.
   */
  private settle(): void {
    if (this.tentative.size === 0 || this.db.inTransaction) return;
    for (const type of this.tentative) {
      this.cache.delete(type);
      this.generations.set(type, (this.generations.get(type) ?? 0) + 1);
    }
    this.tentative.clear();
  }

  /** All records of a type, ordered by id. */
  list<T extends GameDataType>(type: T): GameDataTypes[T][] {
    return [...this.load(type).values()];
  }

  /** One record, or `undefined`. */
  get<T extends GameDataType>(type: T, id: number): GameDataTypes[T] | undefined {
    return this.load(type).get(id);
  }

  /** Number of records of a type. */
  count(type: GameDataType): number {
    return this.countStmt.get(type)!;
  }

  /** Inserts or replaces a record. */
  save<T extends GameDataType>(type: T, record: GameDataTypes[T]): void {
    this.upsertStmt.run(type, record.id, record.name, JSON.stringify(record));
    this.changed(type);
  }

  /** Next free id of a type (never the id of a deleted record). */
  nextId(type: GameDataType): number {
    return Math.max(0, this.settings.get<Partial<Record<string, number>>>(LAST_IDS_KEY, {})[type] ?? 0, ...this.load(type).keys()) + 1;
  }

  /** Notes that ids up to `id` were given, so that `nextId` never gives them again. */
  private retire(type: GameDataType, id: number): void {
    const last = this.settings.get<Partial<Record<string, number>>>(LAST_IDS_KEY, {});
    if ((last[type] ?? 0) < id) this.settings.set(LAST_IDS_KEY, { ...last, [type]: id });
  }

  /**
   * Replaces every record of several types in one transaction (database import).
   * @param records - New records by type.
   */
  replaceAll(records: Partial<{ [T in GameDataType]: GameDataTypes[T][] }>): void {
    const clear = this.db.prepare('DELETE FROM game_data WHERE type = ?');
    this.db.transaction(() => {
      for (const [type, list] of Object.entries(records) as [GameDataType, { id: number; name: string }[]][]) {
        this.retire(type, Math.max(0, ...this.load(type).keys()));
        clear.run(type);
        for (const r of list) this.upsertStmt.run(type, r.id, r.name, JSON.stringify(r));
        this.changed(type);
      }
    })();
  }

  /** Deletes a record. */
  remove(type: GameDataType, id: number): void {
    this.deleteStmt.run(type, id);
    this.retire(type, id);
    this.changed(type);
  }

  /** Changes each time a record of the type is written or deleted. */
  generation(type: GameDataType): number {
    this.settle();
    return this.generations.get(type) ?? 0;
  }

  /**
   * Drops the cached records of every type: they are read again from the database. Needed after a
   * transaction that wrote records was rolled back (the cache could hold records that do not exist).
   */
  forget(): void {
    for (const type of new Set([...this.cache.keys(), ...this.generations.keys()])) this.changed(type);
  }

  private changed(type: GameDataType): void {
    this.cache.delete(type);
    this.generations.set(type, (this.generations.get(type) ?? 0) + 1);
    if (this.db.inTransaction) this.tentative.add(type);
  }
}

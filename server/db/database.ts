/**
 * @file Opens the single SQLite database file used for all persistent game data.
 *
 * SQLite is the only storage engine of the game: accounts, characters, world
 * state and every piece of content authored in the editor live in one file
 * (`data/game.db` by default). This module owns the connection and applies the
 * pragmas every other module relies on (WAL, foreign keys...).
 */
import Database, { type Statement } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Connection type used across repositories. */
export type Db = Database.Database;

/**
 * Opens (and creates if needed) a SQLite database with the engine's standard pragmas.
 * @param file - Path of the database file, or `:memory:` for tests.
 * @returns A ready-to-use connection. Migrations are NOT applied here; see `migrate()`.
 */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL lets the game loop keep reading while a batch save is being written.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // NORMAL is durable enough with WAL (only the last transactions may be lost on power failure).
  db.pragma('synchronous = NORMAL');
  // Wait instead of failing immediately if a backup or another handle holds a lock.
  db.pragma('busy_timeout = 5000');
  // Page cache of 32 MB (2 MB by default): the pages read by the game (maps, characters, inventories)
  // stay in memory. Reads go through a memory mapping of up to 256 MB of the file (no copy per read).
  db.pragma('cache_size = -32000');
  if (file !== ':memory:') db.pragma('mmap_size = 268435456');
  return db;
}

const statementCache = new WeakMap<Db, Map<string, Statement<never[], unknown>>>();

/**
 * Prepares a statement once per connection, SQL text, and pluck mode, then returns the same one on later calls.
 * Repositories use it for queries issued from game events (each `db.prepare` would parse the SQL
 * and compile it again). Pass `{ pluck: true }` instead of calling `.pluck()` on the returned statement.
 * @param db - Connection.
 * @param sql - SQL text.
 * @param options - Optional statement mode (`pluck: true` keeps a separate cache entry).
 */
export function prepareCached<P extends unknown[] = unknown[], R = unknown>(
  db: Db,
  sql: string,
  options?: { pluck?: boolean },
): Statement<P, R> {
  let statements = statementCache.get(db);
  if (!statements) {
    statements = new Map();
    statementCache.set(db, statements);
  }
  const pluck = options?.pluck === true;
  const key = `${pluck ? 'P:' : 'R:'}${sql}`;
  let statement = statements.get(key);
  if (!statement) {
    const prepared = db.prepare(sql);
    statement = (pluck ? prepared.pluck() : prepared) as unknown as Statement<never[], unknown>;
    statements.set(key, statement);
  }
  return statement as unknown as Statement<P, R>;
}

/**
 * Parses a JSON column stored in SQLite without throwing on corrupted data.
 * @param raw - Raw JSON text.
 * @param fallback - Value returned when parsing fails.
 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * @file Automatic backups of the whole game, and their restoration.
 *
 * Every day, at the hour chosen in the administration panel, a folder
 * `data/backups/brindiwanko-YYYYMMDD-HHMMSS/` receives a consistent copy of the
 * database (SQLite online backup: accounts, characters, maps, game database,
 * settings) and of the imported resources (`uploads/`). Only the number of
 * backups chosen in the panel is kept: the next one replaces the oldest. A
 * server that was stopped at that hour backs up as soon as it starts again.
 * Backups stay on the server: whoever can open its files can put one back
 * with `npm run restore` (see `server/restore.ts`).
 *
 * A restoration is prepared while the server runs and applied at its next
 * start, before the database is opened: the files in use are kept next to the
 * new ones (`.before-restore`). The restore files carry the name of the
 * database, so another server started from the same project (a test server,
 * for instance) with another database never applies them by mistake.
 */
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import type { BackupSchedule } from '../../shared/settings.js';
import type { Db } from './database.js';
import { listMigrations, migrate } from './migrate.js';
import { PATHS, restorePathOf } from '../paths.js';

/** Backups written by this module: folders, and the database files of older versions. */
const BACKUP_NAME = /^brindiwanko-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\.db)?$/;
/** Database file inside a backup folder. */
export const BACKUP_DB = 'game.db';
/** Resources folder inside a backup folder. */
const BACKUP_UPLOADS = 'uploads';
/** First bytes of every SQLite database file. */
export const SQLITE_HEADER = 'SQLite format 3\u0000';

/** Backups of a folder, oldest first (their names sort by date). */
export function listBackups(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => BACKUP_NAME.test(f)).sort() : [];
}

/** Time of a backup, read from its name (UTC). */
export function backupTime(name: string): number {
  const m = BACKUP_NAME.exec(name)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

/**
 * Writes one backup now (database and resources), then deletes the oldest ones beyond `keep`.
 * @param uploads - Imported resources folder (`null`: database only).
 * @returns The path of the new backup folder.
 */
export async function backupNow(db: Db, dir: string, keep: number, uploads: string | null, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const target = join(dir, `brindiwanko-${stamp}`);
  // Written under another name first: an interrupted backup is never taken for a complete one.
  const partial = `${target}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial);
  await db.backup(join(partial, BACKUP_DB));
  if (uploads && existsSync(uploads)) await cp(uploads, join(partial, BACKUP_UPLOADS), { recursive: true });
  renameSync(partial, target);
  const backups = listBackups(dir);
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) rmSync(join(dir, old), { recursive: true, force: true });
  // Leftovers of backups interrupted by a stop of the server.
  for (const f of readdirSync(dir)) if (f.endsWith('.partial')) rmSync(join(dir, f), { recursive: true, force: true });
  return target;
}

/** Logs with no retention of their own, and how many days of them are kept. */
const LOG_TABLES = ['connection_log', 'admin_log', 'sale_log', 'drop_log', 'trade_log', 'guild_log', 'report_log'] as const;
export const LOG_RETENTION_DAYS = 90;

/**
 * Deletes the log lines older than the retention delay, so the tables cannot grow without bound.
 * @returns The number of lines deleted.
 */
export function purgeOldLogs(db: Db, days = LOG_RETENTION_DAYS): number {
  // One transaction for every table: one write to the journal, and never half of the logs purged.
  return db.transaction(() => {
    let deleted = 0;
    for (const table of LOG_TABLES) {
      deleted += db.prepare(`DELETE FROM ${table} WHERE created_at < datetime('now', ?)`).run(`-${Math.max(1, Math.floor(days))} days`).changes;
    }
    return deleted;
  })();
}

/**
 * Last time a daily backup was due: today at `hour` (server time), or yesterday before that hour.
 * @param hour - Hour of the day (0 to 23).
 */
export function lastDue(hour: number, now = new Date()): number {
  const due = new Date(now);
  due.setHours(hour, 0, 0, 0);
  if (due.getTime() > now.getTime()) due.setDate(due.getDate() - 1);
  return due.getTime();
}

/**
 * Starts the automatic backups: one a day, at the hour of the schedule. The
 * schedule is read again at every check (every 5 minutes, and a minute after
 * start), so a change in the panel needs no restart, and a server that was
 * stopped at that hour backs up as soon as it runs again. The logs older than
 * `LOG_RETENTION_DAYS` are deleted once a day too, even when backups fail.
 * @param schedule - Current hour and number of backups kept.
 * @returns A function stopping them.
 */
export function scheduleBackups(db: Db, dir: string, uploads: string | null, schedule: () => BackupSchedule): () => void {
  let running = false;
  let purged = 0;
  const check = () => {
    // Old logs (with addresses) go once a day, whether the backup works or not.
    if (Date.now() - purged >= 24 * 3_600_000) {
      purged = Date.now();
      try {
        purgeOldLogs(db);
      } catch (err) {
        console.error('[brindiwanko] purging the old logs failed', err);
      }
    }
    const { hour, keep } = schedule();
    const last = listBackups(dir).at(-1);
    if (running || (last && backupTime(last) >= lastDue(hour))) return;
    running = true;
    backupNow(db, dir, keep, uploads)
      .catch((err: unknown) => console.error('[brindiwanko] automatic backup failed', err))
      .finally(() => (running = false));
  };
  const first = setTimeout(check, 60_000);
  const timer = setInterval(check, 5 * 60_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Tables (with their columns), indexes and other objects (triggers, views) of a database. */
interface SchemaShape {
  tables: Map<string, string>;
  indexes: Set<string>;
  others: string[];
}

/** Reads the shape of a database: what `sqlite_master` lists, the columns of each table. */
function shapeOf(db: Database.Database): SchemaShape {
  const rows = db.prepare<[], { type: string; name: string }>('SELECT type, name FROM sqlite_master').all();
  const columns = db.prepare<[string], string>('SELECT name FROM pragma_table_info(?)').pluck();
  const shape: SchemaShape = { tables: new Map(), indexes: new Set(), others: [] };
  for (const { type, name } of rows) {
    // SQLite's own objects (sequences, statistics, automatic indexes of UNIQUE columns) are not schema.
    if (name.startsWith('sqlite_')) continue;
    if (type === 'table') shape.tables.set(name, columns.all(name).sort().join(','));
    else if (type === 'index') shape.indexes.add(name);
    else shape.others.push(`${type} ${name}`);
  }
  return shape;
}

/** Schema made by the migrations of this engine up to a version, by version (built once each). */
const referenceShapes = new Map<number, SchemaShape>();

function referenceShape(version: number, migrationsDir: string): SchemaShape {
  let shape = referenceShapes.get(version);
  if (!shape) {
    const db = new Database(':memory:');
    try {
      migrate(db, migrationsDir, version);
      shape = shapeOf(db);
    } finally {
      db.close();
    }
    referenceShapes.set(version, shape);
  }
  return shape;
}

/** Reads the first bytes of a file. */
function hasSqliteHeader(file: string): boolean {
  const header = Buffer.alloc(16);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, header, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  return header.toString('latin1') === SQLITE_HEADER;
}

/**
 * Why a file cannot be put back as the database of this engine, or `null` when its schema is exactly the
 * one the migrations make at its version: no table, column or index missing or added, and no trigger or
 * view (a backup of the game never has any, and code hidden in one would run in the live game).
 * Only the schema is read here (fast); {@link inspectBackup} also checks every page.
 * @returns A translation key, or `null`.
 */
export function backupSchemaProblem(file: string, migrationsDir = PATHS.migrations): string | null {
  try {
    if (!hasSqliteHeader(file)) return 'error.admin.invalid_backup';
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const versions = db.prepare<[], number>('SELECT version FROM schema_migrations ORDER BY version').pluck().all();
      const known = listMigrations(migrationsDir).map((m) => m.version);
      const newest = versions.at(-1);
      if (newest === undefined) return 'error.admin.invalid_backup';
      if (versions.some((v) => !known.includes(v))) return newest > known.at(-1)! ? 'error.admin.backup_newer' : 'error.admin.invalid_backup';
      // Migrations are applied in order: a backup has every one of them up to its newest.
      if (versions.join() !== known.filter((v) => v <= newest).join()) return 'error.admin.invalid_backup';
      const shape = shapeOf(db);
      if (shape.others.length > 0) return 'error.admin.backup_unsafe';
      const reference = referenceShape(newest, migrationsDir);
      const same = <T>(a: Set<T> | Map<T, unknown>, b: Set<T> | Map<T, unknown>) => a.size === b.size && [...a.keys()].every((k) => b.has(k));
      if (!same(shape.tables, reference.tables) || !same(shape.indexes, reference.indexes)) return 'error.admin.invalid_backup';
      for (const [table, columns] of reference.tables) if (shape.tables.get(table) !== columns) return 'error.admin.invalid_backup';
      return null;
    } finally {
      db.close();
    }
  } catch {
    return 'error.admin.invalid_backup';
  }
}

/** Why a backup cannot be restored (schema, then every page read), or `null` when it is a sound database of this engine. */
export function backupProblem(file: string): string | null {
  const problem = backupSchemaProblem(file);
  if (problem) return problem;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      // A truncated or corrupted file must not replace the live database.
      return db.pragma('quick_check', { simple: true }) === 'ok' ? null : 'error.admin.invalid_backup';
    } finally {
      db.close();
    }
  } catch {
    return 'error.admin.invalid_backup';
  }
}

/** Tells whether a file is a sound database of this engine (see {@link backupProblem}). */
export function checkBackup(file: string): boolean {
  return backupProblem(file) === null;
}

/** Code of the worker thread reading every page of an uploaded backup (CommonJS, run with `eval`: no file to resolve). */
const CHECK_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
let ok = false;
try {
  const Database = require(workerData.library);
  const db = new Database(workerData.file, { readonly: true, fileMustExist: true });
  try {
    ok = db.pragma('quick_check', { simple: true }) === 'ok';
  } finally {
    db.close();
  }
} catch {}
parentPort.postMessage(ok);
`;

/**
 * Same check as {@link backupProblem}, the page reading in a worker thread: reading a backup of hundreds of
 * megabytes takes seconds, during which the game must keep running.
 * @returns A translation key, or `null` when the backup may be restored.
 */
export async function inspectBackup(file: string): Promise<string | null> {
  const problem = backupSchemaProblem(file);
  if (problem) return problem;
  const sound = await new Promise<boolean>((resolve) => {
    const worker = new Worker(CHECK_WORKER, { eval: true, workerData: { file, library: createRequire(import.meta.url).resolve('better-sqlite3') } });
    worker.once('message', (ok: unknown) => resolve(ok === true));
    worker.once('error', () => resolve(false));
    worker.once('exit', () => resolve(false));
  });
  return sound ? null : 'error.admin.invalid_backup';
}

/** Tells whether an uploaded backup may be restored (see {@link inspectBackup}). */
export async function checkBackupInWorker(file: string): Promise<boolean> {
  return (await inspectBackup(file)) === null;
}

/**
 * Removes the open sessions, the pending "forgotten password" links and the server secrets from a copy of
 * the database; the freed space is overwritten so nothing can be recovered. A restored database therefore
 * logs everybody out and creates new secrets.
 * @param file - Database copy (never the live database).
 */
export function stripSecrets(file: string): void {
  const copy = new Database(file);
  try {
    // The copy is checked before this (no trigger, no view), and nothing it holds may run code here anyway.
    copy.pragma('trusted_schema = OFF');
    copy.pragma('journal_mode = DELETE');
    copy.pragma('secure_delete = ON');
    copy.transaction(() => {
      // Refused before this, dropped anyway: a trigger would run on the deletions below.
      for (const { type, name } of copy.prepare<[], { type: string; name: string }>("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'view')").all()) {
        copy.exec(`DROP ${type === 'view' ? 'VIEW' : 'TRIGGER'} IF EXISTS "${name.replaceAll('"', '""')}"`);
      }
      copy.exec('DELETE FROM sessions; DELETE FROM server_secrets;');
      // Pending "forgotten password" links (backups made before they existed have no such table).
      if (copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'password_resets'").get()) copy.exec('DELETE FROM password_resets;');
    })();
  } finally {
    copy.close();
  }
}

/** Where the resources of a backup wait to replace `uploads/` at the next start. */
export function uploadsRestorePathOf(dbPath: string): string {
  return `${dbPath}.restore-pending-uploads`;
}

/**
 * Prepares the restoration of an automatic backup, applied at the next start of the server. Like a backup
 * uploaded in the panel, the copy put back holds no session, no "forgotten password" link and no server
 * secret: everybody logs in again.
 *
 * Everything is prepared under temporary names first, then published, the database last (it is what makes
 * the restoration apply): a failure on the way (full disk...) leaves the previous preparation, or none,
 * exactly as it was, never a database waiting without its resources.
 * @param backup - Backup folder (or database file of an older version).
 * @param dbPath - Database of the server.
 * @returns Whether the backup also had resources, or the reason it is refused (translation key).
 */
export function prepareRestore(backup: string, dbPath: string): { uploads: boolean } | { problem: string } | null {
  if (!existsSync(backup)) return null;
  const folder = statSync(backup).isDirectory();
  const db = folder ? join(backup, BACKUP_DB) : backup;
  if (!existsSync(db)) return null;
  const problem = backupProblem(db);
  if (problem) return { problem };
  const pending = restorePathOf(dbPath);
  const pendingUploads = uploadsRestorePathOf(dbPath);
  const stage = `${pending}.partial`;
  const stageUploads = `${pendingUploads}.partial`;
  const removeStage = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(stage + suffix, { force: true });
    rmSync(stageUploads, { recursive: true, force: true });
  };
  removeStage();
  const uploads = join(backup, BACKUP_UPLOADS);
  const withUploads = folder && existsSync(uploads);
  try {
    cpSync(db, stage);
    // The backup was copied while the database was in WAL mode: its last pages may be in the side file.
    for (const suffix of ['-wal', '-shm']) if (existsSync(db + suffix)) cpSync(db + suffix, stage + suffix);
    stripSecrets(stage);
    for (const suffix of ['-wal', '-shm']) rmSync(stage + suffix, { force: true });
    if (withUploads) cpSync(uploads, stageUploads, { recursive: true });
  } catch (err) {
    removeStage();
    throw err;
  }
  // The previous preparation stops applying first; then the resources, then the database, take their place.
  rmSync(pending, { force: true });
  rmSync(pendingUploads, { recursive: true, force: true });
  if (withUploads) renameSync(stageUploads, pendingUploads);
  renameSync(stage, pending);
  return { uploads: withUploads };
}

/** Moves a file or a folder, also to another disk. */
function move(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** Marker left by {@link applyPendingRestore} when it also put back the resources (for {@link undoRestore}). */
function swappedUploadsMarker(dbPath: string): string {
  return `${dbPath}.restore-uploads-swapped`;
}

/**
 * Applies a restoration waiting for this database (backup uploaded from the
 * administration panel, or prepared by `npm run restore`): called at start,
 * before the database is opened. The replaced files are kept as `.before-restore`.
 * @param dbPath - Database of the server.
 * @param uploads - Imported resources folder.
 * @returns Whether something was restored.
 */
export function applyPendingRestore(dbPath: string, uploads: string): boolean {
  if (dbPath === ':memory:') return false;
  const pending = restorePathOf(dbPath);
  const pendingUploads = uploadsRestorePathOf(dbPath);
  if (!existsSync(pending)) return false;
  // Leftovers of a previous restoration must not stay next to the new `.before-restore` copy.
  for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}.before-restore${suffix}`, { force: true });
  for (const suffix of ['-wal', '-shm']) if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, `${dbPath}.before-restore${suffix}`);
  if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.before-restore`);
  renameSync(pending, dbPath);
  rmSync(swappedUploadsMarker(dbPath), { force: true });
  if (existsSync(pendingUploads)) {
    const kept = `${uploads}.before-restore`;
    rmSync(kept, { recursive: true, force: true });
    if (existsSync(uploads)) move(uploads, kept);
    move(pendingUploads, uploads);
    writeFileSync(swappedUploadsMarker(dbPath), '');
  }
  return true;
}

/**
 * Puts back the database (and the resources) that a restoration replaced, when the restored one cannot
 * be started: the server then runs on the data it had instead of not starting at all. The refused files
 * are kept as `.failed-restore` for a closer look.
 * @returns Whether the previous database was there to put back.
 */
export function undoRestore(dbPath: string, uploads: string): boolean {
  const previous = `${dbPath}.before-restore`;
  if (dbPath === ':memory:' || !existsSync(previous)) return false;
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${dbPath}.failed-restore${suffix}`, { force: true });
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, `${dbPath}.failed-restore${suffix}`);
  }
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(previous + suffix)) renameSync(previous + suffix, dbPath + suffix);
  if (existsSync(swappedUploadsMarker(dbPath))) {
    const kept = `${uploads}.before-restore`;
    const failed = `${uploads}.failed-restore`;
    rmSync(failed, { recursive: true, force: true });
    if (existsSync(uploads)) move(uploads, failed);
    if (existsSync(kept)) move(kept, uploads);
    rmSync(swappedUploadsMarker(dbPath), { force: true });
  }
  return true;
}

/**
 * @file Resolves the project root directory and well-known sub-directories.
 *
 * The server runs either from sources (`server/*.ts` through tsx) or from the
 * compiled output (`dist/server/*.js`). Rather than relying on the current
 * working directory, we walk up from this module until we find `package.json`,
 * so that data, views, locales and assets are always found.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findProjectRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate project root (package.json not found)');
    dir = parent;
  }
}

/** Absolute path of the project root (the folder containing `package.json`). */
export const ROOT_DIR = findProjectRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Well-known project directories, all absolute. The folders the server writes to can be moved with
 * `DATA_DIR` (database, backups) and `UPLOADS_DIR` (imported resources); the tests point them to a
 * temporary folder, so that running them never touches the files of a server in service.
 */
export const PATHS = {
  root: ROOT_DIR,
  views: join(ROOT_DIR, 'views'),
  locales: join(ROOT_DIR, 'locales'),
  public: join(ROOT_DIR, 'public'),
  assets: join(ROOT_DIR, 'assets'),
  audio: join(ROOT_DIR, 'audio'),
  uploads: process.env.UPLOADS_DIR ? resolve(ROOT_DIR, process.env.UPLOADS_DIR) : join(ROOT_DIR, 'uploads'),
  migrations: join(ROOT_DIR, 'server', 'db', 'migrations'),
  data: process.env.DATA_DIR ? resolve(ROOT_DIR, process.env.DATA_DIR) : join(ROOT_DIR, 'data'),
} as const;

/**
 * Resolves a path relative to the project root unless it is already absolute.
 * @param p - Relative or absolute path.
 */
export function fromRoot(p: string): string {
  return resolve(ROOT_DIR, p);
}

/**
 * Folder for the files that belong to a database (backups, downloaded copies): the one holding
 * the database file, so that two servers using two databases never share them.
 * @param dbPath - Database file, or `:memory:` (tests: the project's `data` folder).
 */
export function dataDirOf(dbPath: string): string {
  return dbPath === ':memory:' ? PATHS.data : dirname(dbPath);
}

/**
 * Folder of the automatic backups of a database (`backups/` next to it).
 * @param dbPath - Database file, or `:memory:`.
 */
export function backupsDirOf(dbPath: string): string {
  return join(dataDirOf(dbPath), 'backups');
}

/**
 * Where an uploaded backup waits to replace the database at the next start. It sits next to the
 * database and carries its name: another server started from the same project (a test server, for
 * instance) with another database never applies it by mistake.
 * @param dbPath - Database file, or `:memory:`.
 */
export function restorePathOf(dbPath: string): string {
  return dbPath === ':memory:' ? join(PATHS.data, 'restore-pending.db') : `${dbPath}.restore-pending`;
}

/**
 * @file `npm run restore`: puts an automatic backup back, from the server's terminal.
 *
 * - `npm run restore` lists the backups of `data/backups/` (newest first);
 * - `npm run restore -- latest` (or the name of a backup) prepares its restoration.
 *
 * The backup is checked first (its schema must be exactly the one this engine made at its version, every
 * page readable), and the copy put back holds no session nor server secret: everybody logs in again.
 *
 * The database and the imported resources of the backup replace the current
 * ones at the next start of the server (`pm2 restart brindiwanko`); the current
 * files are kept next to them (`.before-restore`). Run it with the same
 * `DB_PATH` as the server when that variable is set.
 */
import { join } from 'node:path';
import { config } from './config.js';
import { backupTime, listBackups, prepareRestore } from './db/backups.js';
import { backupsDirOf } from './paths.js';

const dir = backupsDirOf(config.dbPath);
const backups = listBackups(dir).reverse();
const wanted = process.argv[2];
const when = (name: string) => new Date(backupTime(name)).toLocaleString();

if (!wanted) {
  if (backups.length === 0) console.log(`No backup in ${dir} yet.`);
  else {
    console.log(`Backups in ${dir} (newest first):`);
    for (const name of backups) console.log(`  ${name}   ${when(name)}`);
    console.log('\nTo restore one: npm run restore -- latest   (or: npm run restore -- <name>)');
  }
  process.exit(0);
}

const name = wanted === 'latest' ? backups[0] : backups.find((b) => b === wanted);
if (!name) {
  console.error(`No backup named "${wanted}" in ${dir} (npm run restore lists them).`);
  process.exit(1);
}
const prepared = prepareRestore(join(dir, name), config.dbPath);
if (!prepared || 'problem' in prepared) {
  const why = prepared?.problem === 'error.admin.backup_newer' ? ' (it was made by a newer version of the game: update it first)' : prepared?.problem === 'error.admin.backup_unsafe' ? ' (it holds triggers or views, which a backup of the game never has)' : '';
  console.error(`${name} is not a valid backup of this game${why}: nothing was changed.`);
  process.exit(1);
}
console.log(`Backup ${name} (${when(name)}) is ready: the database${prepared.uploads ? ' and the imported resources' : ''} will be replaced at the next start of the server.`);
console.log('Restart it now (for instance: pm2 restart brindiwanko).');

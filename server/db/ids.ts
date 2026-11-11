/**
 * @file Numbers of new accounts and characters, never given twice.
 *
 * SQLite gives a new row the largest number in use plus one, so the number of
 * the last account or character deleted would come back with the next one
 * created. Everything that still names the deleted one by its number (the logs
 * read by the moderators, what the game keeps in memory for a while) would then
 * point to a stranger. New numbers are taken from the `id_sequences` table
 * instead, above every number given so far.
 */
import { prepareCached, type Db } from './database.js';

/** Tables whose numbers are never given twice. */
export const SEQUENCED_TABLES = ['accounts', 'characters'] as const;
export type SequencedTable = (typeof SEQUENCED_TABLES)[number];

/**
 * Statement taking the next number of each table. The table names come from the fixed list above, never
 * from a request. A row inserted by other means (an older tool, a hand-edited database) is still never
 * given its number again: the sequence never goes below the largest number in the table.
 */
const TAKE_SQL = Object.fromEntries(
  SEQUENCED_TABLES.map((table) => [
    table,
    `INSERT INTO id_sequences (name, seq) VALUES ('${table}', (SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}))
      ON CONFLICT(name) DO UPDATE SET seq = MAX(id_sequences.seq, (SELECT COALESCE(MAX(id), 0) FROM ${table})) + 1
      RETURNING seq`,
  ]),
) as Record<SequencedTable, string>;

/**
 * Takes the number of a new row. Call it inside the transaction that inserts the row, so that a refused
 * insertion gives the number back.
 * @param db - Connection.
 * @param table - Table of the new row.
 * @returns A number no row of the table ever had.
 */
export function takeId(db: Db, table: SequencedTable): number {
  return prepareCached<[], number>(db, TAKE_SQL[table]).pluck().get()!;
}

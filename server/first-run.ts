/**
 * @file First launch of a server: which language the demo content (classes, items, quests,
 * maps, dialogues, terms) is created in.
 *
 * When the database is brand new and the server runs in a terminal, the person starting it is
 * asked "Choose language/Choix de la langue (EN/FR) :" and must type `EN` or `FR` (no default: an
 * empty answer asks again). Without a terminal (a process manager, a container) nothing can be
 * asked: the `CONTENT_LANGUAGE` environment variable (`en` or `fr`) or else the language of the
 * system is used, and the log says so.
 * The choice is stored in the database and never asked again.
 */
import { existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import { isLocale, type Locale } from '../shared/i18n.js';
import { restorePathOf } from './paths.js';

/**
 * Language of the system running the server (`fr` for a French system, else `en`).
 * @param env - Environment (injectable for tests).
 * @param intl - Locale reported by the JavaScript runtime.
 */
export function systemLanguage(env: NodeJS.ProcessEnv = process.env, intl = Intl.DateTimeFormat().resolvedOptions().locale): Locale {
  const hint = env.LC_ALL || env.LC_MESSAGES || env.LANG || intl || '';
  return hint.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/**
 * Reads what was typed at the prompt.
 * @param answer - Typed text.
 * @returns The language, or `null` when the answer is neither `EN` nor `FR` (an empty answer is not one).
 */
export function parseLanguageAnswer(answer: string): Locale | null {
  const text = answer.trim().toLowerCase();
  return isLocale(text) ? text : null;
}

/**
 * Tells whether the database does not exist yet or holds nothing (so its content is still to create).
 * @param dbPath - Path of the database file, or `:memory:`.
 */
export function isNewDatabase(dbPath: string): boolean {
  if (dbPath === ':memory:') return false;
  // A backup waiting to be restored replaces the database at start: its language is already set.
  if (existsSync(restorePathOf(dbPath))) return false;
  if (!existsSync(dbPath) || statSync(dbPath).size === 0) return true;
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const hasSettings = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'system_settings'").get() !== undefined;
    return !hasSettings || db.prepare('SELECT COUNT(*) FROM system_settings').pluck().get() === 0;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Asks the question in the terminal until the answer is `EN` or `FR`. */
async function ask(fallback: Locale): Promise<Locale> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Pressing Ctrl+C at the prompt cancels the first launch instead of falling back to the system language.
  rl.on('SIGINT', () => {
    rl.close();
    console.log('');
    process.exit(130);
  });
  rl.setPrompt('Choose language/Choix de la langue (EN/FR) : ');
  rl.prompt();
  try {
    // Line by line, so that lines typed (or piped) in a burst are not lost between two questions.
    for await (const line of rl) {
      const chosen = parseLanguageAnswer(line);
      if (chosen) return chosen;
      console.log('Please type EN or FR / Tapez EN ou FR.');
      rl.prompt();
    }
    // The input ended without an answer (closed terminal): the language of the system.
    return fallback;
  } finally {
    rl.close();
  }
}

/**
 * Decides the language of the demo content for this start.
 * @param dbPath - Path of the database file.
 * @returns The language to seed a new database with, or `undefined` when the database already exists.
 */
export async function chooseContentLanguage(dbPath: string): Promise<Locale | undefined> {
  if (!isNewDatabase(dbPath)) return undefined;
  const fixed = process.env.CONTENT_LANGUAGE?.trim().toLowerCase();
  if (fixed) {
    if (!isLocale(fixed)) throw new Error(`Environment variable CONTENT_LANGUAGE must be "en" or "fr" (got "${fixed}")`);
    return fixed;
  }
  const fallback = systemLanguage();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`[brindiwanko] new database, no terminal to ask in: demo content in ${fallback.toUpperCase()} (set CONTENT_LANGUAGE=en or fr to choose)`);
    return fallback;
  }
  return ask(fallback);
}

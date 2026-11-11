/**
 * @file Runtime configuration, read once from environment variables with safe
 * defaults for local development. Every other module imports `config` instead
 * of reading `process.env` directly, so all tunables are listed in one place.
 *
 * Environment variables:
 * - `PORT` (default 3000), `HOST` (default 0.0.0.0)
 * - `SESSION_SECRET` (when unset, a random per-install secret is generated and
 *   stored in the database, so sessions survive restarts)
 * - `DB_PATH` (path of the database file, absolute or relative to the project folder, not to `DATA_DIR`;
 *   its backups go to a `backups/` folder next to it; default `game.db` in `DATA_DIR`, itself `data/` by default)
 * - `DATA_DIR`, `UPLOADS_DIR` (folder of the default database and its backups, which a `DB_PATH` you set
 *   ignores, and folder of the imported resources; default `data/` and `uploads/`, see `paths.ts`)
 * - `NODE_ENV` (`production` enables secure cookies and disables dev helpers)
 * - `TRUST_PROXY` (set to `1` behind a reverse proxy)
 * - `MAX_CHARACTERS` (characters per account, default 4)
 * - `BRINDIWANKO_DEV` (set to `1` by `npm run dev`)
 * - `SETUP_CODE` (code asked when registering the first account, which becomes
 *   administrator; in production without it, a random code is printed in the
 *   server log at start while the server has no account)
 * - `REGISTRATIONS_PER_HOUR` (accounts one address may create per hour;
 *   default 10 in production, unlimited otherwise; 0 = unlimited)
 * - `IMPORTS_PER_15_MIN` (project imports one account may start per 15 minutes;
 *   default 3 in production, unlimited otherwise; 0 = unlimited)
 * - `CONTENT_LANGUAGE` (`en` or `fr`: language of the demo content of a brand-new database,
 *   instead of asking in the terminal; without a terminal the system language is used)
 * - `PUBLIC_URL` (public address of the game, e.g. `https://jeu.example.org`:
 *   the game socket then only accepts pages of this exact origin; also the address
 *   of the links sent by e-mail)
 * - `SMTP_URL` (mail server used to send the "forgotten password" e-mails, e.g.
 *   `smtps://user:password@smtp.example.org:465`; without it no e-mail is sent:
 *   in development the link is written in the server log instead)
 * - `MAIL_FROM` (sender of those e-mails, e.g. `Brindiwanko <no-reply@example.org>`)
 */
import { join } from 'node:path';
import { PATHS, fromRoot } from './paths.js';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be an integer (got "${raw}")`);
  return value;
}

/** Origin (`scheme://host[:port]`) of a public URL given in the environment. */
function originFromEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`Environment variable ${name} must be a URL such as https://jeu.example.org (got "${raw}")`);
  }
}

const production = process.env.NODE_ENV === 'production';

/** Immutable server configuration. */
export const config = Object.freeze({
  port: intFromEnv('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  production,
  /** Set by `npm run dev`: enables hot-reload helpers (translation files...). */
  devReload: process.env.BRINDIWANKO_DEV === '1',
  /** Explicit session secret; when `undefined` a persisted random one is used. */
  sessionSecret: process.env.SESSION_SECRET || undefined,
  /** Database file (`:memory:` keeps everything in memory, for tests). */
  dbPath: process.env.DB_PATH === ':memory:' ? ':memory:' : process.env.DB_PATH ? fromRoot(process.env.DB_PATH) : join(PATHS.data, 'game.db'),
  trustProxy: process.env.TRUST_PROXY === '1',
  /** Origin of the public address, when set (game socket origin check). */
  publicUrl: originFromEnv('PUBLIC_URL'),
  /** Accounts one client address may create per hour (0 = unlimited). */
  registrationsPerHour: intFromEnv('REGISTRATIONS_PER_HOUR', production ? 10 : 0),
  /** Project imports (up to 200 MB each) one account may start per 15 minutes (0 = unlimited). */
  importsPer15Min: intFromEnv('IMPORTS_PER_15_MIN', production ? 3 : 0),
  maxCharactersPerAccount: intFromEnv('MAX_CHARACTERS', 4),
  /** Mail server sending the "forgotten password" e-mails (`undefined`: no e-mail is sent). */
  smtpUrl: process.env.SMTP_URL || undefined,
  /** Sender of the e-mails. */
  mailFrom: process.env.MAIL_FROM || undefined,
  /** Code protecting the registration of the first (administrator) account. */
  setupCode: process.env.SETUP_CODE || undefined,
  /** Session lifetime in milliseconds (30 days). */
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
});

/** Type of the configuration object. */
export type Config = typeof config;

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
 * - `TRUST_PROXY` (set to `1` or `true` behind a reverse proxy)
 * - `MAX_CHARACTERS` (characters per account, default 4)
 * - `BRINDIWANKO_DEV` (set to `1` by `npm run dev`)
 * - `SETUP_CODE` (code asked when registering the first account, which becomes
 *   administrator; in production without it, a random code is printed in the
 *   server log at start while the server has no account)
 * - `REGISTRATIONS_PER_HOUR` (accounts one address may create per hour;
 *   default 10 in production, unlimited otherwise; 0 = unlimited)
 * - `IMPORTS_PER_15_MIN` (project imports one account may start per 15 minutes;
 *   default 3 in production, unlimited otherwise; 0 = unlimited)
 * - `SOCKET_CONNECTIONS_PER_MIN` (game connections one account may open per minute, one client address
 *   three times as many; default 12 in production, unlimited otherwise; 0 = unlimited)
 * - `SANDBOX_WITHOUT_NETWORK_ISOLATION` (set to `1` to run event scripts on a Node.js whose permission
 *   model cannot close the network of the script sandbox; otherwise scripts are refused there)
 * - `CONTENT_LANGUAGE` (`en` or `fr`: language of the demo content of a brand-new database,
 *   instead of asking in the terminal; without a terminal the system language is used)
 * - `PUBLIC_URL` (public address of the game, e.g. `https://jeu.example.org`:
 *   the game socket then only accepts pages of this exact origin; also the address
 *   of the links sent by e-mail)
 * - `SMTP_URL` (mail server used to send the "forgotten password" e-mails, the
 *   notices of a changed address and the links confirming addresses, e.g.
 *   `smtps://user:password@smtp.example.org:465`; without it no e-mail is sent:
 *   in development the "forgotten password" link is written in the server log
 *   instead, and addresses are not confirmed)
 * - `MAIL_FROM` (sender of those e-mails, e.g. `Brindiwanko <no-reply@example.org>`)
 */
import { join } from 'node:path';
import { PATHS, fromRoot } from './paths.js';

export function intFromEnv(name: string, fallback: number, min: number, max: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Environment variable ${name} must be an integer (got "${env[name]}")`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Environment variable ${name} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

export function boolFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  throw new Error(`Environment variable ${name} must be "1", "true", "0", or "false" (got "${env[name]}")`);
}

/** Origin (`scheme://host[:port]`) of a public URL given in the environment. */
export function originFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Environment variable ${name} must be a URL such as https://jeu.example.org (got "${raw}")`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === 'null') {
    throw new Error(`Environment variable ${name} must use http:// or https:// (got "${raw}")`);
  }
  return url.origin;
}

const production = process.env.NODE_ENV === 'production';

/** Immutable server configuration. */
export const config = Object.freeze({
  port: intFromEnv('PORT', 3000, 0, 65535),
  host: process.env.HOST ?? '0.0.0.0',
  production,
  /** Set by `npm run dev`: enables hot-reload helpers (translation files...). */
  devReload: process.env.BRINDIWANKO_DEV === '1',
  /** Explicit session secret; when `undefined` a persisted random one is used. */
  sessionSecret: process.env.SESSION_SECRET || undefined,
  /** Database file (`:memory:` keeps everything in memory, for tests). */
  dbPath: process.env.DB_PATH === ':memory:' ? ':memory:' : process.env.DB_PATH ? fromRoot(process.env.DB_PATH) : join(PATHS.data, 'game.db'),
  trustProxy: boolFromEnv('TRUST_PROXY'),
  /** Origin of the public address, when set (game socket origin check). */
  publicUrl: originFromEnv('PUBLIC_URL'),
  /** Accounts one client address may create per hour (0 = unlimited). */
  registrationsPerHour: intFromEnv('REGISTRATIONS_PER_HOUR', production ? 10 : 0, 0, 1_000_000),
  /** Project imports (up to 200 MB each) one account may start per 15 minutes (0 = unlimited). */
  importsPer15Min: intFromEnv('IMPORTS_PER_15_MIN', production ? 3 : 0, 0, 1_000_000),
  /** Game connections (socket handshakes) one account may open per minute; one address may open three times as many (0 = unlimited). */
  socketConnectionsPerMin: intFromEnv('SOCKET_CONNECTIONS_PER_MIN', production ? 12 : 0, 0, 1_000_000),
  /** Event scripts run even where the network of their sandbox cannot be closed (the operator isolates the server). */
  sandboxWithoutNetworkIsolation: boolFromEnv('SANDBOX_WITHOUT_NETWORK_ISOLATION'),
  maxCharactersPerAccount: intFromEnv('MAX_CHARACTERS', 4, 1, 100),
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

/**
 * @file Server entry point.
 *
 * Boot sequence: read configuration -> (new database: ask the language of the demo content) -> open and migrate the SQLite database ->
 * build the Express app -> attach socket.io -> schedule the daily backups -> listen. On SIGINT/SIGTERM the
 * server stops accepting connections and closes the database cleanly so that
 * the WAL is checkpointed.
 */
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closeContext, createContext } from './context.js';
import { chooseContentLanguage } from './first-run.js';
import { createSocketServer } from './net/socket.js';
import { backupScheduleOf, DEFAULT_BACKUP_SCHEDULE } from '../shared/settings.js';
import { scheduleBackups } from './db/backups.js';
import { backupsDirOf, PATHS } from './paths.js';

// A brand-new database asks (in the terminal) which language its demo content is created in.
const contentLanguage = await chooseContentLanguage(config.dbPath);
const ctx = createContext(config, { contentLanguage });
const app = createApp(ctx);
const httpServer = createServer(app);
const io = createSocketServer(httpServer, ctx);
// Daily backups of the database and the imported resources, at the hour set in the administration panel.
const stopBackups =
  config.dbPath === ':memory:'
    ? () => undefined
    : scheduleBackups(ctx.db, backupsDirOf(config.dbPath), PATHS.uploads, () => backupScheduleOf(ctx.settings.get('backupSchedule', DEFAULT_BACKUP_SCHEDULE)));

if (config.production && !config.trustProxy) {
  console.warn('[brindiwanko] production mode without TRUST_PROXY=1: sessions use Secure cookies, so logins only work through an HTTPS reverse proxy that forwards X-Forwarded-Proto (set TRUST_PROXY=1)');
}
if (config.production && !config.publicUrl) {
  console.warn('[brindiwanko] production mode without PUBLIC_URL: the game socket checks the origin against the Host header only, and no "forgotten password" e-mail can be sent (set PUBLIC_URL=https://your.domain)');
} else if (config.smtpUrl && !config.publicUrl) {
  console.warn('[brindiwanko] SMTP_URL without PUBLIC_URL: "forgotten password" e-mails are only sent from pages opened on this machine (set PUBLIC_URL)');
}

httpServer.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`listening on http://${shownHost}:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // The readiness probe (/readyz, /healthz) fails from now on: no new player is sent to this server.
  ctx.stopping = true;
  stopBackups();
  console.log(`[brindiwanko] ${signal} received, shutting down`);
  // The game loop stops right away (and the players are saved): it must not keep ticking while the sockets close.
  try {
    ctx.world.close();
  } catch (err) {
    console.error('[brindiwanko] could not stop the game loop cleanly', err);
  }
  void io.close();
  httpServer.close(() => {
    closeContext(ctx);
    process.exit();
  });
  // Do not hang forever on lingering keep-alive connections.
  setTimeout(() => {
    closeContext(ctx);
    process.exit();
  }, 3000).unref();
}
// A forgotten promise rejection is logged; it leaves no half-done state behind.
process.on('unhandledRejection', (reason) => {
  console.error('[brindiwanko] unhandled promise rejection', reason);
});
// Any other unexpected exception leaves the process in an unknown state: save and stop
// cleanly (closing the database) so that a process manager restarts a sound server.
process.on('uncaughtException', (err) => {
  console.error('[brindiwanko] uncaught exception', err);
  process.exitCode = 1;
  shutdown('uncaughtException');
});
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

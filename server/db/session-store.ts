/**
 * @file express-session store backed by the game's SQLite database.
 *
 * Sessions are kept in the `sessions` table so that logins survive server
 * restarts without adding another storage system. Expired rows are ignored on
 * read and purged periodically.
 */
import type { Statement } from 'better-sqlite3';
import session from 'express-session';
import type { Db } from './database.js';

/** Default lifetime applied when a session cookie has no `maxAge` (1 day). */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** SQLite implementation of the express-session `Store` interface. */
export class SqliteSessionStore extends session.Store {
  private readonly getStmt: Statement<[string, number], string>;
  private readonly setStmt: Statement<[string, string, number]>;
  private readonly destroyStmt: Statement<[string]>;
  private readonly touchStmt: Statement<[number, string]>;
  private readonly purgeStmt: Statement<[number]>;
  private readonly destroyByAccountStmt: Statement<[number, string]>;
  private readonly timer: NodeJS.Timeout;
  /** Last time each session's expiry was written (sid → ms), see {@link touch}. */
  private readonly lastTouch = new Map<string, number>();
  private static readonly TOUCH_THROTTLE_MS = 5 * 60 * 1000;
  /**
   * @param db - Migrated connection.
   * @param purgeIntervalMs - How often expired sessions are deleted.
   */
  constructor(db: Db, purgeIntervalMs = 15 * 60 * 1000) {
    super();
    this.getStmt = db.prepare<[string, number], string>('SELECT sess FROM sessions WHERE sid = ? AND expires > ?').pluck();
    this.setStmt = db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`);
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.purgeStmt = db.prepare('DELETE FROM sessions WHERE expires <= ?');
    this.destroyByAccountStmt = db.prepare(
      "DELETE FROM sessions WHERE json_extract(sess, '$.accountId') = ? AND sid <> ?",
    );
    this.timer = setInterval(() => this.purge(), purgeIntervalMs);
    this.timer.unref();
  }

  private static expiry(sess: session.SessionData): number {
    const expires = sess.cookie?.expires;
    if (expires) return new Date(expires).getTime();
    return Date.now() + (sess.cookie?.maxAge ?? DEFAULT_TTL_MS);
  }

  override get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      const raw = this.getStmt.get(sid, Date.now());
      callback(null, raw ? (JSON.parse(raw) as session.SessionData) : null);
    } catch (err) {
      callback(err);
    }
  }

  override set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), SqliteSessionStore.expiry(sess));
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      this.lastTouch.delete(sid);
      this.destroyStmt.run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  override touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    // `rolling` sessions are touched on every request: extend the expiry in the database at most
    // once per throttle period (the lifetime is far longer) to avoid a disk write per request.
    const now = Date.now();
    if (now - (this.lastTouch.get(sid) ?? 0) >= SqliteSessionStore.TOUCH_THROTTLE_MS) {
      this.lastTouch.set(sid, now);
      // Like the other methods, a database error must not escape from the session middleware.
      try {
        this.touchStmt.run(SqliteSessionStore.expiry(sess), sid);
      } catch (err) {
        console.error('[brindiwanko] session touch failed', err);
      }
    }
    callback?.();
  }

  /**
   * Logs an account out everywhere except the given session (password change, ban).
   * @param accountId - Account whose sessions are removed.
   * @param keepSid - Session id to preserve (empty string to remove all).
   */
  destroyAccountSessions(accountId: number, keepSid = ''): void {
    this.destroyByAccountStmt.run(accountId, keepSid);
  }

  /** Deletes expired sessions. */
  purge(): void {
    this.purgeStmt.run(Date.now());
    const limit = Date.now() - SqliteSessionStore.TOUCH_THROTTLE_MS;
    for (const [sid, at] of this.lastTouch) if (at < limit) this.lastTouch.delete(sid);
  }

  /** Stops the purge timer (tests, shutdown). */
  close(): void {
    clearInterval(this.timer);
  }
}

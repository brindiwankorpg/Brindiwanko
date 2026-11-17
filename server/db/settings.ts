/**
 * @file Repository for engine-wide settings (`system_settings`) and server secrets.
 *
 * Settings are stored as JSON values under string keys. The set of known keys and
 * their default values is defined in `shared/settings.ts`; unknown keys are allowed
 * so that later features can add settings without a migration.
 */
import { randomBytes } from 'node:crypto';
import type { Statement } from 'better-sqlite3';
import { safeJsonParse, type Db } from './database.js';

const CACHE_MISS = Symbol('missing');
const settingsCaches = new WeakMap<Db, Map<string, unknown>>();

/** Typed access to `system_settings` and `server_secrets`. */
export class SettingsRepository {
  private readonly getStmt: Statement<[string], string>;
  private readonly setStmt: Statement<[string, string]>;
  private readonly allStmt: Statement<[], { key: string; value: string }>;
  private readonly getSecretStmt: Statement<[string], string>;
  private readonly insertSecretStmt: Statement<[string, string]>;
  private readonly cache: Map<string, unknown>;

  constructor(private readonly db: Db) {
    let cache = settingsCaches.get(db);
    if (!cache) {
      cache = new Map();
      settingsCaches.set(db, cache);
    }
    this.cache = cache;
    this.getStmt = db.prepare<[string], string>('SELECT value FROM system_settings WHERE key = ?').pluck();
    this.setStmt = db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
    this.allStmt = db.prepare('SELECT key, value FROM system_settings');
    this.getSecretStmt = db.prepare<[string], string>('SELECT value FROM server_secrets WHERE name = ?').pluck();
    this.insertSecretStmt = db.prepare('INSERT OR IGNORE INTO server_secrets (name, value) VALUES (?, ?)');
  }

  /**
   * Reads a setting.
   * @param key - Setting key.
   * @param fallback - Value returned when the key is absent.
   */
  get<T>(key: string, fallback: T): T {
    if (!this.db.inTransaction && this.cache.has(key)) {
      const hit = this.cache.get(key);
      return hit === CACHE_MISS ? fallback : (hit as T);
    }
    const raw = this.getStmt.get(key);
    if (raw === undefined) {
      if (!this.db.inTransaction) this.cache.set(key, CACHE_MISS);
      return fallback;
    }
    const parsed = safeJsonParse<T | typeof CACHE_MISS>(raw, CACHE_MISS);
    if (parsed === CACHE_MISS) return fallback;
    if (!this.db.inTransaction) this.cache.set(key, parsed);
    return parsed;
  }

  /**
   * Writes (inserts or replaces) a setting.
   * @param key - Setting key.
   * @param value - Any JSON-serializable value.
   */
  set(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.setStmt.run(key, json);
    if (this.db.inTransaction) this.cache.delete(key);
    else this.cache.set(key, JSON.parse(json));
  }

  /** Tells whether a setting exists. */
  has(key: string): boolean {
    if (!this.db.inTransaction && this.cache.has(key)) return this.cache.get(key) !== CACHE_MISS;
    return this.getStmt.get(key) !== undefined;
  }

  /** Returns every setting as a plain object. */
  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.allStmt.all()) {
      const parsed = safeJsonParse<unknown>(row.value, CACHE_MISS);
      if (parsed !== CACHE_MISS) out[row.key] = parsed;
    }
    return out;
  }

  /**
   * Returns a persisted secret, generating a random one on first use.
   * `INSERT OR IGNORE` followed by a read makes this safe even if two
   * processes race on first boot: both end up with the same stored value.
   * @param name - Secret name.
   */
  secret(name: string): string {
    this.insertSecretStmt.run(name, randomBytes(48).toString('base64url'));
    return this.getSecretStmt.get(name)!;
  }
}

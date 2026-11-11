/**
 * @file Repository for the `accounts` table.
 *
 * Only prepared statements are used. The "first account becomes admin" rule is
 * enforced here, inside an IMMEDIATE transaction, so that the count and the
 * insert cannot interleave with another registration. A new account never
 * gets the number of a deleted one (see `ids.ts`).
 */
import type { Statement } from 'better-sqlite3';
import type { AccountRole } from '../../shared/protocol.js';
import { isRole } from '../../shared/roles.js';
import type { Db } from './database.js';
import { takeId } from './ids.js';

/** An account row as used by the server (the password hash included). */
export interface Account {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  role: AccountRole;
  locale: string;
  createdAt: string;
  lastLogin: string | null;
  bannedUntil: string | null;
  banReason: string | null;
}

interface AccountRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  locale: string;
  created_at: string;
  last_login: string | null;
  banned_until: string | null;
  ban_reason: string | null;
}

function toAccount(row: AccountRow): Account {
  // The CHECK constraint guarantees this; the guard protects against a hand-edited database.
  if (!isRole(row.role)) throw new Error(`Account ${row.id} has invalid role "${row.role}"`);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    locale: row.locale,
    createdAt: row.created_at,
    lastLogin: row.last_login,
    bannedUntil: row.banned_until,
    banReason: row.ban_reason,
  };
}

/** Fields required to create an account. */
export interface NewAccount {
  username: string;
  email: string;
  passwordHash: string;
  locale: string;
}

/** Thrown when the first account is created without the server's setup code. */
export class SetupCodeError extends Error {
  constructor() {
    super('The first account needs the setup code');
  }
}

/** Thrown when a unique column (username or email) is already taken. */
export class DuplicateAccountError extends Error {
  constructor(public readonly field: 'username' | 'email') {
    super(`Account ${field} already exists`);
  }
}

/** Data access for accounts. */
export class AccountRepository {
  private readonly byId: Statement<[number], AccountRow>;
  private readonly byUsername: Statement<[string], AccountRow>;
  private readonly byEmail: Statement<[string], AccountRow>;
  private readonly countStmt: Statement<[], number>;
  private readonly ownerStmt: Statement<[], number | null>;
  private readonly insertStmt: Statement<[number, string, string, string, string, string]>;
  private readonly touchLoginStmt: Statement<[number]>;
  private readonly setLocaleStmt: Statement<[string, number]>;
  private readonly setRoleStmt: Statement<[string, number]>;

  constructor(private readonly db: Db) {
    this.byId = db.prepare('SELECT * FROM accounts WHERE id = ?');
    this.byUsername = db.prepare('SELECT * FROM accounts WHERE username = ?');
    this.byEmail = db.prepare('SELECT * FROM accounts WHERE email = ?');
    this.countStmt = db.prepare<[], number>('SELECT COUNT(*) FROM accounts').pluck();
    this.ownerStmt = db.prepare<[], number | null>('SELECT MIN(id) FROM accounts').pluck();
    this.insertStmt = db.prepare(
      'INSERT INTO accounts (id, username, email, password_hash, role, locale) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.touchLoginStmt = db.prepare("UPDATE accounts SET last_login = datetime('now') WHERE id = ?");
    this.setLocaleStmt = db.prepare('UPDATE accounts SET locale = ? WHERE id = ?');
    this.setRoleStmt = db.prepare('UPDATE accounts SET role = ? WHERE id = ?');
  }

  /** Finds an account by id. */
  findById(id: number): Account | undefined {
    const row = this.byId.get(id);
    return row && toAccount(row);
  }

  /** Finds an account by username (case-insensitive). */
  findByUsername(username: string): Account | undefined {
    const row = this.byUsername.get(username);
    return row && toAccount(row);
  }

  /** Finds an account by e-mail address (case-insensitive). */
  findByEmail(email: string): Account | undefined {
    const row = this.byEmail.get(email);
    return row && toAccount(row);
  }

  /** Id of the server owner: the very first account (the administrator who installed the server). */
  ownerId(): number {
    return this.ownerStmt.get() ?? 0;
  }

  /** Number of accounts. */
  count(): number {
    return this.countStmt.get()!;
  }

  /**
   * Creates an account. The very first account of the server receives the
   * `admin` role, every later one `player`.
   *
   * The transaction is IMMEDIATE: it takes the database write lock before
   * counting, so two simultaneous registrations (even from two processes)
   * cannot both observe an empty table and both become admin.
   *
   * @param data - Validated account fields with an already-computed hash.
   * @param mayBeFirst - `false` when the caller did not give the setup code: the
   *   account is then refused if it would be the first one (the administrator).
   * @returns The created account.
   * @throws {DuplicateAccountError} If the username or email is taken.
   * @throws {SetupCodeError} If the account would be the first one and `mayBeFirst` is `false`.
   */
  create(data: NewAccount, mayBeFirst = true): Account {
    const insert = this.db.transaction((): number => {
      if (this.byUsername.get(data.username)) throw new DuplicateAccountError('username');
      if (this.byEmail.get(data.email)) throw new DuplicateAccountError('email');
      const first = this.countStmt.get() === 0;
      if (first && !mayBeFirst) throw new SetupCodeError();
      const role: AccountRole = first ? 'admin' : 'player';
      // A number no account ever had: the logs that still name a deleted account by its number must not
      // point to this one.
      const id = takeId(this.db, 'accounts');
      this.insertStmt.run(id, data.username, data.email, data.passwordHash, role, data.locale);
      return id;
    });
    return this.findById(insert.immediate())!;
  }

  /** Records a successful login time. */
  touchLogin(id: number): void {
    this.touchLoginStmt.run(id);
  }

  /** Saves the interface language chosen by the account. */
  setLocale(id: number, locale: string): void {
    this.setLocaleStmt.run(locale, id);
  }

  /** Changes the role of an account (admin panel). */
  setRole(id: number, role: AccountRole): void {
    this.setRoleStmt.run(role, id);
  }

  /**
   * Replaces the password hash of an account; the "forgotten password" links
   * still pending stop working.
   */
  setPasswordHash(id: number, hash: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, id);
      this.db.prepare('DELETE FROM password_resets WHERE account_id = ?').run(id);
    })();
  }

  /**
   * Changes the e-mail address of an account.
   * @throws {DuplicateAccountError} If another account uses it.
   */
  setEmail(id: number, email: string): void {
    this.db.transaction(() => {
      const other = this.byEmail.get(email);
      if (other && other.id !== id) throw new DuplicateAccountError('email');
      this.db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(email, id);
    }).immediate();
  }

  /**
   * Deletes an account for good. Its characters go with it (and their bags,
   * progress, friends...); the logs keep the account number only.
   */
  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
  }

  /**
   * Stores a "forgotten password" link (its hash only). Older links of the
   * account are dropped: only the last e-mail works.
   * @param tokenHash - SHA-256 of the token sent by e-mail (hex).
   * @param expiresAt - Expiry, in milliseconds.
   */
  addPasswordReset(accountId: number, tokenHash: string, expiresAt: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM password_resets WHERE account_id = ? OR expires_at < ?').run(accountId, Date.now());
      this.db.prepare('INSERT INTO password_resets (token_hash, account_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, accountId, expiresAt);
    })();
  }

  /** Account of a "forgotten password" link still valid, or `undefined`. */
  passwordResetAccount(tokenHash: string, now = Date.now()): Account | undefined {
    const id = this.db.prepare<[string, number], number>('SELECT account_id FROM password_resets WHERE token_hash = ? AND expires_at >= ?').pluck().get(tokenHash, now);
    return id === undefined ? undefined : this.findById(id);
  }

  /**
   * Uses a "forgotten password" link: in one transaction, the link is consumed (if it is still valid) and
   * the password replaced. Two requests sent with the same link never both succeed.
   * @returns The account, or `undefined` when the link was already used, replaced or expired meanwhile.
   */
  resetPasswordWithLink(tokenHash: string, passwordHash: string, now = Date.now()): Account | undefined {
    const id = this.db.transaction(() => {
      const used = this.db.prepare<[string, number], number>('DELETE FROM password_resets WHERE token_hash = ? AND expires_at >= ? RETURNING account_id').pluck().get(tokenHash, now);
      if (used !== undefined) this.setPasswordHash(used, passwordHash);
      return used;
    })();
    return id === undefined ? undefined : this.findById(id);
  }
}

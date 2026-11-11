/**
 * @file Authentication use-cases (register, log in, change the password or the
 * e-mail address, delete an account, forgotten password), independent of Express so
 * they can be unit-tested. Results carry translation keys for the client.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import { isValidEmail, validatePassword, validateRegistration, type RegistrationInput } from '../../shared/accounts.js';
import type { Locale } from '../../shared/i18n.js';
import { PERMANENT } from '../db/admin.js';
import { DuplicateAccountError, SetupCodeError, type Account, type AccountRepository } from '../db/accounts.js';
import { addressKey } from '../http/address.js';
import { createDeviceToken, verifyDeviceToken } from './device.js';
import { LoginThrottle } from './throttle.js';

/**
 * Outcome of a use-case: the account (and the device token to give the
 * browser), or a translation key describing the error.
 */
export type AuthResult =
  | { ok: true; account: Account; deviceToken: string }
  | { ok: false; errorKey: string; params?: Record<string, string | number> };

/**
 * Tells whether an account is currently banned.
 * @param account - Account to check.
 * @param now - Current time (injectable for tests).
 */
export function isBanned(account: Account, now = new Date()): boolean {
  // SQLite datetime('now') values are UTC without a zone suffix.
  return account.bannedUntil !== null && new Date(`${account.bannedUntil.replace(' ', 'T')}Z`) > now;
}

/**
 * What a banned account is told: a translation key and its parameters (end of
 * the ban, in UTC, and the reason when a moderator gave one).
 * @param account - A banned account.
 */
export function banNotice(account: Pick<Account, 'bannedUntil' | 'banReason'>): { key: string; params: Record<string, string> } {
  const until = account.bannedUntil ?? '';
  const reason = account.banReason ?? '';
  const forever = until >= PERMANENT;
  const key = `error.auth.${forever ? 'banned_forever' : 'banned'}${reason ? '_reason' : ''}`;
  return { key, params: { until, reason } };
}

/** Registration and login logic. */
export class AuthService {
  /** Hash compared against when the username does not exist, so timing does not reveal it. */
  private readonly dummyHash: Promise<string>;

  /**
   * @param accounts - Account repository.
   * @param bcryptRounds - Hashing cost (lower it only in tests).
   * @param throttle - Brute-force limiter.
   * @param setupCode - Code required to register the first (administrator) account; `null` = not required.
   * @param deviceSecret - Secret signing the device cookies (see `device.ts`).
   */
  constructor(
    private readonly accounts: AccountRepository,
    private readonly bcryptRounds = 11,
    readonly throttle = new LoginThrottle(),
    private readonly setupCode: string | null = null,
    private readonly deviceSecret = randomBytes(32).toString('base64url'),
  ) {
    // Computed asynchronously (off the event loop) with the same cost as real hashes, so timing stays equal.
    this.dummyHash = bcrypt.hash('brindiwanko-dummy-password', bcryptRounds);
  }

  /** Tells whether the next registration needs the setup code (no account yet, code configured). */
  needsSetupCode(): boolean {
    return this.setupCode !== null && this.accounts.count() === 0;
  }

  private setupCodeMatches(code: string): boolean {
    if (this.setupCode === null) return true;
    const sent = Buffer.from(code.trim());
    const expected = Buffer.from(this.setupCode);
    return sent.length === expected.length && timingSafeEqual(sent, expected);
  }

  /**
   * Creates an account after validation.
   * @param input - Raw form values.
   * @param locale - Interface language to store in the account.
   * @param setupCode - Code typed in the form, checked only for the first account.
   */
  async register(input: RegistrationInput, locale: Locale, setupCode = ''): Promise<AuthResult> {
    const clean = { ...input, username: input.username.trim(), email: input.email.trim() };
    const invalid = validateRegistration(clean);
    if (invalid) return { ok: false, errorKey: invalid };
    const mayBeFirst = this.setupCodeMatches(setupCode);
    if (!mayBeFirst && this.accounts.count() === 0) return { ok: false, errorKey: 'error.auth.setup_code' };
    // Cheap pre-checks so a taken name or address does not cost a hash; `create` re-checks atomically.
    if (this.accounts.findByUsername(clean.username)) return { ok: false, errorKey: 'error.auth.username_taken' };
    if (this.accounts.findByEmail(clean.email)) return { ok: false, errorKey: 'error.auth.email_taken' };
    const passwordHash = await bcrypt.hash(clean.password, this.bcryptRounds);
    try {
      const account = this.accounts.create({ username: clean.username, email: clean.email, passwordHash, locale }, mayBeFirst);
      // Registering opens a session: it counts as the first login.
      this.accounts.touchLogin(account.id);
      return { ok: true, account, deviceToken: createDeviceToken(this.deviceSecret, account.username, account.passwordHash) };
    } catch (err) {
      if (err instanceof SetupCodeError) return { ok: false, errorKey: 'error.auth.setup_code' };
      if (err instanceof DuplicateAccountError) {
        return { ok: false, errorKey: err.field === 'username' ? 'error.auth.username_taken' : 'error.auth.email_taken' };
      }
      throw err;
    }
  }

  /**
   * Checks credentials.
   *
   * Failures are counted per client address (one client sweeping many
   * accounts) and per account. For the account, a browser presenting a valid
   * device token (it logged in successfully before) has a counter of its own;
   * every other client shares one. So guesses from strangers lock the
   * strangers, never the owner's usual browser.
   * @param username - Submitted username.
   * @param password - Submitted password.
   * @param ip - Client address, used for throttling.
   * @param deviceToken - Device cookie sent by the browser, if any.
   */
  async login(username: string, password: string, ip: string, deviceToken?: string): Promise<AuthResult> {
    const name = username.trim().toLowerCase();
    const account = name ? this.accounts.findByUsername(name) : undefined;
    const device = account ? verifyDeviceToken(this.deviceSecret, deviceToken, name, account.passwordHash) : null;
    // The key is capped: a name longer than any real one must not cost kilobytes of memory per attempt.
    const accountKey = device ? `device:${device}` : `user:${name.slice(0, 40)}`;
    // An IPv6 client is counted by its /64 block: it may use any of the billions of addresses inside.
    const keys = device ? [accountKey] : [`ip:${addressKey(ip)}`, accountKey];
    const attempt = this.throttle.begin(...keys);
    if (attempt.locked > 0) {
      return { ok: false, errorKey: 'error.auth.too_many_attempts', params: { seconds: Math.ceil(attempt.locked / 1000) } };
    }
    // Always run one hash comparison so response time is the same whether the account exists or not.
    let valid: boolean;
    try {
      valid = await bcrypt.compare(password.slice(0, 256), account?.passwordHash ?? (await this.dummyHash));
    } finally {
      attempt.end();
    }
    if (!account || !valid) {
      this.throttle.fail(...keys);
      return { ok: false, errorKey: 'error.auth.invalid_credentials' };
    }
    // Only the account's counter is cleared: logging into one's own account between
    // guesses must not reset the counter of the address.
    this.throttle.succeed(accountKey);
    if (isBanned(account)) {
      const { key, params } = banNotice(account);
      return { ok: false, errorKey: key, params };
    }
    this.accounts.touchLogin(account.id);
    return { ok: true, account, deviceToken: createDeviceToken(this.deviceSecret, account.username, account.passwordHash) };
  }

  // --- "My account" -------------------------------------------------------------

  /**
   * Checks the password of a logged-in account before a sensitive change
   * (new password or e-mail, deletion). Wrong answers are counted like
   * login failures, on a counter of their own.
   * @returns `null` when the password is right, else an error result.
   */
  private async confirmPassword(account: Account, password: string): Promise<AuthResult | null> {
    const key = `confirm:${account.id}`;
    const attempt = this.throttle.begin(key);
    if (attempt.locked > 0) return { ok: false, errorKey: 'error.auth.too_many_attempts', params: { seconds: Math.ceil(attempt.locked / 1000) } };
    let valid: boolean;
    try {
      valid = await bcrypt.compare(password.slice(0, 256), account.passwordHash);
    } finally {
      attempt.end();
    }
    if (!valid) {
      this.throttle.fail(key);
      return { ok: false, errorKey: 'error.account.wrong_password' };
    }
    this.throttle.succeed(key);
    return null;
  }

  /**
   * Checks the password of a logged-in account before a dangerous action of the administration panel
   * (restoring a backup). Wrong answers are limited like the other confirmations.
   * @returns `null` when the password is right, else an error result.
   */
  async verifyPassword(accountId: number, password: string): Promise<Extract<AuthResult, { ok: false }> | null> {
    const account = this.accounts.findById(accountId);
    if (!account) return { ok: false, errorKey: 'error.auth.not_authenticated' };
    const refused = await this.confirmPassword(account, password);
    return refused && !refused.ok ? refused : null;
  }

  /**
   * Changes the password of an account (the current one is asked).
   * @returns The account with its new hash and a new device token (the old ones stop working).
   */
  async changePassword(accountId: number, current: string, password: string, confirm: string): Promise<AuthResult> {
    const account = this.accounts.findById(accountId);
    if (!account) return { ok: false, errorKey: 'error.auth.not_authenticated' };
    const refused = await this.confirmPassword(account, current);
    if (refused) return refused;
    const invalid = validatePassword(password, confirm);
    if (invalid) return { ok: false, errorKey: invalid };
    return this.setPassword(account, password);
  }

  private async setPassword(account: Account, password: string): Promise<AuthResult> {
    this.accounts.setPasswordHash(account.id, await bcrypt.hash(password, this.bcryptRounds));
    const updated = this.accounts.findById(account.id)!;
    return { ok: true, account: updated, deviceToken: createDeviceToken(this.deviceSecret, updated.username, updated.passwordHash) };
  }

  /** Changes the e-mail address of an account (the password is asked). */
  async changeEmail(accountId: number, password: string, email: string): Promise<AuthResult> {
    const account = this.accounts.findById(accountId);
    if (!account) return { ok: false, errorKey: 'error.auth.not_authenticated' };
    const clean = email.trim();
    if (!isValidEmail(clean)) return { ok: false, errorKey: 'error.auth.email_invalid' };
    const refused = await this.confirmPassword(account, password);
    if (refused) return refused;
    try {
      this.accounts.setEmail(account.id, clean);
    } catch (err) {
      if (err instanceof DuplicateAccountError) return { ok: false, errorKey: 'error.auth.email_taken' };
      throw err;
    }
    const updated = this.accounts.findById(account.id)!;
    return { ok: true, account: updated, deviceToken: createDeviceToken(this.deviceSecret, updated.username, updated.passwordHash) };
  }

  /**
   * Checks that an account may be deleted: its password, its name typed again,
   * and it is not the server owner (the first account keeps the server).
   * The caller deletes it (characters, guilds, sessions...).
   */
  async checkDeletion(accountId: number, password: string, confirmName: string): Promise<AuthResult> {
    const account = this.accounts.findById(accountId);
    if (!account) return { ok: false, errorKey: 'error.auth.not_authenticated' };
    if (account.id === this.accounts.ownerId()) return { ok: false, errorKey: 'error.account.owner_delete' };
    if (confirmName.trim().toLowerCase() !== account.username.toLowerCase()) return { ok: false, errorKey: 'error.account.delete_confirm' };
    const refused = await this.confirmPassword(account, password);
    if (refused) return refused;
    return { ok: true, account, deviceToken: '' };
  }

  // --- Forgotten password -----------------------------------------------------------

  /** When the last link was sent to each account (one e-mail every few minutes at most). */
  private readonly resetSentAt = new Map<number, number>();

  /**
   * Prepares a "forgotten password" link for the account named by a user name
   * or an e-mail address.
   * @returns The account and the secret token to put in the link, or `null`
   *   when no account matches or a link was sent a short while ago (the caller
   *   answers the same way in every case, so nobody learns whether an account exists).
   */
  createPasswordReset(identifier: string, now = Date.now()): { account: Account; token: string } | null {
    const name = identifier.trim();
    if (!name || name.length > 254) return null;
    const account = name.includes('@') ? this.accounts.findByEmail(name) : this.accounts.findByUsername(name);
    if (!account) return null;
    if (now - (this.resetSentAt.get(account.id) ?? 0) < RESET_RESEND_MS) return null;
    this.resetSentAt.set(account.id, now);
    for (const [id, at] of this.resetSentAt) if (now - at >= RESET_RESEND_MS) this.resetSentAt.delete(id);
    const token = randomBytes(32).toString('base64url');
    this.accounts.addPasswordReset(account.id, hashResetToken(token), now + RESET_TOKEN_MS);
    return { account, token };
  }

  /** Account of a "forgotten password" link still valid, or `undefined`. */
  passwordResetAccount(token: string): Account | undefined {
    return RESET_TOKEN_PATTERN.test(token) ? this.accounts.passwordResetAccount(hashResetToken(token)) : undefined;
  }

  /** Sets a new password from a "forgotten password" link (the link then stops working). */
  async resetPassword(token: string, password: string, confirm: string): Promise<AuthResult> {
    if (!this.passwordResetAccount(token)) return { ok: false, errorKey: 'error.account.reset_invalid' };
    const invalid = validatePassword(password, confirm);
    if (invalid) return { ok: false, errorKey: invalid };
    // The link is checked again, and used, only once the (slow) hash is ready: another request with the same
    // link may have used it meanwhile.
    const hash = await bcrypt.hash(password, this.bcryptRounds);
    const account = this.accounts.resetPasswordWithLink(hashResetToken(token), hash);
    if (!account) return { ok: false, errorKey: 'error.account.reset_invalid' };
    return { ok: true, account, deviceToken: createDeviceToken(this.deviceSecret, account.username, account.passwordHash) };
  }
}

/** How long a "forgotten password" link works. */
export const RESET_TOKEN_MS = 60 * 60 * 1000;
/** Shortest delay between two "forgotten password" e-mails to one account. */
export const RESET_RESEND_MS = 2 * 60 * 1000;
/** Shape of a link token (32 random bytes in base64url). */
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Hash under which a link token is stored. */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

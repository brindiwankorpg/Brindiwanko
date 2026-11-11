/**
 * @file Basic brute-force protection for the login form.
 *
 * Failed attempts are counted per key (the client IP and, separately, the
 * targeted username) inside a sliding window. Once a key reaches the limit, it
 * is locked for a period that doubles with each further lock, up to a cap.
 * Counting per username stops distributed guessing on one account; counting
 * per IP stops one client from sweeping many accounts. State is in memory: it
 * resets on restart, which is acceptable for this level of protection.
 */

interface Entry {
  failures: number[];
  lockedUntil: number;
  locks: number;
}

/** Tunables of the throttle. */
export interface ThrottleOptions {
  /** Failures allowed inside the window before locking. */
  maxFailures: number;
  /** Sliding window length, in ms. */
  windowMs: number;
  /** First lock duration, in ms (doubled on each subsequent lock). */
  lockMs: number;
  /** Maximum lock duration, in ms. */
  maxLockMs: number;
}

const DEFAULTS: ThrottleOptions = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
};

/** Wait asked from a client whose earlier attempts are still being checked. */
const IN_FLIGHT_WAIT_MS = 1000;

/** In-memory failed-attempt counter with escalating lockouts. */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  /** Attempts started and not finished yet, per key. */
  private readonly inFlight = new Map<string, number>();
  private readonly options: ThrottleOptions;

  /**
   * @param options - Overrides of the default limits.
   * @param now - Clock, injectable for tests.
   */
  constructor(options: Partial<ThrottleOptions> = {}, private readonly now: () => number = Date.now) {
    this.options = { ...DEFAULTS, ...options };
  }

  /**
   * Returns how many milliseconds the keys remain locked (0 when free).
   * @param keys - Keys to check (e.g. `ip:1.2.3.4`, `user:alice`).
   */
  lockedFor(...keys: string[]): number {
    const t = this.now();
    let remaining = 0;
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry && entry.lockedUntil > t) remaining = Math.max(remaining, entry.lockedUntil - t);
    }
    return remaining;
  }

  /**
   * Starts an attempt whose outcome is known later (a password hash being compared): attempts in flight
   * count against the limit, so a burst of parallel requests cannot all pass the check before the first
   * failure is recorded.
   * @returns How many milliseconds the keys remain locked (0 when the attempt may go on), and the
   *   function to call once the attempt is over (whatever its outcome).
   */
  begin(...keys: string[]): { locked: number; end: () => void } {
    const locked = this.lockedFor(...keys);
    if (locked > 0) return { locked, end: () => undefined };
    const t = this.now();
    for (const key of keys) {
      const recent = this.entries.get(key)?.failures.filter((at) => t - at < this.options.windowMs).length ?? 0;
      if (recent + (this.inFlight.get(key) ?? 0) >= this.options.maxFailures) return { locked: IN_FLIGHT_WAIT_MS, end: () => undefined };
    }
    for (const key of keys) this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
    let ended = false;
    return {
      locked: 0,
      end: () => {
        if (ended) return;
        ended = true;
        for (const key of keys) {
          const n = (this.inFlight.get(key) ?? 1) - 1;
          if (n > 0) this.inFlight.set(key, n);
          else this.inFlight.delete(key);
        }
      },
    };
  }

  /** Records a failed attempt for every key, locking those over the limit. */
  fail(...keys: string[]): void {
    const t = this.now();
    for (const key of keys) {
      const entry = this.entries.get(key) ?? { failures: [], lockedUntil: 0, locks: 0 };
      // A key already locked is not locked further: failures of attempts started before the lock must not
      // escalate it at once to the longest duration.
      if (entry.lockedUntil > t) continue;
      entry.failures = entry.failures.filter((at) => t - at < this.options.windowMs);
      entry.failures.push(t);
      if (entry.failures.length >= this.options.maxFailures) {
        const duration = Math.min(this.options.lockMs * 2 ** entry.locks, this.options.maxLockMs);
        entry.lockedUntil = t + duration;
        entry.locks++;
        entry.failures = [];
      }
      this.entries.set(key, entry);
    }
    this.prune(t);
  }

  /** Clears the counters of the keys after a successful login. */
  succeed(...keys: string[]): void {
    for (const key of keys) this.entries.delete(key);
  }

  /** Drops stale entries so the map cannot grow without bound. */
  private prune(t: number): void {
    if (this.entries.size < 10_000) return;
    for (const [key, entry] of this.entries) {
      // A lock expiry counts as activity: otherwise an emptied failure list would look "infinitely old"
      // and the escalating lock duration would be forgotten as soon as the first lock ends.
      const lastActivity = Math.max(entry.failures.at(-1) ?? 0, entry.lockedUntil);
      if (entry.lockedUntil <= t && t - lastActivity > this.options.windowMs) this.entries.delete(key);
    }
    // Still full of live keys: the table must not grow without bound, but a lock in force is never the
    // first to go (otherwise flooding the table with new names would lift the lock of an account under
    // attack). Counters that are not locked go first, oldest first (Map keeps insertion order)...
    for (const [key, entry] of this.entries) {
      if (this.entries.size < 10_000) return;
      if (entry.lockedUntil <= t) this.entries.delete(key);
    }
    // ...and only a table full of locks drops the ones ending first.
    const locks = [...this.entries].sort((a, b) => a[1].lockedUntil - b[1].lockedUntil);
    for (const [key] of locks) {
      if (this.entries.size < 10_000) return;
      this.entries.delete(key);
    }
  }
}

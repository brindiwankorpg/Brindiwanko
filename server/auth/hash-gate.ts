/**
 * @file Gate in front of the password hashes (bcrypt).
 *
 * bcrypt runs on the libuv thread pool (4 threads unless `UV_THREADPOOL_SIZE`
 * says otherwise), which the server shares with compression and file access.
 * Login floods from many addresses each pass the per-address limits, but
 * together they would keep every thread hashing. The gate lets only some of
 * the threads hash at once; the other requests wait their turn in a bounded
 * queue, and beyond it they are turned away at once (the visitor is asked to
 * try again in a moment) instead of piling up.
 */

/** A slot could not be had: too many hashes are already waiting. */
export const HASH_BUSY = Symbol('hash-busy');

/** Concurrency limit with a bounded waiting line. */
export class HashGate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  /**
   * @param concurrency - Hashes allowed to run at once.
   * @param maxWaiting - Hashes allowed to wait for a slot; more are refused.
   */
  constructor(
    readonly concurrency: number,
    readonly maxWaiting: number,
  ) {}

  /** Hashes running now. */
  get active(): number {
    return this.running;
  }

  /** Hashes waiting for a slot. */
  get queued(): number {
    return this.waiting.length;
  }

  /**
   * Runs a hashing job once a slot is free.
   * @returns What the job gives, or {@link HASH_BUSY} when the waiting line is full (the job is not run).
   */
  async run<T>(job: () => Promise<T>): Promise<T | typeof HASH_BUSY> {
    if (this.running >= this.concurrency) {
      if (this.waiting.length >= this.maxWaiting) return HASH_BUSY;
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.running++;
    try {
      return await job();
    } finally {
      // The slot goes straight to the next one waiting (the count does not change), or is freed.
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

/**
 * Gate sized for the thread pool of this process: half of its threads may hash at once (at least one), the
 * other half stays free for compression and files.
 * @param env - Environment (`UV_THREADPOOL_SIZE`).
 */
export function defaultHashGate(env: NodeJS.ProcessEnv = process.env): HashGate {
  const pool = Number.parseInt(env.UV_THREADPOOL_SIZE ?? '', 10);
  const threads = Number.isInteger(pool) && pool > 0 ? pool : 4;
  return new HashGate(Math.max(1, Math.floor(threads / 2)), 100);
}

/**
 * @file Sliding-window counter of events per key (a client address...), kept
 * in memory, for limits such as "accounts created per hour by one address".
 * State resets on restart, which is acceptable for this kind of limit.
 */

/** Counts events per key within a sliding window. */
export class SlidingWindowLimiter {
  private readonly events = new Map<string, number[]>();

  /**
   * @param limit - Events allowed per key within the window (0 = no limit).
   * @param windowMs - Window length.
   * @param now - Clock (injectable for tests).
   */
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Times of the events of a key still inside the window. */
  private recent(key: string, t: number): number[] {
    return (this.events.get(key) ?? []).filter((at) => t - at < this.windowMs);
  }

  /**
   * Milliseconds before a key may have another event (0 when it may now).
   * @param key - Client key.
   */
  retryAfter(key: string): number {
    if (this.limit <= 0) return 0;
    const t = this.now();
    const list = this.recent(key, t);
    return list.length < this.limit ? 0 : list[list.length - this.limit]! + this.windowMs - t;
  }

  /** Records an event of a key. */
  record(key: string): void {
    if (this.limit <= 0) return;
    const t = this.now();
    const list = [...this.recent(key, t), t];
    // Deleted first so the key moves to the end of the table (Map keeps insertion order): the table is
    // then ordered by last activity.
    this.events.delete(key);
    this.events.set(key, list);
    // Keys without recent events are dropped so the table cannot grow without bound.
    if (this.events.size > 10_000) {
      for (const [k, events] of this.events) if (!events.some((at) => t - at < this.windowMs)) this.events.delete(k);
      // Still full of live keys: the least recently active go first, but a key at its limit is kept
      // (otherwise flooding the table with new addresses would lift the limit of the one being held back)...
      for (const [k, events] of this.events) {
        if (this.events.size <= 10_000) break;
        if (this.recent(k, t).length < this.limit) this.events.delete(k);
      }
      // ...and only a table full of limited keys drops the least recently active.
      for (const k of this.events.keys()) {
        if (this.events.size <= 10_000) break;
        this.events.delete(k);
      }
    }
  }
}

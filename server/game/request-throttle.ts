/**
 * @file Spacing of the requests one player sends to another (party and guild
 * invitations, trade requests): each one opens a window on the other player's
 * screen, so a script could otherwise bury someone under dozens of them a
 * second (the socket's own limit allows a few per second).
 */

/** Time before a player may send the same kind of request to the same player again. */
export const REQUEST_PAUSE_MS = 10_000;
/** Time after a declined request before the same player may ask again. */
export const DECLINED_PAUSE_MS = 60_000;

/** Requests of one kind between pairs of players. */
export class RequestThrottle {
  /** End of the pause of each pair (`from:to`). */
  private readonly until = new Map<string, number>();

  /**
   * Tells whether `from` may send a request to `to` now, and if so starts the pause before the next one.
   * @returns The milliseconds left to wait, or 0 when the request may be sent.
   */
  take(from: number, to: number, now = Date.now()): number {
    const key = `${from}:${to}`;
    const end = this.until.get(key) ?? 0;
    if (now < end) return end - now;
    this.prune(now);
    this.until.set(key, now + REQUEST_PAUSE_MS);
    return 0;
  }

  /** The request of `from` was declined by `to`: a longer pause before the next one. */
  declined(from: number, to: number, now = Date.now()): void {
    this.until.set(`${from}:${to}`, now + DECLINED_PAUSE_MS);
  }

  /** The request of `from` was accepted by `to`: welcome to ask again at once. */
  accepted(from: number, to: number): void {
    this.until.delete(`${from}:${to}`);
  }

  /** Forgets the pauses that are over (kept small without a timer). */
  private prune(now: number): void {
    if (this.until.size < 256) return;
    for (const [key, end] of this.until) if (end <= now) this.until.delete(key);
  }
}

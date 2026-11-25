/**
 * @file One heavy upload at a time per server.
 *
 * A restoration (a database of up to 500 MB) and a project import (an
 * archive of up to 200 MB, read in memory with up to 600 MB of files inside)
 * each take a lot of memory and disk: on a small server, two of them at once
 * could run it out of memory. They share one lock; the second asked is
 * refused (the administrator tries again once the first one ends).
 */

/** Heavy jobs sharing the lock. */
export type HeavyJob = 'restore' | 'import';

/** Job running on each server context. */
const running = new WeakMap<object, HeavyJob>();

/**
 * Takes the lock for a job.
 * @param owner - The server context (one lock per server).
 * @returns `null` when taken, else the job already running.
 */
export function startHeavyJob(owner: object, job: HeavyJob): HeavyJob | null {
  const current = running.get(owner);
  if (current) return current;
  running.set(owner, job);
  return null;
}

/** Releases the lock taken by {@link startHeavyJob}. */
export function endHeavyJob(owner: object): void {
  running.delete(owner);
}

/** Translation key telling which job is in the way. */
export function heavyJobBusyKey(job: HeavyJob): string {
  return job === 'import' ? 'error.import.busy' : 'error.admin.restore_busy';
}

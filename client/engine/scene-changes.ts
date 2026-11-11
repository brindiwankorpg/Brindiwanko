/**
 * @file Changes of a map's contents (monsters, other players, events) that
 * arrive while the scene meant to receive them is still loading.
 *
 * On a map change the server sends the new map's contents, then at once
 * everything that happens there (a monster coming back, a player walking in).
 * The client loads the new scene first (fade, images): applied meanwhile, those
 * changes would land on the scene being left and be lost, leaving monsters the
 * server knows invisible to the player. They are kept here and applied, in the
 * order they came, once the new scene is in place.
 */

/** Holds map changes during a scene load. */
export class SceneChanges {
  /** Changes waiting for the scene being loaded (`null`: no load in progress). */
  private held: (() => void)[] | null = null;
  /** Number of the latest load: a load overtaken by a newer one neither installs nor releases anything. */
  private latest = 0;

  /**
   * A new scene starts loading: changes are held from now on. Changes held for
   * an earlier load that is still running are dropped (they belong to a map the
   * player has left; the new map's contents come complete with it).
   * @returns Number of this load, to give back to `isLatest` and `release`.
   */
  begin(): number {
    this.held = [];
    return ++this.latest;
  }

  /** Applies a change now, or keeps it for the scene being loaded. */
  apply(change: () => void): void {
    if (this.held) this.held.push(change);
    else change();
  }

  /** Tells whether `load` is still the latest load (no newer map change started since). */
  isLatest(load: number): boolean {
    return load === this.latest;
  }

  /**
   * The scene of `load` is in place (or its loading failed): applies the held
   * changes in order and stops holding. Does nothing for an overtaken load, or
   * when already released.
   */
  release(load: number): void {
    if (!this.isLatest(load) || !this.held) return;
    const held = this.held;
    this.held = null;
    for (const change of held) change();
  }
}

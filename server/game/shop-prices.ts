/**
 * @file Lowest price at which each article is sold by the shops of the game.
 *
 * A shop may sell an article cheaper than its database price; every shop buys
 * it back on that lowest price, whatever shop the player sells it to (buying in
 * one shop and selling in another would otherwise make gold out of nothing).
 * The shops are the "Shop processing" commands of every map event and common
 * event: each map is read once, then again only when it is saved or deleted;
 * the common events are read again when they change.
 */
import { Cmd, type EventCommand } from '../../shared/events.js';
import type { MapData } from '../../shared/map.js';
import type { GameDataRepository } from '../db/game-data.js';
import type { MapRepository } from '../db/maps.js';

const KINDS = ['item', 'weapon', 'armor'] as const;

/** Key of an article (`item:3`). */
export const articleKey = (kind: string, id: number): string => `${kind}:${id}`;

/** Adds the custom prices of the shops of a command list to `out` (lowest one per article). */
function addShopPrices(list: readonly EventCommand[], out: Map<string, number>): void {
  for (const c of list) {
    if (c.code !== Cmd.ShopProcessing && c.code !== Cmd.ShopItem) continue;
    const q = c.parameters;
    // Price type 1: a price of the shop's own; 0: the database price (the cap already).
    if (Number(q[2]) !== 1) continue;
    const kind = KINDS[Math.trunc(Number(q[0]))] ?? 'item';
    const price = Math.max(0, Math.trunc(Number(q[3])) || 0);
    const key = articleKey(kind, Math.trunc(Number(q[1])) || 0);
    if (price < (out.get(key) ?? Number.POSITIVE_INFINITY)) out.set(key, price);
  }
}

/** Custom shop prices of a map's events. */
function mapPrices(map: MapData): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of map.events) for (const page of e?.pages ?? []) addShopPrices(page.list, out);
  return out;
}

/** Lowest shop prices of the whole game. */
export class ShopPrices {
  /** Prices of each map's shops (`null` until first needed). */
  private byMap: Map<number, Map<string, number>> | null = null;
  private common = new Map<string, number>();
  private commonGeneration = -1;
  /** Lowest price of every article, rebuilt after a change. */
  private merged: Map<string, number> | null = null;

  constructor(
    private readonly maps: MapRepository,
    private readonly gameData: GameDataRepository,
  ) {
    maps.onChange((id, map) => {
      if (!this.byMap) return;
      if (map) this.byMap.set(id, mapPrices(map));
      else this.byMap.delete(id);
      this.merged = null;
    });
  }

  /** Lowest custom price of each article sold by a shop of the game (articles only sold on their database price are absent). */
  all(): ReadonlyMap<string, number> {
    if (!this.byMap) {
      this.byMap = new Map();
      // Read without keeping every map in memory: only the maps in play are kept parsed.
      for (const { id } of this.maps.infos()) {
        const map = this.maps.peek(id);
        if (map) this.byMap.set(id, mapPrices(map));
      }
    }
    const generation = this.gameData.generation('commonEvent');
    if (generation !== this.commonGeneration) {
      this.common = new Map();
      for (const ce of this.gameData.list('commonEvent')) addShopPrices(ce.list, this.common);
      this.commonGeneration = generation;
      this.merged = null;
    }
    if (!this.merged) {
      this.merged = new Map(this.common);
      for (const prices of this.byMap.values()) {
        for (const [key, price] of prices) if (price < (this.merged.get(key) ?? Number.POSITIVE_INFINITY)) this.merged.set(key, price);
      }
    }
    return this.merged;
  }

  /** Lowest custom price of an article in the shops of the game, or `undefined`. */
  lowest(kind: string, id: number): number | undefined {
    return this.all().get(articleKey(kind, id));
  }
}

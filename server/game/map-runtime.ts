/**
 * @file Live state of one map on the server: its cells, the tileset flags,
 * and the per-player copies of its events.
 *
 * Events are seen through the progress of each player: a chest opened by one
 * character stays closed for the others, an NPC says something else once a
 * quest is done. So every player on a map has its own {@link EventInstance}
 * of each event, holding the page active for that player, the position and
 * the appearance changes made by move routes. The map runtime only holds the
 * shared definitions and the rules working on a set of instances.
 */
import type { EventConditions, EventPage, EventView, GameEvent } from '../../shared/events.js';
import { Priority } from '../../shared/events.js';
import { deltaX, deltaY, isValidPosition, stepCell, wrapCell, type MapData } from '../../shared/map.js';
import { canMove } from '../../shared/passability.js';
import type { Direction } from '../../shared/settings.js';

/** One event as seen by one player. */
export interface EventInstance {
  def: GameEvent;
  /** Index of the active page, or -1 when no page applies (event not shown). */
  pageIndex: number;
  /** Hidden by the "erase event" command until the map is entered again. */
  erased: boolean;
  x: number;
  y: number;
  direction: Direction;
  /** Appearance and movement settings (from the page, changed by move routes). */
  characterName: string;
  characterIndex: number;
  tileId: number;
  moveSpeed: number;
  walkAnime: boolean;
  stepAnime: boolean;
  directionFix: boolean;
  through: boolean;
  /** Running for its player (autonomous movement pauses). */
  locked: boolean;
  /** Time of the next autonomous movement. */
  nextMoveAt: number;
  /** Position in the page's custom move route. */
  routeIndex: number;
  /** Quest marker shown to the player (see quests.ts). */
  marker: number;
}

/** Events of one map as seen by one player, by event id. */
export type EventSet = Map<number, EventInstance>;

/** Offset of a direction. */
export function offset(d: Direction): { dx: number; dy: number } {
  return { dx: d === 4 ? -1 : d === 6 ? 1 : 0, dy: d === 8 ? -1 : d === 2 ? 1 : 0 };
}

/** One loaded map. */
export class MapRuntime {
  /**
   * @param id - Map id.
   * @param map - Map content.
   * @param flags - Tileset flags.
   */
  constructor(
    readonly id: number,
    readonly map: MapData,
    readonly flags: readonly number[],
  ) {}

  /** A cell brought back inside a looping map (unchanged on a map that does not loop). */
  wrap(x: number, y: number): { x: number; y: number } {
    return wrapCell(this.map, x, y);
  }

  /** Cell next to (x, y) towards a direction (across the edge of a looping map). */
  next(x: number, y: number, d: Direction): { x: number; y: number } {
    return stepCell(this.map, x, y, d);
  }

  /** Shortest offset from one cell to another (through the edges of a looping map). */
  delta(fromX: number, fromY: number, toX: number, toY: number): { dx: number; dy: number } {
    return { dx: deltaX(this.map, fromX, toX), dy: deltaY(this.map, fromY, toY) };
  }

  /** Event definitions of the map. */
  definitions(): GameEvent[] {
    return this.map.events.filter((e): e is GameEvent => e !== null);
  }

  /** Fresh copies of every event for a player entering the map (no page resolved yet). */
  instantiate(): EventSet {
    const set: EventSet = new Map();
    for (const def of this.definitions()) {
      set.set(def.id, {
        def, pageIndex: -1, erased: false, x: def.x, y: def.y, direction: 2,
        characterName: '', characterIndex: 0, tileId: 0, moveSpeed: 3, walkAnime: true, stepAnime: false, directionFix: false, through: false,
        locked: false, nextMoveAt: 0, routeIndex: 0, marker: 0,
      });
    }
    return set;
  }

  /**
   * Resolves the active page of an event: the last page whose conditions hold.
   * @param e - Event instance.
   * @param holds - Tells whether a page's conditions are met for the player.
   * @returns The page index, or -1.
   */
  static resolvePage(e: EventInstance, holds: (c: EventConditions) => boolean): number {
    if (e.erased) return -1;
    for (let i = e.def.pages.length - 1; i >= 0; i--) if (holds(e.def.pages[i]!.conditions)) return i;
    return -1;
  }

  /** Switches an instance to a page, taking its appearance and settings. */
  static applyPage(e: EventInstance, index: number): void {
    e.pageIndex = index;
    const page = e.def.pages[index];
    if (!page) return;
    e.direction = page.image.direction;
    e.characterName = page.image.characterName;
    e.characterIndex = page.image.characterIndex;
    e.tileId = page.image.tileId;
    e.moveSpeed = page.moveSpeed;
    e.walkAnime = page.walkAnime;
    e.stepAnime = page.stepAnime;
    e.directionFix = page.directionFix;
    e.through = page.through;
    e.routeIndex = 0;
  }

  /** Active page of an instance. */
  static page(e: EventInstance): EventPage | undefined {
    return e.pageIndex >= 0 ? e.def.pages[e.pageIndex] : undefined;
  }

  /** View of an instance as sent to its player (`null` when not shown). */
  static view(e: EventInstance): EventView | null {
    const page = MapRuntime.page(e);
    if (!page) return null;
    return {
      id: e.def.id,
      page: e.pageIndex,
      x: e.x,
      y: e.y,
      image: { tileId: e.tileId, characterName: e.characterName, characterIndex: e.characterIndex, direction: e.direction, pattern: page.image.pattern },
      priorityType: page.priorityType,
      through: e.through,
      walkAnime: e.walkAnime,
      stepAnime: e.stepAnime,
      directionFix: e.directionFix,
      moveSpeed: e.moveSpeed,
      trigger: page.trigger,
      marker: e.marker,
    };
  }

  /** Views of every shown event of a set. */
  static views(set: EventSet): EventView[] {
    return [...set.values()].map((e) => MapRuntime.view(e)).filter((v): v is EventView => v !== null);
  }

  /** Shown events at a cell. */
  static eventsAt(set: EventSet, x: number, y: number): EventInstance[] {
    const out: EventInstance[] = [];
    for (const e of set.values()) if (e.x === x && e.y === y && e.pageIndex >= 0) out.push(e);
    return out;
  }

  /**
   * First shown event at a cell that matches a test, without building a list (checked at every step).
   * @param match - Test of an event (any shown event when omitted).
   */
  static firstEventAt(set: EventSet, x: number, y: number, match?: (e: EventInstance) => boolean): EventInstance | undefined {
    for (const e of set.values()) if (e.x === x && e.y === y && e.pageIndex >= 0 && (!match || match(e))) return e;
    return undefined;
  }

  /** Tells whether a solid event (same priority as characters, not "through") occupies a cell. */
  static isBlockedByEvent(set: EventSet, x: number, y: number, except?: EventInstance): boolean {
    for (const e of set.values()) {
      if (e.x !== x || e.y !== y || e.pageIndex < 0 || e === except || e.through) continue;
      if (MapRuntime.page(e)?.priorityType === Priority.Same) return true;
    }
    return false;
  }

  /**
   * Tells whether a character can step from (x, y) towards `d`: tile rules plus solid events.
   * @param set - Events as seen by the moving player.
   */
  canStep(set: EventSet, x: number, y: number, d: Direction): boolean {
    if (!canMove(this.map, this.flags, x, y, d)) return false;
    const next = this.next(x, y, d);
    return !MapRuntime.isBlockedByEvent(set, next.x, next.y);
  }

  /** Tells whether a character can stand on a cell: inside the map and not walled in. */
  isStandable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
    return ([2, 4, 6, 8] as const).some((d) => canMove(this.map, this.flags, x, y, d));
  }

  /**
   * Finds the free cell closest to a position (the position itself when it is
   * fine), for players whose cell was changed under their feet by a map edit.
   * @param set - Events as seen by the player (solid events are avoided).
   */
  nearestStandable(x: number, y: number, set?: EventSet): { x: number; y: number } {
    const w = this.map.width;
    const h = this.map.height;
    const cx = Math.min(Math.max(x, 0), w - 1);
    const cy = Math.min(Math.max(y, 0), h - 1);
    const ok = (px: number, py: number): boolean => this.isStandable(px, py) && !(set && MapRuntime.isBlockedByEvent(set, px, py));
    for (let r = 0; r <= w + h; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const rest = r - Math.abs(dy);
        for (const dx of rest === 0 ? [0] : [-rest, rest]) {
          if (ok(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
        }
      }
    }
    return { x: cx, y: cy };
  }

  /**
   * Tells whether an event can step towards `d` (move routes): tile rules,
   * other solid events and the player, unless the event is "through".
   */
  canEventStep(set: EventSet, e: EventInstance, d: Direction, player: { x: number; y: number }): boolean {
    const { x: nx, y: ny } = this.next(e.x, e.y, d);
    if (!isValidPosition(this.map, nx, ny)) return false;
    if (e.through) return true;
    if (!canMove(this.map, this.flags, e.x, e.y, d)) return false;
    if (MapRuntime.page(e)?.priorityType !== Priority.Same) return true;
    if (player.x === nx && player.y === ny) return false;
    return !MapRuntime.isBlockedByEvent(set, nx, ny, e);
  }
}

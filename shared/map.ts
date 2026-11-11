/**
 * @file Map format.
 *
 * A map stores its cells in one flat array `data` indexed as
 * `(z * height + y) * width + x`, with six layers:
 *   z = 0..3  tile layers (0 = ground; A tiles usually sit on 0–1, B–E on 2–3),
 *   z = 4     shadow bits (one bit per tile quarter: 1 = top-left, 2 = top-right,
 *             4 = bottom-left, 8 = bottom-right),
 *   z = 5     region ids (0 = none, 1–255), used by spawns and scripts.
 * The engine-specific block `mmo` holds multiplayer properties (map type,
 * PvP, instancing...). Events follow the event format described in
 * `shared/events.ts`.
 */
import type { Spawn } from './combat.js';
import type { GameEvent } from './events.js';

/** Number of layers stored per cell. */
export const MAP_LAYERS = 6;
/** Layer of shadow bits. */
export const SHADOW_LAYER = 4;
/** Layer of region ids. */
export const REGION_LAYER = 5;

/** Kind of map, used for rules and the editor tree icons. */
export type MapType = 'town' | 'field' | 'dungeon' | 'instance';

/** Multiplayer properties of a map. */
export interface MapMmoProperties {
  type: MapType;
  /** Players may attack each other. */
  pvp: boolean;
  /** Each group gets its own copy of the map. */
  instance: boolean;
  /** Monsters appearing on the map (missing in maps saved before combat existed). */
  spawns?: Spawn[];
  /**
   * Cells made impassable by hand in the editor's passability mode, whatever
   * their tiles say (cell index = y * width + x).
   */
  blocked?: number[];
  /** Cells made passable by hand, whatever their tiles say. */
  opened?: number[];
}

/** Audio reference (name in `audio/<kind>/`, volume 0–100, pitch 50–150, pan -100–100). */
export interface AudioRef {
  name: string;
  volume: number;
  pitch: number;
  pan: number;
}

/** A map. */
export interface MapData {
  width: number;
  height: number;
  tilesetId: number;
  /** Name shown to players when entering (content, any language). */
  displayName: string;
  /**
   * Looping: 0 none, 1 vertically, 2 horizontally, 3 both. On a looping map,
   * walking past an edge comes back by the opposite edge (see {@link wrapCell}).
   */
  scrollType: number;
  autoplayBgm: boolean;
  bgm: AudioRef;
  autoplayBgs: boolean;
  bgs: AudioRef;
  parallaxName: string;
  parallaxLoopX: boolean;
  parallaxLoopY: boolean;
  parallaxSx: number;
  parallaxSy: number;
  parallaxShow: boolean;
  /** Characters cannot walk (used for maps shown as scenery). */
  disableDashing: boolean;
  note: string;
  data: number[];
  /** Index = event id; index 0 and deleted ids are `null`. */
  events: (GameEvent | null)[];
  mmo: MapMmoProperties;
}

/** Entry of the map tree (editor), without cell data. */
export interface MapInfo {
  id: number;
  name: string;
  parentId: number;
  order: number;
  expanded: boolean;
}

/** Empty audio reference. */
export const NO_AUDIO: AudioRef = { name: '', volume: 90, pitch: 100, pan: 0 };

/**
 * Creates an empty map.
 * @param width - Width in tiles.
 * @param height - Height in tiles.
 * @param tilesetId - Tileset id.
 */
export function createMap(width: number, height: number, tilesetId: number): MapData {
  return {
    width,
    height,
    tilesetId,
    displayName: '',
    scrollType: 0,
    autoplayBgm: false,
    bgm: { ...NO_AUDIO },
    autoplayBgs: false,
    bgs: { ...NO_AUDIO },
    parallaxName: '',
    parallaxLoopX: false,
    parallaxLoopY: false,
    parallaxSx: 0,
    parallaxSy: 0,
    parallaxShow: true,
    disableDashing: false,
    note: '',
    data: new Array<number>(width * height * MAP_LAYERS).fill(0),
    events: [null],
    mmo: { type: 'field', pvp: false, instance: false },
  };
}

/**
 * Index of a cell in `data`.
 * @param map - Map.
 * @param x - Column.
 * @param y - Row.
 * @param z - Layer (0–5).
 */
export function cellIndex(map: Pick<MapData, 'width' | 'height'>, x: number, y: number, z: number): number {
  return (z * map.height + y) * map.width + x;
}

/** Tells whether a position is inside the map. */
export function isValidPosition(map: Pick<MapData, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** Reads a cell (0 outside the map). */
export function tileAt(map: Pick<MapData, 'width' | 'height' | 'data'>, x: number, y: number, z: number): number {
  return isValidPosition(map, x, y) ? (map.data[cellIndex(map, x, y, z)] ?? 0) : 0;
}

/** Writes a cell (ignored outside the map). */
export function setTileAt(map: Pick<MapData, 'width' | 'height' | 'data'>, x: number, y: number, z: number, value: number): void {
  if (isValidPosition(map, x, y)) map.data[cellIndex(map, x, y, z)] = value;
}

/** What the looping rules need to know about a map. */
export type LoopMap = Pick<MapData, 'width' | 'height'> & { scrollType?: number };

/** The map loops horizontally: leaving by the right edge comes back by the left one. */
export function loopsHorizontally(map: LoopMap): boolean {
  return map.scrollType === 2 || map.scrollType === 3;
}

/** The map loops vertically: leaving by the bottom edge comes back by the top one. */
export function loopsVertically(map: LoopMap): boolean {
  return map.scrollType === 1 || map.scrollType === 3;
}

const modulo = (v: number, n: number) => ((v % n) + n) % n;

/**
 * Brings a cell of a looping map back inside it (a cell one step past the
 * right edge is the first column...). Unchanged on the axes that do not loop.
 */
export function wrapCell(map: LoopMap, x: number, y: number): { x: number; y: number } {
  return { x: loopsHorizontally(map) ? modulo(x, map.width) : x, y: loopsVertically(map) ? modulo(y, map.height) : y };
}

/**
 * Shortest signed distance from one column to another (through the edge on a
 * map looping horizontally), so that "towards" and "how far" work across it.
 */
export function deltaX(map: LoopMap, from: number, to: number): number {
  const d = to - from;
  if (!loopsHorizontally(map)) return d;
  const w = map.width;
  const m = modulo(d, w);
  return m > w / 2 ? m - w : m;
}

/** Same as {@link deltaX}, for rows. */
export function deltaY(map: LoopMap, from: number, to: number): number {
  const d = to - from;
  if (!loopsVertically(map)) return d;
  const h = map.height;
  const m = modulo(d, h);
  return m > h / 2 ? m - h : m;
}

/** Cell next to (x, y) towards a direction, brought back inside on a looping map. */
export function stepCell(map: LoopMap, x: number, y: number, d: number): { x: number; y: number } {
  const { dx, dy } = directionOffset(d);
  return wrapCell(map, x + dx, y + dy);
}

/** Offset of a direction: 2 down, 4 left, 6 right, 8 up. */
export function directionOffset(d: number): { dx: number; dy: number } {
  return { dx: d === 4 ? -1 : d === 6 ? 1 : 0, dy: d === 8 ? -1 : d === 2 ? 1 : 0 };
}

/** Opposite direction. */
export function reverseDirection(d: number): number {
  return 10 - d;
}

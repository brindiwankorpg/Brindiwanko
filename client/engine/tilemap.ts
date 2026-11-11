/**
 * @file Tile map renderer.
 *
 * Drawing order per cell (lower pass): layer 0, layer 1, shadows, layer 2,
 * layer 3, skipping star tiles; star tiles are drawn in the upper pass, after
 * characters. Autotiles are assembled from four quarters using the tables of
 * `shared/tiles.ts`; animated water (A1) cycles frames 0-1-2-1 and waterfalls
 * 0-1-2, advancing every 30 frames (half a second).
 *
 * Performance: the map is split into chunks of 16 × 16 cells rendered once
 * into offscreen canvases, built when they come near the view and released
 * when nobody looked at them for a few seconds (a chunk canvas weighs about
 * 2.4 MB: a large map kept whole would not fit in a phone's memory). Cells
 * containing an animated tile are left out of the chunk and drawn into a
 * small canvas per animation phase, built once (their whole lower stack, so
 * layers above the water stay in order). Sheets of any tile size are
 * accepted: the source tile size is derived from each sheet's width, and
 * scaled to the map tile size.
 */
import { SHADOW_LAYER, tileAt, type MapData } from '../../shared/map.js';
import {
  AUTOTILE_SHAPES,
  FLAG_STAR,
  SHEET_SIZE_IN_TILES,
  TILESET_SHEETS,
  TILE_ID_A1,
  autotileKind,
  autotileSource,
  isAutotile,
  isTileA1,
  plainTileSource,
  type TilesetSheet,
} from '../../shared/tiles.js';
import type { Bitmap } from './assets.js';

/** Cells per chunk side. */
const CHUNK = 16;
/** Frames between animation steps of water tiles. */
export const TILE_ANIMATION_FRAMES = 30;
/** A chunk not drawn for this long gives its canvases back. */
const RELEASE_MS = 5000;
/** How often the chunks are checked for release. */
const SWEEP_MS = 1000;
/** Radius (cells) around the player of the chunks built when a map is entered. */
const WARM_RADIUS = 20;
/** Water frame of each step of the 0-1-2-1 cycle (waterfalls cycle 0-1-2). */
const WATER_FRAMES = [0, 1, 2, 1] as const;

interface Chunk {
  lower: HTMLCanvasElement | null;
  upper: HTMLCanvasElement | null;
  /** Cells whose lower stack is animated. */
  animated: number[];
  /** Rectangle of the animated cells, in cells from the chunk's corner (null: none). */
  box: { x: number; y: number; w: number; h: number } | null;
  /** The animated cells hold water (0-1-2-1 cycle) / waterfalls (0-1-2 cycle). */
  water: boolean;
  falls: boolean;
  /** The animated cells drawn once per animation phase. */
  phases: Map<number, HTMLCanvasElement>;
  dirty: boolean;
  /** When the chunk was last drawn (`performance.now()`). */
  usedAt: number;
}

/** Gives the memory of a canvas back at once (some browsers keep it until the element is collected). */
function release(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Renders the tile layers of one map. */
export class TilemapRenderer {
  private chunks: Chunk[] = [];
  /** Chunks holding canvases. */
  private readonly built = new Set<number>();
  private lastSweep = 0;
  private cols = 0;
  private rows = 0;
  /** Global animation counter (frames at 60 fps). */
  animationCount = 0;
  /** Tile layers drawn (the editor can show a single layer). */
  private visible: readonly boolean[] = [true, true, true, true];

  /**
   * @param map - Map cells.
   * @param flags - Tileset flags.
   * @param sheets - Loaded sheets by slot.
   * @param tileSize - Destination tile size in pixels.
   */
  constructor(
    private map: Pick<MapData, 'width' | 'height' | 'data'>,
    private flags: readonly number[],
    private sheets: Partial<Record<TilesetSheet, Bitmap>>,
    readonly tileSize: number,
  ) {
    this.reset();
  }

  /** Current animation frame index (increments every 30 frames). */
  get animationFrame(): number {
    return Math.floor(this.animationCount / TILE_ANIMATION_FRAMES);
  }

  /** Replaces the map (after an edit) and invalidates every chunk. */
  setMap(map: Pick<MapData, 'width' | 'height' | 'data'>, flags: readonly number[], sheets: Partial<Record<TilesetSheet, Bitmap>>): void {
    this.map = map;
    this.flags = flags;
    this.sheets = sheets;
    this.reset();
  }

  /**
   * Chooses which tile layers are drawn (all by default).
   * @param layer - Only layer shown (0–3), or `null` for every layer.
   */
  showOnlyLayer(layer: number | null): void {
    this.visible = [0, 1, 2, 3].map((z) => layer === null || z === layer);
    this.reset();
  }

  /** Marks the chunks covering a rectangle for redraw. */
  invalidate(x0: number, y0: number, x1: number, y1: number): void {
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        const chunk = this.chunks[cy * this.cols + cx];
        if (chunk) chunk.dirty = true;
      }
    }
  }

  /**
   * Pre-builds the chunks around a cell (called when a map is entered in the
   * game, around the player, so that the first steps never stutter). The rest
   * of the map is built when it comes into view.
   * @param x - Cell x.
   * @param y - Cell y.
   * @param radius - Cells around it.
   */
  warmUp(x: number, y: number, radius = WARM_RADIUS): void {
    const now = performance.now();
    const x0 = Math.max(0, Math.floor((x - radius) / CHUNK));
    const y0 = Math.max(0, Math.floor((y - radius) / CHUNK));
    const x1 = Math.min(this.cols - 1, Math.floor((x + radius) / CHUNK));
    const y1 = Math.min(this.rows - 1, Math.floor((y + radius) / CHUNK));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * this.cols + cx;
        const chunk = this.chunks[i]!;
        if (chunk.dirty) this.buildChunk(i);
        chunk.usedAt = now;
      }
    }
  }

  /** Number of chunks holding canvases (memory checks). */
  get builtChunks(): number {
    return this.built.size;
  }

  private reset(): void {
    for (const i of this.built) this.releaseChunk(this.chunks[i]!);
    this.built.clear();
    this.cols = Math.ceil(this.map.width / CHUNK);
    this.rows = Math.ceil(this.map.height / CHUNK);
    this.chunks = Array.from({ length: this.cols * this.rows }, () => ({ lower: null, upper: null, animated: [], box: null, water: false, falls: false, phases: new Map(), dirty: true, usedAt: 0 }));
  }

  /** Gives the canvases of a chunk back; it is built again when it comes into view. */
  private releaseChunk(chunk: Chunk): void {
    release(chunk.lower);
    release(chunk.upper);
    for (const canvas of chunk.phases.values()) release(canvas);
    chunk.lower = null;
    chunk.upper = null;
    chunk.phases.clear();
    chunk.dirty = true;
  }

  /** Releases the chunks nobody looked at for a while (the player walked away from them). */
  private sweep(now: number): void {
    this.lastSweep = now;
    for (const i of this.built) {
      const chunk = this.chunks[i]!;
      if (now - chunk.usedAt < RELEASE_MS) continue;
      this.releaseChunk(chunk);
      this.built.delete(i);
    }
  }

  private isStar(id: number): boolean {
    return id !== 0 && ((this.flags[id] ?? 0) & FLAG_STAR) !== 0;
  }

  /**
   * Draws one tile.
   * @param ctx - Destination.
   * @param id - Tile id.
   * @param dx - Destination x in pixels.
   * @param dy - Destination y in pixels.
   * @param frame - Animation frame index.
   */
  drawTile(ctx: CanvasRenderingContext2D, id: number, dx: number, dy: number, frame: number): void {
    if (id <= 0) return;
    const T = this.tileSize;
    if (isAutotile(id)) {
      const src = autotileSource(id, frame);
      const sheet = this.sheets[src.sheet];
      if (!sheet) return;
      const st = sheet.width / SHEET_SIZE_IN_TILES[src.sheet].cols;
      const half = st / 2;
      const quarters = src.table[(id - TILE_ID_A1) % AUTOTILE_SHAPES];
      if (!quarters) return;
      for (let i = 0; i < 4; i++) {
        const [qx, qy] = quarters[i]!;
        ctx.drawImage(sheet, src.bx * st + qx * half, src.by * st + qy * half, half, half, dx + (i % 2) * (T / 2), dy + (i >> 1) * (T / 2), T / 2, T / 2);
      }
      return;
    }
    const src = plainTileSource(id);
    const sheet = this.sheets[src.sheet];
    if (!sheet) return;
    const st = sheet.width / SHEET_SIZE_IN_TILES[src.sheet].cols;
    ctx.drawImage(sheet, src.col * st, src.row * st, st, st, dx, dy, T, T);
  }

  /** Draws the shadow bits of a cell (one dark quarter per set bit). */
  private drawShadow(ctx: CanvasRenderingContext2D, bits: number, dx: number, dy: number): void {
    if (!bits) return;
    const h = this.tileSize / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    for (let q = 0; q < 4; q++) if (bits & (1 << q)) ctx.fillRect(dx + (q % 2) * h, dy + (q >> 1) * h, h, h);
  }

  /** Draws the lower (non-star) stack of a cell. */
  private drawLowerCell(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, frame: number): void {
    for (let z = 0; z < 4; z++) {
      const id = tileAt(this.map, x, y, z);
      if (this.visible[z] && !this.isStar(id)) this.drawTile(ctx, id, dx, dy, frame);
      if (z === 1) this.drawShadow(ctx, tileAt(this.map, x, y, SHADOW_LAYER), dx, dy);
    }
  }

  private cellIsAnimated(x: number, y: number): boolean {
    for (let z = 0; z < 4; z++) {
      const id = tileAt(this.map, x, y, z);
      if (isTileA1(id) && !this.isStar(id)) return true;
    }
    return false;
  }

  /** A blank canvas of a size in cells. */
  private makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w * this.tileSize;
    c.height = h * this.tileSize;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    return c;
  }

  private buildChunk(index: number): void {
    const chunk = this.chunks[index]!;
    const T = this.tileSize;
    const cx = (index % this.cols) * CHUNK;
    const cy = Math.floor(index / this.cols) * CHUNK;
    const w = Math.min(CHUNK, this.map.width - cx);
    const h = Math.min(CHUNK, this.map.height - cy);
    const lower = chunk.lower ?? this.makeCanvas(w, h);
    const lctx = lower.getContext('2d')!;
    lctx.clearRect(0, 0, lower.width, lower.height);
    let upper = chunk.upper;
    upper?.getContext('2d')!.clearRect(0, 0, upper.width, upper.height);
    let upperUsed = false;
    chunk.animated = [];
    chunk.water = false;
    chunk.falls = false;
    for (const canvas of chunk.phases.values()) release(canvas);
    chunk.phases.clear();
    let [bx0, by0, bx1, by1] = [CHUNK, CHUNK, -1, -1];
    for (let y = cy; y < cy + h; y++) {
      for (let x = cx; x < cx + w; x++) {
        const dx = (x - cx) * T;
        const dy = (y - cy) * T;
        if (this.cellIsAnimated(x, y)) {
          chunk.animated.push(y * this.map.width + x);
          this.noteAnimation(chunk, x, y);
          [bx0, by0, bx1, by1] = [Math.min(bx0, x - cx), Math.min(by0, y - cy), Math.max(bx1, x - cx), Math.max(by1, y - cy)];
        } else this.drawLowerCell(lctx, x, y, dx, dy, 0);
        for (let z = 0; z < 4; z++) {
          const id = tileAt(this.map, x, y, z);
          if (!this.visible[z] || !this.isStar(id)) continue;
          upper ??= this.makeCanvas(w, h);
          this.drawTile(upper.getContext('2d')!, id, dx, dy, 0);
          upperUsed = true;
        }
      }
    }
    chunk.box = bx1 >= 0 ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } : null;
    chunk.lower = lower;
    // Most chunks have no star tile: drop their upper canvas to save memory.
    if (!upperUsed) release(upper);
    chunk.upper = upperUsed ? upper : null;
    chunk.dirty = false;
    this.built.add(index);
  }

  /** Records which animation cycles the animated tiles of a cell follow. */
  private noteAnimation(chunk: Chunk, x: number, y: number): void {
    for (let z = 0; z < 4; z++) {
      const id = tileAt(this.map, x, y, z);
      if (!isTileA1(id) || this.isStar(id)) continue;
      const kind = autotileKind(id);
      // Kinds 0 and 1 (sea), then even kinds from 4 are water; odd kinds from 5 are waterfalls; 2 and 3 do not move.
      if (kind < 2 || (kind >= 4 && kind % 2 === 0)) chunk.water = true;
      else if (kind >= 4) chunk.falls = true;
    }
  }

  /** The animated cells of a chunk at an animation frame, drawn once per phase of their cycles. */
  private phaseCanvas(index: number, frame: number): HTMLCanvasElement {
    const chunk = this.chunks[index]!;
    const box = chunk.box!;
    const key = (chunk.water ? WATER_FRAMES[frame % 4]! : 0) * 3 + (chunk.falls ? frame % 3 : 0);
    let canvas = chunk.phases.get(key);
    if (!canvas) {
      canvas = this.makeCanvas(box.w, box.h);
      const ctx = canvas.getContext('2d')!;
      const T = this.tileSize;
      const left = (index % this.cols) * CHUNK + box.x;
      const top = Math.floor(index / this.cols) * CHUNK + box.y;
      for (const cell of chunk.animated) {
        const x = cell % this.map.width;
        const y = Math.floor(cell / this.map.width);
        this.drawLowerCell(ctx, x, y, (x - left) * T, (y - top) * T, frame);
      }
      chunk.phases.set(key, canvas);
    }
    return canvas;
  }

  /**
   * Draws a cached chunk canvas with its edges on whole device pixels: at a
   * screen scale such as 110 %, a chunk would otherwise end between two device
   * pixels and leave a thin dark seam with its neighbour. Both neighbours round
   * their shared edge the same way, so they meet exactly.
   */
  private drawChunk(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, px: number, py: number): void {
    const t = ctx.getTransform();
    const sx = t.a || 1;
    const sy = t.d || 1;
    const x0 = Math.round(px * sx + t.e) - t.e;
    const y0 = Math.round(py * sy + t.f) - t.f;
    const x1 = Math.round((px + canvas.width) * sx + t.e) - t.e;
    const y1 = Math.round((py + canvas.height) * sy + t.f) - t.f;
    ctx.drawImage(canvas, x0 / sx, y0 / sy, (x1 - x0) / sx, (y1 - y0) / sy);
  }

  /** Iterates over chunks intersecting a view rectangle (pixels). */
  private visibleChunks(ox: number, oy: number, vw: number, vh: number, fn: (index: number, px: number, py: number) => void): void {
    const span = CHUNK * this.tileSize;
    const x0 = Math.max(0, Math.floor(ox / span));
    const y0 = Math.max(0, Math.floor(oy / span));
    const x1 = Math.min(this.cols - 1, Math.floor((ox + vw) / span));
    const y1 = Math.min(this.rows - 1, Math.floor((oy + vh) / span));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) fn(cy * this.cols + cx, cx * span, cy * span);
  }

  /**
   * Draws the lower pass (under characters).
   * @param ctx - Screen context, already translated so that map pixel (ox, oy) is at the top-left.
   * @param ox - View left in map pixels.
   * @param oy - View top in map pixels.
   * @param vw - View width in pixels.
   * @param vh - View height in pixels.
   */
  drawLower(ctx: CanvasRenderingContext2D, ox: number, oy: number, vw: number, vh: number): void {
    const now = performance.now();
    if (now - this.lastSweep >= SWEEP_MS) this.sweep(now);
    const frame = this.animationFrame;
    const T = this.tileSize;
    this.visibleChunks(ox, oy, vw, vh, (i, px, py) => {
      const chunk = this.chunks[i]!;
      if (chunk.dirty) this.buildChunk(i);
      chunk.usedAt = now;
      if (chunk.lower) this.drawChunk(ctx, chunk.lower, px, py);
      if (chunk.box) this.drawChunk(ctx, this.phaseCanvas(i, frame), px + chunk.box.x * T, py + chunk.box.y * T);
    });
  }

  /** Draws the upper pass (star tiles, above characters). */
  drawUpper(ctx: CanvasRenderingContext2D, ox: number, oy: number, vw: number, vh: number): void {
    const now = performance.now();
    this.visibleChunks(ox, oy, vw, vh, (i, px, py) => {
      const chunk = this.chunks[i]!;
      if (chunk.dirty) this.buildChunk(i);
      chunk.usedAt = now;
      if (chunk.upper) this.drawChunk(ctx, chunk.upper, px, py);
    });
  }
}

/** Sheet slots in `tilesetNames` order. */
export const SHEET_SLOTS: readonly TilesetSheet[] = TILESET_SHEETS;

/**
 * @file Helper to assemble a tileset: the nine sheet canvases (A1–E) in the
 * standard layout, and the 8192-entry flags table (passability, star, bush,
 * counter...). Tileset generators call its methods with tile coordinates; the
 * builder takes care of sheet geometry and of giving every shape of an
 * autotile kind the same flags.
 */
import {
  AUTOTILE_SHAPES,
  FLAG_STAR,
  SHEET_SIZE_IN_TILES,
  TILE_ID_A1,
  TILE_ID_A2,
  TILE_ID_A3,
  TILE_ID_A4,
  TILE_ID_MAX,
  TILESET_SHEETS,
  a5TileId,
  plainTileId,
  type TilesetSheet,
} from '../../shared/tiles.js';
import { drawFloorBlock, drawWallBlock, drawWaterfallFrame, type FloorStyle, type WallStyle } from './autotile.js';
import { PixelCanvas } from '../../shared/art/pixel.js';

/** Logical pixels per tile side. */
export const T = 16;

/** Tileset display modes. */
export const TilesetMode = { World: 0, Area: 1, Legacy32: 2 } as const;

/** Result of a tileset generator. */
export interface GeneratedTileset {
  /** Base name; sheets are saved as `<name>_<sheet>.svg` (e.g. `Outside_A2`). */
  name: string;
  mode: number;
  /** Canvases of the sheets that contain something. */
  sheets: Partial<Record<TilesetSheet, PixelCanvas>>;
  flags: number[];
  /** Tiles moved by this version (see `TilesetBuilder.moved`). */
  moved: { from: number; to: number }[];
  /** Tiles first drawn by this version (see `TilesetBuilder.added`). */
  added: number[];
}

/** Mutable tileset under construction. */
export class TilesetBuilder {
  readonly flags: number[] = new Array<number>(TILE_ID_MAX).fill(0);
  private readonly sheets = new Map<TilesetSheet, PixelCanvas>();
  /** A5 cells (row * 8 + col) already drawn. */
  private readonly usedA5 = new Set<number>();
  /** Tiles moved by this version of the engine (old id → new id), so existing maps can follow them. */
  readonly moved: { from: number; to: number }[] = [];
  /** Tiles drawn for the first time by this version of the engine: existing databases get their flags once. */
  readonly added = new Set<number>();
  /** Plain tiles (B–E) already holding an object, as `sheet:col:row`: two objects may never share a tile. */
  private readonly used = new Set<string>();

  /**
   * @param name - Tileset base name.
   * @param mode - Tileset mode.
   */
  constructor(
    readonly name: string,
    readonly mode: number = TilesetMode.Area,
  ) {
    // Tile id 0 is the "empty" tile of upper layers: it must never block anything.
    this.flags[0] = FLAG_STAR;
  }

  /** Returns (creating if needed) the canvas of a sheet. */
  sheet(name: TilesetSheet): PixelCanvas {
    let canvas = this.sheets.get(name);
    if (!canvas) {
      const size = SHEET_SIZE_IN_TILES[name];
      canvas = new PixelCanvas(size.cols * T, size.rows * T);
      this.sheets.set(name, canvas);
    }
    return canvas;
  }

  /** Sets the flags of every shape of an autotile kind. */
  kindFlags(kind: number, flag: number): void {
    const first = TILE_ID_A1 + kind * AUTOTILE_SHAPES;
    for (let s = 0; s < AUTOTILE_SHAPES; s++) this.flags[first + s] = flag;
  }

  /**
   * Draws an A1 animated water kind (0, 1, or an even kind ≥ 4): three frames side by side.
   * @param kind - A1 kind.
   * @param styleForFrame - Style of each frame (0–2).
   * @param flag - Tile flags.
   */
  a1Water(kind: number, styleForFrame: (frame: number) => FloorStyle, flag: number): void {
    const canvas = this.sheet('A1');
    const { bx, by } = a1Block(kind);
    for (let f = 0; f < 3; f++) drawFloorBlock(canvas, bx + f * 2, by, styleForFrame(f));
    this.kindFlags(kind, flag);
  }

  /** Draws an A1 static decoration kind (2 or 3). */
  a1Decoration(kind: 2 | 3, style: FloorStyle, flag: number): void {
    drawFloorBlock(this.sheet('A1'), 6, kind === 2 ? 0 : 3, style);
    this.kindFlags(kind, flag);
  }

  /** Draws an A1 waterfall kind (odd kind ≥ 5): three frames stacked vertically. */
  a1Waterfall(kind: number, styleForFrame: (frame: number) => WallStyle, flag: number): void {
    const canvas = this.sheet('A1');
    const { bx, by } = a1Block(kind);
    for (let f = 0; f < 3; f++) drawWaterfallFrame(canvas, bx, by + f, styleForFrame(f));
    this.kindFlags(kind, flag);
  }

  /**
   * Draws an A2 ground kind.
   * @param col - Block column (0–7).
   * @param row - Block row (0–3).
   */
  a2(col: number, row: number, style: FloorStyle, flag: number): void {
    drawFloorBlock(this.sheet('A2'), col * 2, row * 3, style);
    this.kindFlags((TILE_ID_A2 - TILE_ID_A1) / AUTOTILE_SHAPES + row * 8 + col, flag);
  }

  /**
   * Draws an A3 building kind (rows 0 and 2 are roofs, 1 and 3 walls).
   * @param col - Block column (0–7).
   * @param row - Block row (0–3).
   */
  a3(col: number, row: number, style: WallStyle, flag: number): void {
    drawWallBlock(this.sheet('A3'), col * 2, row * 2, style);
    this.kindFlags((TILE_ID_A3 - TILE_ID_A1) / AUTOTILE_SHAPES + row * 8 + col, flag);
  }

  /**
   * Draws an A4 wall top (floor-type block).
   * @param col - Block column (0–7).
   * @param pair - Top/side pair (0–2).
   */
  a4Top(col: number, pair: number, style: FloorStyle, flag: number): void {
    drawFloorBlock(this.sheet('A4'), col * 2, pair * 5, style);
    this.kindFlags((TILE_ID_A4 - TILE_ID_A1) / AUTOTILE_SHAPES + pair * 16 + col, flag);
  }

  /** Draws an A4 wall side (wall-type block) under the top of the same pair. */
  a4Side(col: number, pair: number, style: WallStyle, flag: number): void {
    drawWallBlock(this.sheet('A4'), col * 2, pair * 5 + 3, style);
    this.kindFlags((TILE_ID_A4 - TILE_ID_A1) / AUTOTILE_SHAPES + pair * 16 + 8 + col, flag);
  }

  /**
   * Draws a plain A5 tile.
   * @param col - Column (0–7).
   * @param row - Row (0–15).
   * @param draw - Receives the sheet and the tile's pixel origin.
   */
  a5(col: number, row: number, draw: (c: PixelCanvas, x: number, y: number) => void, flag: number): void {
    if (col === 0 && row === 0) throw new Error(`${this.name}_A5: the first tile (0, 0) must stay blank`);
    if (this.usedA5.has(row * 8 + col)) throw new Error(`${this.name}_A5: tile ${col},${row} is already used`);
    this.usedA5.add(row * 8 + col);
    this.sheet('A5').blit(clipped(draw, 1, 1), col * T, row * T);
    this.flags[a5TileId(col, row)] = flag;
  }

  /**
   * Draws an object spanning one or more plain tiles of a B–E sheet.
   * @param sheet - 'B', 'C', 'D' or 'E'.
   * @param col - Left column (0–15).
   * @param row - Top row (0–15).
   * @param draw - Receives the sheet and the pixel origin of the top-left tile.
   * @param flags - Flags per covered tile, row by row (`flags[row][col]`); a single number applies to all.
   * @param size - Size in tiles.
   */
  object(
    sheet: 'B' | 'C' | 'D' | 'E',
    col: number,
    row: number,
    draw: (c: PixelCanvas, x: number, y: number) => void,
    flags: number | number[][],
    size: { w: number; h: number } = { w: 1, h: 1 },
  ): void {
    const canvas = this.sheet(sheet);
    const sheetIndex = TILESET_SHEETS.indexOf(sheet) - 5;
    for (let j = 0; j < size.h; j++) {
      for (let i = 0; i < size.w; i++) {
        const key = `${sheet}:${col + i}:${row + j}`;
        if (col + i === 0 && row + j === 0) throw new Error(`${this.name}_${sheet}: the first tile (0, 0) must stay blank`);
        if (col + i > 15 || row + j > 15) throw new Error(`${this.name}_${sheet}: object at ${col},${row} leaves the sheet`);
        if (this.used.has(key)) throw new Error(`${this.name}_${sheet}: tile ${col + i},${row + j} is already used`);
        this.used.add(key);
      }
    }
    canvas.blit(clipped(draw, size.w, size.h), col * T, row * T);
    for (let j = 0; j < size.h; j++) {
      for (let i = 0; i < size.w; i++) {
        const f = typeof flags === 'number' ? flags : (flags[j]?.[i] ?? 0);
        this.flags[plainTileId(sheetIndex, col + i, row + j)] = f;
      }
    }
  }

  /** True when the plain tile (B–E) at this position holds no object yet. */
  isFree(sheet: 'B' | 'C' | 'D' | 'E', col: number, row: number): boolean {
    return col <= 15 && row <= 15 && !this.used.has(`${sheet}:${col}:${row}`);
  }

  /**
   * Places an object in the first free spot of a sheet, in palette order (columns 0–7 top
   * to bottom, then columns 8–15), so extra objects fill the holes left between existing
   * ones before going further: the palette shows no gap.
   * @returns The chosen top-left tile.
   */
  append(
    sheet: 'B' | 'C' | 'D' | 'E',
    draw: (c: PixelCanvas, x: number, y: number) => void,
    flags: number | number[][],
    size: { w: number; h: number } = { w: 1, h: 1 },
  ): { col: number; row: number } {
    for (const first of [0, 8]) {
      for (let row = 0; row + size.h <= 16; row++) {
        for (let col = first; col + size.w <= first + 8; col++) {
          if (col === 0 && row === 0) continue; // the blank tile
          let free = true;
          for (let j = 0; j < size.h && free; j++) for (let i = 0; i < size.w && free; i++) free = this.isFree(sheet, col + i, row + j);
          if (!free) continue;
          this.object(sheet, col, row, draw, flags, size);
          return { col, row };
        }
      }
    }
    throw new Error(`${this.name}_${sheet}: no room left for a ${size.w}x${size.h} object`);
  }

  /**
   * Empty tiles lying before the last object of a sheet, in palette order: holes in the
   * palette. The first tile (0, 0) is the blank tile and does not count.
   */
  holes(sheet: 'B' | 'C' | 'D' | 'E'): { col: number; row: number }[] {
    const order: { col: number; row: number }[] = [];
    for (const first of [0, 8]) for (let row = 0; row < 16; row++) for (let col = first; col < first + 8; col++) order.push({ col, row });
    let last = -1;
    order.forEach((p, i) => {
      if (!this.isFree(sheet, p.col, p.row)) last = i;
    });
    return order.slice(1, last + 1).filter((p) => this.isFree(sheet, p.col, p.row));
  }

  /** Sheets B–E that hold at least one object. */
  plainSheets(): ('B' | 'C' | 'D' | 'E')[] {
    return (['B', 'C', 'D', 'E'] as const).filter((sheet) => this.sheets.has(sheet));
  }

  /**
   * Places an object that used to sit on an old tile (in palette order, like `append`) and
   * records the move.
   */
  relocate(sheet: 'B' | 'C' | 'D' | 'E', oldCol: number, oldRow: number, draw: (c: PixelCanvas, x: number, y: number) => void, flags: number): void {
    const sheetIndex = TILESET_SHEETS.indexOf(sheet) - 5;
    const at = this.append(sheet, draw, flags);
    this.moved.push({ from: plainTileId(sheetIndex, oldCol, oldRow), to: plainTileId(sheetIndex, at.col, at.row) });
  }

  /**
   * Draws an A5 tile that used to sit on an old cell in the first free cell (reading order)
   * and records the move.
   */
  relocateA5(oldCol: number, oldRow: number, draw: (c: PixelCanvas, x: number, y: number) => void, flag: number): void {
    for (let i = 1; i < 128; i++) {
      if (this.usedA5.has(i)) continue;
      this.a5(i % 8, Math.floor(i / 8), draw, flag);
      this.moved.push({ from: a5TileId(oldCol, oldRow), to: a5TileId(i % 8, Math.floor(i / 8)) });
      return;
    }
    throw new Error(`${this.name}_A5: no room left`);
  }

  /** Like `append`, and marks the covered tiles as new in this version. */
  appendNew(
    sheet: 'B' | 'C' | 'D' | 'E',
    draw: (c: PixelCanvas, x: number, y: number) => void,
    flags: number | number[][],
    size: { w: number; h: number } = { w: 1, h: 1 },
  ): void {
    const sheetIndex = TILESET_SHEETS.indexOf(sheet) - 5;
    const at = this.append(sheet, draw, flags, size);
    for (let j = 0; j < size.h; j++) for (let i = 0; i < size.w; i++) this.added.add(plainTileId(sheetIndex, at.col + i, at.row + j));
  }

  /** Finalises the tileset. */
  build(): GeneratedTileset {
    // The blank first tile of every plain sheet never blocks (as the empty tile 0 of sheet B).
    for (const sheet of this.plainSheets()) this.flags[plainTileId(TILESET_SHEETS.indexOf(sheet) - 5, 0, 0)] = FLAG_STAR;
    if (this.usedA5.size > 0) {
      const last = Math.max(...this.usedA5);
      for (let i = 1; i < last; i++) if (!this.usedA5.has(i)) throw new Error(`${this.name}_A5: hole at ${i % 8},${Math.floor(i / 8)}`);
    }
    for (const sheet of this.plainSheets()) {
      const holes = this.holes(sheet);
      if (holes.length) throw new Error(`${this.name}_${sheet}: ${holes.length} hole(s) in the palette, first at ${holes[0]!.col},${holes[0]!.row}`);
    }
    return {
      name: this.name,
      mode: this.mode,
      sheets: Object.fromEntries(this.sheets),
      flags: this.flags,
      moved: this.moved,
      added: [...this.added].sort((a, z) => a - z),
    };
  }
}

/**
 * Draws an object on a scratch canvas the size of its own tiles: what a drawing puts outside
 * (a ground shadow one pixel too low, a leaf too far) is cut instead of spilling onto the
 * neighbouring tile of the sheet, where it showed as a stray dark line.
 */
function clipped(draw: (c: PixelCanvas, x: number, y: number) => void, w: number, h: number): PixelCanvas {
  const scratch = new PixelCanvas(w * T, h * T);
  draw(scratch, 0, 0);
  return scratch;
}

/** Block origin (in tiles) of an A1 kind, frame 0. */
function a1Block(kind: number): { bx: number; by: number } {
  if (kind === 0) return { bx: 0, by: 0 };
  if (kind === 1) return { bx: 0, by: 3 };
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  const bx = Math.floor(tx / 4) * 8 + (kind % 2 === 1 ? 6 : 0);
  const by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
  return { bx, by };
}

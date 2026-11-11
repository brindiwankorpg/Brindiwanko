/**
 * @file Spatial grid of a zone, so that each player only looks at the
 * entities of the cells around it when the server sends positions (instead of
 * every entity of the map, for every player).
 *
 * The map is cut into cells at least `radius` wide: anything within `radius`
 * of a point lies in its cell or in one of the eight around it (through the
 * edges of a looping map too).
 */

/** Grid of a zone, rebuilt at each tick. */
export class AoiGrid<T> {
  private readonly columns: number;
  private readonly rows: number;
  private readonly cells = new Map<number, T[]>();
  /** Columns and rows around each column and row. */
  private readonly columnsAround: number[][];
  private readonly rowsAround: number[][];

  /**
   * @param width - Map width in cells.
   * @param height - Map height in cells.
   * @param radius - Largest distance looked at.
   * @param loopX - The map loops horizontally.
   * @param loopY - The map loops vertically.
   */
  constructor(
    private readonly width: number,
    private readonly height: number,
    radius: number,
    loopX = false,
    loopY = false,
  ) {
    // Cells as wide as the map divides into, but never narrower than the radius.
    this.columns = Math.max(1, Math.floor(width / radius));
    this.rows = Math.max(1, Math.floor(height / radius));
    this.columnsAround = Array.from({ length: this.columns }, (_, i) => neighbours(i, this.columns, loopX));
    this.rowsAround = Array.from({ length: this.rows }, (_, i) => neighbours(i, this.rows, loopY));
  }

  private column(x: number): number {
    return Math.min(this.columns - 1, Math.max(0, Math.floor((x * this.columns) / this.width)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y * this.rows) / this.height)));
  }

  /** Empties the grid but keeps its structure (and the lists of its cells) for the next tick. */
  clear(): void {
    for (const list of this.cells.values()) list.length = 0;
  }

  /** Puts an entity at a cell of the map. */
  add(x: number, y: number, entity: T): void {
    const key = this.row(y) * this.columns + this.column(x);
    const list = this.cells.get(key);
    if (list) list.push(entity);
    else this.cells.set(key, [entity]);
  }

  /** Entities of the cells around a point, cell by cell (a superset of those within the radius). */
  near(x: number, y: number): T[][] {
    const out: T[][] = [];
    const columns = this.columnsAround[this.column(x)]!;
    for (const row of this.rowsAround[this.row(y)]!) {
      for (const column of columns) {
        const list = this.cells.get(row * this.columns + column);
        if (list) out.push(list);
      }
    }
    return out;
  }
}

/** Indexes around `i` (`count` of them in all), wrapping on a looping axis; each one once. */
function neighbours(i: number, count: number, loop: boolean): number[] {
  const out = new Set<number>();
  for (const n of [i - 1, i, i + 1]) {
    if (loop) out.add(((n % count) + count) % count);
    else if (n >= 0 && n < count) out.add(n);
  }
  return [...out];
}

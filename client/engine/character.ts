/**
 * @file Characters on the map (player, other players, events): grid position,
 * smooth movement between cells, facing and walking animation, and sprite
 * drawing from character sheets.
 *
 * Movement: a character moves cell by cell; `x, y` is the destination cell and
 * `realX, realY` the interpolated position. At move speed s, the distance per
 * frame is 2^s / 256 tiles (speed 4: 16 frames per tile at 60 fps).
 * On a looping map `x, y` always stay inside the map: a step past the right
 * edge goes to column 0 while `realX` goes from the last column to one past
 * it (-1 on the other side), so the step is drawn smoothly across the edge.
 *
 * Characters moved by the server (other players, monsters) follow the positions it sends with
 * {@link MapCharacter.follow}: the server sends them 20 times a second while a step lasts 266 ms, so they
 * arrive at uneven times (250 then 300 ms, plus the network). The steps are queued and walked one after the
 * other, starting a little late, so that the walk neither jumps (a position arriving before the step it
 * follows is over) nor stops (one arriving after).
 *
 * Animation: sheets have 3 patterns per direction, played 0-1-2-1; pattern 1
 * is the standing pose. The pattern advances every (9 - speed) × 3 frames,
 * 1.5 × faster while walking.
 *
 * Sheet rules: a name starting with `$` holds one character (3 × 4 frames),
 * otherwise eight (4 × 2 blocks); a name containing `!` right after the
 * optional `$` is drawn without the usual 6-pixel lift and without shadow
 * (doors, chests, flames). Frames are anchored by their bottom centre on the
 * bottom centre of the cell.
 */
import { directionOffset } from '../../shared/map.js';
import type { Direction } from '../../shared/settings.js';
import type { Bitmap } from './assets.js';

/**
 * Frames (1/60 s) a character moved by the server waits before the first step of a walk: the next position
 * then arrives before the step under way ends, even 100 ms late (uneven sending times and network).
 */
export const FOLLOW_DELAY_FRAMES = 6;
/** Steps a character moved by the server may have waiting; one more and it jumps to the last position. */
export const FOLLOW_MAX_QUEUE = 4;

/** Where a character's frames come from. */
export interface SpriteSource {
  image: Bitmap;
  /** Treated as a single-character sheet. */
  single: boolean;
  /** Object sheet (`!` prefix). */
  object: boolean;
  /** Character index in a multi-character sheet (0–7). */
  index: number;
}

/**
 * Parses sheet name prefixes.
 * @param name - Character sheet file name.
 */
export function sheetFlags(name: string): { single: boolean; object: boolean } {
  return { single: /^!?\$/.test(name), object: /^\$?!/.test(name) };
}

/** A character on the map. */
export class MapCharacter {
  x = 0;
  y = 0;
  realX = 0;
  realY = 0;
  /** Position at the start of the last 60 Hz step (interpolated between frames on high-Hz screens). */
  prevX = 0;
  prevY = 0;
  direction: Direction = 2;
  moveSpeed = 4;
  pattern = 1;
  walkAnime = true;
  stepAnime = false;
  directionFix = false;
  /** Tile id drawn instead of a character sheet (tile events). */
  tileId = 0;
  sprite: SpriteSource | null = null;
  /** Standing on a bush cell (lower part drawn semi-transparent). */
  bush = false;
  /** Opacity 0–1. */
  opacity = 1;
  /** Width and height of a looping map (0: the axis does not loop). */
  loopW = 0;
  loopH = 0;
  private animationCount = 0;
  /** Positions received from the server and not walked yet (see {@link follow}). */
  private readonly queue: { x: number; y: number; direction: Direction }[] = [];
  /** Frames left before the first queued step starts. */
  private holdFrames = 0;

  /** Places the character on a cell instantly. */
  locate(x: number, y: number): void {
    this.queue.length = 0;
    this.holdFrames = 0;
    this.x = x;
    this.y = y;
    this.realX = x;
    this.realY = y;
    this.prevX = x;
    this.prevY = y;
  }

  /** Drawn position at the sub-frame fraction `alpha` (0 = previous tick, 1 = current tick). */
  renderX(alpha = 1): number {
    return this.prevX + (this.realX - this.prevX) * alpha;
  }

  /** Drawn position at the sub-frame fraction `alpha` (0 = previous tick, 1 = current tick). */
  renderY(alpha = 1): number {
    return this.prevY + (this.realY - this.prevY) * alpha;
  }

  /** Tells whether the character is between two cells. */
  isMoving(): boolean {
    return this.realX !== this.x || this.realY !== this.y;
  }

  /** Faces a direction unless the direction is fixed. */
  setDirection(d: Direction): void {
    if (!this.directionFix) this.direction = d;
  }

  /** Starts a step towards `d` (the caller has checked passability). */
  moveStraight(d: Direction): void {
    this.setDirection(d);
    const { dx, dy } = directionOffset(d);
    this.stepTo(this.x + dx, this.y + dy);
  }

  /**
   * Starts a one-cell step to a neighbouring cell (given outside the map past a
   * looping edge, or already brought back inside).
   */
  stepTo(x: number, y: number): void {
    this.x = this.loopW ? ((x % this.loopW) + this.loopW) % this.loopW : x;
    this.y = this.loopH ? ((y % this.loopH) + this.loopH) % this.loopH : y;
    // The drawn position comes from the side the step started from (across the edge of a looping map).
    if (this.loopW) {
      const shiftX = Math.round((this.x - this.realX) / this.loopW) * this.loopW;
      this.realX += shiftX;
      this.prevX += shiftX;
    }
    if (this.loopH) {
      const shiftY = Math.round((this.y - this.realY) / this.loopH) * this.loopH;
      this.realY += shiftY;
      this.prevY += shiftY;
    }
  }

  /**
   * Walks to a position sent by the server (another player, a monster). A step received while another is
   * under way is queued, then started as soon as the previous one ends, with no stop in between; the first
   * step of a walk waits {@link FOLLOW_DELAY_FRAMES} frames, and a queue that grows is walked faster. A
   * position that is not one step from the last one (teleport), or too many steps behind, is jumped to.
   * @param isStep - Tells whether a cell is one step from another (through the edges of a looping map).
   */
  follow(x: number, y: number, direction: Direction, isStep: (fromX: number, fromY: number, toX: number, toY: number) => boolean): void {
    const last = this.queue.at(-1);
    const fromX = last ? last.x : this.x;
    const fromY = last ? last.y : this.y;
    if (fromX === x && fromY === y) {
      // Turning on the spot: after the steps still to walk, or at once.
      if (last) last.direction = direction;
      else this.direction = direction;
      return;
    }
    if (!isStep(fromX, fromY, x, y) || this.queue.length >= FOLLOW_MAX_QUEUE) {
      this.locate(x, y);
      this.direction = direction;
      return;
    }
    if (this.queue.length === 0 && !this.isMoving()) this.holdFrames = FOLLOW_DELAY_FRAMES;
    this.queue.push({ x, y, direction });
  }

  /** Steps received from the server and not started yet. */
  get queuedSteps(): number {
    return this.queue.length;
  }

  /** Starts the next queued step. */
  private nextStep(): void {
    const next = this.queue.shift()!;
    this.direction = next.direction;
    this.stepTo(next.x, next.y);
  }

  /**
   * Moves the drawn position towards the destination cell.
   * @returns The part of `distance` left once the cell is reached.
   */
  private advance(distance: number): number {
    const before = Math.abs(this.x - this.realX) + Math.abs(this.y - this.realY);
    if (this.x < this.realX) this.realX = Math.max(this.realX - distance, this.x);
    if (this.x > this.realX) this.realX = Math.min(this.realX + distance, this.x);
    if (this.y < this.realY) this.realY = Math.max(this.realY - distance, this.y);
    if (this.y > this.realY) this.realY = Math.min(this.realY + distance, this.y);
    const after = Math.abs(this.x - this.realX) + Math.abs(this.y - this.realY);
    return after > 0 ? 0 : Math.max(0, distance - before);
  }

  /** Distance covered per frame, in tiles. */
  distancePerFrame(): number {
    return 2 ** this.moveSpeed / 256;
  }

  /** Advances movement and animation by one frame (1/60 s). */
  update(): void {
    this.prevX = this.realX;
    this.prevY = this.realY;
    if (this.queue.length > 0 && !this.isMoving()) {
      if (this.holdFrames > 0) this.holdFrames--;
      else this.nextStep();
    }
    const moving = this.isMoving();
    if (moving) {
      // Steps waiting beyond the next one are caught up on: half as fast again per extra step.
      const step = this.distancePerFrame() * (1 + Math.max(0, this.queue.length - 1) / 2);
      const left = this.advance(step);
      // The next step goes on in the same frame: no stop between two cells.
      if (left > 0 && this.queue.length > 0) {
        this.nextStep();
        this.advance(left);
      }
    }
    if (moving && this.walkAnime) this.animationCount += 1.5;
    else if (this.stepAnime || this.pattern !== 1) this.animationCount += 1;
    if (this.animationCount >= (9 - this.moveSpeed) * 3) {
      this.animationCount = 0;
      if (!moving && !this.stepAnime) this.pattern = 1;
      else this.pattern = (this.pattern + 1) % 4;
    }
  }

  /** Pattern column (0–2) derived from the 4-step cycle. */
  patternColumn(): number {
    return this.pattern < 3 ? this.pattern : 1;
  }

  /**
   * Draws the character.
   * @param ctx - Context translated to map pixels.
   * @param tileSize - Tile size in pixels.
   * @param shadow - Shadow image drawn under non-object characters (optional).
   * @param drawTile - Callback drawing a tile id (for tile events).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    tileSize: number,
    shadow: Bitmap | null,
    drawTile: (id: number, dx: number, dy: number) => void,
    alpha = 1,
  ): void {
    const px = this.renderX(alpha) * tileSize;
    const py = this.renderY(alpha) * tileSize;
    ctx.globalAlpha = this.opacity;
    if (this.tileId > 0) {
      drawTile(this.tileId, px, py);
      ctx.globalAlpha = 1;
      return;
    }
    const s = this.sprite;
    if (!s) {
      ctx.globalAlpha = 1;
      return;
    }
    const fw = s.image.width / (s.single ? 3 : 12);
    const fh = s.image.height / (s.single ? 4 : 8);
    const blockX = s.single ? 0 : (s.index % 4) * 3;
    const blockY = s.single ? 0 : Math.floor(s.index / 4) * 4;
    const sx = (blockX + this.patternColumn()) * fw;
    const sy = (blockY + (this.direction - 2) / 2) * fh;
    const lift = s.object ? 0 : Math.round((tileSize * 6) / 48);
    const dx = Math.round(px + tileSize / 2 - fw / 2);
    const dy = Math.round(py + tileSize - fh - lift);
    if (shadow && !s.object) {
      ctx.drawImage(shadow, Math.round(px + tileSize / 2 - shadow.width / 2), Math.round(py + tileSize - shadow.height - lift / 2));
    }
    if (this.bush && !s.object) {
      // The lower part of the body is drawn semi-transparent, as if hidden by the bush.
      const depth = Math.round((tileSize * 12) / 48);
      ctx.drawImage(s.image, sx, sy, fw, fh - depth, dx, dy, fw, fh - depth);
      ctx.globalAlpha = this.opacity * 0.5;
      ctx.drawImage(s.image, sx, sy + fh - depth, fw, depth, dx, dy + fh - depth, fw, depth);
    } else {
      ctx.drawImage(s.image, sx, sy, fw, fh, dx, dy, fw, fh);
    }
    ctx.globalAlpha = 1;
  }

  /** Screen-space sort key (lower = drawn first). */
  sortY(alpha = 1): number {
    return this.renderY(alpha);
  }
}

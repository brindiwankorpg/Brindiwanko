/**
 * @file Animated preview of an animation of the database (editor): a small
 * stage where the animation plays in a loop over its target tile, drawn by the
 * game's own code at the same size relative to a tile, and plays again with
 * its sound on demand. Used by the animation form and by the animation picker.
 */
import { animationTicks, drawAnimation } from '../engine/animation.js';
import type { AssetStore, Bitmap } from '../engine/assets.js';

/** Fields of an animation record the preview reads. */
export interface AnimationLook {
  sheet: string;
  frameCount: number;
  frameSize: number;
  fps: number;
  sound?: string;
}

/** Pause between two plays, in milliseconds. */
const LOOP_PAUSE_MS = 600;
/** Frames a stage not yet in the page keeps waiting for it before stopping. */
const WAIT_FRAMES = 120;

/** A stage playing one animation in a loop. */
export class AnimationPreview {
  readonly canvas: HTMLCanvasElement;
  private look: AnimationLook | null = null;
  private sheet: Bitmap | null = null;
  /** False while the sheet loads (nothing is drawn rather than the sparkle shown without a sheet). */
  private ready = true;
  private startedAt = 0;
  private running = false;
  private waited = 0;

  constructor(private readonly assets: AssetStore | undefined, size = 144) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'anim-stage';
    this.canvas.width = size;
    this.canvas.height = size;
  }

  /** Plays an animation in a loop from its first frame (an empty stage for `null`); the same one keeps playing. */
  show(look: AnimationLook | null): void {
    const same = (a: AnimationLook | null, b: AnimationLook | null) =>
      a === b || (!!a && !!b && a.sheet === b.sheet && a.frameCount === b.frameCount && a.frameSize === b.frameSize && a.fps === b.fps);
    if (same(look, this.look)) {
      if (look && this.look) this.look.sound = look.sound;
      return;
    }
    const name = look?.sheet ?? '';
    if (name !== (this.look?.sheet ?? '')) {
      this.sheet = null;
      this.ready = !name || !this.assets;
      if (name && this.assets) {
        void this.assets.image('animations', name).then((image) => {
          if (this.look?.sheet !== name) return;
          // A missing sheet plays the sparkle, as in game.
          this.sheet = image;
          this.ready = true;
          this.startedAt = performance.now();
        });
      }
    }
    this.look = look ? { ...look } : null;
    this.startedAt = performance.now();
    if (!this.running) {
      this.running = true;
      this.waited = 0;
      requestAnimationFrame(this.loop);
    }
  }

  /** Starts again from the first frame, with the sound of the animation. */
  replay(): void {
    this.startedAt = performance.now();
    const url = this.look?.sound ? this.assets?.url('se', this.look.sound) : null;
    if (url) void new Audio(url).play().catch(() => undefined);
  }

  private readonly loop = (now: number): void => {
    // Stops by itself once the stage has left the page (form redrawn, list closed).
    if (!this.canvas.isConnected) {
      if (this.waited < 0 || ++this.waited > WAIT_FRAMES) {
        this.running = false;
        return;
      }
    } else this.waited = -1;
    this.draw(now);
    requestAnimationFrame(this.loop);
  };

  private draw(now: number): void {
    const ctx = this.canvas.getContext('2d')!;
    const { width, height } = this.canvas;
    const look = this.look;
    // Frames are made for 48 px tiles: a large frame shrinks the stage's tiles so that it fits.
    const tile = look && look.frameSize > 0 ? Math.max(8, Math.min(48, Math.floor((width * 0.9 * 48) / look.frameSize))) : 48;
    const cx = width / 2;
    const cy = height / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d1230';
    ctx.fillRect(0, 0, width, height);
    // Ground of tiles around the target tile, which is lit.
    ctx.strokeStyle = 'rgba(122, 140, 210, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (cx - tile / 2) % tile; x < width; x += tile) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }
    for (let y = (cy - tile / 2) % tile; y < height; y += tile) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(122, 140, 210, 0.22)';
    ctx.fillRect(Math.round(cx - tile / 2), Math.round(cy - tile / 2), tile, tile);
    if (!look || !this.ready) return;
    const length = (animationTicks(look.frameCount, look.fps) / 60) * 1000;
    let elapsed = now - this.startedAt;
    if (elapsed > length + LOOP_PAUSE_MS) {
      this.startedAt = now;
      elapsed = 0;
    }
    if (elapsed >= 0 && elapsed <= length) drawAnimation(ctx, this.sheet, look.frameCount, look.frameSize, cx, cy, tile, elapsed / length);
  }
}

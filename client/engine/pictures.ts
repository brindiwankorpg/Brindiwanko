/**
 * @file Pictures shown over the map by events (title cards, portraits,
 * illustrations of a cutscene...), numbered 1 to 100: a higher number is drawn
 * above a lower one.
 *
 * Positions are in screen pixels before the zoom (the same unit as the map
 * drawing), from the top-left corner of the screen or from the centre of the
 * picture (`origin` 1). A picture can move, grow, fade and change blend over a
 * duration (with an easing), turn on itself, and take a colour tone like the
 * screen. They stay when the player changes map, until an event erases them.
 */
import type { Bitmap } from './assets.js';

/** What a picture looks like at one moment. */
interface PictureState {
  x: number;
  y: number;
  /** Size in percent (negative: mirrored). */
  scaleX: number;
  scaleY: number;
  /** 0–255. */
  opacity: number;
}

/** A movement in progress. */
interface Tween {
  from: PictureState;
  to: PictureState;
  start: number;
  ms: number;
  easing: number;
}

interface Picture {
  image: Bitmap | null;
  origin: number;
  blend: number;
  state: PictureState;
  tween: Tween | null;
  /** Degrees per frame / 2, like the standard command. */
  rotationSpeed: number;
  angle: number;
  tone: [number, number, number, number];
  toneFrom: [number, number, number, number];
  toneTo: [number, number, number, number];
  toneStart: number;
  toneMs: number;
  /** The picture drawn with its tone, rebuilt when the tone changes. */
  toned: { key: string; canvas: HTMLCanvasElement } | null;
}

const BLENDS: GlobalCompositeOperation[] = ['source-over', 'lighter', 'multiply', 'screen'];

/** Easing curves: 0 linear, 1 slow start, 2 slow end, 3 slow start and end. */
function ease(t: number, type: number): number {
  if (type === 1) return t * t;
  if (type === 2) return 1 - (1 - t) * (1 - t);
  if (type === 3) return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  return t;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The pictures of the screen. */
export class PictureLayer {
  private readonly pictures = new Map<number, Picture>();

  /** @param load - Loads an image of the `pictures` folder. */
  constructor(private readonly load: (name: string) => Promise<Bitmap | null>) {}

  /** Shows (or replaces) a picture. */
  show(id: number, name: string, origin: number, state: PictureState, blend: number): void {
    const picture: Picture = {
      image: null, origin, blend, state, tween: null, rotationSpeed: 0, angle: 0,
      tone: [0, 0, 0, 0], toneFrom: [0, 0, 0, 0], toneTo: [0, 0, 0, 0], toneStart: 0, toneMs: 0, toned: null,
    };
    this.pictures.set(id, picture);
    void this.load(name).then((image) => {
      if (this.pictures.get(id) === picture) picture.image = image;
    });
  }

  /** Moves a picture to a new state over `ms`. */
  move(id: number, origin: number, to: PictureState, blend: number, ms: number, easing: number): void {
    const p = this.pictures.get(id);
    if (!p) return;
    p.origin = origin;
    p.blend = blend;
    if (ms <= 0) {
      p.state = to;
      p.tween = null;
    } else p.tween = { from: { ...p.state }, to, start: performance.now(), ms, easing };
  }

  rotate(id: number, speed: number): void {
    const p = this.pictures.get(id);
    if (p) p.rotationSpeed = speed;
  }

  tint(id: number, tone: [number, number, number, number], ms: number): void {
    const p = this.pictures.get(id);
    if (!p) return;
    p.toneFrom = [...p.tone];
    p.toneTo = tone;
    p.toneStart = performance.now();
    p.toneMs = Math.max(0, ms);
    if (ms <= 0) p.tone = tone;
  }

  erase(id: number): void {
    this.pictures.delete(id);
  }

  /** Erases every picture (reconnection). */
  clear(): void {
    this.pictures.clear();
  }

  /** Advances one frame (rotation, movements, tones). */
  update(): void {
    const now = performance.now();
    for (const p of this.pictures.values()) {
      p.angle += p.rotationSpeed / 2;
      if (p.tween) {
        const t = Math.min(1, (now - p.tween.start) / p.tween.ms);
        const k = ease(t, p.tween.easing);
        const { from, to } = p.tween;
        p.state = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), scaleX: lerp(from.scaleX, to.scaleX, k), scaleY: lerp(from.scaleY, to.scaleY, k), opacity: lerp(from.opacity, to.opacity, k) };
        if (t >= 1) p.tween = null;
      }
      if (p.toneMs > 0) {
        const t = Math.min(1, (now - p.toneStart) / p.toneMs);
        p.tone = p.toneFrom.map((v, i) => Math.round(lerp(v, p.toneTo[i]!, t))) as [number, number, number, number];
        if (t >= 1) p.toneMs = 0;
      }
    }
  }

  /** Draws the pictures, lowest number first (the context is in screen pixels before the zoom). */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const id of [...this.pictures.keys()].sort((a, b) => a - b)) {
      const p = this.pictures.get(id)!;
      if (!p.image || p.state.opacity <= 0) continue;
      const image = this.toned(p);
      const w = image.width;
      const h = image.height;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.state.opacity / 255);
      ctx.globalCompositeOperation = BLENDS[p.blend] ?? 'source-over';
      ctx.translate(p.state.x, p.state.y);
      if (p.angle) ctx.rotate((-p.angle * Math.PI) / 180);
      ctx.scale(p.state.scaleX / 100, p.state.scaleY / 100);
      ctx.drawImage(image, p.origin === 1 ? -w / 2 : 0, p.origin === 1 ? -h / 2 : 0);
      ctx.restore();
    }
  }

  /** The image with its colour tone (the image itself without tone). */
  private toned(p: Picture): CanvasImageSource & { width: number; height: number } {
    const image = p.image!;
    const [r, g, b, gray] = p.tone;
    if (!r && !g && !b && !gray) return image;
    const key = p.tone.join(',');
    if (p.toned?.key === key) return p.toned.canvas;
    const canvas = p.toned?.canvas ?? document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.filter = gray > 0 ? `grayscale(${Math.round((gray / 255) * 100)}%)` : 'none';
    c.drawImage(image, 0, 0);
    c.filter = 'none';
    // Darkening (negative values) multiplies, lightening (positive values) adds; only where the picture is.
    c.globalCompositeOperation = 'source-atop';
    if (r < 0 || g < 0 || b < 0) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = `rgb(${255 + Math.min(0, r)}, ${255 + Math.min(0, g)}, ${255 + Math.min(0, b)})`;
      c.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (r > 0 || g > 0 || b > 0) {
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = `rgb(${Math.max(0, r)}, ${Math.max(0, g)}, ${Math.max(0, b)})`;
      c.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Keep the shape of the picture (the colour layers covered its transparent parts).
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(image, 0, 0);
    c.globalCompositeOperation = 'source-over';
    p.toned = { key, canvas };
    return canvas;
  }
}

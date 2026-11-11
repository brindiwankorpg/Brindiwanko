/**
 * @file Drawing of a combat animation, shared by the game scene and the
 * preview of the database editor: the frames of the animation sheet (square
 * frames read left to right, then down), or a generated sparkle when the
 * animation has no sheet.
 */
import type { Bitmap } from './assets.js';

/** Length of an animation in frames of 1/60 s (never shorter than 10). */
export function animationTicks(frameCount: number, fps: number): number {
  return Math.max(10, Math.round((Math.max(1, frameCount) / Math.max(1, fps)) * 60));
}

/**
 * Draws one moment of an animation centred on a point.
 * @param sheet - Animation sheet, or `null` for the generated sparkle.
 * @param tile - Size of a map tile on screen (frames are drawn for 48 px tiles).
 * @param progress - From 0 (start) to 1 (end).
 */
export function drawAnimation(ctx: CanvasRenderingContext2D, sheet: Bitmap | null, frameCount: number, frameSize: number, x: number, y: number, tile: number, progress: number): void {
  const frames = Math.max(1, frameCount);
  if (sheet) {
    const columns = Math.max(1, Math.floor(sheet.width / frameSize));
    const frame = Math.min(frames - 1, Math.floor(progress * frames));
    const size = Math.round(frameSize * (tile / 48));
    ctx.drawImage(sheet, (frame % columns) * frameSize, Math.floor(frame / columns) * frameSize, frameSize, frameSize, Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    return;
  }
  ctx.save();
  ctx.globalAlpha = 1 - progress;
  ctx.strokeStyle = '#fff6c8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, tile * (0.2 + progress * 0.6), 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffe27a';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + progress * 2;
    const r = tile * (0.15 + progress * 0.55);
    ctx.fillRect(Math.round(x + Math.cos(a) * r) - 2, Math.round(y + Math.sin(a) * r) - 2, 4, 4);
  }
  ctx.restore();
}

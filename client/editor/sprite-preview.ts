import type { AssetStore } from '../engine/assets.js';
import { sheetFlags } from '../engine/character.js';
import { t } from '../i18n.js';
import { el } from '../ui/dom.js';

/** Preview of one character (front frame) or face of a sheet, next to its index field. */
export interface SpritePreview {
  element: HTMLCanvasElement;
  /** Redraws, e.g. after the sheet or the index changed. */
  refresh(): void;
}

/** Draws entry `i` (0-7) of a face or character sheet, centred at the bottom of a square canvas. */
export function drawEntry(canvas: HTMLCanvasElement, image: CanvasImageSource & { width: number; height: number }, kind: 'characters' | 'faces', name: string, i: number): void {
  const size = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const single = kind === 'characters' && sheetFlags(name).single;
  const fw = kind === 'faces' ? image.width / 4 : image.width / (single ? 3 : 12);
  const fh = kind === 'faces' ? image.height / 2 : image.height / (single ? 4 : 8);
  const sx = kind === 'faces' ? (i % 4) * fw : ((single ? 0 : (i % 4) * 3) + 1) * fw;
  const sy = kind === 'faces' ? Math.floor(i / 4) * fh : (single ? 0 : Math.floor(i / 4) * 4) * fh;
  const scale = Math.min(size / fw, size / fh);
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sx, sy, fw, fh, (size - fw * scale) / 2, size - fh * scale, fw * scale, fh * scale);
}

/**
 * Builds the preview.
 * @param assets - Asset store.
 * @param kind - `characters` or `faces`.
 * @param sheet - Returns the current sheet name.
 * @param index - Returns the current index (0-7).
 */
export function spritePreview(assets: AssetStore, kind: 'characters' | 'faces', sheet: () => string, index: () => number): SpritePreview {
  const element = el('canvas', { className: 'sprite-preview', attrs: { width: '48', height: '48' } });
  let generation = 0;
  const refresh = () => {
    const ctx = element.getContext('2d')!;
    ctx.clearRect(0, 0, 48, 48);
    const name = sheet();
    const i = Math.max(0, Math.min(7, Math.trunc(index()) || 0));
    const run = ++generation;
    if (!name) return;
    void assets.image(kind, name).then((image) => {
      if (!image || run !== generation) return;
      drawEntry(element, image, kind, name, i);
    });
  };
  refresh();
  return { element, refresh };
}

/**
 * The eight faces (or characters) of a sheet side by side: a click chooses one and writes its number in
 * the index field, which stays for those who prefer typing it. Nothing to guess any more.
 * @param assets - Asset store.
 * @param kind - `characters` or `faces`.
 * @param sheet - Returns the current sheet name.
 * @param index - Number field of the index (0-7), kept in step both ways.
 */
export function spriteGrid(assets: AssetStore, kind: 'characters' | 'faces', sheet: () => string, index: HTMLInputElement): { element: HTMLElement; refresh(): void } {
  const cells = Array.from({ length: 8 }, (_, i) => {
    const canvas = el('canvas', { attrs: { width: '48', height: '48', 'aria-hidden': 'true' } });
    const button = el('button', { className: 'sprite-cell', title: String(i), attrs: { type: 'button', 'aria-label': t('editor.pick_entry', { n: i }) } }, [canvas]);
    button.addEventListener('click', () => {
      index.value = String(i);
      index.dispatchEvent(new Event('input', { bubbles: true }));
      index.dispatchEvent(new Event('change', { bubbles: true }));
      mark();
    });
    return { button, canvas };
  });
  const element = el('div', { className: 'sprite-grid', attrs: { role: 'group', 'aria-label': t('editor.pick_entry_group') } }, cells.map((c) => c.button));
  const mark = () => {
    const chosen = Math.trunc(Number(index.value)) || 0;
    cells.forEach((c, i) => c.button.classList.toggle('selected', i === chosen));
  };
  let generation = 0;
  const refresh = () => {
    const name = sheet();
    const run = ++generation;
    for (const c of cells) c.canvas.getContext('2d')!.clearRect(0, 0, 48, 48);
    mark();
    element.hidden = !name;
    if (!name) return;
    void assets.image(kind, name).then((image) => {
      if (!image || run !== generation) return;
      // A single-character sheet ($Name) holds one entry only.
      const count = kind === 'characters' && sheetFlags(name).single ? 1 : 8;
      cells.forEach((c, i) => {
        c.button.hidden = i >= count;
        if (i < count) drawEntry(c.canvas, image, kind, name, i);
      });
    });
  };
  index.addEventListener('input', mark);
  refresh();
  return { element, refresh };
}

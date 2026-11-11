/**
 * @file Character selection page: animates each character's sprite from its
 * stored appearance (generated on the fly in the browser).
 */
import { sanitizeAppearance } from '../../shared/art/character.js';
import { CharacterPreview } from '../art/render.js';
import { formatServerTime } from '../i18n.js';

// Dates of the server (UTC) shown in the player's own time zone and language.
for (const time of document.querySelectorAll<HTMLTimeElement>('time[data-server-time]')) {
  time.textContent = formatServerTime(time.dataset.serverTime ?? '', 'full');
}

for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-appearance]')) {
  let raw: unknown = null;
  try {
    raw = JSON.parse(canvas.dataset.appearance ?? 'null');
  } catch {
    raw = null;
  }
  const preview = new CharacterPreview(canvas, sanitizeAppearance(raw), 3);
  preview.start(220);
}

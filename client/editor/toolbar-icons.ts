/**
 * @file Icons of the editor's toolbar, drawn for this engine as small SVG
 * pictures (24 × 24, coloured, with a dark outline, in the style of classic
 * desktop editors). Like every other graphic of the project they are original
 * drawings, made by this code.
 *
 * Each icon becomes an `<img>` with a `data:` URL (allowed by the Content
 * Security Policy), so the markup never goes through `innerHTML`.
 */
import { el } from '../ui/dom.js';

/** Outline colour shared by the icons. */
const O = '#20202c';

/** Blue arrow bent back to the left (undo); mirrored for redo. */
const UNDO = `<path d="M9 8h6.5a5 5 0 0 1 0 10H9" fill="none" stroke="${O}" stroke-width="4.2" stroke-linecap="round"/>
<path d="M9 8h6.5a5 5 0 0 1 0 10H9" fill="none" stroke="#3d8bfd" stroke-width="2.4" stroke-linecap="round"/>
<path d="M10 3.5L4 8l6 4.5z" fill="#3d8bfd" stroke="${O}" stroke-width="1.1" stroke-linejoin="round"/>`;

/** Yellow pencil pointing to the bottom left. */
const PENCIL = `<path d="M4 20l1.2-4.6L16.5 4.1a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L8.6 18.8z" fill="#ffc83d" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M14.9 5.7l3.4 3.4" stroke="#ff8fb1" stroke-width="2.4"/>
<path d="M4 20l1.2-4.6 3.4 3.4z" fill="#f2d2a9" stroke="${O}" stroke-width="1" stroke-linejoin="round"/>
<path d="M4 20l.5-1.9 1.4 1.4z" fill="${O}"/>`;

/** Magnifying glass; the sign inside is added per icon. */
const LENS = `<path d="M14.5 14.5l6 6" stroke="${O}" stroke-width="4.2" stroke-linecap="round"/>
<path d="M14.5 14.5l6 6" stroke="#b5762c" stroke-width="2.4" stroke-linecap="round"/>
<circle cx="10" cy="10" r="6.5" fill="#d9f0ff" stroke="${O}" stroke-width="1.4"/>`;

/** Drawings of the icons (inside a 24 × 24 view box). */
const ICONS = {
  newMap: `<path d="M5 2.5h9l5 5v14H5z" fill="#f4f6fb" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M14 2.5v5h5" fill="#d3d9e8" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<circle cx="17" cy="17" r="5" fill="#3fb950" stroke="${O}" stroke-width="1.2"/>
<path d="M17 14.2v5.6M14.2 17h5.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
  importProject: `<path d="M2.5 6.5h6l2 2h9v3H6.5l-4 9z" fill="#d79a1c" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M2.5 20.5l4-9h15l-4 9z" fill="#ffcf4d" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M15 1.5v7m-3-3l3 3 3-3" fill="none" stroke="${O}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M15 1.5v7m-3-3l3 3 3-3" fill="none" stroke="#3d8bfd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  save: `<path d="M3.5 3.5h14l3 3v14h-17z" fill="#2f6fd6" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<rect x="7" y="3.5" width="9" height="6" fill="#e8edf7" stroke="${O}" stroke-width="1"/>
<rect x="12.6" y="4.8" width="2" height="3.4" fill="#2f6fd6"/>
<rect x="6.5" y="13" width="11" height="7.5" rx="0.5" fill="#f4f6fb" stroke="${O}" stroke-width="1"/>
<path d="M8.5 15.5h7M8.5 18h7" stroke="#9aa6c4" stroke-width="1"/>`,
  cut: `<path d="M8 2.5l7.6 12M16 2.5L8.4 14.5" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/>
<path d="M8 2.5l7.6 12M16 2.5L8.4 14.5" stroke="#d9dde8" stroke-width="2" stroke-linecap="round"/>
<circle cx="7" cy="17.5" r="3.3" fill="none" stroke="${O}" stroke-width="3.8"/>
<circle cx="17" cy="17.5" r="3.3" fill="none" stroke="${O}" stroke-width="3.8"/>
<circle cx="7" cy="17.5" r="3.3" fill="none" stroke="#e5484d" stroke-width="2.2"/>
<circle cx="17" cy="17.5" r="3.3" fill="none" stroke="#e5484d" stroke-width="2.2"/>`,
  copy: `<rect x="3.5" y="3.5" width="11" height="13" rx="1" fill="#cfd7ea" stroke="${O}" stroke-width="1.2"/>
<rect x="9.5" y="7.5" width="11" height="13" rx="1" fill="#f8f9fc" stroke="${O}" stroke-width="1.2"/>
<path d="M12 11.5h6M12 14h6M12 16.5h4" stroke="#7d8bb0" stroke-width="1.1"/>`,
  paste: `<rect x="4.5" y="4" width="15" height="17.5" rx="1.5" fill="#b27a3d" stroke="${O}" stroke-width="1.2"/>
<rect x="7" y="7" width="10" height="12.5" fill="#f8f9fc" stroke="${O}" stroke-width="0.8"/>
<rect x="8.5" y="2.5" width="7" height="3.5" rx="1" fill="#c7ccd8" stroke="${O}" stroke-width="1.1"/>
<path d="M9 10.5h6M9 13h6M9 15.5h4" stroke="#7d8bb0" stroke-width="1.1"/>`,
  delete: `<path d="M6 7.5h12l-1 13.5H7z" fill="#9aa3b5" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<rect x="4" y="5" width="16" height="2.6" rx="0.8" fill="#e5484d" stroke="${O}" stroke-width="1.1"/>
<path d="M10 3.2h4" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>
<path d="M9.5 10.5v8M12 10.5v8M14.5 10.5v8" stroke="#5d6578" stroke-width="1.1"/>`,
  undo: UNDO,
  redo: `<g transform="matrix(-1 0 0 1 24 0)">${UNDO}</g>`,
  modeMap: `<rect x="2.5" y="4.5" width="19" height="15" rx="1" fill="#8fd3ff"/>
<circle cx="17" cy="8.5" r="2" fill="#ffd84d" stroke="${O}" stroke-width="0.8"/>
<path d="M2.5 15l5.5-5.5 4 4 3-3 6.5 6.5v2.5h-19z" fill="#3fae4b"/>
<path d="M2.5 17.5h19v2h-19z" fill="#2d8a3a"/>
<rect x="2.5" y="4.5" width="19" height="15" rx="1" fill="none" stroke="${O}" stroke-width="1.2"/>`,
  modeEvents: `<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" fill="#34407a" stroke="${O}" stroke-width="1"/>
<rect x="4.6" y="4.6" width="14.8" height="14.8" rx="1" fill="none" stroke="#ffd84d" stroke-width="1.8"/>
<path d="M7.5 18.5c0-3.5 2-5.5 4.5-5.5s4.5 2 4.5 5.5z" fill="#e5484d" stroke="${O}" stroke-width="1"/>
<circle cx="12" cy="9.5" r="3" fill="#ffd2a8" stroke="${O}" stroke-width="1"/>
<path d="M9 9a3 3 0 0 1 6 0c-1-.8-2-1-3-1s-2 .2-3 1z" fill="#7a4a1e"/>`,
  modeRegion: `<rect x="3" y="3" width="18" height="18" fill="#2d3550"/>
<path d="M3 3h12v6H9v6H3z" fill="#c25ce0"/>
<path d="M15 9h6v12h-12v-6h6z" fill="#ff9a3c"/>
<path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="${O}" stroke-width="0.8" stroke-opacity="0.7"/>
<rect x="3" y="3" width="18" height="18" fill="none" stroke="${O}" stroke-width="1.2"/>`,
  modePassage: `<circle cx="8" cy="12" r="4.6" fill="none" stroke="${O}" stroke-width="3.6"/>
<circle cx="8" cy="12" r="4.6" fill="none" stroke="#5ab0ff" stroke-width="2"/>
<path d="M15 8.5l5.5 7M20.5 8.5l-5.5 7" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/>
<path d="M15 8.5l5.5 7M20.5 8.5l-5.5 7" stroke="#ff5a5a" stroke-width="2" stroke-linecap="round"/>`,
  /** Open hand: the Move tool (drags the map). */
  pan: `<rect x="6.6" y="4" width="3" height="10" rx="1.5" fill="#f2c9a0" stroke="${O}" stroke-width="1.1"/>
<rect x="9.9" y="2.5" width="3" height="11" rx="1.5" fill="#f2c9a0" stroke="${O}" stroke-width="1.1"/>
<rect x="13.2" y="3.2" width="3" height="10.5" rx="1.5" fill="#f2c9a0" stroke="${O}" stroke-width="1.1"/>
<rect x="16.5" y="5.5" width="3" height="9" rx="1.5" fill="#f2c9a0" stroke="${O}" stroke-width="1.1"/>
<path d="M6.6 11.5h12.9v3.5a6.5 6.5 0 0 1-6.5 6.5h-1.2a6.5 6.5 0 0 1-5.3-2.8L3.2 14.3a1.7 1.7 0 0 1 2.7-2.1z" fill="#f2c9a0" stroke="${O}" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M10 16.5h6" stroke="#d9a578" stroke-width="1" stroke-linecap="round"/>`,
  pencil: PENCIL,
  rect: `<rect x="3.5" y="5.5" width="17" height="13" fill="#5aa8ff" stroke="${O}" stroke-width="1.4"/>
<rect x="5" y="7" width="14" height="3" fill="#a9d1ff"/>`,
  ellipse: `<ellipse cx="12" cy="12" rx="8.5" ry="6.8" fill="#5aa8ff" stroke="${O}" stroke-width="1.4"/>
<ellipse cx="10" cy="9.4" rx="4.5" ry="1.9" fill="#a9d1ff"/>`,
  fill: `<g transform="rotate(35 11 13)">
<path d="M7 9V5.5a4 4 0 0 1 8 0V9" fill="none" stroke="${O}" stroke-width="1.3"/>
<path d="M5 9h12l-1.5 10h-9z" fill="#d6dbe6" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<ellipse cx="11" cy="9" rx="6" ry="1.8" fill="#3d8bfd" stroke="${O}" stroke-width="1.1"/>
</g>
<path d="M19.5 12c1.5 2.2 2 3.5 2 4.5a2 2 0 0 1-4 0c0-1 .5-2.3 2-4.5z" fill="#3d8bfd" stroke="${O}" stroke-width="1"/>`,
  shadow: `<rect x="2.5" y="2.5" width="14" height="14" fill="#7cc35a" stroke="${O}" stroke-width="1.1"/>
<path d="M9.5 3v13H16V3z" fill="${O}" fill-opacity="0.55"/>
<g transform="translate(7.5 7.5) scale(0.68)">${PENCIL.replaceAll('#ffc83d', '#7d8597').replaceAll('#ff8fb1', '#4a5163')}</g>`,
  picker: `<path d="M12.5 9.5L5 17v2h2l7.5-7.5z" fill="#d9f0ff" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M6 18l5.5-5.5" stroke="#3d8bfd" stroke-width="1.8"/>
<path d="M11 8l2-2 5 5-2 2z" fill="#8a93a8" stroke="${O}" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M14.5 6.5l2.3-2.3a2.4 2.4 0 0 1 3.4 3.4L17.9 9.9z" fill="#3a3f4f" stroke="${O}" stroke-width="1.1"/>`,
  eraser: `<path d="M3.5 15.5l9-9 8 8-6 6h-6z" fill="#ff8fb1" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M3.5 15.5l5-5 8 8-2 2h-6z" fill="#e9eef8" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M8.5 20.5h12" stroke="${O}" stroke-width="1.2" stroke-linecap="round"/>`,
  select: `<rect x="4" y="5" width="16" height="14" fill="#5aa8ff" fill-opacity="0.3" stroke="${O}" stroke-width="3"/>
<rect x="4" y="5" width="16" height="14" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 2"/>`,
  zoomIn: `${LENS}<path d="M10 6.8v6.4M6.8 10h6.4" stroke="#2f6fd6" stroke-width="2" stroke-linecap="round"/>`,
  zoomOut: `${LENS}<path d="M6.8 10h6.4" stroke="#2f6fd6" stroke-width="2" stroke-linecap="round"/>`,
  zoomReset: `${LENS}<rect x="7.4" y="7.4" width="5.2" height="5.2" fill="none" stroke="#2f6fd6" stroke-width="1.6"/>`,
  grid: `<rect x="3.5" y="3.5" width="17" height="17" fill="#2d3550" stroke="${O}" stroke-width="1.2"/>
<path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" stroke="#c9d3ff" stroke-width="1.1"/>`,
  database: `<path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" fill="#e0a526" stroke="${O}" stroke-width="1.2"/>
<path d="M4.5 10c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3M4.5 14c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" fill="none" stroke="${O}" stroke-width="1"/>
<ellipse cx="12" cy="6" rx="7.5" ry="3" fill="#ffd25e" stroke="${O}" stroke-width="1.2"/>`,
  tilesets: `<rect x="3" y="3" width="9" height="9" fill="#5cb85c"/>
<rect x="12" y="3" width="9" height="9" fill="#4aa3e8"/>
<rect x="3" y="12" width="9" height="9" fill="#a7a9b4"/>
<rect x="12" y="12" width="9" height="9" fill="#e6c27a"/>
<path d="M5 9.5l1-2 1 2M8 7.5l1-2 1 2" fill="none" stroke="#2f7a32" stroke-width="1"/>
<path d="M13.5 7c1-1 2-1 3 0s2 1 3 0" fill="none" stroke="#e8f6ff" stroke-width="1.1"/>
<path d="M4 15.5h7M7.5 12v3.5M5.5 15.5v5.5M9.5 15.5v5.5" stroke="#6b6e7c" stroke-width="0.9"/>
<path d="M14.5 15h.1M18 14.5h.1M16 18h.1M19.5 19h.1" stroke="#b08a43" stroke-width="1.4" stroke-linecap="round"/>
<path d="M12 3v18M3 12h18" stroke="${O}" stroke-width="1"/>
<rect x="3" y="3" width="18" height="18" fill="none" stroke="${O}" stroke-width="1.2"/>`,
  resources: `<rect x="2.5" y="4.5" width="13" height="11" rx="1" fill="#8fd3ff"/>
<path d="M2.5 14l3.8-4.2 3 3 2-2 4.2 4.2v.5h-13z" fill="#3fae4b"/>
<circle cx="12" cy="7.8" r="1.4" fill="#ffd84d"/>
<rect x="2.5" y="4.5" width="13" height="11" rx="1" fill="none" stroke="${O}" stroke-width="1.2"/>
<path d="M18 9.5v9" stroke="${O}" stroke-width="1.6"/>
<path d="M18 8.8l3.5 1.4v2.4L18 11.2z" fill="${O}"/>
<ellipse cx="16" cy="18.6" rx="2.5" ry="1.9" fill="#c25ce0" stroke="${O}" stroke-width="1.1"/>`,
  properties: `<path d="M4.5 2.5h10l4 4v15h-14z" fill="#f4f6fb" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M7 8.5h8M7 11.5h8M7 14.5h4" stroke="#7d8bb0" stroke-width="1.2"/>
<circle cx="17" cy="17" r="5" fill="none" stroke="${O}" stroke-width="2.8" stroke-dasharray="2 1.93"/>
<circle cx="17" cy="17" r="3.8" fill="#9aa3b5" stroke="${O}" stroke-width="1"/>
<circle cx="17" cy="17" r="1.3" fill="#f4f6fb" stroke="${O}" stroke-width="0.8"/>`,
  versions: `<circle cx="12" cy="12" r="6.6" fill="#f4f6fb" stroke="${O}" stroke-width="1.2"/>
<path d="M12 8v4.3l2.8 1.8" fill="none" stroke="${O}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M5.1 8A8 8 0 1 1 5.1 16" fill="none" stroke="${O}" stroke-width="3.4" stroke-linecap="round"/>
<path d="M5.1 8A8 8 0 1 1 5.1 16" fill="none" stroke="#3d8bfd" stroke-width="1.8" stroke-linecap="round"/>
<path d="M3.6 10.6l-.6-3.8 3.8.9z" fill="#3d8bfd" stroke="${O}" stroke-width="1" stroke-linejoin="round"/>`,
  exportMap: `<path d="M3.5 14.5v5h17v-5" fill="none" stroke="${O}" stroke-width="3.4" stroke-linejoin="round"/>
<path d="M3.5 14.5v5h17v-5" fill="none" stroke="#b9c0cf" stroke-width="1.8" stroke-linejoin="round"/>
<path d="M12 3v11m-4.5-4.5L12 14l4.5-4.5" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 3v11m-4.5-4.5L12 14l4.5-4.5" fill="none" stroke="#3fb950" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  scripts: `<path d="M12 3L22 20.5H2z" fill="#ffc83d" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M12 9v5.5" stroke="${O}" stroke-width="2.2" stroke-linecap="round"/>
<circle cx="12" cy="17.6" r="1.3" fill="${O}"/>`,
  playtest: `<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="#2f6fd6" stroke="${O}" stroke-width="1.2"/>
<rect x="3.6" y="5.6" width="16.8" height="6" rx="1.6" fill="#5a9bff"/>
<path d="M10 8.3v7.4l6.2-3.7z" fill="#fff" stroke="${O}" stroke-width="0.9" stroke-linejoin="round"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="${O}" stroke-width="4.4" stroke-linecap="round"/>
<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="#ff5a5a" stroke-width="2.6" stroke-linecap="round"/>`,
} as const;

/** Name of a toolbar icon. */
export type ToolbarIconName = keyof typeof ICONS;

/** `data:` URLs of the icons, built on first use. */
const urls = new Map<ToolbarIconName, string>();

/**
 * Creates the image of a toolbar icon (decorative: the button carries the label).
 * @param name - Icon.
 */
export function toolbarIcon(name: ToolbarIconName): HTMLImageElement {
  let url = urls.get(name);
  if (!url) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${ICONS[name]}</svg>`;
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    urls.set(name, url);
  }
  return el('img', { className: 'tb-icon', attrs: { src: url, alt: '', 'aria-hidden': 'true', draggable: 'false', width: '22', height: '22' } });
}

/**
 * @file Boss sprites, two tiles wide (frames 48 × 64), for the `Boss2`–`Boss4`
 * sheets (eight bosses each, standard 4 × 2 layout) next to the single
 * `$Boss1`. Eight designs in three colour schemes each. Rows: down, left,
 * right (mirrored left), up; columns: step A, standing, step B.
 */
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import type { PixelCanvas } from '../../shared/art/pixel.js';
import { blockFrom } from './monsters.js';
import { shadedBlob } from './objects.js';

const FW = 48;
const FH = 64;
const big = (paint: Parameters<typeof blockFrom>[0]): PixelCanvas => blockFrom(paint, FW, FH);

/** Colours of one boss variant. */
interface Scheme {
  main: Ramp;
  accent: Ramp;
  eye: string;
}

// ---------------------------------------------------------------------------
// Dragon
// ---------------------------------------------------------------------------

/** Winged dragon standing on its hind legs. */
export function dragon({ main, accent, eye }: Scheme): PixelCanvas {
  return big((s, dir, f) => {
    const step = f - 1;
    const flap = f === 1 ? -2 : 0;
    if (dir === 'left') {
      // Far wing, tail, legs, body, near wing, neck and head.
      // Far wing: a membrane spread up and back from the shoulder, scalloped between its fingers.
      for (let x = 18; x <= 46; x++) {
        const top = 18 + flap - Math.floor((x - 18) / 2);
        const bottom = 32 + flap - Math.floor((x - 18) / 4) - ((x - 18) % 7 < 3 ? 0 : 2);
        if (bottom > top) s.vline(x, top, bottom, accent[1]);
      }
      s.line(18, 18 + flap, 46, 4 + flap, accent[2]);
      for (let i = 1; i < 5; i++) s.line(18 + i * 2, 18 + flap - i, 18 + i * 7, 32 + flap - Math.floor((i * 7) / 4), accent[0]);
      s.line(30, 50, 46, 58 + step, main[1]);
      s.line(30, 51, 46, 59 + step, main[1]);
      s.fillRect(43, 56 + step, 4, 3, accent[2]);
      shadedBlob(s, 16 + step * 2, 46, 10, 16, main);
      shadedBlob(s, 24 - step * 2, 46, 10, 16, main);
      s.fillRect(14 + step * 2, 59, 12, 3, main[0]);
      s.fillRect(22 - step * 2, 59, 12, 3, main[0]);
      shadedBlob(s, 12, 24, 22, 28, main);
      s.fillRect(13, 30, 6, 18, accent[2]);
      for (let y = 32; y < 48; y += 3) s.hline(13, 18, y, accent[1]);
      s.fillRect(10, 18, 8, 12, main[2]);
      shadedBlob(s, 0, 8, 18, 13, main);
      s.fillRect(0, 15, 6, 4, main[1]);
      s.set(1, 16, OUTLINE);
      s.fillRect(5, 11, 3, 2, eye);
      s.line(12, 9, 18, 2, accent[3]);
      s.line(14, 10, 22, 5, accent[2]);
      s.fillRect(10, 36, 4, 6, main[1]); // arm
    } else {
      const back = dir === 'up';
      // Wings.
      for (const side of [-1, 1]) {
        const x0 = 24 + side * 10;
        for (let i = 0; i < 16; i++) {
          const x = x0 + side * i;
          s.vline(x, 14 + flap + Math.floor(i / 3), 34 + flap - Math.floor(i / 2), back ? accent[2] : accent[1]);
        }
        for (let i = 0; i < 3; i++) s.line(x0, 14 + flap, x0 + side * (6 + i * 5), 32 + flap - i * 2, accent[0]);
      }
      if (back) {
        s.line(24, 50, 24 + step * 4, 63, main[1]);
        s.line(25, 50, 25 + step * 4, 63, main[1]);
      }
      for (const [x, d] of [[14, step], [26, -step]] as const) {
        shadedBlob(s, x, 46 + Math.max(0, -d), 9, 15 - Math.max(0, -d), main);
        s.fillRect(x - 1, 59 + Math.max(0, d) - 1, 11, 3, main[0]);
      }
      shadedBlob(s, 11, 24, 26, 28, main);
      if (!back) {
        s.fillRect(19, 30, 10, 18, accent[2]);
        for (let y = 32; y < 48; y += 3) s.hline(19, 28, y, accent[1]);
      } else {
        for (let y = 26; y < 48; y += 5) s.set(24, y, accent[3]);
      }
      shadedBlob(s, 7, 34 + step, 7, 10, main);
      shadedBlob(s, 34, 34 - step, 7, 10, main);
      // Head and horns.
      shadedBlob(s, 14, 5, 20, 18, main);
      s.line(16, 8, 11, 0, accent[3]);
      s.line(31, 8, 36, 0, accent[2]);
      if (!back) {
        s.fillRect(18, 17, 12, 6, main[3]);
        s.fillRect(19, 11, 3, 3, eye);
        s.fillRect(27, 11, 3, 3, eye);
        s.set(21, 20, OUTLINE);
        s.set(26, 20, OUTLINE);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// King slime
// ---------------------------------------------------------------------------

/** Huge slime wearing a crown. */
export function kingSlime({ main, accent, eye }: Scheme): PixelCanvas {
  return big((s, dir, f) => {
    const squash = f === 1 ? 0 : 1;
    const w = 40 + squash * 4;
    const h = 36 - squash * 3;
    const x = 24 - w / 2;
    const y = 62 - h;
    shadedBlob(s, x, y, w, h, main);
    s.hline(x + 4, x + w - 5, 61, main[1]);
    s.fillEllipse(x + 6, y + 5, 7, 5, '#ffffff');
    s.set(x + 14, y + 4, main[3]);
    // Crown.
    const cy = y - 9;
    s.fillRect(14, cy + 4, 20, 6, accent[2]);
    s.hline(14, 33, cy + 4, accent[3]);
    for (const px of [14, 21, 28]) {
      s.fillRect(px, cy, 4, 5, accent[2]);
      s.set(px + 1, cy, accent[3]);
    }
    if (dir !== 'up') s.fillRect(22, cy + 6, 4, 3, RAMPS.flowerRed[2]);
    if (dir === 'down') {
      s.fillRect(16, y + 14, 4, 5, eye);
      s.fillRect(28, y + 14, 4, 5, eye);
      s.hline(20, 27, y + 23, main[0]);
      s.set(19, y + 22, main[0]);
      s.set(28, y + 22, main[0]);
    } else if (dir === 'left') {
      s.fillRect(x + 4, y + 14, 4, 5, eye);
      s.hline(x + 3, x + 9, y + 23, main[0]);
    }
  });
}

// ---------------------------------------------------------------------------
// Lich
// ---------------------------------------------------------------------------

/** Skeletal sorcerer king floating in tattered robes, staff in hand. */
export function lich({ main, accent, eye }: Scheme): PixelCanvas {
  const bone = RAMPS.flowerWhite;
  return big((s, dir, f) => {
    const bob = f === 1 ? -1 : 0;
    const side = dir === 'left';
    // Robe: a widening bell with a ragged hem.
    for (let y = 22 + bob; y < 60 + bob; y++) {
      const half = 8 + Math.floor((y - 22 - bob) / 3);
      const cx = side ? 26 : 24;
      s.hline(cx - half, cx + half - 1, y, main[2]);
      s.set(cx - half, y, main[3]);
      s.set(cx + half - 1, y, main[1]);
    }
    for (let x = 10; x < 40; x += 3) s.vline(x + ((x + f) % 2), 58 + bob, 61 + bob, main[1]);
    if (dir !== 'up') {
      s.vline(side ? 22 : 24, 26 + bob, 58 + bob, accent[2]);
      s.hline(side ? 18 : 18, side ? 26 : 29, 34 + bob, accent[2]);
    } else {
      s.fillRect(16, 22 + bob, 16, 12, main[1]);
    }
    // Staff with an orb.
    // Held in the right hand: on the viewer's right from the front, on the left from the back.
    const sx = side ? 8 : dir === 'up' ? 8 : 40;
    s.vline(sx, 14 + bob, 60, RAMPS.wood[1]);
    shadedBlob(s, sx - 4, 6 + bob, 9, 9, accent);
    s.set(sx - 2, 8 + bob, '#ffffff');
    // Bony hands.
    s.fillRect(sx - 2, 30 + bob, 4, 3, bone[2]);
    if (!side) s.fillRect(dir === 'up' ? 38 : 6, 34 + bob, 4, 3, bone[2]);
    // Skull under a hood.
    const hx = side ? 16 : 15;
    shadedBlob(s, hx, 6 + bob, 18, 18, main);
    if (dir !== 'up') {
      shadedBlob(s, hx + (side ? 0 : 3), 10 + bob, 12, 12, bone);
      s.fillRect(hx + (side ? 1 : 5), 14 + bob, 3, 3, OUTLINE);
      if (!side) s.fillRect(hx + 10, 14 + bob, 3, 3, OUTLINE);
      s.set(hx + (side ? 2 : 6), 15 + bob, eye);
      if (!side) s.set(hx + 11, 15 + bob, eye);
      s.hline(hx + (side ? 1 : 6), hx + (side ? 5 : 11), 20 + bob, bone[0]);
    }
    // Crown of spikes.
    for (let i = 0; i < 4; i++) s.vline(hx + 3 + i * 4, 3 + bob, 6 + bob, RAMPS.gold[2 + (i % 2)]);
  });
}

// ---------------------------------------------------------------------------
// Titan golem
// ---------------------------------------------------------------------------

/** Towering golem of stone blocks with a glowing core. */
export function titan({ main, accent, eye }: Scheme): PixelCanvas {
  return big((s, dir, f) => {
    const step = f - 1;
    if (dir === 'left') {
      shadedBlob(s, 16 + step * 3, 44, 12, 18, main);
      shadedBlob(s, 22 - step * 3, 44, 12, 18, main);
      shadedBlob(s, 12, 16, 26, 32, main);
      s.fillRect(14, 26, 6, 6, accent[2]);
      s.set(15, 27, accent[3]);
      shadedBlob(s, 10, 4, 16, 15, main);
      s.fillRect(11, 10, 4, 3, eye);
      shadedBlob(s, 16 + step * 4, 22, 12, 28, main);
      shadedBlob(s, 14 + step * 4, 46, 14, 10, main);
    } else {
      for (const [x, d] of [[11, step], [27, -step]] as const) shadedBlob(s, x, 44 + Math.max(0, d), 11, 18 - Math.max(0, d), main);
      shadedBlob(s, 8, 16, 32, 32, main);
      shadedBlob(s, 0, 18 + step, 12, 30, main);
      shadedBlob(s, 36, 18 - step, 12, 30, main);
      shadedBlob(s, 15, 4, 18, 16, main);
      if (dir === 'down') {
        s.fillRect(19, 30, 10, 8, accent[2]);
        s.fillRect(21, 32, 6, 4, accent[3]);
        s.fillRect(18, 10, 4, 3, eye);
        s.fillRect(26, 10, 4, 3, eye);
      } else {
        s.line(14, 22, 30, 40, main[0]);
        s.line(32, 20, 22, 44, main[0]);
      }
      for (const [x, y] of [[10, 26], [34, 36], [20, 44]] as const) s.set(x, y, accent[3]);
    }
  });
}

// ---------------------------------------------------------------------------
// Spider queen
// ---------------------------------------------------------------------------

/** Giant spider with a crowned head. */
export function spiderQueen({ main, accent, eye }: Scheme): PixelCanvas {
  return big((s, dir, f) => {
    const step = f - 1;
    const legs = (cx: number, cy: number, spread: number) => {
      for (let i = 0; i < 4; i++) {
        const y = cy - 6 + i * 4;
        const lift = (i + f) % 2 ? step * 2 : 0;
        s.line(cx - 4, y, cx - spread, y - 6 + lift, main[1]);
        s.line(cx - spread, y - 6 + lift, cx - spread - 3, y + 12 + lift, main[1]);
        s.line(cx + 4, y, cx + spread, y - 6 - lift, main[1]);
        s.line(cx + spread, y - 6 - lift, cx + spread + 3, y + 12 - lift, main[1]);
      }
    };
    if (dir === 'left') {
      legs(24, 46, 16);
      shadedBlob(s, 20, 30, 26, 24, main);
      s.fillRect(30, 36, 8, 8, accent[2]);
      shadedBlob(s, 6, 36, 18, 16, main);
      s.fillRect(8, 42, 3, 3, eye);
      s.fillRect(13, 42, 2, 2, eye);
      s.vline(7, 50, 54, RAMPS.plaster[2]);
      for (let i = 0; i < 3; i++) s.vline(10 + i * 4, 31, 36, RAMPS.gold[2 + (i % 2)]);
    } else {
      legs(24, 46, 20);
      shadedBlob(s, 10, 22, 28, 26, main);
      for (let y = 26; y < 44; y += 5) s.hline(18, 29, y, accent[2]);
      if (dir === 'down') {
        shadedBlob(s, 14, 38, 20, 16, main);
        for (const [x, y] of [[18, 43], [28, 43], [21, 46], [25, 46]] as const) s.fillRect(x, y, 2, 2, eye);
        s.vline(19, 52, 57, RAMPS.plaster[2]);
        s.vline(28, 52, 57, RAMPS.plaster[2]);
        for (let i = 0; i < 4; i++) s.vline(16 + i * 5, 33, 38, RAMPS.gold[2 + (i % 2)]);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Treant
// ---------------------------------------------------------------------------

/** Walking tree with a bark face and branch arms. */
export function treant({ main, accent, eye }: Scheme): PixelCanvas {
  const bark = RAMPS.wood;
  return big((s, dir, f) => {
    const step = f - 1;
    const side = dir === 'left';
    // Root legs.
    for (const [x, d] of [[14, step], [28, -step]] as const) {
      const lx = side ? x + 2 + d * 2 : x;
      s.fillRect(lx, 46, 7, 15 + (side ? 0 : d), bark[1]);
      s.line(lx, 60, lx - 3, 62, bark[1]);
      s.line(lx + 6, 60, lx + 9, 62, bark[1]);
    }
    // Trunk.
    s.fillRect(12, 24, 24, 26, bark[2]);
    s.vline(12, 24, 49, bark[3]);
    s.vline(35, 24, 49, bark[1]);
    for (const x of [17, 23, 30]) s.vline(x, 26, 48, bark[1]);
    // Branch arms.
    if (!side) {
      s.line(12, 30, 2, 22 + step, bark[2]);
      s.line(35, 30, 45, 22 - step, bark[2]);
      shadedBlob(s, 0, 14 + step, 10, 9, main);
      shadedBlob(s, 38, 14 - step, 10, 9, main);
    } else {
      s.line(16, 32, 4, 26 + step * 2, bark[2]);
      shadedBlob(s, 0, 20 + step * 2, 10, 9, main);
    }
    // Crown.
    shadedBlob(s, 6, 0, 36, 28, main);
    for (const [x, y] of [[12, 6], [26, 4], [34, 14], [18, 18]] as const) s.fillRect(x, y, 2, 2, accent[2]);
    if (dir === 'down') {
      s.fillRect(16, 31, 5, 4, OUTLINE);
      s.fillRect(27, 31, 5, 4, OUTLINE);
      s.fillRect(17, 32, 2, 2, eye);
      s.fillRect(28, 32, 2, 2, eye);
      s.fillRect(20, 40, 8, 3, OUTLINE);
    } else if (side) {
      s.fillRect(13, 31, 4, 4, OUTLINE);
      s.fillRect(14, 32, 2, 2, eye);
      s.fillRect(12, 40, 5, 3, OUTLINE);
    }
  });
}

// ---------------------------------------------------------------------------
// Minotaur
// ---------------------------------------------------------------------------

/** Bull-headed brute with a great axe. */
export function minotaur({ main, accent, eye }: Scheme): PixelCanvas {
  const horn = RAMPS.plaster;
  return big((s, dir, f) => {
    const step = f - 1;
    const side = dir === 'left';
    // Legs and hooves.
    for (const [x, d] of [[15, step], [26, -step]] as const) {
      const lx = side ? x + 2 + d * 3 : x;
      s.fillRect(lx, 44, 8, 15 + (side ? 0 : d), main[1]);
      s.fillRect(lx - 1, 58 + (side ? 0 : d), 10, 3, RAMPS.dark[2]);
    }
    // Loincloth.
    s.fillRect(14, 40, 20, 8, accent[2]);
    s.hline(14, 33, 40, accent[3]);
    // Torso.
    shadedBlob(s, 10, 18, 28, 26, main);
    if (dir !== 'up') {
      s.hline(18, 30, 28, main[1]);
      s.vline(24, 24, 38, main[1]);
    }
    // Arms and axe.
    if (!side) {
      shadedBlob(s, 3, 20 + step, 10, 20, main);
      shadedBlob(s, 35, 20 - step, 10, 20, main);
      // The axe changes side between the front and the back view.
      const ax = dir === 'up' ? 5 : 42;
      s.vline(ax, 4, 50, RAMPS.wood[1]);
      shadedBlob(s, dir === 'up' ? 0 : 34, 4, 14, 12, RAMPS.silver);
    } else {
      // Axe carried on the shoulder, its blade behind the head (the snout stays visible).
      s.line(20 + step, 40, 38, 6, RAMPS.wood[1]);
      shadedBlob(s, 33, 0, 14, 12, RAMPS.silver);
      shadedBlob(s, 18 + step * 2, 22, 10, 20, main);
    }
    // Head and horns.
    const hx = side ? 9 : 14;
    shadedBlob(s, hx, 4, 20, 18, main);
    s.line(hx + 2, 7, hx - 5, 0, horn[2]);
    s.line(hx + 2, 8, hx - 4, 1, horn[3]);
    if (!side) {
      s.line(hx + 17, 7, hx + 24, 0, horn[1]);
      s.line(hx + 17, 8, hx + 23, 1, horn[2]);
    }
    if (dir === 'down') {
      s.fillRect(hx + 5, 15, 10, 6, main[3]);
      s.set(hx + 7, 18, OUTLINE);
      s.set(hx + 12, 18, OUTLINE);
      s.fillRect(hx + 4, 10, 3, 2, eye);
      s.fillRect(hx + 13, 10, 3, 2, eye);
      s.fillRect(hx + 9, 21, 2, 2, RAMPS.gold[2]);
    } else if (side) {
      s.fillRect(hx - 2, 14, 6, 6, main[3]);
      s.fillRect(hx + 3, 10, 3, 2, eye);
    }
  });
}

// ---------------------------------------------------------------------------
// Dark knight
// ---------------------------------------------------------------------------

/** Giant armoured knight with a cape and a greatsword. */
export function giantKnight({ main, accent, eye }: Scheme): PixelCanvas {
  return big((s, dir, f) => {
    const step = f - 1;
    const side = dir === 'left';
    // Cape behind.
    if (side) {
      for (let y = 20; y < 58; y++) s.hline(26, 30 + Math.floor((y - 20) / 4), y, accent[1]);
    }
    for (const [x, d] of [[15, step], [26, -step]] as const) {
      const lx = side ? x + 1 + d * 3 : x;
      s.fillRect(lx, 42, 7, 17 + (side ? 0 : d), main[1]);
      s.vline(lx, 42, 58, main[2]);
      s.fillRect(lx - 1, 58 + (side ? 0 : d), 9, 3, main[0]);
    }
    shadedBlob(s, 12, 18, 24, 28, main);
    if (dir === 'up') {
      for (let y = 18; y < 58; y++) s.hline(10 - Math.floor((y - 18) / 8), 37 + Math.floor((y - 18) / 8), y, accent[y % 6 === 0 ? 1 : 2]);
    } else {
      s.fillRect(side ? 16 : 21, 22, 6, 20, accent[2]);
      s.vline(side ? 16 : 21, 22, 41, accent[3]);
    }
    // Pauldrons and arms.
    if (!side) {
      shadedBlob(s, 4, 16, 14, 10, main);
      shadedBlob(s, 30, 16, 14, 10, main);
      s.fillRect(6, 25, 7, 16 + step, main[1]);
      s.fillRect(35, 25, 7, 16 - step, main[1]);
    } else {
      shadedBlob(s, 14, 16, 14, 10, main);
      s.fillRect(16 + step * 2, 25, 7, 16, main[2]);
    }
    // Greatsword.
    if (dir !== 'up') {
      const gx = side ? 10 + step * 2 : 38;
      s.fillRect(gx, 6, 3, 36, RAMPS.silver[3]);
      s.vline(gx + 2, 6, 41, RAMPS.silver[1]);
      s.fillRect(gx - 3, 40, 9, 2, RAMPS.gold[2]);
      s.fillRect(gx, 42, 3, 5, RAMPS.wood[1]);
    } else {
      s.line(14, 10, 34, 40, RAMPS.silver[2]);
    }
    // Helm.
    const hx = side ? 14 : 16;
    shadedBlob(s, hx, 2, 16, 18, main);
    if (dir === 'down') {
      s.hline(hx + 3, hx + 12, 11, OUTLINE);
      s.fillRect(hx + 4, 11, 2, 1, eye);
      s.fillRect(hx + 10, 11, 2, 1, eye);
      s.vline(hx + 8, 12, 17, main[1]);
    } else if (side) {
      s.hline(hx, hx + 6, 11, OUTLINE);
      s.fillRect(hx + 1, 11, 2, 1, eye);
    }
    s.fillRect(hx + 6, 0, 4, 4, accent[2]);
    s.set(hx + 6, 0, accent[3]);
  });
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const S = (main: Ramp, accent: Ramp, eye: string): Scheme => ({ main, accent, eye });

const ICE: Ramp = RAMPS.ice;
const EMERALD: Ramp = RAMPS.roofGreen;
const BONE: Ramp = ['#6e6a78', '#a4a0b0', '#d4d0dc', '#f6f4fa'];
const MOSS: Ramp = RAMPS.grassDark;
const DEAD: Ramp = ['#3a2a22', '#56402e', '#76583c', '#98784e'];
const BULL: Ramp = RAMPS.roofBrown;
const SHADOW_STEEL: Ramp = ['#14121c', '#26222f', '#3c3648', '#5c5470'];

/** The 24 bosses of `Boss2`–`Boss4`, in sheet order (eight per sheet). */
export function bossBlocks(): PixelCanvas[] {
  return [
    // Boss2: dragons, king slimes, liches.
    dragon(S(RAMPS.roofRed, RAMPS.leavesAutumn, '#fff04a')),
    dragon(S(ICE, RAMPS.roofBlue, '#ffffff')),
    dragon(S(EMERALD, RAMPS.sulfur, '#ff5a3a')),
    kingSlime(S(RAMPS.roofBlue, RAMPS.gold, '#1b1424')),
    kingSlime(S(RAMPS.roofRed, RAMPS.gold, '#1b1424')),
    kingSlime(S(RAMPS.gold, RAMPS.silver, '#1b1424')),
    lich(S(RAMPS.cloth, RAMPS.poison, '#ff3a3a')),
    lich(S(RAMPS.swamp, RAMPS.roofGreen, '#8aff6a')),
    // Boss3: lich, titans, spider queens, treant.
    lich(S(BONE, RAMPS.glow, '#3ac0e0')),
    titan(S(RAMPS.stone, RAMPS.glow, '#b0f6ff')),
    titan(S(RAMPS.basalt, RAMPS.lava, '#ffc23a')),
    titan(S(RAMPS.ice, RAMPS.poison, '#ffffff')),
    spiderQueen(S(RAMPS.dark, RAMPS.flowerRed, '#ff3a3a')),
    spiderQueen(S(RAMPS.cloth, RAMPS.poison, '#8aff6a')),
    spiderQueen(S(RAMPS.ice, RAMPS.roofBlue, '#ffffff')),
    treant(S(RAMPS.leaves, RAMPS.flowerRed, '#fff04a')),
    // Boss4: treants, minotaurs, giant knights.
    treant(S(RAMPS.leavesAutumn, RAMPS.gold, '#ff9a1a')),
    treant(S(DEAD, MOSS, '#8aff6a')),
    minotaur(S(BULL, RAMPS.carpetRed, '#ff3a3a')),
    minotaur(S(RAMPS.basalt, RAMPS.gold, '#ffc23a')),
    minotaur(S(RAMPS.brick, RAMPS.carpetBlue, '#fff04a')),
    giantKnight(S(RAMPS.silver, RAMPS.carpetBlue, '#3ac0e0')),
    giantKnight(S(SHADOW_STEEL, RAMPS.carpetRed, '#ff3a3a')),
    giantKnight(S(RAMPS.gold, RAMPS.carpetGreen, '#ffffff')),
  ];
}

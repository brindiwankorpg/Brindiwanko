/**
 * @file More monster sprites (sheets `Monster2`, `Monster3`) and animated
 * objects (`!Objects1` free slots, `!Objects2`, `!Objects3`). Monsters use the
 * standard walking block (rows: down, left, right, up; "right" mirrors
 * "left"); objects use the rows as successive states (doors, chests, levers)
 * or repeat a 3-frame loop on every row (flames, crystals, portals).
 */
import { CHAR_FRAME_H, CHAR_FRAME_W } from '../../shared/art/character.js';
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import { PixelCanvas } from '../../shared/art/pixel.js';
import { blockFrom } from './monsters.js';
import { shadedBlob } from './objects.js';

const EYE = '#ffe040';

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

/** Floating ghost with a wavy tail; seen from the back it shows no face. */
export function ghost(ramp: Ramp = RAMPS.flowerWhite): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const bob = f === 1 ? -1 : 0;
    const top = 8 + bob;
    shadedBlob(s, 5, top, 14, 14, ramp);
    s.fillRect(5, top + 7, 14, 9, ramp[2]);
    s.vline(5, top + 7, top + 15, ramp[3]);
    s.vline(18, top + 7, top + 15, ramp[1]);
    // Wavy hem, shifting with the frame.
    for (let i = 0; i < 14; i++) {
      const wave = (i + f) % 4 < 2 ? 1 : 0;
      s.vline(5 + i, top + 16, top + 16 + wave, ramp[1]);
    }
    if (dir === 'left') {
      s.fillRect(4, top + 10, 3, 3, ramp[2]); // arm reaching forward
      s.fillRect(7, top + 5, 2, 3, OUTLINE);
      s.fillRect(7, top + 10, 2, 2, RAMPS.dark[2]);
    } else if (dir === 'down') {
      s.fillRect(2, top + 9, 3, 3, ramp[2]);
      s.fillRect(19, top + 9, 3, 3, ramp[1]);
      s.fillRect(8, top + 5, 2, 3, OUTLINE);
      s.fillRect(14, top + 5, 2, 3, OUTLINE);
      s.fillEllipse(10, top + 9, 4, 3, RAMPS.dark[2]);
    } else {
      s.fillRect(2, top + 9, 3, 3, ramp[1]);
      s.fillRect(19, top + 9, 3, 3, ramp[1]);
    }
  });
}

/** Big spider: round body, eight legs scuttling. */
export function spider(ramp: Ramp = RAMPS.dark, mark: Ramp = RAMPS.flowerRed): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const step = f - 1;
    const legs = (cx: number, cy: number, spread: number) => {
      for (let i = 0; i < 4; i++) {
        const y = cy - 3 + i * 2;
        const lift = (i + f) % 2 === 0 ? step : -step;
        s.line(cx - 2, y, cx - spread, y + 3 + lift, ramp[1]);
        s.line(cx - spread, y + 3 + lift, cx - spread - 1, y + 6 + lift, ramp[1]);
        s.line(cx + 2, y, cx + spread, y + 3 - lift, ramp[1]);
        s.line(cx + spread, y + 3 - lift, cx + spread + 1, y + 6 - lift, ramp[1]);
      }
    };
    if (dir === 'left') {
      legs(12, 22, 8);
      shadedBlob(s, 9, 15, 13, 11, ramp.map((c, i) => (i === 2 ? RAMPS.dark[3] : c)) as unknown as Ramp);
      s.fillRect(14, 18, 3, 3, mark[2]);
      shadedBlob(s, 3, 18, 8, 7, ramp);
      s.set(4, 20, mark[3]);
      s.set(5, 20, mark[3]);
      s.vline(3, 23, 25, RAMPS.plaster[2]);
    } else {
      legs(12, 22, 9);
      shadedBlob(s, 5, 13, 14, 12, ramp);
      s.fillRect(10, 15, 4, 5, mark[2]);
      s.set(10, 15, mark[3]);
      if (dir === 'down') {
        shadedBlob(s, 7, 21, 10, 7, ramp);
        for (const x of [9, 11, 13, 15]) s.set(x, 23, mark[3]);
        s.vline(10, 27, 28, RAMPS.plaster[2]);
        s.vline(14, 27, 28, RAMPS.plaster[2]);
      }
    }
  });
}

/** Snake slithering in an S; the head rises from the coils. */
export function snake(ramp: Ramp = RAMPS.roofGreen, belly: Ramp = RAMPS.sand): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const sway = f - 1;
    if (dir === 'left') {
      for (let i = 0; i < 18; i++) {
        const x = 4 + i;
        const y = 25 + Math.round(Math.sin((i + f * 2) / 2.5) * 2);
        s.fillRect(x, y, 1, 4, ramp[2]);
        s.set(x, y + 3, belly[2]);
        if (i % 3 === 0) s.set(x, y + 1, ramp[3]);
      }
      s.fillRect(3, 16, 4, 11, ramp[2]);
      s.vline(6, 17, 26, belly[2]);
      shadedBlob(s, 1, 12, 8, 6, ramp);
      s.set(3, 14, EYE);
      s.line(0, 16, 0 - sway, 18, RAMPS.flowerRed[2]);
    } else {
      // Coils seen from the front or the back.
      shadedBlob(s, 4, 22, 16, 8, ramp);
      shadedBlob(s, 6, 19, 12, 6, ramp);
      s.fillRect(10 + sway, 12, 4, 10, ramp[2]);
      if (dir === 'down') s.vline(11 + sway, 13, 21, belly[2]);
      shadedBlob(s, 8 + sway, 7, 8, 7, ramp);
      if (dir === 'down') {
        s.set(9 + sway, 9, EYE);
        s.set(14 + sway, 9, EYE);
        s.vline(12 + sway, 14, 15, RAMPS.flowerRed[2]);
      } else {
        for (let y = 13; y < 21; y += 2) s.set(11 + sway, y, ramp[3]);
      }
    }
  });
}

/** Rock golem: heavy body of boulders, glowing eyes. */
export function golem(ramp: Ramp = RAMPS.rock, glow: Ramp = RAMPS.glow): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const step = f - 1;
    if (dir === 'left') {
      shadedBlob(s, 9 + step, 23, 7, 8, ramp);
      shadedBlob(s, 12 - step, 23, 7, 8, ramp);
      shadedBlob(s, 6, 10, 14, 15, ramp);
      shadedBlob(s, 4, 4, 10, 9, ramp);
      s.set(5, 8, glow[3]);
      s.fillRect(8 + step * 2, 16, 6, 10, ramp[1]);
      s.fillRect(7 + step * 2, 24, 7, 4, ramp[2]);
    } else {
      for (const [x, d] of [[6, step], [13, -step]] as const) shadedBlob(s, x, 23 + Math.max(0, d), 6, 8 - Math.max(0, d), ramp);
      shadedBlob(s, 4, 10, 16, 15, ramp);
      shadedBlob(s, 0, 11 + step, 6, 13, ramp);
      shadedBlob(s, 18, 11 - step, 6, 13, ramp);
      shadedBlob(s, 7, 3, 10, 9, ramp);
      if (dir === 'down') {
        s.fillRect(9, 7, 2, 2, glow[3]);
        s.fillRect(13, 7, 2, 2, glow[3]);
        s.fillRect(11, 15, 2, 3, glow[2]);
      } else {
        s.line(8, 14, 15, 20, ramp[0]);
        s.set(12, 12, glow[1]);
      }
    }
  });
}

/** Fire wisp: a floating flame spirit with a face. */
export function wisp(fire: Ramp = RAMPS.fire): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const flick = f - 1;
    const cy = 15 + (f === 1 ? -1 : 0);
    s.fillEllipse(5, cy - 2, 14, 13, fire[1]);
    s.fillEllipse(7 + flick, cy - 8, 10, 12, fire[1]);
    s.fillEllipse(8 + flick, cy - 9, 6, 8, fire[2]);
    s.fillEllipse(7, cy, 10, 9, fire[2]);
    s.fillEllipse(9, cy + 2, 6, 5, fire[3]);
    s.set(12 + flick * 2, cy - 11, fire[2]);
    if (dir === 'down') {
      s.fillRect(9, cy + 2, 2, 2, OUTLINE);
      s.fillRect(13, cy + 2, 2, 2, OUTLINE);
    } else if (dir === 'left') {
      s.fillRect(7, cy + 2, 2, 2, OUTLINE);
    }
    // Sparks.
    s.set(4 + f * 3, cy + 11, fire[3]);
    s.set(19 - f * 2, cy + 9, fire[2]);
  });
}

/** Crab walking sideways, claws raised. */
export function crab(ramp: Ramp = RAMPS.roofRed): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const step = f - 1;
    const side = dir === 'left';
    const bw = side ? 12 : 16;
    const bx = 12 - bw / 2;
    for (let i = 0; i < 3; i++) {
      const lift = (i + f) % 2 ? step : 0;
      s.line(bx + 2, 22 + i, bx - 2, 26 + i + lift, ramp[1]);
      s.line(bx + bw - 3, 22 + i, bx + bw + 1, 26 + i - lift, ramp[1]);
    }
    shadedBlob(s, bx, 17, bw, 10, ramp);
    // Claws.
    const clawUp = f === 1 ? -1 : 0;
    if (!side || true) {
      shadedBlob(s, side ? 1 : 0, 11 + clawUp, 7, 6, ramp);
      if (!side) shadedBlob(s, 17, 11 + clawUp, 7, 6, ramp);
      s.set(side ? 3 : 2, 11 + clawUp, OUTLINE);
      if (!side) s.set(21, 11 + clawUp, OUTLINE);
    }
    if (dir !== 'up') {
      // Eyes on stalks.
      const ex = side ? [bx + 1] : [9, 14];
      for (const x of ex) {
        s.vline(x, 14, 17, ramp[1]);
        s.fillRect(x - 1, 12, 2, 2, '#ffffff');
        s.set(x, 13, OUTLINE);
      }
    }
  });
}

/** Floating eye with a tail of tentacles. */
export function floatingEye(ramp: Ramp = RAMPS.coral): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const bob = f === 1 ? -1 : 0;
    const cy = 10 + bob;
    for (let i = 0; i < 4; i++) {
      const x = 8 + i * 3;
      const wave = (i + f) % 2;
      s.line(x, cy + 11, x - 1 + wave * 2, cy + 18, ramp[1]);
    }
    shadedBlob(s, 4, cy, 16, 14, ramp);
    if (dir === 'down') {
      s.fillEllipse(7, cy + 3, 10, 8, '#ffffff');
      s.fillEllipse(10, cy + 5, 5, 5, RAMPS.roofGreen[2]);
      s.fillRect(12, cy + 6, 2, 3, OUTLINE);
    } else if (dir === 'left') {
      s.fillEllipse(4, cy + 3, 7, 8, '#ffffff');
      s.fillEllipse(4, cy + 5, 4, 5, RAMPS.roofGreen[2]);
      s.fillRect(4, cy + 6, 2, 3, OUTLINE);
    } else {
      for (let y = cy + 3; y < cy + 12; y += 3) s.hline(8, 15, y, ramp[1]);
    }
  });
}

/** Walking man-eater plant: a toothy bulb on a leafy stalk. */
export function maneater(ramp: Ramp = RAMPS.jungle, bulb: Ramp = RAMPS.flowerRed): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const step = f - 1;
    // Root feet.
    s.line(10, 24, 6 + step, 29, ramp[1]);
    s.line(14, 24, 18 - step, 29, ramp[1]);
    s.fillRect(10, 14, 4, 12, ramp[2]);
    s.vline(10, 14, 25, ramp[3]);
    // Leaves.
    shadedBlob(s, 1, 17 + step, 9, 5, ramp);
    shadedBlob(s, 14, 17 - step, 9, 5, ramp);
    // Bulb.
    const side = dir === 'left';
    const bx = side ? 2 : 4;
    shadedBlob(s, bx, 3, 16, 13, bulb);
    for (let i = 0; i < 4; i++) s.set(bx + 3 + i * 3, 5 + (i % 2), '#ffffff');
    if (dir !== 'up') {
      const open = f === 1 ? 1 : 2;
      s.fillRect(side ? bx : bx + 3, 10, side ? 8 : 10, open + 1, RAMPS.dark[1]);
      for (let x = side ? bx + 1 : bx + 4; x < (side ? bx + 8 : bx + 13); x += 2) s.set(x, 10, '#ffffff');
    } else {
      s.vline(12, 4, 14, bulb[1]);
    }
  });
}

/** Little horned imp with bat wings and a pitchfork tail. */
export function imp(ramp: Ramp = RAMPS.roofRed): PixelCanvas {
  return blockFrom((s, dir, f) => {
    const step = f - 1;
    const flap = f === 1 ? 0 : 1;
    // Wings behind the body.
    if (dir !== 'left') {
      s.fillRect(1, 12 - flap, 6, 5, RAMPS.dark[3]);
      s.fillRect(17, 12 - flap, 6, 5, RAMPS.dark[3]);
      s.line(1, 17 - flap, 6, 14, RAMPS.dark[2]);
      s.line(22, 17 - flap, 17, 14, RAMPS.dark[2]);
    } else {
      s.fillRect(13, 11 - flap, 7, 6, RAMPS.dark[3]);
    }
    // Legs.
    s.fillRect(8 + (dir === 'left' ? step : 0), 24, 3, 5 + (dir === 'left' ? 0 : step), ramp[1]);
    s.fillRect(13 - (dir === 'left' ? step : 0), 24, 3, 5 - (dir === 'left' ? 0 : step), ramp[1]);
    shadedBlob(s, 7, 15, 10, 11, ramp);
    // Head and horns.
    shadedBlob(s, 6, 5, 12, 11, ramp);
    s.line(7, 6, 5, 2, RAMPS.plaster[2]);
    s.line(16, 6, 18, 2, RAMPS.plaster[1]);
    if (dir === 'down') {
      s.fillRect(8, 9, 2, 2, EYE);
      s.fillRect(14, 9, 2, 2, EYE);
      s.hline(10, 13, 13, ramp[0]);
      s.set(10, 14, '#ffffff');
      s.set(13, 14, '#ffffff');
    } else if (dir === 'left') {
      s.fillRect(7, 9, 2, 2, EYE);
      s.set(6, 13, ramp[0]);
    }
    // Tail with a spade tip.
    const tx = dir === 'left' ? 18 : 12;
    if (dir !== 'down') {
      s.line(tx, 24, tx + 3, 28 - step, ramp[1]);
      s.fillRect(tx + 3, 27 - step, 3, 2, ramp[0]);
    }
  });
}

// ---------------------------------------------------------------------------
// Animated objects
// ---------------------------------------------------------------------------

/** A block whose four rows are the given states, each repeated on the three columns. */
function statesBlock(paint: (s: PixelCanvas, state: number) => void, outline = true): PixelCanvas {
  const block = new PixelCanvas(CHAR_FRAME_W * 3, CHAR_FRAME_H * 4);
  const states = [0, 1, 2, 3].map((row) => {
    const s = new PixelCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
    paint(s, row);
    return s;
  });
  // Room for the outline above a shape touching the top edge (the states move down together).
  if (outline) PixelCanvas.makeRoomAbove(states);
  states.forEach((s, row) => {
    if (outline) s.outline(OUTLINE);
    for (let f = 0; f < 3; f++) block.blit(s, f * CHAR_FRAME_W, row * CHAR_FRAME_H);
  });
  return block;
}

/** A block whose three columns are animation frames, repeated on every row. */
function loopBlock(paint: (s: PixelCanvas, frame: number) => void, outline = true): PixelCanvas {
  const block = new PixelCanvas(CHAR_FRAME_W * 3, CHAR_FRAME_H * 4);
  const loop = [0, 1, 2].map((f) => {
    const s = new PixelCanvas(CHAR_FRAME_W, CHAR_FRAME_H);
    paint(s, f);
    return s;
  });
  if (outline) PixelCanvas.makeRoomAbove(loop);
  loop.forEach((s, f) => {
    if (outline) s.outline(OUTLINE);
    for (let row = 0; row < 4; row++) block.blit(s, f * CHAR_FRAME_W, row * CHAR_FRAME_H);
  });
  return block;
}

/** Door opening (rows: closed → open), one tile wide, standing on its tile. */
export function doorAnimation(ramp: Ramp = RAMPS.wood, metal = false): PixelCanvas {
  return statesBlock((s, state) => {
    // Frame of the doorway.
    s.fillRect(3, 8, 18, 22, RAMPS.dark[0]);
    const w = 16 - state * 5;
    if (w > 0) {
      s.fillRect(4, 9, w, 21, ramp[2]);
      s.vline(4, 9, 29, ramp[3]);
      s.vline(3 + w, 9, 29, ramp[1]);
      if (metal) for (let y = 12; y < 29; y += 5) s.hline(4, 3 + w, y, ramp[1]);
      else for (let x = 8; x < 4 + w; x += 4) s.vline(x, 9, 29, ramp[1]);
      if (state === 0) s.fillRect(16, 19, 2, 2, RAMPS.gold[3]);
    }
    s.hline(2, 21, 8, RAMPS.stone[3]);
    s.vline(2, 8, 29, RAMPS.stone[2]);
    s.vline(21, 8, 29, RAMPS.stone[1]);
  });
}

/** Floor lever (rows: left, middle, right, right with a glow). */
export function leverAnimation(): PixelCanvas {
  return statesBlock((s, state) => {
    s.fillRect(6, 24, 12, 5, RAMPS.stone[2]);
    s.hline(6, 17, 24, RAMPS.stone[3]);
    const angle = [-1, 0, 1, 1][state]!;
    s.line(12, 24, 12 + angle * 6, 13, RAMPS.wood[2]);
    s.fillEllipse(10 + angle * 6, 10, 5, 5, state === 3 ? RAMPS.roofGreen[3] : RAMPS.roofRed[2]);
  });
}

/** Breakable pot or crate (rows: intact, cracked, broken, shards). */
export function breakableAnimation(kind: 'pot' | 'crate'): PixelCanvas {
  return statesBlock((s, state) => {
    const r = kind === 'pot' ? RAMPS.brick : RAMPS.woodLight;
    if (state < 2) {
      if (kind === 'pot') {
        shadedBlob(s, 5, 15, 14, 14, r);
        s.fillRect(8, 12, 8, 4, r[2]);
        s.hline(7, 16, 12, r[3]);
      } else {
        s.fillRect(4, 14, 16, 15, r[2]);
        s.strokeRect(5, 15, 14, 13, r[0]);
        s.line(5, 15, 18, 27, r[1]);
      }
      if (state === 1) {
        s.line(9, 16, 12, 22, OUTLINE);
        s.line(12, 22, 10, 27, OUTLINE);
      }
    } else {
      const pieces = state === 2 ? [[4, 24, 6, 5], [12, 22, 7, 7], [8, 18, 5, 5]] : [[2, 26, 5, 3], [10, 27, 4, 2], [16, 25, 5, 4]];
      for (const [x, y, w, h] of pieces) {
        s.fillRect(x!, y!, w!, h!, r[2]);
        s.hline(x!, x! + w! - 1, y!, r[3]);
      }
    }
  });
}

/** Glowing crystal pulsing on its base. */
export function crystalAnimation(ramp: Ramp = RAMPS.glow): PixelCanvas {
  return loopBlock((s, f) => {
    s.fillRect(5, 26, 14, 4, RAMPS.stone[2]);
    for (let j = 0; j < 18; j++) {
      const half = Math.min(4, Math.floor(j / 2));
      s.hline(12 - half, 11 + half, 8 + j, j < 6 ? ramp[3] : ramp[2]);
      s.set(11 + half, 8 + j, ramp[1]);
    }
    shadedBlob(s, 4, 18, 6, 9, ramp);
    shadedBlob(s, 15, 19, 5, 8, ramp);
    const spark = [[7, 10], [17, 14], [12, 5]][f]!;
    s.set(spark[0]!, spark[1]!, '#ffffff');
  }, false);
}

/** Save point: a ring of light with rising sparkles. */
export function savePointAnimation(ramp: Ramp = RAMPS.glow): PixelCanvas {
  return loopBlock((s, f) => {
    s.fillEllipse(3, 24, 18, 6, ramp[1]);
    s.fillEllipse(5, 25, 14, 4, ramp[3]);
    for (let i = 0; i < 4; i++) {
      const y = 22 - ((i * 5 + f * 3) % 18);
      const x = 5 + i * 4;
      s.set(x, y, ramp[3]);
      s.set(x, y - 1, '#ffffff');
    }
  }, false);
}

/** Camp fire with dancing flames. */
export function campfireAnimation(): PixelCanvas {
  return loopBlock((s, f) => {
    for (const [x, y] of [[3, 25], [8, 27], [14, 27], [18, 25]] as const) s.fillEllipse(x, y, 4, 4, RAMPS.stone[2]);
    s.line(5, 27, 18, 23, RAMPS.wood[1]);
    s.line(5, 23, 18, 27, RAMPS.wood[2]);
    const lean = f - 1;
    s.fillEllipse(6, 12, 12, 14, RAMPS.fire[1]);
    s.fillEllipse(8 + lean, 9 + (f % 2), 8, 12, RAMPS.fire[2]);
    s.fillEllipse(10 + lean, 16, 4, 7, RAMPS.fire[3]);
  }, false);
}

/** Spinning coin. */
export function coinAnimation(): PixelCanvas {
  return loopBlock((s, f) => {
    const w = [10, 6, 2][f]!;
    s.fillEllipse(12 - w / 2, 16, w, 10, RAMPS.gold[2]);
    if (w > 2) s.fillEllipse(12 - w / 2 + 1, 17, Math.max(1, w - 4), 8, RAMPS.gold[3]);
    s.vline(12, 17, 24, RAMPS.gold[1]);
  });
}

/** Swirling magic portal. */
export function portalAnimation(ramp: Ramp = RAMPS.poison): PixelCanvas {
  return loopBlock((s, f) => {
    s.fillEllipse(2, 4, 20, 26, ramp[0]);
    s.fillEllipse(4, 6, 16, 22, ramp[1]);
    for (let a = 0; a < 3; a++) {
      for (let t = 0; t < 30; t++) {
        const ang = t / 5 + a * 2.1 + f * 0.7;
        const r = t / 4;
        s.set(Math.round(12 + Math.cos(ang) * r), Math.round(17 + Math.sin(ang) * r * 1.3), t % 3 ? ramp[2] : ramp[3]);
      }
    }
  });
}

/** Bubbling cauldron. */
export function cauldronAnimation(brew: Ramp = RAMPS.roofGreen): PixelCanvas {
  return loopBlock((s, f) => {
    s.fillEllipse(3, 16, 18, 13, RAMPS.iron[1]);
    s.fillEllipse(4, 17, 10, 8, RAMPS.iron[2]);
    s.fillEllipse(3, 14, 18, 5, RAMPS.iron[3]);
    s.fillEllipse(5, 15, 14, 3, brew[2]);
    for (const [x, y] of [[7, 12], [12, 10], [16, 13]] as const) {
      const yy = y - ((f + x) % 3) * 2;
      s.fillEllipse(x, yy, 3, 3, brew[3]);
    }
    s.fillRect(5, 28, 2, 2, RAMPS.iron[0]);
    s.fillRect(17, 28, 2, 2, RAMPS.iron[0]);
  });
}

/** Sparkling gem pickup. */
export function gemAnimation(ramp: Ramp = RAMPS.flowerBlue): PixelCanvas {
  return loopBlock((s, f) => {
    s.fillEllipse(6, 26, 12, 3, RAMPS.dark[0]);
    for (let j = 0; j < 10; j++) {
      const half = j < 3 ? 3 + j : 5 - Math.floor((j - 3) * 0.8);
      s.hline(12 - half, 11 + half, 14 + j, j < 3 ? ramp[3] : ramp[2]);
      s.set(11 + half, 14 + j, ramp[1]);
    }
    const spark = [[7, 13], [16, 15], [12, 11]][f]!;
    s.set(spark[0]!, spark[1]!, '#ffffff');
    s.set(spark[0]! - 1, spark[1]!, RAMPS.gold[3]);
    s.set(spark[0]! + 1, spark[1]!, RAMPS.gold[3]);
  });
}

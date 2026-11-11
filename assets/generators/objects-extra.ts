/**
 * @file Extra props appended to the existing tileset sheets (right half of the
 * B and C sheets): farm and village life, more furniture, dungeon traps and
 * treasure, camp gear, beach and volcano pieces. Same conventions as
 * `objects.ts`: drawn on a scratch canvas, outlined, light from the top-left.
 */
import { OUTLINE, RAMPS, type Ramp } from '../../shared/art/palette.js';
import { Rng, seedFrom } from '../../shared/art/pixel.js';
import { foliage, groundShadow, layers, shadedBlob, sprite, type Draw } from './objects.js';

const W = RAMPS.wood;
const WL = RAMPS.woodLight;
const ST = RAMPS.stone;
const IR = RAMPS.iron;
const GO = RAMPS.gold;

// ---------------------------------------------------------------------------
// Nature and farm
// ---------------------------------------------------------------------------

/** Broadleaf tree carrying fruit, 2 × 2 tiles. */
export function fruitTree(fruit: Ramp = RAMPS.flowerRed, seed = 'fruit-tree'): Draw {
  const rng = new Rng(seedFrom(seed));
  return layers(
    groundShadow(16, 29, 18, 5),
    sprite(32, 32, (s) => {
      s.fillRect(13, 20, 6, 10, W[2]);
      s.vline(13, 20, 29, W[3]);
      s.vline(18, 20, 29, W[1]);
      foliage(s, 2, 1, 28, 22, RAMPS.leaves, seed);
      for (let i = 0; i < 9; i++) {
        const x = rng.int(5, 25);
        const y = rng.int(4, 18);
        s.fillRect(x, y, 2, 2, fruit[2]);
        s.set(x, y, fruit[3]);
      }
    }),
  );
}

/** Conifer under snow, 1 × 2 tiles. */
export function snowyPine(): Draw {
  const g = RAMPS.grassDark;
  const sn = RAMPS.snow;
  return layers(
    groundShadow(8, 29, 12, 4),
    sprite(16, 32, (s) => {
      s.fillRect(7, 24, 3, 6, W[1]);
      for (let tier = 0; tier < 3; tier++) {
        const top = 1 + tier * 7;
        for (let j = 0; j < 10; j++) {
          // At most 6: the widest tier stays one pixel from each edge, where its contour is drawn.
          const half = Math.min(6, Math.floor(((j + 1) * (5 + tier)) / 10));
          for (let i = -half; i <= half; i++) {
            const snowy = j < 3 || (j === 3 && i < 0);
            s.set(8 + i, top + j, j === 9 ? g[0] : snowy ? (i < 0 ? sn[3] : sn[2]) : i > half / 2 ? g[1] : g[2]);
          }
        }
      }
    }),
  );
}

/** Bare winter tree, 1 × 2 tiles. */
export function bareTree(ramp: Ramp = W): Draw {
  return layers(
    groundShadow(8, 30, 12, 4),
    sprite(16, 32, (s) => {
      s.fillRect(6, 14, 4, 17, ramp[2]);
      s.vline(6, 14, 30, ramp[3]);
      s.vline(9, 14, 30, ramp[1]);
      s.line(7, 16, 2, 8, ramp[2]);
      s.line(8, 14, 8, 2, ramp[2]);
      s.line(9, 15, 14, 6, ramp[2]);
      s.line(3, 10, 1, 6, ramp[1]);
      s.line(12, 9, 14, 3, ramp[1]);
      s.line(8, 6, 11, 3, ramp[1]);
      s.line(7, 21, 3, 18, ramp[1]);
    }),
  );
}

/** Bush with blossoms. */
export function floweringBush(petals: Ramp = RAMPS.coral, seed = 'flower-bush'): Draw {
  const rng = new Rng(seedFrom(seed));
  return layers(
    groundShadow(8, 14, 14, 4),
    sprite(16, 16, (s) => {
      foliage(s, 1, 3, 14, 11, RAMPS.leaves, seed);
      for (let i = 0; i < 6; i++) {
        const x = rng.int(3, 11);
        const y = rng.int(4, 11);
        s.set(x, y, petals[2]);
        s.set(x + 1, y, petals[3]);
        s.set(x, y + 1, petals[1]);
      }
    }),
  );
}

/** Square trimmed hedge block. */
export function hedge(): Draw {
  const g = RAMPS.grassDark;
  return layers(
    groundShadow(8, 15, 16, 3),
    sprite(16, 16, (s) => {
      s.fillRoundRect(0, 2, 16, 13, 2, g[2]);
      s.hline(1, 14, 2, g[3]);
      s.hline(1, 14, 3, g[3]);
      s.hline(1, 14, 14, g[0]);
      const rng = new Rng(seedFrom('hedge'));
      for (let i = 0; i < 14; i++) s.set(rng.int(1, 14), rng.int(4, 12), rng.chance(0.5) ? g[1] : g[3]);
    }),
  );
}

/** Pumpkin. */
export function pumpkin(): Draw {
  const p = RAMPS.leavesAutumn;
  return layers(
    groundShadow(8, 14, 14, 3),
    sprite(16, 16, (s) => {
      shadedBlob(s, 2, 5, 12, 9, p);
      s.vline(5, 6, 12, p[1]);
      s.vline(10, 6, 12, p[1]);
      s.fillRect(7, 3, 2, 3, RAMPS.leaves[1]);
      s.set(9, 3, RAMPS.leaves[2]);
    }),
  );
}

/** Row of cabbages or crops (walkable, hides the feet). */
export function crops(ramp: Ramp = RAMPS.leaves): Draw {
  return sprite(16, 16, (s) => {
    for (const [cx, cy] of [[4, 4], [11, 4], [4, 11], [11, 11]] as const) {
      s.fillEllipse(cx - 3, cy - 2, 7, 5, ramp[1]);
      s.fillEllipse(cx - 2, cy - 2, 5, 4, ramp[2]);
      s.set(cx - 1, cy - 1, ramp[3]);
    }
  });
}

/** Wheat sheaves (walkable, bush). */
export function wheat(): Draw {
  const t = RAMPS.thatch;
  return sprite(16, 16, (s) => {
    for (let x = 1; x < 16; x += 3) {
      s.vline(x, 5, 15, t[1]);
      s.fillRect(x - 1, 2 + (x % 2), 2, 4, t[2]);
      s.set(x - 1, 2 + (x % 2), t[3]);
    }
  }, null);
}

/** Scarecrow, 1 × 2 tiles. */
export function scarecrow(): Draw {
  return layers(
    groundShadow(8, 30, 8, 3),
    sprite(16, 32, (s) => {
      s.fillRect(7, 12, 2, 19, W[1]);
      s.fillRect(1, 13, 14, 2, W[2]);
      s.fillRect(4, 12, 8, 9, RAMPS.roofBlue[2]);
      s.vline(4, 12, 20, RAMPS.roofBlue[3]);
      s.fillRect(6, 15, 3, 3, RAMPS.roofRed[2]);
      for (const x of [1, 14]) s.fillRect(x, 15, 1, 3, RAMPS.thatch[2]);
      s.fillEllipse(4, 4, 8, 8, RAMPS.sand[2]);
      s.set(6, 7, OUTLINE);
      s.set(9, 7, OUTLINE);
      s.hline(6, 9, 9, RAMPS.sand[0]);
      s.fillRect(2, 3, 12, 2, RAMPS.thatch[1]);
      s.fillRect(5, 0, 6, 4, RAMPS.thatch[2]);
      s.hline(5, 10, 0, RAMPS.thatch[3]);
    }),
  );
}

/** Beehive on a stand. */
export function beehive(): Draw {
  const t = RAMPS.thatch;
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.fillRect(4, 12, 2, 3, W[1]);
      s.fillRect(10, 12, 2, 3, W[1]);
      s.fillRect(2, 11, 12, 2, W[2]);
      for (let j = 0; j < 4; j++) s.fillEllipse(4 - (j % 2), 1 + Math.floor(j * 2.5), 8 + (j % 2) * 2, 4, j % 2 ? t[1] : t[2]);
      s.set(7, 9, OUTLINE);
      s.set(8, 9, OUTLINE);
      s.set(12, 3, RAMPS.flowerYellow[2]);
      s.set(13, 5, RAMPS.flowerYellow[2]);
    }),
  );
}

/** Stepping stones (walkable). */
export function steppingStones(ramp: Ramp = ST): Draw {
  return sprite(16, 16, (s) => {
    for (const [x, y, w, h] of [[1, 2, 6, 4], [9, 6, 6, 4], [3, 11, 6, 4]] as const) {
      s.fillEllipse(x, y, w, h, ramp[2]);
      s.hline(x + 1, x + w - 2, y, ramp[3]);
    }
  }, ramp[0]);
}

/** Water puddle (walkable). */
export function puddle(ramp: Ramp = RAMPS.water): Draw {
  return sprite(16, 16, (s) => {
    s.fillEllipse(1, 5, 14, 8, ramp[1]);
    s.fillEllipse(3, 6, 10, 5, ramp[2]);
    s.hline(4, 7, 7, ramp[3]);
    s.set(10, 9, ramp[3]);
  }, null);
}

/** Reeds / cattails (walkable, hides the feet). */
export function reeds(): Draw {
  const g = RAMPS.swamp;
  return sprite(16, 16, (s) => {
    for (const x of [2, 5, 8, 11, 13]) {
      s.vline(x, 4 + (x % 3), 15, g[2]);
      s.vline(x + 1, 7, 15, g[1]);
    }
    for (const x of [5, 11]) s.fillRect(x, 2, 2, 4, W[1]);
  }, null);
}

/** Low dry-stone wall. */
export function stoneWall(ramp: Ramp = ST): Draw {
  return layers(
    groundShadow(8, 15, 16, 2),
    sprite(16, 16, (s) => {
      s.fillRect(0, 5, 16, 10, ramp[2]);
      s.hline(0, 15, 5, ramp[3]);
      for (const [x, y] of [[0, 8], [5, 8], [10, 8], [3, 11], [8, 11], [13, 11]] as const) s.strokeRect(x, y, 5, 3, ramp[1]);
      s.hline(0, 15, 14, ramp[0]);
    }),
  );
}

/** Wooden railing along the bottom edge (blocks only that edge). */
export function railing(dir: 'h' | 'v' = 'h'): Draw {
  return sprite(16, 16, (s) => {
    if (dir === 'h') {
      s.fillRect(0, 9, 16, 2, WL[2]);
      s.hline(0, 15, 9, WL[3]);
      s.fillRect(1, 9, 2, 6, W[1]);
      s.fillRect(13, 9, 2, 6, W[1]);
      s.fillRect(7, 9, 2, 6, W[1]);
    } else {
      s.fillRect(1, 0, 2, 16, WL[2]);
      s.vline(1, 0, 15, WL[3]);
      s.fillRect(1, 2, 3, 2, W[1]);
      s.fillRect(1, 12, 3, 2, W[1]);
    }
  });
}

/** Wooden mailbox on a post. */
export function mailbox(): Draw {
  return layers(
    groundShadow(8, 15, 8, 2),
    sprite(16, 16, (s) => {
      s.fillRect(7, 8, 2, 7, W[1]);
      s.fillRoundRect(3, 2, 10, 7, 2, RAMPS.roofRed[2]);
      s.hline(4, 11, 2, RAMPS.roofRed[3]);
      s.fillRect(4, 5, 3, 3, RAMPS.roofRed[0]);
      s.fillRect(12, 1, 1, 4, GO[2]);
    }),
  );
}

/** Wooden hand cart, 2 × 1 tiles. */
export function cart(load: Ramp = RAMPS.thatch): Draw {
  return layers(
    groundShadow(16, 15, 28, 3),
    sprite(32, 16, (s) => {
      s.fillRect(3, 6, 20, 5, W[2]);
      s.hline(3, 22, 6, W[3]);
      s.hline(3, 22, 10, W[0]);
      shadedBlob(s, 5, 1, 16, 7, load);
      s.line(23, 9, 31, 12, W[1]);
      s.fillEllipse(6, 8, 7, 7, W[1]);
      s.fillEllipse(8, 10, 3, 3, W[3]);
      s.fillEllipse(16, 8, 7, 7, W[1]);
      s.fillEllipse(18, 10, 3, 3, W[3]);
    }),
  );
}

/** Garden fountain, 2 × 2 tiles. */
export function fountain(): Draw {
  const wa = RAMPS.water;
  return layers(
    groundShadow(16, 29, 30, 5),
    sprite(32, 32, (s) => {
      s.fillEllipse(1, 15, 30, 15, ST[1]);
      s.fillEllipse(1, 14, 30, 13, ST[3]);
      s.fillEllipse(4, 16, 24, 9, wa[2]);
      s.hline(8, 14, 18, wa[3]);
      s.fillRect(14, 6, 4, 12, ST[2]);
      s.vline(14, 6, 17, ST[3]);
      s.fillEllipse(9, 4, 14, 5, ST[3]);
      s.fillEllipse(11, 5, 10, 3, wa[2]);
      s.vline(16, 0, 4, wa[3]);
      for (const x of [8, 23]) s.line(x < 16 ? 11 : 20, 6, x, 16, wa[3]);
      s.hline(1, 30, 26, ST[1]);
    }),
  );
}

/** Market stall with an awning and goods, 2 × 2 tiles. */
export function marketStall(stripe: Ramp = RAMPS.roofGreen, goods: Ramp = RAMPS.flowerRed): Draw {
  return layers(
    groundShadow(16, 30, 30, 4),
    sprite(32, 32, (s) => {
      s.fillRect(2, 8, 2, 22, W[1]);
      s.fillRect(28, 8, 2, 22, W[1]);
      for (let x = 0; x < 32; x++) s.vline(x, 1, 8, Math.floor(x / 4) % 2 ? stripe[2] : RAMPS.flowerWhite[2]);
      s.hline(0, 31, 1, stripe[3]);
      for (let x = 0; x < 32; x += 4) s.fillRect(x, 9, 2, 1, stripe[1]);
      s.fillRect(1, 19, 30, 9, WL[2]);
      s.hline(1, 30, 19, WL[3]);
      s.hline(1, 30, 27, WL[0]);
      for (let x = 4; x < 28; x += 5) {
        s.fillEllipse(x, 15, 5, 5, goods[2]);
        s.set(x + 1, 16, goods[3]);
      }
    }),
  );
}

/** Wooden torch post. */
export function torchPost(): Draw {
  return layers(
    groundShadow(8, 15, 6, 2),
    sprite(16, 16, (s) => {
      s.fillRect(7, 6, 2, 9, W[1]);
      s.fillRect(6, 5, 4, 2, IR[2]);
      s.fillEllipse(5, 0, 6, 6, RAMPS.fire[1]);
      s.fillEllipse(6, 1, 4, 4, RAMPS.fire[2]);
      s.set(8, 2, RAMPS.fire[3]);
    }),
  );
}

/** Notice board, 2 × 1 tiles. */
export function noticeBoard(): Draw {
  return layers(
    groundShadow(16, 15, 26, 3),
    sprite(32, 16, (s) => {
      s.fillRect(4, 8, 2, 8, W[1]);
      s.fillRect(26, 8, 2, 8, W[1]);
      s.fillRect(1, 1, 30, 10, W[2]);
      s.strokeRect(1, 1, 30, 10, W[0]);
      s.hline(2, 29, 2, W[3]);
      for (const [x, y, c] of [[4, 3, RAMPS.plaster[3]], [11, 4, RAMPS.plaster[2]], [18, 3, RAMPS.flowerYellow[3]], [24, 4, RAMPS.plaster[3]]] as const) {
        s.fillRect(x, y, 5, 6, c);
        s.hline(x + 1, x + 3, y + 2, RAMPS.stone[1]);
        s.set(x + 2, y, RAMPS.roofRed[2]);
      }
    }),
  );
}

/** Doghouse. */
export function doghouse(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(2, 7, 12, 8, WL[2]);
      for (let j = 0; j < 6; j++) s.hline(7 - j - 1, 8 + j, 2 + j, RAMPS.roofRed[j < 2 ? 3 : 2]);
      s.fillRoundRect(6, 10, 4, 5, 1, OUTLINE);
    }),
  );
}

/** Clothesline with laundry, 2 × 1 tiles (drawn above characters). */
export function clothesline(): Draw {
  return sprite(32, 16, (s) => {
    s.fillRect(0, 2, 2, 14, W[1]);
    s.fillRect(30, 2, 2, 14, W[1]);
    s.line(1, 3, 30, 3, RAMPS.plaster[2]);
    for (const [x, c] of [[5, RAMPS.roofBlue], [12, RAMPS.flowerWhite], [20, RAMPS.roofRed]] as const) {
      s.fillRect(x, 4, 6, 7, c[2]);
      s.vline(x, 4, 10, c[3]);
      s.hline(x, x + 5, 10, c[1]);
    }
  });
}

/** Climbing ivy on a wall (above characters). */
export function ivy(): Draw {
  return sprite(16, 16, (s) => {
    const rng = new Rng(seedFrom('ivy'));
    for (let i = 0; i < 4; i++) s.line(2 + i * 4, 0, 1 + i * 4 + rng.int(-1, 2), 15, RAMPS.leaves[1]);
    for (let i = 0; i < 22; i++) {
      const x = rng.int(0, 15);
      const y = rng.int(0, 15);
      s.set(x, y, RAMPS.leaves[2]);
      s.set(x + 1, y, RAMPS.leaves[3]);
    }
  }, null);
}

/** Wall lantern (above characters). */
export function wallLantern(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(7, 1, 2, 3, IR[1]);
    s.fillRect(5, 4, 6, 8, IR[1]);
    s.fillRect(6, 5, 4, 6, RAMPS.fire[3]);
    s.vline(8, 5, 10, RAMPS.fire[2]);
    s.hline(4, 11, 4, IR[2]);
    s.hline(5, 10, 12, IR[0]);
  });
}

/** Wooden ladder (climbable). */
export function ladder(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(3, 0, 2, 16, W[2]);
    s.fillRect(11, 0, 2, 16, W[2]);
    for (let y = 2; y < 16; y += 4) s.hline(4, 11, y, WL[2]);
  });
}

/** Crate of produce (market goods). */
export function produceCrate(goods: Ramp = RAMPS.flowerRed): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(1, 7, 14, 8, WL[2]);
      s.hline(1, 14, 10, WL[1]);
      s.hline(1, 14, 14, WL[0]);
      for (let x = 2; x < 14; x += 3) {
        s.fillEllipse(x, 3 + (x % 2), 4, 4, goods[2]);
        s.set(x + 1, 4 + (x % 2), goods[3]);
      }
    }),
  );
}

/** Coil of rope. */
export function ropeCoil(): Draw {
  const r = RAMPS.thatch;
  return sprite(16, 16, (s) => {
    s.fillEllipse(2, 6, 12, 8, r[1]);
    s.fillEllipse(3, 7, 10, 6, r[2]);
    s.fillEllipse(5, 8, 6, 4, r[1]);
    s.fillEllipse(6, 9, 4, 2, OUTLINE);
    s.line(13, 10, 15, 14, r[2]);
  });
}

// ---------------------------------------------------------------------------
// Interior
// ---------------------------------------------------------------------------

/** Shelf of potion bottles, 1 × 2 tiles. */
export function potionShelf(): Draw {
  return layers(
    groundShadow(8, 31, 14, 2),
    sprite(16, 32, (s) => {
      s.fillRect(1, 2, 14, 29, W[1]);
      s.strokeRect(1, 2, 14, 29, W[0]);
      for (let row = 0; row < 3; row++) {
        const y = 4 + row * 9;
        s.fillRect(2, y, 12, 7, W[0]);
        s.hline(2, 13, y + 7, WL[2]);
        const cols = [RAMPS.flowerRed, RAMPS.roofBlue, RAMPS.roofGreen, RAMPS.poison];
        for (let i = 0; i < 4; i++) {
          const c = cols[(i + row) % 4]!;
          const x = 2 + i * 3;
          s.fillRect(x, y + 3, 2, 4, c[2]);
          s.set(x, y + 3, c[3]);
          s.set(x, y + 2, RAMPS.plaster[2]);
        }
      }
    }),
  );
}

/** Wine rack, 1 × 2 tiles. */
export function wineRack(): Draw {
  return layers(
    groundShadow(8, 31, 14, 2),
    sprite(16, 32, (s) => {
      s.fillRect(1, 2, 14, 29, W[2]);
      s.strokeRect(1, 2, 14, 29, W[0]);
      for (let y = 4; y < 29; y += 4) for (let x = 3; x < 13; x += 4) {
        s.fillEllipse(x, y, 3, 3, RAMPS.roofGreen[0]);
        s.set(x + 1, y + 1, RAMPS.carpetRed[2]);
      }
    }),
  );
}

/** Trapdoor in the floor (walkable). */
export function trapdoor(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(1, 1, 14, 14, W[2]);
    for (let x = 4; x < 15; x += 4) s.vline(x, 1, 14, W[1]);
    s.fillRect(6, 7, 4, 2, IR[2]);
    s.hline(1, 14, 1, W[3]);
  });
}

/** Bucket. */
export function bucket(): Draw {
  return layers(
    groundShadow(8, 15, 10, 2),
    sprite(16, 16, (s) => {
      s.fillRect(4, 7, 8, 8, W[2]);
      s.vline(4, 7, 14, W[3]);
      s.hline(4, 11, 9, IR[1]);
      s.hline(4, 11, 13, IR[1]);
      s.fillEllipse(4, 5, 8, 4, RAMPS.water[2]);
      s.line(4, 6, 8, 2, IR[2]);
      s.line(8, 2, 11, 6, IR[2]);
    }),
  );
}

/** Broom leaning on the wall. */
export function broom(): Draw {
  return sprite(16, 16, (s) => {
    s.line(10, 0, 6, 10, W[2]);
    for (let i = 0; i < 6; i++) s.line(6, 10, 2 + i, 15, RAMPS.thatch[i % 2 ? 1 : 2]);
    s.hline(4, 8, 10, RAMPS.roofRed[2]);
  });
}

/** Stack of two crates, 1 × 2 tiles. */
export function crateStack(): Draw {
  return layers(
    groundShadow(8, 31, 14, 2),
    sprite(16, 32, (s) => {
      for (const y of [4, 17]) {
        s.fillRect(2, y, 12, 13, WL[2]);
        s.strokeRect(2, y, 12, 13, WL[0]);
        s.line(3, y + 1, 12, y + 11, WL[1]);
        s.hline(3, 12, y + 1, WL[3]);
      }
    }),
  );
}

/** Small treasure heap of coins and gems. */
export function treasurePile(): Draw {
  return layers(
    groundShadow(8, 14, 14, 3),
    sprite(16, 16, (s) => {
      shadedBlob(s, 1, 6, 14, 9, GO);
      const rng = new Rng(seedFrom('treasure'));
      for (let i = 0; i < 8; i++) s.set(rng.int(3, 12), rng.int(7, 13), GO[rng.chance(0.5) ? 3 : 1]);
      s.fillRect(5, 7, 2, 2, RAMPS.flowerRed[2]);
      s.fillRect(10, 9, 2, 2, RAMPS.flowerBlue[2]);
      s.fillRect(7, 3, 3, 4, GO[2]);
      s.set(8, 4, GO[3]);
    }),
  );
}

/** Throne, 1 × 2 tiles. */
export function throne(fabric: Ramp = RAMPS.carpetRed): Draw {
  return layers(
    groundShadow(8, 31, 14, 3),
    sprite(16, 32, (s) => {
      s.fillRect(2, 2, 12, 22, GO[2]);
      s.vline(2, 2, 23, GO[3]);
      s.vline(13, 2, 23, GO[1]);
      s.fillRect(4, 4, 8, 18, fabric[2]);
      s.vline(4, 4, 21, fabric[3]);
      for (const x of [2, 7, 12]) s.fillRect(x, 0, 2, 3, GO[3]);
      s.fillRect(1, 20, 14, 5, GO[2]);
      s.fillRect(3, 21, 10, 3, fabric[1]);
      s.fillRect(2, 25, 2, 6, GO[1]);
      s.fillRect(12, 25, 2, 6, GO[1]);
    }),
  );
}

/** Bunk bed, 1 × 2 tiles. */
export function bunkBed(sheet: Ramp = RAMPS.carpetGreen): Draw {
  return layers(
    groundShadow(8, 31, 14, 2),
    sprite(16, 32, (s) => {
      s.fillRect(1, 1, 2, 30, W[1]);
      s.fillRect(13, 1, 2, 30, W[1]);
      for (const y of [5, 20]) {
        s.fillRect(3, y, 10, 6, sheet[2]);
        s.hline(3, 12, y, sheet[3]);
        s.fillRect(3, y, 4, 3, RAMPS.flowerWhite[2]);
        s.hline(1, 14, y + 6, W[2]);
      }
      s.hline(1, 14, 1, W[3]);
    }),
  );
}

/** Alchemy table with flasks, 2 × 1 tiles. */
export function alchemyTable(): Draw {
  return layers(
    groundShadow(16, 15, 28, 3),
    sprite(32, 16, (s) => {
      s.fillRect(1, 7, 30, 5, W[2]);
      s.hline(1, 30, 7, W[3]);
      s.fillRect(2, 12, 2, 4, W[1]);
      s.fillRect(28, 12, 2, 4, W[1]);
      s.fillEllipse(4, 1, 6, 7, RAMPS.poison[2]);
      s.fillRect(6, 0, 2, 2, RAMPS.plaster[2]);
      s.fillRect(13, 2, 3, 5, RAMPS.roofGreen[2]);
      s.fillEllipse(19, 3, 5, 4, RAMPS.lagoon[2]);
      s.fillRect(25, 4, 4, 3, RAMPS.plaster[3]);
      s.set(5, 3, RAMPS.poison[3]);
    }),
  );
}

/** Wall tapestry, 2 × 2 tiles (above characters). */
export function tapestry(ramp: Ramp = RAMPS.carpetBlue): Draw {
  return sprite(32, 32, (s) => {
    s.fillRect(1, 1, 30, 2, W[1]);
    s.fillRect(3, 3, 26, 26, ramp[2]);
    s.strokeRect(4, 4, 24, 24, GO[2]);
    for (let i = 0; i < 6; i++) s.vline(4 + i * 5, 29, 31, GO[2]);
    shadedBlob(s, 10, 9, 12, 12, GO);
    s.fillRect(14, 12, 4, 6, ramp[1]);
  });
}

/** Displayed sword and shield on the wall (above characters). */
export function wallTrophy(): Draw {
  return sprite(16, 16, (s) => {
    s.line(2, 2, 13, 13, RAMPS.silver[3]);
    s.line(3, 2, 13, 12, RAMPS.silver[2]);
    s.line(13, 2, 2, 13, RAMPS.silver[2]);
    shadedBlob(s, 4, 3, 8, 10, RAMPS.roofRed);
    s.vline(8, 4, 11, GO[2]);
  });
}

/** Hanging chandelier, 2 × 1 tiles (above characters). */
export function chandelier(): Draw {
  return sprite(32, 16, (s) => {
    s.vline(16, 0, 5, IR[1]);
    s.fillEllipse(4, 6, 24, 5, GO[1]);
    s.fillEllipse(6, 6, 20, 3, GO[2]);
    for (const x of [5, 11, 16, 21, 26]) {
      s.fillRect(x, 2, 2, 5, RAMPS.plaster[3]);
      s.set(x, 0, RAMPS.fire[3]);
      s.set(x, 1, RAMPS.fire[2]);
    }
  }, OUTLINE, true);
}

/** Kitchen sink with a pump. */
export function sink(): Draw {
  return layers(
    groundShadow(8, 15, 14, 2),
    sprite(16, 16, (s) => {
      s.fillRect(1, 6, 14, 9, ST[2]);
      s.hline(1, 14, 6, ST[3]);
      s.fillRect(3, 7, 10, 4, RAMPS.water[2]);
      s.fillRect(11, 1, 2, 6, IR[2]);
      s.line(12, 1, 8, 1, IR[2]);
    }),
  );
}

/** Floor candles (three candles on a plate). */
export function floorCandles(): Draw {
  return layers(
    groundShadow(8, 14, 12, 3),
    sprite(16, 16, (s) => {
      s.fillEllipse(2, 11, 12, 4, GO[1]);
      for (const [x, h] of [[4, 6], [7, 9], [10, 5]] as const) {
        s.fillRect(x, 13 - h, 2, h, RAMPS.plaster[3]);
        s.set(x, 12 - h, RAMPS.fire[2]);
        s.set(x, 11 - h, RAMPS.fire[3]);
      }
    }),
  );
}

/** Potted fern. */
export function pottedFern(): Draw {
  return layers(
    groundShadow(8, 15, 10, 2),
    sprite(16, 16, (s) => {
      s.fillRect(4, 10, 8, 5, RAMPS.brick[2]);
      s.hline(3, 12, 10, RAMPS.brick[3]);
      for (let i = 0; i < 5; i++) s.line(8, 10, 2 + i * 3, 2 + (i % 2) * 3, RAMPS.jungleLight[i % 2 ? 2 : 1]);
    }),
  );
}

/** Small cushioned bench / ottoman. */
export function ottoman(fabric: Ramp = RAMPS.cloth): Draw {
  return layers(
    groundShadow(8, 15, 14, 2),
    sprite(16, 16, (s) => {
      s.fillRoundRect(2, 6, 12, 6, 2, fabric[2]);
      s.hline(3, 12, 6, fabric[3]);
      s.fillRect(3, 12, 2, 3, W[1]);
      s.fillRect(11, 12, 2, 3, W[1]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Dungeon, cavern and volcano
// ---------------------------------------------------------------------------

/** Iron bars of a cell. */
export function jailBars(): Draw {
  return sprite(16, 16, (s) => {
    s.hline(0, 15, 1, IR[2]);
    s.hline(0, 15, 14, IR[1]);
    for (let x = 1; x < 16; x += 3) {
      s.vline(x, 0, 15, IR[2]);
      s.set(x, 0, IR[3]);
    }
  });
}

/** Chains hanging from the wall (above characters). */
export function chains(): Draw {
  return sprite(16, 16, (s) => {
    for (const x of [4, 11]) for (let y = 0; y < 14; y += 3) s.strokeRect(x - 1, y, 3, 3, IR[2]);
    s.strokeRect(2, 12, 11, 3, IR[1]);
  }, null);
}

/** Coffin, 1 × 2 tiles. */
export function coffin(ramp: Ramp = W): Draw {
  return layers(
    groundShadow(8, 31, 14, 3),
    sprite(16, 32, (s) => {
      for (let y = 1; y < 31; y++) {
        const half = y < 9 ? 3 + Math.floor(y / 2) : 7 - Math.floor((y - 9) / 7);
        s.hline(8 - half, 7 + half, y, ramp[2]);
        s.set(8 - half, y, ramp[3]);
        s.set(7 + half, y, ramp[1]);
      }
      s.vline(8, 7, 21, GO[2]);
      s.hline(5, 10, 11, GO[2]);
    }),
  );
}

/** Stone sarcophagus, 2 × 1 tiles. */
export function sarcophagus(): Draw {
  return layers(
    groundShadow(16, 15, 30, 3),
    sprite(32, 16, (s) => {
      s.fillRect(1, 3, 30, 12, ST[2]);
      s.fillRect(2, 1, 28, 4, ST[3]);
      s.hline(1, 30, 14, ST[0]);
      s.fillEllipse(4, 5, 8, 6, ST[3]);
      s.hline(12, 27, 8, ST[1]);
      s.vline(20, 6, 11, GO[2]);
      s.hline(18, 22, 8, GO[2]);
    }),
  );
}

/** Heap of skulls. */
export function skullPile(): Draw {
  const b = RAMPS.flowerWhite;
  return layers(
    groundShadow(8, 14, 14, 3),
    sprite(16, 16, (s) => {
      for (const [x, y] of [[1, 8], [6, 8], [11, 8], [4, 3], [9, 3]] as const) {
        s.fillRoundRect(x, y, 5, 5, 1, b[2]);
        s.set(x + 1, y + 2, OUTLINE);
        s.set(x + 3, y + 2, OUTLINE);
        s.hline(x + 1, x + 3, y + 4, b[1]);
      }
    }),
  );
}

/** Spike trap: walkable, hurts. `up` shows the spikes out. */
export function spikeTrap(up = true): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(1, 1, 14, 14, ST[1]);
    s.strokeRect(1, 1, 14, 14, ST[0]);
    for (let y = 3; y < 14; y += 4) for (let x = 3; x < 14; x += 4) {
      if (up) {
        s.vline(x, y - 1, y + 1, IR[3]);
        s.set(x, y + 2, IR[1]);
      } else s.set(x, y, OUTLINE);
    }
  });
}

/** Pressure plate (walkable). */
export function pressurePlate(): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(3, 3, 10, 10, ST[2]);
    s.hline(3, 12, 3, ST[3]);
    s.vline(12, 4, 12, ST[1]);
    s.hline(4, 12, 12, ST[1]);
    s.fillRect(7, 7, 2, 2, ST[0]);
  }, ST[0]);
}

/** Wall lever (above characters). */
export function wallLever(down = false): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(5, 6, 6, 8, IR[1]);
    s.strokeRect(5, 6, 6, 8, IR[0]);
    s.line(8, 10, down ? 12 : 12, down ? 14 : 2, W[2]);
    s.fillRect(down ? 11 : 11, down ? 13 : 1, 3, 3, RAMPS.roofRed[2]);
  });
}

/** Magic circle on the floor, 2 × 2 tiles (walkable). */
export function runeCircle(ramp: Ramp = RAMPS.glow): Draw {
  return sprite(32, 32, (s) => {
    for (let a = 0; a < 360; a += 3) {
      const r = (a * Math.PI) / 180;
      s.set(Math.round(16 + Math.cos(r) * 14), Math.round(16 + Math.sin(r) * 14), ramp[2]);
      s.set(Math.round(16 + Math.cos(r) * 10), Math.round(16 + Math.sin(r) * 10), ramp[1]);
    }
    for (let i = 0; i < 5; i++) {
      const a1 = (i * 144 * Math.PI) / 180 - Math.PI / 2;
      const a2 = ((i + 1) * 144 * Math.PI) / 180 - Math.PI / 2;
      s.line(Math.round(16 + Math.cos(a1) * 10), Math.round(16 + Math.sin(a1) * 10), Math.round(16 + Math.cos(a2) * 10), Math.round(16 + Math.sin(a2) * 10), ramp[3]);
    }
  }, null);
}

/** Iron brazier with fire. */
export function brazier(fire: Ramp = RAMPS.fire): Draw {
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.line(4, 15, 6, 10, IR[1]);
      s.line(11, 15, 9, 10, IR[1]);
      s.fillRect(2, 8, 12, 3, IR[2]);
      s.hline(2, 13, 8, IR[3]);
      s.fillEllipse(3, 1, 10, 8, fire[1]);
      s.fillEllipse(5, 2, 6, 6, fire[2]);
      s.fillRect(7, 4, 2, 3, fire[3]);
    }),
  );
}

/** Crystal orb on a pedestal. */
export function orbPedestal(ramp: Ramp = RAMPS.poison): Draw {
  return layers(
    groundShadow(8, 15, 12, 3),
    sprite(16, 16, (s) => {
      s.fillRect(5, 9, 6, 6, ST[2]);
      s.fillRect(3, 13, 10, 2, ST[1]);
      s.hline(4, 11, 9, ST[3]);
      shadedBlob(s, 4, 1, 8, 8, ramp);
      s.set(6, 3, '#ffffff');
    }),
  );
}

/** Hanging iron cage, 1 × 2 tiles. */
export function cage(): Draw {
  return layers(
    groundShadow(8, 31, 12, 3),
    sprite(16, 32, (s) => {
      s.vline(8, 0, 5, IR[1]);
      s.fillEllipse(2, 5, 12, 5, IR[2]);
      for (let x = 2; x < 15; x += 3) s.vline(x, 8, 29, IR[2]);
      s.hline(2, 13, 29, IR[1]);
      s.hline(2, 13, 18, IR[1]);
    }),
  );
}

/** Broken pillar stump. */
export function brokenPillar(ramp: Ramp = ST): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(3, 5, 10, 10, ramp[2]);
      s.vline(3, 5, 14, ramp[3]);
      s.vline(12, 5, 14, ramp[1]);
      for (const x of [6, 9]) s.vline(x, 6, 14, ramp[1]);
      for (let x = 3; x < 13; x++) s.set(x, 4 + ((x * 7) % 3), ramp[3]);
      s.fillRect(1, 13, 3, 2, ramp[1]);
    }),
  );
}

/** Camp fire with stones. */
export function campfire(): Draw {
  return layers(
    groundShadow(8, 14, 14, 3),
    sprite(16, 16, (s) => {
      for (const [x, y] of [[1, 11], [5, 13], [10, 13], [13, 11]] as const) s.fillEllipse(x, y, 3, 3, ST[2]);
      s.line(3, 12, 12, 9, W[1]);
      s.line(3, 9, 12, 12, W[2]);
      s.fillEllipse(4, 2, 8, 9, RAMPS.fire[1]);
      s.fillEllipse(5, 4, 6, 6, RAMPS.fire[2]);
      s.fillRect(7, 6, 2, 3, RAMPS.fire[3]);
    }),
  );
}

/** Bedroll laid on the ground, pillow on the left (walkable). */
export function bedroll(ramp: Ramp = RAMPS.roofGreen): Draw {
  return sprite(16, 16, (s) => {
    s.fillRoundRect(1, 5, 14, 8, 2, ramp[2]);
    s.hline(2, 13, 5, ramp[3]);
    s.hline(2, 13, 12, ramp[1]);
    s.fillRoundRect(1, 6, 4, 6, 1, RAMPS.plaster[2]);
    s.vline(9, 6, 11, ramp[1]);
    s.fillEllipse(12, 5, 4, 8, ramp[1]);
  });
}

/** Giant mushroom, 1 × 2 tiles. */
export function giantMushroom(cap: Ramp = RAMPS.glow): Draw {
  return layers(
    groundShadow(8, 30, 10, 3),
    sprite(16, 32, (s) => {
      s.fillRect(6, 12, 4, 19, RAMPS.plaster[2]);
      s.vline(6, 12, 30, RAMPS.plaster[3]);
      s.vline(9, 12, 30, RAMPS.plaster[1]);
      shadedBlob(s, 0, 2, 16, 12, cap);
      for (const [x, y] of [[4, 5], [10, 6], [7, 9]] as const) s.set(x, y, '#ffffff');
    }),
  );
}

/** Pickaxe stuck in a rock. */
export function pickaxeRock(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      shadedBlob(s, 1, 7, 14, 8, RAMPS.rock);
      s.line(9, 8, 13, 0, W[2]);
      s.line(6, 2, 10, 0, IR[3]);
      s.line(10, 0, 15, 3, IR[2]);
    }),
  );
}

/** Large animal skull, 2 × 2 tiles. */
export function dragonSkull(): Draw {
  const b = RAMPS.plaster;
  return layers(
    groundShadow(16, 29, 28, 5),
    sprite(32, 32, (s) => {
      shadedBlob(s, 3, 6, 22, 18, b);
      s.fillRect(16, 16, 14, 8, b[2]);
      s.hline(16, 29, 16, b[3]);
      for (let x = 17; x < 30; x += 3) s.vline(x, 24, 26, b[3]);
      s.fillEllipse(9, 11, 6, 5, OUTLINE);
      s.fillRect(25, 18, 3, 2, OUTLINE);
      s.line(6, 8, 0, 0, b[2]);
      s.line(8, 7, 3, 0, b[1]);
      s.line(13, 6, 14, 0, b[1]);
    }),
  );
}

/** Small pool of lava (walkable, hurts). */
export function lavaPool(): Draw {
  const l = RAMPS.lava;
  return sprite(16, 16, (s) => {
    s.fillEllipse(1, 3, 14, 10, RAMPS.basalt[1]);
    s.fillEllipse(3, 4, 10, 7, l[1]);
    s.fillEllipse(4, 5, 7, 4, l[2]);
    s.set(6, 6, l[3]);
    s.set(9, 7, l[3]);
  }, null);
}

/** Demon statue, 1 × 2 tiles. */
export function demonStatue(ramp: Ramp = RAMPS.basalt): Draw {
  return layers(
    groundShadow(8, 31, 14, 3),
    sprite(16, 32, (s) => {
      s.fillRect(1, 25, 14, 6, ramp[1]);
      s.hline(1, 14, 25, ramp[3]);
      s.fillRect(4, 12, 8, 13, ramp[2]);
      s.vline(4, 12, 24, ramp[3]);
      s.fillRect(0, 8, 4, 8, ramp[1]);
      s.fillRect(12, 8, 4, 8, ramp[1]);
      shadedBlob(s, 4, 3, 8, 9, ramp);
      s.line(4, 4, 2, 0, ramp[3]);
      s.line(11, 4, 13, 0, ramp[2]);
      s.set(6, 7, RAMPS.lava[3]);
      s.set(9, 7, RAMPS.lava[3]);
    }),
  );
}

/** Fire altar, 2 × 1 tiles. */
export function fireAltar(): Draw {
  return layers(
    groundShadow(16, 15, 30, 3),
    sprite(32, 16, (s) => {
      s.fillRect(2, 7, 28, 8, RAMPS.basalt[2]);
      s.hline(2, 29, 7, RAMPS.basalt[3]);
      s.hline(2, 29, 14, RAMPS.basalt[0]);
      s.fillRect(12, 9, 8, 4, RAMPS.lava[2]);
      for (const x of [4, 24]) {
        s.fillEllipse(x, 0, 5, 7, RAMPS.fire[1]);
        s.fillEllipse(x + 1, 2, 3, 4, RAMPS.fire[3]);
      }
    }),
  );
}

/** Scorch mark on the ground (walkable). */
export function scorchMark(): Draw {
  return sprite(16, 16, (s) => {
    const rng = new Rng(seedFrom('scorch'));
    s.fillEllipse(2, 3, 12, 10, '#1a141c88');
    for (let i = 0; i < 10; i++) s.set(rng.int(2, 13), rng.int(3, 12), RAMPS.basalt[0]);
    s.set(7, 7, RAMPS.lava[2]);
  }, null);
}

/** Obsidian obelisk, 1 × 2 tiles. */
export function obelisk(ramp: Ramp = RAMPS.obsidian): Draw {
  return layers(
    groundShadow(8, 31, 12, 3),
    sprite(16, 32, (s) => {
      for (let y = 2; y < 31; y++) {
        const half = y < 6 ? y - 1 : 5;
        s.hline(8 - half, 7 + half, y, ramp[2]);
        s.set(8 - half, y, ramp[3]);
        s.set(7 + half, y, ramp[1]);
      }
      for (let y = 10; y < 26; y += 5) s.hline(6, 9, y, RAMPS.lava[2]);
    }),
  );
}

// ---------------------------------------------------------------------------
// Jungle and sea
// ---------------------------------------------------------------------------

/** Carved totem pole, 1 × 2 tiles. */
export function totem(): Draw {
  return layers(
    groundShadow(8, 31, 12, 3),
    sprite(16, 32, (s) => {
      s.fillRect(3, 2, 10, 29, W[2]);
      s.vline(3, 2, 30, W[3]);
      s.vline(12, 2, 30, W[1]);
      const faces: Ramp[] = [RAMPS.roofRed, RAMPS.roofGreen, RAMPS.roofBlue];
      faces.forEach((c, i) => {
        const y = 3 + i * 9;
        s.fillRect(4, y, 8, 8, c[2]);
        s.fillRect(5, y + 2, 2, 2, '#ffffff');
        s.fillRect(9, y + 2, 2, 2, '#ffffff');
        s.set(6, y + 3, OUTLINE);
        s.set(10, y + 3, OUTLINE);
        s.hline(5, 10, y + 6, OUTLINE);
      });
      s.fillRect(0, 4, 3, 3, RAMPS.roofRed[2]);
      s.fillRect(13, 4, 3, 3, RAMPS.roofRed[2]);
    }),
  );
}

/** Straw hut, 2 × 2 tiles. */
export function strawHut(): Draw {
  const t = RAMPS.thatch;
  return layers(
    groundShadow(16, 30, 30, 4),
    sprite(32, 32, (s) => {
      s.fillRect(4, 16, 24, 14, W[2]);
      for (let x = 5; x < 28; x += 3) s.vline(x, 16, 29, W[1]);
      s.fillRoundRect(12, 20, 8, 10, 2, OUTLINE);
      for (let j = 0; j < 16; j++) s.hline(16 - j - 2, 15 + j + 2, j + 1, j % 3 === 0 ? t[3] : t[2]);
      s.hline(0, 31, 17, t[1]);
    }),
  );
}

/** Giant jungle flower. */
export function giantFlower(petals: Ramp = RAMPS.flowerRed): Draw {
  return layers(
    groundShadow(8, 14, 16, 3),
    sprite(16, 16, (s) => {
      for (const [x, y] of [[0, 5], [10, 5], [5, 0], [2, 10], [8, 10]] as const) shadedBlob(s, x, y, 6, 6, petals);
      s.fillEllipse(5, 5, 6, 6, RAMPS.sulfur[2]);
      s.set(7, 7, RAMPS.sulfur[3]);
      s.set(8, 8, RAMPS.sulfur[1]);
    }),
  );
}

/** Basket of fruit. */
export function fruitBasket(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(2, 8, 12, 7, RAMPS.thatch[2]);
      for (let y = 9; y < 15; y += 2) s.hline(2, 13, y, RAMPS.thatch[1]);
      s.fillEllipse(3, 4, 5, 5, RAMPS.flowerYellow[2]);
      s.fillEllipse(7, 3, 5, 5, RAMPS.flowerRed[2]);
      s.fillEllipse(10, 5, 4, 4, RAMPS.leavesAutumn[2]);
    }),
  );
}

/** Beach parasol, 1 × 2 tiles (the canopy is above characters). */
export function parasol(ramp: Ramp = RAMPS.roofRed): Draw {
  return layers(
    groundShadow(8, 30, 14, 4),
    sprite(16, 32, (s) => {
      s.vline(8, 6, 30, RAMPS.plaster[1]);
      for (let j = 0; j < 7; j++) {
        const half = 2 + j;
        for (let i = -half; i <= half; i++) s.set(8 + i, 1 + j, Math.floor((i + 9) / 3) % 2 ? ramp[2] : RAMPS.flowerWhite[2]);
      }
      s.hline(0, 15, 8, ramp[0]);
    }),
  );
}

/** Beach towel (walkable). */
export function beachTowel(ramp: Ramp = RAMPS.roofBlue): Draw {
  return sprite(16, 16, (s) => {
    s.fillRect(3, 0, 10, 16, ramp[2]);
    for (let y = 2; y < 16; y += 4) s.hline(3, 12, y, RAMPS.flowerWhite[2]);
  });
}

/** Ship cannon. */
export function cannon(): Draw {
  return layers(
    groundShadow(8, 15, 14, 3),
    sprite(16, 16, (s) => {
      s.fillRect(1, 10, 12, 4, W[2]);
      s.fillEllipse(2, 12, 4, 4, W[1]);
      s.fillEllipse(9, 12, 4, 4, W[1]);
      s.fillRect(2, 5, 13, 5, IR[1]);
      s.hline(2, 14, 5, IR[3]);
      s.fillEllipse(12, 5, 4, 5, IR[2]);
      s.set(14, 7, OUTLINE);
    }),
  );
}

/** Sea urchin (walkable, hurts). */
export function seaUrchin(): Draw {
  return sprite(16, 16, (s) => {
    for (let a = 0; a < 360; a += 30) {
      const r = (a * Math.PI) / 180;
      s.line(8, 9, Math.round(8 + Math.cos(r) * 6), Math.round(9 + Math.sin(r) * 5), RAMPS.poison[1]);
    }
    shadedBlob(s, 5, 6, 6, 6, RAMPS.poison);
  });
}

/** Rock pool with water. */
export function rockPool(): Draw {
  return layers(
    groundShadow(8, 14, 16, 3),
    sprite(16, 16, (s) => {
      shadedBlob(s, 0, 3, 16, 12, RAMPS.rock);
      s.fillEllipse(3, 6, 10, 6, RAMPS.lagoon[2]);
      s.hline(5, 8, 7, RAMPS.lagoon[3]);
      s.set(9, 9, RAMPS.coral[2]);
    }),
  );
}

/** Lifebuoy hanging on a wall (above characters). */
export function lifebuoy(): Draw {
  return sprite(16, 16, (s) => {
    s.fillEllipse(2, 2, 12, 12, RAMPS.flowerWhite[2]);
    for (const [x, y] of [[7, 2], [2, 7], [12, 7], [7, 12]] as const) s.fillRect(x, y, 2, 2, RAMPS.roofRed[2]);
    s.fillEllipse(5, 5, 6, 6, null);
  });
}

/** Rack of fishing rods. */
export function fishingRods(): Draw {
  return layers(
    groundShadow(8, 15, 14, 2),
    sprite(16, 16, (s) => {
      s.fillRect(1, 12, 14, 3, W[2]);
      for (const x of [3, 7, 11]) {
        s.line(x, 13, x + 2, 0, W[3]);
        s.set(x + 2, 1, RAMPS.flowerWhite[2]);
      }
      s.fillRect(10, 9, 4, 3, RAMPS.roofRed[2]);
    }),
  );
}

/** Coconut palm stump with coconuts. */
export function coconuts(): Draw {
  return layers(
    groundShadow(8, 14, 14, 3),
    sprite(16, 16, (s) => {
      for (const [x, y] of [[2, 8], [7, 9], [5, 4], [10, 6]] as const) {
        shadedBlob(s, x, y, 5, 5, RAMPS.mud);
        s.set(x + 1, y + 1, RAMPS.mud[3]);
      }
    }),
  );
}


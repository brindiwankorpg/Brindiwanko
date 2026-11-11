/**
 * @file The black contour of a sprite lies outside its shape: on the top row of its canvas it would fall
 * off, and the top of the shape stayed open (no black line above a tree). These tests check that trees,
 * monsters, bosses and portraits keep their top edge free, and that every pixel on the top edge of a
 * shape is the outline colour.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bossBlocks } from '../assets/generators/bosses.js';
import { characterSheets } from '../assets/generators/characters.js';
import { slime, bat, wolf, mushroom, demonLord } from '../assets/generators/monsters.js';
import { crab, floatingEye, ghost, golem, imp, maneater, snake, spider, wisp } from '../assets/generators/monsters-extra.js';
import { palmTree, jungleTree } from '../assets/generators/objects-biomes.js';
import { roundTree, pineTree } from '../assets/generators/objects.js';
import { snowyPine } from '../assets/generators/objects-extra.js';
import { OUTLINE } from '../shared/art/palette.js';
import { PixelCanvas, type Color } from '../shared/art/pixel.js';

/** Pixels (x, y) on the top edge of a shape (painted, with nothing painted above) that are not the outline colour. */
function openTop(canvas: PixelCanvas, rows: number, x0 = 0, y0 = 0, w = canvas.width): string[] {
  const open: string[] = [];
  for (let y = y0; y < y0 + rows; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const here: Color = canvas.get(x, y);
      if (here !== null && (y === y0 || canvas.get(x, y - 1) === null) && here !== OUTLINE) open.push(`${x},${y}`);
    }
  }
  return open;
}

test('trees keep a closed black contour over their crown', () => {
  const trees: [string, (c: PixelCanvas, x: number, y: number) => void][] = [
    ['round tree', roundTree()],
    ['jungle tree', jungleTree()],
    ['pine', pineTree()],
    ['snowy pine', snowyPine()],
    ['palm tree', palmTree()],
  ];
  for (const [name, draw] of trees) {
    const canvas = new PixelCanvas(64, 64);
    draw(canvas, 16, 16);
    // The upper half only: the ground shadow, soft by design, lies under the trunk.
    assert.deepEqual(openTop(canvas, 14, 0, 16), [], `${name}: pixels of the top edge without a contour`);
  }
});

test('no tree touches the edge of its tile on the sides either', () => {
  for (const [name, draw, w] of [['pine', pineTree(), 16], ['snowy pine', snowyPine(), 16], ['palm tree', palmTree(), 32], ['jungle tree', jungleTree(), 32]] as const) {
    const canvas = new PixelCanvas(80, 64);
    draw(canvas, 16, 16);
    let left = 0;
    let right = 0;
    for (let y = 16; y < 48; y++) {
      if (canvas.get(16, y) !== null && canvas.get(16, y) !== OUTLINE) left++;
      if (canvas.get(16 + w - 1, y) !== null && canvas.get(16 + w - 1, y) !== OUTLINE) right++;
    }
    assert.equal(left + right, 0, `${name}: painted pixels on the left or right column of its tile (contour cut)`);
  }
});

test('monsters and bosses leave room for the contour on every side of every frame; portraits on top', () => {
  const blocks: [string, PixelCanvas, number, number][] = [
    ['slime', slime(), 3, 4],
    ['bat', bat(), 3, 4],
    ['wolf', wolf(), 3, 4],
    ['mushroom', mushroom(), 3, 4],
    ['demon lord', demonLord(), 3, 4],
    ['ghost', ghost(), 3, 4],
    ['spider', spider(), 3, 4],
    ['snake', snake(), 3, 4],
    ['golem', golem(), 3, 4],
    ['wisp', wisp(), 3, 4],
    ['crab', crab(), 3, 4],
    ['floating eye', floatingEye(), 3, 4],
    ['man-eater', maneater(), 3, 4],
    ['imp', imp(), 3, 4],
    ...bossBlocks().map((b, i): [string, PixelCanvas, number, number] => [`boss ${i + 1}`, b, 3, 4]),
  ];
  for (const [name, block, cols, rows] of blocks) {
    const fw = block.width / cols;
    const fh = block.height / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // The edge rows and columns may hold the contour itself, never the shape: then the contour could not close there.
        const edge = (x: number, y: number) => {
          const pixel = block.get(c * fw + x, r * fh + y);
          return pixel !== null && pixel !== OUTLINE;
        };
        const touching = { top: 0, bottom: 0, left: 0, right: 0 };
        for (let x = 0; x < fw; x++) {
          if (edge(x, 0)) touching.top++;
          if (edge(x, fh - 1)) touching.bottom++;
        }
        for (let y = 0; y < fh; y++) {
          if (edge(0, y)) touching.left++;
          if (edge(fw - 1, y)) touching.right++;
        }
        assert.deepEqual(touching, { top: 0, bottom: 0, left: 0, right: 0 }, `${name}: frame ${c},${r} has pixels of the shape on the edge of its frame (contour cut)`);
      }
    }
  }
  // Portraits: every head has its contour on top.
  const faces = characterSheets().filter((s) => s.path.startsWith('faces/'));
  assert.ok(faces.length > 0);
  for (const sheet of faces) {
    const fw = sheet.canvas.width / 4;
    const fh = sheet.canvas.height / 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const open = openTop(sheet.canvas, 6, c * fw, r * fh, fw);
        assert.deepEqual(open, [], `${sheet.path}: portrait ${c},${r} has a head without its top contour`);
      }
    }
  }
});

test('makeRoomBeside keeps the silhouette: it moves one way, or removes two look-alike columns', () => {
  const frame = (columns: number[]) => {
    const c = new PixelCanvas(10, 4);
    for (const x of columns) c.fillRect(x, 1, 1, 2, '#ffffff');
    return c;
  };
  // Touching on the left only: moves right.
  const one = frame([0, 1, 2]);
  assert.equal(PixelCanvas.makeRoomBeside([one]), true);
  assert.equal(one.colPainted(0), false);
  assert.equal(one.colPainted(3), true);
  // Touching on both sides: two columns go, the width of the drawing goes from 10 to 8 with an empty column at each end.
  const both = frame([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(PixelCanvas.makeRoomBeside([both]), true);
  assert.equal(both.colPainted(0), false);
  assert.equal(both.colPainted(9), false);
  for (let x = 1; x <= 8; x++) assert.equal(both.colPainted(x), true, `column ${x}`);
  // A drawing with room on both sides is left alone.
  assert.equal(PixelCanvas.makeRoomBeside([frame([2, 3, 4])]), false);
});

test('makeRoomAbove moves the frames of an animation together, and leaves attached drawings alone', () => {
  const frame = (top: number) => {
    const c = new PixelCanvas(8, 8);
    c.fillRect(2, top, 4, 4, '#ffffff');
    return c;
  };
  const frames = [frame(0), frame(1)];
  assert.equal(PixelCanvas.makeRoomAbove(frames), true);
  assert.equal(frames[0]!.rowPainted(0), false, 'room for the contour');
  assert.equal(frames[0]!.rowPainted(1), true);
  assert.equal(frames[1]!.rowPainted(2), true, 'the second frame moved by the same amount');
  // A door touches the top and the bottom: it continues on the next tile.
  const door = new PixelCanvas(8, 8);
  door.fillRect(1, 0, 6, 8, '#ffffff');
  assert.equal(PixelCanvas.makeRoomAbove([door], true), false);
  assert.equal(door.rowPainted(0), true);
});

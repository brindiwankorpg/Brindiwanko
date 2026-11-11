/**
 * @file Looping maps: cells brought back inside, shortest distances through
 * the edges, steps and paths across an edge, and the server letting a player
 * walk past the edge to the opposite side.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMap, deltaX, deltaY, setTileAt, stepCell, wrapCell } from '../shared/map.js';
import { canMove, findPath } from '../shared/passability.js';
import { MapRuntime } from '../server/game/map-runtime.js';

/** A 10 × 6 map of one passable ground tile (flags all 0 = passable). */
function openMap(scrollType: number) {
  const map = createMap(10, 6, 1);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) setTileAt(map, x, y, 0, 2048 + 16 * 48);
  map.scrollType = scrollType;
  return map;
}
const flags = new Array<number>(8192).fill(0);

test('cells and distances wrap only on the looping axes', () => {
  const both = openMap(3);
  assert.deepEqual(wrapCell(both, 10, -1), { x: 0, y: 5 });
  assert.deepEqual(stepCell(both, 9, 2, 6), { x: 0, y: 2 });
  assert.equal(deltaX(both, 9, 0), 1, 'one step to the right through the edge');
  assert.equal(deltaX(both, 0, 9), -1);
  assert.equal(deltaY(both, 0, 5), -1);
  const horizontal = openMap(2);
  assert.deepEqual(wrapCell(horizontal, -1, -1), { x: 9, y: -1 }, 'rows do not loop');
  assert.equal(deltaY(horizontal, 0, 5), 5);
  const none = openMap(0);
  assert.deepEqual(stepCell(none, 9, 2, 6), { x: 10, y: 2 });
  assert.equal(deltaX(none, 9, 0), -9);
});

test('steps and paths go through the edges of a looping map', () => {
  const looping = openMap(2);
  assert.equal(canMove(looping, flags, 9, 2, 6), true, 'right edge leads to the left edge');
  assert.equal(canMove(looping, flags, 2, 0, 8), false, 'the top edge stays an edge');
  assert.equal(canMove(openMap(0), flags, 9, 2, 6), false);
  // From the last column to the first one: one step through the edge, not nine.
  assert.deepEqual(findPath(looping, flags, { x: 9, y: 2 }, { x: 0, y: 2 }), [6]);
  assert.deepEqual(findPath(looping, flags, { x: 1, y: 2 }, { x: 8, y: 2 }), [4, 4, 4]);
});

test('the server moves an event across the edge of a looping map', () => {
  const map = openMap(2);
  map.events = [null, { id: 1, name: 'Walker', x: 9, y: 2, note: '', pages: [] } as never];
  const runtime = new MapRuntime(1, map, flags);
  assert.deepEqual(runtime.next(9, 2, 6), { x: 0, y: 2 });
  assert.deepEqual(runtime.delta(9, 2, 0, 2), { dx: 1, dy: 0 });
  assert.equal(runtime.canStep(new Map(), 9, 2, 6), true);
});

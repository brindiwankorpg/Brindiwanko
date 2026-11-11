/**
 * @file Loot rolls (need / greed): when several players roll the same highest number, the item is drawn
 * among them. Sorting alone gave it, every time, to the one who comes first in the list: the player who
 * entered the map first.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highestRoll } from '../server/game/raids.js';

const roll = (name: string, value: number) => ({ name, value });

test('the highest roll wins', () => {
  const rolls = [roll('A', 12), roll('B', 87), roll('C', 40)];
  assert.equal(highestRoll(rolls).name, 'B');
  assert.equal(highestRoll([roll('Solo', 1)]).name, 'Solo');
});

test('a tie on the highest number is drawn among the players who tied, not given to the first of the list', () => {
  const rolls = [roll('First', 77), roll('Second', 77), roll('Low', 10), roll('Third', 77)];
  assert.equal(highestRoll(rolls, () => 0).name, 'First');
  assert.equal(highestRoll(rolls, () => 0.5).name, 'Second');
  assert.equal(highestRoll(rolls, () => 0.99).name, 'Third');
  // Never the one who rolled lower, whatever the draw.
  for (const draw of [0, 0.34, 0.67, 0.999999, 1]) assert.notEqual(highestRoll(rolls, draw === 1 ? () => 1 : () => draw).name, 'Low');
});

test('over many draws every player of a tie wins about as often', () => {
  const rolls = [roll('A', 50), roll('B', 50)];
  const wins = { A: 0, B: 0 } as Record<string, number>;
  for (let i = 0; i < 2000; i++) wins[highestRoll(rolls).name]!++;
  assert.ok(wins.A! > 800 && wins.B! > 800, `A ${wins.A}, B ${wins.B}`);
});

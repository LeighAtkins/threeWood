import test from 'node:test';
import assert from 'node:assert/strict';
import { gradePot } from '../src/play/nabe.js';
import { simulateStone, throwFromFlick } from '../src/play/skip.js';
import { loadCamp, bump } from '../src/core/camp.js';

test('hot pot: three cooked is a star; a steady simmer two; two wild kinds three', () => {
  assert.equal(gradePot({ cooked: 2, kinds: 3, simmer: 1, boils: 0 }), 0);
  assert.equal(gradePot({ cooked: 3, kinds: 0, simmer: 0.2, boils: 3 }), 1);
  assert.equal(gradePot({ cooked: 5, kinds: 1, simmer: 0.7, boils: 1 }), 2);
  assert.equal(gradePot({ cooked: 5, kinds: 2, simmer: 0.7, boils: 0 }), 3);
});

test('stones: a lazy flick plops, a quick straight one skims, a crooked one less', () => {
  const lazy = simulateStone(throwFromFlick(0, -80, 400)).skips;
  const quick = simulateStone(throwFromFlick(0, -300, 120)).skips;
  const crooked = simulateStone(throwFromFlick(150, -300, 120)).skips;
  assert.equal(lazy, 0);
  assert.ok(quick >= 8, `quick flick: ${quick}`);
  assert.ok(crooked < quick && crooked >= 3, `crooked: ${crooked}`);
});

test('camp: the dog and the new outfits survive a reload', () => {
  const camp = loadCamp({ look: {}, made: true, dog: true, unlocked: ['trail'], stats: {} });
  assert.equal(camp.dog, true);
  assert.deepEqual(bump(camp, 'nabe').map((o) => o.id), ['hanten']);
  assert.deepEqual(bump(camp, 'pets', 15).map((o) => o.id), ['walker']);
});

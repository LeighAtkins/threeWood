import test from 'node:test';
import assert from 'node:assert/strict';
import { CLUBS, distanceAt, powerFor, autoSelectClub, lieFor } from '../src/core/clubs.js';
import { createBall, placeBall, puttBall, simulate, flatWorld, CUP_R, CUP_CAPTURE_SPEED, BALL_R } from '../src/core/ballSim.js';
import { designHole, ROUND_PLAN, roundHoles } from '../src/course/holeDesigner.js';
import { buildWorld } from '../src/course/courseWorld.js';
import { playHole } from './bot.js';

test('club bag is ordered long to short and hits its book carry', () => {
  const full = CLUBS.filter((c) => c.table.length);
  for (let i = 1; i < full.length; i++) assert.ok(full[i].total < full[i - 1].total);
  for (const c of full) assert.ok(Math.abs(c.table.at(-1).carry - c.carry) < 1, `${c.id} carry`);
});

test('powerFor inverts distanceAt', () => {
  const club = CLUBS[3];
  for (const d of [40, 80, 110]) assert.ok(Math.abs(distanceAt(club, powerFor(club, d)) - d) < 0.5);
});

test('caddie picks a putter on the green and never a driver off the deck', () => {
  assert.equal(autoSelectClub(8, lieFor('green'), false).id, 'putter');
  assert.notEqual(autoSelectClub(400, lieFor('fairway'), false).id, 'driver');
  assert.equal(autoSelectClub(400, lieFor('tee'), true).id, 'driver');
});

test('the cup takes a dead-weight putt and lips out a rocket', () => {
  const world = { ...flatWorld('green'), cup: { x: 5, z: 0 } };
  const run = (speed, z) => {
    const b = createBall(0, BALL_R, z);
    puttBall(b, { speed, dirX: 1, dirZ: 0 });
    return { b, events: simulate(b, world, null).events };
  };
  assert.equal(run(4.6, 0).b.mode, 'holed');
  const hot = run(9, 0);
  assert.equal(hot.b.mode, 'rest');
  assert.ok(hot.events.some((e) => e.type === 'lipout'));
  // Off-centre: the same pace that drops in the middle slides by the edge
  assert.ok(CUP_CAPTURE_SPEED > 0 && run(5.6, CUP_R * 0.95).b.mode !== 'holed');
});

test('the routing is a par 72 with three biomes', () => {
  assert.equal(ROUND_PLAN.length, 18);
  assert.equal(ROUND_PLAN.reduce((s, h) => s + h.par, 0), 72);
  assert.equal(new Set(ROUND_PLAN.map((h) => h.biome)).size, 3);
  assert.equal(roundHoles(9).length, 9);
});

test('every hole on several courses passes its fairness checks, deterministically', () => {
  for (const seed of ['AAAA-1111', 'K7LV-T870', 'hello', 'Z9Z9-Q2Q2']) {
    for (let n = 1; n <= 18; n++) {
      const spec = designHole(seed, n);
      assert.ok(spec.fitness.pass, `${seed} #${n} ${spec.archetype}: ${JSON.stringify(spec.fitness.checks)}`);
      assert.deepEqual(designHole(seed, n).path, spec.path);
    }
  }
});

test('tee and pin sit on dry, sensible ground', () => {
  for (let n = 1; n <= 18; n++) {
    const world = buildWorld(designHole('GROUND', n));
    assert.equal(world.surfaceAt(world.tee.x, world.tee.z), 'tee');
    assert.equal(world.surfaceAt(world.cup.x, world.cup.z), 'green');
    const g = [0, 0];
    world.gradAt(world.cup.x, world.cup.z, g);
    assert.ok(Math.hypot(g[0], g[1]) < 0.08, `hole ${n} pin slope`);
    const b = createBall();
    placeBall(b, world, world.tee.x, world.tee.z);
    assert.ok(b.y > world.waterLevelAt(b.x, b.z));
  }
});

test('a tidy bot finishes all 18 holes at a believable score', () => {
  let strokes = 0;
  for (let n = 1; n <= 18; n++) {
    const r = playHole('BOT-ROUND', n, { skill: 0.5 });
    assert.ok(r.holed, `hole ${n} (${r.spec.archetype}) not finished: ${r.log.join(' | ')}`);
    strokes += r.strokes;
  }
  assert.ok(strokes > 50 && strokes < 85, `bot shot ${strokes}`);
});

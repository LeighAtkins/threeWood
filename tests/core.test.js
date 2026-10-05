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

test('the routing is a par 72 that tours six worlds', async () => {
  const { courseBiomes, biomeForHole, BIOMES } = await import('../src/course/biomes.js');
  for (const seed of ['A', 'B', 'DAILY-2026-10-05']) {
    const worlds = courseBiomes(seed);
    assert.equal(new Set(worlds).size, 6);
    assert.ok(worlds.every((id) => BIOMES[id]));
    assert.equal(biomeForHole(seed, 1), worlds[0]);
    assert.equal(biomeForHole(seed, 18), worlds[5]);
    assert.equal(designHole(seed, 7).biome, worlds[2]);
  }
  assert.equal(ROUND_PLAN.length, 18);
  assert.equal(ROUND_PLAN.reduce((s, h) => s + h.par, 0), 72);
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

test('the soundtrack keeps a two-step backbeat and saves the snare for the round', async () => {
  const { drumStep, bassStep, SCENE_LEVEL } = await import('../src/core/dnbPattern.js');
  for (let bar = 0; bar < 8; bar++) {
    for (const level of [1, 2]) {
      assert.equal(drumStep(bar, 0, level).kick, 1, 'kick on the one');
      assert.equal(drumStep(bar, 4, level).snare, 1, 'snare on two');
    }
    for (let step = 0; step < 16; step++) assert.equal(drumStep(bar, step, 0).snare, 0);
    assert.ok(bassStep(bar, 0), 'bass lands on every downbeat');
  }
  assert.equal(SCENE_LEVEL.title, 0);
  assert.equal(SCENE_LEVEL.flight, 2);
});

test('the almanac puts the sun and moon where they belong', async () => {
  const { sunPosition, moonPosition, sunDay, guessPlace } = await import('../src/core/almanac.js');
  const deg = 180 / Math.PI;
  // Greenwich at the equinox: the noon sun stands at 90 - latitude, due south
  const noon = sunPosition(new Date('2024-03-20T12:00:00Z'), 51.48, 0);
  assert.ok(Math.abs(noon.altitude * deg - 38.5) < 0.5);
  assert.ok(Math.abs(noon.azimuth * deg - 180) < 4);
  // Mornings are in the east
  assert.ok(sunPosition(new Date('2024-03-20T07:00:00Z'), 51.48, 0).azimuth * deg < 120);
  // A known full moon and new moon
  assert.ok(moonPosition(new Date('2024-01-25T17:54:00Z'), 0, 0).fraction > 0.99);
  assert.ok(moonPosition(new Date('2024-01-11T11:57:00Z'), 0, 0).fraction < 0.01);
  // Midsummer inside the Arctic circle: the sun never sets
  assert.equal(sunDay(new Date('2026-06-21T12:00:00Z'), 70, 0).set, null);
  // Place from a time zone, from a legacy alias, and from the clock alone
  assert.deepEqual([guessPlace('Australia/Sydney').lat, guessPlace('Australia/Sydney').lon], [-34, 151]);
  assert.equal(guessPlace('Asia/Calcutta').source, 'zone');
  const blind = guessPlace('Nowhere/Land', -660, -600);
  assert.ok(blind.lat < 0 && blind.lon === 150);
});

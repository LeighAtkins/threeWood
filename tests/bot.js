import { designHole } from '../src/course/holeDesigner.js';
import { buildWorld, aimTarget } from '../src/course/courseWorld.js';
import { createBall, placeBall, launchBall, puttBall, simulate } from '../src/core/ballSim.js';
import { autoSelectClub, lieFor, powerFor, distanceAt } from '../src/core/clubs.js';
import { buildLaunch, readPutt, slopeAlong } from '../src/core/shotPlanner.js';
import { strikeFromTiming } from '../src/core/swing.js';
import { mulberry32, hashSeed } from '../src/core/rng.js';

/**
 * Headless golfer. Plays a hole with the same planner the game uses, with
 * `skill` controlling how sloppy its swing timing and power are
 * (0 = perfect). Returns the stroke count and a shot log.
 */
export function playHole(seed, number, { skill = 0, maxStrokes = 12 } = {}) {
  const spec = designHole(seed, number);
  const world = buildWorld(spec);
  const rng = mulberry32(hashSeed(`${seed}:bot-${number}`));
  const env = { windX: spec.wind.x, windZ: spec.wind.z };
  const ball = createBall();
  placeBall(ball, world, world.tee.x, world.tee.z);

  let strokes = 0, putts = 0;
  const log = [];
  while (strokes < maxStrokes) {
    const onTee = strokes === 0;
    const lie = lieFor(ball.surface);
    const toPin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    const startX = ball.x, startZ = ball.z;
    let label;

    if (lie.id === 'green' || (lie.id === 'fringe' && toPin < 12)) {
      const read = readPutt(world, ball);
      const paceError = 1 + (rng() - 0.5) * 0.3 * skill;
      const aimError = (rng() - 0.5) * 0.06 * skill;
      const c = Math.cos(aimError), s = Math.sin(aimError);
      puttBall(ball, {
        speed: read.speed * paceError,
        dirX: read.dirX * c - read.dirZ * s,
        dirZ: read.dirX * s + read.dirZ * c,
      });
      putts++;
      label = 'putt';
    } else {
      const target = aimTarget(world, ball.x, ball.z);
      const dist = Math.hypot(target.x - ball.x, target.z - ball.z);
      const club = autoSelectClub(dist, lie, onTee);
      const power = Math.min(100, powerFor(club, dist, lie.speedFactor) * (1 + (rng() - 0.5) * 0.16 * skill));
      const strike = strikeFromTiming((rng() - 0.5) * 1.1 * skill, club.loft, rng);
      const dirX = (target.x - ball.x) / dist, dirZ = (target.z - ball.z) / dist;
      const launch = buildLaunch({
        club, power, lie, strike, scatter: rng() * 2 - 1, dirX, dirZ,
        slope: slopeAlong(world, ball, dirX, dirZ),
      });
      launchBall(ball, launch);
      label = `${club.short}@${power.toFixed(0)}`;
    }
    strokes++;
    simulate(ball, world, env, { maxTime: 40 });

    if (ball.mode === 'holed') { log.push(`${label} IN`); break; }
    if (ball.mode === 'water' || ball.mode === 'oob') {
      log.push(`${label} ${ball.mode.toUpperCase()}`);
      strokes++;
      placeBall(ball, world, ball.dryX, ball.dryZ);
      continue;
    }
    if (ball.mode !== 'rest') { log.push(`${label} STUCK(${ball.mode})`); break; }
    placeBall(ball, world, ball.x, ball.z);
    const left = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    log.push(`${label} ${Math.hypot(ball.x - startX, ball.z - startZ).toFixed(0)}y->${ball.surface} ${left.toFixed(1)}`);
  }
  return { spec, strokes, putts, log, holed: ball.mode === 'holed' };
}

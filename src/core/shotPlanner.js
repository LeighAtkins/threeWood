import { createBall, copyBall, launchBall, puttBall, simulate, BALL_R, CUP_R } from './ballSim.js';
import { speedAt } from './clubs.js';

/**
 * Turning a decision (club, meter reading, aim, strike quality, lie) into a
 * launch — and the planning helpers built on the simulator: the aim preview,
 * the putt pace solver, and the putt meter scale. Shared by the game and the
 * headless bot so both hit exactly the same shot. Pure module.
 */

export const PERFECT_STRIKE = {
  grade: 'pure', early: false, contact: 'clean',
  yawDeg: 0, loftDelta: 0, speedFactor: 1, spinFactor: 1, sidespinAdd: 0, timing: 0,
};

/**
 * @param {object} o
 * @param {object} o.club
 * @param {number} o.power  0..100 meter reading
 * @param {number} o.dirX,o.dirZ  horizontal aim (unit)
 * @param {object} o.lie    from clubs.lieFor()
 * @param {object} [o.strike] from swing.strikeFromTiming()
 * @param {number} [o.scatter] -1..1 seeded roll for lie scatter
 * @param {number} [o.slope] ground rise per yard along the aim line
 */
export function buildLaunch({ club, power, dirX, dirZ, lie, strike = PERFECT_STRIKE, scatter = 0, slope = 0 }) {
  // + yaw = pull (left of aim). Right of aim is (-dirZ, dirX), so left is a
  // negative rotation in this frame.
  const yaw = (-(strike.yawDeg || 0) + scatter * lie.scatterDeg) * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    speed: speedAt(club, power) * lie.speedFactor * strike.speedFactor,
    dirX: dirX * c - dirZ * s,
    dirZ: dirX * s + dirZ * c,
    // Always launch clear of the slope in front of the ball
    loftDeg: Math.max(4, club.loft + lie.loftBonus + strike.loftDelta, Math.atan(slope) * 180 / Math.PI + 9),
    back: club.spin * lie.spinFactor * strike.spinFactor,
    // Early = closed face = draws left
    side: -(strike.sidespinAdd || 0),
  };
}

/** Flight preview for the aim line: stops at first landing. Ignores wind. */
export function previewShot(world, ball, launch) {
  const b = copyBall(ball);
  launchBall(b, launch);
  const run = simulate(b, world, null, { sample: 0.08, stopOnLand: true, maxTime: 12 });
  return {
    points: run.points, landX: b.x, landY: b.y, landZ: b.z, landed: b.landed,
    blocked: run.events.some((e) => e.type === 'tree'),
  };
}

/** Full roll-out of a putt along a line (cup included). */
export function previewPutt(world, ball, dirX, dirZ, speed) {
  const b = copyBall(ball);
  puttBall(b, { speed, dirX, dirZ });
  const run = simulate(b, world, null, { sample: 0.06, maxTime: 20 });
  return { points: run.points, holed: b.mode === 'holed', endX: b.x, endZ: b.z };
}

/**
 * Speed that rolls the ball `distance` (plus a little) along its line,
 * measured with the cup removed so "dead weight" is well defined.
 */
export function puttSpeedFor(world, ball, dirX, dirZ, distance, past = 0.45) {
  const noCup = { ...world, cup: null };
  const want = distance + past;
  let lo = 0.2, hi = 30;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const b = copyBall(ball);
    puttBall(b, { speed: mid, dirX, dirZ });
    simulate(b, noCup, null, { maxTime: 20 });
    const rolled = (b.x - ball.x) * dirX + (b.z - ball.z) * dirZ;
    if (rolled < want && b.mode === 'rest') lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Putt meter top speed: the meter is rescaled per putt so the ideal pace
 * always sits in the readable part of the bar (never squeezed at the bottom).
 */
export function puttMeterMax(idealSpeed) {
  return Math.max(3, idealSpeed / 0.68);
}

/** Meter reading (0..100) -> putt speed. */
export function puttSpeedAt(maxSpeed, power) {
  return maxSpeed * Math.max(0.03, power / 100);
}

/**
 * The caddie's read: search aim angles around the hole for the line that
 * drops (or finishes nearest). Returns { dirX, dirZ, speed, holed }.
 */
export function readPutt(world, ball, span = 0.35, steps = 29) {
  const cx = world.cup.x - ball.x, cz = world.cup.z - ball.z;
  const dist = Math.hypot(cx, cz);
  const base = Math.atan2(cz, cx);
  let best = null;
  for (let i = 0; i < steps; i++) {
    const a = base + (i / (steps - 1) - 0.5) * 2 * span;
    const dirX = Math.cos(a), dirZ = Math.sin(a);
    const speed = puttSpeedFor(world, ball, dirX, dirZ, dist);
    const b = copyBall(ball);
    puttBall(b, { speed, dirX, dirZ });
    simulate(b, world, null, { maxTime: 20 });
    const miss = b.mode === 'holed' ? -1 / (1 + Math.abs(a - base)) : Math.hypot(b.x - world.cup.x, b.z - world.cup.z);
    if (!best || miss < best.miss) best = { dirX, dirZ, speed, miss, holed: b.mode === 'holed' };
  }
  return best;
}

/** Ground rise per yard looking along (dirX, dirZ) from the ball. */
export function slopeAlong(world, ball, dirX, dirZ) {
  const g = [0, 0];
  world.gradAt(ball.x, ball.z, g);
  const ahead = (world.heightAt(ball.x + dirX * 1.5, ball.z + dirZ * 1.5) - world.heightAt(ball.x, ball.z)) / 1.5;
  return Math.max(g[0] * dirX + g[1] * dirZ, ahead);
}

export { BALL_R, CUP_R, createBall };

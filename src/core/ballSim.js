/**
 * Ball physics — pure and deterministic (no THREE, no DOM, no Math.random).
 *
 * One fixed-step integrator drives everything that needs to know where a ball
 * goes: the live shot, the aim preview, the putt line, the pace marker on the
 * putt meter, and the headless bot that play-tests generated courses. Because
 * they all share this code, the preview can never lie about the real shot.
 *
 * World interface (see course/courseWorld.js, or flatWorld() below):
 *   heightAt(x, z) -> ground height
 *   gradAt(x, z, out) -> writes [dh/dx, dh/dz] into out
 *   surfaceAt(x, z) -> 'tee' | 'fairway' | 'fringe' | 'green' | 'rough' | 'bunker' | 'water'
 *   waterLevelAt(x, z) -> water surface height, or -Infinity when not over a pond
 *   cup: { x, z } | null
 *   trees: [{ x, z, trunkR, trunkTop, cy, cr }]
 *   half: half-width of the playable tile (beyond it is out of bounds)
 *
 * Units: 1 world unit ≈ 1 yard, time in seconds.
 */

export const G = 9.81;
export const BALL_R = 0.05;
export const CUP_R = 0.22;
const CUP_RADIUS = CUP_R;
/** Fastest a dead-centre putt can be travelling and still drop. */
export const CUP_CAPTURE_SPEED = 2.4;
const CAPTURE = CUP_CAPTURE_SPEED;
export const SIM_DT = 1 / 120;

const DRAG = 0.0030;      // quadratic air drag
const LIFT = 0.0016;      // backspin lift per unit spin
const CURVE = 0.055;      // sidespin curve per unit spin
const WIND_PUSH = 0.11;   // acceleration per mph of wind

/**
 * Per-surface response. e: restitution, ft: tangential speed kept through a
 * bounce, mu0/mu1: rolling deceleration (constant + speed-proportional),
 * bite: how hard backspin checks the ball on landing.
 */
export const SURFACES = {
  tee:     { e: 0.40, ft: 0.60, mu0: 2.6, mu1: 0.5, bite: 0.5 },
  fairway: { e: 0.42, ft: 0.60, mu0: 2.6, mu1: 0.5, bite: 0.6 },
  fringe:  { e: 0.36, ft: 0.55, mu0: 1.4, mu1: 0.6, bite: 1.4 },
  green:   { e: 0.34, ft: 0.50, mu0: 0.8, mu1: 0.5, bite: 2.0 },
  rough:   { e: 0.20, ft: 0.40, mu0: 7.0, mu1: 1.0, bite: 0.2 },
  bunker:  { e: 0.05, ft: 0.25, mu0: 14,  mu1: 1.5, bite: 0.1 },
  water:   { e: 0.05, ft: 0.25, mu0: 14,  mu1: 1.5, bite: 0.1 },
};

export function createBall(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    back: 0,            // backspin 0..~1.6
    side: 0,            // sidespin, + curves right of the travel direction
    mode: 'rest',       // 'rest' | 'air' | 'roll' | 'holed' | 'water' | 'oob'
    surface: 'tee',
    time: 0,
    bounces: 0,
    landed: false,      // first ground contact of this shot has happened
    landX: 0, landZ: 0,
    dryX: x, dryZ: z,   // last in-bounds, non-water point passed over
    cupLock: false,     // already lipped out on this pass over the cup
    lastTree: -1,
    shot: 0,            // shot counter (salts deterministic deflections)
  };
}

export function copyBall(src, dst = {}) {
  return Object.assign(dst, src);
}

/** Put a resting ball on the ground at (x, z). */
export function placeBall(ball, world, x, z) {
  ball.x = x; ball.z = z;
  ball.y = world.heightAt(x, z) + BALL_R;
  ball.vx = ball.vy = ball.vz = 0;
  ball.back = ball.side = 0;
  ball.mode = 'rest';
  ball.surface = world.surfaceAt(x, z);
  ball.dryX = x; ball.dryZ = z;
  ball.cupLock = false;
  ball.lastTree = -1;
}

function beginShot(ball) {
  ball.time = 0;
  ball.bounces = 0;
  ball.landed = false;
  ball.cupLock = false;
  ball.lastTree = -1;
  ball.shot += 1;
}

/** Launch through the air. dir is a horizontal unit vector. */
export function launchBall(ball, { speed, dirX, dirZ, loftDeg, back = 0, side = 0 }) {
  beginShot(ball);
  const loft = (loftDeg * Math.PI) / 180;
  const h = Math.cos(loft) * speed;
  ball.vx = dirX * h;
  ball.vz = dirZ * h;
  ball.vy = Math.sin(loft) * speed;
  ball.back = back;
  ball.side = side;
  ball.y += 0.02;
  ball.mode = 'air';
}

/** Roll along the ground (putter). */
export function puttBall(ball, { speed, dirX, dirZ }) {
  beginShot(ball);
  ball.vx = dirX * speed;
  ball.vz = dirZ * speed;
  ball.vy = 0;
  ball.back = ball.side = 0;
  ball.landed = true;
  ball.landX = ball.x; ball.landZ = ball.z;
  ball.mode = 'roll';
}

const _grad = [0, 0];

// Cheap deterministic hash -> [0, 1) for deflections (no rng stream to keep in
// sync between the preview and the real shot).
function hash01(a, b) {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function markDry(ball, world, surface) {
  if (surface !== 'water' && Math.abs(ball.x) < world.half && Math.abs(ball.z) < world.half) {
    ball.dryX = ball.x; ball.dryZ = ball.z;
  }
}

function outOfBounds(ball, world) {
  return Math.abs(ball.x) > world.half || Math.abs(ball.z) > world.half;
}

/**
 * Advance one fixed step. Pushes { type, ... } records into `events`:
 *   land, bounce, roll, tree, splash, oob, lipout, holed, rest
 */
export function stepBall(ball, world, env, dt, events) {
  if (ball.mode === 'air') stepAir(ball, world, env, dt, events);
  else if (ball.mode === 'roll') stepRoll(ball, world, dt, events);
  else return;
  ball.time += dt;
}

function stepAir(ball, world, env, dt, events) {
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  const vh = Math.hypot(ball.vx, ball.vz);

  let ax = -DRAG * speed * ball.vx;
  let ay = -G - DRAG * speed * ball.vy;
  let az = -DRAG * speed * ball.vz;

  if (vh > 0.5) {
    // Backspin lift: perpendicular to velocity, in the vertical plane of travel
    const lift = LIFT * ball.back * speed;
    ax += lift * (-ball.vx * ball.vy / vh);
    ay += lift * vh;
    az += lift * (-ball.vz * ball.vy / vh);
    // Sidespin curve: + pushes to the right of travel
    const curve = CURVE * ball.side * speed;
    ax += curve * (-ball.vz / vh);
    az += curve * (ball.vx / vh);
  }
  if (env) {
    ax += (env.windX || 0) * WIND_PUSH;
    az += (env.windZ || 0) * WIND_PUSH;
  }

  ball.vx += ax * dt; ball.vy += ay * dt; ball.vz += az * dt;
  ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.z += ball.vz * dt;
  ball.back *= 1 - 0.06 * dt;
  ball.side *= 1 - 0.10 * dt;

  if (world.trees.length && hitTrees(ball, world, events)) return;

  const h = world.heightAt(ball.x, ball.z);
  if (ball.y - BALL_R > h) {
    // Still flying: remember the last dry land we passed over (drop point)
    if (((ball.time / dt) | 0) % 12 === 0) {
      markDry(ball, world, world.waterLevelAt(ball.x, ball.z) > h ? 'water' : 'land');
    }
    return;
  }

  // --- Ground contact ---
  if (outOfBounds(ball, world)) {
    ball.mode = 'oob';
    events.push({ type: 'oob', x: ball.x, y: h, z: ball.z });
    return;
  }
  const waterLevel = world.waterLevelAt(ball.x, ball.z);
  if (waterLevel > h + 0.02) {
    ball.mode = 'water';
    ball.y = waterLevel;
    events.push({ type: 'splash', x: ball.x, y: waterLevel, z: ball.z, speed });
    return;
  }

  const surface = world.surfaceAt(ball.x, ball.z);
  const S = SURFACES[surface] || SURFACES.rough;
  ball.surface = surface;
  ball.y = h + BALL_R;
  markDry(ball, world, surface);

  if (!ball.landed) {
    ball.landed = true;
    ball.landX = ball.x; ball.landZ = ball.z;
    events.push({ type: 'land', x: ball.x, y: h, z: ball.z, surface, speed });
  }

  // Flew straight into the cup
  if (world.cup && surface === 'green') {
    const d = Math.hypot(ball.x - world.cup.x, ball.z - world.cup.z);
    if (d < (world.cup.r || CUP_R) * 0.9 && speed < 30) {
      holeOut(ball, world, events, true);
      return;
    }
  }

  world.gradAt(ball.x, ball.z, _grad);
  let nx = -_grad[0], ny = 1, nz = -_grad[1];
  const nl = Math.hypot(nx, ny, nz);
  nx /= nl; ny /= nl; nz /= nl;

  const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz; // < 0 when hitting
  let tx = ball.vx - vn * nx, ty = ball.vy - vn * ny, tz = ball.vz - vn * nz;
  const tSpeed = Math.hypot(tx, ty, tz);
  const impact = -vn;

  if (impact < 1.3 || ball.bounces >= 6) {
    // Too soft to bounce: settle into a roll
    ball.vx = tx * 0.92; ball.vz = tz * 0.92; ball.vy = 0;
    ball.mode = 'roll';
    events.push({ type: 'roll', x: ball.x, y: h, z: ball.z, surface });
    return;
  }

  // Bounce. Hard impacts lose proportionally more energy (turf gives).
  const e = S.e * Math.max(0.3, Math.min(1, 1 - impact / 45));
  // Backspin checks the ball; on short grass a spinny wedge can zip back.
  let keep = tSpeed * S.ft - ball.back * S.bite * 3.2;
  const canSpinBack = surface === 'green' || surface === 'fringe';
  keep = Math.max(canSpinBack ? -2.5 : 0.15 * tSpeed, keep);
  const k = tSpeed > 1e-6 ? keep / tSpeed : 0;
  ball.vx = tx * k + nx * impact * e;
  ball.vy = ty * k + ny * impact * e;
  ball.vz = tz * k + nz * impact * e;
  ball.back *= 0.45;
  ball.side = 0;
  ball.bounces += 1;
  ball.y = h + BALL_R + 0.002;
  events.push({ type: 'bounce', x: ball.x, y: h, z: ball.z, surface, speed: impact });
}

function hitTrees(ball, world, events) {
  const trees = world.trees;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const dx = ball.x - t.x, dz = ball.z - t.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > t.cr * t.cr) continue;

    // Trunk: a solid post
    if (ball.y < t.trunkTop && d2 < (t.trunkR + BALL_R) ** 2) {
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d, nz = dz / d;
      const vn = ball.vx * nx + ball.vz * nz;
      if (vn < 0) {
        ball.vx = (ball.vx - 2 * vn * nx) * 0.4;
        ball.vz = (ball.vz - 2 * vn * nz) * 0.4;
        ball.vy *= 0.5;
        ball.x = t.x + nx * (t.trunkR + BALL_R + 0.01);
        ball.z = t.z + nz * (t.trunkR + BALL_R + 0.01);
        ball.side = 0;
        events.push({ type: 'tree', part: 'trunk', x: ball.x, y: ball.y, z: ball.z });
      }
      continue;
    }

    // Canopy: leaves rob most of the speed and knock the ball down
    const dy = ball.y - t.cy;
    if (i !== ball.lastTree && d2 + dy * dy < t.cr * t.cr) {
      ball.lastTree = i;
      const a = (hash01(i, ball.shot) - 0.5) * 1.6;
      const c = Math.cos(a), s = Math.sin(a);
      const vx = ball.vx * c - ball.vz * s, vz = ball.vx * s + ball.vz * c;
      ball.vx = vx * 0.3; ball.vz = vz * 0.3;
      ball.vy = Math.min(ball.vy * 0.3, 0) - 1.5;
      ball.back = 0; ball.side = 0;
      events.push({ type: 'tree', part: 'canopy', x: ball.x, y: ball.y, z: ball.z });
    }
  }
  return false;
}

function stepRoll(ball, world, dt, events) {
  const surface = world.surfaceAt(ball.x, ball.z);
  const S = SURFACES[surface] || SURFACES.rough;
  ball.surface = surface;

  world.gradAt(ball.x, ball.z, _grad);
  const gx = _grad[0], gz = _grad[1];
  const flat = 1 / (1 + gx * gx + gz * gz);
  let ax = -(5 / 7) * G * gx * flat;
  let az = -(5 / 7) * G * gz * flat;
  const slopeAcc = Math.hypot(ax, az);

  let speed = Math.hypot(ball.vx, ball.vz);

  // --- The cup ---
  const cup = world.cup;
  if (cup) {
    const cx = cup.x - ball.x, cz = cup.z - ball.z;
    const d = Math.hypot(cx, cz);
    // (most cups are regulation; the bucket hole's is enormous and forgiving)
    const CUP_R = cup.r || CUP_RADIUS;
    const CUP_CAPTURE_SPEED = CAPTURE * Math.sqrt(CUP_R / CUP_RADIUS);
    if (d < CUP_R) {
      if (!ball.cupLock) {
        if (speed < 0.05) { holeOut(ball, world, events, false); return; }
        // Impact parameter: how far off-centre the ball's line crosses the cup
        const cross = (ball.vx * cz - ball.vz * cx) / speed;
        const off = Math.min(1, Math.abs(cross) / CUP_R);
        const limit = CUP_CAPTURE_SPEED * Math.sqrt(1 - off * off);
        if (speed <= limit) { holeOut(ball, world, events, false); return; }
        // Too hot for that much of the hole: lip out
        ball.cupLock = true;
        const turn = Math.sign(cross || 1) * (0.25 + 0.9 * off);
        const c = Math.cos(turn), s = Math.sin(turn);
        const vx = ball.vx * c - ball.vz * s, vz = ball.vx * s + ball.vz * c;
        ball.vx = vx * 0.6; ball.vz = vz * 0.6;
        speed *= 0.6;
        events.push({ type: 'lipout', x: ball.x, y: ball.y, z: ball.z, speed });
      }
    } else {
      if (d > CUP_R * 1.4) ball.cupLock = false;
      // A dying ball at the edge topples in
      if (!ball.cupLock && d < CUP_R * 1.7 && speed < 0.9) {
        const pull = 2.4 * (1 - d / (CUP_R * 1.7));
        ax += (cx / d) * pull;
        az += (cz / d) * pull;
      }
    }
  }

  const mu = S.mu0 + S.mu1 * speed;

  if (speed < 0.07 && slopeAcc < S.mu0) {
    ball.vx = ball.vz = ball.vy = 0;
    ball.mode = 'rest';
    events.push({ type: 'rest', x: ball.x, y: ball.y, z: ball.z, surface });
    return;
  }

  ball.vx += ax * dt;
  ball.vz += az * dt;
  speed = Math.hypot(ball.vx, ball.vz);
  if (speed > 1e-6) {
    const k = Math.max(0, speed - mu * dt) / speed;
    ball.vx *= k; ball.vz *= k;
  }

  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;
  const h = world.heightAt(ball.x, ball.z);
  ball.y = h + BALL_R;

  if (outOfBounds(ball, world)) {
    ball.mode = 'oob';
    events.push({ type: 'oob', x: ball.x, y: h, z: ball.z });
    return;
  }
  const waterLevel = world.waterLevelAt(ball.x, ball.z);
  if (waterLevel > h + 0.02) {
    ball.mode = 'water';
    events.push({ type: 'splash', x: ball.x, y: waterLevel, z: ball.z, speed });
    return;
  }
  markDry(ball, world, surface);

  // Tree trunks stop a rolling ball dead-ish
  for (let i = 0; i < world.trees.length; i++) {
    const t = world.trees[i];
    const dx = ball.x - t.x, dz = ball.z - t.z;
    const rr = t.trunkR + BALL_R;
    if (dx * dx + dz * dz < rr * rr) {
      const d = Math.hypot(dx, dz) || 1e-6;
      const nx = dx / d, nz = dz / d;
      const vn = ball.vx * nx + ball.vz * nz;
      if (vn < 0) {
        ball.vx = (ball.vx - 2 * vn * nx) * 0.35;
        ball.vz = (ball.vz - 2 * vn * nz) * 0.35;
      }
      ball.x = t.x + nx * (rr + 0.01);
      ball.z = t.z + nz * (rr + 0.01);
    }
  }
}

function holeOut(ball, world, events, dunk) {
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  ball.mode = 'holed';
  ball.vx = ball.vy = ball.vz = 0;
  events.push({ type: 'holed', x: world.cup.x, y: ball.y, z: world.cup.z, dunk, speed });
}

/**
 * Run a ball until it stops. Mutates `ball`.
 * @returns {{ events: object[], points: number[], time: number }}
 *   points is a flat [x, y, z, ...] polyline when opts.sample > 0.
 */
export function simulate(ball, world, env, opts = {}) {
  const dt = opts.dt || SIM_DT;
  const maxTime = opts.maxTime || 30;
  const sample = opts.sample || 0;
  const stopOnLand = !!opts.stopOnLand;
  const events = [];
  const points = [];
  let nextSample = 0;
  let t = 0;
  if (sample) points.push(ball.x, ball.y, ball.z);
  while ((ball.mode === 'air' || ball.mode === 'roll') && t < maxTime) {
    stepBall(ball, world, env, dt, events);
    t += dt;
    if (sample && t >= nextSample) {
      points.push(ball.x, ball.y, ball.z);
      nextSample += sample;
    }
    if (stopOnLand && ball.landed) break;
  }
  if (sample) points.push(ball.x, ball.y, ball.z);
  return { events, points, time: t };
}

/** Infinite flat lawn — used to calibrate the club bag. */
export function flatWorld(surface = 'fairway') {
  return {
    heightAt: () => 0,
    gradAt: (x, z, out) => { out[0] = 0; out[1] = 0; },
    surfaceAt: () => surface,
    waterLevelAt: () => -Infinity,
    cup: null,
    trees: [],
    half: 1e9,
  };
}

import { createGameRng } from '../core/rng.js';

/**
 * The course generator — the heart of ThreeWood.
 *
 * Holes are designed like a level designer would, not a noise function:
 * pick an archetype, lay tee → landing → green along a spline, dress it with
 * hazards that create a strategy, then validate with a fitness function and
 * REJECT bad layouts. Everything is deterministic from the round seed.
 *
 * Coordinates: one 400×400 tile per hole, world units ≈ yards. Tee west,
 * green east. Play flows along the path polyline.
 */

// ---------------------------------------------------------------------------
// Path helpers (shared with terrain/minimap)
// ---------------------------------------------------------------------------

export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return len;
}

/** Point at distance `d` along the path. Returns { x, z, dirX, dirZ, segT }. */
export function pointAlongPath(path, d) {
  let remaining = d;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dz = path[i].z - path[i - 1].z;
    const segLen = Math.hypot(dx, dz);
    if (remaining <= segLen || i === path.length - 1) {
      const t = segLen > 0 ? Math.max(0, Math.min(1, remaining / segLen)) : 0;
      return {
        x: path[i - 1].x + dx * t,
        z: path[i - 1].z + dz * t,
        dirX: segLen > 0 ? dx / segLen : 1,
        dirZ: segLen > 0 ? dz / segLen : 0,
      };
    }
    remaining -= segLen;
  }
  const last = path[path.length - 1];
  return { x: last.x, z: last.z, dirX: 1, dirZ: 0 };
}

/** Distance from point to path polyline, plus where it lands. */
export function pathInfo(path, x, z) {
  let best = { dist: Infinity, along: 0, across: 0, dirX: 1, dirZ: 0 };
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x, az = path[i - 1].z;
    const dx = path[i].x - ax, dz = path[i].z - az;
    const segLen = Math.hypot(dx, dz);
    if (segLen === 0) continue;
    const ux = dx / segLen, uz = dz / segLen;
    const px = x - ax, pz = z - az;
    const proj = Math.max(0, Math.min(segLen, px * ux + pz * uz));
    const cx = ax + ux * proj, cz = az + uz * proj;
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < best.dist) {
      best = {
        dist,
        along: walked + proj,           // distance along path of nearest point
        across: (px * -uz + pz * ux),   // signed side distance (+ = left of dir)
        dirX: ux,
        dirZ: uz,
      };
    }
    walked += segLen;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Archetype grammar
// ---------------------------------------------------------------------------

export const ARCHETYPES = {
  straight: {
    label: 'Straightaway',
    blurb: 'Bunkers guard the landing zone. Find the short grass.',
  },
  doglegL: {
    label: 'Dogleg Left',
    blurb: 'Cut the corner over the trees for a short approach — or play safe.',
  },
  doglegR: {
    label: 'Dogleg Right',
    blurb: 'Cut the corner over the trees for a short approach — or play safe.',
  },
  overWater: {
    label: 'The Carry',
    blurb: 'Water between you and the flag. Commit to the carry.',
  },
  bottleneck: {
    label: 'The Chute',
    blurb: 'A narrow gate of trees. Thread it or lay up short.',
  },
  elevatedGreen: {
    label: 'The Tabletop',
    blurb: 'Elevated green with guarding bunkers. Long is dead.',
  },
};

// Par → [min, max] hole length (units ≈ yards)
export const PAR_BANDS = { 3: [100, 155], 4: [175, 245], 5: [255, 330] };
export const MAX_CARRY = 185; // longest forced carry a player can be asked to make
export const TILE_BOUND = 150; // keep features inside ±150 on a 400 tile

/**
 * Round pacing: which par + candidate archetypes for hole N (1-indexed).
 * A warm-up, a signature, a test — not N identical holes.
 */
export const ROUND_PLANS = [
  { par: 4, archetypes: ['straight', 'doglegL', 'doglegR'] },        // warm-up
  { par: 3, archetypes: ['overWater'] },                             // signature
  { par: 4, archetypes: ['bottleneck', 'elevatedGreen'] },           // the test
  { par: 5, archetypes: ['doglegL', 'doglegR'] },                    // reachable 5
  { par: 4, archetypes: ['straight', 'bottleneck'] },
  { par: 3, archetypes: ['elevatedGreen', 'overWater'] },
  { par: 4, archetypes: ['doglegL', 'doglegR'] },
  { par: 5, archetypes: ['doglegR', 'doglegL'] },
  { par: 4, archetypes: ['elevatedGreen', 'straight'] },             // closer
];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function layoutHole(rng, plan) {
  const { par, archetype } = plan;
  const band = PAR_BANDS[par];
  const totalLen = rng.range(band[0], band[1]);

  const tee = { x: -(115 + rng.range(0, 20)), z: rng.range(-60, 60) };
  const a1 = rng.range(-0.28, 0.28); // primary azimuth off +X

  let path, dogleg = null;
  if (archetype === 'doglegL' || archetype === 'doglegR') {
    const side = archetype === 'doglegL' ? 1 : -1;
    const angleDeg = rng.range(28, 46) * side;
    const l1 = totalLen * rng.range(0.55, 0.65);
    const l2 = totalLen - l1;
    const corner = {
      x: tee.x + Math.cos(a1) * l1,
      z: tee.z + Math.sin(a1) * l1,
    };
    const a2 = a1 + (angleDeg * Math.PI) / 180;
    const green = {
      x: corner.x + Math.cos(a2) * l2,
      z: corner.z + Math.sin(a2) * l2,
    };
    path = [tee, corner, green];
    dogleg = { corner, angleDeg, side };
  } else {
    const green = {
      x: tee.x + Math.cos(a1) * totalLen,
      z: tee.z + Math.sin(a1) * totalLen,
    };
    path = [tee, green];
  }
  const green = path[path.length - 1];

  const greenSize = par === 3 ? 13 : 15;
  const greenElev = archetype === 'elevatedGreen' ? rng.range(2, 3) : 0;
  const fairwayWidth = 22;

  // --- Landing zone (the strategic target) ---
  // Par 3s land on the green; longer holes target the 60% fairway zone.
  const landingPoint = par === 3
    ? { x: green.x, z: green.z }
    : pointAlongPath(path, totalLen * 0.6);
  const landingZone = { x: landingPoint.x, z: landingPoint.z, radius: par === 3 ? greenSize : 12 };

  // --- Hazards, per archetype (path-frame coordinates: along / across) ---
  const bunkers = [];
  const water = [];
  const trees = [];
  const half = fairwayWidth / 2;

  const addBunkerAt = (along, across, r) => {
    const p = pointAlongPath(path, along);
    bunkers.push({
      x: p.x + -p.dirZ * across,
      z: p.z + p.dirX * across,
      r,
    });
  };

  switch (archetype) {
    case 'straight': {
      addBunkerAt(totalLen * 0.6, +(half + 5), rng.range(6, 8));
      addBunkerAt(totalLen * 0.62, -(half + 5), rng.range(6, 8));
      if (rng.rng() < 0.5) addBunkerAt(totalLen * 0.92, rng.sign() * (greenSize + 3), rng.range(5, 6));
      break;
    }
    case 'doglegL':
    case 'doglegR': {
      // Inside-corner bunker punishes a lazy line; outside trees guard the cut
      const cornerAlong = pathLength([path[0], path[1]]);
      addBunkerAt(cornerAlong + 6, -dogleg.side * (half + 4), rng.range(6, 8));
      addBunkerAt(totalLen * 0.9, dogleg.side * (greenSize + 4), rng.range(5, 6));
      const cornerTrees = rng.int(8, 12);
      for (let i = 0; i < cornerTrees; i++) {
        const ang = rng.range(0, Math.PI * 2);
        const rad = rng.range(16, 34);
        trees.push({
          x: dogleg.corner.x + Math.cos(ang) * rad,
          z: dogleg.corner.z + Math.sin(ang) * rad,
          s: rng.range(0.9, 1.5),
        });
      }
      break;
    }
    case 'overWater': {
      // Pond guards the approach mid-hole; the tee shot must carry it.
      const pondAlong = totalLen * rng.range(0.5, 0.62);
      const p = pointAlongPath(path, pondAlong);
      const r = rng.range(20, 28);
      water.push({ x: p.x, z: p.z, r });
      if (rng.rng() < 0.6) addBunkerAt(totalLen * 0.93, rng.sign() * (greenSize + 3), rng.range(5, 6));
      break;
    }
    case 'bottleneck': {
      // Two tree lines forming a gate the drive must thread
      const gateAlong = totalLen * rng.range(0.5, 0.6);
      const gateHalfGap = rng.range(8, 10); // chute half-width (16–20 full)
      const lineLen = rng.int(5, 7);
      for (const side of [1, -1]) {
        for (let i = 0; i < lineLen; i++) {
          const along = gateAlong - 14 + i * 6 + rng.range(-1.5, 1.5);
          const across = side * (gateHalfGap + 3 + rng.range(0, 14));
          const p = pointAlongPath(path, along);
          trees.push({
            x: p.x + -p.dirZ * across + rng.range(-1, 1),
            z: p.z + p.dirX * across + rng.range(-1, 1),
            s: rng.range(1.0, 1.5),
          });
        }
      }
      addBunkerAt(totalLen * 0.8, +(half + 5), rng.range(5, 7));
      plan._gate = { along: gateAlong, gap: gateHalfGap * 2 };
      break;
    }
    case 'elevatedGreen': {
      addBunkerAt(totalLen * 0.9, +(greenSize * 0.8), rng.range(5, 6));
      addBunkerAt(totalLen * 0.9, -(greenSize * 0.8), rng.range(5, 6));
      break;
    }
  }

  // --- Scattered parkland trees in the rough (never in play corridors) ---
  const scattered = [];
  for (let i = 0; i < 80 && scattered.length < 55; i++) {
    const tx = rng.range(-175, 175);
    const tz = rng.range(-175, 175);
    const info = pathInfo(path, tx, tz);
    if (info.dist < half + 7) continue;
    if (Math.hypot(tx - tee.x, tz - tee.z) < 14) continue;
    if (Math.hypot(tx - green.x, tz - green.z) < greenSize + 9) continue;
    if (water.some(w => Math.hypot(tx - w.x, tz - w.z) < w.r + 4)) continue;
    if (bunkers.some(b => Math.hypot(tx - b.x, tz - b.z) < b.r + 4)) continue;
    if (trees.some(t => Math.hypot(tx - t.x, tz - t.z) < 5)) continue;
    if (scattered.some(t => Math.hypot(tx - t.x, tz - t.z) < 5)) continue;
    scattered.push({ x: tx, z: tz, s: rng.range(0.8, 1.4) });
  }
  trees.push(...scattered);

  // Carry demanded across water along the play line: walk the path in 1-unit
  // steps and measure the longest covered span (core of the pond only).
  const carryRequired = computeCarry(path, water);

  return {
    seed: plan.seed,
    number: plan.number,
    par,
    archetype,
    tee, green, greenSize, greenElev, fairwayWidth,
    path,
    landingZone,
    bunkers, water, trees,
    carryRequired,
    _gate: plan._gate || null,
    _dogleg: dogleg,
  };
}

// Exact organic coverage — the SAME formulas terrain.js carves with, so the
// fitness function can never disagree with the built hole.
function waterCovers(w, x, z, margin = 0) {
  const dx = x - w.x, dz = z - w.z;
  const d = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx);
  const organic = 1 + 0.3 * Math.sin(a * 3) + 0.2 * Math.sin(a * 5) + 0.15 * Math.sin(a * 7);
  return d < w.r * organic + margin;
}

function bunkerCovers(b, x, z, margin = 0) {
  const dx = x - b.x, dz = z - b.z;
  const d = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx);
  const organic = Math.max(0.5, 1 + 0.4 * Math.sin(a * 2) + 0.25 * Math.sin(a * 4) - 0.15 * Math.cos(a * 3));
  return d < b.r * organic + margin;
}

function computeCarry(path, water) {
  if (!water.length) return 0;
  const len = pathLength(path);
  let maxCarry = 0, cur = 0;
  for (let d = 0; d <= len; d += 1) {
    const p = pointAlongPath(path, d);
    const covered = water.some(w => waterCovers(w, p.x, p.z, -2));
    if (covered) {
      cur += 1;
      maxCarry = Math.max(maxCarry, cur);
    } else {
      cur = 0;
    }
  }
  return maxCarry;
}

// ---------------------------------------------------------------------------
// Fitness: fairness, readability, interest. Bad holes are REJECTED.
// ---------------------------------------------------------------------------

function evaluateFitness(spec) {
  const checks = {};
  const band = PAR_BANDS[spec.par];
  const len = pathLength(spec.path);

  // Fairness (exact coverage — same math the terrain carves with)
  checks.lengthInBand = len >= band[0] - 5 && len <= band[1] + 5;
  checks.carryOk = spec.carryRequired <= MAX_CARRY;
  checks.landingClear =
    !spec.water.some(w => waterCovers(w, spec.landingZone.x, spec.landingZone.z, 2)) &&
    !spec.bunkers.some(b => bunkerCovers(b, spec.landingZone.x, spec.landingZone.z, 2));
  checks.greenClear = !spec.water.some(w => waterCovers(w, spec.green.x, spec.green.z, 4));
  checks.teeClear =
    !spec.water.some(w => waterCovers(w, spec.tee.x, spec.tee.z, 6)) &&
    !spec.bunkers.some(b => bunkerCovers(b, spec.tee.x, spec.tee.z, 6));

  // Readability
  checks.inBounds =
    [spec.tee, spec.green, ...spec.path].every(p => Math.abs(p.x) <= TILE_BOUND && Math.abs(p.z) <= TILE_BOUND);
  checks.doglegOk = !spec._dogleg || (Math.abs(spec._dogleg.angleDeg) >= 24 && Math.abs(spec._dogleg.angleDeg) <= 50);
  checks.chuteOk = !spec._gate || spec._gate.gap >= 14;
  // An over-water hole must actually force a meaningful carry
  checks.waterOnLine = spec.archetype !== 'overWater' || spec.carryRequired >= 15;

  // Interest
  checks.hasHazards = spec.bunkers.length + spec.water.length > 0;

  const names = Object.keys(checks);
  const passed = names.filter(n => checks[n]).length;
  return {
    checks,
    score: passed / names.length,
    pass: names.every(n => checks[n]),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Design one hole. Deterministic from (seedString, holeNumber).
 * Re-rolls with attempt sub-seeds until the fitness function passes.
 */
export function designHole(seedString, holeNumber, request = {}) {
  const holeRng = createGameRng(`${seedString}:design-${holeNumber}`);
  const plan = ROUND_PLANS[(holeNumber - 1) % ROUND_PLANS.length];
  const par = request.par || plan.par;
  const archetype = request.archetype || holeRng.pick(plan.archetypes);

  let best = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = holeRng.fork(`attempt-${attempt}`);
    const spec = layoutHole(rng, { seed: seedString, number: holeNumber, par, archetype });
    const fitness = evaluateFitness(spec);
    spec.fitness = { ...fitness, attempts: attempt + 1 };
    if (fitness.pass) return spec;
    if (!best || fitness.score > best.fitness.score) best = spec;
  }
  // Should not happen; return the best-effort layout rather than crashing.
  best.fitness.bestEffort = true;
  return best;
}

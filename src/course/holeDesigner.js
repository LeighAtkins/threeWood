import { createGameRng } from '../core/rng.js';
import { BIOMES, biomeForHole } from './biomes.js';
import { pathLength, pointAlongPath, pathInfo, blobCovers, greenDistance } from './shapes.js';
import { courseTuning } from '../core/progression.js';

/**
 * The course generator.
 *
 * Holes are designed the way a level designer would, not by a noise function:
 * pick an archetype, lay tee -> corner -> green along a path, dress it with
 * hazards that create a decision, then check it for fairness and REJECT bad
 * layouts. Everything is deterministic from the round seed.
 *
 * Coordinates: one square tile per hole, world units ≈ yards. The hole is
 * laid out heading +X from the origin, then rotated and centred in the tile.
 */

export const TILE_HALF = 240;   // half-width of the terrain tile
export const PLAY_HALF = 228;   // beyond this is out of bounds
const FEATURE_BOUND = 205;      // tee/green/hazards must sit inside this

export const ARCHETYPES = {
  straight:      { label: 'Straightaway',  blurb: 'Bunkers pinch the landing zone. Find the short grass.' },
  doglegL:       { label: 'Dogleg Left',   blurb: 'Cut the corner over the trees, or play it safe.' },
  doglegR:       { label: 'Dogleg Right',  blurb: 'Cut the corner over the trees, or play it safe.' },
  doubleDogleg:  { label: 'The Serpent',   blurb: 'Two turns. Three good shots, or two great ones.' },
  overWater:     { label: 'The Carry',     blurb: 'Water between you and the flag. Commit.' },
  waterApproach: { label: 'The Moat',      blurb: 'A pond guards the front of the green.' },
  lakeside:      { label: 'Lakeside',      blurb: 'Water all down one side. Bail out the other.' },
  cape:          { label: 'The Cape',      blurb: 'Bite off as much lake as you dare.' },
  bottleneck:    { label: 'The Chute',     blurb: 'A narrow gate of trees. Thread it.' },
  elevatedGreen: { label: 'The Tabletop',  blurb: 'A raised green. Short rolls all the way back.' },
  potBunkers:    { label: 'Postage Stamp', blurb: 'A tiny target ringed with sand.' },
  dunes:         { label: 'The Gauntlet',  blurb: 'Bunkers staggered all the way home.' },
  islandGreen:   { label: 'The Island',    blurb: 'Nothing but green and water. Good luck.' },
};

// Par -> [min, max] hole length
export const PAR_BANDS = { 3: [100, 165], 4: [255, 320], 5: [350, 400] };

/**
 * The 18-hole routing (par 72). Pacing is authored: a gentle open, a
 * signature hole in each third, and the island green at 17. Which world
 * each three-hole stretch is played in comes from the seed (biomes.js).
 */
export const ROUND_PLAN = [
  { par: 4, archetypes: ['straight'] },
  { par: 4, archetypes: ['doglegR', 'doglegL'] },
  { par: 3, archetypes: ['overWater'] },
  { par: 5, archetypes: ['doglegL', 'doglegR'] },
  { par: 4, archetypes: ['bottleneck'] },
  { par: 3, archetypes: ['elevatedGreen'] },
  { par: 4, archetypes: ['lakeside'] },
  { par: 5, archetypes: ['dunes'] },
  { par: 4, archetypes: ['elevatedGreen', 'dunes'] },
  { par: 4, archetypes: ['doglegL', 'doglegR'] },
  { par: 3, archetypes: ['potBunkers'] },
  { par: 5, archetypes: ['lakeside', 'cape'] },
  { par: 4, archetypes: ['bottleneck', 'straight'] },
  { par: 4, archetypes: ['waterApproach'] },
  { par: 5, archetypes: ['doubleDogleg'] },
  { par: 4, archetypes: ['cape'] },
  { par: 3, archetypes: ['islandGreen'] },
  { par: 4, archetypes: ['lakeside', 'waterApproach'] },
];

/** Which course holes make up a round of the given length. */
export function roundHoles(length) {
  if (length >= 18) return ROUND_PLAN.map((_, i) => i + 1);
  if (length === 9) return [1, 3, 4, 7, 9, 11, 15, 17, 18];
  return [1, 3, 17].slice(0, length);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function layoutHole(rng, plan) {
  const { par, archetype } = plan;
  const biome = BIOMES[plan.biome];
  const band = PAR_BANDS[par];
  // The course tightens as the round goes on (core/progression.js)
  const tune = courseTuning(plan.number);
  let totalLen = rng.range(band[0], band[1]);
  if (archetype === 'islandGreen') totalLen = rng.range(100, 125);
  if (archetype === 'potBunkers') totalLen = rng.range(95, 120);
  if (archetype === 'overWater') totalLen = rng.range(120, 150);

  const tee = { x: 0, z: 0 };
  const at = (len, ang, from = tee) => ({ x: from.x + Math.cos(ang) * len, z: from.z + Math.sin(ang) * len });
  const rad = (deg) => (deg * Math.PI) / 180;

  let path;
  let dogleg = null;
  if (archetype === 'doglegL' || archetype === 'doglegR' || archetype === 'cape') {
    const side = archetype === 'doglegL' ? 1 : archetype === 'doglegR' ? -1 : rng.sign();
    const angle = rad(rng.range(26, 44)) * side;
    const l1 = totalLen * rng.range(0.56, 0.64);
    const corner = at(l1, 0);
    path = [tee, corner, at(totalLen - l1, angle, corner)];
    dogleg = { corner, side, l1 };
  } else if (archetype === 'doubleDogleg') {
    const side = rng.sign();
    const a1 = rad(rng.range(20, 30)) * side;
    const l1 = totalLen * 0.45, l2 = totalLen * 0.3;
    const c1 = at(l1, 0);
    const c2 = at(l2, a1, c1);
    path = [tee, c1, c2, at(totalLen - l1 - l2, 0, c2)];
    dogleg = { corner: c1, side, l1 };
  } else if (par > 3) {
    // "Straight" holes still drift a little so no two play the same line
    const mid = { x: totalLen * 0.5, z: rng.range(-9, 9) };
    path = [tee, mid, { x: totalLen, z: 0 }];
  } else {
    path = [tee, { x: totalLen, z: 0 }];
  }
  totalLen = pathLength(path);
  const greenPt = path[path.length - 1];
  const prev = path[path.length - 2];

  const green = {
    x: greenPt.x,
    z: greenPt.z,
    size: archetype === 'potBunkers' ? 11.5 : par === 3 ? rng.range(13, 15) : rng.range(14, 16.5),
    angle: Math.atan2(greenPt.z - prev.z, greenPt.x - prev.x),
    elev: archetype === 'elevatedGreen' ? rng.range(1.8, 2.8) : 0,
    tiltAngle: rng.range(0, Math.PI * 2),
    tilt: rng.range(0.008, 0.024) * tune.slope,
    undulation: biome.greenUndulation * rng.range(0.8, 1.25) * tune.slope,
  };

  const fairwayHalf = (par === 5 ? 12 : 13) * tune.fairway;
  // Where the short grass starts: par 3s only get an apron near the green
  let fairwayStart = par === 3 ? totalLen - green.size * 2.4 : rng.range(28, 40);

  const bunkers = [];
  const water = [];
  const trees = [];

  const offPath = (along, across) => {
    const p = pointAlongPath(path, along);
    return { x: p.x - p.dirZ * across, z: p.z + p.dirX * across };
  };
  const addBunker = (along, across, r, depth = 0.5) => {
    bunkers.push({ ...offPath(along, across), r, depth, phase: rng.range(0, 6.28), wobble: 0.9 });
  };
  const addPond = (center, r, wobble = 1) => {
    water.push({ x: center.x, z: center.z, r, wobble, phase: rng.range(0, 6.28) });
  };
  const greenside = () => {
    if (rng.rng() < 0.75) addBunker(totalLen - rng.range(2, 8), rng.sign() * (green.size + 5), rng.range(4.5, 6));
  };

  switch (archetype) {
    case 'straight': {
      addBunker(totalLen * 0.64, fairwayHalf + 6, rng.range(6, 8));
      addBunker(totalLen * 0.70, -(fairwayHalf + 6), rng.range(6, 8));
      greenside();
      break;
    }
    case 'doglegL':
    case 'doglegR': {
      addBunker(dogleg.l1 + 10, -dogleg.side * (fairwayHalf + 5), rng.range(6, 8));
      addBunker(totalLen - 6, dogleg.side * (green.size + 5), rng.range(5, 6));
      // A stand of trees on the inside of the corner guards the short cut
      const n = rng.int(7, 10);
      for (let i = 0; i < n; i++) {
        const along = dogleg.l1 + rng.range(-34, 12);
        const across = dogleg.side * (fairwayHalf + rng.range(7, 30));
        trees.push({ ...offPath(along, across), s: rng.range(1.0, 1.4) });
      }
      break;
    }
    case 'doubleDogleg': {
      addBunker(dogleg.l1 + 8, -dogleg.side * (fairwayHalf + 5), rng.range(6, 8));
      addBunker(totalLen * 0.72, dogleg.side * (fairwayHalf + 5), rng.range(6, 8));
      greenside();
      break;
    }
    case 'cape': {
      // Lake fills the inside of the corner: the brave line carries it
      const r = rng.range(30, 38);
      const inside = offPath(dogleg.l1 - 8, dogleg.side * (fairwayHalf * 0.5 + r));
      addPond(inside, r, 0.7);
      addBunker(dogleg.l1 + 14, -dogleg.side * (fairwayHalf + 5), rng.range(6, 7));
      greenside();
      break;
    }
    case 'overWater': {
      const r = rng.range(24, 32);
      addPond(offPath(totalLen * rng.range(0.42, 0.52), 0), r);
      fairwayStart = totalLen - green.size * 2.2;
      greenside();
      break;
    }
    case 'waterApproach': {
      const r = rng.range(17, 22);
      addPond(offPath(totalLen - green.size * 1.5 - r - 6, rng.range(-6, 6)), r, 0.8);
      addBunker(totalLen + 2, rng.sign() * (green.size + 5), rng.range(5, 6));
      break;
    }
    case 'lakeside': {
      const side = rng.sign();
      const r = rng.range(30, 40);
      addPond(offPath(totalLen * rng.range(0.55, 0.68), side * (fairwayHalf * 0.55 + r)), r, 0.8);
      addBunker(totalLen * 0.62, -side * (fairwayHalf + 6), rng.range(6, 8));
      greenside();
      break;
    }
    case 'bottleneck': {
      const gateAlong = totalLen * rng.range(0.56, 0.64);
      const gap = rng.range(11, 13);
      for (const side of [1, -1]) {
        for (let i = 0; i < 4; i++) {
          const along = gateAlong - 16 + i * 10 + rng.range(-2, 2);
          trees.push({ ...offPath(along, side * (gap + 4.5 + rng.range(0, 3))), s: rng.range(1.1, 1.4) });
          trees.push({ ...offPath(along + 4, side * (gap + 14 + rng.range(0, 8))), s: rng.range(1.0, 1.4) });
        }
      }
      addBunker(totalLen * 0.84, rng.sign() * (fairwayHalf + 5), rng.range(5, 7));
      greenside();
      break;
    }
    case 'elevatedGreen': {
      addBunker(totalLen - 4, green.size + 5, rng.range(5, 6), 0.7);
      addBunker(totalLen - 4, -(green.size + 5), rng.range(5, 6), 0.7);
      if (par > 3) addBunker(totalLen * 0.66, rng.sign() * (fairwayHalf + 6), rng.range(6, 8));
      break;
    }
    case 'potBunkers': {
      const n = 5;
      const start = rng.range(0, 6.28);
      for (let i = 0; i < n; i++) {
        const a = start + (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
        bunkers.push({
          x: green.x + Math.cos(a) * (green.size * 1.32 + 3),
          z: green.z + Math.sin(a) * (green.size * 1.2 + 3),
          r: rng.range(3.2, 4.2), depth: 0.95, phase: rng.range(0, 6.28), wobble: 0.5,
        });
      }
      break;
    }
    case 'dunes': {
      let side = rng.sign();
      for (let f = 0.34; f < 0.9; f += rng.range(0.13, 0.18)) {
        addBunker(totalLen * f, side * (fairwayHalf + rng.range(3, 7)), rng.range(5, 7.5), 0.7);
        side = -side;
      }
      greenside();
      break;
    }
    case 'islandGreen': {
      addPond({ x: green.x, z: green.z }, green.size * 2.7, 0.3);
      fairwayStart = totalLen; // no fairway: it's all carry
      break;
    }
  }

  // --- Pin: somewhere honest on the putting surface ---
  let pin = { x: green.x, z: green.z };
  for (let i = 0; i < 30; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(tune.pinNear, tune.pinFar) * green.size;
    const c = { x: green.x + Math.cos(a) * d, z: green.z + Math.sin(a) * d };
    if (greenDistance(green, c.x, c.z) < tune.pinEdge) { pin = c; break; }
  }

  // --- Scattered trees in the rough (never in the play corridor) ---
  const blocked = (x, z, pad) =>
    Math.hypot(x - tee.x, z - tee.z) < 16 + pad ||
    greenDistance(green, x, z) < 1.55 + pad / green.size ||
    water.some((w) => blobCovers(w, x, z, 5 + pad)) ||
    bunkers.some((b) => blobCovers(b, x, z, 4 + pad));

  for (let i = trees.length - 1; i >= 0; i--) {
    if (blocked(trees[i].x, trees[i].z, 0)) trees.splice(i, 1);
  }
  const corridor = fairwayHalf + 10;
  const span = totalLen * 0.5 + 95;
  const cx = (tee.x + greenPt.x) / 2, cz = (tee.z + greenPt.z) / 2;
  for (let i = 0; i < biome.treeCount * 5 && trees.length < biome.treeCount; i++) {
    const x = cx + rng.range(-span, span);
    const z = cz + rng.range(-span, span);
    const info = pathInfo(path, x, z);
    if (info.dist < corridor || info.dist > 120) continue;
    if (blocked(x, z, 2)) continue;
    if (trees.some((t) => Math.hypot(x - t.x, z - t.z) < 8)) continue;
    trees.push({ x, z, s: rng.range(0.8, 1.35) });
  }

  // --- Rotate the whole hole and centre it in the tile ---
  const theta = rng.range(0, Math.PI * 2);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const rot = (p) => {
    const x = p.x * cosT - p.z * sinT, z = p.x * sinT + p.z * cosT;
    p.x = x; p.z = z;
  };
  const pathPts = path.map((p) => ({ ...p }));
  pathPts.forEach(rot);
  for (const p of pathPts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const ox = -(minX + maxX) / 2, oz = -(minZ + maxZ) / 2;
  const move = (p) => { rot(p); p.x += ox; p.z += oz; };
  pathPts.forEach((p) => { p.x += ox; p.z += oz; });
  [green, pin, ...bunkers, ...water, ...trees].forEach(move);
  green.angle += theta;
  green.tiltAngle += theta;

  const windSpeed = Math.round(rng.range(biome.wind[0], biome.wind[1]) * tune.wind);
  const windAngle = rng.range(0, Math.PI * 2);

  const spec = {
    seed: plan.seed,
    number: plan.number,
    par,
    archetype,
    biome: biome.id,
    length: Math.round(totalLen),
    path: pathPts,
    tee: { x: pathPts[0].x, z: pathPts[0].z },
    green,
    pin,
    fairwayHalf,
    fairwayStart,
    bunkers,
    water,
    trees,
    difficulty: tune.difficulty,
    wind: { speed: windSpeed, x: Math.cos(windAngle) * windSpeed, z: Math.sin(windAngle) * windSpeed },
  };
  spec.carryRequired = computeCarry(spec);
  return spec;
}

/** Longest stretch of water the play line crosses. */
function computeCarry(spec) {
  if (!spec.water.length) return 0;
  const len = pathLength(spec.path);
  let maxCarry = 0, cur = 0;
  for (let d = 0; d <= len; d += 1) {
    const p = pointAlongPath(spec.path, d);
    const wet = greenDistance(spec.green, p.x, p.z) > 1.15 && spec.water.some((w) => blobCovers(w, p.x, p.z));
    cur = wet ? cur + 1 : 0;
    maxCarry = Math.max(maxCarry, cur);
  }
  return maxCarry;
}

// ---------------------------------------------------------------------------
// Fitness: fairness and readability. Bad holes are rejected and re-rolled.
// ---------------------------------------------------------------------------

function evaluateFitness(spec) {
  const checks = {};
  const { green, tee, pin } = spec;
  const wetAt = (x, z, m) => spec.water.some((w) => blobCovers(w, x, z, m));
  const sandAt = (x, z, m) => spec.bunkers.some((b) => blobCovers(b, x, z, m));

  checks.inBounds = [...spec.path, ...spec.water, ...spec.bunkers].every(
    (p) => Math.abs(p.x) + (p.r || 0) <= FEATURE_BOUND && Math.abs(p.z) + (p.r || 0) <= FEATURE_BOUND);
  checks.teeClear = !wetAt(tee.x, tee.z, 12) && !sandAt(tee.x, tee.z, 8);
  checks.pinClear = !sandAt(pin.x, pin.z, 4);
  checks.greenDry = spec.archetype === 'islandGreen' || !wetAt(green.x, green.z, green.size * 0.9);
  checks.carryOk = spec.carryRequired <= 120;
  checks.waterInPlay = !['overWater', 'islandGreen'].includes(spec.archetype) || spec.carryRequired >= 18;

  // The drive needs somewhere dry to land (par 4/5)
  if (spec.par > 3) {
    let ok = false;
    for (let d = 150; d <= 195; d += 5) {
      const p = pointAlongPath(spec.path, Math.min(d, spec.length - 30));
      if (!wetAt(p.x, p.z, 3) && !sandAt(p.x, p.z, 1)) { ok = true; break; }
    }
    checks.landingClear = ok;
  }

  const names = Object.keys(checks);
  const passed = names.filter((n) => checks[n]).length;
  return { checks, score: passed / names.length, pass: passed === names.length };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Design hole `holeNumber` (1..18) of the course grown from `seedString`.
 * Re-rolls with attempt sub-seeds until the fitness checks pass.
 */
export function designHole(seedString, holeNumber, request = {}) {
  const holeRng = createGameRng(`${seedString}:design-${holeNumber}`);
  const plan = ROUND_PLAN[(holeNumber - 1) % ROUND_PLAN.length];
  const archetype = request.archetype || holeRng.pick(plan.archetypes);
  const par = request.par || plan.par;
  const biome = request.biome || biomeForHole(seedString, holeNumber);

  let best = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = holeRng.fork(`attempt-${attempt}`);
    const spec = layoutHole(rng, { seed: seedString, number: holeNumber, par, archetype, biome });
    const fitness = evaluateFitness(spec);
    spec.fitness = { ...fitness, attempts: attempt + 1 };
    if (fitness.pass) return spec;
    if (!best || fitness.score > best.fitness.score) best = spec;
  }
  best.fitness.bestEffort = true;
  return best;
}

import { createGameRng } from '../core/rng.js';
import { BIOMES } from './biomes.js';
import { TILE_HALF, PLAY_HALF } from './holeDesigner.js';
import {
  smoothstep, lerp, pathLength, pathInfo, blobRadius, blobCovers, greenDistance, FRINGE_EDGE, laneRails,
} from './shapes.js';

/**
 * The playable world for one hole, built from a HoleSpec.
 *
 * The analytic surface model (rolling ground, fairway, tee, green contours,
 * ponds, bunkers) is sampled ONCE onto a rectilinear grid — coarse across the
 * tile, fine over the green where putts need real contours. That grid is then
 * the single source of truth: the terrain mesh is built from its vertices and
 * the physics reads heights/slopes/surfaces back out of it, so the ball always
 * sits exactly on what you can see. Pure module (no THREE).
 */

export const SURFACE_IDS = ['rough', 'fairway', 'fringe', 'green', 'tee', 'bunker', 'water'];
const ID = Object.fromEntries(SURFACE_IDS.map((s, i) => [s, i]));

const COARSE = 2.5;   // grid spacing across the tile
const FINE = 0.5;     // grid spacing over the green
// How far past a pond's blob outline its water surface is drawn (scenery.js)
export const WATER_DRAWN = 1.2;
const TEE_RADIUS = 4.6;   // room for a front row of four
// The back tier of the tee: starts `back` m behind the tee point, drops `drop`
// m over `ramp` m, runs `depth` m back and `half` m to either side
const TEE_STEP = { back: 1.6, ramp: 1.2, drop: 0.7, depth: 9.6, half: 4.6 };
const TEE_FINE = 1.25;   // grid spacing around the tee (the step needs a crisp edge)

export function buildWorld(spec) {
  const biome = BIOMES[spec.biome];
  const noise = createGameRng(`${spec.seed}:terrain-${spec.number}`).noise2D;
  const { green, path } = spec;
  const totalLen = pathLength(path);

  // --- Analytic height model -------------------------------------------------
  const low = (x, z) => biome.base + biome.amp1 * noise(x * 0.006, z * 0.006);
  const detail = (x, z) => biome.amp2 * noise(x * 0.024 + 50, z * 0.024 - 50);

  // --- The lie of the land: big shapes that make a hole play differently ------
  // (spec.shape, from the designer). Everything here is smooth, so the grid,
  // the mesh and the physics all inherit it without knowing.
  const shape = spec.shape || null;
  const lift = (info, x, z) => {
    if (!shape) return 0;
    const t = Math.max(0, Math.min(1, info.along / totalLen));
    const half = spec.fairwayHalf;
    switch (shape.kind) {
      case 'drop':      // tee on the cliff top, the hole falls away below
        return shape.h * (1 - smoothstep(0.04, 0.6, t));
      case 'climb':     // every yard uphill
        return shape.h * smoothstep(0.25, 0.95, t);
      case 'halfpipe': { // banks either side feed the ball to the middle
        const along = smoothstep(0.08, 0.2, t) * (1 - smoothstep(0.82, 0.94, t));
        return shape.h * smoothstep(half * 0.45, half + 15, info.dist) * along;
      }
      case 'hogsback': { // the fairway is the crown of a ridge
        const along = smoothstep(0.1, 0.25, t) * (1 - smoothstep(0.75, 0.9, t));
        return shape.h * (1 - smoothstep(half * 0.3, half + 12, info.dist)) * along;
      }
      case 'terraces': { // shelves stepping down to the green
        const n = shape.steps, f = t * n, k = Math.floor(f);
        return shape.h * (n - (k + smoothstep(0.72, 1, f - k))) / n * (1 - smoothstep(0.9, 1, t));
      }
      case 'gorge': {   // a ravine across the line of play
        const u = (info.along - shape.at * totalLen) / shape.w;
        return -shape.h * Math.exp(-u * u);
      }
      case 'punchbowl': { // a rim of high ground all round the green
        const gd = greenDistance(green, x, z);
        return shape.h * smoothstep(1.15, 2.1, gd) * (1 - smoothstep(2.6, 4.2, gd));
      }
      default:
        return 0;
    }
  };
  const infoAt = (p) => pathInfo(path, p.x, p.z);

  const teeY = low(spec.tee.x, spec.tee.z) + lift(infoAt(spec.tee), spec.tee.x, spec.tee.z) + 0.4;
  // The tee's second tier: a step DOWN behind the front row (see TEE_SLOTS),
  // so a room of eight tees off from two levels. Down rather than up: from
  // the front row's cameras the back row then sits under the line of sight
  // to the ball, not across it.
  const teeFwd = (() => { const dx = path[1].x - path[0].x, dz = path[1].z - path[0].z, d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; })();
  const stepAt = (x, z) => {
    const dx = x - spec.tee.x, dz = z - spec.tee.z;
    const behind = -(dx * teeFwd.x + dz * teeFwd.z);
    const lat = Math.abs(-dx * teeFwd.z + dz * teeFwd.x);
    if (behind <= 0 || behind > TEE_STEP.depth + 2.4 || lat > TEE_STEP.half + 2) return null;
    const drop = TEE_STEP.drop * smoothstep(TEE_STEP.back, TEE_STEP.back + TEE_STEP.ramp, behind);
    const w = (1 - smoothstep(TEE_STEP.half, TEE_STEP.half + 1.8, lat)) * (1 - smoothstep(TEE_STEP.depth, TEE_STEP.depth + 2.4, behind));
    return { w, h: teeY - drop, onStep: behind < TEE_STEP.depth && lat < TEE_STEP.half };
  };
  const greenY = Math.max(0.6, low(green.x, green.z)) + lift(infoAt(green), green.x, green.z) + green.elev;
  const tiltX = Math.cos(green.tiltAngle) * green.tilt;
  const tiltZ = Math.sin(green.tiltAngle) * green.tilt;
  const greenBlend = 0.32 + green.elev * 0.14;

  const fairwayHalfAt = (along) => {
    const t = along / totalLen;
    return spec.fairwayHalf * (1 + 0.18 * Math.sin(t * Math.PI * 2.3 + spec.number));
  };

  // Ground before tee/green/hazards
  const ground = (x, z, info) => {
    const l = low(x, z);
    const d = detail(x, z);
    const half = fairwayHalfAt(info.along);
    const w = info.along < spec.fairwayStart - 6 ? 0 : 1 - smoothstep(half, half + 14, info.dist);
    return l + d * lerp(1, 0.2, w) + lift(info, x, z);
  };

  // (crazy golf: no pond may reach the table; the lane is all rails and turf)
  const tableClear = (w) => !green.channel || pathInfo(green.channel.pts, w.x, w.z).dist - w.r * 1.7 > laneRails(green.channel).side + 1;
  const ponds = spec.water.filter(tableClear).map((w) => {
    const info = pathInfo(path, w.x, w.z);
    return { ...w, level: Math.min(ground(w.x, w.z, info), low(w.x, w.z)) - 0.55 };
  });
  const bunkers = spec.bunkers.map((b) => ({ ...b }));

  // Crazy golf: a flat table right up to the rails (which are real walls:
  // see ballSim), the ground rising only outside them, and a hump across the
  // whole width to roll over
  const channel = green.channel;
  const rails = channel ? laneRails(channel) : null;
  const lane = (x, z) => {
    const info = pathInfo(channel.pts, x, z);
    const wall = 1.0 * smoothstep(rails.side + 0.15, rails.side + 1.2, info.dist);
    const u = (info.along - shape.at * totalLen) / 3.2;
    return wall + shape.hump * Math.exp(-u * u) * (1 - smoothstep(rails.side - 0.4, rails.side, info.dist));
  };
  const greenSurface = (x, z) =>
    greenY + tiltX * (x - green.x) + tiltZ * (z - green.z) +
    green.undulation * noise(x * 0.055 + 200, z * 0.055 + 200) +
    (channel ? lane(x, z) : 0);

  /** Height with everything except bunkers (bunker floors reference this). */
  const baseHeight = (x, z) => {
    const info = pathInfo(path, x, z);
    let h = ground(x, z, info);

    for (const p of ponds) {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > p.r * 2.2) continue;
      const edge = blobRadius(p, Math.atan2(dz, dx));
      const bank = p.level + 0.22;
      // Keep the banks above the waterline so the pond has a clean shore
      const shore = Math.max(h, bank);
      h = lerp(shore, h, smoothstep(edge * 1.25, edge * 1.6, d));
      if (d < edge) h = lerp(p.level - 0.8, h, smoothstep(edge * 0.72, edge, d));
    }

    const teeD = Math.hypot(x - spec.tee.x, z - spec.tee.z);
    // A cliff-top tee is a proper platform, not a pimple
    const teeOut = shape?.kind === 'drop' ? 5 : 2.2;
    if (!green.channel && teeD < TEE_RADIUS * teeOut) h = lerp(teeY, h, smoothstep(TEE_RADIUS, TEE_RADIUS * teeOut, teeD));
    if (!green.channel) { const st = stepAt(x, z); if (st) h = lerp(h, st.h, st.w); }

    const gd = greenDistance(green, x, z);
    if (gd < FRINGE_EDGE + greenBlend) {
      h = lerp(greenSurface(x, z), h, smoothstep(FRINGE_EDGE, FRINGE_EDGE + greenBlend, gd));
    }
    return h;
  };

  // Bunkers are dished relative to the ground they sit on, so one cut into a
  // bank never grows a wall you cannot splash out over.
  const height = (x, z) => {
    let h = baseHeight(x, z);
    for (const b of bunkers) {
      const dx = x - b.x, dz = z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > b.r * 1.7) continue;
      const edge = blobRadius(b, Math.atan2(dz, dx));
      if (d >= edge) continue;
      // Never dig into the putting surface
      const keep = smoothstep(1.0, FRINGE_EDGE, greenDistance(green, x, z));
      const t = smoothstep(edge * 0.4, edge, d);
      h -= b.depth * (1 - t) * keep;
    }
    return h;
  };

  const surfaceType = (x, z, h) => {
    const gd = greenDistance(green, x, z);
    if (gd < 1) return ID.green;
    if (gd < FRINGE_EDGE) return ID.fringe;
    if (Math.hypot(x - spec.tee.x, z - spec.tee.z) < TEE_RADIUS) return ID.tee;
    if (!green.channel && stepAt(x, z)?.onStep) return ID.tee;
    // (water where it is drawn: the same edge the splash check uses)
    for (const p of ponds) if (h < p.level + 0.04 && Math.hypot(x - p.x, z - p.z) < blobRadius(p, Math.atan2(z - p.z, x - p.x)) * WATER_DRAWN) return ID.water;
    for (const b of bunkers) if (blobCovers(b, x, z)) return ID.bunker;
    const info = pathInfo(path, x, z);
    if (info.along >= spec.fairwayStart && info.dist <= fairwayHalfAt(info.along)) return ID.fairway;
    return ID.rough;
  };

  // --- Grid axes: coarse everywhere, fine over the green, finer round the tee ---
  // Band edges sit on the coarse grid and every band step divides COARSE, so
  // walking the axis lands exactly on each edge.
  const band = (center, r, step) => ({ lo: Math.floor((center - r) / COARSE) * COARSE, hi: Math.ceil((center + r) / COARSE) * COARSE, step });
  const axis = (bands) => {
    const out = [];
    let v = -TILE_HALF;
    while (v <= TILE_HALF + 1e-6) {
      out.push(v);
      let step = COARSE;
      for (const b of bands) if (v >= b.lo - 1e-6 && v < b.hi - 1e-6) step = Math.min(step, b.step);
      let next = v + step;
      for (const b of bands) if (v < b.lo - 1e-6 && next > b.lo + 1e-6) next = b.lo;
      v = next;
    }
    return Float32Array.from(out);
  };
  const teeR = TEE_STEP.depth + 3;
  const xs = axis([band(green.x, green.size * 1.75, FINE), band(spec.tee.x, teeR, TEE_FINE)]);
  const zs = axis([band(green.z, green.size * 1.75, FINE), band(spec.tee.z, teeR, TEE_FINE)]);
  const nx = xs.length, nz = zs.length;

  // Bucket lookup: world coord -> cell index in O(1)
  const BUCKET = FINE;
  const nBuckets = Math.ceil((TILE_HALF * 2) / BUCKET) + 1;
  const lut = (arr) => {
    const out = new Uint16Array(nBuckets);
    let i = 0;
    for (let b = 0; b < nBuckets; b++) {
      const v = -TILE_HALF + b * BUCKET;
      while (i < arr.length - 2 && arr[i + 1] <= v + 1e-6) i++;
      out[b] = i;
    }
    return out;
  };
  const lutX = lut(xs), lutZ = lut(zs);
  const cell = (arr, table, v) => {
    const b = Math.max(0, Math.min(nBuckets - 1, ((v + TILE_HALF) / BUCKET) | 0));
    let i = table[b];
    while (i < arr.length - 2 && arr[i + 1] <= v) i++;
    return i;
  };

  const heights = new Float32Array(nx * nz);
  const types = new Uint8Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const h = height(xs[ix], zs[iz]);
      heights[ix * nz + iz] = h;
      types[ix * nz + iz] = surfaceType(xs[ix], zs[iz], h);
    }
  }

  // --- Queries (bilinear over the grid) --------------------------------------
  const clampT = (v) => Math.max(-TILE_HALF, Math.min(TILE_HALF - 1e-3, v));

  const heightAt = (x, z) => {
    x = clampT(x); z = clampT(z);
    const ix = cell(xs, lutX, x), iz = cell(zs, lutZ, z);
    const fx = (x - xs[ix]) / (xs[ix + 1] - xs[ix]);
    const fz = (z - zs[iz]) / (zs[iz + 1] - zs[iz]);
    const i = ix * nz + iz;
    const h00 = heights[i], h01 = heights[i + 1], h10 = heights[i + nz], h11 = heights[i + nz + 1];
    return (h00 * (1 - fz) + h01 * fz) * (1 - fx) + (h10 * (1 - fz) + h11 * fz) * fx;
  };

  const gradAt = (x, z, out) => {
    x = clampT(x); z = clampT(z);
    const ix = cell(xs, lutX, x), iz = cell(zs, lutZ, z);
    const dx = xs[ix + 1] - xs[ix], dz = zs[iz + 1] - zs[iz];
    const fx = (x - xs[ix]) / dx, fz = (z - zs[iz]) / dz;
    const i = ix * nz + iz;
    const h00 = heights[i], h01 = heights[i + 1], h10 = heights[i + nz], h11 = heights[i + nz + 1];
    out[0] = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / dx;
    out[1] = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / dz;
  };

  const surfaceAt = (x, z) => {
    x = clampT(x); z = clampT(z);
    let ix = cell(xs, lutX, x), iz = cell(zs, lutZ, z);
    if (x - xs[ix] > xs[ix + 1] - x) ix++;
    if (z - zs[iz] > zs[iz + 1] - z) iz++;
    return SURFACE_IDS[types[ix * nz + iz]];
  };

  const waterLevelAt = (x, z) => {
    let level = -Infinity;
    for (const p of ponds) {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      // Only where the water is drawn (its blob, as scenery's buildWater
      // shapes it): ground below the pond's level outside that is a dry
      // hollow, not a splash. (It used to be a plain circle 1.7 r round the
      // pond, which on a downhill fairway caught drives on dry grass.)
      if (d < p.r * 1.7 && p.level > level && d < blobRadius(p, Math.atan2(dz, dx)) * WATER_DRAWN) level = p.level;
    }
    return level;
  };

  // --- A cave's roof: 22-32 m over the course, sampled once onto a coarse grid
  // (the ball physics asks every step in the air; cave.js draws the same one).
  // Clears any normal shot (a wedge peaks near 18 m); a sky-high one clonks.
  let ceilingAt = null;
  if (biome.cave) {
    const N = 65, SPAN = TILE_HALF + 80, step = (SPAN * 2) / (N - 1);
    const roof = new Float32Array(N * N);
    const baseY = Math.max(heightAt(spec.tee.x, spec.tee.z), heightAt(spec.pin.x, spec.pin.z));
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = -SPAN + i * step, z = -SPAN + j * step;
      const cx = clampT(x), cz = clampT(z);
      const clear = 27 + 5 * noise(x * 0.012 + 300, z * 0.012 - 300);
      roof[i * N + j] = Math.max(heightAt(cx, cz) + 19, baseY + clear);
    }
    ceilingAt = (x, z) => {
      const fx = Math.max(0, Math.min(N - 1.001, (x + SPAN) / step)), fz = Math.max(0, Math.min(N - 1.001, (z + SPAN) / step));
      const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
      const a = roof[i * N + j], b = roof[(i + 1) * N + j], c = roof[i * N + j + 1], d = roof[(i + 1) * N + j + 1];
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };
  }

  // Shrink a wide dip that the coarse grid cannot represent: make sure the
  // tee and the pin sit on the surface the grid actually has.
  const cup = { x: spec.pin.x, z: spec.pin.z, y: heightAt(spec.pin.x, spec.pin.z), r: spec.cupR || undefined };
  const tee = { x: spec.tee.x, z: spec.tee.z, y: heightAt(spec.tee.x, spec.tee.z) };

  // Tree colliders: three shapes, which every kind of tree in props.js is built to fit.
  const kind = biome.treeShape;
  const trees = spec.trees.map((t) => {
    const y = heightAt(t.x, t.z);
    const s = t.s;
    if (kind === 'pine') {
      return { x: t.x, z: t.z, y, s, trunkR: 0.3 * s, trunkTop: y + 2.2 * s, cy: y + 5.4 * s, cr: 2.3 * s };
    }
    if (kind === 'scrub') {
      return { x: t.x, z: t.z, y, s, trunkR: 0.25 * s, trunkTop: y + 1.2 * s, cy: y + 2.3 * s, cr: 1.9 * s };
    }
    return { x: t.x, z: t.z, y, s, trunkR: 0.34 * s, trunkTop: y + 3.2 * s, cy: y + 5.6 * s, cr: 2.9 * s };
  });

  return {
    spec, biome,
    xs, zs, nx, nz, heights, types,
    heightAt, gradAt, surfaceAt, waterLevelAt,
    gravity: spec.gravity || 0, // (0: the usual; a room event can lower it)
    ceilingAt, // (a cave's roof, or null under the open sky)
    lane: channel ? { pts: channel.pts, ...rails } : null, // (crazy golf: the rails the ball bounces off)
    cup, tee, trees, ponds, bunkers,
    half: PLAY_HALF,
    tileHalf: TILE_HALF,
    length: totalLen,
    fairwayHalfAt,
  };
}

/**
 * Where to aim from (x, z): the pin if it is the next thing in play, else the
 * next corner of the path, so doglegs aim down the fairway rather than
 * through the trees.
 */
export function aimTarget(world, x, z) {
  const path = world.spec.path;
  const info = pathInfo(path, x, z);
  let walked = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const ax = path[i].x - path[i - 1].x, az = path[i].z - path[i - 1].z;
    const bx = path[i + 1].x - path[i].x, bz = path[i + 1].z - path[i].z;
    walked += Math.hypot(ax, az);
    // Gentle drifts are not corners: only a real turn redirects the aim
    const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    // (on a crazy-golf lane every bend counts, however close)
    const ahead = world.spec.green.channel ? 2.5 : 45;
    if (turn > 0.2 && walked > info.along + ahead) return { x: path[i].x, z: path[i].z, isPin: false };
  }
  return { x: world.cup.x, z: world.cup.z, isPin: true };
}

// Where each seat tees off in a room: two tiers across the tee box, the host
// front and centre. Seats 0-3 are the front row on the tee itself; 4-7 are
// the back row, a step down and behind (TEE_STEP), their spots between the
// front row's so from any camera, behind its own ball, nobody stands on the
// line to the ball; and far enough back to sit under the front row's aim
// cameras rather than across the bottom of their picture. (back > 0 is
// behind the tee point.)
const TEE_SLOTS = [[0, 0], [1.9, 0], [-1.9, 0], [3.4, 0], [0.95, 6.2], [-0.95, 6.2], [2.85, 6.2], [-2.85, 6.2]];
export function teeSlot(world, i) {
  const { tee, spec } = world;
  const p = spec.path;
  const fdx = p[1].x - p[0].x, fdz = p[1].z - p[0].z, d = Math.hypot(fdx, fdz) || 1;
  const fx = fdx / d, fz = fdz / d;
  const [lat, back] = TEE_SLOTS[((i % TEE_SLOTS.length) + TEE_SLOTS.length) % TEE_SLOTS.length];
  const k = spec.green.channel ? 0.45 : 1; // (a crazy-golf lane is narrow)
  return { x: tee.x - fz * lat * k - fx * back * k, z: tee.z + fx * lat * k - fz * back * k };
}

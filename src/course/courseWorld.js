import { createGameRng } from '../core/rng.js';
import { BIOMES } from './biomes.js';
import { TILE_HALF, PLAY_HALF } from './holeDesigner.js';
import {
  smoothstep, lerp, pathLength, pathInfo, blobRadius, blobCovers, greenDistance, FRINGE_EDGE,
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
const TEE_RADIUS = 4;

export function buildWorld(spec) {
  const biome = BIOMES[spec.biome];
  const noise = createGameRng(`${spec.seed}:terrain-${spec.number}`).noise2D;
  const { green, path } = spec;
  const totalLen = pathLength(path);

  // --- Analytic height model -------------------------------------------------
  const low = (x, z) => biome.base + biome.amp1 * noise(x * 0.006, z * 0.006);
  const detail = (x, z) => biome.amp2 * noise(x * 0.024 + 50, z * 0.024 - 50);

  const teeY = low(spec.tee.x, spec.tee.z) + 0.4;
  const greenY = Math.max(0.6, low(green.x, green.z)) + green.elev;
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
    return l + d * lerp(1, 0.2, w);
  };

  const ponds = spec.water.map((w) => {
    const info = pathInfo(path, w.x, w.z);
    return { ...w, level: Math.min(ground(w.x, w.z, info), low(w.x, w.z)) - 0.55 };
  });
  const bunkers = spec.bunkers.map((b) => ({ ...b }));

  const greenSurface = (x, z) =>
    greenY + tiltX * (x - green.x) + tiltZ * (z - green.z) +
    green.undulation * noise(x * 0.055 + 200, z * 0.055 + 200);

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
    if (teeD < TEE_RADIUS * 2.2) h = lerp(teeY, h, smoothstep(TEE_RADIUS, TEE_RADIUS * 2.2, teeD));

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
    for (const p of ponds) if (h < p.level + 0.04 && blobCovers(p, x, z, 1)) return ID.water;
    for (const b of bunkers) if (blobCovers(b, x, z)) return ID.bunker;
    const info = pathInfo(path, x, z);
    if (info.along >= spec.fairwayStart && info.dist <= fairwayHalfAt(info.along)) return ID.fairway;
    return ID.rough;
  };

  // --- Grid axes: coarse everywhere, fine over the green ---------------------
  const fineR = green.size * 1.75;
  const axis = (center) => {
    const lo = Math.floor((center - fineR) / COARSE) * COARSE;
    const hi = Math.ceil((center + fineR) / COARSE) * COARSE;
    const out = [];
    for (let v = -TILE_HALF; v < lo - 1e-6; v += COARSE) out.push(v);
    for (let v = lo; v < hi - 1e-6; v += FINE) out.push(v);
    for (let v = hi; v <= TILE_HALF + 1e-6; v += COARSE) out.push(v);
    return Float32Array.from(out);
  };
  const xs = axis(green.x);
  const zs = axis(green.z);
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
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r * 1.7 && p.level > level) level = p.level;
    }
    return level;
  };

  // Shrink a wide dip that the coarse grid cannot represent: make sure the
  // tee and the pin sit on the surface the grid actually has.
  const cup = { x: spec.pin.x, z: spec.pin.z, y: heightAt(spec.pin.x, spec.pin.z) };
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
    if (turn > 0.2 && walked > info.along + 45) return { x: path[i].x, z: path[i].z, isPin: false };
  }
  return { x: world.cup.x, z: world.cup.z, isPin: true };
}

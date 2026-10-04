/**
 * Shared course geometry — the single definition of every shape on a hole.
 * The designer's fairness checks, the height model, the surface classifier
 * and the minimap all call these, so they can never disagree about where a
 * pond or a green actually is. Pure module.
 */

export function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// --- Play path (tee -> ... -> green polyline) -------------------------------

export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return len;
}

/** Point at distance `d` along the path, with the local direction. */
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

/** Nearest point on the path: distance to it, distance along, signed side. */
export function pathInfo(path, x, z) {
  let dist = Infinity, along = 0, across = 0;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x, az = path[i - 1].z;
    const dx = path[i].x - ax, dz = path[i].z - az;
    const segLen = Math.hypot(dx, dz);
    if (segLen === 0) continue;
    const ux = dx / segLen, uz = dz / segLen;
    const px = x - ax, pz = z - az;
    const proj = Math.max(0, Math.min(segLen, px * ux + pz * uz));
    const d = Math.hypot(px - ux * proj, pz - uz * proj);
    if (d < dist) {
      dist = d;
      along = walked + proj;
      across = px * -uz + pz * ux;
    }
    walked += segLen;
  }
  return { dist, along, across };
}

// --- Organic blobs (ponds, bunkers) ----------------------------------------

/** Radius of a wobbly blob in direction `angle`. */
export function blobRadius(shape, angle) {
  const w = shape.wobble ?? 1;
  const p = shape.phase || 0;
  const f = 1 + w * (0.26 * Math.sin(angle * 2 + p) + 0.16 * Math.sin(angle * 3 + p * 2.3) + 0.1 * Math.sin(angle * 5 + p * 0.7));
  return shape.r * Math.max(0.45, f);
}

/** Normalised blob distance: < 1 inside, 1 on the edge. */
export function blobDistance(shape, x, z) {
  const dx = x - shape.x, dz = z - shape.z;
  const d = Math.hypot(dx, dz);
  if (d > shape.r * 1.7) return d / shape.r; // far outside: skip the trig
  return d / blobRadius(shape, Math.atan2(dz, dx));
}

export function blobCovers(shape, x, z, margin = 0) {
  const dx = x - shape.x, dz = z - shape.z;
  const d = Math.hypot(dx, dz);
  if (d > shape.r * 1.7 + margin) return false;
  return d < blobRadius(shape, Math.atan2(dz, dx)) + margin;
}

// --- The green --------------------------------------------------------------

/**
 * Kidney-shaped green, long axis along the approach. < 1 inside the putting
 * surface; FRINGE_EDGE marks the outside of the collar.
 */
export const FRINGE_EDGE = 1.13;

export function greenDistance(green, x, z) {
  const dx = x - green.x, dz = z - green.z;
  const c = Math.cos(-green.angle), s = Math.sin(-green.angle);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const size = green.size;
  const ellipse = Math.sqrt((lx / 1.35) ** 2 + lz ** 2) / size;
  const bite = Math.sqrt((lx + size * 0.25) ** 2 + (lz - size * 1.25) ** 2) / (size * 0.62);
  return Math.max(ellipse, 1 + (1 - bite) * 1.5);
}

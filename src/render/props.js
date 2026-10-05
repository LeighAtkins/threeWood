import * as THREE from 'three';
import { pathInfo, pointAlongPath } from '../course/shapes.js';

/**
 * Props — every tree, rock, hut, shrine and far-off volcano in the game,
 * grown from a few primitives rather than loaded from files.
 *
 * Nothing here is instanced: each thing is generated on the spot from the
 * hole's random stream, so no two cacti, cottages or toadstools are the same,
 * and then everything of a kind is baked into ONE vertex-coloured mesh. A
 * hole's whole dressing is four draw calls (trees, props, backdrop, glow).
 *
 * "Glow" parts (windows, lanterns, lava, crystals) go to an unlit mesh, so
 * they simply stay bright when the sun goes down.
 */

// --- The kit ---------------------------------------------------------------------

const ICO = [0, 1].map((detail) => new THREE.IcosahedronGeometry(1, detail).attributes.position.array);
const colorCache = new Map();
function rgb(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();

let rnd = Math.random;
const R = (lo, hi) => lo + rnd() * (hi - lo);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const TAU = Math.PI * 2;

class Stream {
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Accumulates painted primitives. Every part takes an options bag `o`:
 *   x y z        offset            rx ry rz   rotation
 *   sx sy sz     stretch           top/topAt  second colour above a height fraction
 *   glow         send to the unlit mesh        shade      brightness multiplier
 * Primitives sit on y = 0 and grow upwards (blobs are centred).
 */
class Builder {
  constructor() {
    this.lit = new Stream();
    this.glow = new Stream();
    this.place(0, 0, 0);
  }

  /** Where the next parts go: world position, heading and size. */
  place(x, y, z, rotY = 0, s = 1) {
    this.baseM = new THREE.Matrix4().compose(
      _pos.set(x, y, z), _quat.setFromEuler(_euler.set(0, rotY, 0)), _scale.set(s, s, s));
    return this;
  }

  emit(verts, cx, cy, cz, yLo, yHi, hex, o = {}) {
    const out = o.glow ? this.glow : this.lit;
    _local.compose(
      _pos.set(o.x || 0, o.y || 0, o.z || 0),
      _quat.setFromEuler(_euler.set(o.rx || 0, o.ry || 0, o.rz || 0)),
      _scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
    _m.multiplyMatrices(_base.copy(this.baseM), _local);
    const base = rgb(hex), top = o.top != null ? rgb(o.top) : null;
    const shade = o.shade ?? 1, topAt = o.topAt ?? 0.5;
    for (let i = 0; i < verts.length; i += 9) {
      const fr = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        _v[k].set(verts[i + k * 3], verts[i + k * 3 + 1], verts[i + k * 3 + 2]);
        fr[k] = (_v[k].y - yLo) / (yHi - yLo || 1);
      }
      // Wind every face outwards from the primitive's middle, whatever order it came in
      _n.copy(_v[1]).sub(_v[0]).cross(_e.copy(_v[2]).sub(_v[0]));
      _e.copy(_v[0]).add(_v[1]).add(_v[2]).multiplyScalar(1 / 3);
      const flip = _n.x * (_e.x - cx) + _n.y * (_e.y - cy) + _n.z * (_e.z - cz) < 0;
      for (let k = 0; k < 3; k++) _v[k].applyMatrix4(_m);
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      _n.copy(_v[order[1]]).sub(_v[order[0]]).cross(_e.copy(_v[order[2]]).sub(_v[order[0]])).normalize();
      // Unlit parts get a little per-face variation, or they read as stickers
      const face = shade * (o.glow ? 0.82 + rnd() * 0.3 : 1);
      for (const k of order) {
        out.pos.push(_v[k].x, _v[k].y, _v[k].z);
        out.nor.push(_n.x, _n.y, _n.z);
        const c = top && fr[k] >= topAt ? top : base;
        out.col.push(c.r * face, c.g * face, c.b * face);
      }
    }
    return this;
  }

  /** Cone, cylinder or anything between: bottom radius, top radius, height. */
  fr(hex, rb, rt, h, o = {}) {
    const seg = o.seg || 6, verts = [];
    const spin = o.spin || 0;
    for (let i = 0; i < seg; i++) {
      const a0 = spin + (i / seg) * TAU, a1 = spin + ((i + 1) / seg) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      verts.push(c0 * rb, 0, s0 * rb, c1 * rb, 0, s1 * rb, c1 * rt, h, s1 * rt);
      if (rt > 0) {
        verts.push(c0 * rb, 0, s0 * rb, c1 * rt, h, s1 * rt, c0 * rt, h, s0 * rt);
        verts.push(0, h * 1.0001, 0, c0 * rt, h, s0 * rt, c1 * rt, h, s1 * rt);
      }
    }
    return this.emit(verts, 0, h / 2, 0, 0, h, hex, o);
  }

  /** Faceted ball: the stuff of canopies, boulders and snowmen. */
  bl(hex, r, o = {}) {
    const src = ICO[o.detail || 0], verts = new Array(src.length);
    for (let i = 0; i < src.length; i++) verts[i] = src[i] * r;
    return this.emit(verts, 0, 0, 0, -r, r, hex, o);
  }

  /** Box: width (x), height, depth (z). */
  bx(hex, w, h, d, o = {}) {
    const x = w / 2, z = d / 2;
    const P = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]];
    const quads = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
    const verts = [];
    for (const [a, b, c, e] of quads) verts.push(...P[a], ...P[b], ...P[c], ...P[a], ...P[c], ...P[e]);
    return this.emit(verts, 0, h / 2, 0, 0, h, hex, o);
  }

  /** Gable roof: ridge along x. */
  rf(hex, w, h, d, o = {}) {
    const x = w / 2, z = d / 2;
    const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], D = [-x, 0, z], E = [-x, h, 0], F = [x, h, 0];
    const verts = [...A, ...B, ...F, ...A, ...F, ...E, ...D, ...C, ...F, ...D, ...F, ...E, ...A, ...D, ...E, ...B, ...C, ...F];
    return this.emit(verts, 0, h / 3, 0, 0, h, hex, o);
  }
}

// --- Trees -------------------------------------------------------------------------
// Built at unit scale to fit the three collider shapes in courseWorld.js:
//   round  trunk to 3.2, canopy ball r 2.9 at 5.6
//   pine   trunk to 2.2, canopy ball r 2.3 at 5.4
//   scrub  trunk to 1.2, canopy ball r 1.9 at 2.3

function pineTiers(b, biome, snowy) {
  b.fr(biome.trunk, 0.34, 0.22, 2.4);
  const green = pick(biome.canopy), tiers = chance(0.3) ? 4 : 3;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1), r = 2.5 - k * 1.15, y = 1.8 + k * 4.2, h = 3.6 - k * 0.5;
    const o = { y, seg: 7, shade: R(0.9, 1.08), spin: R(0, 1) };
    b.fr(green, r, 0, h, snowy ? { ...o, top: 0xf6fbff, topAt: R(0.22, 0.42) } : o);
  }
}

const TREES = {
  round(b, biome) {
    b.fr(biome.trunk, 0.4, 0.26, 3.8);
    const leaf = pick(biome.canopy);
    b.bl(leaf, 2.8, { y: 5.7, sy: 1.1, ry: R(0, 3) });
    for (let i = 0, n = 2 + Math.floor(R(0, 2.5)); i < n; i++) {
      const a = R(0, TAU), d = R(1.3, 1.9);
      b.bl(chance(0.3) ? pick(biome.canopy) : leaf, R(1.4, 2.0),
        { x: Math.cos(a) * d, y: R(4.4, 6.4), z: Math.sin(a) * d, ry: R(0, 3), shade: R(0.88, 1.1) });
    }
  },
  pine(b, biome) { pineTiers(b, biome, false); },
  snowPine(b, biome) { pineTiers(b, biome, true); },
  scrub(b, biome) {
    b.fr(biome.trunk, 0.26, 0.16, 1.5, { rz: R(-0.2, 0.2) });
    const leaf = pick(biome.canopy);
    b.bl(leaf, 1.7, { y: 2.2, sx: 1.15, sy: 0.8, ry: R(0, 3) });
    b.bl(leaf, 1.1, { x: R(0.8, 1.2), y: 1.8, z: R(-0.6, 0.6), shade: 0.92 });
  },
  palm(b, biome) {
    // A trunk that leans and then recovers, the way they do
    const lean = R(0.1, 0.32), dir = R(0, TAU);
    let x = 0, z = 0, y = 0;
    for (let i = 0; i < 5; i++) {
      const tilt = lean * (1 - i / 5);
      b.fr(biome.trunk, 0.34 - i * 0.03, 0.3 - i * 0.03, 1.35, { x, y, z, rz: -tilt * Math.cos(dir), rx: tilt * Math.sin(dir), shade: i % 2 ? 0.9 : 1.05 });
      x += Math.sin(tilt) * 1.25 * Math.cos(dir); z += Math.sin(tilt) * 1.25 * Math.sin(dir); y += Math.cos(tilt) * 1.25;
    }
    const leaf = pick(biome.canopy), fronds = 7 + Math.floor(R(0, 3));
    for (let i = 0; i < fronds; i++) {
      b.fr(leaf, 0.55, 0, R(3.0, 3.9), { x, y, z, ry: (i / fronds) * TAU + R(-0.2, 0.2), rz: -R(1.25, 1.95), sz: 0.3, seg: 4, shade: R(0.85, 1.12) });
    }
    for (let i = 0; i < 3; i++) b.bl(0x6a4a2a, 0.3, { x: x + R(-0.35, 0.35), y: y - 0.3, z: z + R(-0.35, 0.35) });
  },
  cactus(b, biome) {
    const green = pick(biome.canopy), h = R(3.0, 4.0);
    b.fr(green, 0.48, 0.44, h, { seg: 7 }).bl(green, 0.46, { y: h });
    for (let i = 0, n = Math.floor(R(1, 3.6)); i < n; i++) {
      const a = R(0, TAU), y = R(1.1, h - 1.3), reach = R(0.9, 1.3), up = R(0.9, 1.9);
      const cx = Math.cos(a), cz = Math.sin(a);
      b.fr(green, 0.28, 0.28, reach, { x: cx * 0.3, y, z: cz * 0.3, rz: -Math.PI / 2 * cx, rx: Math.PI / 2 * cz, shade: 0.94 });
      b.fr(green, 0.28, 0.26, up, { x: cx * (reach + 0.2), y: y - 0.1, z: cz * (reach + 0.2), shade: 0.94 });
      b.bl(green, 0.28, { x: cx * (reach + 0.2), y: y + up - 0.1, z: cz * (reach + 0.2) });
    }
    if (chance(0.5)) b.bl(pick(biome.flowers), 0.22, { y: h + 0.45 });
  },
  blossom(b, biome) {
    const a = R(0, TAU);
    b.fr(biome.trunk, 0.36, 0.24, 3.0, { rz: R(-0.12, 0.12) });
    for (const side of [0, 2.4, 4.4]) {
      b.fr(biome.trunk, 0.2, 0.1, 2.4, { y: 2.6, ry: a + side, rz: R(0.5, 0.8) });
    }
    for (let i = 0, n = 5 + Math.floor(R(0, 3)); i < n; i++) {
      const t = R(0, TAU), d = i ? R(0.9, 1.9) : 0;
      b.bl(pick(biome.canopy), R(1.3, 2.0), { x: Math.cos(t) * d, y: R(4.6, 6.5), z: Math.sin(t) * d, sy: 0.72, ry: R(0, 3), shade: R(0.94, 1.06) });
    }
  },
  charred(b, biome) {
    const bark = pick(biome.canopy);
    b.fr(bark, 0.32, 0.12, 3.6, { rz: R(-0.15, 0.15), rx: R(-0.15, 0.15) });
    for (let i = 0, n = 3 + Math.floor(R(0, 3)); i < n; i++) {
      b.fr(bark, 0.11, 0.03, R(1.1, 2.0), { y: R(1.5, 3.2), ry: R(0, TAU), rz: R(0.6, 1.2), seg: 4 });
    }
    if (chance(0.4)) b.bl(0xff7a1e, 0.12, { y: R(0.4, 1.2), x: 0.24, glow: true });
  },
  mushroom(b, biome) {
    const cap = pick(biome.canopy), r = R(2.5, 3.0), tilt = { rz: R(-0.1, 0.1), rx: R(-0.1, 0.1) };
    b.fr(biome.trunk, 0.75, 0.5, 4.7, { seg: 7 });
    b.fr(biome.trunk, r * 0.5, r * 0.94, 0.5, { y: 4.3, seg: 8, shade: 0.86, ...tilt });
    b.bl(cap, r, { y: 4.8, sy: 0.62, detail: 1, ...tilt });
    for (let i = 0; i < 6; i++) {
      const a = R(0, TAU), d = i ? R(0.9, r * 0.78) : 0;
      const lift = Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) * r * 0.62;
      b.bl(0xfffbee, R(0.3, 0.5), { x: Math.cos(a) * d, y: 4.8 + lift, z: Math.sin(a) * d, sy: 0.4 });
    }
  },
};

// --- Small dressing ------------------------------------------------------------------

function rocks(b, hex, n, size, o = {}) {
  for (let i = 0; i < n; i++) {
    const r = size * R(0.5, 1) * (i ? 0.7 : 1);
    b.bl(hex, r, { x: i ? R(-size, size) : 0, y: r * 0.3, z: i ? R(-size, size) : 0, sy: R(0.55, 0.9), sx: R(0.8, 1.3), ry: R(0, 3), rz: R(-0.3, 0.3), shade: R(0.85, 1.1), ...o });
  }
}

function spray(b, hex, n, h, o = {}) {
  for (let i = 0; i < n; i++) {
    b.fr(hex, 0.09 * h, 0, h * R(0.6, 1), { ry: R(0, TAU), rz: R(0.1, 0.75), seg: 3, shade: R(0.8, 1.15), ...o });
  }
}

function shards(b, colours, n, h, o = {}) {
  for (let i = 0; i < n; i++) {
    const len = h * R(0.45, 1) * (i ? 0.75 : 1);
    b.fr(pick(colours), len * R(0.12, 0.2), 0, len, { x: i ? R(-0.4, 0.4) * h * 0.4 : 0, z: i ? R(-0.4, 0.4) * h * 0.4 : 0, ry: R(0, TAU), rz: i ? R(0.1, 0.55) : R(0, 0.12), seg: 5, ...o });
  }
}

function toadstools(b, caps, n, size) {
  for (let i = 0; i < n; i++) {
    const h = size * R(0.5, 1), x = i ? R(-1, 1) * size : 0, z = i ? R(-1, 1) * size : 0;
    b.fr(0xf2ead8, h * 0.16, h * 0.12, h, { x, z });
    b.bl(pick(caps), h * 0.55, { x, y: h, z, sy: 0.6 });
  }
}

const PROPS = {
  bush(b, biome) { for (let i = 0; i < 3; i++) b.bl(pick(biome.canopy), R(0.6, 1.1), { x: R(-0.8, 0.8), y: 0.5, z: R(-0.8, 0.8), sy: 0.8, shade: R(0.9, 1.1) }); },
  fence(b, biome) {
    const wood = biome.id === 'parkland' ? 0xf4f0e4 : 0x8a6a48, posts = 4 + Math.floor(R(0, 3));
    for (let i = 0; i < posts; i++) b.bx(wood, 0.18, R(1.0, 1.2), 0.18, { x: i * 1.8, rz: R(-0.06, 0.06) });
    for (const y of [0.45, 0.85]) b.bx(wood, (posts - 1) * 1.8, 0.12, 0.08, { x: (posts - 1) * 0.9, y });
  },
  rock(b) { rocks(b, pick([0x8a8a86, 0x9a968c, 0x7a7a7c]), 1 + Math.floor(R(0, 3)), R(0.6, 1.3)); },
  boulder(b) { rocks(b, pick([0x7a7f86, 0x6a7078, 0x8a8a88]), 2 + Math.floor(R(0, 3)), R(1.2, 2.6), { top: 0x5a8a4a, topAt: 0.8 }); },
  redRock(b) { rocks(b, pick([0xc8683a, 0xb85a34, 0xd98a52]), 1 + Math.floor(R(0, 3)), R(0.7, 2.0)); },
  snowRock(b) { rocks(b, 0x7a8894, 1 + Math.floor(R(0, 3)), R(0.7, 1.8), { top: 0xffffff, topAt: 0.5 }); },
  mossRock(b) { rocks(b, 0x7c8280, 1 + Math.floor(R(0, 3)), R(0.7, 1.7), { top: 0x6aa85a, topAt: 0.55 }); },
  basalt(b) {
    for (let i = 0, n = 4 + Math.floor(R(0, 5)); i < n; i++) {
      b.fr(pick([0x3a363c, 0x2e2a30, 0x464048]), 0.42, 0.42, R(0.5, 2.6), { x: R(-0.9, 0.9), z: R(-0.9, 0.9), seg: 6 });
    }
  },
  obsidian(b) { shards(b, [0x1c1a24, 0x2a2434, 0x3a2a44], 2 + Math.floor(R(0, 3)), R(1.2, 3.2)); },
  iceShard(b) { shards(b, [0xbfe6ff, 0x9ad4f6, 0xe6f6ff], 2 + Math.floor(R(0, 4)), R(1.0, 2.8)); },
  crystal(b) { shards(b, [0xc49aff, 0x7ae8ff, 0xff9ae0, 0xfff27a], 2 + Math.floor(R(0, 3)), R(0.8, 2.2), { glow: true, shade: 0.8 }); },
  marram(b, biome) { spray(b, pick([0xc8b866, 0xb8a85a, 0x9aa858]), 7, R(0.9, 1.6)); },
  fern(b, biome) { spray(b, pick(biome.canopy), 8, R(0.7, 1.2), { rz: R(0.7, 1.1) }); },
  deadBush(b) { spray(b, 0x8a6a48, 7, R(0.7, 1.3), { rz: R(0.3, 1.0) }); },
  logPile(b) {
    const len = R(2.2, 3.2);
    [[-0.6, 0.3], [0, 0.3], [0.6, 0.3], [-0.3, 0.82], [0.3, 0.82], [0, 1.34]].forEach(([z, y]) => {
      b.fr(0x7a5536, 0.3, 0.3, len, { x: -len / 2, y, z, rz: -Math.PI / 2, seg: 6, shade: R(0.85, 1.1) });
      b.fr(0xd9b98a, 0.24, 0.24, 0.02, { x: len / 2, y, z, rz: -Math.PI / 2 });
    });
  },
  barrelCactus(b, biome) {
    const r = R(0.4, 0.75);
    b.bl(pick(biome.canopy), r, { y: r * 0.85, sy: 1.15, detail: 1 });
    if (chance(0.7)) b.bl(pick(biome.flowers), r * 0.3, { y: r * 2 });
  },
  bones(b) {
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      b.fr(0xf0ead8, 0.1, 0.05, 1.6 - i * 0.12, { x: i * 0.6, z: side * 0.75, rx: -side * 0.5, seg: 4 });
    }
    b.fr(0xf0ead8, 0.1, 0.1, 2.6, { x: -0.4, y: 0.12, rz: -Math.PI / 2, seg: 4 });
    b.bl(0xf0ead8, 0.45, { x: -0.9, y: 0.4, sx: 1.4 });
  },
  shell(b) { b.fr(pick([0xffc8d8, 0xfff0e0, 0xffb09a]), 0.4, 0, 0.9, { rz: 1.3, y: 0.3, seg: 7 }); },
  hibiscus(b, biome) {
    for (let i = 0; i < 3; i++) b.bl(pick(biome.canopy), R(0.5, 0.9), { x: R(-0.6, 0.6), y: 0.45, z: R(-0.6, 0.6), sy: 0.8 });
    for (let i = 0; i < 4; i++) b.bl(pick(biome.flowers), 0.2, { x: R(-0.9, 0.9), y: R(0.7, 1.2), z: R(-0.9, 0.9) });
  },
  surfboard(b) {
    const paint = pick([0xff5a4a, 0x2ec4d8, 0xffd23a, 0xff8ad0, 0xffffff]);
    b.bl(paint, 1, { y: 1.5, sy: 1.8, sx: 0.42, sz: 0.07, rz: R(-0.2, 0.2), rx: R(0.05, 0.3), detail: 1 });
    b.bx(0xffffff, 0.86, 0.22, 0.17, { y: R(1.2, 1.9) });
  },
  snowman(b) {
    b.bl(0xffffff, 0.8, { y: 0.7, detail: 1 }).bl(0xffffff, 0.58, { y: 1.75, detail: 1 }).bl(0xffffff, 0.42, { y: 2.55, detail: 1 });
    b.fr(0xff8a2a, 0.09, 0, 0.5, { y: 2.55, x: 0.36, rz: -Math.PI / 2, seg: 5 });
    b.fr(0x2a2a30, 0.5, 0.5, 0.06, { y: 2.88 }).fr(0x2a2a30, 0.3, 0.3, 0.5, { y: 2.9 });
    b.bx(pick([0xe83a3a, 0x2e8ae8, 0x3ab85a]), 0.9, 0.16, 0.9, { y: 2.12 });
    for (const side of [-1, 1]) b.fr(0x5a4030, 0.04, 0.02, 1.0, { y: 1.8, z: side * 0.5, rx: side * 1.1, seg: 4 });
  },
  present(b) {
    const s = R(0.6, 1.1), wrap = pick([0xe83a3a, 0x2e8ae8, 0x3ab85a, 0xffd23a, 0xb05ce8]);
    b.bx(wrap, s, s * 0.8, s).bx(0xffffff, s * 1.04, s * 0.82, s * 0.2).bx(0xffffff, s * 0.2, s * 0.82, s * 1.04);
    b.bl(0xffffff, s * 0.2, { y: s * 0.9 });
  },
  pumpkin(b) {
    for (let i = 0, n = 1 + Math.floor(R(0, 2.4)); i < n; i++) {
      const r = R(0.4, 0.8), x = i * R(0.9, 1.3), z = i ? R(-0.6, 0.6) : 0;
      b.bl(pick([0xf28a1e, 0xe8741a, 0xf2a43a]), r, { x, y: r * 0.7, z, sy: 0.75, detail: 1 });
      b.fr(0x4a6a2a, r * 0.12, r * 0.08, r * 0.35, { x, y: r * 1.35, z });
    }
  },
  leafPile(b, biome) {
    for (let i = 0; i < 3; i++) b.bl(pick(biome.canopy), R(0.7, 1.2), { x: R(-0.7, 0.7), y: 0.12, z: R(-0.7, 0.7), sy: 0.32, ry: R(0, 3) });
  },
  toadstool(b, biome) { toadstools(b, biome.id === 'toadstool' ? biome.canopy : [0xe8423a, 0xd9c8a8, 0xb86a3a], 1 + Math.floor(R(0, 3)), R(0.6, 1.5)); },
  bamboo(b) {
    for (let i = 0, n = 4 + Math.floor(R(0, 4)); i < n; i++) {
      const h = R(3.5, 6.5), x = R(-0.7, 0.7), z = R(-0.7, 0.7), lean = { rz: R(-0.12, 0.12), rx: R(-0.12, 0.12) };
      b.fr(pick([0x7ab04a, 0x8ac05a, 0x6a9a42]), 0.1, 0.08, h, { x, z, seg: 5, ...lean });
      b.bl(0x5a9a3a, 0.55, { x: x + R(-0.3, 0.3), y: h * R(0.75, 0.95), z: z + R(-0.3, 0.3), sy: 0.5 });
    }
  },
  lantern(b) {
    b.bx(0x8a8a88, 0.7, 0.2, 0.7).fr(0x9a9a98, 0.16, 0.14, 1.0, { y: 0.2 });
    b.bx(0x8a8a88, 0.62, 0.1, 0.62, { y: 1.2 }).bx(0xffd27a, 0.44, 0.42, 0.44, { y: 1.3, glow: true });
    b.fr(0x6a6a6c, 0.62, 0.08, 0.42, { y: 1.72, seg: 4, spin: Math.PI / 4 });
  },
  vent(b) {
    const r = R(0.7, 1.4);
    b.fr(0x2e2a2e, r, r * 0.45, r * 0.9, { seg: 7 });
    b.fr(0xff7a1e, r * 0.4, r * 0.4, 0.05, { y: r * 0.9, seg: 7, glow: true });
    b.bl(0xffc23a, r * 0.16, { y: r * 1.25, glow: true });
  },
};

// --- Set pieces ----------------------------------------------------------------------

/** One parametrised building covers cottages, cabins, barns, huts and tea houses. */
function house(b, { w, d, h, wall, roof, roofH = h * 0.7, lift = 0, door = 0x5a3a26, lit = true, chimney = null, eave = 0.5 }) {
  if (lift) for (const x of [-1, 1]) for (const z of [-1, 1]) b.fr(0x6a4a30, 0.14, 0.14, lift, { x: x * w * 0.42, z: z * d * 0.42, seg: 4 });
  b.bx(wall, w, h, d, { y: lift });
  b.rf(roof, w + eave * 2, roofH, d + eave * 2, { y: lift + h });
  b.bx(door, 0.9, 1.7, 0.1, { y: lift, z: d / 2 + 0.03 });
  if (lit) {
    for (const x of [-1, 1]) b.bx(0xffe08a, 0.8, 0.8, 0.08, { x: x * w * 0.3, y: lift + h * 0.42, z: d / 2 + 0.03, glow: true });
    b.bx(0xffe08a, 0.08, 0.8, 0.8, { x: w / 2 + 0.03, y: lift + h * 0.42, glow: true });
  }
  if (chimney != null) b.bx(chimney, 0.7, roofH + 0.9, 0.7, { x: w * 0.28, y: lift + h, z: -d * 0.15 });
}

function standingStone(b, hex, h, o = {}) {
  b.bx(hex, R(0.9, 1.4), h, R(0.5, 0.8), { ry: R(0, 3), rz: R(-0.12, 0.12), rx: R(-0.1, 0.1), shade: R(0.85, 1.1), ...o });
}

function arch(b, hex, o = {}) {
  const span = R(4, 6.5), h = R(4.5, 7);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) b.bl(hex, R(1.3, 1.8), { x: side * span / 2 + R(-0.3, 0.3), y: 0.8 + i * h / 3, sy: 1.2, ry: R(0, 3), shade: R(0.88, 1.1), ...o });
  }
  b.bl(hex, 1.5, { y: h + 0.4, sx: span / 2.3, sy: 0.8, sz: 1.1, detail: 1, ...o });
}

const FEATURES = {
  cottage(b) {
    house(b, { w: R(5.5, 7), d: R(4.5, 5.5), h: 3.2, wall: pick([0xf6ead0, 0xf2dcc0, 0xe8e4d8]), roof: pick([0xb8502e, 0x8a5a3a, 0x5a6a7a]), chimney: 0x9a6a5a });
  },
  cabin(b, biome) {
    house(b, { w: R(5.5, 7), d: R(4.5, 5.5), h: 3.0, wall: 0x7a5536, roof: biome.id === 'snow' ? 0xf6fbff : 0x3a4a3a, chimney: 0x6a6a6c });
  },
  barn(b) {
    house(b, { w: 9, d: 7, h: 4.6, wall: 0xb8342a, roof: 0x5a5a60, roofH: 3.4, door: 0xf4f0e4, lit: false });
    b.bx(0xf4f0e4, 2.6, 3.0, 0.1, { z: 3.56 });
    b.fr(0xd8d4cc, 1.3, 1.3, 7.5, { x: 6.6, seg: 8 }).fr(0x8a8a90, 1.4, 0.2, 1.3, { x: 6.6, y: 7.5, seg: 8 });
  },
  beachHut(b) {
    house(b, { w: 3.2, d: 3.4, h: 2.8, lift: R(0.5, 1.2), wall: pick([0xff7a6a, 0x4ac8d8, 0xffd84a, 0x8ad86a, 0xf4f0e4]), roof: 0xfaf6ee, roofH: 1.4, lit: false, eave: 0.3 });
  },
  teaHouse(b) {
    b.bx(0x5a4030, 7.4, 0.5, 6.4);
    b.bx(0xf4ecd8, 6, 2.8, 5, { y: 0.5 });
    for (const x of [-3, 3]) for (const z of [-2.5, 2.5]) b.fr(0x3c2a2a, 0.18, 0.18, 2.8, { x, y: 0.5, z, seg: 4 });
    for (const x of [-1.5, 1.5]) b.bx(0xffe6a0, 1.6, 1.8, 0.08, { x, y: 1.0, z: 2.54, glow: true });
    b.fr(0x2a4a4a, 6.2, 2.6, 1.5, { y: 3.3, seg: 4, spin: Math.PI / 4 }).fr(0x2a4a4a, 2.9, 0.1, 1.6, { y: 4.8, seg: 4, spin: Math.PI / 4 });
  },
  shroomHouse(b, biome) {
    const cap = pick(biome.canopy);
    b.fr(0xf2ead8, 2.3, 1.9, 3.4, { seg: 8 });
    b.bl(cap, 3.9, { y: 3.5, sy: 0.62, detail: 1 });
    for (let i = 0; i < 6; i++) { const a = R(0, TAU), d = R(1, 3); b.bl(0xfffbee, R(0.4, 0.6), { x: Math.cos(a) * d, y: 3.5 + Math.sqrt(1 - (d / 3.9) ** 2) * 2.4, z: Math.sin(a) * d, sy: 0.4 }); }
    b.bx(0x7a4a2a, 1.0, 1.8, 0.2, { z: 2.1 });
    for (const a of [0.9, -0.9, 2.4]) b.bl(0xffe08a, 0.42, { x: Math.sin(a) * 2.05, y: 2.1, z: Math.cos(a) * 2.05, glow: true });
    b.fr(0x8a6a4a, 0.3, 0.3, 1.6, { x: 1.4, y: 5.2, seg: 5 });
  },
  igloo(b) {
    b.bl(0xf2f8ff, 3.2, { sy: 0.78, detail: 1 });
    b.bx(0xe2eef8, 1.8, 1.5, 1.6, { z: 3.0 }).bx(0x2a3a4a, 1.0, 1.0, 0.1, { z: 3.82 });
  },
  windmill(b) {
    b.fr(0xf4ecdc, 2.4, 1.5, 9, { seg: 8 }).fr(0x8a4a34, 1.9, 0.1, 2.2, { y: 9, seg: 8 });
    b.bx(0x5a3a26, 0.9, 1.8, 0.1, { z: 2.3 }).bx(0xffe08a, 0.7, 0.8, 0.1, { z: 1.95, y: 5, glow: true });
    const phase = R(0, 1.5);
    for (let i = 0; i < 4; i++) {
      b.bx(0x6a4a30, 0.12, 6.2, 0.2, { x: 0, y: 9.3, z: 2.1, rz: phase + i * Math.PI / 2 });
      b.bx(0xf8f4e8, 1.3, 4.4, 0.06, { y: 9.3, z: 2.16, rz: phase + i * Math.PI / 2, x: 0, sy: 1 });
    }
  },
  haystack(b) {
    for (let i = 0, n = 1 + Math.floor(R(0, 2.5)); i < n; i++) {
      b.fr(pick([0xe6c25a, 0xd9b24a]), 1.1, 1.1, 1.7, { x: i * 2.6 - 0.85, y: 1.1, z: R(-0.4, 0.4), rz: -Math.PI / 2, seg: 9 });
    }
  },
  scarecrow(b) {
    b.fr(0x6a4a30, 0.09, 0.09, 3.0, { seg: 4 }).bx(0x6a4a30, 2.6, 0.12, 0.12, { y: 2.2 });
    b.bx(pick([0xb8342a, 0x3a6ab8, 0x8a6a2a]), 1.1, 1.2, 0.5, { y: 1.3 });
    b.bl(0xe6c88a, 0.42, { y: 2.9 }).fr(0x5a4030, 0.75, 0.05, 0.7, { y: 3.1, seg: 7 });
  },
  standingStones(b) {
    const n = 5 + Math.floor(R(0, 4)), ring = R(4, 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      standingStone(b, 0x8a8a84, R(2.4, 4.4), { x: Math.cos(a) * ring, z: Math.sin(a) * ring });
    }
    b.bx(0x7a7a76, 3.2, 0.6, 1.0, { y: 0.9, ry: R(0, 3) });
  },
  stoneRing(b) {
    for (let i = 0; i < 8; i++) standingStone(b, 0x6a7a8a, R(2.2, 3.6), { x: Math.cos(i / 8 * TAU) * 5.5, z: Math.sin(i / 8 * TAU) * 5.5, top: 0x6aa85a, topAt: 0.8 });
    shards(b, [0x7ae8ff, 0xc49aff], 4, 4.2, { glow: true });
  },
  crystalCluster(b) { shards(b, [0xc49aff, 0x7ae8ff, 0xff9ae0], 7, R(4, 7), { glow: true, shade: 0.85 }); rocks(b, 0x5a6a7a, 3, 1.4); },
  boat(b) {
    const hull = pick([0xe8523a, 0x3a8ad8, 0xf4f0e4, 0x3aa87a]);
    b.bl(hull, 1, { y: 0.45, sx: 2.6, sy: 0.6, sz: 1.0, rz: R(-0.2, 0.2), detail: 1 });
    b.bx(0xd9b98a, 0.3, 0.1, 1.5, { y: 0.85 }).bx(0xd9b98a, 0.3, 0.1, 1.3, { x: 1.0, y: 0.85 });
  },
  watchtower(b) {
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.fr(0x6a4a30, 0.2, 0.16, 8.4, { x: x * 1.9, z: z * 1.9, rz: x * 0.1, rx: -z * 0.1, seg: 4 });
    b.bx(0x7a5536, 4.4, 0.3, 4.4, { y: 8 });
    b.bx(0x8a6442, 3, 2.1, 3, { y: 8.3 }).rf(0x3a4a3a, 4.2, 1.4, 4.2, { y: 10.4 });
    b.bx(0xffe08a, 1.2, 0.8, 0.08, { y: 9.2, z: 1.54, glow: true });
  },
  tent(b) {
    b.rf(pick([0xf28a2a, 0x3a8ad8, 0xd8d24a, 0xe8523a]), 3.6, 2.3, 3.2, { ry: Math.PI / 2 });
    for (let i = 0; i < 4; i++) b.fr(0x5a4030, 0.12, 0.1, 0.9, { x: 3.4, y: 0.1, ry: i * 1.6, rz: 1.1, seg: 4 });
    b.bl(0xff8a2a, 0.34, { x: 3.4, y: 0.4, glow: true }).bl(0xffd24a, 0.2, { x: 3.4, y: 0.7, glow: true });
  },
  rockArch(b) { arch(b, pick([0xc8683a, 0xb85a34]), { top: 0xe09a58, topAt: 0.6 }); },
  iceArch(b) { arch(b, 0xa8d8f6, { top: 0xffffff, topAt: 0.55 }); },
  hoodoo(b) {
    let y = 0, r = R(1.0, 1.6);
    for (let i = 0, n = 4 + Math.floor(R(0, 3)); i < n; i++) {
      const h = R(1.0, 1.9), next = r * R(0.72, 0.95);
      b.fr(i % 2 ? 0xc8683a : 0xe09a58, r, next, h, { y, seg: 7, shade: R(0.9, 1.08) });
      y += h; r = next;
    }
    b.bl(0xb85a34, r * 2.1, { y: y + 0.3, sy: 0.5 });
  },
  wagon(b) {
    b.bx(0x8a5a36, 3.4, 0.9, 1.7, { y: 0.9 });
    b.bl(0xf4ecd8, 1, { y: 2.4, sx: 1.75, sy: 1.15, sz: 0.95, detail: 1 });
    for (const x of [-1.2, 1.2]) for (const z of [-1, 1]) b.fr(0x5a3a26, 0.8, 0.8, 0.14, { x, y: 0.8, z: z * 0.95, rx: Math.PI / 2, seg: 9 });
    b.bx(0x8a5a36, 2.2, 0.1, 0.1, { x: 2.7, y: 0.8, rz: -0.25 });
  },
  oilRig(b) {
    b.fr(0x5a4030, 2.6, 0.5, 12, { seg: 4, spin: Math.PI / 4 });
    for (const y of [3, 6, 9]) b.bx(0x7a5a3a, 4.2 - y * 0.32, 0.2, 4.2 - y * 0.32, { y });
    b.bx(0x3a3a3e, 2.4, 1.4, 1.6, { x: 3.6 }).fr(0x2a2a2e, 0.5, 0.5, 1.6, { x: 5.4, seg: 8 });
  },
  tiki(b) {
    const stone = pick([0x8a7a66, 0x9a8a74, 0x7a6a5a]), h = R(4, 6);
    b.bx(stone, 2.0, h, 1.7, { rz: R(-0.06, 0.06) });
    b.bx(stone, 2.3, 0.5, 2.0, { y: h * 0.7, shade: 0.85 }).bx(stone, 0.6, h * 0.34, 0.6, { y: h * 0.36, z: 0.9, shade: 0.9 });
    b.bx(0x3a2e26, 1.3, 0.22, 0.2, { y: h * 0.2, z: 0.86 });
    for (const x of [-0.5, 0.5]) b.bx(0x2a2420, 0.42, 0.3, 0.2, { x, y: h * 0.6, z: 0.86 });
    if (chance(0.5)) b.bl(0xff8a2a, 0.3, { x: 1.9, y: 1.7, glow: true }).fr(0x6a4a30, 0.08, 0.08, 1.5, { x: 1.9, seg: 4 });
  },
  parasol(b) {
    const cloth = pick([0xff5a4a, 0x2ec4d8, 0xffd23a, 0xff8ad0, 0xffffff]);
    b.fr(0xf4f0e4, 0.07, 0.07, 2.6, { rz: 0.12, seg: 4 }).fr(cloth, 2.0, 0.06, 0.8, { y: 2.3, x: -0.3, rz: 0.12, seg: 8, top: 0xffffff, topAt: 0.6 });
    b.bx(pick([0xffffff, 0x2ec4d8, 0xffd23a]), 0.9, 0.08, 2.2, { x: 1.4, ry: R(-0.3, 0.3) });
  },
  torii(b) {
    const red = 0xd8342a, w = R(4.6, 6);
    for (const x of [-1, 1]) b.fr(red, 0.38, 0.32, 6, { x: x * w / 2, seg: 7 }).bx(0x2a2222, 0.9, 0.3, 0.9, { x: x * w / 2 });
    b.bx(red, w + 1.4, 0.45, 0.5, { y: 4.4 }).bx(red, w + 2.6, 0.5, 0.7, { y: 5.8 });
    b.bx(0x2a2222, w + 3.4, 0.3, 0.9, { y: 6.3 }).bx(red, 0.4, 0.95, 0.4, { y: 4.85 });
  },
  archBridge(b, biome) {
    b.fr(biome.water, 4.2, 4.2, 0.06, { seg: 9, y: 0.02, sz: 0.6 });
    for (let i = -3; i <= 3; i++) {
      const y = 1.5 - (i * i) * 0.14;
      b.bx(0xd8342a, 1.25, 0.25, 2.2, { x: i * 1.15, y, rz: -i * 0.17 });
      if (i % 3 === 0 || Math.abs(i) === 3) for (const z of [-1, 1]) b.bx(0xb82a22, 0.18, 1.0, 0.18, { x: i * 1.15, y, z });
    }
    for (const z of [-1, 1]) b.bx(0xb82a22, 7.4, 0.14, 0.14, { y: 1.9, z });
  },
  lavaPool(b) {
    const r = R(2.2, 3.6);
    b.fr(0x2a2428, r * 1.25, r, 0.45, { seg: 9 });
    b.fr(0xff6a14, r * 0.96, r * 0.96, 0.05, { y: 0.4, seg: 9, glow: true });
    b.bl(0xffc23a, r * 0.3, { y: 0.3, sy: 0.3, x: R(-0.5, 0.5) * r, z: R(-0.5, 0.5) * r, glow: true });
    rocks(b, 0x3a3438, 3, 1.1, { x: r * 1.3 });
  },
  skullRock(b) {
    b.bl(0x8a8480, 4, { y: 3.4, sy: 1.05, detail: 1 }).bx(0x7a7470, 4.6, 2.2, 4, { z: 0.6 });
    for (const x of [-1.4, 1.4]) b.bl(0x1a1618, 1.05, { x, y: 3.9, z: 3.2 }).bl(0xff5a1a, 0.3, { x, y: 3.9, z: 3.9, glow: true });
    b.bl(0x1a1618, 0.5, { y: 2.6, z: 3.7, sy: 1.4 });
    for (let i = -2; i <= 2; i++) b.bx(0xe8e0d0, 0.6, 0.9, 0.3, { x: i * 0.85, y: 1.1, z: 2.6 });
  },
  ruin(b) {
    b.bx(0x4a444a, 9, 0.5, 5);
    for (let i = 0; i < 4; i++) {
      const h = R(1.5, 6.5);
      b.fr(0x5a545a, 0.6, 0.55, h, { x: i * 2.5 - 3.75, y: 0.5, z: -1.6, seg: 8, shade: R(0.85, 1.05) });
      if (h > 5.5) b.bx(0x4a444a, 1.6, 0.4, 1.6, { x: i * 2.5 - 3.75, y: h + 0.5, z: -1.6 });
    }
    b.fr(0x5a545a, 0.6, 0.55, 4, { x: -2, y: 0.9, z: 1.6, rz: -Math.PI / 2, ry: 0.3, seg: 8 });
    b.bl(0xff6a14, 0.5, { x: 2.5, y: 1.0, z: 1.0, glow: true }).fr(0x3a3438, 0.8, 0.5, 0.6, { x: 2.5, y: 0.5, z: 1.0 });
  },
};
// --- The horizon ---------------------------------------------------------------------
// Landmarks are built in their own units (hundreds of yards) and stand in the ring.

function giantShroom(b, cap, h, x = 0, z = 0) {
  b.fr(0xe8e0cc, h * 0.13, h * 0.08, h * 0.8, { x, z, seg: 8 });
  b.bl(cap, h * 0.42, { x, y: h * 0.8, z, sy: 0.6, detail: 1 });
  for (let i = 0; i < 6; i++) { const a = R(0, TAU), d = h * R(0.1, 0.3); b.bl(0xfffbee, h * 0.06, { x: x + Math.cos(a) * d, y: h * (1.0 - (d / h) * 0.5), z: z + Math.sin(a) * d, sy: 0.4 }); }
}

const LANDMARKS = {
  village(b) {
    b.bl(0x6a9a5a, 110, { sy: 0.32, y: -6, detail: 1 });
    for (let i = 0; i < 9; i++) {
      const a = R(0, TAU), d = R(15, 70), w = R(9, 14);
      b.place(b.lx + Math.cos(a) * d, b.ly + 26 - d * 0.12, b.lz + Math.sin(a) * d, R(0, TAU));
      house(b, { w, d: w * 0.8, h: w * 0.6, wall: pick([0xf6ead0, 0xf2dcc0, 0xe8e4d8]), roof: pick([0xb8502e, 0x8a5a3a, 0x5a6a7a]), door: 0x5a3a26 });
    }
    b.place(b.lx, b.ly + 28, b.lz);
    b.bx(0xf2ece0, 14, 26, 14).fr(0x5a6a7a, 11, 0, 30, { y: 26, seg: 4, spin: Math.PI / 4 }).bx(0xffe08a, 4, 6, 14.4, { y: 14, glow: true });
  },
  lighthouse(b) {
    rocks(b, 0x6a6a6c, 5, 34);
    for (let i = 0; i < 5; i++) b.fr(i % 2 ? 0xe8423a : 0xf8f4ec, 13 - i * 1.5, 11.5 - i * 1.5, 16, { y: 14 + i * 16, seg: 9 });
    b.fr(0x3a3a40, 9, 9, 2, { y: 94, seg: 9 }).fr(0xfff2a8, 5, 5, 8, { y: 96, seg: 8, glow: true }).fr(0xe8423a, 8, 0, 8, { y: 104, seg: 9 });
  },
  seaStacks(b) {
    for (let i = 0; i < 5; i++) {
      const h = R(35, 95), r = R(11, 22);
      b.fr(0x7a7468, r, r * 0.6, h, { x: i * 46 - 90 + R(-10, 10), z: R(-30, 30), seg: 7, top: 0x7a9a5a, topAt: 0.92, shade: R(0.85, 1.05) });
    }
  },
  greatPeak(b) {
    b.fr(0x56727c, 250, 0, 300, { seg: 7, top: 0xf4f8ff, topAt: 0.5 });
    b.fr(0x5f7f86, 170, 0, 190, { x: -170, z: 40, seg: 6, top: 0xf4f8ff, topAt: 0.6 }).fr(0x5f7f86, 150, 0, 160, { x: 180, z: 20, seg: 6, top: 0xf4f8ff, topAt: 0.66 });
  },
  pyramids(b) {
    [[0, 130], [-150, 95], [130, 70]].forEach(([x, h], i) => {
      b.fr(i ? 0xd9a868 : 0xe6b878, h * 0.8, 0, h, { x, z: i * 30, seg: 4, spin: 0.5, top: 0xf2d6a0, topAt: 0.9 });
    });
    b.bl(0xd9a868, 26, { x: 60, y: 14, z: -70, sy: 1.1, sx: 1.6 }).bx(0xe6b878, 12, 22, 14, { x: 86, y: 18, z: -70 });
  },
  islandVolcano(b) {
    b.fr(0xf2dfae, 240, 200, 6, { seg: 9 });
    b.fr(0x3f9a4a, 200, 46, 170, { y: 5, seg: 8, top: 0x6a5a4a, topAt: 0.72 });
    b.fr(0xff6a14, 40, 40, 2, { y: 174, seg: 8, glow: true });
    for (let i = 0; i < 5; i++) b.bl(0xf0ece8, 26 + i * 9, { x: i * 16, y: 205 + i * 34, z: i * 6, sy: 0.8, detail: 1, shade: 1 - i * 0.04 });
  },
  iceCastle(b) {
    b.bl(0xdcecf8, 120, { sy: 0.3, y: -8, detail: 1 });
    for (let i = 0; i < 7; i++) {
      const h = i ? R(60, 130) : 170, r = i ? R(10, 16) : 20, a = (i / 6) * TAU;
      const x = i ? Math.cos(a) * 52 : 0, z = i ? Math.sin(a) * 52 : 0;
      b.fr(0xb8dcf6, r, r * 0.8, h, { x, y: 20, z, seg: 7, top: 0xe8f6ff, topAt: 0.7 });
      b.fr(0x6ab0e8, r * 1.3, 0, h * 0.34, { x, y: 20 + h, z, seg: 7 });
      b.bx(0xbff0ff, 5, 9, r * 2.1, { x, y: 20 + h * 0.6, z, glow: true });
    }
  },
  greatTree(b, biome) {
    b.fr(0x4f3626, 26, 15, 120, { seg: 8 });
    for (let i = 0; i < 4; i++) b.fr(0x4f3626, 10, 4, 70, { y: 80, ry: i * 1.6 + 0.4, rz: 0.8, seg: 6 });
    b.bl(pick(biome.canopy), 100, { y: 190, sy: 0.8, detail: 1 });
    for (let i = 0; i < 6; i++) b.bl(pick(biome.canopy), R(50, 70), { x: Math.cos(i) * 80, y: R(140, 200), z: Math.sin(i) * 80, detail: 1 });
  },
  snowCone(b) {
    b.fr(0x6a84a8, 300, 44, 250, { seg: 9, top: 0xffffff, topAt: 0.62 });
  },
  pagoda(b) {
    b.bl(0x6a9a6a, 80, { sy: 0.3, y: -6, detail: 1 });
    for (let i = 0; i < 5; i++) {
      const w = 34 - i * 5, y = 16 + i * 22;
      b.bx(0xd8342a, w, 16, w, { y }).fr(0x2a4a4a, w * 1.15, w * 0.5, 7, { y: y + 15, seg: 4, spin: Math.PI / 4 });
      b.bx(0xffe6a0, w * 0.4, 6, w + 0.6, { y: y + 4, glow: true });
    }
    b.fr(0xe8c44a, 2, 0, 28, { y: 132, seg: 5 });
  },
  eruption(b) {
    b.fr(0x3a3034, 280, 60, 240, { seg: 9 });
    b.fr(0xff6a14, 54, 54, 3, { y: 239, seg: 9, glow: true });
    for (let i = 0; i < 6; i++) {
      // Lava runs down the flank facing the course
      const a = i * 1.05 + R(-0.2, 0.2), len = R(110, 230);
      b.fr(0xff5a14, R(5, 9), 2, len, { x: Math.cos(a) * 58, y: 236, z: Math.sin(a) * 58, ry: -a, rz: -Math.PI + 0.74, seg: 4, glow: true });
    }
    for (let i = 0; i < 7; i++) b.bl(i < 2 ? 0x7a4a40 : 0x4a4448, 44 + i * 12, { x: i * 22, y: 280 + i * 44, z: i * 8, sy: 0.85, detail: 1 });
    for (let i = 0; i < 12; i++) b.bl(0xffc23a, R(3, 7), { x: R(-80, 80), y: R(250, 380), z: R(-80, 80), glow: true });
  },
  fortress(b) {
    rocks(b, 0x2e2a30, 5, 70);
    b.bx(0x2a2630, 110, 70, 60, { y: 30 });
    for (const x of [-60, 60, 0]) {
      const h = x ? 130 : 180, r = x ? 20 : 24;
      b.fr(0x322c38, r, r * 0.9, h, { x, y: 30, seg: 8 }).fr(0x8a2a22, r * 1.25, 0, h * 0.3, { x, y: 30 + h, seg: 8 });
      for (let k = 0; k < 3; k++) b.bx(0xff7a1e, 7, 12, r * 2.05, { x, y: 60 + k * (h * 0.28), glow: true });
    }
    for (let i = -4; i <= 4; i++) b.bx(0x2a2630, 8, 9, 62, { x: i * 12.5, y: 100 });
    b.bx(0xff7a1e, 22, 30, 61, { y: 32, glow: true });
  },
  giantShroom(b, biome) {
    giantShroom(b, pick(biome.canopy), 210);
    giantShroom(b, pick(biome.canopy), 130, -120, 30);
    giantShroom(b, pick(biome.canopy), 90, 100, -20);
  },
};

function buildBackdrop(b, world) {
  const { biome, spec } = world;
  const { style, color, cap, capAt = 0.6, capGlow, height: [lo, hi] } = biome.backdrop;
  const ground = biome.base - biome.amp1 - 6;
  const n = style === 'islands' ? 12 : 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R(0, 0.2), r = R(430, 580), h = R(lo, hi), w = R(90, 200);
    b.place(Math.cos(a) * r, ground, Math.sin(a) * r, R(0, TAU));
    const o = { seg: 6 + Math.floor(R(0, 3)), sx: 1.5, shade: R(0.88, 1.08) };
    if (style === 'peaks') {
      b.fr(color, w * 0.8, 0, h, { ...o, sx: 1.2, top: capGlow ? undefined : cap, topAt: capAt + R(-0.08, 0.08) });
      if (capGlow && chance(0.45)) b.fr(cap, w * 0.8 * 0.13, 0, h * 0.13, { y: h * 0.875, seg: o.seg, sx: 1.2, glow: true });
    } else if (style === 'mesas') {
      const steps = 2 + Math.floor(R(0, 2));
      for (let k = 0, y = 0, rr = w * 0.75; k < steps; k++) {
        const sh = h / steps;
        b.fr(k % 2 ? cap : color, rr, rr * 0.86, sh, { ...o, y, sx: 1.3, top: cap, topAt: 0.86 });
        y += sh; rr *= R(0.55, 0.8);
      }
    } else if (style === 'dunes') {
      b.bl(color, w, { sy: h / w, sx: 1.6, detail: 1, shade: o.shade });
    } else if (style === 'islands') {
      b.fr(0xf2dfae, w * 1.1, w * 0.9, 9, { seg: 9 }).bl(color, w * 0.8, { y: 6, sy: (h / w) * 1.1, detail: 1, shade: o.shade });
    } else {
      b.fr(color, w, 0, h, o);
      if (style === 'shrooms' && chance(0.6)) giantShroom(b, pick(biome.canopy), R(60, 130), R(-60, 60), R(-60, 60));
    }
  }
  // Landmarks: the first stands beyond the green, where the eye already goes
  const path = spec.path, from = path[0], to = path[path.length - 1];
  const ahead = Math.atan2(to.z - from.z, to.x - from.x);
  biome.landmarks.forEach((kind, i) => {
    const a = ahead + (i ? R(1.6, 2.6) * (chance(0.5) ? 1 : -1) : R(-0.35, 0.35));
    const r = 400;
    b.lx = Math.cos(a) * r; b.ly = ground + 4; b.lz = Math.sin(a) * r;
    // Turned to face the course (their fronts are +z)
    b.place(b.lx, b.ly, b.lz, Math.atan2(-b.lx, -b.lz), 0.82);
    LANDMARKS[kind](b, biome);
  });
}

// --- Assembly ------------------------------------------------------------------------

/** Free ground beside the hole, thickest just off the fairway where it will be seen. */
function scatterSpots(world, count, { clear, reach, apart, taken }) {
  const { spec } = world, spots = [];
  for (let tries = 0; tries < count * 30 && spots.length < count; tries++) {
    const p = pointAlongPath(spec.path, R(-30, world.length + 45));
    const across = (chance(0.5) ? -1 : 1) * (spec.fairwayHalf + clear + rnd() * rnd() * reach);
    const x = p.x - p.dirZ * across, z = p.z + p.dirX * across;
    if (Math.abs(x) > world.half * 0.96 || Math.abs(z) > world.half * 0.96) continue;
    if (pathInfo(spec.path, x, z).dist < spec.fairwayHalf + clear) continue;
    if (world.surfaceAt(x, z) !== 'rough') continue;
    if (taken.some((t) => Math.hypot(x - t.x, z - t.z) < apart + (t.r || 0))) continue;
    spots.push({ x, z, y: world.heightAt(x, z) });
  }
  return spots;
}

/**
 * Build every solid thing that dresses a hole.
 * Returns { trees, props, backdrop, glow } meshes (glow is unlit).
 */
export function buildProps(world, rng, { lowDetail = false } = {}) {
  rnd = rng;
  const { biome } = world;
  const lit = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const finish = (builder, name, shadows) => {
    const mesh = new THREE.Mesh(builder.lit.geometry(), lit());
    mesh.name = name;
    mesh.castShadow = shadows;
    return mesh;
  };
  const glowParts = [];

  // Trees: the colliders already exist; give each one its own body
  const trees = new Builder();
  const grow = TREES[biome.treeKind];
  for (const t of world.trees) {
    trees.place(t.x, t.y - 0.1, t.z, R(0, TAU), t.s);
    grow(trees, biome);
  }
  glowParts.push(trees.glow);

  // Set pieces first (they need the room), then the small stuff around them
  const props = new Builder();
  const taken = world.trees.map((t) => ({ x: t.x, z: t.z, r: 0 }));
  for (const [kind, count] of biome.features) {
    const spots = scatterSpots(world, Math.ceil(count * 1.5), { clear: 20, reach: 95, apart: 10, taken });
    for (const s of spots) {
      taken.push({ x: s.x, z: s.z, r: 9 });
      props.place(s.x, s.y - 0.4, s.z, R(0, TAU), R(1.3, 1.8));
      FEATURES[kind](props, biome);
    }
  }
  for (const [kind, count] of biome.props) {
    const spots = scatterSpots(world, Math.ceil(count * (lowDetail ? 0.9 : 1.5)), { clear: 4, reach: 80, apart: 3, taken });
    for (const s of spots) {
      props.place(s.x, s.y - 0.1, s.z, R(0, TAU), R(1.2, 2.0));
      PROPS[kind](props, biome);
    }
  }
  glowParts.push(props.glow);

  const backdrop = new Builder();
  buildBackdrop(backdrop, world);
  glowParts.push(backdrop.glow);

  const glowStream = new Stream();
  for (const part of glowParts) {
    for (const key of ['pos', 'nor', 'col']) for (let i = 0; i < part[key].length; i++) glowStream[key].push(part[key][i]);
  }
  const glow = new THREE.Mesh(glowStream.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  glow.name = 'glow';

  const propsMesh = finish(props, 'props', true);
  propsMesh.receiveShadow = true;
  return { trees: finish(trees, 'trees', true), props: propsMesh, backdrop: finish(backdrop, 'backdrop', false), glow };
}

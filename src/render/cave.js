/**
 * The cave: a rock roof over the whole hole, its walls coming down just past
 * the out-of-bounds line (and over the terrain's edge, so the world never
 * ends in a seam), stalactites hanging from it, and shafts of daylight
 * falling through gaps in the roof onto the course.
 *
 * The roof is the same one the ball bounces off (world.ceilingAt): what you
 * see is what you clonk. Built once per hole; a handful of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createGameRng } from '../core/rng.js';
import { pathInfo, pointAlongPath, pathLength } from '../course/shapes.js';
import { TILE_HALF } from '../course/holeDesigner.js';

const WALL_FROM = 226; // the walls start down here (out of bounds is 228)
const WALL_TO = 241;   // ...and meet the ground just past the terrain's edge

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildCave(world) {
  const group = new THREE.Group();
  group.name = 'cave';
  const g = createGameRng(`${world.spec.seed}:cave-${world.spec.number}`);
  const rng = g.rng, noise = g.noise2D;
  const clampT = (v) => Math.max(-TILE_HALF, Math.min(TILE_HALF, v));
  const spec = world.spec;

  // ---- Shafts of daylight through gaps in the roof --------------------------------
  // One over the green, one partway down the fairway, a couple off to the side
  const L = pathLength(spec.path);
  const spots = [{ x: world.cup.x, z: world.cup.z, r: 9 }, { ...pointAlongPath(spec.path, L * (0.35 + rng() * 0.2)), r: 12 }];
  for (let k = 0; k < 2; k++) {
    const p = pointAlongPath(spec.path, L * (0.15 + rng() * 0.7)), side = rng() < 0.5 ? -1 : 1, d = spec.fairwayHalf + 25 + rng() * 40;
    spots.push({ x: p.x - p.dirZ * d * side, z: p.z + p.dirX * d * side, r: 7 + rng() * 5 });
  }
  // ---- The shell: roof and walls, one rocky sheet --------------------------------
  // Its light is baked in (and it is drawn unlit): faceted shading as if lit
  // from the course below, warm halos round each gap the daylight comes
  // through, and seams of glowing mineral. A downward-facing roof gets next to
  // nothing from the scene's lights, and real lights would cost every phone.
  const SPAN = TILE_HALF + 14, SEG = 110;
  let geo = new THREE.PlaneGeometry(SPAN * 2, SPAN * 2, SEG, SEG).rotateX(Math.PI / 2); // faces down
  {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const e = Math.max(Math.abs(x), Math.abs(z)) + noise(x * 0.03, z * 0.03) * 4;
      const w = smooth(WALL_FROM, WALL_TO, e);
      const roof = world.ceilingAt(clampT(x), clampT(z));
      const floor = world.heightAt(clampT(x), clampT(z)) - 3;
      // Lumpy rock: hollows up into the roof, bulges down the walls
      const lump = noise(x * 0.05 + 11, z * 0.05 - 7) * 2.4 + noise(x * 0.14, z * 0.14) * 0.9;
      pos.setY(i, roof + (floor - roof) * w + lump);
    }
  }
  geo = geo.toNonIndexed();
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const rock = new THREE.Color(0x56606c), high = new THREE.Color(0x3c4450), wallC = new THREE.Color(0x6a6c76);
  const vein = new THREE.Color(0x4af0e0), warm = new THREE.Color(0xffd9a0), c = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); d.fromBufferAttribute(pos, i + 2);
    n.copy(b).sub(a).cross(d.clone().sub(a)).normalize();
    if (n.y > 0) n.negate(); // (seen from below)
    const x = (a.x + b.x + d.x) / 3, z = (a.z + b.z + d.z) / 3;
    const e = Math.max(Math.abs(x), Math.abs(z));
    const w = smooth(WALL_FROM, WALL_TO, e);
    // Light from the course below and a little from one side: facets catch it unevenly
    const lit = Math.max(0, -n.y * 0.55 + n.x * 0.35 + n.z * 0.2);
    c.copy(high).lerp(rock, 0.5 + 0.5 * noise(x * 0.02 - 40, z * 0.02 + 40)).lerp(wallC, w).multiplyScalar(0.55 + 0.75 * lit);
    // Round each gap in the roof, the rock is warm with daylight
    for (const sp of spots) {
      const q = Math.hypot(x - sp.x, z - sp.z) / (sp.r * 3.2);
      if (q < 1.6) c.lerp(warm, 0.55 * Math.exp(-q * q * 2.2));
    }
    const seam = Math.max(0, noise(x * 0.07 + 90, z * 0.07 - 90) - 0.8) * 5;
    if (seam > 0) c.lerp(vein, Math.min(0.85, seam));
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  shell.name = 'caveShell';
  group.add(shell);

  // ---- Stalactites: long ones only away from the line of play --------------------
  const tips = [], glowTips = [];
  const corridor = spec.fairwayHalf + 14;
  for (let k = 0, n = 0; k < 900 && n < 150; k++) {
    const x = (rng() * 2 - 1) * (WALL_FROM - 6), z = (rng() * 2 - 1) * (WALL_FROM - 6);
    const off = pathInfo(spec.path, x, z).dist;
    const long = off > corridor;
    const len = long ? 2.5 + rng() * 5.5 : 1 + rng() * 2;
    if (!long && rng() < 0.6) continue;
    const r = len * (0.12 + rng() * 0.08);
    const y = world.ceilingAt(x, z) + 1.2;
    const cone = new THREE.ConeGeometry(r, len, 6, 1).rotateX(Math.PI).translate(x, y - len / 2, z);
    (rng() < 0.12 ? glowTips : tips).push(cone);
    n++;
  }
  if (tips.length) {
    const m = new THREE.Mesh(mergeGeometries(tips), new THREE.MeshLambertMaterial({ color: 0x7a7e8a, flatShading: true, emissive: 0x2a3440 }));
    m.name = 'stalactites';
    group.add(m);
  }
  if (glowTips.length) {
    // (a few are crystal, and glow)
    const m = new THREE.Mesh(mergeGeometries(glowTips), new THREE.MeshBasicMaterial({ color: 0x6af0e8 }));
    m.name = 'crystalTips';
    group.add(m);
  }

  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xfff0c8) }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */`
      varying float vH; varying vec3 vN; varying vec3 vView;
      void main() {
        vH = uv.y;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime;
      varying float vH; varying vec3 vN; varying vec3 vView;
      void main() {
        // Brightest at the roof, fading to the floor; soft at the cone's edges
        float edge = pow(abs(dot(vN, vView)), 1.6);
        float a = 0.32 * mix(0.2, 1.0, vH) * edge * (0.85 + 0.15 * sin(uTime * 0.6 + vH * 6.0));
        gl_FragColor = vec4(uColor, a); // (additive: adds uColor * a)
      }`,
  });
  for (const s of spots) {
    const top = world.ceilingAt(s.x, s.z), ground = world.heightAt(s.x, s.z);
    const h = top - ground + 1;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.55, s.r, h, 20, 1, true), shaftMat);
    shaft.position.set(s.x, ground + h / 2, s.z);
    shaft.renderOrder = 5;
    group.add(shaft);
    // The gap itself: a bright patch of daylight in the roof
    const hole = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.62, 18).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff6dc, fog: false }));
    hole.position.set(s.x, top - 0.3, s.z);
    group.add(hole);
    // ...and a warm pool of it on the ground
    const pool = new THREE.Mesh(new THREE.CircleGeometry(s.r * 1.1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    pool.position.set(s.x, ground + 0.08, s.z);
    group.add(pool);
  }
  group.userData.shaftMat = shaftMat;
  return group;
}

export function updateCave(cave, time) {
  if (cave?.userData.shaftMat) cave.userData.shaftMat.uniforms.uTime.value = time;
}

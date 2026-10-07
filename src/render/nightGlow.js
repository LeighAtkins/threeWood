/**
 * Night golf — after dark the course lights itself.
 *
 * Nobody can play a hole they cannot see, and a floodlit course would kill
 * the camping mood, so the course glows instead: the turf gives back a little
 * of its own colour (terrainMesh.js), a line of light runs round the green,
 * camp lanterns mark both edges of the fairway like a runway, and the cup
 * stands in a column of gold light. All of it fades in with sky.night.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pathLength, pointAlongPath } from '../course/shapes.js';

/** Shared with terrainMesh.js: how much the turf glows (0 by day). */
export const terrainGlow = { value: 0 };

export function buildNightGlow(world) {
  const group = new THREE.Group();
  const { spec, cup } = world;

  // ---- A neon line round the edge of the green -------------------------------------
  const pts = [];
  const N = 56;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let r = 1;
    while (r < 40 && world.surfaceAt(spec.green.x + Math.cos(a) * (r + 0.5), spec.green.z + Math.sin(a) * (r + 0.5)) === 'green') r += 0.5;
    const x = spec.green.x + Math.cos(a) * r, z = spec.green.z + Math.sin(a) * r;
    pts.push(new THREE.Vector3(x, world.heightAt(x, z) + 0.07, z));
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x7dffc4, transparent: true, opacity: 0, fog: false });
  const ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), N * 3, 0.07, 5, true), ringMat);
  group.add(ring);

  // ---- Lanterns down both sides of the fairway ----------------------------------------
  const spots = [];
  const total = pathLength(spec.path);
  for (let d = Math.max(spec.fairwayStart ?? 20, 18); d < total - 12; d += 13) {
    const p = pointAlongPath(spec.path, d), q = pointAlongPath(spec.path, d + 1);
    const tx = q.x - p.x, tz = q.z - p.z, len = Math.hypot(tx, tz) || 1;
    for (const side of [-1, 1]) {
      const off = (spec.fairwayHalf + 2.2) * side;
      const x = p.x - (tz / len) * off, z = p.z + (tx / len) * off;
      const s = world.surfaceAt(x, z);
      if (s === 'water' || s === 'green' || s === 'bunker') continue;
      // nx, nz: toward the middle of the fairway
      spots.push({ x, y: world.heightAt(x, z), z, nx: (tz / len) * side, nz: -(tx / len) * side });
    }
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, fog: false });
  const postMat = new THREE.MeshBasicMaterial({ color: 0x2a2a30, transparent: true, opacity: 0 });
  // Each is a camp lantern hung from a crook: a post, an arm, a cap and a foot (dark), and
  // a fat glowing glass (bright). Two instanced meshes for the lot.
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.25, 0.25, 0.42, 8).translate(0.42, 1.27, 0),
    new THREE.SphereGeometry(0.25, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0.42, 1.06, 0),
  ]);
  const frameGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.045, 0.06, 1.85, 5).translate(0, 0.925, 0),
    new THREE.BoxGeometry(0.5, 0.05, 0.05).translate(0.22, 1.82, 0),
    new THREE.CylinderGeometry(0.012, 0.012, 0.18, 3).translate(0.42, 1.72, 0),
    new THREE.ConeGeometry(0.3, 0.16, 8).translate(0.42, 1.56, 0),
      ]);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, spots.length));
  const posts = new THREE.InstancedMesh(frameGeo, postMat, Math.max(1, spots.length));
  // A soft pool of light on the turf under each lantern
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffc56a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(2.6, 16).rotateX(-Math.PI / 2), poolMat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  spots.forEach((s, i) => {
    // The arm reaches in over the fairway
    m.makeRotationY(Math.atan2(-s.nz, s.nx)).setPosition(s.x, s.y, s.z);
    lamps.setMatrixAt(i, m);
    posts.setMatrixAt(i, m);
    pools.setMatrixAt(i, m.makeTranslation(s.x + s.nx * 0.42, s.y + 0.06, s.z + s.nz * 0.42));
  });
  lamps.count = posts.count = pools.count = spots.length;
  group.add(posts, pools, lamps);

  // ---- The cup: a column of light you can find from the tee ----------------------------
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.26, 14, 12, 1, true), beamMat);
  beam.position.set(cup.x, cup.y + 7, cup.z);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.3, 1.5, 24).rotateX(-Math.PI / 2), haloMat);
  halo.position.set(cup.x, cup.y + 0.05, cup.z);
  group.add(beam, halo);

  group.visible = false;
  group.userData = { ringMat, lampMat, postMat, poolMat, beamMat, haloMat, halo };
  return group;
}

export function updateNightGlow(group, night, time) {
  terrainGlow.value = night * (0.3 + Math.sin(time * 0.8) * 0.02);
  if (!group) return;
  group.visible = night > 0.02;
  if (!group.visible) return;
  const u = group.userData;
  const breathe = 0.85 + Math.sin(time * 2.1) * 0.15;
  u.ringMat.opacity = night * 0.95;
  u.lampMat.opacity = night;
  u.postMat.opacity = night;
  u.poolMat.opacity = night * 0.24 * breathe;
  u.beamMat.opacity = night * 0.2 * breathe;
  u.haloMat.opacity = night * 0.45 * breathe;
  u.halo.scale.setScalar(1 + Math.sin(time * 2.1) * 0.12);
}

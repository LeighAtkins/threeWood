/**
 * Dressing for the holes that play like something else: the rails, gate and
 * flower pots that make the crazy-golf lane read as crazy golf, and the gold
 * ring and tall flag that let you find the bucket's giant cup from the tee.
 * Decoration only: nothing here touches the ball.
 */

import * as THREE from 'three';
import { pathLength, pointAlongPath, pathInfo } from '../course/shapes.js';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export function buildDressing(world) {
  const group = new THREE.Group();
  const { spec } = world;
  const channel = spec.green.channel;
  if (channel) {
    const pts = channel.pts, len = pathLength(pts);
    const rail = lambert(0xf3e7cf), post = lambert(0xc9573f);
    // Kerbs: short white rails end to end along both walls, a red post at each join
    const railGeo = new THREE.BoxGeometry(1.5, 0.16, 0.22);
    const postGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.42, 8);
    const rails = [], posts = [];
    for (const side of [1, -1]) {
      for (let d = 0.6; d < len; d += 1.5) {
        const p = pointAlongPath(pts, d);
        const across = channel.half + 1.75;
        const x = p.x - p.dirZ * across * side, z = p.z + p.dirX * across * side;
        // Skip where the wall of another leg of the lane is closer (inside of a bend)
        if (pathInfo(pts, x, z).dist < channel.half + 1.2) continue;
        const y = world.heightAt(x, z);
        rails.push({ x, y: y + 0.1, z, yaw: Math.atan2(-p.dirZ, p.dirX) });
        posts.push({ x, y: y + 0.21, z });
      }
    }
    // ...and across both ends of the lane
    for (const [d, back] of [[0, -1], [len, 1]]) {
      const p = pointAlongPath(pts, d);
      for (let k = -2; k <= 2; k++) {
        const x = p.x + p.dirX * back * (channel.half + 0.6) - p.dirZ * k * 1.5, z = p.z + p.dirZ * back * (channel.half + 0.6) + p.dirX * k * 1.5;
        const y = world.heightAt(x, z);
        rails.push({ x, y: y + 0.1, z, yaw: Math.atan2(-p.dirZ, p.dirX) + Math.PI / 2 });
        posts.push({ x, y: y + 0.21, z });
      }
    }
    const railMesh = new THREE.InstancedMesh(railGeo, rail, rails.length);
    const postMesh = new THREE.InstancedMesh(postGeo, post, posts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    rails.forEach((r, i) => { q.setFromAxisAngle(up, r.yaw); railMesh.setMatrixAt(i, m.compose(new THREE.Vector3(r.x, r.y, r.z), q, one)); });
    posts.forEach((p, i) => { postMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)); });
    railMesh.castShadow = postMesh.castShadow = true;
    group.add(railMesh, postMesh);

    // A gate over the hump: two posts outside the walls, a bar high overhead, bunting
    const hump = pointAlongPath(pts, spec.shape.at * len);
    const gate = new THREE.Group();
    gate.position.set(hump.x, world.heightAt(hump.x, hump.z), hump.z);
    gate.rotation.y = Math.atan2(-hump.dirZ, hump.dirX) + Math.PI / 2;
    const span = channel.half + 2.2;
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.2, 8), post);
      leg.position.set(s * span, 1.6, 0);
      gate.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1, 0.32, 0.34), rail);
    bar.position.y = 3.25;
    gate.add(bar);
    const flags = [0xffd23f, 0x5fb3e6, 0xff7a9a, 0x7bd152];
    for (let i = 0; i < 9; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 3), lambert(flags[i % 4], { side: THREE.DoubleSide }));
      f.position.set(-span + (i + 0.5) * (span * 2) / 9, 2.8, 0);
      f.rotation.x = Math.PI;
      gate.add(f);
    }
    gate.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(gate);

    // Flower pots at the bends
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const ox = (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z) - (c.x - b.x) / Math.hypot(c.x - b.x, c.z - b.z);
      const oz = (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z) - (c.z - b.z) / Math.hypot(c.x - b.x, c.z - b.z);
      const ol = Math.hypot(ox, oz) || 1;
      const x = b.x + (ox / ol) * (channel.half + 3.4), z = b.z + (oz / ol) * (channel.half + 3.4);
      const pot = new THREE.Group();
      pot.position.set(x, world.heightAt(x, z), z);
      const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.55, 0.8, 10), lambert(0xc9734a));
      tub.position.y = 0.4;
      pot.add(tub);
      for (let k = 0; k < 6; k++) {
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), lambert(flags[(k + i) % 4]));
        bloom.position.set(Math.cos(k * 1.1) * 0.4, 0.95 + (k % 2) * 0.15, Math.sin(k * 1.1) * 0.4);
        pot.add(bloom);
      }
      pot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      group.add(pot);
    }
  }

  const cup = world.cup;
  if (cup.r) {
    // The bucket: a gold ring round the giant cup and a tall flag, seen from the tee
    const ring = new THREE.Mesh(new THREE.RingGeometry(cup.r * 1.25, cup.r * 1.6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    ring.position.set(cup.x, cup.y + 0.03, cup.z);
    ring.renderOrder = 2;
    group.add(ring);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(cup.r * 1.4, cup.r * 1.4, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }));
    beacon.position.set(cup.x, cup.y + 7, cup.z);
    group.add(beacon);
  }
  return group;
}

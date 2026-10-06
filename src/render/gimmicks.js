/**
 * Toys on the hole — something to aim at besides the flag.
 *
 *   rings     three gold hoops hung along the tee shot's flight. Fly through
 *             them (swipe to steer a good strike) for points and a kick of speed
 *   bullseye  a target painted where a good drive lands
 *   boing     big red mushrooms: land on one and the ball springs away
 *
 * Where they stand comes from the hole design (course/holeDesigner.js), so a
 * shared seed gives everyone the same toys. This file draws them and answers
 * "did the ball hit one?"; game.js decides what that is worth.
 */

import * as THREE from 'three';

const RING_R = 3.6;
export const BULL = [3, 7.5, 12.5]; // radii of the bull, inner and outer

export class Gimmicks {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.kind = null;
    this.rings = [];
    this.pads = [];
  }

  load(world) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);
    const toy = world.spec.gimmick;
    this.kind = toy?.kind || null;
    this.rings = [];
    this.pads = [];
    this.hung = false;
    this.target = null;
    if (this.kind === 'bullseye') this.buildBullseye(world, toy);
    if (this.kind === 'boing') this.buildPads(world, toy);
    if (world.spec.fishing) this.buildFishingSign(world, world.spec.fishing);
  }

  /** A little sign on the bank facing the fairway: fish here. */
  buildFishingSign(world, pond) {
    // On the fairway side of the pond, just past the water's edge
    const toPath = Math.atan2(world.spec.path[0].z - pond.z, world.spec.path[0].x - pond.x);
    let x = pond.x, z = pond.z, r = pond.r * 0.9;
    for (let i = 0; i < 12 && world.surfaceAt(x, z) === 'water'; i++) {
      r += 1.2;
      x = pond.x + Math.cos(toPath) * r; z = pond.z + Math.sin(toPath) * r;
    }
    const y = world.heightAt(x, z);
    const sign = new THREE.Group();
    sign.position.set(x, y, z);
    sign.rotation.y = Math.atan2(Math.cos(toPath), Math.sin(toPath)) + Math.PI;
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a5632 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 6), wood);
    post.position.y = 1.1;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.1), new THREE.MeshLambertMaterial({ color: 0xf3e6c8 }));
    board.position.set(0, 2.1, 0);
    const fish = new THREE.Group();
    const blue = new THREE.MeshBasicMaterial({ color: 0x2f8fae });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), blue);
    body.scale.set(1.5, 0.9, 0.3);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.32, 3), blue);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -0.55;
    tail.scale.z = 0.3;
    fish.add(body, tail);
    fish.position.set(0.05, 2.12, 0.08);
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4d4d }));
    bob.position.set(0.55, 2.42, 0.08);
    sign.add(post, board, fish, bob);
    this.group.add(sign);
  }

  buildBullseye(world, toy) {
    this.target = { x: toy.x, z: toy.z };
    const y = world.heightAt(toy.x, toy.z);
    const colors = [0xff4d4d, 0xfff8ec, 0xff4d4d];
    let inner = 0;
    BULL.forEach((r, i) => {
      // Draped over the turf: each ring is a strip of quads following the ground
      const seg = 40, pos = [], idx = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        for (const rr of [inner + 0.25, r]) {
          const x = toy.x + Math.cos(a) * rr, z = toy.z + Math.sin(a) * rr;
          pos.push(x, world.heightAt(x, z) + 0.09, z);
        }
        if (k < seg) { const b = k * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      this.group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
      inner = r;
    });
    // A flag pole of light so it can be found from the tee
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
    beam.position.set(toy.x, y + 4.5, toy.z);
    this.group.add(beam);
  }

  buildPads(world, toy) {
    const cream = new THREE.MeshLambertMaterial({ color: 0xfff4e0 });
    for (const p of toy.pads) {
      const g = new THREE.Group();
      const y = world.heightAt(p.x, p.z);
      g.position.set(p.x, y, p.z);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.32, p.r * 0.42, 1.3, 10), cream);
      stem.position.y = 0.65;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(p.r, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshLambertMaterial({ color: 0xe8432e }));
      cap.position.y = 1.2;
      cap.scale.y = 0.62;
      g.add(stem, cap);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4, rr = i % 2 ? 0.75 : 0.42;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(p.r * 0.14, 8, 6), cream);
        dot.position.set(Math.cos(a) * p.r * rr, 1.2 + Math.sqrt(Math.max(0, 1 - rr * rr)) * p.r * 0.62, Math.sin(a) * p.r * rr);
        dot.scale.y = 0.5;
        g.add(dot);
      }
      this.group.add(g);
      this.pads.push({ ...p, y, top: y + 1.2 + p.r * 0.62, mesh: g, squash: 0, cool: 0 });
    }
  }

  /** Hang the rings along a shot's flight. points: flat xyz from the aim preview. */
  hangRings(points) {
    if (this.kind !== 'rings' || this.hung) return;
    const n = points.length / 3;
    if (n < 12) return;
    this.hung = true;
    const side = [0, 2.6, -2.6];
    [0.3, 0.52, 0.74].forEach((f, i) => {
      const k = Math.min(n - 2, Math.max(1, Math.round(f * (n - 1))));
      const p = new THREE.Vector3(points[k * 3], points[k * 3 + 1], points[k * 3 + 2]);
      const q = new THREE.Vector3(points[k * 3 + 3], points[k * 3 + 4], points[k * 3 + 5]);
      const dir = q.clone().sub(p).normalize();
      // Off to one side, so the second and third want a nudge in the air
      p.x += -dir.z * side[i]; p.z += dir.x * side[i];
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, fog: false });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.2, 8, 28), mat);
      mesh.position.copy(p);
      mesh.lookAt(p.clone().add(dir));
      this.group.add(mesh);
      this.rings.push({ p, mesh, mat, hit: false, t: 0 });
    });
  }

  /** Rings the ball is passing through right now (each reported once). */
  ringsHit(ball) {
    const got = [];
    for (const ring of this.rings) {
      if (ring.hit) continue;
      if (Math.hypot(ball.x - ring.p.x, ball.y - ring.p.y, ball.z - ring.p.z) < RING_R + 0.3) { ring.hit = true; got.push(ring); }
    }
    return got;
  }

  get ringsDone() { return this.rings.length > 0 && this.rings.every((r) => r.hit); }

  /** 3 = bull, 2 = inner, 1 = outer, 0 = missed. */
  bullseye(x, z) {
    if (!this.target) return 0;
    const d = Math.hypot(x - this.target.x, z - this.target.z);
    return d < BULL[0] ? 3 : d < BULL[1] ? 2 : d < BULL[2] ? 1 : 0;
  }

  /** The mushroom under (x, z), if it is ready to bounce something. */
  padAt(x, z) {
    return this.pads.find((p) => p.cool <= 0 && Math.hypot(x - p.x, z - p.z) < p.r) || null;
  }

  bouncePad(pad) { pad.squash = 1; pad.cool = 0.6; }

  update(dt, time) {
    for (const ring of this.rings) {
      if (ring.hit) {
        ring.t += dt;
        ring.mesh.scale.setScalar(1 + ring.t * 2.5);
        ring.mat.opacity = Math.max(0, 0.95 - ring.t * 2.4);
        ring.mesh.visible = ring.mat.opacity > 0;
      } else {
        ring.mesh.scale.setScalar(1 + Math.sin(time * 3 + ring.p.x) * 0.04);
      }
    }
    for (const pad of this.pads) {
      pad.cool = Math.max(0, pad.cool - dt);
      pad.squash = Math.max(0, pad.squash - dt * 3);
      const s = pad.squash * Math.cos(pad.squash * 14) * 0.35;
      pad.mesh.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
    }
  }
}

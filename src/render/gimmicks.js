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

/** The painted face of the fishing sign: planks, a fat blue fish leaping a wave, and a float. */
function signTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 144;
  const x = c.getContext('2d');
  x.fillStyle = '#f3e2bf';
  x.fillRect(0, 0, 256, 144);
  x.strokeStyle = 'rgba(122, 86, 50, 0.35)';
  x.lineWidth = 2;
  for (const py of [48, 96]) { x.beginPath(); x.moveTo(0, py); x.lineTo(256, py); x.stroke(); }
  x.strokeStyle = '#7a5632';
  x.lineWidth = 8;
  x.strokeRect(4, 4, 248, 136);
  // Waves
  x.strokeStyle = '#5fb6d6';
  x.lineWidth = 5;
  x.lineCap = 'round';
  x.beginPath();
  for (let i = 0; i <= 8; i++) x.lineTo(30 + i * 24, 112 + (i % 2 ? -7 : 7));
  x.stroke();
  // The fish, leaping
  x.save();
  x.translate(118, 62);
  x.rotate(-0.18);
  x.fillStyle = '#2f8fae';
  x.beginPath(); x.ellipse(0, 0, 54, 26, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.moveTo(-46, 0); x.lineTo(-84, -24); x.quadraticCurveTo(-72, 0, -84, 24); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(-12, -22); x.quadraticCurveTo(4, -44, 22, -22); x.fill();
  x.fillStyle = '#bfe6f2';
  x.beginPath(); x.ellipse(4, 9, 38, 10, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#ffffff';
  x.beginPath(); x.arc(32, -6, 8, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1b2a33';
  x.beginPath(); x.arc(34, -6, 4.5, 0, Math.PI * 2); x.fill();
  x.restore();
  // The float
  x.fillStyle = '#ff4d4d';
  x.beginPath(); x.arc(212, 40, 15, Math.PI, 0); x.fill();
  x.fillStyle = '#ffffff';
  x.beginPath(); x.arc(212, 40, 15, 0, Math.PI); x.fill();
  x.strokeStyle = '#3a2a22'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(212, 25); x.lineTo(212, 8); x.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

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
      this.group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); }
      });
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
    const lam = (color, o) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });
    const wood = lam(0x7a5632), dark = lam(0x5e3e26);
    const part = (geo, mat, px, py, pz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      sign.add(m);
      return m;
    };
    // Two posts, a painted board between them, and a little roof over it
    for (const side of [-1, 1]) part(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), wood, side * 0.72, 1.3, 0);
    const board = part(new THREE.BoxGeometry(1.7, 0.95, 0.08), [wood, wood, wood, wood, lam(0xffffff, { map: signTexture() }), wood], 0, 1.95, 0.06);
    board.material[4].flatShading = false;
    for (const side of [-1, 1]) {
      const roof = part(new THREE.BoxGeometry(1.05, 0.06, 0.5), lam(0xc8553a), side * 0.47, 2.66, 0.05);
      roof.rotation.z = -side * 0.42;
    }
    part(new THREE.BoxGeometry(0.1, 0.1, 0.52), dark, 0, 2.86, 0.05);
    // A rod leaning on the post, its line hanging down to a float
    const rod = part(new THREE.CylinderGeometry(0.015, 0.03, 2.6, 5), lam(0x2f3a48), 1.05, 1.22, 0.25);
    rod.rotation.z = -0.32;
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), lam(0xc0c4c8), 0.93, 0.62, 0.25).rotation.z = Math.PI / 2 - 0.32; // reel
    const tipX = 1.05 + Math.sin(0.32) * 1.3, tipY = 1.22 + Math.cos(0.32) * 1.3;
    part(new THREE.CylinderGeometry(0.004, 0.004, tipY - 0.55, 3), lam(0xf4ead8), tipX, (tipY + 0.55) / 2, 0.25);
    const float = new THREE.Group();
    float.position.set(tipX, 0.48, 0.25);
    float.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xff4d4d)));
    float.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lam(0xfff8ec)));
    sign.add(float);
    // And a bucket for the catch
    const pail = part(new THREE.CylinderGeometry(0.2, 0.16, 0.3, 10, 1, true), lam(0x8fb6c8, { side: THREE.DoubleSide }), -1.0, 0.15, 0.35);
    pail.add(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 4, 12, Math.PI), lam(0x5a6670)));
    pail.children[0].position.y = 0.15;
    part(new THREE.CircleGeometry(0.17, 10).rotateX(-Math.PI / 2), lam(0x3c7fa8), -1.0, 0.22, 0.35);
    this.group.add(sign);
  }

  buildBullseye(world, toy) {
    this.target = { x: toy.x, z: toy.z };
    const y = world.heightAt(toy.x, toy.z);
    // Draped over the turf: each band is a strip of quads following the ground
    const drape = (r0, r1, color, lift, opacity = 0.92) => {
      const seg = 48, pos = [], idx = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        for (const rr of [r0, r1]) {
          const x = toy.x + Math.cos(a) * rr, z = toy.z + Math.sin(a) * rr;
          pos.push(x, world.heightAt(x, z) + lift, z);
        }
        if (k < seg) { const b = k * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      mesh.renderOrder = 1;
      this.group.add(mesh);
    };
    // Gold in the middle, then red, then cream, each band edged in white
    const bands = [0xffc83a, 0xff5a4a, 0xfff4dc];
    let inner = 0;
    BULL.forEach((r, i) => {
      drape(inner + (i ? 0.18 : 0), r - 0.18, bands[i], 0.09);
      drape(r - 0.18, r, i === 2 ? 0xff5a4a : 0xffffff, 0.095, 0.95);
      inner = r;
    });
    // A pillar of light so it can be found from the tee
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 9, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a4a, transparent: true, opacity: 0.32, depthWrite: false, fog: false }));
    beam.position.set(toy.x, y + 4.5, toy.z);
    this.group.add(beam);
  }

  buildPads(world, toy) {
    // Fat spotted toadstools with a skirt and two babies at the foot.
    // The cap top stays where it always was (pad.top): only the look has changed.
    const lam = (color, o) => new THREE.MeshLambertMaterial({ color, ...o });
    const cream = lam(0xfff4e0), gills = lam(0xf0d7b4), red = lam(0xe8432e);
    const spotMat = lam(0xfffbf2, { emissive: 0x6a6660 });
    const spotGeo = new THREE.IcosahedronGeometry(1, 1);
    for (const p of toy.pads) {
      const g = new THREE.Group();
      const y = world.heightAt(p.x, p.z);
      g.position.set(p.x, y, p.z);
      g.rotation.y = Math.atan2(world.tee.x - p.x, world.tee.z - p.z);
      const r = p.r;
      // A plump stem, wider at the foot, with a skirt just under the cap
      const stemPts = [[0.44, 0], [0.42, 0.08], [0.37, 0.3], [0.35, 0.65], [0.31, 1.0], [0.27, 1.22]];
      const stem = new THREE.Mesh(new THREE.LatheGeometry(stemPts.map(([sr, sy]) => new THREE.Vector2(sr * r, sy)), 14), cream);
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.31, r * 0.42, 0.14, 14, 1, true), lam(0xfff4e0, { side: THREE.DoubleSide }));
      skirt.position.y = 0.98;
      // Cap: a dome that turns under at the rim, gills beneath (top = 1.2 + 0.62 r)
      const capPts = [[0.92, -0.06], [0.99, -0.02], [1.0, 0.07], [0.88, 0.28], [0.66, 0.47], [0.36, 0.59], [0, 0.62]];
      const cap = new THREE.Mesh(new THREE.LatheGeometry(capPts.map(([cr, cy]) => new THREE.Vector2(cr * r, cy * r)), 18), red);
      cap.position.y = 1.2;
      const under = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.3 * r, 0.02 * r), new THREE.Vector2(0.93 * r, -0.055 * r)], 18), gills);
      under.position.y = 1.2;
      g.add(stem, skirt, cap, under);
      // Spots sit on the cap, flattened against it
      const spots = [[0, 0, 0.2], [0.55, 0.3, 0.17], [0.55, 2.4, 0.15], [0.6, 4.4, 0.16], [0.82, 1.3, 0.13], [0.84, 3.4, 0.12], [0.86, 5.4, 0.13]];
      for (const [t, a, size] of spots) {
        // t: 0 at the crown .. 1 at the rim (along the ellipse)
        const th = t * Math.PI / 2;
        const nx = Math.sin(th) / r, ny = Math.cos(th) / (0.62 * r);
        const n = new THREE.Vector3(nx * Math.cos(a), ny, nx * Math.sin(a)).normalize();
        const dot = new THREE.Mesh(spotGeo, spotMat);
        dot.position.set(Math.sin(th) * r * Math.cos(a), 1.2 + Math.cos(th) * 0.62 * r, Math.sin(th) * r * Math.sin(a));
        dot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        dot.scale.set(size * r * 0.8, size * r * 0.16, size * r * 0.8);
        g.add(dot);
      }
      // Two babies at its foot
      for (const [bx, bz, s] of [[0.62, 0.3, 0.32], [-0.5, 0.55, 0.24]]) {
        const baby = new THREE.Group();
        baby.position.set(bx * r, 0, bz * r);
        const bs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 8), cream);
        bs.position.y = 0.25;
        const bc = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red);
        bc.position.y = 0.45;
        bc.scale.y = 0.75;
        baby.add(bs, bc);
        baby.scale.setScalar(s * 2.4);
        g.add(baby);
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
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.95, fog: false });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.2, 8, 32), mat);
      // A bright inner lip and eight little lamps round the hoop
      const trim = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.95, fog: false });
      mesh.add(new THREE.Mesh(new THREE.TorusGeometry(RING_R - 0.2, 0.07, 4, 32), trim));
      const bulb = new THREE.SphereGeometry(0.17, 6, 4);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const lamp = new THREE.Mesh(bulb, k % 2 ? trim : mat);
        lamp.position.set(Math.cos(a) * (RING_R + 0.18), Math.sin(a) * (RING_R + 0.18), 0);
        mesh.add(lamp);
      }
      mesh.position.copy(p);
      mesh.lookAt(p.clone().add(dir));
      this.group.add(mesh);
      this.rings.push({ p, mesh, mat, trim, hit: false, t: 0 });
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
        ring.mat.opacity = ring.trim.opacity = Math.max(0, 0.95 - ring.t * 2.4);
        ring.mesh.visible = ring.mat.opacity > 0;
      } else {
        ring.mesh.scale.setScalar(1 + Math.sin(time * 3 + ring.p.x) * 0.04);
      }
    }
    for (const pad of this.pads) {
      pad.cool = Math.max(0, pad.cool - dt);
      pad.squash = Math.max(0, pad.squash - dt * 3);
      // A boing squashes and wobbles back; at rest it breathes, ever so slightly
      const s = pad.squash * Math.cos(pad.squash * 14) * 0.35 + Math.sin(time * 2.2 + pad.x) * 0.012;
      pad.mesh.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
    }
  }
}

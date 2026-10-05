/**
 * Yakizakana — the fish you hooked instead of your ball, grilled by the green.
 *
 * A campfire, a fish on a skewer, and one job: turn it. Each flank cooks while
 * it faces the flames, the fire flares up now and then, and you take it off
 * when you think it is done. Both flanks golden is perfect; either one black
 * is burnt and nobody eats it.
 *
 * This file owns the 3D props and the cooking model; ui/cookHud.js draws the
 * two doneness bars and the EAT button.
 */

import * as THREE from 'three';

// Doneness of a flank, 0 = raw. The bars in the HUD use the same numbers.
export const COOK = {
  DONE: 0.7,        // below this it is still raw
  PERFECT_LO: 0.85,
  PERFECT_HI: 1.05,
  BURNT: 1.2,       // at or above: black
  MAX: 1.35,        // top of the bar
};

const RAW = new THREE.Color(0xaebfc9);
const GOLD = new THREE.Color(0xe0a04a);
const DEEP = new THREE.Color(0xb5651d);
const BLACK = new THREE.Color(0x17110d);

function flankColor(out, d) {
  if (d < COOK.DONE) return out.copy(RAW).lerp(GOLD, (d / COOK.DONE) ** 1.5);
  if (d < COOK.PERFECT_HI) return out.copy(GOLD).lerp(DEEP, (d - COOK.DONE) / (COOK.PERFECT_HI - COOK.DONE));
  return out.copy(DEEP).lerp(BLACK, Math.min(1, (d - COOK.PERFECT_HI) / (COOK.BURNT - COOK.PERFECT_HI)));
}

/** How a fish came off the fire. */
export function gradeFish(a, b) {
  if (a >= COOK.BURNT || b >= COOK.BURNT) return 'burnt';
  if (a < COOK.DONE || b < COOK.DONE) return 'raw';
  const perfect = (d) => d >= COOK.PERFECT_LO && d <= COOK.PERFECT_HI;
  return perfect(a) && perfect(b) ? 'perfect' : 'cooked';
}

export class Grill {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.active = false;
    this.build();
  }

  build() {
    const g = this.group;
    const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    // Stone ring and logs
    const stone = lambert(0x8d8f93);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11 + (i % 3) * 0.015), stone);
      rock.position.set(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42);
      rock.rotation.set(i, i * 2, i * 3);
      g.add(rock);
    }
    const wood = lambert(0x5a3a22);
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.62, 6), wood);
      log.rotation.set(Math.PI / 2 - 0.18, (i / 3) * Math.PI, 0, 'YXZ');
      log.position.y = 0.09;
      g.add(log);
    }

    // Flames: three nested cones that flicker
    this.flames = [];
    for (const [color, r, h] of [[0xff5a1e, 0.24, 0.55], [0xffa62b, 0.17, 0.42], [0xffe27a, 0.1, 0.28]]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }));
      flame.userData.h = h;
      g.add(flame);
      this.flames.push(flame);
    }
    this.light = new THREE.PointLight(0xff9a3c, 0, 9, 1.6);
    this.light.position.y = 0.6;
    g.add(this.light);

    // Two forked sticks and the skewer between them
    const stick = lambert(0x7a5632);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.95, 5), stick);
      post.position.set(side * 0.68, 0.47, 0);
      g.add(post);
      (this.rack ||= []).push(post);
    }
    // The spit: everything on it turns about its long (x) axis
    this.spit = new THREE.Group();
    this.spit.position.y = 0.92;
    g.add(this.spit);
    this.rack.push(this.spit);
    const skewer = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.5, 5), lambert(0xd8c9a8));
    skewer.rotation.z = Math.PI / 2;
    this.spit.add(skewer);

    // The fish: two flanks that brown separately, a tail, an eye each side
    this.flankMat = [lambert(0xaebfc9), lambert(0xaebfc9)];
    for (const [i, turn] of [[0, 0], [1, Math.PI]]) {
      const half = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI), this.flankMat[i]);
      half.scale.set(0.42, 0.16, 0.08);
      half.rotation.y = turn;
      this.spit.add(half);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 5), new THREE.MeshBasicMaterial({ color: 0x12261a }));
      eye.position.set(0.28, 0.04, i ? -0.058 : 0.058);
      this.spit.add(eye);
    }
    this.tailMat = lambert(0xaebfc9);
    this.tailMat.side = THREE.DoubleSide;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.26, 3), this.tailMat);
    tail.scale.z = 0.25;
    tail.rotation.z = -Math.PI / 2;
    tail.position.x = -0.5;
    this.spit.add(tail);

    // Smoke puffs for a burnt fish
    this.smoke = [];
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.6 });
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), smokeMat);
      puff.visible = false;
      g.add(puff);
      this.smoke.push(puff);
    }
    this.tmp = new THREE.Color();
  }

  /**
   * Find a spot beside the green for the fire: dry, off the putting surface,
   * and not in a tree.
   */
  static place(world, placed = []) {
    const { cup, tee } = world;
    const away = Math.atan2(cup.z - tee.z, cup.x - tee.x);
    let best = null;
    for (const r of [9, 12, 15, 7, 18]) {
      for (const off of [1.2, -1.2, 0.6, -0.6, 2.2, -2.2, 0, 3.14]) {
        const x = cup.x + Math.cos(away + off) * r, z = cup.z + Math.sin(away + off) * r;
        const surface = world.surfaceAt(x, z);
        if (surface === 'water' || surface === 'green' || surface === 'bunker') continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r || 1) + 2.5)) continue;
        const slope = Math.abs(world.heightAt(x + 1, z) - world.heightAt(x - 1, z)) + Math.abs(world.heightAt(x, z + 1) - world.heightAt(x, z - 1));
        if (!best || slope < best.slope) best = { x, z, slope };
        if (slope < 0.12) return { x, z };
      }
    }
    return best || { x: cup.x + 8, z: cup.z };
  }

  /**
   * @param {object} o
   * @param {number} o.x, o.y, o.z  where the fire sits
   * @param {number} o.facing       yaw so the skewer lies across the camera's view
   * @param {number} o.level        0..1: hotter fire, more flare-ups
   */
  start({ x, y, z, facing = 0, level = 0, rng = Math.random, fish = true }) {
    // fish: false is just a campfire to sit by — no spit, nothing cooking
    this.cooking = fish;
    for (const part of this.rack) part.visible = fish;
    this.group.position.set(x, y, z);
    this.group.rotation.y = facing;
    this.group.visible = true;
    this.active = true;
    this.rng = rng;
    this.t = 0;
    this.angle = Math.PI / 2; // flank 0 starts over the flames
    this.spin = 0;
    this.done = [0, 0];
    this.rate = 0.2 * (1 + 0.35 * level);
    this.flare = 0;                         // 0..1, eased
    this.flareLeft = 0;
    this.nextFlare = 2.2 + rng() * 1.5;
    this.flareEvery = 3.4 - 1.2 * level;
    this.result = null;
    this.smoke.forEach((p) => { p.visible = false; });
    this.paint();
  }

  stop() {
    this.active = false;
    this.group.visible = false;
    this.light.intensity = 0;
  }

  /** Turn the spit. dx: finger travel as a fraction of the screen width. */
  turn(dx) {
    if (!this.active || this.result) return;
    this.angle += dx * 7.5;
    this.spin += Math.abs(dx);
  }

  /** Which flank is over the flames right now, and how squarely (0..1). */
  exposure(i) {
    const s = Math.sin(this.angle);
    return Math.max(0, i === 0 ? s : -s);
  }

  /** Take it off the fire. Returns the grade. */
  take() {
    if (!this.active || this.result) return this.result;
    this.result = gradeFish(this.done[0], this.done[1]);
    return this.result;
  }

  /** @returns {string|null} 'burnt' the moment a flank goes black, else null */
  update(dt) {
    if (!this.active) return null;
    this.t += dt;
    let burnt = null;
    if (!this.cooking) {
      this.flare += (0 - this.flare) * Math.min(1, dt * 4);
    } else if (!this.result) {
      // Flare-ups: the fire roars for a second and cooks much faster
      this.nextFlare -= dt;
      if (this.nextFlare <= 0) { this.flareLeft = 1.1; this.nextFlare = this.flareEvery + this.rng() * 1.6; }
      this.flareLeft = Math.max(0, this.flareLeft - dt);
      const want = this.flareLeft > 0 ? 1 : 0;
      this.flare += (want - this.flare) * Math.min(1, dt * 7);
      const heat = this.rate * (1 + 1.6 * this.flare);
      for (const i of [0, 1]) {
        this.done[i] = Math.min(COOK.MAX, this.done[i] + heat * (0.04 + 0.96 * this.exposure(i)) * dt);
      }
      if (this.done[0] >= COOK.BURNT || this.done[1] >= COOK.BURNT) {
        this.result = 'burnt';
        burnt = 'burnt';
      }
    } else {
      this.flare += (0 - this.flare) * Math.min(1, dt * 4);
    }
    this.paint();
    return burnt;
  }

  paint() {
    const { t } = this;
    this.spit.rotation.x = this.angle;
    // A little of its own light, so the colour still reads on a night hole
    for (const mat of [...this.flankMat, this.tailMat]) {
      const d = mat === this.tailMat ? (this.done[0] + this.done[1]) / 2 : this.done[this.flankMat.indexOf(mat)];
      flankColor(mat.color, d);
      mat.emissive.copy(mat.color).multiplyScalar(0.4);
    }
    this.flames.forEach((flame, i) => {
      const flick = 1 + Math.sin(t * (11 + i * 4) + i) * 0.12 + Math.sin(t * (23 + i * 7)) * 0.06;
      const tall = flick * (1 + this.flare * 0.9);
      flame.scale.set(1 + this.flare * 0.25, tall, 1 + this.flare * 0.25);
      flame.position.set(Math.sin(t * 5 + i * 2) * 0.02, 0.1 + (flame.userData.h * tall) / 2, Math.cos(t * 4 + i) * 0.02);
      flame.rotation.y = t * (1 + i);
    });
    this.light.intensity = 1.4 + this.flare * 1.6 + Math.sin(t * 17) * 0.15;
    const smoking = this.result === 'burnt';
    this.smoke.forEach((puff, i) => {
      puff.visible = smoking;
      if (!smoking) return;
      const f = ((t * 0.7 + i / this.smoke.length) % 1);
      puff.position.set(Math.sin(i * 2.4 + t) * 0.12, 1.0 + f * 1.3, Math.cos(i * 1.7) * 0.08);
      puff.scale.setScalar(0.8 + f * 1.8);
    });
  }
}

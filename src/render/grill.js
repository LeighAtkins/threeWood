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
    const lambert = (color, o) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });

    // ---- The hearth: a ring of river stones, a bed of embers, crossed logs ------------
    const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
    const stones = [lambert(0x9a958c), lambert(0x80868a), lambert(0xb0a898)];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.08;
      const rock = new THREE.Mesh(stoneGeo, stones[i % 3]);
      const s = 0.1 + ((i * 7) % 4) * 0.012;
      rock.scale.set(s * 1.2, s * 0.72, s);
      rock.position.set(Math.cos(a) * 0.43, s * 0.42, Math.sin(a) * 0.43);
      rock.rotation.set(i * 0.7, a, i * 1.3);
      g.add(rock);
    }
    const ash = new THREE.Mesh(new THREE.CircleGeometry(0.34, 9).rotateX(-Math.PI / 2), lambert(0x2e2420));
    ash.position.y = 0.012;
    g.add(ash);
    // Embers glow on their own, and breathe (paint)
    this.emberMat = new THREE.MeshBasicMaterial({ color: 0xff6a1e });
    const emberGeo = new THREE.IcosahedronGeometry(0.035, 0);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = 0.08 + (i % 3) * 0.07;
      const ember = new THREE.Mesh(emberGeo, this.emberMat);
      ember.position.set(Math.cos(a) * r, 0.025, Math.sin(a) * r);
      ember.scale.set(1 + (i % 2) * 0.5, 0.6, 1);
      ember.rotation.y = a;
      g.add(ember);
    }
    // Logs show bark on the side and pale cut wood on the ends; their feet are charred
    const bark = lambert(0x6a4428), cut = lambert(0xe2c08a), charred = lambert(0x2a1a14);
    const logMats = [bark, cut, charred];
    for (let i = 0; i < 2; i++) {
      // Two lying crossed under the fire
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.66, 7), logMats);
      log.rotation.set(0, i ? 0.6 : -0.6, Math.PI / 2, 'YXZ');
      log.position.y = 0.055 + i * 0.05;
      g.add(log);
    }
    for (let i = 0; i < 5; i++) {
      // And a little teepee of sticks leaning in over the embers
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.034, 0.44, 6), [bark, charred, cut]);
      stick.position.set(Math.cos(a) * 0.12, 0.19, Math.sin(a) * 0.12);
      // Tip it about its tangent so the top leans in over the middle
      stick.quaternion.setFromAxisAngle(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 0.5);
      g.add(stick);
    }

    // ---- Flames: teardrops that lick and curl; three nested plus two little tongues ----
    const flameGeo = (r, h, curl) => {
      const pts = [[0, 0], [0.55, 0.08], [0.92, 0.26], [0.95, 0.42], [0.72, 0.62], [0.42, 0.8], [0.16, 0.93], [0, 1]]
        .map(([x, y]) => new THREE.Vector2(x * r, y * h));
      const geo = new THREE.LatheGeometry(pts, 7);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k) / h;
        pos.setX(k, pos.getX(k) + curl * y * y * h);
      }
      geo.computeVertexNormals();
      return geo;
    };
    this.flames = [];
    const flame = (color, r, h, ox, oz, opts) => {
      const mesh = new THREE.Mesh(flameGeo(r, h, 0.22), new THREE.MeshBasicMaterial({ color, ...opts }));
      mesh.userData = { h, ox, oz };
      mesh.position.set(ox, 0.06, oz);
      g.add(mesh);
      this.flames.push(mesh);
      return mesh;
    };
    flame(0xff5a1e, 0.22, 0.6, 0, 0, { transparent: true, opacity: 0.82, depthWrite: false }).renderOrder = 2;
    flame(0xffa62b, 0.16, 0.46, 0.01, 0, { transparent: true, opacity: 0.95, depthWrite: false }).renderOrder = 3;
    flame(0xffe27a, 0.09, 0.3, 0.015, 0, {});
    flame(0xff7a24, 0.08, 0.3, 0.13, 0.06, { transparent: true, opacity: 0.9, depthWrite: false }).renderOrder = 2;
    flame(0xff7a24, 0.07, 0.26, -0.12, -0.07, { transparent: true, opacity: 0.9, depthWrite: false }).renderOrder = 2;
    this.light = new THREE.PointLight(0xff9a3c, 0, 9, 1.6);
    this.light.position.y = 0.6;
    g.add(this.light);

    // ---- Two forked sticks and the skewer resting in their crooks ----------------------
    const stickMat = lambert(0x7a5632);
    this.rack = [];
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.86, 5).translate(0, 0.43, 0), stickMat);
      post.position.set(side * 0.68, 0, 0);
      post.rotation.z = side * 0.04;
      for (const fork of [-1, 1]) {
        const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.017, 0.17, 4).translate(0, 0.085, 0), stickMat);
        prong.position.y = 0.84;
        prong.rotation.x = fork * 0.55;
        post.add(prong);
      }
      g.add(post);
      this.rack.push(post);
    }
    // The spit: everything on it turns about its long (x) axis
    this.spit = new THREE.Group();
    this.spit.position.y = 0.92;
    g.add(this.spit);
    this.rack.push(this.spit);
    const bamboo = lambert(0xe0cc96);
    const skewer = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.5, 6), bamboo);
    skewer.rotation.z = Math.PI / 2;
    skewer.position.x = 0.04;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.07, 6), bamboo);
    tip.rotation.z = Math.PI / 2;
    tip.position.x = -0.745;
    this.spit.add(skewer, tip);

    // ---- The fish ------------------------------------------------------------------------
    // A lathe body along x (head +x), flattened sideways, split down the middle so the
    // two flanks brown separately: flank 0 is the +z side, flank 1 the -z side.
    // Darker back, paler belly; the cook colour multiplies over that.
    const PROFILE = [[-0.37, 0], [-0.35, 0.03], [-0.28, 0.05], [-0.16, 0.1], [-0.02, 0.145], [0.1, 0.155], [0.2, 0.145], [0.29, 0.115], [0.36, 0.075], [0.405, 0.035], [0.42, 0]];
    const radius = (x) => {
      for (let k = 1; k < PROFILE.length; k++) {
        const [x1, r1] = PROFILE[k];
        if (x <= x1) { const [x0, r0] = PROFILE[k - 1]; return r0 + (r1 - r0) * (x - x0) / (x1 - x0); }
      }
      return 0;
    };
    const FLAT = 0.52; // how much thinner it is side to side than top to bottom
    const halfBody = (phiStart) => {
      // Lathe spins about y: build it head-up, then lie it down head +x
      const geo = new THREE.LatheGeometry(PROFILE.map(([x, r]) => new THREE.Vector2(r, x)), 7, phiStart, Math.PI);
      geo.rotateZ(-Math.PI / 2);
      geo.scale(1, 1, FLAT);
      const pos = geo.attributes.position, col = [];
      for (let k = 0; k < pos.count; k++) {
        // 1 along the back .. 0 along the belly
        const up = (Math.max(-1, Math.min(1, pos.getY(k) / (radius(pos.getX(k)) || 1))) + 1) / 2;
        const v = 1 - 0.3 * up * up;
        col.push(v * 0.98, v, v);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      return geo;
    };
    this.flankMat = [0, 1].map(() => new THREE.MeshLambertMaterial({ color: 0xaebfc9, vertexColors: true }));
    // Laid along x, the lathe's own z stays z: phi -90..90 deg is the +z flank
    this.spit.add(new THREE.Mesh(halfBody(-Math.PI / 2), this.flankMat[0]), new THREE.Mesh(halfBody(Math.PI / 2), this.flankMat[1]));

    // Fins and tail take the average of both flanks (paint)
    this.tailMat = lambert(0xaebfc9, { side: THREE.DoubleSide });
    const fin = (shape, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.tailMat);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      this.spit.add(mesh);
      return mesh;
    };
    const tail = new THREE.Shape();
    tail.moveTo(0.02, 0.03); tail.lineTo(-0.15, 0.15); tail.quadraticCurveTo(-0.1, 0.0, -0.15, -0.15); tail.lineTo(0.02, -0.03); tail.closePath();
    fin(tail, -0.35, 0, 0);
    const dorsal = new THREE.Shape();
    dorsal.moveTo(0.1, -0.02); dorsal.quadraticCurveTo(0.04, 0.065, -0.1, 0.06); dorsal.lineTo(-0.2, -0.03); dorsal.closePath();
    fin(dorsal, 0, radius(0) - 0.012, 0);
    const anal = new THREE.Shape();
    anal.moveTo(0.04, 0.02); anal.lineTo(-0.08, -0.05); anal.lineTo(-0.12, 0.02); anal.closePath();
    fin(anal, -0.12, -radius(-0.12) + 0.01, 0);
    const pec = new THREE.Shape();
    pec.moveTo(0, 0); pec.quadraticCurveTo(-0.03, 0.035, -0.09, 0.015); pec.quadraticCurveTo(-0.05, -0.02, 0, 0);
    for (const side of [-1, 1]) {
      const p = fin(pec, 0.2, -0.04, side * (radius(0.2) * FLAT + 0.004));
      p.rotation.y = side * 0.35;
    }
    // Eyes and a gill line on each side; they do not cook
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xf4efe2 });
    const eyeDark = new THREE.MeshBasicMaterial({ color: 0x14181c });
    const gillMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
    const eyeGeo = new THREE.SphereGeometry(1, 10, 8);
    for (const side of [-1, 1]) {
      const ez = side * (radius(0.31) * FLAT * 0.92);
      const white = new THREE.Mesh(eyeGeo, eyeWhite);
      white.scale.set(0.03, 0.03, 0.012);
      white.position.set(0.31, 0.03, ez);
      const pupil = new THREE.Mesh(eyeGeo, eyeDark);
      pupil.scale.set(0.017, 0.019, 0.01);
      pupil.position.set(0.314, 0.03, ez + side * 0.006);
      const gill = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.006, 3, 10, Math.PI * 0.55), gillMat);
      gill.rotation.z = -Math.PI * 0.27;
      gill.position.set(0.14, 0, side * (radius(0.24) * FLAT * 0.92));
      gill.scale.set(1, 1, 0.3);
      this.spit.add(white, pupil, gill);
    }

    // Smoke puffs for a burnt fish
    this.smoke = [];
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x3a3634, transparent: true, opacity: 0.55, depthWrite: false });
    const puffGeo = new THREE.IcosahedronGeometry(0.09, 1);
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(puffGeo, smokeMat);
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
    for (let i = 0; i < 3; i++) {
      const mat = i < 2 ? this.flankMat[i] : this.tailMat;
      flankColor(mat.color, i < 2 ? this.done[i] : (this.done[0] + this.done[1]) / 2);
      mat.emissive.copy(mat.color).multiplyScalar(0.4);
    }
    for (let i = 0; i < this.flames.length; i++) {
      const flame = this.flames[i], u = flame.userData;
      const flick = 1 + Math.sin(t * (11 + i * 4) + i) * 0.12 + Math.sin(t * (23 + i * 7)) * 0.06;
      const tall = flick * (1 + this.flare * 0.9);
      const wide = 1 + this.flare * 0.25 - (flick - 1) * 0.4;
      flame.scale.set(wide, tall, wide);
      flame.position.set(u.ox + Math.sin(t * 5 + i * 2) * 0.015, 0.05, u.oz + Math.cos(t * 4 + i) * 0.015);
      // The tips curl, and the curl wanders round
      flame.rotation.y = t * (0.9 + i * 0.35) + i * 2.1;
    }
    // The embers breathe
    const glow = 0.5 + 0.5 * Math.sin(t * 2.3);
    this.emberMat.color.setRGB(1, 0.24 + 0.2 * glow + this.flare * 0.2, 0.04 + 0.08 * glow, THREE.SRGBColorSpace);
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

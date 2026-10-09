/**
 * Kuri — a chestnut shiba who adopts you on the second hole.
 *
 * She is found asleep by a tee; a tap wakes her and from then on she comes
 * along on every round: sits by your ball while you line up, races after the
 * shot, waits wagging where it lands, runs rings round the cup, sniffs out
 * mushrooms, begs at the grill and curls up by the campfire. Tap her any time
 * for a pat.
 *
 * Nothing she does changes a score. She is there to make the dead time
 * between shots — the walk, the wait for a friend — feel like company.
 *
 * This file is the model (cel shaded like the campers, faces +z, about 0.55
 * model units tall) and the brain, which reads the game's state each frame.
 */

import * as THREE from 'three';
import { glyph } from '../ui/glyphs.js';

let ramp = null;
function toon(color) {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp });
}

const COAT = 0xd8873a, CREAM = 0xfff0d4, DARK = 0x2a1d17, COLLAR = 0xd2463c;
export const DOG_NAME = 'Kuri';
const SCALE = 1.75;

/** The model and its procedural poses. */
export class DogModel {
  constructor() {
    this.group = new THREE.Group();
    this.t = Math.random() * 10;
    this.p = { sit: 0, lie: 0, run: 0, hop: 0, sniff: 0, beg: 0, sad: 0, wag: 1, pant: 0 };
    this.want = { ...this.p };
    this.build();
  }

  build() {
    const coat = toon(COAT), cream = toon(CREAM), dark = new THREE.MeshBasicMaterial({ color: DARK });
    this.mats = [coat, cream];
    const sph = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
    const mesh = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz);
      m.castShadow = true;
      return m;
    };

    // The body pivots at the back hips, so sitting is one rotation
    this.body = new THREE.Group();
    this.body.position.set(0, 0.27, -0.13);
    this.group.add(this.body);
    this.body.add(mesh(sph(1), coat, 0, 0.03, 0.13, 0.15, 0.14, 0.26));
    this.body.add(mesh(sph(1), cream, 0, -0.01, 0.27, 0.115, 0.12, 0.1));   // chest
    this.body.add(mesh(sph(1), cream, 0, -0.06, 0.12, 0.11, 0.07, 0.2));    // belly

    // Head on a neck pivot
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.12, 0.33);
    this.body.add(this.neck);
    const head = new THREE.Group();
    head.position.set(0, 0.08, 0.04);
    this.neck.add(head);
    this.head = head;
    head.add(mesh(sph(1, 14, 10), coat, 0, 0, 0, 0.135, 0.125, 0.13));
    head.add(mesh(sph(1), cream, 0, -0.045, 0.085, 0.085, 0.06, 0.085));   // muzzle
    for (const s of [-1, 1]) {
      head.add(mesh(sph(1), cream, s * 0.075, -0.035, 0.05, 0.06, 0.05, 0.05)); // cheeks
      head.add(mesh(sph(1), cream, s * 0.045, 0.06, 0.1, 0.022, 0.014, 0.012)); // brows
      const eye = mesh(sph(0.021, 8, 6), dark, s * 0.05, 0.022, 0.112);
      eye.scale.y = 1.15;
      head.add(eye);
      const glint = mesh(sph(0.007, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), s * 0.045 + 0.004, 0.032, 0.13);
      head.add(glint);
      // Ears: three-sided cones, cream inside
      const ear = new THREE.Group();
      ear.position.set(s * 0.072, 0.1, -0.01);
      ear.rotation.set(-0.15, 0, -s * 0.28);
      ear.add(mesh(new THREE.ConeGeometry(0.052, 0.1, 3), coat, 0, 0.04, 0));
      const inner = mesh(new THREE.ConeGeometry(0.03, 0.07, 3), cream, 0, 0.035, 0.016);
      ear.add(inner);
      head.add(ear);
      (this.ears ||= []).push(ear);
    }
    head.add(mesh(sph(0.022, 8, 6), dark, 0, -0.02, 0.17, 1.2, 0.85, 1)); // nose
    this.tongue = mesh(sph(1), new THREE.MeshBasicMaterial({ color: 0xf07a8a }), 0, -0.085, 0.13, 0.025, 0.012, 0.035);
    head.add(this.tongue);
    // Red collar with a little bell
    const collar = mesh(new THREE.TorusGeometry(0.085, 0.017, 6, 16), toon(COLLAR), 0, 0.02, 0.02);
    collar.rotation.x = Math.PI / 2 - 0.5;
    this.neck.add(collar);
    this.neck.add(mesh(sph(0.022, 8, 6), toon(0xf2c94c), 0, -0.04, 0.09));

    // Legs: pivots at the shoulders and hips, cream socks
    this.legs = [];
    const legGeo = new THREE.CylinderGeometry(0.03, 0.026, 0.2, 6);
    const sockGeo = new THREE.CylinderGeometry(0.029, 0.029, 0.07, 6);
    const pawGeo = sph(0.034, 8, 6);
    for (const [x, z, front] of [[-0.075, 0.27, 1], [0.075, 0.27, 1], [-0.08, 0.02, 0], [0.08, 0.02, 0]]) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.02, z);
      leg.add(mesh(legGeo, coat, 0, -0.1, 0));
      leg.add(mesh(sockGeo, cream, 0, -0.19, 0));
      leg.add(mesh(pawGeo, cream, 0, -0.235, 0.012, 1, 0.6, 1.25));
      leg.userData.front = front;
      this.body.add(leg);
      this.legs.push(leg);
    }

    // The curled tail: a fat ring sitting on the back
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.12, -0.08);
    this.body.add(this.tail);
    const curl = mesh(new THREE.TorusGeometry(0.06, 0.03, 6, 12, Math.PI * 1.6), coat, 0, 0.05, 0);
    curl.rotation.set(0, Math.PI / 2, 0.6);
    this.tail.add(curl);
    this.tail.add(mesh(sph(0.03, 8, 6), cream, 0, 0.1, 0.03));

    this.group.scale.setScalar(SCALE);
  }

  setGlow(night) {
    for (const m of this.mats) m.emissive.copy(m.color).multiplyScalar(night * 0.38);
  }

  /**
   * pose: stand | run | sit | lie | hop | sniff | beg | sad
   * speed: how fast she is moving (for the gait)
   */
  update(dt, pose, speed = 0) {
    this.t += dt;
    const w = this.want;
    for (const k of Object.keys(w)) w[k] = 0;
    w.wag = 1;
    if (pose === 'run') { w.run = 1; w.pant = 1; }
    else if (pose === 'sit') w.sit = 1;
    else if (pose === 'lie') { w.lie = 1; w.wag = 0.25; }
    else if (pose === 'hop') { w.hop = 1; w.pant = 1; w.wag = 2; }
    else if (pose === 'sniff') { w.sniff = 1; w.wag = 0.6; }
    else if (pose === 'beg') { w.sit = 1; w.beg = 1; w.pant = 1; w.wag = 1.6; }
    else if (pose === 'sad') { w.sit = 1; w.sad = 1; w.wag = 0; }
    const k = 1 - Math.exp(-dt * 9);
    for (const key of Object.keys(w)) this.p[key] += (w[key] - this.p[key]) * k;
    const p = this.p, t = this.t;

    // Gait: diagonal pairs, quicker with speed
    const stride = Math.sin(t * (10 + Math.min(10, speed))) * 0.8 * p.run;
    this.legs.forEach((leg, i) => {
      const pair = i === 0 || i === 3 ? 1 : -1;
      let rx = stride * pair;
      if (leg.userData.front) {
        rx += p.sit * 0.45 + p.lie * -1.35 - p.beg * 1.2 + Math.sin(t * 8) * 0.15 * p.beg;
      } else {
        rx += p.sit * -1.25 + p.lie * -1.45;
      }
      leg.rotation.x = rx;
    });
    // Body: rear down to sit, flat to lie, a bounce when running or hopping
    const hop = Math.abs(Math.sin(t * 7)) * 0.12 * p.hop;
    const bob = Math.abs(Math.sin(t * (10 + Math.min(10, speed)))) * 0.025 * p.run;
    this.body.rotation.x = -0.45 * p.sit - 0.15 * p.beg + 0.06 * p.sniff;
    this.body.position.y = 0.27 - 0.03 * p.sit - 0.165 * p.lie + hop + bob;
    this.body.position.z = -0.13 + 0.02 * p.lie;
    // Head: down to sniff, low when sad, a tilt now and then
    const tilt = Math.sin(t * 0.7) > 0.85 ? 0.3 : 0;
    this.neck.rotation.x = 0.45 * p.sit + 0.6 * p.sniff + 0.35 * p.sad - 0.1 * p.lie + Math.sin(t * 9) * 0.05 * p.sniff;
    this.head.rotation.z += ((tilt * (1 - p.run)) - this.head.rotation.z) * k * 0.5;
    this.head.rotation.x = -0.2 * p.lie;
    for (const [i, ear] of this.ears.entries()) ear.rotation.x = -0.15 - 0.55 * p.sad + 0.25 * p.run - Math.sin(t * 3 + i) * 0.04;
    this.tongue.visible = p.pant > 0.4;
    this.tongue.position.y = -0.085 - Math.sin(t * 12) * 0.006;
    this.tail.rotation.y = Math.sin(t * 16) * 0.55 * p.wag;
    this.tail.rotation.x = -0.5 * p.sad;
  }
}

/**
 * Her behaviour on the course. The game calls update() every frame; she
 * decides where to be from the game's state.
 */
export class Dog {
  constructor(game) {
    this.g = game;
    this.model = new DogModel();
    this.group = this.model.group;
    this.group.visible = false;
    game.scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.target = null;
    this.pose = 'sit';
    this.mood = null;     // { pose, t } — a reaction that overrides for a moment
    this.asleep = false;  // waiting on the tee to be found
    this.placed = false;
    this.fetching = null; // { item, phase: 'go' | 'back' }
    this.sniffAt = null;  // a mushroom she has found
    // A stick, for when there is a wait: she brings it, you throw it
    this.stick = { mesh: null, phase: 'none', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, throws: 0 };
    const stick = this.stick.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.85, 6), toon(0x8a5a32));
    stick.rotation.z = Math.PI / 2;
    stick.castShadow = true;
    stick.visible = false;
    game.scene.add(stick);
    this.stickMark = document.createElement('div');
    this.stickMark.className = 'forage-mark stick';
    this.stickMark.innerHTML = '<i></i>';
    game.hud.root.insertBefore(this.stickMark, game.hud.layer);
    this.idle = 0; // seconds of nothing happening at the ball
    this.tag = document.createElement('div');
    this.tag.className = 'dog-tag hidden';
    game.hud.root.insertBefore(this.tag, game.hud.layer);
    this._v = new THREE.Vector3();
  }

  get friend() { return !!this.g.camp.dog; }

  /** A new hole: she comes along, or (hole two, first time) is asleep by the tee. */
  atHole() {
    const { world, round } = this.g;
    this.fetching = null;
    this.sniffAt = null;
    this.mood = null;
    this.dropStick();
    this.anchor = null;
    this.roamAt = null;
    this.asleep = !this.friend && round && round.index >= 1;
    const { tee, cup } = world;
    const d = Math.hypot(cup.x - tee.x, cup.z - tee.z) || 1;
    const fx = (cup.x - tee.x) / d, fz = (cup.z - tee.z) / d;
    // Off to the left of the tee, in view of the first shot
    const x = tee.x + fx * 3.5 - fz * 2.6, z = tee.z + fz * 3.5 + fx * 2.6;
    this.pos.set(x, world.heightAt(x, z), z);
    this.group.rotation.y = Math.atan2(-fx, -fz) + 0.6;
    this.placed = this.friend || this.asleep;
    this.say(this.asleep ? 'z z z' : null);
  }

  /** Wake her (and she is yours). */
  befriend() {
    const g = this.g;
    this.asleep = false;
    g.camp.dog = true;
    g.saveCamp();
    this.react('hop', 1.6);
    this.say(null);
    g.audio.yip?.();
    setTimeout(() => g.audio.yip?.(), 260);
    g.hud.callout(`${DOG_NAME.toUpperCase()} WANTS TO COME ALONG`, 'gold small');
    this.hearts(5);
  }

  react(pose, t = 1.2) { this.mood = { pose, t }; }

  /** The game's events, as she sees them. */
  on(event) {
    if (!this.placed || this.asleep) return;
    if (event === 'pure' || event === 'birdie' || event === 'ring' || event === 'boing') { this.react('hop', 1.4); this.g.audio.yip?.(); }
    else if (event === 'splash') this.react('sad', 2.5);
    else if (event === 'fish') { this.react('hop', 2); this.g.audio.yip?.(); }
  }

  say(text) {
    this.sayText = text;
    this.tag.innerHTML = text ? `<span>${text}</span>${this.asleep ? glyph('tap') : ''}` : '';
    this.tag.classList.toggle('hidden', !text);
  }

  /** Little hearts over her head (DOM, so they read on any phone). */
  hearts(n = 3) {
    const v = this.screenPos();
    if (!v) return;
    for (let i = 0; i < n; i++) {
      const h = document.createElement('div');
      h.className = 'dog-heart';
      h.style.left = `${v.x + (Math.random() - 0.5) * 40}px`;
      h.style.top = `${v.y - 10}px`;
      h.style.animationDelay = `${i * 0.12}s`;
      h.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.6 1.3 4.3 2.6.7-1.3 2.1-2.6 4.3-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill="#ff7a9a" stroke="#12261a" stroke-width="1.6"/></svg>';
      this.g.hud.root.appendChild(h);
      setTimeout(() => h.remove(), 1600 + i * 120);
    }
  }

  /** Where her head is on screen, or null if off screen. */
  screenPos() {
    const v = this._v.set(this.pos.x, this.pos.y + 0.75, this.pos.z).project(this.g.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** A tap at screen (x, y): was it on her? Then pat her. */
  tapAt(x, y) {
    if (this.tapStick(x, y)) return true;
    if (!this.group.visible) return false;
    const s = this.screenPos();
    if (!s) return false;
    const dist = this.g.camera.position.distanceTo(this.pos);
    const r = Math.max(46, Math.min(120, 380 / Math.max(1, dist)));
    if (Math.hypot(s.x - x, s.y + 20 - y) > r) return false;
    if (this.asleep) { this.befriend(); return true; }
    if (this.stick.phase === 'tug') { this.stick.taps += 1; this.react('hop', 0.25); this.g.audio.tap(); return true; }
    this.react('hop', 1.1);
    this.hearts(3);
    this.g.audio.yip?.();
    this.g.earn('pets');
    return true;
  }

  /** Send her for a mushroom; done() when she drops it at your feet. */
  fetch(item, done) {
    if (!this.friend || !this.placed) { done(); return; }
    this.dropStick();
    this.fetching = { item, done, phase: 'go', t: 0 };
    this.sniffAt = null;
  }

  // ---- The stick -----------------------------------------------------------------
  //
  // When it is quiet she brings a stick and drops it at your feet. Flick it
  // (from the stick, the way you want it to go: a longer, quicker flick throws
  // further) or just tap it for a gentle lob. She runs for where it will land
  // and, if she gets there first, leaps and catches it: each catch in a row
  // counts, and the further the catch the better. Now and then she will not
  // let go: tap her to win the tug.

  /** Nothing happening at the ball for a while: she goes and finds a stick. */
  maybeStick(dt) {
    const g = this.g, st = this.stick;
    if (!this.friend || this.asleep || g.state !== 'aim' || this.fetching || this.sniffAt) { this.idle = 0; return; }
    if (st.phase !== 'none') return;
    this.idle += dt;
    // Waiting on a friend: sooner
    const waiting = g.net.active && g.net.status.get(g.net.myId) === 'ready';
    if (this.idle < (waiting ? 3 : 8)) return;
    this.idle = 0;
    const cg = g.camper.group, a = (g.aimAngle ?? 0) + Math.PI + (Math.random() - 0.5) * 1.6;
    st.x = cg.position.x + Math.cos(a) * 9;
    st.z = cg.position.z + Math.sin(a) * 9;
    // Dropped where the camera can see it: behind the ball, on her side of it
    const { ball } = g, ax = Math.cos(g.aimAngle ?? 0), az = Math.sin(g.aimAngle ?? 0);
    const back = g.putting ? 1.6 : 2.4;
    st.dropX = ball.x - ax * back - az * 0.9;
    st.dropZ = ball.z - az * back + ax * 0.9;
    st.phase = 'seek';
    st.t = 0;
  }

  dropStick() {
    const st = this.stick;
    st.phase = 'none';
    st.mesh.visible = false;
    this.stickMark.style.display = 'none';
    if (this.sayText && /TUG/.test(this.sayText)) this.say(null);
  }

  stickScreen() {
    const st = this.stick, g = this.g;
    const v = this._v.set(st.x, st.y + 0.2, st.z).project(g.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** A finger down on the stick (so the drag throws it rather than turning the aim). */
  grabStick(x, y) {
    if (this.stick.phase !== 'ground' || this.g.state !== 'aim') return false;
    const s = this.stickScreen();
    return !!s && Math.hypot(s.x - x, s.y - y) < 70;
  }

  /** A tap on the stick: a gentle lob straight out. */
  tapStick(x, y) {
    if (!this.grabStick(x, y)) return false;
    const a = (this.g.aimAngle ?? 0) + (Math.random() - 0.5) * 0.6;
    this.throwStick(Math.cos(a), Math.sin(a), 7);
    return true;
  }

  /** A flick from the stick: screen px dx, dy (up is away) over ms. */
  flickStick(dx, dy, ms) {
    const g = this.g, cam = g.camera;
    cam.getWorldDirection(this._v);
    const fl = Math.hypot(this._v.x, this._v.z) || 1, fx = this._v.x / fl, fz = this._v.z / fl;
    // Screen up is away from the camera, screen right is the camera's right
    let wx = fx * -dy + -fz * dx, wz = fz * -dy + fx * dx;
    const wl = Math.hypot(wx, wz);
    if (wl < 20) return this.tapStick(...Object.values(this.stickScreen() || { x: -999, y: -999 }));
    wx /= wl; wz /= wl;
    const pace = wl / Math.max(60, ms); // px per ms
    this.throwStick(wx, wz, Math.max(4.5, Math.min(15, 4 + pace * 7)));
    return true;
  }

  throwStick(dirX, dirZ, speed) {
    const g = this.g, st = this.stick, { world } = g;
    st.vx = dirX * speed; st.vz = dirZ * speed; st.vy = 7;
    st.fromX = st.x; st.fromZ = st.z;
    st.y = world.heightAt(st.x, st.z) + 1.0;
    // Where it will come down, so she can run for it
    const t = (st.vy + Math.sqrt(st.vy * st.vy + 2 * 9.8 * 1.0)) / 9.8;
    st.landX = st.x + st.vx * t; st.landZ = st.z + st.vz * t;
    st.phase = 'flying';
    st.t = 0;
    st.throws += 1;
    this.stickMark.style.display = 'none';
    g.audio.whoosh();
    g.audio.yip?.();
  }

  /** She got there first: snatched out of the air. */
  catchStick() {
    const g = this.g, st = this.stick;
    const dist = Math.hypot(st.x - st.fromX, st.z - st.fromZ);
    st.streak = (st.streak || 0) + 1;
    st.phase = 'back'; st.t = 0;
    this.react('hop', 0.7);
    this.leap = 0.45;
    g.audio.pop?.(); g.audio.reward(Math.min(8, st.streak));
    const best = dist > (g.camp.stats.bestCatch || 0);
    if (best) { g.camp.stats.bestCatch = Math.round(dist); g.saveCamp(); }
    g.hud.callout(`NICE CATCH${st.streak > 1 ? ` ×${st.streak}` : ''} · ${Math.round(dist)}m${best && dist > 8 ? ' · BEST' : ''}`, st.streak >= 3 || best ? 'gold small' : 'small');
    if (st.streak % 3 === 0) g.earn('pets');
  }

  updateStick(dt) {
    const g = this.g, st = this.stick, { world } = g;
    if (st.phase === 'none') return;
    st.t += dt;
    const yaw = this.group.rotation.y;
    const mouth = () => st.mesh.position.set(this.pos.x + Math.sin(yaw) * 0.6, this.pos.y + 0.55 + (this.leap > 0 ? Math.sin((this.leap / 0.45) * Math.PI) * 0.6 : 0), this.pos.z + Math.cos(yaw) * 0.6);
    const near = (x, z, r) => Math.hypot(this.pos.x - x, this.pos.z - z) < r;
    st.mesh.visible = st.phase !== 'seek';
    if (st.phase === 'seek' && (near(st.x, st.z, 0.6) || st.t > 6)) { st.phase = 'bring'; st.t = 0; g.audio.pop?.(); }
    else if ((st.phase === 'bring' || st.phase === 'back') && (near(st.dropX, st.dropZ, 0.6) || st.t > 8)) {
      // Every third time back, she will not let go without a tug
      if (st.phase === 'back' && st.throws % 3 === 0 && !st.tugged) { st.phase = 'tug'; st.t = 0; st.taps = 0; st.tugged = true; this.say('TUG! TAP HER'); g.audio.yip?.(); }
      else this.dropAtFeet();
    } else if (st.phase === 'tug') {
      if (st.taps >= 5) { g.hud.callout('YOU WIN THE TUG!', 'small'); this.hearts(3); this.dropAtFeet(); }
      else if (st.t > 3.5) { g.hud.callout(`${DOG_NAME.toUpperCase()} WINS… AND GIVES IT BACK`, 'small'); this.dropAtFeet(); }
    } else if (st.phase === 'flying') {
      st.vy -= 9.8 * dt;
      st.x += st.vx * dt; st.y += st.vy * dt; st.z += st.vz * dt;
      st.mesh.rotation.set(st.t * 9, st.t * 3, Math.PI / 2);
      const ground = Math.max(world.heightAt(st.x, st.z), world.waterLevelAt(st.x, st.z));
      // Close enough to snatch it before it lands?
      if (near(st.x, st.z, 1.15) && st.y - ground < 1.7 && st.t > 0.25) { this.catchStick(); }
      else if (st.y <= ground + 0.05) {
        st.y = ground + 0.05; st.phase = 'chase'; st.t = 0; g.audio.bounce(3, 'rough');
        if (st.streak) g.hud.callout('MISSED IT · TRY A SHORTER ONE', 'small');
        st.streak = 0;
      }
    } else if (st.phase === 'chase' && (near(st.x, st.z, 0.7) || st.t > 6)) {
      st.phase = 'back'; st.t = 0; g.audio.pop?.();
    }
    this.leap = Math.max(0, (this.leap || 0) - dt);
    if (st.phase === 'bring' || st.phase === 'back' || st.phase === 'tug') {
      mouth();
      st.mesh.rotation.set(0, yaw + Math.PI / 2 + (st.phase === 'tug' ? Math.sin(st.t * 18) * 0.25 : 0), Math.PI / 2);
    } else if (st.phase === 'ground' || st.phase === 'chase') { st.mesh.position.set(st.x, st.y, st.z); st.mesh.rotation.set(0, 0.6, Math.PI / 2); }
    else if (st.phase === 'flying') st.mesh.position.set(st.x, st.y, st.z);
    // A sparkle on it, to say "throw me"
    let shown = false;
    if (st.phase === 'ground' && g.state === 'aim') {
      const s = this.stickScreen();
      if (s && s.x > -20 && s.x < window.innerWidth + 20 && s.y > -20 && s.y < window.innerHeight + 20) {
        shown = true;
        this.stickMark.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      }
    }
    this.stickMark.style.display = shown ? 'block' : 'none';
  }

  dropAtFeet() {
    const g = this.g, st = this.stick, yaw = this.group.rotation.y;
    st.phase = 'ground'; st.t = 0; st.tugged = st.tugged && st.throws % 3 === 0;
    st.x = this.pos.x + Math.sin(yaw) * 0.6; st.z = this.pos.z + Math.cos(yaw) * 0.6;
    st.y = g.world.heightAt(st.x, st.z) + 0.05;
    if (/TUG/.test(this.sayText || '')) this.say(null);
    g.audio.yip?.();
    if (!g.camp.stats.sticks) { g.camp.stats.sticks = 1; g.saveCamp(); g.hud.callout(`${DOG_NAME.toUpperCase()} BROUGHT A STICK · FLICK IT`, 'small'); }
  }

  // ---- Wandering -----------------------------------------------------------------

  /**
   * Pottering about near a spot: trot somewhere a few metres away (beside the
   * shot, never in its way or in front of the camera), sit or sniff or flop
   * for a few seconds, then pick somewhere else.
   */
  roam(anchor, rMin = 2.5, rMax = 6) {
    const g = this.g, { world } = g;
    let r = this.roamAt;
    const moved = !r || Math.hypot(r.ax - anchor.x, r.az - anchor.z) > 6;
    const here = r && Math.hypot(this.pos.x - r.x, this.pos.z - r.z) < 0.45;
    if (here && r.t === null) r.t = 2.5 + Math.random() * 4;
    if (moved || (here && (r.t -= 1 / 60) <= 0)) {
      const aim = g.aimAngle ?? 0;
      for (let i = 0; i < 12; i++) {
        // Off to either side of the line of play, ahead of the camera so she stays in view
        const a = aim + (Math.random() < 0.5 ? 1 : -1) * (0.55 + Math.random() * 0.8);
        const d = rMin + Math.random() * (rMax - rMin);
        const x = anchor.x + Math.cos(a) * d, z = anchor.z + Math.sin(a) * d;
        if (world.surfaceAt(x, z) === 'water') continue;
        r = this.roamAt = { x, z, ax: anchor.x, az: anchor.z, t: null, pose: ['sit', 'sniff', 'sit', 'lie', 'sniff'][Math.floor(Math.random() * 5)] };
        break;
      }
    }
    if (!this.roamAt) return null;
    r = this.roamAt;
    const far = Math.hypot(this.pos.x - r.x, this.pos.z - r.z) > 25;
    return { x: r.x, z: r.z, pose: r.pose, speed: far ? 9 : 2.4, near: 0.3 };
  }

  /** Where to be and what to do this frame, from the game's state. */
  plan() {
    const g = this.g, s = g.state, { ball, world } = g;
    const cg = g.camper.group;
    if (!world || !g.round && s !== 'summary') return null;
    if (this.asleep) return { x: this.pos.x, z: this.pos.z, pose: 'lie', face: null };
    if (!this.friend) return null;
    if (s === 'title' || s === 'intro' || s === 'fishing' || s === 'creator') return null;
    const st = this.stick;
    if (st.phase !== 'none' && s !== 'aim') this.dropStick();
    if (st.phase === 'seek') return { x: st.x, z: st.z, pose: 'run', speed: 8, near: 0.3 };
    if (st.phase === 'bring' || st.phase === 'back') return { x: st.dropX, z: st.dropZ, pose: 'run', speed: st.phase === 'back' ? 11 : 7, near: 0.4 };
    if (st.phase === 'flying') return { x: st.landX, z: st.landZ, pose: 'run', speed: 11, near: 0.3 };
    if (st.phase === 'chase') return { x: st.x, z: st.z, pose: 'run', speed: 11, near: 0.5 };
    if (st.phase === 'tug') return { x: this.pos.x, z: this.pos.z, pose: 'beg', face: { x: g.camera.position.x, z: g.camera.position.z } };
    if (st.phase === 'ground') return { x: st.dropX + 0.9, z: st.dropZ + 0.6, pose: 'beg', face: { x: st.x, z: st.z }, speed: 6 };
    if (this.fetching) {
      const f = this.fetching;
      if (f.phase === 'go') return { x: f.item.x, z: f.item.z, pose: 'run', speed: 11, near: 0.6 };
      return { x: cg.position.x + 0.8, z: cg.position.z + 0.4, pose: 'run', speed: 11, near: 0.9 };
    }
    if (s === 'summary') {
      const site = g.campsite;
      site.updateMatrixWorld();
      const v = this._v.set(0.95, 0, 1.05).applyMatrix4(site.matrixWorld);
      return { x: v.x, z: v.z, pose: g.photo ? 'sit' : 'lie', face: { x: site.position.x, z: site.position.z }, speed: 6 };
    }
    if (s === 'cook' || s === 'nabe') {
      const v = s === 'cook' ? g.cookView : g.campView;
      if (!v) return null;
      // Across the fire from the camera, looking hopeful
      const a = s === 'cook' ? v.angle + 1.1 : v.angle + Math.PI + 0.55;
      const r = s === 'cook' ? 1.3 : 1.2;
      return { x: v.x + Math.cos(a) * r, z: v.z + Math.sin(a) * r, pose: 'beg', face: { x: v.x, z: v.z }, speed: 8 };
    }
    if (s === 'holed' || s === 'result') return this.roam(world.cup, 2.5, 4.5);
    if (s === 'skip' && g.skip?.shore) {
      const sh = g.skip.shore;
      return { x: sh.x - sh.dx * 0.6 + sh.dz * 1.2, z: sh.z - sh.dz * 0.6 - sh.dx * 1.2, pose: 'sit', face: { x: sh.x + sh.dx * 8, z: sh.z + sh.dz * 8 } };
    }
    // While the ball flies she stays where she was: no chasing it across the screen
    if (s === 'flight' || s === 'settle' || ball.surface === 'water' || g.waterLost) return this.anchor ? this.roam(this.anchor) : null;
    if (this.sniffAt && (s === 'aim' || s === 'swing' || s === 'settle')) {
      return { x: this.sniffAt.x - 0.5, z: this.sniffAt.z - 0.4, pose: 'sniff', face: this.sniffAt, speed: 9 };
    }
    // Lining up: she potters about near the ball
    this.anchor = { x: ball.x, z: ball.z };
    return this.roam(this.anchor, g.putting ? 2 : 2.5, g.putting ? 4.5 : 6.5);
  }

  update(dt) {
    const g = this.g;
    this.maybeStick(dt);
    const want = this.plan();
    if (!want) { this.group.visible = false; this.tag.classList.add('hidden'); this.placed = this.placed && g.state !== 'title'; return; }
    const { world } = g;
    if (!this.group.visible || !this.placed) {
      // Arrive from just off camera rather than appear on the spot
      this.placed = true;
      if (Math.hypot(want.x - this.pos.x, want.z - this.pos.z) > 60 || !this.pos.lengthSq()) {
        const cam = g.camera.position;
        const dx = want.x - cam.x, dz = want.z - cam.z, d = Math.hypot(dx, dz) || 1;
        this.pos.set(want.x - (dx / d) * 6 + (dz / d) * 4, 0, want.z - (dz / d) * 6 - (dx / d) * 4);
      }
    }
    this.group.visible = true;
    const dx = want.x - this.pos.x, dz = want.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const near = want.near ?? 0.25;
    let pose = want.pose, speed = 0;
    if (dist > near + 0.05) {
      // Trot when close, gallop when far, never slower than the camera
      speed = Math.min(want.speed || 9, Math.max(3, dist * 2.2));
      if (dist > 45) speed = Math.max(speed, dist * 0.9);
      const step = Math.min(dist - near, speed * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      this.group.rotation.y = Math.atan2(dx, dz);
      pose = 'run';
    } else if (want.face) {
      const fy = Math.atan2(want.face.x - this.pos.x, want.face.z - this.pos.z);
      let d = fy - this.group.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.group.rotation.y += d * Math.min(1, dt * 6);
    }
    // Not into the pond, however keen
    const ground = world.heightAt(this.pos.x, this.pos.z);
    const lvl = world.waterLevelAt(this.pos.x, this.pos.z);
    this.pos.y = Math.max(ground, lvl + 0.02);

    // Fetching: pick it up, bring it back
    const f = this.fetching;
    if (f) {
      f.t += dt;
      if (f.phase === 'go' && (dist <= near + 0.1 || f.t > 6)) { f.phase = 'back'; f.t = 0; f.item.carried = true; g.audio.pop?.(); }
      else if (f.phase === 'back' && (dist <= near + 0.15 || f.t > 6)) { this.fetching = null; f.done(); this.react('hop', 1); this.hearts(2); }
      if (f.item.carried && f.item.mesh) {
        // In her mouth
        const yaw = this.group.rotation.y;
        f.item.mesh.position.set(this.pos.x + Math.sin(yaw) * 0.55, this.pos.y + 0.55, this.pos.z + Math.cos(yaw) * 0.55);
      }
    }

    if (this.mood) {
      this.mood.t -= dt;
      if (this.mood.t <= 0) this.mood = null;
      else if (pose !== 'run' || this.mood.pose === 'hop') pose = this.mood.pose;
    }
    this.group.position.copy(this.pos);
    this.updateStick(dt);
    this.model.update(dt, pose, speed);
    this.model.setGlow(g.sky.night);

    // zZz over her head while asleep
    if (this.sayText) {
      const s = this.screenPos();
      this.tag.classList.toggle('hidden', !s);
      if (s) this.tag.style.transform = `translate(${s.x}px, ${s.y - 18}px) translate(-50%, -100%)`;
    }
  }
}

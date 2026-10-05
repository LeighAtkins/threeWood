/**
 * A camper: the golfer you built, drawn from primitives in an anime key.
 *
 * Long legs in tights, an open puffer over a bright shirt, a head that is
 * mostly eyes, and hair with a fringe and strands — cel shaded so the clothes
 * read as flat blocks of colour. Everything comes from core/camp.js. The model
 * is one unit tall with its feet at y = 0 and faces +z; scale and place the
 * group.
 *
 * Poses are procedural: pass a name to update() and the limbs ease there.
 *   idle | walk | address | sit | warm | perch | perchWarm | cheer | peace | wave | hello
 */

import * as THREE from 'three';
import { SKINS, HAIR_COLORS, EYE_COLORS, outfitById, cleanLook } from '../core/camp.js';

/** Where the hands meet in the address pose, in model units. */
export const GRIP = { y: 0.43, z: 0.21 };

const HIP = 0.45, KNEE = 0.22, SHOULDER = 0.685, HEAD = 0.84;

// Three flat tones: light, mid, shade
let ramp = null;
function toon(color, opts = {}) {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...opts });
}
const flat = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });
const ball = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const tube = (rt, rb, h, seg = 12, open = false, start = 0, len = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, start, len);

// Each pose: left arm, right arm [swing x, raise z, elbow], left leg, right leg [hip, knee], lean, drop
const P = (aL, aR, lL, lR, lean = 0, drop = 0) => [...aL, ...aR, ...lL, ...lR, lean, drop];
const POSES = {
  idle:      P([0, -0.12, -0.18], [0, 0.12, -0.18], [0, 0], [0, 0]),
  walk:      P([0, -0.1, -0.6], [0, 0.1, -0.6], [0, 0], [0, 0], 0.08),
  address:   P([-0.85, 0.38, -0.1], [-0.85, -0.38, -0.1], [-0.16, 0.3], [-0.16, 0.3], 0.38, 0.012),
  sit:       P([-0.45, -0.2, -0.5], [-0.45, 0.2, -0.5], [-1.5, 0.1], [-1.5, 0.1], -0.12, 0.4),
  warm:      P([-1.15, -0.05, -0.25], [-1.15, 0.05, -0.25], [-1.5, 0.1], [-1.5, 0.1], 0.14, 0.4),
  perch:     P([-0.55, -0.1, -0.7], [-0.55, 0.1, -0.7], [-1.5, 1.45], [-1.5, 1.45], 0.05),
  perchWarm: P([-1.2, -0.05, -0.2], [-1.2, 0.05, -0.2], [-1.5, 1.45], [-1.5, 1.45], 0.18),
  cheer:     P([0, -2.75, -0.15], [0, 2.75, -0.15], [0, 0], [0, 0], -0.06),
  peace:     P([0, -0.35, -0.9], [-1.9, 0.35, -1.5], [0, 0], [-0.1, 0.25], 0),
  wave:      P([0, -0.12, -0.2], [0, 2.55, -0.2], [0, 0], [0, 0]),
  hello:     P([-0.5, -0.3, -1.3], [0, 2.7, -0.15], [-0.15, 0.1], [0.45, 1.7], 0.1),
};

export class Camper {
  constructor(look) {
    this.group = new THREE.Group();
    this.t = Math.random() * 10;
    this.cur = [...POSES.idle];
    this.pose = 'idle';
    this.twist = 0;
    this.setLook(look);
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.group.clear();
  }

  setLook(look) {
    this.look = cleanLook(look);
    this.dispose();
    const { body, hair, hairColor, skin, eyes } = this.look;
    const fit = outfitById(this.look.outfit);
    const girl = body === 'girl';
    const skinMat = toon(SKINS[skin]);
    const hairMat = toon(HAIR_COLORS[hairColor]);
    const jacket = toon(fit.jacket, { side: THREE.DoubleSide });
    const trim = toon(fit.trim);
    const shirt = toon(fit.shirt);
    const seam = flat(new THREE.Color(fit.jacket).multiplyScalar(0.72));

    const add = (parent, geo, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const rig = this.rig = new THREE.Group(); // bobs and drops
    this.group.add(rig);

    // ---- Legs: thigh, knee, shin, sneaker ---------------------------------------
    const pants = fit.bottoms === 'pants';
    const legMat = toon(pants ? fit.bottomColor : fit.legs ?? SKINS[skin]);
    const shoeMat = toon(fit.shoes);
    const sole = toon(0xfbf7ee);
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.046, HIP, 0);
      add(hip, tube(0.044, 0.037, KNEE, 10), legMat, 0, -KNEE / 2, 0);
      const knee = new THREE.Group();
      knee.position.y = -KNEE;
      add(knee, ball(0.037, 8, 6), legMat);
      add(knee, tube(0.036, 0.03, 0.19, 10), legMat, 0, -0.095, 0);
      if (!pants && fit.legs == null) add(knee, tube(0.034, 0.033, 0.05, 10), sole, 0, -0.165, 0); // socks
      add(knee, ball(1, 10, 8), shoeMat, 0, -0.2, 0.022, 0.04, 0.034, 0.068);
      add(knee, new THREE.BoxGeometry(0.064, 0.014, 0.118), sole, 0, -0.223, 0.022);
      add(knee, ball(0.022, 8, 6), sole, 0, -0.207, 0.068, 1, 0.75, 0.8); // toe cap
      hip.add(knee);
      rig.add(hip);
      return { hip, knee };
    });

    // ---- Upper body: leans from the hips -------------------------------------------
    const upper = this.upper = new THREE.Group();
    upper.position.y = HIP;
    rig.add(upper);
    const Y = (y) => y - HIP;
    const bottomMat = toon(fit.bottomColor);
    if (fit.bottoms === 'skirt') add(upper, tube(0.08, 0.135, 0.13, 14), bottomMat, 0, Y(0.42), 0);
    else add(upper, tube(0.086, 0.094, pants ? 0.07 : 0.12, 12), bottomMat, 0, Y(pants ? 0.45 : 0.425), 0);
    add(upper, tube(0.072, 0.084, 0.25, 12), shirt, 0, Y(0.575), 0);
    add(upper, tube(0.03, 0.032, 0.05, 8), skinMat, 0, Y(0.715), 0); // neck

    const top = fit.top;
    const open = top === 'coat' || top === 'long';
    const gap = open ? 0.85 : 0;
    const hem = top === 'long' ? 0.37 : 0.47;      // where the top ends
    const height = 0.705 - hem;
    const mid = Y(hem + height / 2);
    const rTop = top === 'vest' ? 0.088 : 0.102, rBot = top === 'long' ? 0.132 : top === 'vest' ? 0.096 : 0.116;
    add(upper, tube(rTop, rBot, height, 18, true, gap / 2, Math.PI * 2 - gap), jacket, 0, mid, 0);
    if (!open) add(upper, tube(rTop, rTop * 0.6, 0.012, 18), jacket, 0, Y(0.705), 0); // shoulders closed over
    // Quilting on a puffer; a check on flannel; a pocket on a hoodie
    if (open || fit.check) {
      const rows = top === 'long' ? 4 : 3;
      for (let i = 1; i < rows; i++) {
        const k = i / rows, r = rTop + (rBot - rTop) * (1 - k) + 0.003;
        add(upper, tube(r, r, 0.007, 18, true, gap / 2, Math.PI * 2 - gap), fit.check ? trim : seam, 0, Y(hem + height * k), 0);
      }
    }
    if (top === 'hoodie') add(upper, new THREE.BoxGeometry(0.1, 0.05, 0.02), trim, 0, Y(0.52), 0.108);
    if (fit.apron) add(upper, new THREE.BoxGeometry(0.13, 0.2, 0.012), toon(fit.apron), 0, Y(0.55), 0.112);
    if (fit.collar || top === 'hoodie') {
      add(upper, new THREE.TorusGeometry(0.078, 0.032, 8, 16), fit.collar ? trim : jacket, 0, Y(0.705), -0.012).rotation.x = Math.PI / 2 - 0.25;
    }
    if (fit.scarf) {
      const scarf = toon(fit.scarf);
      add(upper, new THREE.TorusGeometry(0.066, 0.036, 8, 14), scarf, 0, Y(0.725), 0.004).rotation.x = Math.PI / 2;
      add(upper, new THREE.BoxGeometry(0.05, 0.13, 0.025), scarf, 0.05, Y(0.65), 0.105).rotation.z = -0.15;
    }
    if (fit.pack) {
      const pack = toon(fit.pack);
      add(upper, new THREE.BoxGeometry(0.15, 0.18, 0.075), pack, 0, Y(0.59), -0.15);
      add(upper, new THREE.BoxGeometry(0.11, 0.07, 0.03), toon(new THREE.Color(fit.pack).multiplyScalar(0.8)), 0, Y(0.56), -0.195);
      for (const side of [-1, 1]) add(upper, new THREE.BoxGeometry(0.022, 0.2, 0.012), pack, side * 0.06, Y(0.6), rTop + 0.012).rotation.x = -0.06;
    }

    // ---- Arms: sleeve, elbow, hand ----------------------------------------------------
    const sleeve = top === 'vest' ? shirt : jacket;
    const puff = open ? 0.052 : 0.044;
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * (rTop + 0.022), Y(SHOULDER), 0);
      add(shoulder, ball(puff, 10, 8), sleeve);
      add(shoulder, tube(puff, puff * 0.92, 0.13, 10), sleeve, 0, -0.065, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.13;
      add(elbow, ball(puff * 0.92, 8, 6), sleeve);
      add(elbow, tube(puff * 0.92, puff * 0.8, 0.11, 10), sleeve, 0, -0.055, 0);
      add(elbow, tube(puff * 0.82, puff * 0.82, 0.02, 10), open ? seam : trim, 0, -0.105, 0); // cuff
      add(elbow, ball(0.031, 10, 8), skinMat, 0, -0.135, 0);
      shoulder.add(elbow);
      upper.add(shoulder);
      return { shoulder, elbow };
    });

    // ---- Head -----------------------------------------------------------------------------
    const head = this.head = new THREE.Group();
    head.position.y = Y(HEAD) - 0.012;
    head.scale.setScalar(0.82); // close to real proportions: about five and a half heads tall
    upper.add(head);
    const R = 0.125;
    add(head, ball(R, 24, 18), skinMat, 0, 0, 0, 1, 0.97, 0.98);

    // Eyes: white, a big coloured iris, pupil, two highlights and a dark lash line
    const dark = flat(0x2a1c22);
    const white = flat(0xffffff);
    const iris = flat(EYE_COLORS[eyes]);
    const irisDeep = flat(new THREE.Color(EYE_COLORS[eyes]).multiplyScalar(0.55));
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      const ex = side * 0.046, ey = -0.008;
      eye.position.set(ex, ey, Math.sqrt(R * R - ex * ex - ey * ey) * 0.97);
      eye.rotation.y = side * 0.42;
      eye.scale.setScalar(0.74); // bright, but not the whole face
      const disc = (r, material, x, y, z, sx = 1, sy = 1) => add(eye, ball(r, 14, 10), material, x, y, z, sx, sy, 0.16);
      disc(0.036, white, 0, 0, 0, 1, 1.22);
      disc(0.029, irisDeep, 0, -0.002, 0.003, 1, 1.3);
      disc(0.025, iris, 0, -0.008, 0.005, 1, 1.15);
      disc(0.013, dark, 0, 0, 0.007, 1, 1.35);
      disc(0.0095, white, side * 0.011, 0.017, 0.01);
      disc(0.005, white, side * -0.01, -0.016, 0.01);
      // Lash: a dark cap over the top of the eye, flicked out at the corner
      add(eye, new THREE.TorusGeometry(0.036, 0.0065, 5, 12, Math.PI * 0.9), dark, 0, 0.012, 0.004, 1, 1.05, 0.5).rotation.z = Math.PI * 0.05;
      if (girl) add(eye, new THREE.BoxGeometry(0.02, 0.007, 0.004), dark, side * 0.038, 0.03, 0.002).rotation.z = side * 0.6;
      add(eye, new THREE.BoxGeometry(girl ? 0.04 : 0.05, girl ? 0.006 : 0.011, 0.004), hairMat, 0, 0.066, 0.004).rotation.z = side * (girl ? -0.12 : 0.1);
      head.add(eye);
      const cheek = add(head, ball(0.026, 10, 8), flat(0xff8f98, { transparent: true, opacity: 0.55 }), side * 0.083, -0.05, 0.088, 1, 0.6, 0.2);
      cheek.rotation.y = side * 0.75;
    }
    // A small open smile
    add(head, new THREE.CircleGeometry(0.02, 12, Math.PI, Math.PI), flat(0xb2413c), 0, -0.052, 0.1235);
    add(head, new THREE.CircleGeometry(0.011, 10, Math.PI, Math.PI), flat(0xf08a8a), 0, -0.064, 0.1245);

    // ---- Hair: a shell, a fringe of strands, side locks, then the style ---------------
    const hat = fit.hat;
    const hatted = hat !== 'none' && hat !== 'bandana';
    const shell = add(head, new THREE.SphereGeometry(R + 0.012, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, 0.004, -0.008);
    shell.rotation.x = -0.52;
    add(head, ball(R + 0.004, 16, 12), hairMat, 0, -0.012, -0.03, 1.04, 0.98, 0.95); // back of the head
    // Fringe: strands hanging to the brow, one between the eyes
    const strands = [[-0.088, 0.03, 0.5], [-0.052, 0.022, 0.2], [-0.012, 0.012, -0.1], [0.03, 0.022, -0.25], [0.07, 0.03, -0.45], [0.1, 0.04, -0.6]];
    for (const [x, drop, lean] of strands) {
      const z = Math.sqrt(Math.max(0.001, (R + 0.006) ** 2 - x * x - 0.05 * 0.05));
      const s = add(head, ball(0.03, 8, 8), hairMat, x, 0.085 - drop, z - 0.012, 0.85, 1.9, 0.42);
      s.rotation.set(-0.35, x * 4, lean);
    }
    const long = hair === 'long' || hair === 'twintails';
    for (const side of [-1, 1]) {
      // Locks framing the face
      const lock = add(head, ball(0.03, 8, 8), hairMat, side * 0.112, long ? -0.075 : -0.04, 0.045, 0.6, long ? 4 : 2.4, 0.8);
      lock.rotation.z = side * -0.06;
    }
    if (hair === 'bob') add(head, ball(R, 16, 12), hairMat, 0, -0.045, -0.025, 1.12, 0.95, 0.95);
    if (hair === 'bun') {
      if (hatted) add(head, ball(0.05, 10, 8), hairMat, 0, -0.07, -0.125);
      else { add(head, ball(0.062, 12, 10), hairMat, 0, 0.15, -0.03); add(head, new THREE.TorusGeometry(0.03, 0.01, 5, 10), trim, 0, 0.115, -0.025).rotation.x = Math.PI / 2; }
    }
    if (hair === 'long') {
      add(head, ball(0.1, 14, 12), hairMat, 0, -0.17, -0.085, 1.15, 2.5, 0.5);
      for (const side of [-1, 1]) add(head, ball(0.04, 8, 8), hairMat, side * 0.09, -0.2, -0.05, 0.8, 3.6, 0.7).rotation.z = side * 0.08;
    }
    if (hair === 'twintails') {
      for (const side of [-1, 1]) {
        add(head, ball(0.045, 10, 8), hairMat, side * 0.15, -0.16, -0.03, 0.8, 3.4, 0.8).rotation.z = side * 0.22;
        add(head, ball(0.022, 6, 6), trim, side * 0.125, -0.015, -0.03);
      }
    }
    if (hair === 'ponytail') {
      add(head, ball(0.045, 10, 8), hairMat, 0, -0.06, -0.165, 0.85, 3.2, 0.8).rotation.x = 0.42;
      add(head, ball(0.022, 6, 6), trim, 0, 0.06, -0.125);
    }

    // ---- Hats ---------------------------------------------------------------------------
    const hatMat = toon(fit.hatColor ?? fit.trim);
    const dome = (sy = 1, len = 0.5) => {
      const d = add(head, new THREE.SphereGeometry(R + 0.02, 22, 12, 0, Math.PI * 2, 0, Math.PI * len), hatMat, 0, 0.02, -0.006, 1, sy, 1);
      d.rotation.x = -0.2;
      return d;
    };
    if (hat === 'beanie' || hat === 'pom' || hat === 'earflap') {
      dome(1.18);
      const cuff = add(head, tube(R + 0.026, R + 0.026, 0.048, 22, true), toon(fit.hatColor ?? fit.trim, { side: THREE.DoubleSide }), 0, 0.04, -0.006);
      cuff.rotation.x = -0.2;
      if (hat === 'pom') add(head, ball(0.038, 10, 8), trim, 0, 0.19, -0.04);
      if (hat === 'earflap') for (const side of [-1, 1]) add(head, ball(0.04, 8, 8), hatMat, side * 0.128, -0.03, -0.005, 0.45, 1.6, 1);
    } else if (hat === 'cap' || hat === 'flat') {
      dome(hat === 'flat' ? 0.72 : 1, 0.46);
      add(head, tube(0.08, 0.08, 0.012, 16), hatMat, 0, 0.058, 0.125, 1, 1, 0.85).rotation.x = 0.12;
    } else if (hat === 'bucket') {
      dome(1, 0.46);
      add(head, tube(R + 0.02, R + 0.075, 0.045, 22, true), toon(fit.hatColor, { side: THREE.DoubleSide }), 0, 0.045, -0.006).rotation.x = -0.12;
    } else if (hat === 'bandana') {
      add(head, new THREE.TorusGeometry(R + 0.008, 0.02, 6, 22), hatMat, 0, 0.06, -0.006).rotation.x = Math.PI / 2 - 0.32;
      add(head, ball(0.026, 6, 6), hatMat, 0.03, 0.0, -0.14, 1, 1.7, 0.6);
    }
  }

  /**
   * @param {number} dt
   * @param {string} pose
   * @param {object} [o]
   * @param {number} [o.twist] address: how far through the swing (-1 back .. +1 through)
   */
  update(dt, pose = 'idle', { twist = 0 } = {}) {
    this.t += dt;
    this.pose = pose;
    const want = POSES[pose] || POSES.idle;
    const k = Math.min(1, dt * 12);
    for (let i = 0; i < want.length; i++) this.cur[i] += (want[i] - this.cur[i]) * k;
    this.twist += (twist - this.twist) * Math.min(1, dt * 18);
    const t = this.t;
    let [alx, alz, ale, arx, arz, are, llh, llk, lrh, lrk, lean, drop] = this.cur;
    let bob = Math.sin(t * 2.4) * 0.004;
    let tilt = Math.sin(t * 1.3) * 0.04;
    if (pose === 'walk') {
      const s = Math.sin(t * 12);
      llh += s * 0.7; lrh -= s * 0.7;
      llk += Math.max(0, -s) * 1.1; lrk += Math.max(0, s) * 1.1;
      alx -= s * 0.6; arx += s * 0.6;
      bob = Math.abs(Math.cos(t * 12)) * 0.022;
    } else if (pose === 'cheer') {
      bob = Math.abs(Math.sin(t * 7)) * 0.06;
      alz -= Math.sin(t * 14) * 0.15; arz += Math.sin(t * 14) * 0.15;
      llk += Math.max(0, Math.sin(t * 7)) * 0.5; lrk += Math.max(0, Math.sin(t * 7)) * 0.5;
    } else if (pose === 'wave' || pose === 'hello') {
      arz += Math.sin(t * 9) * 0.3;
      tilt = 0.12;
      if (pose === 'hello') bob = Math.abs(Math.sin(t * 5)) * 0.03;
    } else if (pose === 'peace') {
      tilt = -0.14;
    } else if (pose === 'warm' || pose === 'perchWarm') {
      alx += Math.sin(t * 3) * 0.05; arx += Math.sin(t * 3 + 1) * 0.05;
    }
    const [L, Rr] = this.arms;
    L.shoulder.rotation.set(alx, 0, alz); L.elbow.rotation.x = ale;
    Rr.shoulder.rotation.set(arx, 0, arz); Rr.elbow.rotation.x = are;
    this.legs[0].hip.rotation.x = llh; this.legs[0].knee.rotation.x = llk;
    this.legs[1].hip.rotation.x = lrh; this.legs[1].knee.rotation.x = lrk;
    this.rig.position.y = bob - drop;
    // The swing turns the shoulders; the head stays on the ball until it has gone
    const addr = pose === 'address';
    this.upper.rotation.set(lean, addr ? -this.twist * 0.5 : 0, 0);
    this.head.rotation.set(addr ? 0.15 : 0, addr ? this.twist * 0.35 : 0, tilt);
  }
}

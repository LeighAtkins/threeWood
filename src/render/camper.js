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

// The face each pose wears, unless a passing mood says otherwise
const POSE_FACE = { cheer: 'joy', hello: 'joy', wave: 'joy', peace: 'cheeky', address: 'focus', sit: 'calm', warm: 'calm', perch: 'calm', perchWarm: 'calm' };
// Per mood: how open the eyes are (0 = shut in a happy arch), brow lift and
// inner-end drop, and the mouth
const FACES = {
  neutral: { open: 1, brow: [0, 0], mouth: 'smile' },
  joy: { open: 0, brow: [0.008, -0.1], mouth: 'grin' },
  cheeky: { open: 0.9, brow: [0.004, -0.06], mouth: 'cat', wink: true },
  focus: { open: 0.7, brow: [-0.005, 0.24], mouth: 'flat' },
  calm: { open: 0.58, brow: [-0.002, -0.06], mouth: 'smile' },
  oops: { open: 1.15, brow: [0.01, -0.32], mouth: 'o' },
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

  setCrown(on) { this.crowned = !!on; if (this.crown) this.crown.visible = this.crowned; }

  /** After dark the clothes keep some of their colour (0 = day .. 1 = night). */
  setGlow(night) {
    if (this.glow === night && !this.glowDirty) return;
    this.glow = night;
    this.glowDirty = false;
    this.group.traverse((o) => { if (o.isMesh && o.material.isMeshToonMaterial) o.material.emissive.copy(o.material.color).multiplyScalar(night * 0.38); });
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.group.clear();
  }

  setLook(look) {
    this.look = cleanLook(look);
    this.dispose();
    this.glowDirty = true;
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
    const bottomMat = toon(fit.bottomColor);
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.046, HIP, 0);
      add(hip, tube(0.044, 0.037, KNEE, 10), legMat, 0, -KNEE / 2, 0);
      // Shorts and trousers are worn on the legs, so they go where the legs go:
      // a ball at the hip joint and (for shorts) a leg of cloth round the thigh
      if (fit.bottoms !== 'skirt') add(hip, ball(pants ? 0.047 : 0.056, 10, 8), bottomMat);
      if (fit.bottoms === 'shorts') add(hip, tube(0.056, 0.052, 0.1, 12), bottomMat, 0, -0.05, 0);
      const knee = new THREE.Group();
      knee.position.y = -KNEE;
      add(knee, ball(0.037, 8, 6), legMat);
      add(knee, tube(0.036, 0.03, 0.19, 10), legMat, 0, -0.095, 0);
      if (!pants && fit.legs == null) add(knee, tube(0.034, 0.033, 0.05, 10), sole, 0, -0.165, 0); // socks
      // Sneaker: a rounded upper on a thick, rounded sole, a pale toe cap and a lace strip
      add(knee, ball(1, 12, 8), shoeMat, 0, -0.198, 0.02, 0.039, 0.033, 0.066);
      add(knee, tube(0.5, 0.5, 1, 14), sole, 0, -0.222, 0.022, 0.07, 0.016, 0.126);
      add(knee, ball(0.021, 10, 6), sole, 0, -0.209, 0.064, 1, 0.7, 0.8); // toe cap
      add(knee, new THREE.BoxGeometry(0.018, 0.006, 0.04), sole, 0, -0.17, 0.034).rotation.x = 0.5; // laces
      hip.add(knee);
      rig.add(hip);
      return { hip, knee };
    });

    // ---- Upper body: leans from the hips -------------------------------------------
    const upper = this.upper = new THREE.Group();
    upper.position.y = HIP;
    rig.add(upper);
    const Y = (y) => y - HIP;
    // The waistband rides with the body; the rest of the bottoms are on the legs
    add(upper, tube(0.076, 0.082, 0.06, 12), bottomMat, 0, Y(0.475), 0);
    // A skirt (and a long coat's tails) hang from the waist and swing forward
    // over the knees when sitting, rather than the thighs going through them
    // (in halves: the front lies over the lap, the back hangs behind)
    this.drapes = [];
    const hinge = (front) => { const g = new THREE.Group(); g.position.y = Y(0.47); g.userData.front = front; upper.add(g); this.drapes.push(g); return g; };
    const lap = hinge(true), seat = hinge(false);
    const drape = (r0, r1, h, opening, material, y) => {
      const piece = (g, start, len) => { if (len > 0.01) add(g, tube(r0, r1, h, 10, true, start, len), material, 0, y, 0); };
      const q = Math.PI / 2;
      piece(lap, opening / 2, q - opening / 2);                 // front, one side of the opening
      piece(lap, 3 * q, q - opening / 2);                       // front, the other side
      piece(seat, q, 2 * q);                                    // back
    };
    if (fit.bottoms === 'skirt') drape(0.075, 0.128, 0.14, 0, bottomMat, -0.07);
    add(upper, tube(0.058, 0.076, 0.25, 12), shirt, 0, Y(0.575), 0);
    add(upper, tube(0.03, 0.032, 0.05, 8), skinMat, 0, Y(0.715), 0); // neck

    const top = fit.top;
    const open = top === 'coat' || top === 'long';
    const gap = top === 'long' ? 1.05 : open ? 0.85 : 0;
    const hem = top === 'long' ? 0.37 : 0.47;      // where the top ends
    const height = 0.705 - hem;
    const mid = Y(hem + height / 2);
    const rTop = top === 'vest' ? 0.068 : open ? 0.08 : 0.074, rBot = top === 'long' ? 0.128 : top === 'vest' ? 0.088 : open ? 0.11 : 0.098;
    // Radius of the top at height y, so things worn on it sit on its surface
    const rAt = (y) => rBot + (rTop - rBot) * Math.max(0, Math.min(1, (y - hem) / height));
    if (top === 'long') {
      // Above the waist on the body, the tails on a hinge at the waist
      const waist = 0.47, rW = rAt(waist);
      add(upper, tube(rTop, rW, 0.705 - waist, 18, true, gap / 2, Math.PI * 2 - gap), jacket, 0, Y((0.705 + waist) / 2), 0);
      drape(rW, rBot, waist - hem, gap, jacket, -(waist - hem) / 2 + 0.002);
    } else {
      add(upper, tube(rTop, rBot, height, 18, true, gap / 2, Math.PI * 2 - gap), jacket, 0, mid, 0);
    }
    if (!open) add(upper, tube(rTop, rTop * 0.6, 0.012, 18), jacket, 0, Y(0.705), 0); // shoulders closed over
    // Quilting on a puffer; a check on flannel; a pocket on a hoodie
    if (open || fit.check) {
      const rows = top === 'long' ? 4 : 3;
      for (let i = 1; i < rows; i++) {
        const y = hem + height * (i / rows), r = rAt(y) + 0.003;
        if (top === 'long' && y < 0.47) drape(r, r, 0.007, gap, fit.check ? trim : seam, y - 0.47);
        else add(upper, tube(r, r, 0.007, 18, true, gap / 2, Math.PI * 2 - gap), fit.check ? trim : seam, 0, Y(y), 0);
      }
    }
    if (top === 'hoodie') add(upper, new THREE.BoxGeometry(0.09, 0.045, 0.012), trim, 0, Y(0.52), rAt(0.52) + 0.002);
    if (fit.apron) {
      // Lies on the slope of the front, top to bottom
      const a = add(upper, new THREE.BoxGeometry(0.12, 0.2, 0.01), toon(fit.apron), 0, Y(0.555), rAt(0.555) + 0.008);
      a.rotation.x = -Math.atan2(rBot - rTop, height);
    }
    if (fit.collar || top === 'hoodie') {
      if (!fit.scarf) add(upper, new THREE.TorusGeometry(0.062, 0.028, 8, 16), fit.collar ? trim : jacket, 0, Y(0.705), -0.01).rotation.x = Math.PI / 2 - 0.25;
      // The hood, folded down the back (long hair falls where it would be)
      if (hair !== 'long') add(upper, ball(1, 12, 8), fit.collar ? trim : jacket, 0, Y(0.67), -rAt(0.67) + 0.005, 0.085, 0.06, 0.045);
    }
    if (fit.scarf) {
      const scarf = toon(fit.scarf);
      add(upper, new THREE.TorusGeometry(0.056, 0.034, 8, 14), scarf, 0, Y(0.725), 0.004).rotation.x = Math.PI / 2;
      add(upper, new THREE.BoxGeometry(0.048, 0.13, 0.024), scarf, 0.04, Y(0.65), 0.088).rotation.z = -0.15;
    }
    if (fit.pack) {
      const pack = toon(fit.pack);
      add(upper, new THREE.BoxGeometry(0.14, 0.18, 0.075), pack, 0, Y(0.59), -0.135);
      add(upper, new THREE.BoxGeometry(0.1, 0.07, 0.03), toon(new THREE.Color(fit.pack).multiplyScalar(0.8)), 0, Y(0.56), -0.18);
      for (const side of [-1, 1]) {
        const x = side * 0.045, r = Math.sqrt(Math.max(0, rAt(0.6) ** 2 - x * x));
        add(upper, new THREE.BoxGeometry(0.02, 0.21, 0.01), pack, x, Y(0.6), r + 0.008).rotation.x = -Math.atan2(rBot - rTop, height);
      }
    }

    // ---- Arms: sleeve, elbow, hand ----------------------------------------------------
    const sleeve = top === 'vest' ? shirt : jacket;
    const puff = open ? 0.046 : 0.037;
    // Hanging arms must clear the widest part of the top beside the hand
    const shoulderX = rTop + 0.016, reach = 0.27, handY = SHOULDER - 0.012 - reach;
    const clear = Math.max(rAt(handY), rAt(handY + 0.08)) + 0.034;
    this.splay = Math.max(0, Math.asin(Math.min(1, Math.max(0, clear - shoulderX) / reach)) - 0.12);
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * (rTop + 0.016), Y(SHOULDER) - 0.012, 0);
      add(shoulder, ball(puff, 10, 8), sleeve);
      add(shoulder, tube(puff, puff * 0.92, 0.13, 10), sleeve, 0, -0.065, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.13;
      add(elbow, ball(puff * 0.92, 8, 6), sleeve);
      add(elbow, tube(puff * 0.92, puff * 0.8, 0.11, 10), sleeve, 0, -0.055, 0);
      add(elbow, tube(puff * 0.82, puff * 0.82, 0.02, 10), open ? seam : trim, 0, -0.105, 0); // cuff
      // A mitten of a hand with a thumb
      add(elbow, ball(0.03, 12, 8), skinMat, 0, -0.136, 0, 0.88, 1.12, 0.92);
      add(elbow, ball(0.012, 8, 6), skinMat, 0, -0.124, 0.024, 1, 1.4, 1);
      shoulder.add(elbow);
      upper.add(shoulder);
      return { shoulder, elbow };
    });

    // ---- Head -----------------------------------------------------------------------------
    const head = this.head = new THREE.Group();
    head.position.y = Y(HEAD) - 0.012;
    head.scale.setScalar(0.88); // a little bigger than life, as anime draws it: about five heads tall
    upper.add(head);
    const R = 0.125;
    add(head, ball(R, 24, 18), skinMat, 0, 0, 0, 1, 0.97, 0.98);
    // A softer jaw: the chin tucks in a little
    add(head, ball(0.085, 16, 12), skinMat, 0, -0.06, 0.035, 1, 0.7, 0.9);
    // Ears, mostly hidden by hair
    for (const side of [-1, 1]) add(head, ball(0.024, 8, 6), skinMat, side * 0.122, -0.02, 0.005, 0.5, 1, 0.8);

    // ---- Face: eyes (shape from the look, openness from the mood), brows, mouth --------
    const shape = this.look.eyeShape;
    const dark = flat(0x2a1c22);
    const white = flat(0xffffff);
    const iris = flat(EYE_COLORS[eyes]);
    const irisDeep = flat(new THREE.Color(EYE_COLORS[eyes]).multiplyScalar(0.55));
    const lineGeo = new THREE.TorusGeometry(0.034, 0.0055, 5, 14, Math.PI * 0.82);
    // Per shape: [width, height, tilt at the outer corner, iris size]
    const EYE = { round: [1, 1, 0, 1], soft: [1.05, 1.1, -0.05, 1.12], sharp: [1.08, 0.74, 0.2, 0.9], sleepy: [1.02, 0.62, -0.08, 1], smiley: [1, 1, 0, 1] }[shape];
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      const ex = side * 0.046, ey = -0.008;
      eye.position.set(ex, ey, Math.sqrt(R * R - ex * ex - ey * ey) * 0.97);
      eye.rotation.y = side * 0.42;
      eye.scale.setScalar(0.74); // bright, but not the whole face
      head.add(eye);
      // The open eye squashes towards a line to blink
      const open = new THREE.Group();
      open.rotation.z = side * -EYE[2];
      open.scale.set(EYE[0], EYE[1], 1);
      eye.add(open);
      const disc = (r, material, x, y, z, sx = 1, sy = 1) => add(open, ball(r, 14, 10), material, x, y, z, sx, sy, 0.16);
      disc(0.0405, dark, 0, 0.005, -0.002, 1.04, 1.2); // lid line: a dark rim, thickest on top
      disc(0.036, white, 0, 0, 0, 1, 1.22);
      disc(0.029 * EYE[3], irisDeep, 0, -0.002, 0.003, 1, 1.3);
      disc(0.025 * EYE[3], iris, 0, -0.008, 0.005, 1, 1.15);
      disc(0.013 * EYE[3], dark, 0, 0, 0.007, 1, 1.35);
      disc(0.0095, white, side * 0.011, 0.017, 0.01);
      disc(0.005, white, side * -0.01, -0.016, 0.01);
      if (shape === 'sleepy') add(open, new THREE.BoxGeometry(0.085, 0.012, 0.004), dark, 0, 0.034, 0.004); // heavy lid
      // Lashes: a flick at the outer corner
      if (girl) add(open, new THREE.BoxGeometry(0.02, 0.006, 0.003), dark, side * 0.04, 0.036, 0.004).rotation.z = side * 0.55;
      // Closed: a happy arch (^) or a resting curve (‿)
      const arch = add(eye, lineGeo, dark, 0, -0.012, 0.004);
      arch.rotation.z = Math.PI * 0.09;
      const rest = add(eye, lineGeo, dark, 0, 0.022, 0.004, 1, 0.55, 1);
      rest.rotation.z = Math.PI + Math.PI * 0.09;
      // Brows sit on the head, not the eye, so they can move on their own
      const brow = add(head, new THREE.BoxGeometry(girl ? 0.032 : 0.04, girl ? 0.0055 : 0.0095, 0.004), hairMat, side * 0.047, 0.047, 0);
      brow.position.z = Math.sqrt(R * R - 0.047 ** 2 - 0.047 ** 2) + 0.002;
      brow.rotation.y = side * 0.42;
      this.eyes.push({ open, arch, rest, brow, side, base: EYE[1] });
      const cheek = add(head, ball(0.026, 10, 8), flat(0xff8f98, { transparent: true, opacity: 0.55 }), side * 0.083, -0.05, 0.088, 1, 0.6, 0.2);
      cheek.rotation.y = side * 0.75;
    }
    this.blinkT = 2 + Math.random() * 3;
    this.blink = 0;
    this.mood = null; // { name, t }: a passing feeling over the pose's own face
    // Mouths: one shows at a time
    const mz = 0.1235;
    const mouth = (geo, material, y, z = mz) => { const m = add(head, geo, material, 0, y, z); m.visible = false; return m; };
    const lip = flat(0x8a3a34);
    this.mouths = {
      smile: mouth(new THREE.TorusGeometry(0.014, 0.003, 4, 10, Math.PI), lip, -0.05),
      grin: mouth(new THREE.CircleGeometry(0.022, 14, Math.PI, Math.PI), flat(0xb2413c), -0.05),
      flat: mouth(new THREE.BoxGeometry(0.018, 0.0045, 0.002), lip, -0.058),
      o: mouth(new THREE.CircleGeometry(0.008, 10), flat(0xb2413c), -0.058),
      cat: mouth(new THREE.TorusGeometry(0.007, 0.0028, 4, 8, Math.PI), lip, -0.054),
    };
    this.mouths.smile.rotation.z = Math.PI;
    this.mouths.grin.add(new THREE.Mesh(new THREE.CircleGeometry(0.011, 10, Math.PI, Math.PI), flat(0xf08a8a)));
    this.mouths.grin.children[0].position.set(0, -0.008, 0.001);
    // The cat mouth (:3) is two small arcs
    this.mouths.cat.rotation.z = Math.PI;
    this.mouths.cat.position.x = -0.007;
    const cat2 = new THREE.Mesh(this.mouths.cat.geometry, lip);
    cat2.position.x = 0.014;
    this.mouths.cat.add(cat2);

    // Extras
    const extra = this.look.extra;
    if (extra === 'glasses') {
      const frame = flat(fit.trim === 0xffffff ? 0x5a3a2a : 0x5a3a2a);
      for (const side of [-1, 1]) {
        const ring = add(head, new THREE.TorusGeometry(0.03, 0.0045, 6, 20), frame, side * 0.046, -0.006, 0.124);
        ring.rotation.y = side * 0.4;
        ring.scale.y = 0.86;
        add(head, new THREE.BoxGeometry(0.004, 0.004, 0.09), frame, side * 0.112, 0.004, 0.06).rotation.y = side * 0.25;
      }
      add(head, new THREE.BoxGeometry(0.03, 0.004, 0.004), frame, 0, 0.002, 0.128);
    } else if (extra === 'freckles') {
      const dot = flat(0xb5703f);
      for (const side of [-1, 1]) for (const [dx, dy] of [[0.07, -0.03], [0.085, -0.04], [0.064, -0.045], [0.08, -0.025]]) {
        const d = add(head, new THREE.CircleGeometry(0.0035, 6), dot, side * dx, dy, 0);
        d.position.z = Math.sqrt(Math.max(0, R * R - dx * dx - dy * dy)) + 0.001;
        d.rotation.y = side * Math.asin(dx / R);
      }
    } else if (extra === 'plaster') {
      const p = add(head, new THREE.BoxGeometry(0.034, 0.014, 0.004), toon(0xf1d2a6), 0.075, -0.05, 0.1);
      p.rotation.set(0, 0.62, 0.35);
      for (const dx of [-0.006, 0.006]) add(p, new THREE.CircleGeometry(0.0018, 5), flat(0xc9a273), dx, 0, 0.0025);
    }

    // ---- Hair: a cap, a fringe, side locks, then the style ---------------------------
    const hat = fit.hat;
    const hatted = hat !== 'none' && hat !== 'bandana';
    const short = ['short', 'spiky', 'messy', 'parted', 'curly', 'buzz'].includes(hair);
    // Points on the scalp: elevation (0 = level with the eyes, up is +), angle round
    // from the front (+ to the left of the face as you look at it)
    const onScalp = (el, az, r = R + 0.012) => new THREE.Vector3(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    const tuft = (geo, at, out, s = [1, 1, 1]) => {
      const m = add(head, geo, hairMat, at.x, at.y, at.z, ...s);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out.clone().normalize());
      return m;
    };
    // (under a hat the crown is the hat's: only the fringe and the lengths show)
    if (!hatted) {
      const close = hair === 'buzz';
      const shell = add(head, new THREE.SphereGeometry(R + (close ? 0.007 : 0.02), 22, 14, 0, Math.PI * 2, 0, Math.PI * (close ? 0.52 : 0.6)), hairMat, 0, 0.006, close ? -0.004 : -0.01);
      shell.rotation.x = close ? -0.62 : -0.52;
    }
    if (hair !== 'curly') add(head, ball(R + (hair === 'buzz' ? 0.004 : 0.012), 16, 12), hairMat, 0, -0.016, -0.034, hair === 'buzz' ? 1.0 : 1.05, hatted ? 0.9 : hair === 'buzz' ? 0.92 : 1, 0.95); // back of the head
    const fringeY = hatted ? 0.066 : 0.09;
    const strand = (x, drop, lean, sy = 2.0, w = 0.95) => {
      const z = Math.sqrt(Math.max(0.001, (R + 0.012) ** 2 - x * x - 0.05 * 0.05));
      const s = add(head, ball(0.034, 10, 8), hairMat, x, fringeY - drop, z - 0.012, w, hatted ? Math.min(sy, 1.35) : sy, 0.46);
      s.rotation.set(-0.35, x * 4, lean);
      return s;
    };
    if (hair === 'parted') {
      // Swept across from a side parting: one big lock and a shorter one
      const sweep = add(head, ball(0.06, 14, 10), hairMat, 0.025, fringeY - 0.006, 0.09, 1.75, hatted ? 0.6 : 0.85, 0.55);
      sweep.rotation.set(-0.5, 0.12, -0.38);
      if (!hatted) {
        // Lifted on the parting side, and a line where it parts
        add(head, ball(0.055, 12, 8), hairMat, -0.055, 0.1, 0.05, 1.1, 0.8, 1.2);
        const part = add(head, new THREE.BoxGeometry(0.004, 0.003, 0.08), flat(new THREE.Color(HAIR_COLORS[hairColor]).multiplyScalar(0.6)), -0.03, R + 0.016, 0.0);
        part.rotation.x = -0.25;
      }
      strand(-0.085, 0.03, 0.45, 1.6);
      strand(0.1, 0.035, -0.5, 1.7);
    } else if (hair === 'spiky') {
      for (const [x, drop, lean] of [[-0.075, 0.02, 0.45], [-0.035, 0.03, 0.15], [0.005, 0.035, -0.05], [0.045, 0.028, -0.25], [0.085, 0.02, -0.5]]) {
        const z = Math.sqrt(Math.max(0.001, (R + 0.012) ** 2 - x * x - 0.04 * 0.04));
        const c = add(head, new THREE.ConeGeometry(0.026, 0.075, 6), hairMat, x, fringeY - drop - 0.01, z - 0.006);
        c.rotation.set(Math.PI - 0.4, 0, lean);
      }
    } else if (hair === 'curly') {
      for (const [x, drop] of [[-0.08, 0.035], [-0.04, 0.022], [0, 0.018], [0.04, 0.022], [0.08, 0.035]]) {
        const z = Math.sqrt(Math.max(0.001, (R + 0.01) ** 2 - x * x - 0.05 * 0.05));
        add(head, ball(0.03, 10, 8), hairMat, x, fringeY - drop + 0.012, z - 0.012, 1, 1, 0.8);
      }
    } else if (hair === 'buzz') {
      // Just a hairline
      const line = add(head, new THREE.TorusGeometry(0.075, 0.012, 5, 16, Math.PI), hairMat, 0, 0.072, 0.07, 1, 0.5, 1);
      line.rotation.x = -0.75;
    } else {
      const messy = hair === 'messy';
      const strands = messy
        ? [[-0.09, 0.02, 0.7], [-0.05, 0.035, 0.35], [-0.012, 0.01, -0.3], [0.028, 0.035, 0.1], [0.066, 0.015, -0.6], [0.1, 0.04, -0.85]]
        : [[-0.088, 0.03, 0.5], [-0.052, 0.022, 0.2], [-0.012, 0.012, -0.1], [0.03, 0.022, -0.25], [0.07, 0.03, -0.45], [0.1, 0.04, -0.6]];
      for (const [x, drop, lean] of strands) strand(x, drop, lean, messy ? 1.7 : 2.0);
    }
    const long = hair === 'long' || hair === 'twintails';
    for (const side of [-1, 1]) {
      // Locks framing the face (short cuts get sideburns)
      if (hair === 'buzz') { add(head, ball(0.02, 8, 6), hairMat, side * 0.118, -0.0, 0.03, 0.5, 1.6, 0.8); continue; }
      if (hair === 'curly') continue;
      const lock = add(head, ball(0.034, 10, 8), hairMat, side * 0.118, long ? -0.075 : short ? -0.02 : -0.035, 0.04, 0.6, long ? 3.8 : short ? 1.7 : 2.4, 0.9);
      lock.rotation.z = side * -0.06;
    }
    if (hair === 'spiky' && !hatted) {
      // Spikes over the crown and down the back, pointing out from the scalp
      for (const [el, az, len] of [[1.2, 0, 1.1], [0.95, 0.6, 1], [0.95, -0.6, 1], [0.75, 1.3, 0.9], [0.75, -1.3, 0.9], [0.8, 2.2, 1.1], [0.8, -2.2, 1.1], [0.9, Math.PI, 1.2], [0.4, 2.5, 1.1], [0.4, -2.5, 1.1], [0.35, Math.PI, 1.15], [0.05, 2.7, 0.9], [0.05, -2.7, 0.9]]) {
        const p = onScalp(el, az, R + 0.005);
        // Swept back and down the head, the way gel would have it
        const back = Math.abs(az) > 1.5;
        const out = p.clone().normalize().add(new THREE.Vector3(0, back ? -0.45 : -0.15, back ? -0.9 : -0.55)).normalize();
        tuft(new THREE.ConeGeometry(0.044, 0.1 * len, 6), p.addScaledVector(out, 0.035), out);
      }
    }
    if (hair === 'messy' && !hatted) {
      for (const [el, az, tilt] of [[1.3, 0.4, 0.9], [1.05, -0.9, -0.8], [0.95, 1.2, 1.0], [0.75, 2.3, 0.6], [0.8, -2.2, -0.7], [0.5, Math.PI, 0.3], [1.15, -2.9, -0.4], [0.9, 2.9, 0.5], [1.35, -0.3, -1.2]]) {
        const p = onScalp(el, az, R + 0.012);
        // Mostly along the scalp (down and back), lifted a little at the tip
        const n = p.clone().normalize();
        const along = new THREE.Vector3(Math.sin(az + tilt), -0.6, Math.cos(az + tilt) - 0.6).projectOnPlane(n).normalize();
        const out = along.multiplyScalar(0.8).addScaledVector(n, 0.55).normalize();
        tuft(ball(0.034, 8, 6), p.addScaledVector(out, 0.022), out, [1.2, 2.0, 0.5]);
      }
    }
    if (hair === 'curly') {
      // A head of soft curls spread evenly over the cap (a golden-angle spiral)
      const n = hatted ? 0 : 46;
      for (let i = 0; i < n; i++) {
        const y = 1 - ((i + 0.5) / n) * 1.25, az = i * 2.39996;
        if (y < 0.5 && Math.cos(az) > 0.25) continue; // keep the face clear
        const el = Math.asin(Math.max(-1, Math.min(1, y)));
        const p = onScalp(el, az, R + 0.022);
        add(head, ball(0.03, 8, 6), hairMat, p.x, p.y, p.z);
      }
      for (const side of [-1, 1]) for (const y of [0.0, -0.05]) add(head, ball(0.03, 8, 6), hairMat, side * 0.118, y, -0.02);
      if (hatted) for (let i = 0; i < 9; i++) { const p = onScalp(-0.15, Math.PI / 2 + i * (Math.PI / 8), R + 0.012); add(head, ball(0.032, 8, 6), hairMat, p.x, p.y, p.z); }
      for (let i = 0; i < 7; i++) { const p = onScalp(-0.45, Math.PI * 0.62 + i * 0.25, R + 0.01); add(head, ball(0.032, 8, 6), hairMat, p.x, p.y, p.z); }
    }
    if (hair === 'bob') {
      add(head, ball(R, 16, 12), hairMat, 0, -0.045, -0.025, 1.12, 0.95, 0.95);
      // The ends turn in under the jaw
      for (const side of [-1, 1]) add(head, ball(0.04, 10, 8), hairMat, side * 0.115, -0.1, 0.02, 0.7, 0.9, 1.4).rotation.y = side * 0.3;
    }
    if (hair === 'bun') {
      if (hatted) add(head, ball(0.05, 10, 8), hairMat, 0, -0.07, -0.125);
      else { add(head, ball(0.062, 12, 10), hairMat, 0, 0.15, -0.03); add(head, new THREE.TorusGeometry(0.03, 0.01, 5, 10), trim, 0, 0.115, -0.025).rotation.x = Math.PI / 2; }
    }
    if (hair === 'long') {
      // A fall of hair down the back that ends in soft points, not one blob
      add(head, ball(0.1, 14, 12), hairMat, 0, -0.12, -0.085, 1.12, 1.8, 0.5);
      for (const [x, len, tilt] of [[-0.075, 3.9, 0.1], [-0.026, 4.5, 0.03], [0.026, 4.3, -0.03], [0.075, 3.8, -0.1]]) {
        add(head, ball(0.04, 10, 8), hairMat, x, -0.24, -0.1, 1, len, 0.55).rotation.z = tilt;
      }
      for (const side of [-1, 1]) add(head, ball(0.04, 10, 8), hairMat, side * 0.09, -0.2, -0.05, 0.8, 3.6, 0.7).rotation.z = side * 0.08;
    }
    if (hair === 'short' || hair === 'bun' || hair === 'ponytail' || hair === 'spiky' || hair === 'messy' || hair === 'parted') {
      // A tidy nape: two little points at the back of the neck
      for (const side of [-1, 1]) add(head, ball(0.03, 8, 6), hairMat, side * 0.035, -0.105, -0.1, 1, 1.8, 0.7).rotation.z = side * 0.15;
    }
    if (hair === 'twintails') {
      for (const side of [-1, 1]) {
        // Tied high and behind the ears, falling behind the shoulders
        const tail = add(head, ball(0.045, 10, 8), hairMat, side * 0.15, -0.15, -0.075, 0.8, 3.3, 0.8);
        tail.rotation.set(0.3, 0, side * 0.14);
        add(head, ball(0.022, 6, 6), trim, side * 0.12, -0.005, -0.07);
      }
    }
    if (hair === 'ponytail') {
      // Tied at the back of the crown, hanging down the back
      add(head, ball(0.045, 10, 8), hairMat, 0, -0.1, -0.155, 0.85, 3.0, 0.75).rotation.x = -0.08;
      add(head, ball(0.022, 6, 6), trim, 0, 0.03, -0.135);
    }

    // ---- A crown, for whoever won the last hole's contest (hidden until then) -------
    const crown = this.crown = new THREE.Group();
    const gold = toon(0xffd23f);
    crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.05, 10, 1, true), toon(0xffd23f, { side: THREE.DoubleSide })));
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 4), gold);
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.07, 0.05, Math.sin(a) * 0.07);
      crown.add(spike);
    }
    crown.position.set(0, hat === 'none' || hat === 'bandana' ? 0.17 : 0.2, -0.01);
    crown.rotation.z = 0.12;
    crown.visible = !!this.crowned;
    head.add(crown);

    // ---- Hats ---------------------------------------------------------------------------
    const hatMat = toon(fit.hatColor ?? fit.trim);
    const dome = (sy = 1, len = 0.5) => {
      const d = add(head, new THREE.SphereGeometry(R + 0.03, 22, 12, 0, Math.PI * 2, 0, Math.PI * len), hatMat, 0, 0.02, -0.008, 1, sy, 1);
      d.rotation.x = -0.2;
      return d;
    };
    if (hat === 'beanie' || hat === 'pom' || hat === 'earflap') {
      dome(1.18);
      const cuff = add(head, tube(R + 0.036, R + 0.036, 0.05, 22, true), toon(fit.hatColor ?? fit.trim, { side: THREE.DoubleSide }), 0, 0.04, -0.006);
      cuff.rotation.x = -0.2;
      if (hat === 'pom') add(head, ball(0.038, 10, 8), trim, 0, 0.19, -0.04);
      if (hat === 'earflap') for (const side of [-1, 1]) add(head, ball(0.04, 8, 8), hatMat, side * 0.152, -0.03, -0.02, 0.45, 1.6, 1);
    } else if (hat === 'cap' || hat === 'flat') {
      dome(hat === 'flat' ? 0.72 : 1, 0.46);
      add(head, tube(0.085, 0.085, 0.012, 16), hatMat, 0, 0.058, 0.135, 1, 1, 0.85).rotation.x = 0.12;
    } else if (hat === 'bucket') {
      dome(1, 0.46);
      add(head, tube(R + 0.03, R + 0.085, 0.045, 22, true), toon(fit.hatColor, { side: THREE.DoubleSide }), 0, 0.045, -0.008).rotation.x = -0.12;
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
    // Arms that hang by the sides keep clear of a wide coat
    const hangL = Math.max(0, Math.cos(alx)) * Math.max(0, 1 - Math.abs(alz) / 0.6);
    const hangR = Math.max(0, Math.cos(arx)) * Math.max(0, 1 - Math.abs(arz) / 0.6);
    alz -= this.splay * hangL; arz += this.splay * hangR;
    const [L, Rr] = this.arms;
    L.shoulder.rotation.set(alx, 0, alz); L.elbow.rotation.x = ale;
    Rr.shoulder.rotation.set(arx, 0, arz); Rr.elbow.rotation.x = are;
    // Skirts and coat tails hang with the thighs, not the leaning body: they
    // drop straight when bending over and swing forward over the knees to sit
    const thigh = Math.min(0, (llh + lrh) / 2);
    for (const d of this.drapes) d.rotation.x = (d.userData.front ? thigh * 0.85 : Math.max(-0.3, thigh * 0.15)) - lean;
    this.legs[0].hip.rotation.x = llh; this.legs[0].knee.rotation.x = llk;
    this.legs[1].hip.rotation.x = lrh; this.legs[1].knee.rotation.x = lrk;
    this.rig.position.y = bob - drop;
    // The swing turns the shoulders; the head stays on the ball until it has gone
    const addr = pose === 'address';
    this.upper.rotation.set(lean, addr ? -this.twist * 0.5 : 0, 0);
    this.head.rotation.set(addr ? 0.15 : 0, addr ? this.twist * 0.35 : 0, tilt);
    this.face(dt, pose);
  }

  /** A passing feeling for a few seconds: joy | oops | focus | calm | cheeky */
  feel(name, seconds = 1.5) { if (FACES[name]) this.mood = { name, t: seconds }; }

  face(dt, pose) {
    if (!this.eyes) return;
    if (this.mood) { this.mood.t -= dt; if (this.mood.t <= 0) this.mood = null; }
    const name = this.mood?.name || POSE_FACE[pose] || 'neutral';
    const f = FACES[name];
    // A blink every few seconds
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.14; this.blinkT = 2.2 + Math.random() * 3.6; }
    this.blink = Math.max(0, this.blink - dt);
    // Smiley eyes are happy arches unless something is up
    const smiley = this.look.eyeShape === 'smiley' && name !== 'oops' && name !== 'focus';
    const want = smiley ? 0 : f.open;
    this.openK = (this.openK ?? want) + (want - (this.openK ?? want)) * Math.min(1, dt * 14);
    const k = Math.min(1, dt * 12);
    for (const e of this.eyes) {
      // The cheeky face winks the left eye
      const wink = f.wink && e.side < 0;
      const shut = this.blink > 0 || wink;
      const o = shut ? 0 : this.openK;
      e.open.scale.y = e.base * Math.max(0.05, o);
      e.open.visible = o > 0.12;
      e.arch.visible = !e.open.visible && (want === 0 || wink) && !(this.blink > 0 && want !== 0);
      e.rest.visible = !e.open.visible && !e.arch.visible;
      const [lift, drop] = f.brow;
      e.brow.position.y += ((0.047 + lift) - e.brow.position.y) * k;
      e.brow.rotation.z += (e.side * drop - e.brow.rotation.z) * k;
    }
    for (const [key, m] of Object.entries(this.mouths)) m.visible = key === f.mouth;
  }
}

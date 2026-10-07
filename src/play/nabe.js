/**
 * Nabe — a hot pot on the campfire at the end of the round.
 *
 * Whatever you foraged on the course (and any fish you caught) goes in, with
 * camp staples so there is always something to cook. Tap an ingredient to
 * drop it in. The fire keeps heating the pot; stir with your finger (any
 * circling drag) to keep it at a simmer. Let it roar and it boils over —
 * messy, not ruinous: nothing is ever lost, it just tastes less good. When
 * enough is cooked, EAT, and everyone round the fire (and Kuri) tucks in.
 *
 * With friends the pot is shared: what anyone drops in goes in everyone's
 * pot, and anyone stirring helps.
 *
 * The 3D pot sits on the campfire; the tray, the heat gauge and the EAT button
 * are DOM, made here.
 */

import * as THREE from 'three';
import { KINDS as MUSH, mushroomMesh } from './forage.js';
import { onPress } from '../ui/press.js';

export const STAPLES = { tofu: 'Tofu', negi: 'Negi', cabbage: 'Cabbage' };
const LABEL = { ...STAPLES, fish: 'Fish', ...Object.fromEntries(Object.entries(MUSH).map(([k, v]) => [k, v.name])) };

export const POT = {
  HEAT: 0.075,        // per second from the fire
  PER_PIECE: 0.004,   // a full pot heats a little faster
  STIR_COOL: 1.1,     // per screen-width of stirring
  LO: 0.45, HI: 0.8,  // the simmer
  BOIL: 0.88,         // above this it boils over
  COOK: 0.2,          // cook progress per second while hot enough
};

const ICONS = {
  tofu: '<rect x="5" y="7" width="14" height="11" rx="2" fill="#fbf6ea" stroke="#12261a" stroke-width="1.8"/>',
  negi: '<rect x="4" y="9" width="16" height="6" rx="3" fill="#e9f3d0" stroke="#12261a" stroke-width="1.8"/><rect x="13" y="9" width="7" height="6" rx="3" fill="#6fb84a" stroke="#12261a" stroke-width="1.8"/>',
  cabbage: '<path d="M4 15c2-8 14-8 16 0-5 3-11 3-16 0z" fill="#cfe9a5" stroke="#12261a" stroke-width="1.8"/><path d="M12 9v7" stroke="#12261a" stroke-width="1.2"/>',
  fish: '<path d="M3 12c4-5 10-5 14 0-4 5-10 5-14 0z" fill="#f0a58e" stroke="#12261a" stroke-width="1.8"/><path d="M17 12l4-3v6z" fill="#f0a58e" stroke="#12261a" stroke-width="1.6"/>',
  shiitake: '<path d="M4 13a8 6 0 0 1 16 0z" fill="#8a5a3a" stroke="#12261a" stroke-width="1.8"/><path d="M10 13v5h4v-5" fill="#f3e7d3" stroke="#12261a" stroke-width="1.6"/>',
  shimeji: '<g fill="#c9a77c" stroke="#12261a" stroke-width="1.5"><circle cx="8" cy="9" r="3"/><circle cx="15" cy="8" r="3"/><circle cx="12" cy="12" r="3"/></g><path d="M8 12v7M15 11v8M12 15v4" stroke="#12261a" stroke-width="1.6"/>',
  golden: '<path d="M5 8h14l-5 6v5h-4v-5z" fill="#f2b630" stroke="#12261a" stroke-width="1.8" stroke-linejoin="round"/>',
  glowcap: '<path d="M6 13a6 7 0 0 1 12 0z" fill="#5fd4ff" stroke="#12261a" stroke-width="1.8"/><path d="M11 13v6h2v-6" fill="#d8f6ff" stroke="#12261a" stroke-width="1.4"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24">${ICONS[k] || ''}</svg>`;

let ramp = null;
const toon = (color) => {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp });
};

/** Grade a finished pot. Pure, so it can be tested. */
export function gradePot({ cooked, kinds, simmer, boils }) {
  let stars = 0;
  if (cooked >= 3) stars = 1;
  if (stars && simmer >= 0.6 && boils <= 1) stars = 2;
  if (stars === 2 && kinds >= 2) stars = 3;
  return stars;
}

export class Nabe {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.visible = false;
    game.scene.add(this.group);
    this.build();
    this.pieces = [];
    this.active = false;   // the pot is on the fire
    this.cooking = false;  // the hot pot screen is open
    this.hud = document.createElement('div');
    this.hud.className = 'nabe hidden';
    game.hud.root.insertBefore(this.hud, game.hud.layer);
    onPress(this.hud, '[data-k], [data-a]', (el) => {
      if (el.dataset.k) { this.add(el.dataset.k); return; }
      if (el.dataset.a === 'back') { this.g.audio.tap(); this.close(); this.back?.(); }
      if (el.dataset.a === 'eat') this.g.eatNabe();
    });
    this.reset();
  }

  build() {
    const g = this.group;
    // A donabe: wide clay pot, glazed dark brown, cream rim
    const pts = [[0, 0], [0.2, 0], [0.29, 0.04], [0.34, 0.12], [0.345, 0.2], [0.33, 0.25], [0.315, 0.25]].map(([x, y]) => new THREE.Vector2(x, y));
    const pot = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), toon(0x5c3a2a));
    pot.material.side = THREE.DoubleSide;
    pot.castShadow = true;
    g.add(pot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.022, 6, 28), toon(0xeadcc0));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.25;
    g.add(rim);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 5, 10, Math.PI), toon(0x5c3a2a));
      ear.position.set(s * 0.355, 0.2, 0);
      ear.rotation.set(0, Math.PI / 2, s * Math.PI / 2);
      g.add(ear);
    }
    // The broth
    this.brothMat = new THREE.MeshLambertMaterial({ color: 0xe9b866, emissive: 0x000000 });
    this.broth = new THREE.Mesh(new THREE.CircleGeometry(0.31, 24), this.brothMat);
    this.broth.rotation.x = -Math.PI / 2;
    this.broth.position.y = 0.21;
    g.add(this.broth);
    // Foam for a boil-over
    this.foam = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xfffaf0 }));
    this.foam.position.y = 0.2;
    this.foam.scale.y = 0.01;
    g.add(this.foam);
    // Bubbles and steam: small pools reused
    this.bubbles = [];
    const bubbleMat = new THREE.MeshLambertMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), bubbleMat);
      b.visible = false;
      b.userData = { t: Math.random(), x: 0, z: 0 };
      g.add(b);
      this.bubbles.push(b);
    }
    this.steam = [];
    const steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), steamMat);
      s.userData.t = i / 6;
      g.add(s);
      this.steam.push(s);
    }
  }

  reset() {
    for (const p of this.pieces) this.group.remove(p.mesh);
    this.pieces = [];
    this.heat = 0.25;
    this.time = 0;
    this.inBand = 0;
    this.boils = 0;
    this.boiling = false;
    this.stirred = 0;
    this.spin = 0;
    this.done = null;
    this.added = {};
  }

  /** What there is to put in: staples plus the round's haul. */
  pantry() {
    const r = this.g.round || {};
    const left = (k, n) => Math.max(0, n - (this.added[k] || 0));
    const list = [];
    for (const k of Object.keys(STAPLES)) list.push([k, left(k, 2)]);
    if (r.fishTotal) list.push(['fish', left('fish', Math.min(4, r.fishTotal))]);
    for (const k of Object.keys(MUSH)) if (r.basket?.[k]) list.push([k, left(k, r.basket[k])]);
    return list;
  }

  /** Put the pot on the campfire (at the end of the round, or when a friend starts one). */
  place() {
    const site = this.g.grill.group;
    if (!site.visible) return false;
    this.group.position.set(site.position.x, site.position.y + 0.3, site.position.z);
    this.group.visible = true;
    this.active = true;
    return true;
  }

  /** Open the hot pot screen. back() returns to the summary. */
  open(back) {
    if (!this.active) { this.reset(); if (!this.place()) return; }
    this.back = back;
    this.cooking = true;
    this.renderHud();
    this.hud.classList.remove('hidden');
  }

  close() {
    this.cooking = false;
    this.hud.classList.add('hidden');
  }

  /** Put the pot away (a new round). */
  stop() {
    this.close();
    this.active = false;
    this.group.visible = false;
    this.reset();
  }

  /** Drop an ingredient in. from: a friend's name, or null for me. */
  add(kind, from = null) {
    if (!LABEL[kind]) return;
    if (!this.active && !this.place()) return;
    if (this.done) return;
    if (!from) {
      const have = this.pantry().find(([k]) => k === kind);
      if (!have || have[1] <= 0) return;
      this.added[kind] = (this.added[kind] || 0) + 1;
      this.g.net?.potAdd(kind);
    } else {
      this.g.hud.callout(`${from}: + ${LABEL[kind].toUpperCase()}`, 'small');
    }
    const mesh = this.pieceMesh(kind);
    const n = this.pieces.length;
    const a = n * 2.399, r = 0.07 + 0.17 * Math.sqrt((n % 12) / 12);
    const piece = { kind, mesh, a, r, cook: 0, drop: 0.45, from };
    mesh.position.set(Math.cos(a) * r, 0.75, Math.sin(a) * r);
    this.group.add(mesh);
    this.pieces.push(piece);
    this.g.audio.plop?.();
    if (this.cooking) this.renderHud();
  }

  pieceMesh(kind) {
    let m;
    if (MUSH[kind]) { m = mushroomMesh(kind); m.scale.setScalar(0.42); return m; }
    if (kind === 'tofu') {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.09), toon(0xfbf6ea));
    } else if (kind === 'negi') {
      m = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.035, 8), toon(i ? 0xe9f3d0 : 0x6fb84a));
        c.rotation.z = Math.PI / 2;
        c.position.x = i * 0.04 - 0.04;
        m.add(c);
      }
    } else if (kind === 'cabbage') {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 3), toon(0xcfe9a5));
      m.material.side = THREE.DoubleSide;
    } else {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 5), toon(0xf0a58e));
      m.scale.set(1, 0.35, 0.6);
    }
    return m;
  }

  /** A stirring drag: px moved, as a fraction of the screen width. */
  stir(amount) {
    if (!this.active || this.done) return;
    this.heat = Math.max(0.15, this.heat - amount * POT.STIR_COOL);
    this.spin += amount * 6;
    this.stirred += amount;
    this.g.net?.potStir(amount);
  }

  /** A friend stirred their side of the pot. */
  friendStir(amount) { if (this.active && !this.done) { this.heat = Math.max(0.15, this.heat - amount * POT.STIR_COOL); this.spin += amount * 6; } }

  get cookedCount() { return this.pieces.filter((p) => p.cook >= 1).length; }

  eat() {
    if (!this.cooking || this.done || this.cookedCount < 3) return;
    const cooked = this.pieces.filter((p) => p.cook >= 1);
    const kinds = new Set(cooked.filter((p) => MUSH[p.kind]).map((p) => p.kind)).size;
    const simmer = this.time > 0 ? this.inBand / this.time : 0;
    const stars = gradePot({ cooked: cooked.length, kinds, simmer, boils: this.boils });
    this.done = { stars, cooked: cooked.length, kinds, simmer, glow: cooked.some((p) => p.kind === 'glowcap'), gold: cooked.some((p) => p.kind === 'golden') };
    this.g.net?.potEat?.(stars);
    return this.done;
  }

  renderHud() {
    const items = this.pantry();
    this.hud.innerHTML = `
      <div class="nabe-gauge"><div class="track"><i class="band" style="left:${POT.LO * 100}%;width:${(POT.HI - POT.LO) * 100}%"></i><i class="boil" style="left:${POT.BOIL * 100}%"></i><b class="mark"></b></div><span class="label">SIMMER</span></div>
      <div class="nabe-cue">STIR WITH YOUR FINGER</div>
      <div class="nabe-tray">${items.map(([k, n]) => `<button data-k="${k}" ${n <= 0 ? 'disabled' : ''}>${icon(k)}<small>${n}</small></button>`).join('')}</div>
      <div class="btn-row"><button class="btn ghost" data-a="back">BACK</button><button class="btn" data-a="eat" disabled>EAT · <span class="cooked">0</span>/3</button></div>`;
    this.mark = this.hud.querySelector('.mark');
    this.eatBtn = this.hud.querySelector('[data-a="eat"]');
    this.cookedEl = this.hud.querySelector('.cooked');
    this.gaugeEl = this.hud.querySelector('.nabe-gauge');
  }

  update(dt) {
    if (!this.active) return;
    const t = (this.g.time || 0);
    // Heat: the fire never stops; stirring holds it back
    if (!this.done) {
      this.heat = Math.min(1, this.heat + (POT.HEAT + POT.PER_PIECE * this.pieces.length) * dt);
      if (this.pieces.length) {
        this.time += dt;
        if (this.heat >= POT.LO && this.heat <= POT.HI) this.inBand += dt;
      }
      const boiling = this.heat > POT.BOIL;
      if (boiling && !this.boiling) { this.boils += 1; this.g.audio.sizzle?.(); if (this.cooking) this.g.hud.callout('BOILING OVER! STIR!', 'bad small'); }
      this.boiling = boiling;
      for (const p of this.pieces) if (this.heat > 0.4) p.cook = Math.min(1.2, p.cook + POT.COOK * (this.heat <= POT.HI ? 1.25 : 1) * dt);
    }
    this.spin *= Math.exp(-dt * 1.5);
    // Pieces: drop in, then bob and drift round with the stirring
    for (const p of this.pieces) {
      p.a += (0.15 + this.spin) * dt;
      p.drop = Math.max(0, p.drop - dt * 1.6);
      const y = 0.215 + p.drop * p.drop * 2.4 + Math.sin(t * 3 + p.a * 3) * 0.006;
      p.mesh.position.set(Math.cos(p.a) * p.r, y, Math.sin(p.a) * p.r);
      p.mesh.rotation.y = p.a;
      const k = Math.min(1, p.cook);
      if (p.kind === 'tofu' || p.kind === 'cabbage') p.mesh.scale.setScalar(1 - 0.12 * k);
    }
    // Broth: richer with more in it; blue and glowing with a glowcap
    const glow = this.pieces.some((p) => p.kind === 'glowcap');
    const rich = Math.min(1, this.pieces.length / 9);
    this.brothMat.color.setHex(glow ? 0x7fd8ff : 0xe9b866).lerp(new THREE.Color(glow ? 0x3fa8e0 : 0xc0782e), rich * 0.6);
    this.brothMat.emissive.copy(this.brothMat.color).multiplyScalar(glow ? 0.55 : 0.15 + this.g.sky.night * 0.25);
    // Bubbles and foam with the heat
    const boil = Math.max(0, (this.heat - 0.35) / 0.65);
    this.bubbles.forEach((b, i) => {
      const u = b.userData;
      u.t += dt * (1 + boil * 3);
      if (u.t > 1) { u.t = 0; const a = Math.random() * 6.28, r = Math.random() * 0.26; u.x = Math.cos(a) * r; u.z = Math.sin(a) * r; }
      b.visible = i < boil * this.bubbles.length;
      b.position.set(u.x, 0.215, u.z);
      b.scale.setScalar(0.4 + u.t * 1.2);
    });
    const foam = this.boiling ? Math.min(1, (this.heat - POT.BOIL) / 0.1) : 0;
    this.foam.scale.y += ((0.01 + foam * 0.5) - this.foam.scale.y) * Math.min(1, dt * 4);
    this.foam.visible = this.foam.scale.y > 0.03;
    this.steam.forEach((s, i) => {
      const u = s.userData;
      u.t = (u.t + dt * (0.3 + boil * 0.5)) % 1;
      s.position.set(Math.sin(i * 2.1 + t) * 0.1, 0.3 + u.t * 0.9, Math.cos(i * 1.3) * 0.08);
      s.scale.setScalar((0.6 + u.t * 1.6) * (0.3 + boil));
      s.visible = boil > 0.05;
    });
    // HUD
    if (this.cooking && this.mark) {
      this.mark.style.left = `${this.heat * 100}%`;
      this.gaugeEl.classList.toggle('hot', this.heat > POT.BOIL);
      this.gaugeEl.classList.toggle('ok', this.heat >= POT.LO && this.heat <= POT.HI);
      const n = this.cookedCount;
      this.cookedEl.textContent = n;
      this.eatBtn.disabled = n < 3 || !!this.done;
    }
  }
}

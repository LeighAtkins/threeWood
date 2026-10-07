/**
 * Foraging — wild mushrooms at the edges of every hole.
 *
 * A handful grow in the rough beside the fairway, a different handful each
 * hole. When your ball stops near one a little sparkle marks it (and Kuri, if
 * she is with you, goes and sniffs at it); tap it and she fetches it to your
 * basket. After dark a fourth kind glows blue. Whatever you gather goes into
 * the hot pot at the campfire after the round (play/nabe.js).
 *
 * It costs nothing and scores nothing on the hole: it is something for the
 * walk between shots.
 */

import * as THREE from 'three';
import { createGameRng } from '../core/rng.js';
import { pathLength, pointAlongPath } from '../course/shapes.js';

export const KINDS = {
  shiitake: { name: 'Shiitake', cap: 0x8a5a3a, spots: 0xf1dfc4, stem: 0xf3e7d3, shape: 'flat' },
  shimeji:  { name: 'Shimeji', cap: 0xc9a77c, stem: 0xf6eee2, shape: 'cluster' },
  golden:   { name: 'Golden Chanterelle', cap: 0xf2b630, stem: 0xf7d36a, shape: 'funnel', rare: true },
  glowcap:  { name: 'Glowcap', cap: 0x5fd4ff, stem: 0xd8f6ff, shape: 'bell', glow: true },
};
export const KIND_IDS = Object.keys(KINDS);

const REACH = 34;       // metres from the ball: close enough to send her for it
const SIZE = 1.7;       // drawn large enough to see from the aiming camera

// One small mushroom kit, shared
const GEO = {
  cap: new THREE.SphereGeometry(0.16, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2),
  funnel: new THREE.ConeGeometry(0.15, 0.13, 10, 1, true),
  bell: new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
  stem: new THREE.CylinderGeometry(0.045, 0.06, 0.18, 7),
  spot: new THREE.SphereGeometry(0.03, 6, 4),
  small: new THREE.SphereGeometry(0.06, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  thin: new THREE.CylinderGeometry(0.02, 0.025, 0.2, 5),
};
const mats = new Map();
function mat(color, glow = false) {
  const key = `${color}:${glow}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, emissive: glow ? color : 0x000000, emissiveIntensity: glow ? 0.9 : 0 }));
  return mats.get(key);
}

/** A mushroom (or a little clump of them) of a kind, feet at y = 0. */
export function mushroomMesh(kind) {
  const k = KINDS[kind];
  const g = new THREE.Group();
  const cap = mat(k.cap, k.glow), stem = mat(k.stem, k.glow);
  const one = (x, z, s, tilt) => {
    const m = new THREE.Group();
    m.position.set(x, 0, z);
    m.rotation.z = tilt;
    m.scale.setScalar(s);
    if (k.shape === 'cluster') {
      const st = new THREE.Mesh(GEO.thin, stem); st.position.y = 0.1; m.add(st);
      const c = new THREE.Mesh(GEO.small, cap); c.position.y = 0.19; c.scale.y = 0.8; m.add(c);
    } else {
      const st = new THREE.Mesh(GEO.stem, stem); st.position.y = 0.09; m.add(st);
      let c;
      if (k.shape === 'funnel') { c = new THREE.Mesh(GEO.funnel, cap); c.rotation.x = Math.PI; c.position.y = 0.22; }
      else if (k.shape === 'bell') { c = new THREE.Mesh(GEO.bell, cap); c.position.y = 0.14; c.scale.y = 1.3; }
      else { c = new THREE.Mesh(GEO.cap, cap); c.position.y = 0.16; c.scale.y = 0.55; }
      m.add(c);
      if (k.spots) {
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7, s2 = new THREE.Mesh(GEO.spot, mat(k.spots));
          s2.position.set(Math.cos(a) * 0.09, 0.22, Math.sin(a) * 0.09);
          s2.scale.y = 0.4;
          m.add(s2);
        }
      }
    }
    g.add(m);
  };
  if (k.shape === 'cluster') {
    for (let i = 0; i < 6; i++) one(Math.cos(i * 2.4) * 0.07 * (i % 3), Math.sin(i * 2.4) * 0.07 * (i % 3), 0.8 + (i % 3) * 0.2, (Math.random() - 0.5) * 0.4);
  } else {
    one(0, 0, 1, 0.08);
    one(0.15, 0.06, 0.6, -0.25);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Forage {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.items = [];
    this.marks = document.createElement('div');
    this.marks.className = 'forage-marks';
    game.hud.root.insertBefore(this.marks, game.hud.layer);
    this.chip = document.createElement('div');
    this.chip.className = 'pill basket hidden';
    game.hud.points.after(this.chip); // under the points
    this._v = new THREE.Vector3();
  }

  /** The round's basket: counts by kind. */
  get basket() {
    const r = this.g.round;
    if (!r) return {};
    r.basket ||= {};
    return r.basket;
  }

  get total() { return Object.values(this.basket).reduce((a, b) => a + b, 0); }

  clear() {
    for (const it of this.items) { this.group.remove(it.mesh); it.mark.remove(); }
    this.items = [];
  }

  /** Grow this hole's mushrooms (the same ones for everyone on the course). */
  atHole() {
    this.clear();
    const { world, round } = this.g;
    if (!round) return;
    const r = createGameRng(`${round.seed}:forage:${round.index}`);
    const path = world.spec.path;
    const len = pathLength(path);
    const n = r.int(5, 7);
    const picked = round.picked?.[round.index] || [];
    let tries = 0;
    while (this.items.length < n && tries++ < 80) {
      const d = r.range(0.12, 0.88) * len;
      const p = pointAlongPath(path, d);
      const half = world.fairwayHalfAt(d);
      const side = r.sign() * r.range(half + 3, half + 13);
      const x = p.x - p.dirZ * side, z = p.z + p.dirX * side;
      const surface = world.surfaceAt(x, z);
      if (surface !== 'rough') continue;
      if (Math.abs(x) > world.half - 4 || Math.abs(z) > world.half - 4) continue;
      if (world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < t.trunkR + 1.2)) continue;
      if (this.items.some((it) => Math.hypot(it.x - x, it.z - z) < 9)) continue;
      const roll = r.rng();
      // Rarer finds on the back nine, so the hunt keeps going
      const gold = round.index >= 9 ? 0.2 : 0.1;
      const kind = roll < gold ? 'golden' : roll < gold + 0.18 ? 'glowcap' : roll < gold + 0.5 ? 'shiitake' : 'shimeji';
      const id = this.items.length;
      const mesh = mushroomMesh(kind);
      mesh.position.set(x, world.heightAt(x, z), z);
      mesh.rotation.y = r.range(0, 6.28);
      mesh.scale.setScalar(SIZE);
      const mark = document.createElement('div');
      mark.className = `forage-mark ${kind}`;
      mark.innerHTML = '<i></i>';
      this.marks.appendChild(mark);
      const item = { id, kind, x, z, mesh, mark, gone: picked.includes(id), carried: false };
      mesh.visible = !item.gone;
      this.group.add(mesh);
      this.items.push(item);
    }
    this.paintChip();
  }

  /** Glowcaps only come up after dark. */
  showing(it) { return !it.gone && (it.kind !== 'glowcap' || this.g.sky.night > 0.35); }

  /** Mushrooms close enough to the ball to send for. */
  near() {
    const { ball } = this.g;
    return this.items.filter((it) => this.showing(it) && !it.carried && Math.hypot(it.x - ball.x, it.z - ball.z) < REACH);
  }

  /** The ball has stopped: point her at the nearest mushroom. */
  atAim() {
    const near = this.near().sort((a, b) => Math.hypot(a.x - this.g.ball.x, a.z - this.g.ball.z) - Math.hypot(b.x - this.g.ball.x, b.z - this.g.ball.z));
    if (this.g.dog && near[0] && !this.g.dog.fetching) this.g.dog.sniffAt = near[0];
  }

  /** A tap at screen (x, y): on a mushroom in reach? */
  tapAt(x, y) {
    if (this.g.state !== 'aim') return false;
    for (const it of this.near()) {
      const s = this.screen(it);
      if (!s) continue;
      if (Math.hypot(s.x - x, s.y - y) < 48) { this.pick(it); return true; }
    }
    return false;
  }

  pick(it) {
    const g = this.g;
    it.carried = true;
    g.audio.tap();
    if (g.dog?.sniffAt === it) g.dog.sniffAt = null;
    const done = () => {
      it.gone = true;
      it.carried = false;
      it.mesh.visible = false;
      const r = g.round;
      if (!r) return;
      this.basket[it.kind] = (this.basket[it.kind] || 0) + 1;
      ((r.picked ||= {})[r.index] ||= []).push(it.id);
      g.audio.pop?.();
      g.hud.callout(`+1 ${KINDS[it.kind].name.toUpperCase()}`, KINDS[it.kind].rare || KINDS[it.kind].glow ? 'gold small' : 'small');
      g.earn('forage');
      this.paintChip(true);
    };
    if (g.dog?.friend) g.dog.fetch(it, done); else done();
  }

  screen(it) {
    const v = this._v.set(it.x, it.mesh.position.y + 0.9, it.z).project(this.g.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /**
   * The basket: one slot per kind, filled in as you find them — four kinds
   * make the best pot, and the golden one is rare.
   */
  paintChip(bump = false) {
    const n = this.total, b = this.basket;
    const slot = (k) => `<i class="slot ${b[k] ? 'got' : ''}" style="--c:#${KINDS[k].cap.toString(16).padStart(6, '0')}">${b[k] > 1 ? `<small>${b[k]}</small>` : ''}</i>`;
    this.chip.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 12a9 7 0 0 1 18 0z" fill="#c9773e" stroke="#12261a" stroke-width="1.8"/><path d="M9 12v5a3 3 0 0 0 6 0v-5" fill="#fff3dd" stroke="#12261a" stroke-width="1.8"/><circle cx="8" cy="8.5" r="1.3" fill="#fff3dd"/><circle cx="14" cy="7" r="1.1" fill="#fff3dd"/></svg>${KIND_IDS.map(slot).join('')}`;
    this.chip.classList.toggle('hidden', !n || !this.g.round);
    if (bump) { this.chip.classList.remove('bump'); void this.chip.offsetWidth; this.chip.classList.add('bump'); }
  }

  update(dt) {
    const g = this.g;
    const live = g.round && ['aim', 'swing', 'flight', 'settle'].includes(g.state);
    this.group.visible = !!live;
    this.chip.classList.toggle('hidden', !live || !this.total);
    const canPick = g.state === 'aim';
    const near = canPick ? new Set(this.near()) : null;
    for (const it of this.items) {
      const show = live && this.showing(it);
      if (!it.carried) it.mesh.visible = !!show;
      // A gentle sway, so they catch the eye
      if (show) it.mesh.rotation.z = Math.sin(g.time * 1.6 + it.id) * 0.05;
      let s = null;
      if (near?.has(it)) s = this.screen(it);
      it.mark.style.display = s ? 'block' : 'none';
      if (s) it.mark.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    }
  }
}

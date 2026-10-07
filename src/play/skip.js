/**
 * Skipping stones — something to do by the water.
 *
 * When your ball stops within a short walk of a pond, a pebble button comes
 * up. Tap it and your camper wanders down to the bank; flick up to throw.
 * A quick, straight flick skims (the faster and straighter, the more skips),
 * a slow or crooked one plops. Throw as many as you like, then go back to
 * your ball. Nothing on the scorecard changes: it is a pond and a pocket of
 * stones, nothing more. Your best is remembered, and friends hear about a
 * good one.
 *
 * With friends it fills the wait: press READY, skip stones, and GO calls you
 * back to your ball.
 */

import * as THREE from 'three';
import { blobRadius } from '../course/shapes.js';
import { glyph } from '../ui/glyphs.js';
import { onPress } from '../ui/press.js';

export const STONE = {
  G: 9.8,
  HEIGHT: 0.35,         // released this far above the water
  MIN: 5, MAX: 22,     // throw speed range, m/s
  ANGLE: 21,           // degrees: steeper than this into the water and it sinks
  CROOK: 14,           // ...minus this much for a crooked flick
  KEEP: 0.97,          // speed kept per skip...
  DRAG: 1.45,           // ...less this much, m/s
  LIFT: 0.3,           // fraction of the downward speed bounced back up
  POP: 0.3,            // plus this, m/s
  STALL: 2.4,          // slower than this and it sinks
  REACH: 45,           // metres from ball to bank for the pebble button
};

/** A flick on screen -> a throw. dx, dy in px (dy < 0 is up), ms the duration. */
export function throwFromFlick(dx, dy, ms) {
  const up = Math.max(1, -dy);
  const pxPerMs = up / Math.max(40, ms);
  const power = Math.min(1, pxPerMs / 2.2);
  const crook = Math.min(1, Math.abs(dx) / up);
  return {
    speed: STONE.MIN + (STONE.MAX - STONE.MIN) * power,
    yaw: Math.max(-0.45, Math.min(0.45, Math.atan2(dx, up) * 0.6)),
    crook,
  };
}

/**
 * Fly a stone over flat water, for tests and tuning: how many skips.
 * (The live stone in Skip.update uses the same rules step by step.)
 */
export function simulateStone({ speed, crook }) {
  let vh = speed, vy = 0, y = STONE.HEIGHT, skips = 0, dist = 0;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * 12; i++) {
    vy -= STONE.G * dt;
    y += vy * dt;
    dist += vh * dt;
    if (y <= 0) {
      const angle = Math.atan2(-vy, vh) * 180 / Math.PI;
      if (vh < STONE.STALL || angle > STONE.ANGLE - STONE.CROOK * crook) return { skips, dist };
      skips += 1;
      y = 0;
      vy = -vy * STONE.LIFT + STONE.POP;
      vh = vh * (STONE.KEEP - 0.1 * crook) - STONE.DRAG * (1 + 2 * crook);
    }
  }
  return { skips, dist };
}

export class Skip {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.shore = null;
    this.stone = null;
    // The pebble button, shown while lining up near water
    this.btn = document.createElement('button');
    this.btn.className = 'skip-btn hidden';
    this.btn.innerHTML = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="9" ry="5" fill="#b9bcc2" stroke="#12261a" stroke-width="1.8"/><path d="M5 10q3-3 6 0M13 8q3-3 6 0" fill="none" stroke="#5fb3e6" stroke-width="1.8" stroke-linecap="round"/></svg><span>SKIP STONES</span>';
    onPress(this.btn, 'button', () => this.open());
    game.hud.root.insertBefore(this.btn, game.hud.layer);
    this.ui = document.createElement('div');
    this.ui.className = 'skip-ui hidden';
    this.ui.innerHTML = `<div class="skip-count"></div><div class="skip-cue">${glyph('release')}<span>FLICK UP TO THROW</span></div><div class="skip-best"></div><button class="btn ghost" data-a="back">‹ BACK TO MY BALL</button>`;
    onPress(this.ui, '[data-a="back"]', () => { this.g.audio.tap(); this.close(); });
    game.hud.root.insertBefore(this.ui, game.hud.layer);
    this.countEl = this.ui.querySelector('.skip-count');
    this.bestEl = this.ui.querySelector('.skip-best');
    // A stone, and ripples
    const scene = game.scene;
    this.stoneMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), new THREE.MeshLambertMaterial({ color: 0xa9adb5, flatShading: true }));
    this.stoneMesh.scale.set(1.7, 0.6, 1.45); // big enough to follow
    this.stoneMesh.visible = false;
    scene.add(this.stoneMesh);
    this.ripples = [];
    const geo = new THREE.RingGeometry(0.82, 1, 28);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      m.userData.t = 1;
      scene.add(m);
      this.ripples.push(m);
    }
  }

  /** The nearest bank within reach of the ball, or null. */
  findShore() {
    const { world, ball } = this.g;
    if (world.biome.liquid === 'lava') return null; // not that kind of pond
    let best = null;
    for (const p of world.ponds || []) {
      const a = Math.atan2(ball.z - p.z, ball.x - p.x);
      const edge = blobRadius(p, a);
      const d = Math.hypot(ball.x - p.x, ball.z - p.z) - edge;
      if (d > STONE.REACH || d < 0) continue;
      if (!best || d < best.d) {
        // Stand on the bank, facing across the middle of the pond
        // Walk in until the water starts, and stand a step back from it
        let r = edge + 3;
        while (r > 1 && world.surfaceAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) !== 'water') r -= 0.4;
        r += 1.3;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        best = { d, x, z, dx: -Math.cos(a), dz: -Math.sin(a), pond: p };
      }
    }
    return best;
  }

  /** Should the pebble button be up? (called every frame while aiming) */
  offer() {
    const g = this.g;
    const can = g.state === 'aim' && !g.paused && !g.charging && !!g.world && !this.active;
    if (can) {
      this.offerT = (this.offerT || 0) - 1;
      if (this.offerT <= 0) { this.offerT = 20; this.nearby = this.findShore(); }
    }
    const show = can && !!this.nearby;
    // The first pond of a round says hello
    if (show && this.btn.classList.contains('hidden') && g.round && !g.round.skipSeen) {
      g.round.skipSeen = true;
      if (!(g.camp.stats.skipThrows > 0)) g.hud.callout('A POND! SKIP SOME STONES?', 'small');
    }
    this.btn.classList.toggle('hidden', !show);
    // Waiting for friends: give it a nudge
    this.btn.classList.toggle('pulse', show && g.net.active && g.net.status.get(g.net.myId) === 'ready');
  }

  open() {
    const g = this.g;
    const shore = this.findShore();
    if (!shore || g.state !== 'aim') return;
    this.shore = shore;
    this.active = true;
    this.stone = null;
    this.throws = 0;
    this.btn.classList.add('hidden');
    g.hud.setControlsVisible(false);
    g.effects.hideAim();
    g.hud.setPinTag('', 0, 0, false);
    g.setState('skip');
    g.hud.root.classList.add('skipping');
    this.countEl.textContent = '';
    this.paintBest();
    this.ui.classList.remove('hidden');
    this.ui.classList.toggle('first', !(g.camp.stats.skipThrows > 0));
    g.audio.whoosh();
  }

  paintBest() {
    const best = this.g.camp.stats.bestSkip || 0;
    this.bestEl.textContent = best ? `BEST ${best}` : '';
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.stone = null;
    this.stoneMesh.visible = false;
    this.ui.classList.add('hidden');
    this.g.hud.root.classList.remove('skipping');
    this.g.endSkip();
  }

  /** A finished flick on the course while at the bank. */
  flick(dx, dy, ms) {
    if (!this.active || this.stone || dy > -40) return false;
    const g = this.g, sh = this.shore;
    const t = throwFromFlick(dx, dy, ms);
    const yaw = Math.atan2(sh.dz, sh.dx) - t.yaw;
    const level = sh.pond.level;
    // It leaves the hand over the water's edge
    const { world } = g;
    let x = sh.x, z = sh.z;
    for (let i = 0; i < 40 && world.surfaceAt(x, z) !== 'water'; i++) { x += Math.cos(yaw) * 0.25; z += Math.sin(yaw) * 0.25; }
    this.stone = {
      x, z, y: level + STONE.HEIGHT,
      vx: Math.cos(yaw) * t.speed, vz: Math.sin(yaw) * t.speed, vy: 0,
      crook: t.crook, skips: 0, done: 0, level,
    };
    this.throwT = 0.35;
    this.countEl.textContent = '';
    this.ui.classList.remove('first');
    g.camp.stats.skipThrows = (g.camp.stats.skipThrows || 0) + 1;
    g.audio.whoosh();
    return true;
  }

  ripple(x, y, z, size) {
    const r = this.ripples.find((m) => m.userData.t >= 1) || this.ripples[0];
    r.position.set(x, y + 0.02, z);
    r.userData = { t: 0, size };
    r.visible = true;
  }

  end(st, across = false) {
    const g = this.g, n = st.skips;
    const stats = g.camp.stats;
    const best = n > (stats.bestSkip || 0);
    if (best) stats.bestSkip = n;
    g.saveCamp();
    if (n >= 6) g.earn('skip6');
    if (across) g.hud.callout(n ? `${n} SKIPS · ACROSS!` : 'ACROSS!', 'gold small');
    else if (n === 0) g.hud.callout('PLOP', 'small');
    else g.hud.callout(best && n >= 3 ? `${n} SKIPS · NEW BEST!` : `${n} SKIP${n > 1 ? 'S' : ''}`, best && n >= 3 ? 'gold' : 'small');
    if (n >= 5) { g.net.brag(`🪨 ${n} SKIPS`); g.dog?.on('pure'); }
    this.paintBest();
  }

  update(dt) {
    const g = this.g;
    if (g.state === 'aim' || this.btn.classList.contains('pulse') || !this.btn.classList.contains('hidden')) this.offer();
    // Ripples spread and fade whether or not we are still here
    for (const r of this.ripples) {
      const u = r.userData;
      if (u.t >= 1) { r.visible = false; continue; }
      u.t = Math.min(1, u.t + dt * 0.8);
      r.scale.setScalar(0.2 + u.t * 2.2 * u.size);
      r.material.opacity = 0.7 * (1 - u.t);
    }
    if (!this.active) return;
    const sh = this.shore, st = this.stone;
    const { world } = g;
    this.throwT = Math.max(0, (this.throwT || 0) - dt);
    // Camera: behind and beside the camper, looking out over the water
    const rig = g.rig;
    rig.mode = 'skip';
    rig.stiffness = 4;
    const lookD = st && !st.done ? Math.min(14, 4 + Math.hypot(st.x - sh.x, st.z - sh.z) * 0.8) : 7;
    // (the camper stands half a step to one side of the spot; the camera the other)
    const cx = sh.x - sh.dx * 3.9 - sh.dz * 0.35, cz = sh.z - sh.dz * 3.9 + sh.dx * 0.35;
    rig.wantPos.set(cx, Math.max(sh.pond.level, world.heightAt(cx, cz)) + 2.1, cz);
    rig.wantLook.set(sh.x + sh.dx * lookD, sh.pond.level + 0.4, sh.z + sh.dz * lookD);
    if (!st) return;
    if (st.done) {
      st.done += dt;
      if (st.done > 1.2) { this.stone = null; this.stoneMesh.visible = false; }
      return;
    }
    this.stoneMesh.visible = true;
    // Small steps: a skimming stone touches the water often
    for (let left = dt; left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      st.vy -= STONE.G * h;
      st.x += st.vx * h; st.y += st.vy * h; st.z += st.vz * h;
      const ground = world.heightAt(st.x, st.z);
      const water = world.surfaceAt(st.x, st.z) === 'water' || ground < st.level - 0.05;
      if (!water && st.y <= ground + 0.05) {
        // Over the far bank
        st.done = 0.001;
        this.end(st, st.skips > 0);
        g.audio.bounce(3, 'rough');
        return;
      }
      if (water && st.y <= st.level) {
        const vh = Math.hypot(st.vx, st.vz);
        const angle = Math.atan2(-st.vy, vh) * 180 / Math.PI;
        if (vh < STONE.STALL || angle > STONE.ANGLE - STONE.CROOK * st.crook) {
          this.ripple(st.x, st.level, st.z, 1.4);
          g.audio.plop?.();
          st.done = 0.001;
          this.stoneMesh.visible = false;
          this.end(st);
          return;
        }
        st.skips += 1;
        st.y = st.level;
        st.vy = -st.vy * STONE.LIFT + STONE.POP;
        const keep = Math.max(0, vh * (STONE.KEEP - 0.1 * st.crook) - STONE.DRAG * (1 + 2 * st.crook)) / vh;
        st.vx *= keep; st.vz *= keep;
        this.ripple(st.x, st.level, st.z, 0.6);
        g.audio.skip?.(st.skips);
        this.countEl.textContent = st.skips;
        this.countEl.classList.remove('bump'); void this.countEl.offsetWidth; this.countEl.classList.add('bump');
      }
    }
    this.stoneMesh.position.set(st.x, st.y, st.z);
    this.stoneMesh.rotation.y += dt * 25;
  }
}

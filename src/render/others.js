/**
 * The other campers on the hole: friends in the same room.
 *
 * Each one is a camper in their own outfit, a ball, and a name over their
 * head. Their shots are flown here with the same physics as ours from the
 * launch they send (and you see the club go back and swing, since they tell us
 * when), then put right when they report where it finished. Between
 * shots they walk (well, jog) to their ball, so the course feels shared.
 */

import * as THREE from 'three';
import { Camper, GRIP } from './camper.js';
import { ClubRig } from './club.js';
import { createBall, placeBall, launchBall, puttBall, stepBall, SIM_DT } from '../core/ballSim.js';

const SCALE = 1.9;

export class Others {
  constructor(scene, root, before) {
    this.scene = scene;
    this.tags = document.createElement('div');
    this.tags.className = 'net-tags';
    root.insertBefore(this.tags, before);
    this.map = new Map();
    this._v = new THREE.Vector3();
    this.ballGeo = new THREE.SphereGeometry(0.05, 12, 8);
  }

  /** Match the cast to the roster (everyone but me). */
  sync(players) {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, o] of this.map) if (!ids.has(id)) this.remove(id, o);
    for (const p of players) {
      let o = this.map.get(p.id);
      if (!o) {
        o = {
          id: p.id, camper: new Camper(p.look), sim: createBall(), acc: 0, flying: false, flyT: 0,
          ball: new THREE.Mesh(this.ballGeo, new THREE.MeshLambertMaterial({ color: 0xffffff })),
          tag: document.createElement('div'), target: null, status: 'aim', placed: false,
          club: new ClubRig(this.scene), aim: null, kind: 'wood', swing: null, addr: null, bubble: null,
        };
        o.club.hide();
        o.tag.className = 'net-tag';
        this.tags.appendChild(o.tag);
        o.camper.group.visible = o.ball.visible = false;
        this.scene.add(o.camper.group, o.ball);
        this.map.set(p.id, o);
      }
      o.tag.textContent = o.camper.look.name;
    }
  }

  remove(id, o) {
    this.scene.remove(o.camper.group, o.ball, o.club.group);
    o.club.group.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    o.camper.dispose();
    o.ball.material.dispose();
    o.tag.remove();
    this.map.delete(id);
  }

  clear() { for (const [id, o] of [...this.map]) this.remove(id, o); }

  hideAll() { for (const o of this.map.values()) { o.camper.group.visible = o.ball.visible = false; o.tag.style.display = 'none'; o.placed = false; } }

  /** A new hole: everyone on the tee, side by side. */
  toTee(world) {
    let i = 0;
    const { tee, cup } = world;
    const d = Math.hypot(cup.x - tee.x, cup.z - tee.z) || 1;
    const sx = -(cup.z - tee.z) / d, sz = (cup.x - tee.x) / d;
    for (const o of this.map.values()) {
      i += 1;
      const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 2.2;
      o.status = 'aim';
      o.flying = false;
      o.camp = null;
      this.put(o, world, tee.x + sx * off - (cup.x - tee.x) / d * 1.5, tee.z + sz * off - (cup.z - tee.z) / d * 1.5, true);
      o.ball.visible = false; // not hit yet: only the camper waits by the tee
    }
  }

  /** Where the camper stands for a ball at x, z. */
  put(o, world, x, z, instant) {
    placeBall(o.sim, world, x, z);
    o.ball.position.set(o.sim.x, o.sim.y, o.sim.z);
    o.ball.visible = true;
    o.target = { x: x + 0.7, z: z + 0.3 };
    const g = o.camper.group;
    if (instant || !o.placed) {
      g.position.set(o.target.x, world.heightAt(o.target.x, o.target.z), o.target.z);
      o.placed = true;
    }
    g.visible = true;
    g.scale.setScalar(SCALE);
  }

  /** They are at their ball, lining up (or the ball has stopped there). */
  at(id, world, x, z) {
    const o = this.map.get(id);
    if (!o) return;
    o.flying = false;
    o.holed = false;
    this.put(o, world, x, z, false);
  }

  /** The round is over: stand them round the fire. list: [{ id, x, y, z, yaw, pose }] */
  camp(list) {
    for (const at of list) {
      const o = this.map.get(at.id);
      if (!o) continue;
      o.camp = at.pose;
      o.flying = false;
      o.placed = true;
      o.target = null;
      o.ball.visible = false;
      o.camper.group.position.set(at.x, at.y, at.z);
      o.camper.group.rotation.y = at.yaw;
      o.camper.group.scale.setScalar(1.75);
    }
  }

  setStatus(id, status) { const o = this.map.get(id); if (o) o.status = status; }

  /** Which way they are facing with which club (sent with READY and with the swing). */
  setAim(id, aim, kind) {
    const o = this.map.get(id);
    if (!o) return;
    if (Number.isFinite(aim)) o.aim = aim;
    if (kind) o.kind = kind;
  }

  /** They have started their swing: club back, and hold it there until the hit. */
  swinging(id, aim, kind) {
    const o = this.map.get(id);
    if (!o) return;
    this.setAim(id, aim, kind);
    o.status = 'swing';
    o.swing = { t: 0, phase: 'back' };
    o.addr = { x: o.sim.x, y: o.sim.y, z: o.sim.z };
  }

  /** The round is over and they chose a pose by the fire. */
  pose(id, p) { const o = this.map.get(id); if (o && o.camp) o.camp = p; }

  /** A word over their head for a moment. */
  say(id, text) { const o = this.map.get(id); if (o) o.bubble = { text, t: 2.6 }; }

  /** They have hit: fly it. */
  shot(id, world, msg) {
    const o = this.map.get(id);
    if (!o || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
    placeBall(o.sim, world, msg.x, msg.z);
    // The strike: swing through from wherever the club was
    const d = msg.kind === 'putt' ? msg : msg.launch || {};
    if (Number.isFinite(d.dirX) && Number.isFinite(d.dirZ) && (d.dirX || d.dirZ)) o.aim = Math.atan2(d.dirZ, d.dirX);
    o.kind = msg.kind === 'putt' ? 'putter' : o.kind === 'putter' ? 'iron' : o.kind;
    o.addr = { x: o.sim.x, y: o.sim.y, z: o.sim.z };
    o.swing = { t: 0, phase: 'through', from: o.swing?.theta ?? -1.6 };
    if (msg.kind === 'putt') puttBall(o.sim, { speed: +msg.speed || 0, dirX: +msg.dirX || 0, dirZ: +msg.dirZ || 0 });
    else if (msg.launch) launchBall(o.sim, msg.launch);
    else return;
    o.flying = true;
    o.flyT = 0;
    o.acc = 0;
    o.ball.visible = true;
  }

  holed(id) {
    const o = this.map.get(id);
    if (!o) return;
    o.flying = false;
    o.holed = true;
    o.status = 'done';
    o.ball.visible = false;
  }

  update(dt, world, env, camera, show) {
    const events = [];
    for (const o of this.map.values()) {
      const g = o.camper.group;
      if (!show || !o.placed) { g.visible = false; o.ball.visible = false; o.tag.style.display = 'none'; continue; }
      g.visible = true;
      if (o.camp) { o.ball.visible = false; o.camper.update(dt, o.camp); this.tagAt(o, 1.75, camera); continue; }
      if (o.flying) {
        o.acc += dt; o.flyT += dt;
        while (o.acc >= SIM_DT && o.flying) {
          o.acc -= SIM_DT;
          events.length = 0;
          stepBall(o.sim, world, env, SIM_DT, events);
          if (o.flyT > 25 || events.some((e) => e.type === 'rest' || e.type === 'holed' || e.type === 'splash' || e.type === 'oob')) o.flying = false;
        }
        o.ball.position.set(o.sim.x, o.sim.y, o.sim.z);
      }
      // Big enough to follow from where we stand
      const far = camera.position.distanceTo(o.ball.position);
      o.ball.scale.setScalar(Math.max(1.4, Math.min(10, far / 9)));

      // At the ball with a club: lining up (ready), taking it back (swing), hitting (through)
      const atBall = (o.status === 'ready' || o.status === 'swing' || o.swing) && o.aim !== null && !o.camp;
      if (atBall && this.address(o, dt, world)) { this.tagAt(o, g.scale.x, camera); continue; }
      o.club.hide();

      // Walk to the ball
      let pose = o.status === 'done' ? 'cheer' : 'idle';
      if (o.target && !o.flying) {
        const dx = o.target.x - g.position.x, dz = o.target.z - g.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.15) {
          const step = Math.min(dist, Math.max(7, dist * 0.6) * dt);
          const x = g.position.x + (dx / dist) * step, z = g.position.z + (dz / dist) * step;
          g.position.set(x, world.heightAt(x, z), z);
          g.rotation.y = Math.atan2(dx, dz);
          pose = 'walk';
        } else if (pose === 'idle') {
          // Face the hole
          g.rotation.y = Math.atan2(world.cup.x - g.position.x, world.cup.z - g.position.z);
        } else {
          g.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
        }
      }
      o.camper.update(dt, pose);

      this.tagAt(o, SCALE, camera);
    }
  }

  /**
   * Stand them at their ball holding the club, the same geometry as our own
   * camper (game.js addressSpot). Returns false once the swing is over.
   */
  address(o, dt, world) {
    const ball = o.addr && o.swing ? o.addr : o.sim;
    const dirX = Math.cos(o.aim), dirZ = Math.sin(o.aim);
    const nx = dirZ, nz = -dirX;
    const size = 0.63;
    const p = ClubRig.pivot(ball, dirX, dirZ, o.kind, size, this._v);
    let scale = SCALE, x = p.x, z = p.z, y = 0;
    for (let i = 0; i < 2; i++) {
      x = p.x + nx * GRIP.z * scale; z = p.z + nz * GRIP.z * scale;
      y = world.heightAt(x, z);
      scale = Math.max(1.2, Math.min(4, (p.y - y) / GRIP.y));
    }
    const g = o.camper.group;
    // Walk the last step rather than teleport
    const dx = x - g.position.x, dz = z - g.position.z, dist = Math.hypot(dx, dz);
    if (dist > 0.2 && !o.swing) {
      const step = Math.min(dist, Math.max(7, dist * 0.6) * dt);
      const nxp = g.position.x + (dx / dist) * step, nzp = g.position.z + (dz / dist) * step;
      g.position.set(nxp, world.heightAt(nxp, nzp), nzp);
      g.rotation.y = Math.atan2(dx, dz);
      g.scale.setScalar(scale);
      o.camper.update(dt, 'walk');
      o.club.hide();
      return true;
    }
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(-nx, -nz);
    g.scale.setScalar(scale);
    // The club: a waggle while lining up, back and held, then through
    let theta = Math.sin(o.camper.t * 2.2) * 0.035;
    if (o.swing) {
      o.swing.t += dt;
      const s = o.swing;
      if (s.phase === 'back') {
        theta = -1.6 * Math.min(1, s.t / 0.6);
      } else {
        const k = Math.min(1, s.t / 0.22);
        theta = s.from + (2.5 - s.from) * (1 - (1 - k) * (1 - k));
        if (s.t > 1.1) { o.swing = null; o.club.hide(); return false; }
      }
      s.theta = theta;
    }
    o.club.pose(ball, dirX, dirZ, theta, o.kind, size, 1);
    o.camper.update(dt, 'address', { twist: Math.max(-1, Math.min(1, theta / 2.2)) });
    return true;
  }

  /** Name over the head (and anything they just said). */
  tagAt(o, scale, camera) {
    const g = o.camper.group;
    const v = this._v.set(g.position.x, g.position.y + scale * 1.08, g.position.z).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    if (o.bubble) {
      o.bubble.t -= 1 / 60;
      if (o.bubble.t <= 0) { o.bubble = null; o.tag.textContent = o.camper.look.name; o.tag.classList.remove('bubble'); }
      else if (!o.tag.classList.contains('bubble')) { o.tag.textContent = `${o.camper.look.name}  ${o.bubble.text}`; o.tag.classList.add('bubble'); }
    }
    o.tag.style.display = on ? 'block' : 'none';
    if (on) o.tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * window.innerWidth}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
  }
}

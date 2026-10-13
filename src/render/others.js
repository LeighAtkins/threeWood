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
import { ClubRig, CAMPER_CLUB_SIZE, CAMPER_SCALE } from './club.js';
import { teeSlot } from '../course/courseWorld.js';
import { cleanLook } from '../core/camp.js';
import { createBall, placeBall, launchBall, puttBall, stepBall, SIM_DT, BALL_R } from '../core/ballSim.js';

const SCALE = CAMPER_SCALE;
const TAG_TOP = 64;  // px: the hole and score panels along the top of the screen
const FACE_FAR = 9; // metres from the lens beyond which a friend's face is not drawn (an eye there is ~3 px on a phone)

export class Others {
  constructor(scene, root, before) {
    this.scene = scene;
    this.tags = document.createElement('div');
    this.tags.className = 'net-tags';
    root.insertBefore(this.tags, before);
    this.map = new Map();
    this._v = new THREE.Vector3();
    // (the real ball's size, drawn bigger with distance exactly as mine is)
    this.ballGeo = new THREE.SphereGeometry(BALL_R, 12, 8);
    // Friends get a soft blob shadow instead of casting real ones: seven
    // campers in the shadow pass doubled the cost of a frame on a phone
    this.blobGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    this.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
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
          club: new ClubRig(this.scene, { lite: true }), aim: null, kind: 'wood', swing: null, addr: null, bubble: null,
        };
        o.club.hide();
        o.camper.group.traverse((m) => { if (m.isMesh) m.castShadow = false; });
        o.blob = new THREE.Mesh(this.blobGeo, this.blobMat);
        o.blob.renderOrder = 1;
        this.scene.add(o.blob);
        o.tag.className = 'net-tag';
        this.tags.appendChild(o.tag);
        o.camper.group.visible = o.ball.visible = false;
        this.scene.add(o.camper.group, o.ball);
        this.map.set(p.id, o);
      }
      // (a bot can be renamed when a person with its name joins)
      const name = cleanLook(p.look).name;
      if (name !== o.camper.look.name) o.camper.look = { ...o.camper.look, name };
      o.tag.textContent = o.camper.look.name;
      o.tagText = null;
    }
  }

  remove(id, o) {
    this.scene.remove(o.camper.group, o.ball, o.club.group, o.blob);
    o.club.group.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    o.camper.dispose();
    o.ball.material.dispose();
    o.tag.remove();
    this.map.delete(id);
  }

  clear() { for (const [id, o] of [...this.map]) this.remove(id, o); }

  hideAll() { for (const o of this.map.values()) { o.camper.group.visible = o.ball.visible = false; o.tag.style.display = 'none'; o.placed = false; } }

  /** A new hole: everyone on the tee, side by side. */
  toTee(world, slotOf = null) {
    let i = 0;
    for (const o of this.map.values()) {
      i += 1;
      o.status = 'aim';
      o.flying = false;
      o.camp = null;
      o.campAt = null;
      o.wantPose = null;
      o.gallery = null;
      // Their own spot on the tee (the same one their phone tees up on)
      const at = teeSlot(world, slotOf ? slotOf(o.id) : i);
      this.put(o, world, at.x, at.z, true);
      o.ball.visible = true;
    }
  }


  /** Is a camper at p (feet) standing across the line from the lens c to the ball f? */
  blocks(c, f, p) {
    const dx = f.x - c.x, dz = f.z - c.z, len2 = dx * dx + dz * dz;
    if (len2 < 0.01) return false;
    const t = ((p.x - c.x) * dx + (p.z - c.z) * dz) / len2;
    if (t <= 0.05 || t >= 0.92) return false; // (behind the lens, or at or past the ball)
    const qx = c.x + dx * t - p.x, qz = c.z + dz * t - p.z;
    return qx * qx + qz * qz < 0.45 * 0.45;
  }

  /** A spot on the ring behind the green, facing the players coming in. */
  gallerySpot(world, o) {
    const { cup, tee, spec } = world;
    const base = Math.atan2(cup.z - tee.z, cup.x - tee.x);
    const i = [...this.map.keys()].indexOf(o.id);
    o.seat = i;
    const a = base + (i - (this.map.size - 1) / 2) * 0.3;
    const r = spec.green.channel ? 5 : spec.green.size + 3; // (crazy golf: back past the end of the lane, not round the cup)
    const x = cup.x + Math.cos(a) * r, z = cup.z + Math.sin(a) * r;
    return { x, z };
  }

  /** Where the camper stands for a ball at x, z. */
  put(o, world, x, z, instant) {
    placeBall(o.sim, world, x, z);
    o.ball.position.set(o.sim.x, o.sim.y, o.sim.z);
    o.ball.visible = true;
    // On the golfer's side of their ball (as they will address it), not a
    // fixed step off it that can put them on a neighbour's toes
    const fx = world.cup.x - x, fz = world.cup.z - z, fd = Math.hypot(fx, fz) || 1;
    const dx = fx / fd, dz = fz / fd;
    o.target = { x: x + dz * 0.6 - dx * 0.15, z: z - dx * 0.6 - dz * 0.15 };
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
      o.camp = o.wantPose || at.pose;
      o.campAt = at;
      o.flying = false;
      o.placed = true;
      o.target = null;
      o.ball.visible = false;
      o.camper.group.scale.setScalar(1.75);
      this.seat(o);
    }
  }

  /**
   * Put a friend at their place by the fire for the pose they chose. In the
   * camp chair a seated pose perches on its seat (like ours on the log); a
   * standing one steps out beside it. Elsewhere, where they stand.
   */
  seat(o) {
    const at = o.campAt;
    if (!at) return;
    const seated = ['sit', 'warm', 'perch', 'perchWarm'].includes(o.camp);
    o.campShown = o.camp;
    let p = at, lift = 0;
    if (at.chair) {
      if (seated) { lift = at.chair.lift; o.campShown = o.camp === 'warm' || o.camp === 'perchWarm' ? 'perchWarm' : 'perch'; }
      else p = at.chair.beside;
    }
    o.camper.group.position.set(p.x, p.y + lift, p.z);
    o.camper.group.rotation.y = p.yaw;
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
  pose(id, p) {
    const o = this.map.get(id);
    if (!o) return;
    o.wantPose = p; // kept for when we sit down, if they got there first
    if (o.camp) { o.camp = p; this.seat(o); }
  }

  /** A word over their head for a moment. */
  say(id, text) { const o = this.map.get(id); if (o) o.bubble = { text, t: text.length > 3 ? 3.2 : 2.6 }; }

  /** A face and a hop: joy | oops. */
  react(id, mood) {
    const o = this.map.get(id);
    if (!o) return;
    o.camper.feel(mood, 1.8);
    o.hop = 0.45;
  }

  /** Their ball was knocked by another ball: roll the replay from where it lay. */
  knock(id, s) {
    const o = this.map.get(id);
    if (!o || !s) return;
    const n = (v) => (Number.isFinite(+v) ? +v : 0);
    const vx = n(s.vx), vz = n(s.vz), speed = Math.hypot(vx, vz);
    if (!(speed > 0.05)) return;
    placeBall(o.sim, this.world || o.world, n(s.x), n(s.z));
    puttBall(o.sim, { speed, dirX: vx / speed, dirZ: vz / speed });
    o.flying = true; o.flyT = 0; o.acc = 0; o.ball.visible = true;
  }

  /** Their ball took a new flight (off someone's head): fly the replay from there. */
  resync(id, s, mode = 'air') {
    const o = this.map.get(id);
    if (!o || !s) return;
    const n = (v) => (Number.isFinite(+v) ? +v : 0);
    Object.assign(o.sim, { x: n(s.x), y: n(s.y), z: n(s.z), vx: n(s.vx), vy: n(s.vy), vz: n(s.vz), mode });
    o.flying = true;
    o.flyT = Math.min(o.flyT, 20);
  }

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

  update(dt, world, env, camera, show, focus = null, focusId = null) {
    const events = [];
    this.world = world;
    this.t = (this.t || 0) + dt;
    for (const o of this.map.values()) {
      const g = o.camper.group;
      if (!show || !o.placed) { g.visible = false; o.ball.visible = false; o.tag.style.display = 'none'; continue; }
      g.visible = true;
      // (a face down the fairway is a few pixels: draw it only up close)
      const camD2 = camera.position.distanceToSquared(g.position);
      o.camper.setFar(camD2 > FACE_FAR * FACE_FAR);
      // (right in the lens: a wall of jacket, not a friend. Step out of the picture)
      if (camD2 < 2.2 * 2.2 && !o.camp) { g.visible = false; o.tag.style.display = 'none'; }
      // (nor between me and my ball: on a crowded green or a crazy-golf lane,
      // a friend standing on my line of sight steps out of the picture)
      else if (focus && !o.camp && o.id !== focusId && this.blocks(camera.position, focus, g.position)) { g.visible = false; o.tag.style.display = 'none'; }
      if (o.camp) { o.ball.visible = false; o.camper.update(dt, o.campShown || o.camp); this.tagAt(o, 1.75, camera); continue; }
      if (o.flying) {
        // (double speed while the bots hurry: the server shortens their flights to match)
        const fdt = dt * (this.replaySpeed || 1);
        o.acc += fdt; o.flyT += fdt;
        while (o.acc >= SIM_DT && o.flying) {
          o.acc -= SIM_DT;
          events.length = 0;
          stepBall(o.sim, world, env, SIM_DT, events);
          this.onStep?.(o);
          if (o.flyT > 25 || events.some((e) => e.type === 'rest' || e.type === 'holed' || e.type === 'splash' || e.type === 'oob')) o.flying = false;
        }
        o.ball.position.set(o.sim.x, o.sim.y, o.sim.z);
      }
      // Big enough to follow from where we stand
      // (the same rule as my own ball: 1.4× close up, never past 4×, and
      // resting on the turf rather than sunk into it)
      const far = camera.position.distanceTo(o.ball.position);
      const bs = Math.max(1.4, Math.min(4, far / (window.innerHeight > window.innerWidth ? 8.5 : 11)));
      o.ball.scale.setScalar(bs);
      o.ball.position.y = Math.max(o.sim.y, world.heightAt(o.sim.x, o.sim.z) + BALL_R * bs);

      // At the ball with a club: lining up (ready), taking it back (swing), hitting (through)
      const atBall = (o.status === 'ready' || o.status === 'swing' || o.swing) && o.aim !== null && !o.camp;
      if (atBall && this.address(o, dt, world)) { this.tagAt(o, g.scale.x, camera); continue; }
      o.club.hide();

      // Finished: off the green to the gallery behind it, to watch the rest
      if (o.status === 'done' && !o.flying) {
        o.gallery ||= this.gallerySpot(world, o);
        o.target = o.gallery;
      }
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
      // (watching from a step away: cheer now and then, idle in between)
      if (o.status === 'done' && pose === 'cheer') pose = (this.t + (o.seat || 0) * 0.7) % 6 < 1.4 ? 'cheer' : 'idle';
      if (o.status === 'done' && o.gallery && pose !== 'walk') g.rotation.y = Math.atan2(world.cup.x - g.position.x, world.cup.z - g.position.z);
      o.camper.update(dt, pose);
      if (o.hop > 0) { o.hop = Math.max(0, o.hop - dt); g.position.y = world.heightAt(g.position.x, g.position.z) + Math.sin((o.hop / 0.45) * Math.PI) * 0.18; }

      this.tagAt(o, SCALE, camera);
    }
    this.placeTags();
    // Blob shadows under whoever is showing
    for (const o of this.map.values()) {
      const g = o.camper.group;
      o.blob.visible = g.visible;
      if (!g.visible) continue;
      o.blob.position.set(g.position.x, world.heightAt(g.position.x, g.position.z) + 0.03, g.position.z);
      o.blob.scale.setScalar(g.scale.x * 0.2);
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
    const size = CAMPER_CLUB_SIZE;
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
    o.club.pose(ball, dirX, dirZ, theta, o.kind, size, 1, o.camper.shoulderWorld?.lengthSq() ? o.camper.shoulderWorld : null);
    o.camper.update(dt, 'address', { twist: Math.max(-1, Math.min(1, theta / 2.2)), arms: o.club });
    return true;
  }

  /** Name over the head (and anything they just said). */
  /** Where their tag goes this frame (placed, with the others, by placeTags). */
  tagAt(o, scale, camera) {
    const g = o.camper.group;
    const v = this._v.set(g.position.x, g.position.y + scale * 1.08, g.position.z).project(camera);
    o.tagOn = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    if (o.bubble) { o.bubble.t -= 1 / 60; if (o.bubble.t <= 0) o.bubble = null; }
    const text = o.bubble ? `${o.camper.look.name}  ${o.bubble.text}` : o.camper.look.name;
    if (text !== o.tagText) { o.tagText = text; o.tag.textContent = text; o.tag.classList.toggle('bubble', !!o.bubble); }
    o.tagX = (v.x * 0.5 + 0.5) * window.innerWidth;
    o.tagY = (-v.y * 0.5 + 0.5) * window.innerHeight;
    o.tagFar = camera.position.distanceToSquared(g.position) > FACE_FAR * FACE_FAR && !o.bubble;
  }

  /**
   * Lay the tags out: from the bottom of the screen up, each one that would
   * sit on a tag already placed is nudged up above it, so a crowd behind the
   * green reads as names, not a smudge. (Sizes are estimated, not measured:
   * no layout reads in the frame loop.)
   */
  placeTags() {
    const list = [...this.map.values()].filter((o) => o.tagOn && o.camper.group.visible);
    for (const o of this.map.values()) if (!list.includes(o)) o.tag.style.display = 'none';
    list.sort((a, b) => b.tagY - a.tagY);
    const placed = [];
    for (const o of list) {
      const k = o.tagFar ? 0.8 : 1;
      const w = (o.tagText.length * 7.2 + 18) * k, h = (o.bubble ? 27 : 21) * k;
      let y = o.tagY;
      for (let pass = 0; pass < 6; pass++) {
        const hit = placed.find((r) => Math.abs(r.x - o.tagX) < (r.w + w) / 2 && y > r.y - r.h && y - h < r.y);
        if (!hit) break;
        y = hit.y - hit.h - 1;
      }
      // (never up into the HUD along the top: a crowd that will not fit just overlaps)
      if (y - h < TAG_TOP) y = Math.max(o.tagY, TAG_TOP + h);
      placed.push({ x: o.tagX, y, w, h });
      if (o.tagFar !== o.tagFarShown) { o.tagFarShown = o.tagFar; o.tag.classList.toggle('far', o.tagFar); }
      o.tag.style.display = 'block';
      o.tag.style.transform = `translate(${o.tagX}px, ${y}px) translate(-50%, -100%)`;
    }
  }
}

import * as THREE from 'three';

/**
 * Camera direction. Each mode produces a desired position + look-at; the rig
 * eases toward them (or cuts when told to). Kept above the ground everywhere.
 *
 *   aim      behind the ball, looking down the shot line
 *   putt     low behind the ball, hole in frame
 *   chase    following a full shot through the air
 *   landing  parked past the finish, watching the ball arrive
 *   watch    fixed position, tracking the ball (chips, putts)
 *   flyover  hole intro, green back to tee
 *   orbit    slow circle around a point (celebrations, title)
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 30, 0);
    this.look = new THREE.Vector3();
    this.wantPos = new THREE.Vector3();
    this.wantLook = new THREE.Vector3();
    this.mode = 'aim';
    this.world = null;
    this.snap = true;
    this.stiffness = 6;
    this.shake = 0;
    this.t = 0;
    this.portrait = true;
    this._v = new THREE.Vector3();
    // A scratch camera for asking "where would this land on screen?" of a
    // framing before it is used
    this._cam = new THREE.PerspectiveCamera();
  }

  /** Screen position (NDC) of a world point as seen from wantPos looking at wantLook. */
  ndc(x, y, z) {
    const c = this._cam;
    c.projectionMatrix.copy(this.camera.projectionMatrix);
    c.position.copy(this.wantPos);
    c.up.set(0, 1, 0);
    c.lookAt(this.wantLook);
    c.updateMatrixWorld();
    c.matrixWorldInverse.copy(c.matrixWorld).invert();
    return this._v.set(x, y, z).project(c);
  }

  /**
   * Tip the view down until the point sits no lower than `minY` on screen
   * (-1 bottom, 1 top). The ball has to be in the picture on every screen
   * shape: a wide monitor's narrow field of view used to drop it off the
   * bottom of the aim view.
   */
  fit(x, y, z, minY) {
    for (let i = 0; i < 5; i++) {
      const v = this.ndc(x, y, z);
      if (v.z < 1 && v.y >= minY) break;
      const dist = this.wantPos.distanceTo(this.wantLook);
      const halfTan = Math.tan((this.camera.fov * Math.PI / 360));
      const short = v.z >= 1 ? 0.4 : Math.min(1.5, minY - v.y);
      this.wantLook.y -= short * halfTan * dist;
    }
  }

  /**
   * Shot preview: from behind the ball, high enough and far enough back that
   * the whole path (ball, apex, landing) is on screen. `points` is the flat
   * path; the view looks along (dirX, dirZ).
   */
  frame(ball, dirX, dirZ, points) {
    this.mode = 'preview';
    this.stiffness = 4.5;
    let ex = ball.x, ey = ball.y, ez = ball.z;
    for (let i = 0; i < points.length; i += 3) { ex = points[i]; ey = points[i + 1]; ez = points[i + 2]; }
    const span = Math.max(4, Math.hypot(ex - ball.x, ez - ball.z));
    const mx = (ball.x + ex) / 2, mz = (ball.z + ez) / 2, my = (ball.y + ey) / 2;
    // High behind the ball, looking down the line at the landing: the path
    // on the ground and where it ends are what matter (the top of a high
    // arc may leave the frame). Pull back only until both ends fit.
    let back = span * 0.22 + 3;
    for (let i = 0; i < 8; i++) {
      const up = back * 0.9 + 2.5;
      this.wantPos.set(ball.x - dirX * back, Math.max(ball.y, ey) + up, ball.z - dirZ * back);
      this.wantLook.set(mx, my, mz);
      let ok = true;
      for (const [x, y, z] of [[ball.x, ball.y, ball.z], [ex, ey, ez]]) {
        const v = this.ndc(x, y, z);
        if (v.z >= 1 || Math.abs(v.x) > 0.8 || v.y < -0.78 || v.y > 0.82) { ok = false; break; }
      }
      if (ok) break;
      back *= 1.2;
    }
  }


  /**
   * The tee with friends: everyone in the picture. From high behind my ball,
   * looking down the line, pulled back until every spot fits (the back row,
   * behind me, needs the lens further back still).
   */
  gallery(ball, dirX, dirZ, spots) {
    this.mode = 'gallery';
    this.stiffness = 3.5;
    let cx = ball.x, cz = ball.z;
    for (const s of spots) { cx += s.x; cz += s.z; }
    cx /= spots.length + 1; cz /= spots.length + 1;
    // (portrait: the bottom of the frame is the club pill and the swing
    // button, so everyone's feet must sit well above it)
    const minY = this.portrait ? -0.45 : -0.8;
    let back = 9;
    for (let i = 0; i < 9; i++) {
      this.wantPos.set(ball.x - dirX * back, ball.y + back * 0.62 + 1.5, ball.z - dirZ * back);
      this.wantLook.set(cx + dirX * 10, ball.y + 0.4, cz + dirZ * 10);
      let ok = true;
      for (const s of [ball, ...spots]) {
        for (const lift of [0, 1.6]) {
          const v = this.ndc(s.x, s.y + lift, s.z);
          if (v.z >= 1 || Math.abs(v.x) > 0.86 || v.y < minY || v.y > 0.85) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) break;
      back *= 1.22;
    }
  }

  /** `placed`: big set pieces from the scenery, which can block a camera just as a tree can. */
  setWorld(world, placed = []) {
    this.world = world;
    this.blockers = [
      ...world.trees.map((t) => ({ x: t.x, y: t.cy, z: t.z, r: t.cr + 0.6 })),
      ...placed.filter((p) => p.type === 'feature').map((p) => ({ x: p.x, y: p.y + p.h * 0.4, z: p.z, r: p.r })),
    ];
  }

  /** Is the straight line from a to b free of trees and set pieces? */
  clearLine(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    for (const o of this.blockers) {
      const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.y - ay) * dy + (o.z - az) * dz) / len2));
      const px = ax + dx * t - o.x, py = ay + dy * t - o.y, pz = az + dz * t - o.z;
      if (px * px + py * py + pz * pz < o.r * o.r) return false;
    }
    return true;
  }

  setAspect(aspect) {
    this.portrait = aspect < 1;
    this.camera.aspect = aspect;
    // Portrait needs a taller field of view to keep the hole in frame
    this.camera.fov = this.portrait ? 64 : 48;
    // The thumb controls own the bottom of a portrait screen: slide the whole
    // picture up so the ball sits clear of them.
    const w = window.innerWidth, h = window.innerHeight;
    if (this.portrait) this.camera.setViewOffset(w, h, 0, h * 0.15, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.1, w, h);
    this.camera.updateProjectionMatrix();
  }

  cut() { this.snap = true; }

  addShake(amount) { this.shake = Math.max(this.shake, amount); }

  ground(x, z) { return this.world ? this.world.heightAt(x, z) : 0; }

  /** Behind the ball, looking along (dirX, dirZ). `reach` = shot length. */
  aim(ball, dirX, dirZ, reach) {
    this.mode = 'aim';
    this.stiffness = 7;
    const k = Math.max(0, Math.min(1, reach / 150));
    const back = 4.2 + 4.2 * k + (this.portrait ? 0.8 : 0);
    const up = 2.1 + 3.4 * k + (this.portrait ? 0 : 0.6);
    const ahead = 6 + 30 * k;
    this.wantPos.set(ball.x - dirX * back, ball.y + up, ball.z - dirZ * back);
    // Never park the lens inside a tree: tuck in tight behind the ball instead
    for (const t of this.world.trees) {
      if (Math.hypot(this.wantPos.x - t.x, this.wantPos.z - t.z) < t.cr + 1.2) {
        this.wantPos.set(ball.x - dirX * 2.6, ball.y + 1.5, ball.z - dirZ * 2.6);
        break;
      }
    }
    this.wantLook.set(ball.x + dirX * ahead, ball.y + 0.3, ball.z + dirZ * ahead);
    // The ball itself must be in the picture, whatever the screen's shape
    this.fit(ball.x, ball.y, ball.z, -0.5);
  }

  /** Putting view: ball near the bottom of frame, cup beyond it. */
  putt(ball, dirX, dirZ, distance, lift = 0) {
    this.mode = 'putt';
    this.stiffness = 7;
    const d = Math.min(distance, 28);
    const back = 3.0 + d * 0.2;
    const up = 1.2 + d * 0.15 + (this.portrait ? 0.35 : 0);
    // A little off to the side away from the golfer (who stands on the left
    // of the line), so they share the frame with the ball instead of
    // blocking it from the left edge
    const off = 0.55;
    this.wantPos.set(ball.x - dirX * back - dirZ * off, ball.y + up, ball.z - dirZ * back + dirX * off);
    const ahead = Math.max(1.5, d * 0.62);
    this.wantLook.set(ball.x + dirX * ahead, ball.y + lift, ball.z + dirZ * ahead);
    this.fit(ball.x, ball.y, ball.z, -0.42);
  }

  /** Follow a ball in flight from behind and above. */
  chase(ball) {
    if (this.mode !== 'chase') {
      this.mode = 'chase';
      this.chaseT = 0;
    }
    this.chaseT += 1 / 60;
    // Ease in from the address view, then stay tight on the ball
    this.stiffness = Math.min(9, 2.5 + this.chaseT * 9);
    const vh = Math.hypot(ball.vx, ball.vz) || 1;
    // Direction of travel, smoothed: a ball rising almost straight up (a
    // wedge) has little sideways speed, and the camera must not spin with it
    const ndx = ball.vx / vh, ndz = ball.vz / vh;
    if (this.chaseT < 0.05 || !this.chaseDir) this.chaseDir = { x: ndx, z: ndz };
    else { this.chaseDir.x += (ndx - this.chaseDir.x) * 0.1; this.chaseDir.z += (ndz - this.chaseDir.z) * 0.1; }
    const dl = Math.hypot(this.chaseDir.x, this.chaseDir.z) || 1;
    const dx = this.chaseDir.x / dl, dz = this.chaseDir.z / dl;
    const height = Math.max(0, ball.y - this.ground(ball.x, ball.z));
    // A steep flight: pull back and look down the line rather than up at the
    // ball against the sky, so the ground and the target stay in frame
    const steep = Math.min(1, Math.max(0, (ball.vy / vh - 0.5) / 1.5));
    const back = 7 + height * (0.3 + 0.5 * steep);
    // (lifted clear for the first second, so it never sweeps through the golfer)
    const clear = 2.6 * Math.max(0, 1 - this.chaseT / 1.1);
    this.wantPos.set(ball.x - dx * back, ball.y + 2.2 + height * (0.1 + 0.25 * steep) + clear, ball.z - dz * back);
    this.wantLook.set(ball.x + dx * (6 + 10 * steep), ball.y - height * (0.15 + 0.45 * steep), ball.z + dz * (6 + 10 * steep));
  }

  /**
   * The reverse angle: down by the landing area, looking back up the flight
   * as the ball comes in, pitches a few yards in front of the lens and runs
   * out. Placed off the landing point (not the finish), so the ball is big in
   * frame when it lands however far it then rolls, and moved if a tree or a
   * building would be in the way.
   */
  landing(ball, plan, fromX, fromZ) {
    if (this.mode !== 'landing') {
      this.mode = 'landing';
      this.lookLift = 0.25;
      let dx = plan.landX - fromX, dz = plan.landZ - fromZ;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const roll = Math.hypot(plan.restX - plan.landX, plan.restZ - plan.landZ);
      // A short shot (an approach, a pitch) is watched from behind and above,
      // looking at the target: the reverse angle would show only sky behind
      // a ball dropping in steeply. Longer shots keep the reverse angle.
      const short = len < 85;
      const ahead = short ? -Math.min(16, 6 + len * 0.12) : Math.max(6, Math.min(13, 5 + roll * 0.55));
      const ly = this.ground(plan.landX, plan.landZ) + 0.6;
      let best = null;
      const spots = short ? [[2.2, 5.5], [-2.2, 5.5], [0, 8]] : [[3.6, 1.7], [-3.6, 1.7], [5.5, 4.5], [-5.5, 4.5], [0, 9]];
      for (const [side, up] of spots) {
        const px = plan.landX + dx * ahead - dz * side;
        const pz = plan.landZ + dz * ahead + dx * side;
        const py = this.ground(px, pz) + up;
        best = best || [px, py, pz];
        // Clear to where it lands, and to where the ball is right now
        if (this.clearLine(px, py, pz, plan.landX, ly, plan.landZ) && this.clearLine(px, py, pz, ball.x, ball.y, ball.z)) {
          best = [px, py, pz];
          break;
        }
      }
      this.pos.set(best[0], best[1], best[2]);
      this.wantPos.copy(this.pos);
      this.look.set(ball.x, ball.y, ball.z);
    }
    // Tight on the ball in the air, a little looser once it is running
    this.stiffness = ball.mode === 'air' ? 14 : 6;
    // Once it is down, frame it a little below centre: the callout ("FAIRWAY!")
    // sits a third of the way down the screen and must not cover the ball
    const dist = Math.hypot(this.pos.x - ball.x, this.pos.z - ball.z);
    const lift = ball.mode === 'air' ? 0.25 : 0.25 + dist * 0.17;
    this.lookLift = (this.lookLift ?? 0.25) + (lift - (this.lookLift ?? 0.25)) * 0.08;
    // A ball still high above its landing spot: look between the two, so the
    // ground it is falling onto stays in frame instead of an empty sky
    const ly = this.ground(plan.landX, plan.landZ);
    const up = ball.mode === 'air' ? Math.min(1, Math.max(0, (ball.y - ly - 3) / 10)) * 0.6 : 0;
    this.wantLook.set(ball.x + (plan.landX - ball.x) * up, ball.y + this.lookLift + (ly - ball.y) * up, ball.z + (plan.landZ - ball.z) * up);
    // A long run-out: truck along behind it rather than watch it shrink
    if (ball.mode !== 'air') {
      const dx = this.pos.x - ball.x, dz = this.pos.z - ball.z;
      const d = Math.hypot(dx, dz);
      if (d > 5.5) {
        const x = ball.x + (dx / d) * 5.5, z = ball.z + (dz / d) * 5.5;
        this.wantPos.set(x, this.ground(x, z) + 1.4, z);
      }
    }
  }

  /**
   * A short shot (a pitch, an approach): stay behind the golfer, rise a
   * little, and look between the ball and where it will land, so the green
   * is in frame the whole way and the ball drops into it. (Chasing a wedge
   * up into the sky showed nothing but sky and backdrop.)
   */
  approach(ball, plan) {
    if (this.mode !== 'approach') {
      this.mode = 'approach';
      this.approachFrom = this.pos.clone();
    }
    this.stiffness = 2.2;
    const f = this.approachFrom;
    this.wantPos.set(f.x, f.y + 1.2, f.z);
    const ly = this.ground(plan.landX, plan.landZ);
    this.wantLook.set((ball.x + plan.landX) / 2, Math.min(ball.y, (ball.y + ly) / 2 + 1), (ball.z + plan.landZ) / 2);
  }

  /** Hold position, keep the ball in frame. */
  watch(ball, lead = 0) {
    this.mode = 'watch';
    this.stiffness = 5;
    this.wantLook.set(ball.x + ball.vx * lead, ball.y, ball.z + ball.vz * lead);
  }

  /**
   * Hole intro: t 0..1. Starts at the flag and pulls back down the hole to
   * the tee, so the whole thing is revealed in the order you will play it.
   */
  flyover(t) {
    this.mode = 'flyover';
    this.stiffness = 5;
    const { tee, cup } = this.world;
    const e = t * t * (3 - 2 * t);
    let dx = cup.x - tee.x, dz = cup.z - tee.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // Travel from just short of the green back to behind the tee
    const along = (len - 24) * (1 - e) - 9 * e;
    const side = Math.sin(e * Math.PI) * Math.min(26, len * 0.1);
    const x = tee.x + dx * along - dz * side;
    const z = tee.z + dz * along + dx * side;
    const y = this.ground(x, z) + 5 + Math.sin(e * Math.PI) * Math.min(30, len * 0.11) + (1 - e) * 5;
    this.wantPos.set(x, y, z);
    // Keep the flag in shot, then settle onto the line of the tee shot
    const k = Math.max(0, Math.min(1, (e - 0.72) / 0.28));
    const lk = k * k * (3 - 2 * k);
    const farX = tee.x + dx * Math.min(len, 60), farZ = tee.z + dz * Math.min(len, 60);
    this.wantLook.set(cup.x + (farX - cup.x) * lk, cup.y + 1.5, cup.z + (farZ - cup.z) * lk);
  }

  orbit(x, y, z, radius, height, angle) {
    this.mode = 'orbit';
    this.stiffness = 4;
    this.wantPos.set(x + Math.cos(angle) * radius, y + height, z + Math.sin(angle) * radius);
    this.wantLook.set(x, y + 0.3, z);
  }

  update(dt) {
    this.t += dt;
    // Never let the lens dip under the turf
    const minY = this.ground(this.wantPos.x, this.wantPos.z) + 0.9;
    if (this.wantPos.y < minY) this.wantPos.y = minY;
    // ...nor through a cave's roof
    const roof = this.world?.ceilingAt ? this.world.ceilingAt(this.wantPos.x, this.wantPos.z) - 3 : Infinity;
    if (this.wantPos.y > roof) this.wantPos.y = Math.max(minY, roof);

    if (this.snap) {
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
      this.snap = false;
    } else {
      const k = 1 - Math.exp(-this.stiffness * dt);
      this.pos.lerp(this.wantPos, k);
      this.look.lerp(this.wantLook, Math.min(1, k * 1.4));
    }
    const floor = this.ground(this.pos.x, this.pos.z) + 0.7;
    if (this.pos.y < floor) this.pos.y = floor;
    if (this.world?.ceilingAt) this.pos.y = Math.min(this.pos.y, Math.max(floor, this.world.ceilingAt(this.pos.x, this.pos.z) - 2.5));

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-9 * dt);
    }
    this.camera.lookAt(this.look);
  }
}

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
    const up = 2.1 + 3.4 * k;
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

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-9 * dt);
    }
    this.camera.lookAt(this.look);
  }
}

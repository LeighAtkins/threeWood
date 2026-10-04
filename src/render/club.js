import * as THREE from 'three';

/**
 * The club: a low-poly driver/iron/putter that swings in time with the meter.
 *
 * There is no golfer — just the club, pivoting about where the hands would
 * be. It is driven entirely by one angle, theta (0 = address, negative =
 * backswing, positive = follow-through), so the swing on screen IS the meter:
 * the head meets the ball at the exact moment the marker meets the line.
 */

const HANDS_UP = 1.25;    // pivot height above the ball
const HANDS_IN = 0.55;    // pivot offset toward the (right-handed) golfer

export class ClubRig {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const length = Math.hypot(HANDS_UP, HANDS_IN);
    this.length = length;
    const steel = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.4, metalness: 0.2, emissive: 0x555a60, transparent: true });
    const grip = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.9, transparent: true });
    const head = new THREE.MeshStandardMaterial({ color: 0x2b3442, emissive: 0x11161d, roughness: 0.35, metalness: 0.4, flatShading: true, transparent: true });
    const face = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4, flatShading: true, transparent: true });
    this.materials = [steel, grip, head, face];

    // Built hanging down -Y from the hands, head leading toward +X
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, length - 0.1, 6).translate(0, -(length - 0.1) / 2, 0), steel);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.34, 6).translate(0, -0.12, 0), grip);
    this.wood = new THREE.Group();
    this.wood.add(
      new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1).scale(1, 0.62, 1.25).translate(-0.09, 0, 0), head),
      new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.085, 0.2).translate(0.005, 0, 0), face));
    this.iron = new THREE.Group();
    this.iron.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.17).translate(-0.02, 0.01, 0), steel),
      new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.09, 0.16).translate(0.002, 0.01, 0), face));
    this.putter = new THREE.Group();
    this.putter.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.22).translate(-0.035, 0, 0), head),
      new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.22).translate(0.002, 0, 0), face));
    for (const h of [this.wood, this.iron, this.putter]) {
      h.position.y = -length + 0.03;
      this.group.add(h);
    }
    this.group.add(shaft, handle);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    this._f = new THREE.Vector3();
    this._d0 = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this.opacity = 1;
  }

  /**
   * @param {object} ball  position of the ball
   * @param {number} dirX,dirZ  aim direction
   * @param {number} theta  swing angle (radians)
   * @param {'wood'|'iron'|'putter'} kind
   * @param {number} size   visual scale (matches the drawn ball)
   * @param {number} opacity
   */
  pose(ball, dirX, dirZ, theta, kind, size, opacity) {
    if (opacity <= 0.01) { this.group.visible = false; return; }
    this.group.visible = true;
    this.wood.visible = kind === 'wood';
    this.iron.visible = kind === 'iron';
    this.putter.visible = kind === 'putter';
    if (opacity !== this.opacity) {
      this.opacity = opacity;
      for (const m of this.materials) m.opacity = opacity;
    }

    const f = this._f.set(dirX, 0, dirZ);
    // Hands sit up and to the golfer's side (left of the line for a right-hander)
    const px = ball.x + dirZ * HANDS_IN * size;
    const pz = ball.z - dirX * HANDS_IN * size;
    const py = ball.y + HANDS_UP * size;
    const d0 = this._d0.set(ball.x - px, ball.y - py, ball.z - pz).normalize();
    // The head travels d(theta) = d0·cos + f·sin: back and up, then through
    const c = Math.cos(theta), s = Math.sin(theta);
    const y = this._y.set(-(d0.x * c + f.x * s), -(d0.y * c + f.y * s), -(d0.z * c + f.z * s));
    const z = this._z.crossVectors(d0, f).normalize();
    const x = this._x.crossVectors(y, z);
    this._m.makeBasis(x, y, z);
    this.group.quaternion.setFromRotationMatrix(this._m);
    this.group.position.set(px, py, pz);
    this.group.scale.setScalar(size);
  }

  hide() { this.group.visible = false; }
}

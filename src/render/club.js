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

const LIE = Math.atan2(HANDS_IN, HANDS_UP); // shaft lean away from vertical
const HEAD_BACK = 0.1;                      // head sits this far behind the ball

/** A hosel: a short sleeve lying exactly along the shaft where it meets the head. */
function hosel(mat, radius, len) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, len, 8), mat);
  mesh.rotation.x = -LIE;
  mesh.position.set(0, Math.cos(LIE) * len * 0.5, -Math.sin(LIE) * len * 0.5);
  return mesh;
}

/**
 * Club heads are modelled in "head space": +X is the way the face points,
 * +Y is up, +Z runs from heel to toe, and the origin is the heel on the
 * ground — where the shaft comes in.
 */
function buildWood(mat) {
  const group = new THREE.Group();
  // Pear-shaped crown: a squashed sphere with the front sliced flat for a face
  const geo = new THREE.SphereGeometry(1, 14, 10);
  geo.scale(0.15, 0.085, 0.16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (x > 0.075) pos.setX(i, 0.075);
    // Taper the back toward the heel so it reads as a driver, not a ball
    if (x < 0) pos.setZ(i, z * (1 + x * 1.6));
    if (pos.getY(i) < -0.05) pos.setY(i, -0.05);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, mat.crown);
  body.position.set(-0.075, 0.062, 0.15);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.085, 0.23), mat.face);
  face.position.set(0.004, 0.058, 0.15);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.014, 0.2), mat.steel);
  sole.position.set(-0.09, 0.012, 0.15);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.014), mat.accent);
  mark.position.set(-0.03, 0.146, 0.15);
  // Shaft enters a third of the way back from the face
  for (const part of [body, face, sole, mark]) part.position.x += 0.035;
  group.add(body, face, sole, mark, hosel(mat.crown, 0.03, 0.2));
  return group;
}

function buildIron(mat) {
  const group = new THREE.Group();
  // The classic blade outline: low at the heel, tall at the toe
  const outline = new THREE.Shape();
  outline.moveTo(0.0, 0.0);
  outline.lineTo(0.2, 0.0);
  outline.quadraticCurveTo(0.25, 0.02, 0.24, 0.1);
  outline.lineTo(0.2, 0.145);
  outline.lineTo(0.03, 0.07);
  outline.lineTo(0.0, 0.0);
  const blade = new THREE.ExtrudeGeometry(outline, { depth: 0.035, bevelEnabled: false });
  blade.rotateY(-Math.PI / 2);   // outline now runs heel->toe along Z, thickness back along -X
  blade.rotateZ(0.42);           // loft: the top edge leans back
  const body = new THREE.Mesh(blade, mat.steel);
  // Dark grooves so the face reads as a face
  const grooves = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.15), mat.dark);
    g.position.set(0.003, 0.025 + i * 0.02, 0.125);
    grooves.add(g);
  }
  grooves.rotation.z = 0.42;
  // Cavity back: a dark recess with a thin gold badge
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.04, 0.13).rotateZ(0.42), mat.dark);
  back.position.set(-0.05, 0.028, 0.125);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.008, 0.07).rotateZ(0.42), mat.accent);
  badge.position.set(-0.052, 0.03, 0.125);
  group.add(body, grooves, back, badge, hosel(mat.steel, 0.024, 0.22));
  return group;
}

function buildPutter(mat) {
  const group = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.3), mat.steel);
  blade.position.set(-0.022, 0.04, 0.14);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.26), mat.face);
  face.position.set(0.003, 0.04, 0.14);
  // Mallet flange with a sight line down the middle
  const flangeGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.035, 12, 1, false, Math.PI / 2, Math.PI);
  const flange = new THREE.Mesh(flangeGeo, mat.crown);
  flange.position.set(-0.04, 0.022, 0.14);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.008, 0.014), mat.accent);
  sight.position.set(-0.09, 0.044, 0.14);
  // Heel-shafted: slide the head so the shaft meets the blade near the heel
  for (const part of [blade, face, flange, sight]) { part.position.z += 0.02; part.position.x += 0.02; }
  group.add(blade, face, flange, sight, hosel(mat.steel, 0.018, 0.16));
  return group;
}

export class ClubRig {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const length = Math.hypot(HANDS_UP, HANDS_IN);
    this.length = length;
    const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, transparent: true, ...o });
    const mat = {
      steel: std({ color: 0xe9eef2, roughness: 0.35, metalness: 0.35, emissive: 0x4a5058 }),
      grip: std({ color: 0x1c1f24, roughness: 0.95 }),
      crown: std({ color: 0x1f3a6e, roughness: 0.3, metalness: 0.3, emissive: 0x0c1730 }),
      face: std({ color: 0xcfd6dc, roughness: 0.5, metalness: 0.3, emissive: 0x3a3f45 }),
      accent: std({ color: 0xffd23f, roughness: 0.5, emissive: 0x5a4300 }),
      dark: std({ color: 0x2a2f36, roughness: 0.8 }),
    };
    this.materials = Object.values(mat);

    // Shaft hangs down -Y from the hands; the head hangs off its tip
    const shaftLen = length - 0.12;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, shaftLen, 6).translate(0, -shaftLen / 2, 0), mat.steel);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 0.42, 8).translate(0, -0.15, 0), mat.grip);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.02, 8).translate(0, 0.065, 0), mat.accent);
    this.wood = buildWood(mat);
    this.iron = buildIron(mat);
    this.putter = buildPutter(mat);
    for (const h of [this.wood, this.iron, this.putter]) {
      // Stand the head up so its sole is flat on the turf at address
      const holder = new THREE.Group();
      holder.position.y = -length;
      holder.rotation.x = LIE;
      holder.add(h);
      this.group.add(holder);
    }
    this.group.add(shaft, handle, cap);
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
    // The shaft tip (the heel) sits on the turf just behind and inside the ball
    const heel = (kind === 'putter' ? 0.14 : 0.15) * size;
    const tipX = ball.x - dirX * HEAD_BACK * size + dirZ * heel;
    const tipZ = ball.z - dirZ * HEAD_BACK * size - dirX * heel;
    const tipY = ball.y - 0.05;
    // Hands sit up and to the golfer's side (left of the line for a right-hander)
    const px = tipX + dirZ * HANDS_IN * size;
    const pz = tipZ - dirX * HANDS_IN * size;
    const py = tipY + HANDS_UP * size;
    const d0 = this._d0.set(tipX - px, tipY - py, tipZ - pz).normalize();
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

/**
 * The campsite: a dome tent, a log to sit on, a camp chair and a little table
 * with a lantern and a kettle, pitched round the fire (render/grill.js) for the
 * end of a round. Built facing +z; turn the group so +z points at the camera.
 */

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();

export function buildCampsite() {
  const group = new THREE.Group();
  const lam = (color, opts) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const rope = lam(0xf4ead8);
  const peg = lam(0x9aa0a6);
  const wood = lam(0x7a5632), cut = lam(0xe2c08a), bark = lam(0x5e3e26);
  const ropeGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 3).translate(0, 0.5, 0);
  const pegGeo = new THREE.ConeGeometry(0.022, 0.12, 4).rotateX(Math.PI).translate(0, 0.03, 0);
  /** A taut line from a to b (in the parent's space), pegged where it meets the ground. */
  const line = (parent, ax, ay, az, bx, by, bz) => {
    _a.set(bx - ax, by - ay, bz - az);
    const len = _a.length();
    const mesh = add(parent, ropeGeo, rope, ax, ay, az);
    mesh.scale.y = len;
    mesh.quaternion.setFromUnitVectors(UP, _a.normalize());
    mesh.castShadow = false;
    if (by < 0.05) add(parent, pegGeo, peg, bx, 0, bz);
  };

  // ---- A dome tent behind and to the right of the fire, door toward the camera ----------
  const tent = new THREE.Group();
  // Panels alternate two tones with a green skirt. The open door shows the inner tent,
  // which is unlit: by day a sunny yellow, after dark the whole doorway glows.
  const dome = new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  const pos = dome.attributes.position, outer = [], col = [], door = [];
  const fly = new THREE.Color(0xf2a03c), panel = new THREE.Color(0xfbe3b4), trim = new THREE.Color(0x5e7a52);
  for (let i = 0; i < pos.count; i += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(i + k) / 3; cy += pos.getY(i + k) / 3; cz += pos.getZ(i + k) / 3; }
    const into = cz > 0.55 && Math.abs(cx) < 0.36 && cy < 0.72 ? door : outer;
    const seg = Math.floor(((Math.atan2(cx, cz) + Math.PI) / (Math.PI * 2)) * 12) % 12;
    const c = cy < 0.2 ? trim : seg % 3 === 1 ? panel : fly;
    for (let k = 0; k < 3; k++) {
      into.push(pos.getX(i + k) * 1.3, pos.getY(i + k) * 1.05, pos.getZ(i + k) * 1.15);
      if (into === outer) col.push(c.r, c.g, c.b);
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(outer, 3));
  shell.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  shell.computeVertexNormals();
  const body = add(tent, shell, lam(0xffffff, { vertexColors: true }));
  body.receiveShadow = true;
  const doorway = new THREE.BufferGeometry();
  doorway.setAttribute('position', new THREE.Float32BufferAttribute(door, 3));
  // Set back a touch, so it reads as the inner tent behind the opening
  doorway.translate(0, 0, -0.06);
  add(tent, doorway, new THREE.MeshBasicMaterial({ color: 0xf0c060 })).castShadow = false;
  // Two poles arching over it, corner to corner
  const poleMat = lam(0x2f3a48);
  for (const turn of [Math.PI / 4, -Math.PI / 4]) {
    const pole = add(tent, new THREE.TorusGeometry(1, 0.018, 4, 14, Math.PI), poleMat);
    pole.scale.set(1.25, 1.07, 1);
    pole.rotation.y = turn;
  }
  // The door flap, rolled up and tied over the doorway
  const roll = add(tent, new THREE.CylinderGeometry(0.06, 0.06, 0.62, 7), lam(0xf7c46a), 0, 0.8, 0.82);
  roll.rotation.z = Math.PI / 2;
  // A doormat of groundsheet poking out
  add(tent, new THREE.BoxGeometry(0.8, 0.02, 0.35), lam(0x5e7a52), 0, 0.01, 1.2);
  // Guy-lines out from the shoulders, and pegs round the hem
  for (const a of [0.8, 2.35, 3.95, 5.5]) {
    const sx = Math.sin(a), sz = Math.cos(a);
    line(tent, sx * 1.0, 0.68, sz * 0.88, sx * 1.95, 0, sz * 1.75);
    add(tent, pegGeo, peg, sx * 1.3, 0, sz * 1.15);
  }
  tent.position.set(1.75, 0, -2.35);
  tent.rotation.y = -0.45;
  group.add(tent);

  // ---- A log to sit on, on the left: bark round the side, rings on the ends -------------
  const log = add(group, new THREE.CylinderGeometry(0.21, 0.23, 1.2, 9), [bark, cut, cut]);
  log.rotation.set(0, 0.5, Math.PI / 2);
  log.position.set(-1.25, 0.2, -0.15);
  log.receiveShadow = true;
  const knot = add(log, new THREE.CylinderGeometry(0.035, 0.05, 0.12, 5), bark, 0.2, 0.25, 0.08);
  knot.rotation.z = -1.1;

  // ---- A camp chair across the fire, angled in toward it -------------------------------------
  const chair = new THREE.Group();
  const frame = lam(0x2f3a48), sling = lam(0x4f8a8c);
  const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.42, 4);
  for (const x of [-0.2, 0.2]) {
    for (const z of [-1, 1]) {
      const leg = add(chair, legGeo, frame, x, 0.18, z * 0.08);
      leg.rotation.x = z * 0.55;
    }
  }
  const seat = add(chair, new THREE.BoxGeometry(0.44, 0.03, 0.38), sling, 0, 0.32, 0.02);
  seat.rotation.x = -0.12;
  const back = add(chair, new THREE.BoxGeometry(0.44, 0.48, 0.03), sling, 0, 0.56, -0.2);
  back.rotation.x = -0.28;
  for (const x of [-0.23, 0.23]) {
    const arm = add(chair, new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), frame, x, 0.52, -0.06);
    arm.rotation.x = -0.32;
  }
  chair.position.set(1.3, 0, 0.3);
  chair.rotation.y = -1.9;
  group.add(chair);

  // ---- A little table by the tent: lantern, kettle -----------------------------------------
  const table = new THREE.Group();
  const top = add(table, new THREE.BoxGeometry(0.62, 0.03, 0.38), lam(0xc9a06a), 0, 0.3, 0);
  top.receiveShadow = true;
  for (const x of [-1, 1]) {
    for (const r of [-0.42, 0.42]) {
      const leg = add(table, new THREE.CylinderGeometry(0.01, 0.01, 0.34, 4), frame, x * 0.26, 0.15, 0);
      leg.rotation.x = r;
    }
  }
  // Lantern: a warm glass in a dark cage, with a loop to carry it by
  const metal = lam(0x2f3a48);
  const lantern = new THREE.Group();
  add(lantern, new THREE.CylinderGeometry(0.075, 0.085, 0.04, 8), metal, 0, 0.02, 0);
  add(lantern, new THREE.CylinderGeometry(0.06, 0.06, 0.15, 8), new THREE.MeshBasicMaterial({ color: 0xffd98a }), 0, 0.115, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    add(lantern, new THREE.CylinderGeometry(0.006, 0.006, 0.16, 3), metal, Math.cos(a) * 0.066, 0.115, Math.sin(a) * 0.066);
  }
  add(lantern, new THREE.ConeGeometry(0.085, 0.06, 8), metal, 0, 0.22, 0);
  add(lantern, new THREE.TorusGeometry(0.04, 0.006, 4, 10, Math.PI), metal, 0, 0.25, 0);
  lantern.position.set(0.15, 0.315, 0.02);
  table.add(lantern);
  // Kettle: squat body, lid knob, spout and a bail handle
  const kettle = new THREE.Group();
  const enamel = lam(0xd9483b);
  const kb = add(kettle, new THREE.SphereGeometry(0.075, 10, 6), enamel, 0, 0.055, 0);
  kb.scale.set(1, 0.78, 1);
  add(kettle, new THREE.CylinderGeometry(0.05, 0.07, 0.03, 10), enamel, 0, 0.1, 0);
  add(kettle, new THREE.SphereGeometry(0.014, 6, 4), metal, 0, 0.12, 0);
  const spout = add(kettle, new THREE.CylinderGeometry(0.01, 0.016, 0.09, 6), enamel, 0.08, 0.075, 0);
  spout.rotation.z = -0.9;
  add(kettle, new THREE.TorusGeometry(0.06, 0.006, 4, 10, Math.PI), metal, 0, 0.11, 0);
  kettle.position.set(-0.15, 0.315, 0);
  table.add(kettle);
  table.position.set(0.5, 0, -1.35);
  table.rotation.y = 0.2;
  group.add(table);

  // ---- Firewood stacked by the chair, and a mug by the log -----------------------------------
  const splitGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.42, 5);
  [[-0.07, 0.055, 0], [0.07, 0.055, 0.02], [0, 0.15, 0.01]].forEach(([x, y, z], i) => {
    const s = add(group, splitGeo, [wood, cut, cut], 1.05 + x, y, -1.0 + z);
    s.rotation.set(Math.PI / 2, 0.3 + i * 0.1, 0, 'YXZ');
  });
  const mug = add(group, new THREE.CylinderGeometry(0.055, 0.05, 0.1, 10), lam(0xf4ead8), -0.75, 0.05, 0.45);
  add(mug, new THREE.TorusGeometry(0.03, 0.01, 4, 8), lam(0xf4ead8), 0.06, 0, 0);
  add(mug, new THREE.CircleGeometry(0.045, 10).rotateX(-Math.PI / 2), lam(0x6a3e22), 0, 0.045, 0);

  /** Where a camper sits on the log, and which way they face (model +z yaw), in group space. */
  group.userData.seat = { x: -1.2, z: -0.1, yaw: 1.05, y: 0.4 };
  group.userData.stand = { x: -0.8, z: 0.85, yaw: 0.45 };
  return group;
}

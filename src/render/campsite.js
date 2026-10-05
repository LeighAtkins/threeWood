/**
 * The campsite: a tent, a log to sit on and a lantern, pitched round the fire
 * (render/grill.js) for the end of a round. Built facing +z; turn the group so
 * +z points at the camera.
 */

import * as THREE from 'three';

export function buildCampsite() {
  const group = new THREE.Group();
  const lam = (color, opts) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });

  // A-frame tent behind and to the right of the fire, door toward the camera
  const tent = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-1.1, 0); shape.lineTo(1.1, 0); shape.lineTo(0, 1.35); shape.closePath();
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false }), lam(0xf0a33a));
  body.position.z = -2.2;
  tent.add(body);
  const door = new THREE.Shape();
  door.moveTo(-0.45, 0); door.lineTo(0.45, 0); door.lineTo(0, 0.95); door.closePath();
  const flap = new THREE.Mesh(new THREE.ShapeGeometry(door), lam(0x3a2a22));
  flap.position.z = 0.01;
  tent.add(flap);
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.5, 5), lam(0xfff4ea));
  ridge.rotation.x = Math.PI / 2;
  ridge.position.set(0, 1.36, -1.1);
  tent.add(ridge);
  tent.position.set(1.7, 0, -2.2);
  tent.rotation.y = -0.45;
  group.add(tent);

  // A log to sit on, on the left
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.2, 8), lam(0x6b4a2e));
  log.rotation.z = Math.PI / 2;
  log.rotation.y = 0.5;
  log.position.set(-1.25, 0.2, -0.15);
  group.add(log);

  // A lantern by the tent, and a mug by the fire
  const lantern = new THREE.Group();
  lantern.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.06, 8), lam(0x3a3a48)));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.18, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  glass.position.y = 0.12;
  lantern.add(glass);
  const lid = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.08, 8), lam(0x3a3a48));
  lid.position.y = 0.25;
  lantern.add(lid);
  lantern.position.set(0.55, 0.03, -1.3);
  group.add(lantern);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 8), lam(0xd9483b));
  mug.position.set(-0.75, 0.05, 0.45);
  group.add(mug);

  /** Where a camper sits on the log, and which way they face (model +z yaw), in group space. */
  group.userData.seat = { x: -1.2, z: -0.1, yaw: 1.05, y: 0.4 };
  group.userData.stand = { x: -0.8, z: 0.85, yaw: 0.45 };
  return group;
}

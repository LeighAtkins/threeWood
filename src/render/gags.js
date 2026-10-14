/**
 * Mischief you can see: a little rain cloud that follows someone about (the
 * Rain Cloud card), raining on their head. Shared by my own camper and the
 * friends'. One small group per cloud; drops are a handful of thin boxes
 * recycled as they fall.
 */

import * as THREE from 'three';

const puffGeo = new THREE.IcosahedronGeometry(1, 0);
const dropGeo = new THREE.BoxGeometry(0.012, 0.13, 0.012);
const puffMat = new THREE.MeshLambertMaterial({ color: 0x5a6270, flatShading: true });
const dropMat = new THREE.MeshBasicMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.6 });

export function makeRainCloud() {
  const g = new THREE.Group();
  g.name = 'rainCloud';
  for (const [x, y, z, s] of [[0, 0, 0, 0.42], [0.38, -0.04, 0.08, 0.32], [-0.36, -0.02, -0.06, 0.34], [0.1, 0.18, -0.05, 0.3], [-0.12, -0.06, 0.28, 0.26]]) {
    const p = new THREE.Mesh(puffGeo, puffMat);
    p.position.set(x, y, z);
    p.scale.set(s * 1.3, s, s * 1.1);
    g.add(p);
  }
  const drops = [];
  for (let i = 0; i < 12; i++) {
    const d = new THREE.Mesh(dropGeo, dropMat);
    d.userData.t = Math.random();
    d.userData.x = (Math.random() - 0.5) * 0.9;
    d.userData.z = (Math.random() - 0.5) * 0.6;
    g.add(d);
    drops.push(d);
  }
  g.userData.drops = drops;
  return g;
}

/**
 * Keep the cloud over (x, y, z) (the feet) at camper scale `s`, raining.
 * Never near the lens (`camera`): a cloud a few metres off fills the screen,
 * and nothing may hide a shot being lined up.
 */
export function updateRainCloud(cloud, dt, x, y, z, s, time, camera) {
  cloud.position.set(x, y + 1.75 * s + Math.sin(time * 1.3) * 0.04, z);
  cloud.scale.setScalar(s * 0.55);
  if (camera && camera.position.distanceToSquared(cloud.position) < 81) { cloud.visible = false; return; }
  for (const d of cloud.userData.drops) {
    d.userData.t = (d.userData.t + dt * 1.6) % 1;
    d.position.set(d.userData.x, -0.25 - d.userData.t * 1.9, d.userData.z);
  }
}

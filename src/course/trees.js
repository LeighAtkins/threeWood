import * as THREE from 'three';

/**
 * Parkland trees — chunky low-poly, two InstancedMeshes (2 draw calls total).
 * Trunk collision cylinders are registered on the terrain for ball physics.
 */

const CANOPY_PALETTE = [0x3F7A34, 0x4E8F3A, 0x5DA344, 0x6B8F3E, 0x478C41];

export function createTrees(spec, terrain, scene) {
  const group = new THREE.Group();
  group.name = 'trees';
  const colliders = [];

  const trees = spec.trees || [];
  if (trees.length === 0) return { group, colliders };

  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 1.6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6B4A2F, flatShading: true });
  const canopyGeo = new THREE.IcosahedronGeometry(1.15, 0);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, trees.length);
  trunks.castShadow = true;
  canopies.castShadow = true;

  const dummy = new THREE.Object3D();
  const canopyColor = new THREE.Color();
  const rng = terrain.gameRng.fork('tree-appearance').rng;

  trees.forEach((t, i) => {
    const groundY = terrain.getHeightAtPosition(t.x, t.z);
    const s = t.s || 1;

    // Trunk
    dummy.position.set(t.x, groundY + 0.8 * s, t.z);
    dummy.scale.setScalar(s);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    // Canopy: squashed icosahedron sitting on the trunk
    dummy.position.set(t.x, groundY + (1.6 + 0.9) * s, t.z);
    dummy.scale.set(s, s * 1.15, s);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);

    canopyColor.setHex(CANOPY_PALETTE[Math.floor(rng() * CANOPY_PALETTE.length)]);
    canopyColor.multiplyScalar(0.9 + rng() * 0.2);
    canopies.setColorAt(i, canopyColor);

    colliders.push({
      x: t.x,
      z: t.z,
      r: 0.3 * s,
      top: groundY + 2.6 * s, // above this the ball flies over
    });
  });

  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

  group.add(trunks);
  group.add(canopies);
  if (scene) scene.add(group);

  return { group, colliders };
}

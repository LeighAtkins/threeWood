/**
 * Baking a model built from many small primitives into a few meshes.
 *
 * The campers, Kuri and the props are put together from dozens of spheres,
 * tubes and boxes, which is lovely to author and costly to draw: every piece
 * is a draw call, twice over with shadows. Within each rigid part of a model
 * (a node whose children move together), pieces that share a material are
 * merged into one mesh. Pieces that are animated on their own (listed in
 * `keep`: a blinking eye, a moving brow, a mouth that is swapped) and any
 * node with children of its own are left alone, so poses, blinks and
 * expressions work exactly as before.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ATTRS = ['position', 'normal', 'uv'];

function mergeable(o, keep) {
  return o.isMesh && !o.isInstancedMesh && !keep.has(o) && o.children.length === 0 && o.visible &&
    !Array.isArray(o.material) && o.geometry.index && ATTRS.every((a) => o.geometry.attributes[a]);
}

/** Merge same-material leaf meshes under every node of root. Returns meshes removed. */
export function bakeStatic(root, keep = new Set()) {
  let removed = 0;
  const nodes = [];
  root.traverse((o) => nodes.push(o));
  for (const node of nodes) {
    const groups = new Map();
    for (const child of node.children) {
      if (!mergeable(child, keep)) continue;
      const key = `${child.material.uuid}|${child.castShadow}|${child.renderOrder}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!ATTRS.includes(name)) g.deleteAttribute(name);
        return g.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      mesh.renderOrder = list[0].renderOrder;
      for (const m of list) { node.remove(m); m.geometry.dispose(); }
      node.add(mesh);
      removed += list.length - 1;
    }
  }
  return removed;
}

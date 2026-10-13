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

const ATTRS = ['position', 'normal', 'uv', 'color', 'aGlow'];
const NEEDED = ['position', 'normal', 'uv'];

// ---- One material for many colours ----------------------------------------------
//
// A camper is painted in a dozen colours, each its own material, so pieces of
// different colours can never merge. unifyMaterials() writes each piece's
// colour into its vertices and swaps in one shared material (per kind and
// side), shared by every camper and Kuri: then the bake below can merge a
// whole rigid part into a single mesh, and every camper uses the same few
// shader programs, so a new friend appearing compiles nothing.

const shared = new Map();
function sharedFor(m) {
  const kind = m.isMeshToonMaterial ? 'toon' : m.isMeshBasicMaterial ? 'basic' : m.isMeshLambertMaterial ? 'lambert' : null;
  if (!kind) return null;
  const key = `${kind}|${m.side}|${m.gradientMap?.uuid || ''}|${!!m.flatShading}`;
  let mat = shared.get(key);
  if (!mat) {
    const opts = { vertexColors: true, side: m.side };
    if (kind === 'toon') mat = new THREE.MeshToonMaterial({ ...opts, gradientMap: m.gradientMap || null });
    else if (kind === 'basic') mat = new THREE.MeshBasicMaterial(opts);
    else mat = new THREE.MeshLambertMaterial({ ...opts, flatShading: m.flatShading });
    if (kind !== 'basic') {
      // Glow after dark in each piece's own colour: emissive x vertex colour
      // Each piece glows by its own amount too (aGlow): skin less than clothes,
      // or a cream hoodie and pale skin glow alike after dark and read as one
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vGlow;')
          .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb * vGlow;');
      };
    }
    mat.userData.shared = true;
    shared.set(key, mat);
  }
  return mat;
}

/** The shared materials (for setting their night glow). */
export const sharedMaterials = () => [...shared.values()];

/** Swap every opaque toon/basic/lambert piece under root onto a shared, vertex-coloured material. */
export function unifyMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || o.material.userData.shared) return;
    const m = o.material;
    if (m.transparent || m.map || m.vertexColors) return;
    const mat = sharedFor(m);
    if (!mat) return;
    const geo = o.geometry.clone(); // (geometries are sometimes shared between pieces)
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = m.color.r; c[i * 3 + 1] = m.color.g; c[i * 3 + 2] = m.color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(m.userData.glow ?? 1), 1));
    o.geometry = geo;
    o.material = mat;
  });
}

function mergeable(o, keep) {
  return o.isMesh && !o.isInstancedMesh && !keep.has(o) && o.children.length === 0 && o.visible &&
    !Array.isArray(o.material) && o.geometry.index && NEEDED.every((a) => o.geometry.attributes[a]);
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
      // (only merge pieces that agree on whether they carry vertex colours)
      if (new Set(list.map((m) => !!m.geometry.attributes.color)).size > 1) continue;
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

import * as THREE from 'three';
import { SURFACE_IDS } from '../course/courseWorld.js';
import { pathInfo, smoothstep, lerp } from '../course/shapes.js';
import { createGameRng } from '../core/rng.js';
import { terrainGlow } from './nightGlow.js';
import { pixelTexture } from './textures.js';

/**
 * Terrain mesh, built vertex-for-vertex from the world grid the physics uses.
 * Stylised look: colour IS the texture — flat-shaded facets, per-vertex
 * palette with mow stripes and mottling, plus one tiny tiling grain map so
 * surfaces never read as flat plastic up close.
 */

let grainTexture = null;

function getGrainTexture() {
  if (grainTexture) return grainTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = createGameRng('grain').rng;
  for (let i = 0; i < size * size; i++) {
    const v = 226 + Math.floor(rng() * 29);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // A few darker blades for directionality
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  for (let i = 0; i < 260; i++) {
    const x = rng() * size, y = rng() * size;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng() * 3 - 1.5, y - 3 - rng() * 4); ctx.stroke();
  }
  // Copied out of the canvas: iOS blanks canvases behind a backgrounded tab
  grainTexture = pixelTexture(canvas, { colorSpace: THREE.SRGBColorSpace, wrap: true });
  grainTexture.anisotropy = 4;
  return grainTexture;
}

export function buildTerrainMesh(world) {
  const { xs, zs, nx, nz, heights, types, biome, spec } = world;
  const count = nx * nz;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  // Mowing, drawn per pixel in the shader so the lines are crisp:
  // (stripe coordinate along the hole, fairway weight, green weight) and the
  // green's own (u, v) for its checkerboard
  const mow = new Float32Array(count * 3);
  const mowGreen = new Float32Array(count * 2);

  const noise = createGameRng(`${spec.seed}:paint-${spec.number}`).noise2D;
  const palette = {};
  for (const name of SURFACE_IDS) {
    palette[name] = new THREE.Color(name === 'water' ? biome.bed : name === 'bunker' ? biome.sand : biome[name]);
  }
  const deepRough = new THREE.Color(biome.deepRough);
  const c = new THREE.Color();

  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const i = ix * nz + iz;
      const x = xs[ix], z = zs[iz];
      const type = SURFACE_IDS[types[i]];
      positions[i * 3] = x;
      positions[i * 3 + 1] = heights[i];
      positions[i * 3 + 2] = z;
      uvs[i * 2] = x / 7;
      uvs[i * 2 + 1] = z / 7;

      c.copy(palette[type]);
      let shade = 1 + noise(x * 0.07 + 100, z * 0.07 - 100) * 0.06;
      if (type === 'fairway' || type === 'rough') {
        // Blend across the fairway edge so it reads as a mown line, not as
        // grid-sized stair steps
        const info = pathInfo(spec.path, x, z);
        const half = world.fairwayHalfAt(info.along);
        const w = (1 - smoothstep(half - 1.6, half + 1.6, info.dist)) * smoothstep(spec.fairwayStart - 2, spec.fairwayStart + 2, info.along);
        const far = Math.min(1, Math.max(0, (info.dist - 30) / 70));
        c.copy(palette.rough).lerp(deepRough, far * 0.8);
        // Mow stripes run across the line of play (drawn in the shader)
        shade *= lerp(1 + noise(x * 0.2, z * 0.2) * 0.07, 1, w);
        mow[i * 3] = info.along / 9;
        mow[i * 3 + 1] = w;
        c.lerp(palette.fairway, w);
      } else if (type === 'green') {
        const g = spec.green;
        const lx = (x - g.x) * Math.cos(-g.angle) - (z - g.z) * Math.sin(-g.angle);
        const lz = (x - g.x) * Math.sin(-g.angle) + (z - g.z) * Math.cos(-g.angle);
        mowGreen[i * 2] = lx / 2.6;
        mowGreen[i * 2 + 1] = lz / 2.6;
        mow[i * 3 + 2] = 1;
      }
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
  }

  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let ix = 0; ix < nx - 1; ix++) {
    for (let iz = 0; iz < nz - 1; iz++) {
      const a = ix * nz + iz, b = a + nz, cc = a + 1, d = b + 1;
      index[k++] = a; index[k++] = cc; index[k++] = b;
      index[k++] = b; index[k++] = cc; index[k++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aMow', new THREE.BufferAttribute(mow, 3));
  geometry.setAttribute('aMowGreen', new THREE.BufferAttribute(mowGreen, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    map: getGrainTexture(),
  });
  // Night golf: after dark the turf gives back its own colour, the mown grass most
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = terrainGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aMow;\nattribute vec2 aMowGreen;\nvarying vec3 vMow;\nvarying vec2 vMowGreen;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMow = aMow; vMowGreen = aMowGreen;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying vec3 vMow;\nvarying vec2 vMowGreen;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Mow lines: a square wave, softened by its own screen-space width so
        // distant stripes blend instead of shimmering
        float sw = clamp(sin(3.14159 * vMow.x) / max(fwidth(vMow.x) * 3.2, 0.02), -1.0, 1.0);
        float gu = clamp(sin(3.14159 * vMowGreen.x) / max(fwidth(vMowGreen.x) * 3.2, 0.02), -1.0, 1.0);
        float gv = clamp(sin(3.14159 * vMowGreen.y) / max(fwidth(vMowGreen.y) * 3.2, 0.02), -1.0, 1.0);
        diffuseColor.rgb *= 1.0 + sw * 0.085 * vMow.y + gu * gv * 0.07 * vMow.z;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lawn = smoothstep(0.0, 0.22, vColor.g - max(vColor.r, vColor.b));
        totalEmissiveRadiance += vColor.rgb * vec3(0.75, 1.15, 0.95) * uGlow * (0.3 + 0.9 * lawn);`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Apron: carries the rough colour out past the tile edge into the fog
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: deepRough.clone().lerp(palette.rough, 0.2) }),
  );
  // Always under the lowest ground on the tile: a gorge or a deep pond bed
  // that dipped below it was drawn as a flat dark sheet
  let lowest = Infinity;
  for (let i = 0; i < heights.length; i++) if (heights[i] < lowest) lowest = heights[i];
  apron.position.y = Math.min(biome.base - biome.amp1 - 0.6, lowest - 1.5);
  mesh.add(apron);

  return mesh;
}

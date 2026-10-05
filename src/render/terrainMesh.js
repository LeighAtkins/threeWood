import * as THREE from 'three';
import { SURFACE_IDS } from '../course/courseWorld.js';
import { pathInfo, smoothstep, lerp } from '../course/shapes.js';
import { createGameRng } from '../core/rng.js';
import { terrainGlow } from './nightGlow.js';

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
  grainTexture = new THREE.CanvasTexture(canvas);
  grainTexture.wrapS = grainTexture.wrapT = THREE.RepeatWrapping;
  grainTexture.colorSpace = THREE.SRGBColorSpace;
  grainTexture.anisotropy = 4;
  return grainTexture;
}

export function buildTerrainMesh(world) {
  const { xs, zs, nx, nz, heights, types, biome, spec } = world;
  const count = nx * nz;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

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
        // Mow stripes run across the line of play
        const stripe = Math.floor(info.along / 9) % 2 === 0 ? 1.045 : 0.955;
        shade *= lerp(1 + noise(x * 0.2, z * 0.2) * 0.07, stripe, w);
        c.lerp(palette.fairway, w);
      } else if (type === 'green') {
        const g = spec.green;
        const lx = (x - g.x) * Math.cos(-g.angle) - (z - g.z) * Math.sin(-g.angle);
        const lz = (x - g.x) * Math.sin(-g.angle) + (z - g.z) * Math.cos(-g.angle);
        shade *= (Math.floor(lx / 3 + 100) + Math.floor(lz / 3 + 100)) % 2 === 0 ? 1.03 : 0.97;
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
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
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
  apron.position.y = biome.base - biome.amp1 - 0.6;
  mesh.add(apron);

  return mesh;
}

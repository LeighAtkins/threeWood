import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createGameRng } from '../core/rng.js';
import { CUP_R } from '../core/ballSim.js';
import { pathInfo, pointAlongPath } from '../course/shapes.js';

/**
 * Everything on a hole that is not the ground: trees, water, the flag and
 * cup, tee markers, tufts and flowers, the far hills and the clouds.
 * Instanced wherever there is more than one of a thing.
 */

function treeGeometries(kind) {
  if (kind === 'pine') {
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6).translate(0, 1.2, 0);
    const tiers = [
      new THREE.ConeGeometry(2.5, 3.6, 7).translate(0, 3.6, 0),
      new THREE.ConeGeometry(2.0, 3.2, 7).translate(0, 5.6, 0),
      new THREE.ConeGeometry(1.4, 3.0, 7).translate(0, 7.6, 0),
    ];
    return { trunk, canopy: mergeGeometries(tiers) };
  }
  if (kind === 'scrub') {
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1.4, 5).translate(0, 0.7, 0);
    const blobs = [
      new THREE.IcosahedronGeometry(1.7, 0).scale(1.15, 0.8, 1).translate(0, 2.2, 0),
      new THREE.IcosahedronGeometry(1.1, 0).translate(1.1, 1.8, 0.5),
    ];
    return { trunk, canopy: mergeGeometries(blobs) };
  }
  const trunk = new THREE.CylinderGeometry(0.26, 0.4, 3.6, 6).translate(0, 1.8, 0);
  const blobs = [
    new THREE.IcosahedronGeometry(2.8, 0).scale(1, 1.1, 1).translate(0, 5.7, 0),
    new THREE.IcosahedronGeometry(1.8, 0).translate(1.7, 4.6, 0.6),
    new THREE.IcosahedronGeometry(1.6, 0).translate(-1.5, 4.9, -0.9),
  ];
  return { trunk, canopy: mergeGeometries(blobs) };
}

function buildTrees(world, rng) {
  const group = new THREE.Group();
  const trees = world.trees;
  if (!trees.length) return group;
  const { biome } = world;
  const geo = treeGeometries(biome.treeKind);
  const trunks = new THREE.InstancedMesh(
    geo.trunk, new THREE.MeshLambertMaterial({ color: biome.trunk, flatShading: true }), trees.length);
  const canopies = new THREE.InstancedMesh(
    geo.canopy, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length);
  trunks.castShadow = canopies.castShadow = true;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  trees.forEach((t, i) => {
    dummy.position.set(t.x, t.y - 0.1, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    canopies.setMatrixAt(i, dummy.matrix);
    color.setHex(biome.canopy[Math.floor(rng() * biome.canopy.length)]).multiplyScalar(0.9 + rng() * 0.2);
    canopies.setColorAt(i, color);
  });
  canopies.instanceColor.needsUpdate = true;
  group.add(trunks, canopies);
  return group;
}

// --- Water -------------------------------------------------------------------

const waterUniforms = { uTime: { value: 0 } };

function buildWater(world) {
  const group = new THREE.Group();
  for (const p of world.ponds) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: new THREE.Color(world.biome.water) }, uSky: { value: new THREE.Color(world.biome.skyHorizon) } },
      ]),
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform vec3 uSky;
        uniform float uTime;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec2 p = vWorld.xz;
          float w = sin(p.x * 0.9 + uTime * 1.3) * sin(p.y * 0.8 - uTime * 1.1)
                  + sin((p.x + p.y) * 0.45 + uTime * 0.7);
          float glint = smoothstep(1.25, 1.6, w + sin(p.x * 2.3 - uTime * 2.0) * 0.4);
          vec3 view = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
          vec3 col = mix(uColor, uSky, fresnel * 0.65) + w * 0.025 + glint * 0.35;
          gl_FragColor = vec4(col, 0.86);
          #include <fog_fragment>
        }`,
    });
    material.uniforms.uTime = waterUniforms.uTime;
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(p.r * 1.65, 36).rotateX(-Math.PI / 2), material);
    mesh.position.set(p.x, p.level, p.z);
    group.add(mesh);
  }
  return group;
}

// --- Flag + cup ----------------------------------------------------------------

function buildFlag(world) {
  const group = new THREE.Group();
  const { cup } = world;
  group.position.set(cup.x, cup.y, cup.z);

  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(CUP_R, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x10140f }));
  hole.position.y = 0.012;
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(CUP_R, CUP_R * 1.16, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  rim.position.y = 0.014;
  group.add(hole, rim);

  const stick = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xfff6d8, transparent: true });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.4, 6).translate(0, 1.7, 0), poleMat);
  pole.castShadow = true;
  const clothGeo = new THREE.PlaneGeometry(1.25, 0.8, 8, 3).translate(0.625, 0, 0);
  const clothMat = new THREE.MeshLambertMaterial({ color: 0xff3b3b, side: THREE.DoubleSide, transparent: true });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.y = 2.95;
  cloth.castShadow = true;
  stick.add(pole, cloth);
  group.add(stick);

  // Flag flies downwind
  const w = world.spec.wind;
  stick.rotation.y = w.speed > 0 ? -Math.atan2(w.z, w.x) : 0;

  const rest = clothGeo.attributes.position.array.slice();
  group.userData = { stick, cloth, rest, poleMat, clothMat, windSpeed: w.speed, fade: 1 };
  return group;
}

export function updateFlag(flag, time, hidden) {
  const u = flag.userData;
  const pos = u.cloth.geometry.attributes.position;
  const amp = 0.05 + Math.min(0.2, u.windSpeed * 0.014);
  const rate = 3 + u.windSpeed * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = u.rest[i * 3];
    pos.setZ(i, Math.sin(x * 4.5 - time * rate) * amp * (x / 1.25));
    pos.setY(i, u.rest[i * 3 + 1] - (0.25 - Math.min(0.22, u.windSpeed * 0.02)) * x * x * 0.5);
  }
  pos.needsUpdate = true;
  // The pin fades out of the way while putting
  u.fade += ((hidden ? 0.12 : 1) - u.fade) * 0.12;
  u.poleMat.opacity = u.clothMat.opacity = u.fade;
}

// --- Small dressing ---------------------------------------------------------------

function buildTeeMarkers(world) {
  const group = new THREE.Group();
  const p = pointAlongPath(world.spec.path, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff5a3c, flatShading: true });
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat);
    const x = world.tee.x - p.dirZ * side * 1.6 + p.dirX * 0.3;
    const z = world.tee.z + p.dirX * side * 1.6 + p.dirZ * 0.3;
    m.position.set(x, world.heightAt(x, z) + 0.14, z);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

function buildGroundCover(world, rng, lowDetail) {
  const group = new THREE.Group();
  const { spec, biome } = world;
  const tuftCount = lowDetail ? 420 : 900;
  const flowerCount = lowDetail ? 90 : 220;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const scatter = (count, geometry, material, paint, sizeRange) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    let n = 0;
    for (let tries = 0; tries < count * 6 && n < count; tries++) {
      const along = rng() * world.length;
      const p = pointAlongPath(spec.path, along);
      const across = (rng() < 0.5 ? -1 : 1) * (spec.fairwayHalf + 4 + rng() * rng() * 60);
      const x = p.x - p.dirZ * across, z = p.z + p.dirX * across;
      if (Math.abs(x) > world.half || Math.abs(z) > world.half) continue;
      if (world.surfaceAt(x, z) !== 'rough') continue;
      if (pathInfo(spec.path, x, z).dist < spec.fairwayHalf + 2) continue;
      const s = sizeRange[0] + rng() * (sizeRange[1] - sizeRange[0]);
      dummy.position.set(x, world.heightAt(x, z), z);
      dummy.rotation.y = rng() * 6.28;
      dummy.scale.set(s, s * (0.8 + rng() * 0.6), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      paint(color);
      mesh.setColorAt(n, color);
      n++;
    }
    mesh.count = n;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  };

  const rough = new THREE.Color(biome.rough);
  scatter(
    tuftCount,
    new THREE.ConeGeometry(0.35, 0.9, 4).translate(0, 0.4, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    (c) => c.copy(rough).multiplyScalar(0.8 + rng() * 0.45),
    [0.6, 1.5],
  );
  scatter(
    flowerCount,
    new THREE.IcosahedronGeometry(0.16, 0).translate(0, 0.32, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    (c) => c.setHex(biome.flowers[Math.floor(rng() * biome.flowers.length)]),
    [0.7, 1.4],
  );
  return group;
}

function buildBackdrop(world, rng) {
  const group = new THREE.Group();
  const { biome } = world;

  // Far hills ring the tile and dissolve into the fog
  const hillMat = new THREE.MeshLambertMaterial({ color: biome.hills, flatShading: true });
  const hillGeos = [];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.2;
    const r = 420 + rng() * 160;
    const w = 90 + rng() * 110;
    const h = 28 + rng() * (biome.id === 'pines' ? 95 : 55);
    hillGeos.push(new THREE.ConeGeometry(w, h, 6 + Math.floor(rng() * 3))
      .rotateY(rng() * 3)
      .scale(1.6, 1, 1)
      .rotateY(-a)
      .translate(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r));
  }
  group.add(new THREE.Mesh(mergeGeometries(hillGeos), hillMat));

  // Chunky clouds
  const cloudGeos = [];
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const r = 180 + rng() * 420;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 130 + rng() * 70;
    const puffs = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < puffs; j++) {
      const s = 16 + rng() * 20;
      cloudGeos.push(new THREE.IcosahedronGeometry(s, 0)
        .scale(1.5, 0.55, 1)
        .translate(cx + (j - puffs / 2) * s * 1.1, cy + rng() * 6, cz + rng() * 14));
    }
  }
  const clouds = new THREE.Mesh(
    mergeGeometries(cloudGeos),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, emissive: 0x666666 }));
  clouds.name = 'clouds';
  group.add(clouds);
  group.userData.clouds = clouds;
  return group;
}

/** Build all dressing for a hole. Returns { group, flag, clouds }. */
export function buildScenery(world, { lowDetail = false } = {}) {
  const rng = createGameRng(`${world.spec.seed}:scenery-${world.spec.number}`).rng;
  const group = new THREE.Group();
  group.name = 'scenery';
  const flag = buildFlag(world);
  const backdrop = buildBackdrop(world, rng);
  group.add(
    buildTrees(world, rng),
    buildWater(world),
    flag,
    buildTeeMarkers(world),
    buildGroundCover(world, rng, lowDetail),
    backdrop,
  );
  return { group, flag, clouds: backdrop.userData.clouds };
}

export function updateScenery(scenery, time, dt) {
  waterUniforms.uTime.value = time;
  scenery.clouds.rotation.y += dt * 0.004;
}

export function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose?.();
  });
}

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

// Shared by every pond, and fed from the sky each frame
const waterUniforms = {
  uTime: { value: 0 },
  uSky: { value: new THREE.Color(0xcfeaff) },
  uTint: { value: new THREE.Color(0xffffff) },
  uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
  uLightColor: { value: new THREE.Color(0xffffff) },
};

function buildWater(world) {
  const group = new THREE.Group();
  for (const p of world.ponds) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: new THREE.Color(world.biome.water) } },
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
        uniform vec3 uTint;
        uniform vec3 uLightDir;
        uniform vec3 uLightColor;
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
          vec3 col = mix(uColor * uTint, uSky, fresnel * 0.65) + (w * 0.025 + glint * 0.35) * uTint;
          // The sun (or moon) lays a broken path of light across the water
          vec3 ripple = normalize(vec3(sin(p.x * 1.7 + uTime * 1.6) * 0.07, 1.0, sin(p.y * 1.9 - uTime * 1.3) * 0.07));
          float path = pow(max(dot(reflect(-view, ripple), uLightDir), 0.0), 140.0);
          col += uLightColor * path * (0.5 + glint);
          gl_FragColor = vec4(col, 0.86);
          #include <fog_fragment>
        }`,
    });
    Object.assign(material.uniforms, waterUniforms);
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
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xfff6d8, emissive: 0xfff6d8, emissiveIntensity: 0, transparent: true });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.4, 6).translate(0, 1.7, 0), poleMat);
  pole.castShadow = true;
  const clothGeo = new THREE.PlaneGeometry(1.25, 0.8, 8, 3).translate(0.625, 0, 0);
  const clothMat = new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 0, side: THREE.DoubleSide, transparent: true });
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

// --- Fireflies ----------------------------------------------------------------

const fireflyUniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uScale: { value: 300 } };

/** Sparks that come out among the trees and the long grass after dark. */
function buildFireflies(world, rng, lowDetail) {
  const count = lowDetail ? 70 : 140;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const { spec } = world;
  let n = 0;
  for (let tries = 0; tries < count * 8 && n < count; tries++) {
    let x, z;
    if (world.trees.length && rng() < 0.6) {
      const t = world.trees[Math.floor(rng() * world.trees.length)];
      x = t.x + (rng() - 0.5) * 14; z = t.z + (rng() - 0.5) * 14;
    } else {
      const p = pointAlongPath(spec.path, rng() * world.length);
      const across = (rng() < 0.5 ? -1 : 1) * (spec.fairwayHalf + 2 + rng() * 22);
      x = p.x - p.dirZ * across; z = p.z + p.dirX * across;
    }
    if (Math.abs(x) > world.half || Math.abs(z) > world.half || world.surfaceAt(x, z) !== 'rough') continue;
    pos[n * 3] = x; pos[n * 3 + 1] = world.heightAt(x, z) + 0.5 + rng() * 2.6; pos[n * 3 + 2] = z;
    seed[n++] = rng();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed.subarray(0, n), 1));
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: fireflyUniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uNight, uScale;
      varying float vGlow;
      void main() {
        float t = uTime * (0.25 + aSeed * 0.3) + aSeed * 60.0;
        vec3 p = position + vec3(sin(t * 1.3) * 1.6, sin(t * 2.1 + aSeed * 9.0) * 0.5, cos(t * 1.1) * 1.6);
        // Each one blinks to its own slow rhythm
        vGlow = uNight * smoothstep(0.15, 0.9, sin(uTime * (0.9 + aSeed * 1.4) + aSeed * 40.0) * 0.5 + 0.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uScale * (0.5 + aSeed * 0.5) / -mv.z, 1.5, 22.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (smoothstep(1.0, 0.0, d) * 0.55 + smoothstep(0.35, 0.0, d)) * vGlow;
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.35) * a, a);
      }`,
  }));
  points.frustumCulled = false;
  points.visible = false;
  return points;
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
  // Own stream: adding fireflies must not reshuffle the rest of the dressing
  const fireflies = buildFireflies(world, createGameRng(`${world.spec.seed}:fireflies-${world.spec.number}`).rng, lowDetail);
  group.add(
    buildTrees(world, rng),
    buildWater(world),
    flag,
    buildTeeMarkers(world),
    buildGroundCover(world, rng, lowDetail),
    backdrop,
    fireflies,
  );
  return { group, flag, clouds: backdrop.userData.clouds, fireflies };
}

/** Point sprites are sized in device pixels: tell them how tall the canvas is. */
export function setSceneryViewport(heightPx) {
  fireflyUniforms.uScale.value = heightPx * 0.3;
}

export function updateScenery(scenery, time, dt, sky) {
  waterUniforms.uTime.value = time;
  scenery.clouds.rotation.y += dt * 0.004;
  if (!sky) return;
  // Everything that is not lit by the scene lights takes its cue from the sky
  waterUniforms.uSky.value.copy(sky.look.horizon);
  waterUniforms.uTint.value.copy(sky.tint);
  waterUniforms.uLightDir.value.copy(sky.lightDir);
  waterUniforms.uLightColor.value.copy(sky.lightColor).multiplyScalar(0.25 + 0.75 * sky.dim);
  // Clouds keep a little of the lit colour in their shade, and sink back after dark
  scenery.clouds.material.emissive.copy(sky.look.cloud).lerp(sky.look.cloudLit, 0.3);
  scenery.clouds.material.color.setScalar(1 - 0.7 * sky.night);
  fireflyUniforms.uTime.value = time;
  fireflyUniforms.uNight.value = sky.night;
  scenery.fireflies.visible = sky.night > 0.02;
  // After dark the pin carries a little light of its own, so it can be found
  const { poleMat, clothMat } = scenery.flag.userData;
  poleMat.emissiveIntensity = clothMat.emissiveIntensity = sky.night * 0.45;
}

export function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose?.();
  });
}

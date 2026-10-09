import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createGameRng } from '../core/rng.js';
import { CUP_R } from '../core/ballSim.js';
import { pathInfo, pointAlongPath } from '../course/shapes.js';
import { buildProps } from './props.js';

/**
 * Everything on a hole that is not the ground: water (or lava), the flag and
 * cup, tee markers, tufts and flowers, the clouds, and whatever is drifting
 * through the air. The solid dressing — trees, props, set pieces and the
 * horizon — is grown per biome in props.js.
 */

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
        { uColor: { value: new THREE.Color(world.biome.water) }, uLava: { value: world.biome.liquid === 'lava' ? 1 : 0 } },
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
        uniform float uLava;
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
          if (uLava > 0.5) {
            // Lava makes its own light: slow bright veins between cooling crust
            float veins = sin(p.x * 0.55 + sin(p.y * 0.4 + uTime * 0.25) * 2.0) * sin(p.y * 0.5 - uTime * 0.2 + sin(p.x * 0.3) * 2.0);
            float crust = smoothstep(0.15, 0.75, abs(veins));
            col = mix(vec3(1.0, 0.72, 0.2), uColor * 0.9, smoothstep(0.0, 0.18, abs(veins)));
            col = mix(col, vec3(0.16, 0.05, 0.03), crust * 0.85) + vec3(0.5, 0.12, 0.0) * glint;
          }
          gl_FragColor = vec4(col, mix(0.86, 1.0, uLava));
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

  // The cup is a decal, not a real hole in the mesh, so it must lie exactly
  // on the green: tipped to the slope under it, and biased toward the camera
  // so no part of it sinks into the turf. Three layers fake the depth: the
  // soil wall, a dark floor that slides toward the viewer (leaving a crescent
  // of far wall showing), and the white lip on top.
  const grad = [0, 0];
  world.gradAt(cup.x, cup.z, grad);
  const lie = new THREE.Group();
  lie.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-grad[0], 1, -grad[1]).normalize());
  const decal = (geometry, color, order) => {
    const mesh = new THREE.Mesh(geometry.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    }));
    mesh.position.y = 0.02;
    mesh.renderOrder = order;
    return mesh;
  };
  const r = cup.r || CUP_R; // the bucket hole's cup is a paddling pool
  const wall = decal(new THREE.CircleGeometry(r, 40), 0x7a6548, 1);
  const floor = decal(new THREE.CircleGeometry(r * 0.86, 40), 0x0c0f0b, 1.1);
  const rim = decal(new THREE.RingGeometry(r * 0.97, r * (r > CUP_R ? 1.08 : 1.15), 48), 0xffffff, 1.2);
  lie.add(wall, floor, rim);
  group.add(lie);

  const stick = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xfff6d8, emissive: 0xfff6d8, emissiveIntensity: 0, transparent: true });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.4, 6).translate(0, 1.7, 0), poleMat);
  pole.castShadow = true;
  // A little ball on top of the pin
  pole.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6).translate(0, 3.42, 0), poleMat));
  // A pennant with a swallowtail notch cut in the fly end
  const clothGeo = new THREE.PlaneGeometry(1.25, 0.8, 8, 4).translate(0.625, 0, 0);
  const cp = clothGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i);
    cp.setX(i, x - (x / 1.25) ** 3 * (0.4 - Math.abs(y)) * 0.75);
  }
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
  group.userData = { stick, cloth, rest, poleMat, clothMat, windSpeed: w.speed, fade: 1, floor, lie };
  return group;
}

const _toCam = new THREE.Vector3();

export function updateFlag(flag, time, hidden, camera) {
  const u = flag.userData;
  if (camera) {
    // Slide the cup floor toward the viewer: the lower the camera, the more
    // of the far wall shows — which is what makes it read as a hole
    _toCam.copy(camera.position).sub(flag.position);
    const flat = Math.hypot(_toCam.x, _toCam.z) || 1;
    const low = flat / Math.hypot(flat, _toCam.y);
    u.lie.worldToLocal(_toCam.add(flag.position));
    const len = Math.hypot(_toCam.x, _toCam.z) || 1;
    const slide = CUP_R * 0.12 * (0.25 + 0.75 * low);
    u.floor.position.x = (_toCam.x / len) * slide;
    u.floor.position.z = (_toCam.z / len) * slide;
  }
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
  // Each marker is a little cut stump with a big red ball sat on it
  const stumpGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.18, 8).translate(0, 0.09, 0);
  const ballGeo = new THREE.IcosahedronGeometry(0.15, 1).translate(0, 0.32, 0);
  const bandGeo = new THREE.TorusGeometry(0.15, 0.022, 4, 12).rotateX(Math.PI / 2).translate(0, 0.32, 0);
  const bark = new THREE.MeshLambertMaterial({ color: 0x8a6040, flatShading: true });
  const cut = new THREE.MeshLambertMaterial({ color: 0xe2c08a, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0xff5a3c, flatShading: true });
  const white = new THREE.MeshLambertMaterial({ color: 0xfff6e4, flatShading: true });
  for (const side of [1, -1]) {
    const m = new THREE.Group();
    m.add(new THREE.Mesh(stumpGeo, [bark, cut, cut]), new THREE.Mesh(ballGeo, red), new THREE.Mesh(bandGeo, white));
    const x = world.tee.x - p.dirZ * side * 1.6 + p.dirX * 0.3;
    const z = world.tee.z + p.dirX * side * 1.6 + p.dirZ * 0.3;
    m.position.set(x, world.heightAt(x, z) - 0.03, z);
    m.children.forEach((c) => { c.castShadow = true; });
    group.add(m);
  }
  return group;
}

/** A tuft: five blades fanning out from one root, the middle one tallest. */
function tuftGeometry() {
  const blades = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3, tall = i === 0 ? 0.95 : 0.6 + (i % 2) * 0.18;
    const lean = i === 0 ? 0.08 : 0.42;
    const blade = new THREE.ConeGeometry(0.11, tall, 3, 1, true).translate(0, tall / 2, 0);
    blade.rotateZ(lean);
    blade.rotateY(a);
    blades.push(blade);
  }
  return mergeGeometries(blades);
}

function buildGroundCover(world, rng, lowDetail) {
  const group = new THREE.Group();
  const { spec, biome } = world;
  const tuftCount = Math.round((lowDetail ? 420 : 900) * (biome.tufts ?? 1));
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

  const rough = new THREE.Color(biome.tuft);
  scatter(
    tuftCount,
    tuftGeometry(),
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

// --- Weather in the air ---------------------------------------------------------

// fall: yards/s downwards (negative rises)   sway: sideways wander   wind: how far the wind carries it
const AMBIENT = {
  snow:   { count: 420, size: 0.16, fall: 2.4, sway: 0.7, wind: 0.5, glow: false },
  leaves: { count: 150, size: 0.3, fall: 1.5, sway: 1.8, wind: 0.6, glow: false },
  petals: { count: 240, size: 0.17, fall: 0.9, sway: 1.5, wind: 0.6, glow: false },
  embers: { count: 200, size: 0.14, fall: -1.7, sway: 1.0, wind: 0.3, glow: true },
  spores: { count: 170, size: 0.15, fall: -0.25, sway: 0.9, wind: 0.2, glow: true },
  pollen: { count: 90, size: 0.09, fall: 0.15, sway: 0.8, wind: 0.3, glow: false },
  dust:   { count: 170, size: 0.1, fall: 0.1, sway: 0.6, wind: 1.4, glow: false },
};
const AMBIENT_BOX = 64;
const ambientShared = { uTime: { value: 0 }, uScale: { value: 300 }, uTint: { value: new THREE.Color(0xffffff) } };

/** Snow, petals, leaves, embers: a box of drifting specks that travels with the camera. */
function buildAmbient(world, lowDetail) {
  if (!world.biome.ambient) return null;
  const [kind, colours] = world.biome.ambient;
  const cfg = AMBIENT[kind];
  const count = Math.round(cfg.count * (lowDetail ? 0.6 : 1));
  const rng = createGameRng(`ambient-${kind}`).rng;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), seed = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng() * AMBIENT_BOX; pos[i * 3 + 1] = rng() * AMBIENT_BOX; pos[i * 3 + 2] = rng() * AMBIENT_BOX;
    c.setHex(colours[Math.floor(rng() * colours.length)]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    seed[i] = rng();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const w = world.spec.wind;
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: {
      ...ambientShared,
      uDrift: { value: new THREE.Vector3(w.x * 0.45 * cfg.wind, -cfg.fall, w.z * 0.45 * cfg.wind) },
      uSway: { value: cfg.sway }, uSize: { value: cfg.size }, uGlow: { value: cfg.glow ? 1 : 0 },
    },
    transparent: true, depthWrite: false, vertexColors: true,
    blending: cfg.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uScale, uSway, uSize, uGlow;
      uniform vec3 uDrift, uTint;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float box = ${AMBIENT_BOX}.0;
        vec3 p = position + uDrift * uTime * (0.7 + aSeed * 0.6);
        p.x += sin(uTime * (0.5 + aSeed) + aSeed * 40.0) * uSway;
        p.z += cos(uTime * (0.4 + aSeed * 0.8) + aSeed * 70.0) * uSway;
        // Wrap the box around wherever the camera is
        p = mod(p - cameraPosition, box) - box * 0.5;
        float edge = 1.0 - smoothstep(box * 0.36, box * 0.5, length(p));
        vec4 mv = viewMatrix * vec4(p + cameraPosition, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uScale * uSize * (0.6 + aSeed * 0.8) / max(0.5, -mv.z), 1.0, 26.0);
        float flicker = mix(1.0, 0.55 + 0.45 * sin(uTime * (3.0 + aSeed * 5.0) + aSeed * 30.0), uGlow);
        vColor = color * mix(uTint, vec3(1.0), uGlow);
        vAlpha = edge * flicker * smoothstep(0.6, 3.0, -mv.z);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.55, d) * vAlpha;
        gl_FragColor = vec4(vColor * a, a);
        #include <colorspace_fragment>
      }`,
  }));
  points.material.premultipliedAlpha = true;
  points.frustumCulled = false;
  points.renderOrder = 4;
  return points;
}

function buildClouds(rng) {
  const group = new THREE.Group();

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
  const backdrop = buildClouds(rng);
  // Own streams: growing the props must not reshuffle anything else
  const props = buildProps(world, createGameRng(`${world.spec.seed}:props-${world.spec.number}`).rng, { lowDetail });
  const ambient = buildAmbient(world, lowDetail);
  // Own stream: adding fireflies must not reshuffle the rest of the dressing
  const fireflies = buildFireflies(world, createGameRng(`${world.spec.seed}:fireflies-${world.spec.number}`).rng, lowDetail);
  group.add(
    props.trees, props.props, props.backdrop, props.glow,
    buildWater(world),
    flag,
    buildTeeMarkers(world),
    buildGroundCover(world, rng, lowDetail),
    backdrop,
    fireflies,
  );
  if (ambient) group.add(ambient);
  return { group, flag, clouds: backdrop.userData.clouds, fireflies, ambient, glow: props.glow, placed: props.placed };
}

/** Point sprites are sized in device pixels: tell them how tall the canvas is. */
export function setSceneryViewport(heightPx) {
  fireflyUniforms.uScale.value = heightPx * 0.3;
  ambientShared.uScale.value = heightPx * 0.9;
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
  ambientShared.uTime.value = time;
  ambientShared.uTint.value.copy(sky.tint);
  // Lit windows and lanterns sit back a little by day and come up at dusk
  scenery.glow.material.color.setScalar(0.72 + 0.4 * sky.night);
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

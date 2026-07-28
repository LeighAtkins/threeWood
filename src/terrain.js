import * as THREE from 'three';
import { createGameRng } from './core/rng.js';
import { designHole, pathLength, pointAlongPath, pathInfo } from './course/holeDesigner.js';

/**
 * Terrain generation for ThreeWood.
 *
 * Builds one hole from a HoleSpec (see course/holeDesigner.js). A single
 * unified height function — surfaceHeight(x, z) — drives BOTH the visual
 * mesh and ball physics, so they can never disagree:
 *
 *   base  = tee > green(+cup) > fairway(path) > noise
 *   final = base with water/bunker hazards carved over it
 *
 * No moat/bridge here: water exists as organic ponds placed by the designer
 * (the old fixed moat-ring + bridge was removed; island-green archetype will
 * get its own crossing when it lands).
 */
class TerrainGenerator {
  constructor(options = {}) {
    this.options = {
      width: options.width || 400,
      length: options.length || 400,
      maxHeight: options.maxHeight || 10,
      minHeight: options.minHeight || -5,
      segmentsW: options.segmentsW || 64,
      segmentsL: options.segmentsL || 64,
      noiseScale: options.noiseScale || 0.05,
      noiseOctaves: options.noiseOctaves || 3,
      noisePersistence: options.noisePersistence || 0.5,
      heightScale: options.heightScale || 1.0,
      waterLevel: options.waterLevel || -0.8,
      waterColor: options.waterColor || 0x4466aa,
      waterOpacity: options.waterOpacity || 0.8,
      seed: options.seed || 'THREEWOOD',
      holeNumber: options.holeNumber || 1,
      holeSpec: options.holeSpec || null,
    };

    // Deterministic generation — every feature derives from the hole seed
    this.gameRng = createGameRng(this.options.seed);
    this.noise = this.gameRng.noise2D;
    this.rng = this.gameRng.fork('terrain-fx').rng; // cosmetic particles

    // The hole design (archetype, path, hazards). Consumed by everything below.
    this.spec = this.options.holeSpec || designHole(this.options.seed, this.options.holeNumber);

    // Hand-tuned stylized palette (aesthetic A). Readability rule:
    // green lightest → fairway warm mid → rough deep. No photo textures.
    this.terrainTypes = [
      { name: 'water', height: this.options.waterLevel, color: this.options.waterColor },
      { name: 'bunker', height: -0.5, color: 0xEBD9A4 },
      { name: 'rough', height: 0.0, color: 0x4E7D38 },
      { name: 'fairway', height: 0.5, color: 0x7CC24E },
      { name: 'green', height: 1.0, color: 0xA6E56C }
    ];

    // Positions (filled by applyHoleSpec)
    this.teePosition = new THREE.Vector3(0, 0, 0);
    this.holePosition = new THREE.Vector3(0, 0, 0);
    this.hole = null;
    this.greenParams = null;
    this.treeColliders = [];

    // Meshes
    this.terrainMesh = null;
    this.waterMesh = null;
    this.waterTime = 0;

    // Heightmap for fast lookups
    this.heightMap = [];

    this.applyHoleSpec();
  }

  // -------------------------------------------------------------------------
  // Layout from the HoleSpec
  // -------------------------------------------------------------------------

  applyHoleSpec() {
    const spec = this.spec;

    // Tee: slightly raised platform, capped so it's a tee box not a mountain
    const teeNoise = this.getNoiseHeight(spec.tee.x, spec.tee.z) + 0.3;
    const teeY = THREE.MathUtils.clamp(teeNoise, 0.8, 2.2);
    this.teePosition = new THREE.Vector3(spec.tee.x, teeY, spec.tee.z);

    // Green: base noise height (capped) + archetype elevation (tabletop)
    const baseGreenY = THREE.MathUtils.clamp(
      this.getNoiseHeight(spec.green.x, spec.green.z),
      this.terrainTypes[2].height + 0.1,
      2.0
    );
    const greenY = baseGreenY + (spec.greenElev || 0);
    this.holePosition = new THREE.Vector3(spec.green.x, greenY, spec.green.z);

    // Canonical hole descriptor (cup): single source of truth
    const HOLE_DEPTH = 0.2;
    const HOLE_RADIUS = 0.3;
    this.hole = {
      x: spec.green.x,
      z: spec.green.z,
      surfaceY: greenY,
      bottomY: greenY - HOLE_DEPTH,
      radius: HOLE_RADIUS,
      depth: HOLE_DEPTH,
    };
    this.holeSurfaceHeight = greenY;

    this.greenSize = spec.greenSize || 15;
    this.greenParams = {
      centerX: spec.green.x,
      centerZ: spec.green.z,
      size: this.greenSize,
      height: greenY,
      angle: this.pathEndAngle(),
    };

    // Fairway path (Vector2 polyline) and total length
    this.fairwayPath = spec.path.map(p => new THREE.Vector2(p.x, p.z));
    this.fairwayWidth = spec.fairwayWidth || 22;
    this.fairwayLength = pathLength(spec.path);

    // Hazard closures (organic shapes, blend toward the surface they carve)
    this.waterAreas = spec.water.map(w => this.createWaterArea(w.x, w.z, w.r, this.options.waterLevel - 0.25));
    this.bunkerAreas = spec.bunkers.map(b => this.createSandArea(b.x, b.z, b.r));
  }

  pathEndAngle() {
    const p = this.spec.path;
    const a = p[p.length - 2], b = p[p.length - 1];
    return Math.atan2(b.z - a.z, b.x - a.x);
  }

  // -------------------------------------------------------------------------
  // Base noise
  // -------------------------------------------------------------------------

  getNoiseHeight(x, y) {
    const octaves = this.options.noiseOctaves;
    const persistence = this.options.noisePersistence;
    const scale = 1 / this.options.noiseScale;
    const lacunarity = 2.0;

    let amplitude = 1;
    let frequency = 1;
    let noiseHeight = 0;

    for (let i = 0; i < octaves; i++) {
      const sampleX = x / scale * frequency;
      const sampleY = y / scale * frequency;
      noiseHeight += this.noise(sampleX, sampleY) * amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return THREE.MathUtils.mapLinear(noiseHeight, -1, 1, this.options.minHeight, this.options.maxHeight);
  }

  // -------------------------------------------------------------------------
  // THE unified surface model (mesh + physics share this exactly)
  // -------------------------------------------------------------------------

  /** Distance/progress info for the fairway path at (x, z). */
  fairwayInfo(x, z) {
    const info = pathInfo(this.spec.path, x, z);
    const t = this.fairwayLength > 0 ? Math.max(0, Math.min(1, info.along / this.fairwayLength)) : 0;
    // Organic width breathing along the hole
    const widthVariation = 1 + 0.25 * Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI * 3);
    return {
      ...info,
      t,
      width: (this.fairwayWidth / 2) * widthVariation,
      height: this.pathHeightAt(t),
    };
  }

  /** Fairway elevation profile: smooth ramp tee → green. */
  pathHeightAt(t) {
    const smooth = t * t * (3 - 2 * t);
    return THREE.MathUtils.lerp(this.teePosition.y, this.holePosition.y, smooth);
  }

  /** Kidney-shape distance for the green (< 1 = inside), rotated to face the approach. */
  greenDistance(x, z) {
    const g = this.greenParams;
    if (!g) return Infinity;
    const dx = x - g.centerX;
    const dz = z - g.centerZ;
    const cos = Math.cos(-g.angle), sin = Math.sin(-g.angle);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const size = g.size;
    const ellipseDistance = Math.sqrt((localX / 1.5) ** 2 + localZ ** 2) / size;
    const circleDistance = Math.sqrt((localX + size * 0.3) ** 2 + (localZ - size * 0.1) ** 2) / (size * 0.7);
    return Math.max(ellipseDistance, 1 - circleDistance);
  }

  /** Fairway-or-noise height (no tee/green/hazards). */
  subBaseHeight(x, z) {
    const info = this.fairwayInfo(x, z);
    const blendRadius = 12;
    if (info.dist <= info.width) {
      return info.height;
    }
    if (info.dist <= info.width + blendRadius) {
      const blend = Math.pow((info.dist - info.width) / blendRadius, 1.5);
      return THREE.MathUtils.lerp(info.height, this.getNoiseHeight(x, z), blend);
    }
    return this.getNoiseHeight(x, z);
  }

  /** Tee + green over fairway/noise. No hazards, no cup. */
  baseSurfaceHeight(x, z) {
    // Tee platform
    const teeDist = Math.hypot(x - this.teePosition.x, z - this.teePosition.z);
    if (teeDist < 3) return this.teePosition.y;
    if (teeDist < 6) {
      const blend = (teeDist - 3) / 3;
      return THREE.MathUtils.lerp(this.teePosition.y, this.subBaseHeight(x, z), blend * blend);
    }

    // Putting green (blends toward surrounding surface)
    const g = this.greenDistance(x, z);
    if (g < 1) return this.greenParams.height;
    if (g < 1.25) {
      const blend = (g - 1) / 0.25;
      return THREE.MathUtils.lerp(this.greenParams.height, this.subBaseHeight(x, z), blend * blend);
    }

    return this.subBaseHeight(x, z);
  }

  /** Full surface: base with hazards carved, then the cup. = physics height. */
  surfaceHeight(x, z) {
    const base = this.baseSurfaceHeight(x, z);

    // Water ponds (override everything below them)
    for (const area of this.waterAreas) {
      const h = area(x, z, base);
      if (h !== null) return h;
    }
    // Sand bunkers
    for (const area of this.bunkerAreas) {
      const h = area(x, z, base);
      if (h !== null) return h;
    }

    // The cup (only inside the green)
    if (this.greenDistance(x, z) < 1) {
      const hd = Math.hypot(x - this.hole.x, z - this.hole.z);
      if (hd < this.hole.radius) return this.hole.bottomY;
      if (hd < this.hole.radius * 2) {
        return THREE.MathUtils.lerp(this.hole.bottomY, this.hole.surfaceY, (hd - this.hole.radius) / this.hole.radius);
      }
    }

    return base;
  }

  /** Physics entry point. */
  getHeightAtPosition(x, z) {
    return this.surfaceHeight(x, z);
  }

  // -------------------------------------------------------------------------
  // Feature shape factories (organic ponds / bunkers)
  // -------------------------------------------------------------------------

  /** Organic pond. Core = floorHeight; shoreline blends toward the base surface. */
  createWaterArea(centerX, centerZ, radius, floorHeight) {
    return (x, z, baseHeight) => {
      const dx = x - centerX;
      const dz = z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      const angle = Math.atan2(dz, dx);
      const organicFactor = 1 + 0.3 * Math.sin(angle * 3) + 0.2 * Math.sin(angle * 5) + 0.15 * Math.sin(angle * 7);
      const organicRadius = radius * organicFactor;

      if (distance < organicRadius * 0.7) {
        return floorHeight;
      }
      if (distance < organicRadius) {
        const blendFactor = (distance - organicRadius * 0.7) / (organicRadius * 0.3);
        const smoothBlend = Math.pow(blendFactor, 2);
        return THREE.MathUtils.lerp(floorHeight, baseHeight, smoothBlend);
      }
      return null;
    };
  }

  /** Organic sand bunker with a raised lip. Floor sits below the base surface. */
  createSandArea(centerX, centerZ, radius) {
    const floorHeight = this.baseSurfaceHeight(centerX, centerZ) - 0.55;
    return (x, z, baseHeight) => {
      const dx = x - centerX;
      const dz = z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      const angle = Math.atan2(dz, dx);
      const organicFactor = 1 + 0.4 * Math.sin(angle * 2) + 0.25 * Math.sin(angle * 4) - 0.15 * Math.cos(angle * 3);
      const organicRadius = radius * Math.max(0.5, organicFactor);

      if (distance < organicRadius * 0.6) {
        return floorHeight;
      }
      if (distance < organicRadius) {
        const blendFactor = (distance - organicRadius * 0.6) / (organicRadius * 0.4);
        const bunkerLip = Math.pow(1 - blendFactor, 0.8);
        const lipHeight = floorHeight + bunkerLip * 0.85; // floor + raised lip
        return THREE.MathUtils.lerp(lipHeight, baseHeight, blendFactor);
      }
      return null;
    };
  }

  // -------------------------------------------------------------------------
  // Surface classification (vertex colors, physics lie, minimap)
  // -------------------------------------------------------------------------

  /**
   * Surface type at (x, z): 'green' | 'fairway' | 'rough' | 'bunker' | 'water'.
   * Tee plays like green. Mirrors the height model.
   */
  getSurfaceTypeAtPosition(x, z) {
    // Green + tee
    if (this.greenDistance(x, z) < 1) return 'green';
    if (Math.hypot(x - this.teePosition.x, z - this.teePosition.z) < 5) return 'green';

    // Explicit hazard shapes
    const base = this.baseSurfaceHeight(x, z);
    for (const area of this.waterAreas) {
      if (area(x, z, base) !== null) return 'water';
    }
    for (const area of this.bunkerAreas) {
      if (area(x, z, base) !== null) return 'bunker';
    }

    // Height-based fallbacks (low spots, pond floors)
    const y = this.surfaceHeight(x, z);
    if (y <= this.terrainTypes[0].height) return 'water';
    if (y <= this.terrainTypes[1].height) return 'bunker';

    if (this.isOnFairway(x, z)) return 'fairway';
    return 'rough';
  }

  isOnFairway(x, z) {
    const info = this.fairwayInfo(x, z);
    return info.dist <= info.width + 4;
  }

  isWaterHazard(x, y, z) {
    return this.getSurfaceTypeAtPosition(x, z) === 'water';
  }

  isSandBunker(x, y, z) {
    return this.getSurfaceTypeAtPosition(x, z) === 'bunker';
  }

  // -------------------------------------------------------------------------
  // Mesh generation
  // -------------------------------------------------------------------------

  generateTerrain() {
    const { width, length, segmentsW, segmentsL } = this.options;

    const geometry = new THREE.PlaneGeometry(width, length, segmentsW, segmentsL);
    this.heightMap = new Array(segmentsW + 1).fill(0).map(() => new Array(segmentsL + 1).fill(0));
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.getAttribute('position');
    const colors = [];

    for (let i = 0; i < positions.count; i++) {
      const worldX = positions.getX(i);
      const worldZ = positions.getZ(i);

      let y = this.surfaceHeight(worldX, worldZ);
      if (!Number.isFinite(y)) {
        console.warn(`Non-finite height at (${worldX}, ${worldZ}); set to 0.`);
        y = 0;
      }
      positions.setY(i, y);

      const xIndex = Math.floor((worldX + width / 2) / width * segmentsW);
      const zIndex = Math.floor((worldZ + length / 2) / length * segmentsL);
      if (xIndex >= 0 && xIndex <= segmentsW && zIndex >= 0 && zIndex <= segmentsL) {
        this.heightMap[xIndex][zIndex] = y;
      }

      // --- Vertex color from surface classification ---
      const surface = this.getSurfaceTypeAtPosition(worldX, worldZ);
      const typeColors = {
        water: this.terrainTypes[0].color,
        bunker: this.terrainTypes[1].color,
        rough: this.terrainTypes[2].color,
        fairway: this.terrainTypes[3].color,
        green: this.terrainTypes[4].color,
      };
      const color = new THREE.Color(typeColors[surface] || typeColors.rough);

      // Organic mottling so surfaces never read as flat plastic
      const mottle = 1 + this.noise(worldX * 0.08 + 100, worldZ * 0.08 - 100) * 0.07;
      color.multiplyScalar(mottle);

      // Mow stripes follow the path frame — points the eye down the line
      if (surface === 'fairway') {
        const across = this.fairwayInfo(worldX, worldZ).across;
        color.multiplyScalar(Math.floor((across + 500) / 6) % 2 === 0 ? 1.05 : 0.96);
      }

      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // --- Stylized materials: color IS the texture (aesthetic A) ---
    this.surfaceMaterials = {
      water: new THREE.MeshPhongMaterial({
        color: new THREE.Color(0x2E86AB),
        transparent: true,
        opacity: 0.85,
        shininess: 120,
        specular: 0xffe0b3,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      green: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      fairway: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      rough: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      bunker: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    };

    const materials = [
      this.surfaceMaterials.water,   // 0
      this.surfaceMaterials.bunker,  // 1
      this.surfaceMaterials.rough,   // 2
      this.surfaceMaterials.fairway, // 3
      this.surfaceMaterials.green,   // 4
    ];

    // Sort faces by material → one geometry group per surface (5 draw calls).
    const positionAttribute = geometry.getAttribute('position');
    const faceCount = geometry.index ? geometry.index.count / 3 : positionAttribute.count / 3;
    const faces = [];

    for (let i = 0; i < faceCount; i++) {
      const faceIndex = i * 3;
      let v1, v2, v3;
      if (geometry.index) {
        v1 = geometry.index.getX(faceIndex);
        v2 = geometry.index.getX(faceIndex + 1);
        v3 = geometry.index.getX(faceIndex + 2);
      } else {
        v1 = faceIndex; v2 = faceIndex + 1; v3 = faceIndex + 2;
      }

      const x1 = positionAttribute.getX(v1), z1 = positionAttribute.getZ(v1);
      const x2 = positionAttribute.getX(v2), z2 = positionAttribute.getZ(v2);
      const x3 = positionAttribute.getX(v3), z3 = positionAttribute.getZ(v3);
      if (!Number.isFinite(x1 + z1 + x2 + z2 + x3 + z3)) continue;

      const surface = this.getSurfaceTypeAtPosition((x1 + x2 + x3) / 3, (z1 + z2 + z3) / 3);
      const materialIndex = { water: 0, bunker: 1, rough: 2, fairway: 3, green: 4 }[surface] ?? 2;
      faces.push([materialIndex, v1, v2, v3]);
    }

    faces.sort((a, b) => a[0] - b[0]);

    const newIndex = new (geometry.index ? geometry.index.array.constructor : Uint32Array)(faces.length * 3);
    geometry.clearGroups();
    let cursor = 0, groupStart = 0, groupMaterial = faces.length ? faces[0][0] : 0;
    for (let i = 0; i < faces.length; i++) {
      const [m, v1, v2, v3] = faces[i];
      if (m !== groupMaterial) {
        geometry.addGroup(groupStart * 3, (i - groupStart) * 3, groupMaterial);
        groupStart = i;
        groupMaterial = m;
      }
      newIndex[cursor++] = v1;
      newIndex[cursor++] = v2;
      newIndex[cursor++] = v3;
    }
    if (faces.length) {
      geometry.addGroup(groupStart * 3, (faces.length - groupStart) * 3, groupMaterial);
    }
    geometry.setIndex(new THREE.BufferAttribute(newIndex, 1));

    this.terrainMesh = new THREE.Mesh(geometry, materials);
    return this.terrainMesh;
  }

  // -------------------------------------------------------------------------
  // Water surface (one animated plane at water level; shows through ponds)
  // -------------------------------------------------------------------------

  createWaterSurface(scene) {
    const waterGeometry = new THREE.PlaneGeometry(
      this.options.width + 40,
      this.options.length + 40,
      Math.floor(this.options.segmentsW / 1.5),
      Math.floor(this.options.segmentsL / 1.5)
    );
    waterGeometry.rotateX(-Math.PI / 2);
    waterGeometry.translate(0, this.options.waterLevel, 0);

    const waterMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(0x2E86AB),
      transparent: true,
      opacity: 0.85,
      shininess: 120,
      specular: 0xffe0b3,
      flatShading: true,
      side: THREE.DoubleSide,
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.name = 'waterSurface';
    this.waterMesh.receiveShadow = true;
    this.waterMesh.castShadow = false;

    if (scene) scene.add(this.waterMesh);
    return this.waterMesh;
  }

  updateWater(deltaTime) {
    if (!this.waterMesh) return;

    this.waterUpdateAccumulator = (this.waterUpdateAccumulator || 0) + deltaTime;
    if (this.waterUpdateAccumulator < 0.033) return; // ~30fps

    this.waterTime += this.waterUpdateAccumulator * 0.8;
    this.waterUpdateAccumulator = 0;

    const positions = this.waterMesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      if (Math.abs(x) < this.options.width / 2 - 10 &&
          Math.abs(z) < this.options.length / 2 - 10) {
        const combinedWave = Math.sin(x * 0.05 + this.waterTime * 0.5) *
                            Math.cos(z * 0.04 + this.waterTime * 0.6) *
                            0.08;
        positions.setY(i, this.options.waterLevel + combinedWave);
      }
    }
    positions.needsUpdate = true;
    // flatShading derives face normals in-shader; no computeVertexNormals here.

    if (this.waterMesh.material) {
      this.waterMesh.material.opacity = 0.82 + Math.sin(this.waterTime * 0.2) * 0.04;
    }
  }

  // -------------------------------------------------------------------------
  // Ball-in-hole + water collision + splash
  // -------------------------------------------------------------------------

  checkBallInHole(ball) {
    if (!ball || !this.hole) return false;

    const ballPosition = ball.position;
    const { x, z, surfaceY, bottomY, radius } = this.hole;

    const horizontalDist = Math.hypot(ballPosition.x - x, ballPosition.z - z);
    const isOverHole = horizontalDist < radius;
    const isAtHoleLevel = (ballPosition.y <= surfaceY + 0.08) &&
                          (ballPosition.y >= bottomY - 0.08);
    const isStopped = ball.velocity ? ball.velocity.length() < 0.5 : true;

    const isInHole = isOverHole && isAtHoleLevel && isStopped;

    if (isInHole && ball.velocity) {
      ball.velocity.y = -0.5;
      ball.velocity.x *= 0.5;
      ball.velocity.z *= 0.5;
    }

    return isInHole;
  }

  checkBallWaterCollision(ball, scene, ballVelocity = 1) {
    if (!ball || !this.waterMesh) return false;

    const ballPosition = ball.position.clone();
    const isInWater = ballPosition.y <= this.options.waterLevel + 0.1;

    if (!ball.userData) ball.userData = {};

    if (isInWater && !ball.userData.inWater && ballVelocity > 0.1) {
      this.createSplashEffect(ballPosition, scene, ballVelocity);
      ball.userData.inWater = true;
    } else if (!isInWater && ball.userData.inWater) {
      ball.userData.inWater = false;
    }

    return isInWater;
  }

  createSplashEffect(position, scene, intensity = 1) {
    if (!scene) return;

    const particleCount = Math.min(30, Math.floor(intensity * 20) + 10);
    const particleGeometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];
    const sizes = [];
    const lifetimes = [];

    for (let i = 0; i < particleCount; i++) {
      positions.push(position.x, this.options.waterLevel + 0.1, position.z);

      const angle = this.rng() * Math.PI * 2;
      const speed = (0.5 + this.rng() * 1.5) * intensity;
      const upwardBias = 0.7 + this.rng() * 0.3;

      velocities.push(
        Math.cos(angle) * speed * (1 - upwardBias),
        this.rng() * speed * upwardBias + 1,
        Math.sin(angle) * speed * (1 - upwardBias)
      );

      sizes.push(0.1 + this.rng() * 0.2 * intensity);
      lifetimes.push(0.5 + this.rng() * 0.5);
    }

    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particleGeometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
    particleGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    particleGeometry.setAttribute('lifetime', new THREE.Float32BufferAttribute(lifetimes, 1));

    particleGeometry.userData = {
      time: 0,
      gravity: 9.8,
      maxLifetime: 1.0,
      initialPositions: positions.slice()
    };

    const particleMaterial = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 1.0,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    particleSystem.name = 'waterSplash';
    particleSystem.userData.creationTime = Date.now();

    scene.add(particleSystem);
    if (!this.splashEffects) this.splashEffects = [];
    this.splashEffects.push(particleSystem);

    this.createRippleEffect(position, scene, intensity);
  }

  createRippleEffect(position, scene, intensity = 1) {
    const innerRadius = 0.2;
    const outerRadius = 0.3;
    const rippleGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 16);
    rippleGeometry.rotateX(-Math.PI / 2);
    rippleGeometry.translate(position.x, this.options.waterLevel + 0.02, position.z);

    const rippleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });

    const rippleMesh = new THREE.Mesh(rippleGeometry, rippleMaterial);
    rippleMesh.name = 'waterRipple';
    rippleMesh.userData = {
      creationTime: Date.now(),
      duration: 1.0 * intensity,
      maxSize: 2.0 * intensity,
      initialSize: innerRadius
    };

    scene.add(rippleMesh);
    if (!this.rippleEffects) this.rippleEffects = [];
    this.rippleEffects.push(rippleMesh);
  }

  updateSplashEffects(deltaTime, scene) {
    if (!scene) return;

    if (this.splashEffects && this.splashEffects.length > 0) {
      for (let i = this.splashEffects.length - 1; i >= 0; i--) {
        const splash = this.splashEffects[i];
        const elapsed = (Date.now() - splash.userData.creationTime) / 1000;

        if (elapsed < splash.geometry.userData.maxLifetime) {
          const positions = splash.geometry.attributes.position;
          const velocities = splash.geometry.attributes.velocity;
          const initialPositions = splash.geometry.userData.initialPositions;
          const gravity = splash.geometry.userData.gravity;

          for (let j = 0; j < positions.count; j++) {
            const vx = velocities.getX(j);
            const vy = velocities.getY(j) - gravity * elapsed;
            const vz = velocities.getZ(j);

            positions.setX(j, initialPositions[j * 3] + vx * elapsed);
            positions.setY(j, Math.max(
              this.options.waterLevel,
              initialPositions[j * 3 + 1] + vy * elapsed - 0.5 * gravity * elapsed * elapsed * 0.1
            ));
            positions.setZ(j, initialPositions[j * 3 + 2] + vz * elapsed);
          }
          positions.needsUpdate = true;
          splash.material.opacity = 0.8 * (1 - elapsed / splash.geometry.userData.maxLifetime);
        } else {
          scene.remove(splash);
          splash.geometry.dispose();
          splash.material.dispose();
          this.splashEffects.splice(i, 1);
        }
      }
    }

    if (this.rippleEffects && this.rippleEffects.length > 0) {
      for (let i = this.rippleEffects.length - 1; i >= 0; i--) {
        const ripple = this.rippleEffects[i];
        const elapsed = (Date.now() - ripple.userData.creationTime) / 1000;
        const duration = ripple.userData.duration;

        if (elapsed < duration) {
          const progress = elapsed / duration;
          const newSize = ripple.userData.initialSize + progress * ripple.userData.maxSize;
          ripple.scale.set(newSize, newSize, 1);
          ripple.material.opacity = 0.7 * (1 - progress);
        } else {
          scene.remove(ripple);
          this.rippleEffects.splice(i, 1);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Flag + cup
  // -------------------------------------------------------------------------

  createFlag(scene) {
    const flagGroup = new THREE.Group();
    flagGroup.name = 'golfFlag';

    const POLE_HEIGHT = 2.4;
    const POLE_RADIUS = 0.04;

    const poleGeo = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 10);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, metalness: 0.3, roughness: 0.4 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = POLE_HEIGHT / 2;
    pole.castShadow = true;
    flagGroup.add(pole);

    const FLAG_W = 0.5, FLAG_H = 0.32;
    const flagGeo = new THREE.PlaneGeometry(FLAG_W, FLAG_H);
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xe53935, side: THREE.DoubleSide, roughness: 0.8
    });
    const flagCloth = new THREE.Mesh(flagGeo, flagMat);
    flagCloth.position.set(FLAG_W / 2, POLE_HEIGHT - FLAG_H / 2 - 0.05, 0);
    flagCloth.castShadow = true;
    flagGroup.add(flagCloth);
    flagGroup.userData.flagMesh = flagCloth;

    if (this.hole) {
      flagGroup.position.set(this.hole.x, this.hole.surfaceY, this.hole.z);
      flagGroup.userData.surfaceLevel = this.hole.surfaceY;
      flagGroup.userData.holeLevel = this.hole.bottomY;
    }

    this.createHoleCup(flagGroup);

    if (scene) scene.add(flagGroup);

    this.flagObject = flagGroup;
    flagGroup.userData.isFlag = true;
    flagGroup.userData.holeRadius = this.hole ? this.hole.radius : 0.3;

    return flagGroup;
  }

  createHoleCup(parent) {
    if (!this.hole) return null;
    const { radius, depth } = this.hole;

    const cupHeight = depth + 0.06;
    const cupGeo = new THREE.CylinderGeometry(radius, radius, cupHeight, 24, 1, false);
    const cupMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
    const cup = new THREE.Mesh(cupGeo, cupMat);
    cup.position.set(0, -depth / 2, 0);
    cup.name = 'holeCup';
    parent.add(cup);

    const floorGeo = new THREE.CircleGeometry(radius * 0.95, 24);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -depth + 0.002, 0);
    floor.name = 'holeCupFloor';
    parent.add(floor);

    return cup;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getNormalAtPosition(x, z) {
    const delta = 0.1;
    const hL = this.getHeightAtPosition(x - delta, z);
    const hR = this.getHeightAtPosition(x + delta, z);
    const hD = this.getHeightAtPosition(x, z - delta);
    const hU = this.getHeightAtPosition(x, z + delta);

    const normal = new THREE.Vector3(hL - hR, 2 * delta, hD - hU);
    normal.normalize();
    return normal;
  }

  /** Layout shapes for the minimap / yardage HUD. */
  getMinimapData() {
    const spec = this.spec;
    return {
      tee: { x: this.teePosition.x, z: this.teePosition.z },
      hole: this.hole ? { x: this.hole.x, z: this.hole.z, radius: this.hole.radius } : null,
      green: this.greenParams
        ? { x: this.greenParams.centerX, z: this.greenParams.centerZ, size: this.greenParams.size }
        : null,
      path: spec.path.map(p => ({ x: p.x, z: p.z })),
      fairwayWidth: this.fairwayWidth,
      water: spec.water.map(w => ({ x: w.x, z: w.z, r: w.r })),
      bunkers: spec.bunkers.map(b => ({ x: b.x, z: b.z, r: b.r })),
      trees: spec.trees.map(t => ({ x: t.x, z: t.z, s: t.s })),
      number: spec.number,
      par: spec.par,
      archetype: spec.archetype,
    };
  }
}

export default TerrainGenerator;

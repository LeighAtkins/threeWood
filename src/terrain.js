import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Terrain generation for ThreeWood
 * Creates procedural terrain with various features
 */
class TerrainGenerator {
  constructor(options = {}) {
    this.options = {
      width: options.width || 400,
      length: options.length || 400,
      maxHeight: options.maxHeight || 10,
      minHeight: options.minHeight || -5,
      segmentsW: options.segmentsW || 50,  // Reduced for better performance
      segmentsL: options.segmentsL || 50,  // Reduced for better performance
      noiseScale: options.noiseScale || 0.05,
      noiseOctaves: options.noiseOctaves || 3,
      noisePersistence: options.noisePersistence || 0.5,
      heightScale: options.heightScale || 1.0,
      waterLevel: options.waterLevel || -0.8,
      waterColor: options.waterColor || 0x4466aa,
      waterOpacity: options.waterOpacity || 0.8
    };
    
    // Initialize noise generator
    this.noise = createNoise2D();
    
    // Terrain types (by height)
    this.terrainTypes = [
      { name: 'water', height: this.options.waterLevel, color: this.options.waterColor },
      { name: 'bunker', height: -0.5, color: 0xDDCC88 },
      { name: 'rough', height: 0.0, color: 0x669944 },
      { name: 'fairway', height: 0.5, color: 0x88CC66 },
      { name: 'green', height: 1.0, color: 0x66BB55 }
    ];
    
    // Initialize positions
    this.teePosition = new THREE.Vector3(0, 0, 0);
    this.holePosition = new THREE.Vector3(0, 0, 0);
    
    // Initialize terrain mesh
    this.terrainMesh = null;
    
    // Initialize water surface
    this.waterMesh = null;
    this.waterTime = 0;

    // Initialize heightmap for faster lookups
    this.heightMap = [];
  }

  /**
   * Generate Perlin noise height at given coordinates
   */
  getNoiseHeight(x, y) {
    // Use the new options structure
    const octaves = this.options.noiseOctaves;
    const persistence = this.options.noisePersistence;
    const scale = 1 / this.options.noiseScale;
    const lacunarity = 2.0; // Default value
    
    let amplitude = 1;
    let frequency = 1;
    let noiseHeight = 0;

    for (let i = 0; i < octaves; i++) {
      const sampleX = x / scale * frequency;
      const sampleY = y / scale * frequency;
      
      const noise = this.noise(sampleX, sampleY);
      noiseHeight += noise * amplitude;
      
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    // Add a slight slope from tee to hole
    if (this.teePosition && this.holePosition) {
      const totalDistance = this.teePosition.distanceTo(this.holePosition);
      const distanceFromTee = Math.sqrt((x - this.teePosition.x) ** 2 + (y - this.teePosition.z) ** 2);
      const slopeFactor = (Number.isFinite(totalDistance) && totalDistance !== 0) ? (distanceFromTee / totalDistance) * 0.3 : 0; // Subtle slope
      noiseHeight -= slopeFactor;
    }

    // Normalize and scale to min/max height
    const finalHeight = THREE.MathUtils.mapLinear(noiseHeight, -1, 1, this.options.minHeight, this.options.maxHeight);
    return finalHeight;
  }

  /**
   * PS1-style vertex snapping for authentic low-precision look
   */
  snapToGrid(value) {
    if (!this.options.snapVertices) return value;
    return Math.round(value / this.options.snapPrecision) * this.options.snapPrecision;
  }

  /**
   * Create a flat area for a specified location
   */
  createFlatArea(centerX, centerZ, radius, height, blendRadius = 2) {
    return (x, z) => {
      const distance = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
      
      if (distance < radius) {
        return height;
      } else if (distance < radius + blendRadius) {
        // Smooth blend between flat area and surrounding terrain
        const blendFactor = (distance - radius) / blendRadius;
        const terrainHeight = this.getNoiseHeight(x, z);
        return THREE.MathUtils.lerp(height, terrainHeight, blendFactor);
      }
      
      return null; // Return null if outside influence area
    };
  }

  /**
   * Create a small hole depression at the specified location
   * @param {number} centerX - X coordinate of the hole
   * @param {number} centerZ - Z coordinate of the hole
   * @param {number} surfaceHeight - Height of the green surface
   * @returns {Function} A function that returns the height at a given point
   */
  createHoleDepression(centerX, centerZ, surfaceHeight) {
    return (x, z) => {
      const dx = x - centerX;
      const dz = z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      const holeRadius = 0.3; // Larger for visibility  
      const lipRadius = 0.6; // Larger for the sloped edge
      
      // Core hole area (below surface)
      if (distance < holeRadius) {
        return surfaceHeight - 0.1; // Hole depth
      }
      
      // Sloped lip around hole
      if (distance < lipRadius) {
        const blendFactor = (distance - holeRadius) / (lipRadius - holeRadius);
        const slopeHeight = THREE.MathUtils.lerp(surfaceHeight - 0.1, surfaceHeight, blendFactor);
        return slopeHeight;
      }
      
      return null; // Outside hole influence
    };
  }

  /**
   * Create a kidney-shaped putting green area
   * @param {number} centerX - X coordinate of the center
   * @param {number} centerZ - Z coordinate of the center
   * @param {number} size - Size of the green
   * @param {number} height - Height of the green
   * @param {number} blendRadius - Radius for blending with surrounding terrain
   * @returns {Function} A function that returns the height at a given point
   */
  createPuttingGreen(centerX, centerZ, size, height, blendRadius = 3) {
    // Store green parameters for later use
    this.greenParams = {
      centerX,
      centerZ,
      size,
      height
    };
    
    return (x, z) => {
      // Translate to green-centered coordinates
      const localX = x - centerX;
      const localZ = z - centerZ;
      
      // Kidney shape is created by subtracting a circle from an ellipse
      const ellipseDistance = Math.sqrt((localX / 1.5) ** 2 + localZ ** 2) / size;
      const circleDistance = Math.sqrt((localX + size * 0.3) ** 2 + (localZ - size * 0.1) ** 2) / (size * 0.7);
      
      // Combined shape (kidney)
      const kidneyDistance = Math.max(ellipseDistance, 1 - circleDistance);
      
      if (kidneyDistance < 1) {
        // Inside the kidney shape
        return height;
      } else if (kidneyDistance < 1 + blendRadius / size) {
        // Blend zone
        const blendFactor = (kidneyDistance - 1) / (blendRadius / size);
        const terrainHeight = this.getNoiseHeight(x, z);
        return THREE.MathUtils.lerp(height, terrainHeight, blendFactor);
      }
      
      return null; // Outside influence area
    };
  }

  /**
   * Create an organic water area with smooth curves (pond/lake shape)
   */
  createWaterArea(centerX, centerZ, radius, height) {
    return (x, z) => {
      const dx = x - centerX;
      const dz = z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      // Create organic shape using multiple sine waves for natural pond contours
      const angle = Math.atan2(dz, dx);
      const organicFactor = 1 + 0.3 * Math.sin(angle * 3) + 0.2 * Math.sin(angle * 5) + 0.15 * Math.sin(angle * 7);
      const organicRadius = radius * organicFactor;
      
      // Core water area
      if (distance < organicRadius * 0.7) {
        return height;
      }
      
      // Smooth edge blending for natural shoreline
      if (distance < organicRadius) {
        const blendFactor = (distance - organicRadius * 0.7) / (organicRadius * 0.3);
        const smoothBlend = Math.pow(blendFactor, 2); // Quadratic curve for smooth transition
        
        const terrainHeight = this.getNoiseHeight(x, z);
        return THREE.MathUtils.lerp(height, terrainHeight, smoothBlend);
      }
      
      return null;
    };
  }

  /**
   * Create a water moat around the kidney-shaped green with a bridge crossing
   */
  createWaterMoatAroundGreen(centerX, centerZ, greenSize, waterHeight) {
    // Calculate appropriate bridge height based on surrounding terrain
    const bridgeCenterX = centerX - greenSize * 0.7;
    const approachTerrainHeight = this.getNoiseHeight(bridgeCenterX - 6, centerZ); // Terrain before bridge
    const greenSideTerrainHeight = this.getNoiseHeight(bridgeCenterX + 6, centerZ); // Terrain after bridge
    const averageTerrainHeight = (approachTerrainHeight + greenSideTerrainHeight) / 2;
    
    // Store bridge info for later rendering
    this.bridgeInfo = {
      centerX: bridgeCenterX,
      centerZ: centerZ,
      width: 4,
      length: 12,
      height: Math.max(averageTerrainHeight + 0.2, waterHeight + 0.8) // Bridge above terrain or well above water
    };
    
    
    return (x, z) => {
      const dx = x - centerX;
      const dz = z - centerZ;
      
      // Same kidney shape calculation as the green for the moat outline
      const localX = dx;
      const localZ = dz;
      
      // Kidney shape calculation (matching the green shape)
      const ellipseDistance = Math.sqrt((localX / 1.5) ** 2 + localZ ** 2) / greenSize;
      const circleDistance = Math.sqrt((localX + greenSize * 0.3) ** 2 + (localZ - greenSize * 0.1) ** 2) / (greenSize * 0.7);
      const kidneyDistance = Math.max(ellipseDistance, 1 - circleDistance);
      
      // Define the moat as a ring around the green
      const innerRadius = 1.2; // Just outside the green
      const outerRadius = 1.8; // Outer edge of moat
      
      // Check if we're in the bridge area (skip water here)
      const bridgeInfo = this.bridgeInfo;
      const isInBridgeArea = (
        Math.abs(x - bridgeInfo.centerX) < bridgeInfo.length / 2 &&
        Math.abs(z - bridgeInfo.centerZ) < bridgeInfo.width / 2
      );
      
      // Create moat ring, but skip bridge area
      if (kidneyDistance > innerRadius && kidneyDistance < outerRadius && !isInBridgeArea) {
        // Add some organic variation to moat edges
        const angle = Math.atan2(dz, dx);
        const variation = 1 + 0.1 * Math.sin(angle * 4) + 0.05 * Math.sin(angle * 8);
        const adjustedDistance = kidneyDistance * variation;
        
        if (adjustedDistance > innerRadius && adjustedDistance < outerRadius) {
          // Core water area
          if (adjustedDistance < innerRadius + (outerRadius - innerRadius) * 0.7) {
            return waterHeight;
          }
          
          // Smooth edge blending
          const blendFactor = (adjustedDistance - (innerRadius + (outerRadius - innerRadius) * 0.7)) / 
                            ((outerRadius - innerRadius) * 0.3);
          const terrainHeight = this.getNoiseHeight(x, z);
          return THREE.MathUtils.lerp(waterHeight, terrainHeight, blendFactor);
        }
      }
      
      return null;
    };
  }

  /**
   * Create bridge terrain elevation to match bridge height with proper ramps
   */
  createBridgeTerrain() {
    if (!this.bridgeInfo) return null;
    
    const { centerX, centerZ, width, length, height } = this.bridgeInfo;
    
    return (x, z) => {
      // Extended area for ramps and transitions
      const rampLength = 3; // Length of ramps on each end
      const totalLength = length + (rampLength * 2);
      const padding = 2; // Extra space around bridge for smooth blending
      
      const isInBridgeArea = (
        Math.abs(x - centerX) < (totalLength / 2 + padding) &&
        Math.abs(z - centerZ) < (width / 2 + padding)
      );
      
      if (!isInBridgeArea) return null;
      
      // Core bridge area (flat deck)
      const isCoreBridge = (
        Math.abs(x - centerX) < length / 2 &&
        Math.abs(z - centerZ) < width / 2
      );
      
      if (isCoreBridge) {
        return height; // Bridge deck height
      }
      
      // Calculate distance along bridge length (X direction)
      const distanceAlongX = x - centerX;
      const distanceFromCenterZ = Math.abs(z - centerZ);
      
      // Check if we're in the ramp areas (extending beyond core bridge)
      const isInRampArea = (
        Math.abs(distanceAlongX) > length / 2 &&
        Math.abs(distanceAlongX) < (length / 2 + rampLength) &&
        distanceFromCenterZ < width / 2
      );
      
      if (isInRampArea) {
        // Create ramps on each end of the bridge
        const rampDistance = Math.abs(distanceAlongX) - length / 2;
        const rampFactor = rampDistance / rampLength; // 0 at bridge end, 1 at ramp end
        
        // Get terrain height at this position
        const terrainHeight = this.getNoiseHeight(x, z);
        
        // Smooth transition from bridge height to terrain height
        return THREE.MathUtils.lerp(height, terrainHeight, rampFactor);
      }
      
      // Width transition areas (sides of bridge including ramps)
      if (distanceFromCenterZ < width / 2 + padding) {
        const sideDistance = Math.max(0, distanceFromCenterZ - width / 2);
        const sideFactor = sideDistance / padding;
        
        // Get the height we would have at this X position (either bridge or ramp)
        let targetHeight = height;
        if (Math.abs(distanceAlongX) > length / 2) {
          // We're in ramp area
          const rampDistance = Math.abs(distanceAlongX) - length / 2;
          const rampFactor = Math.min(1, rampDistance / rampLength);
          const terrainHeight = this.getNoiseHeight(x, z);
          targetHeight = THREE.MathUtils.lerp(height, terrainHeight, rampFactor);
        }
        
        // Blend from bridge/ramp height to terrain height
        const terrainHeight = this.getNoiseHeight(x, z);
        return THREE.MathUtils.lerp(targetHeight, terrainHeight, sideFactor);
      }
      
      return null;
    };
  }

  /**
   * Create bridge terrain area with proper height for visual/physical terrain
   */
  createBridgeTerrainArea() {
    if (!this.bridgeInfo) return null;
    
    const { centerX, centerZ, width, length, height } = this.bridgeInfo;
    
    return (x, z) => {
      // Bridge area with some padding for ramps
      const rampLength = 2; // Ramp length on each end
      const totalLength = length + (rampLength * 2);
      
      const isInBridgeArea = (
        Math.abs(x - centerX) < totalLength / 2 &&
        Math.abs(z - centerZ) < width / 2
      );
      
      if (!isInBridgeArea) return null;
      
      // Core bridge area (flat deck)
      const isCoreBridge = (
        Math.abs(x - centerX) < length / 2 &&
        Math.abs(z - centerZ) < width / 2
      );
      
      if (isCoreBridge) {
        // Create gentle arch across bridge length
        const distanceFromCenterX = Math.abs(x - centerX);
        const normalizedDistance = distanceFromCenterX / (length / 2);
        const archFactor = 1 - Math.pow(normalizedDistance, 2);
        const archHeight = 0.5;
        return height + (archHeight * archFactor);
      }
      
      // Ramp areas on bridge ends
      const distanceAlongX = x - centerX;
      const isInRampArea = (
        Math.abs(distanceAlongX) > length / 2 &&
        Math.abs(distanceAlongX) < (length / 2 + rampLength)
      );
      
      if (isInRampArea) {
        // Create ramps that connect to surrounding terrain
        const rampDistance = Math.abs(distanceAlongX) - length / 2;
        const rampFactor = rampDistance / rampLength; // 0 at bridge end, 1 at ramp end
        
        // Get terrain height at this position
        const terrainHeight = this.getNoiseHeight(x, z);
        
        // Smooth transition from bridge height to terrain height
        return THREE.MathUtils.lerp(height, terrainHeight, rampFactor);
      }
      
      return null;
    };
  }

  /**
   * Create an organic sand bunker with smooth curves and natural shape
   */
  createSandArea(centerX, centerZ, radius, height) {
    return (x, z) => {
      const dx = x - centerX;
      const dz = z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      // Create kidney/oval shaped bunker with organic curves
      const angle = Math.atan2(dz, dx);
      const organicFactor = 1 + 0.4 * Math.sin(angle * 2) + 0.25 * Math.sin(angle * 4) - 0.15 * Math.cos(angle * 3);
      const organicRadius = radius * Math.max(0.5, organicFactor); // Prevent negative radius
      
      // Core bunker area (flat sand)
      if (distance < organicRadius * 0.6) {
        return height;
      }
      
      // Sloped edges for realistic bunker lip
      if (distance < organicRadius) {
        const blendFactor = (distance - organicRadius * 0.6) / (organicRadius * 0.4);
        const bunkerLip = Math.pow(1 - blendFactor, 0.8); // Create raised lip around bunker
        
        const terrainHeight = this.getNoiseHeight(x, z);
        const lipHeight = height + bunkerLip * 0.3; // Raise the lip slightly
        return THREE.MathUtils.lerp(lipHeight, terrainHeight, blendFactor);
      }
      
      return null;
    };
  }

  /**
   * Create water surface with animated waves and enhanced appearance
   * @param {THREE.Scene} scene - The scene to add the water to
   * @returns {THREE.Mesh} The water mesh
   */
  createWaterSurface(scene) {
    // Create water plane geometry with more segments for better waves
    const waterGeometry = new THREE.PlaneGeometry(
      this.options.width + 40, // Make water larger than terrain for better edges
      this.options.length + 40,
      Math.floor(this.options.segmentsW / 1.5), // More segments for better wave detail
      Math.floor(this.options.segmentsL / 1.5)
    );
    
    // Rotate to be horizontal (XZ plane)
    waterGeometry.rotateX(-Math.PI / 2);
    
    // Position at water level
    waterGeometry.translate(0, this.options.waterLevel, 0);
    
    // PS1-retro water: cheap flat-shaded Phong with a simple specular highlight.
    // (No env map exists, so the old PhysicalMaterial's reflectivity/clearcoat
    //  was costing perf for nothing.)
    const waterMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(0x3b6fb0),
      transparent: true,
      opacity: 0.82,
      shininess: 80,
      specular: 0xbfe0ff,
      flatShading: true,
      side: THREE.DoubleSide,
    });

    // Create water mesh
    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.name = 'waterSurface';
    this.waterMesh.receiveShadow = true;
    this.waterMesh.castShadow = false; // Water doesn't cast shadows
    
    // Add to scene if provided
    if (scene) {
      scene.add(this.waterMesh);
    }
    
    return this.waterMesh;
  }
  
  /**
   * Update water animation with enhanced wave patterns
   * @param {number} deltaTime - Time since last frame in seconds
   */
  updateWater(deltaTime) {
    if (!this.waterMesh) return;
    
    // Performance: Only update water animation 30fps instead of 60fps
    this.waterUpdateAccumulator = (this.waterUpdateAccumulator || 0) + deltaTime;
    if (this.waterUpdateAccumulator < 0.033) return; // ~30fps
    
    // Update time with scaled delta for smoother animation
    this.waterTime += this.waterUpdateAccumulator * 0.8;
    this.waterUpdateAccumulator = 0;
    
    // Enhanced wave animation with multiple wave patterns
    const positions = this.waterMesh.geometry.attributes.position;
    
    // Wave parameters for varied patterns
    const primaryWaveHeight = 0.12;
    const primaryWaveFreq = 0.04;
    const primaryWaveSpeed = 0.5;
    
    const secondaryWaveHeight = 0.05;
    const secondaryWaveFreq = 0.08;
    const secondaryWaveSpeed = 0.7;
    
    const tertiaryWaveHeight = 0.03;
    const tertiaryWaveFreq = 0.12;
    const tertiaryWaveSpeed = 0.9;
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      
      // Skip vertices at the edges to avoid visible seams
      if (Math.abs(x) < this.options.width / 2 - 10 && 
          Math.abs(z) < this.options.length / 2 - 10) {
        
        // Simplified single wave pattern for performance
        const combinedWave = Math.sin(x * 0.05 + this.waterTime * 0.5) * 
                            Math.cos(z * 0.04 + this.waterTime * 0.6) * 
                            0.08; // Reduced wave height
        
        // Update Y position with combined wave pattern
        positions.setY(i, this.options.waterLevel + combinedWave);
      }
    }
    
    // Mark attributes for update
    positions.needsUpdate = true;

    // NOTE: computeVertexNormals() intentionally skipped.
    // Water uses flatShading: true, so Three.js derives per-face normals in the
    // shader — recomputing vertex normals every ~33ms was wasted work (and the
    // biggest per-frame cost on the water system).

    // Animate water material properties for subtle color changes
    if (this.waterMesh.material) {
      // Subtle opacity pulsing
      const opacityPulse = 0.82 + Math.sin(this.waterTime * 0.2) * 0.04;
      this.waterMesh.material.opacity = opacityPulse;
    }
  }
  
  /**
   * Check for ball-water collision and create splash effects
   * @param {THREE.Object3D} ball - The golf ball object
   * @param {THREE.Scene} scene - The scene to add splash effects to
   * @param {number} ballVelocity - The ball's velocity magnitude when hitting water
   * @returns {boolean} Whether the ball is in water
   */
  checkBallWaterCollision(ball, scene, ballVelocity = 1) {
    if (!ball || !this.waterMesh) return false;
    
    // Get ball position
    const ballPosition = ball.position.clone();
    
    // Check if ball is at or below water level
    const isInWater = ballPosition.y <= this.options.waterLevel + 0.1;
    
    // Initialize userData if it doesn't exist
    if (!ball.userData) {
      ball.userData = {};
    }
    
    // Create splash effect if ball just entered water
    if (isInWater && !ball.userData.inWater && ballVelocity > 0.1) {
      this.createSplashEffect(ballPosition, scene, ballVelocity);
      ball.userData.inWater = true;
    } else if (!isInWater && ball.userData.inWater) {
      // Ball exited water
      ball.userData.inWater = false;
    }
    
    return isInWater;
  }
  
  /**
   * Create a splash effect at the given position
   * @param {THREE.Vector3} position - The position to create the splash at
   * @param {THREE.Scene} scene - The scene to add the splash to
   * @param {number} intensity - The intensity of the splash (based on ball velocity)
   */
  createSplashEffect(position, scene, intensity = 1) {
    if (!scene) return;
    
    // Scale intensity to reasonable values
    intensity = Math.min(Math.max(intensity, 0.5), 5);
    
    // Number of particles based on intensity
    const particleCount = Math.floor(20 * intensity);
    
    // Create particle geometry
    const particleGeometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];
    const sizes = [];
    const lifetimes = [];
    
    // Create particles with random initial velocities
    for (let i = 0; i < particleCount; i++) {
      // Position (all start at impact point, slightly above water)
      positions.push(
        position.x, 
        this.options.waterLevel + 0.1, 
        position.z
      );
      
      // Random velocity direction (mostly upward)
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 1.5) * intensity;
      const upwardBias = 0.7 + Math.random() * 0.3; // Mostly up
      
      velocities.push(
        Math.cos(angle) * speed * (1 - upwardBias),
        Math.random() * speed * upwardBias + 1,
        Math.sin(angle) * speed * (1 - upwardBias)
      );
      
      // Random size
      sizes.push(0.1 + Math.random() * 0.2 * intensity);
      
      // Random lifetime (seconds)
      lifetimes.push(0.5 + Math.random() * 0.5);
    }
    
    // Add attributes to geometry
    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particleGeometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
    particleGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    particleGeometry.setAttribute('lifetime', new THREE.Float32BufferAttribute(lifetimes, 1));
    
    // Add custom userData for animation
    particleGeometry.userData = {
      time: 0,
      gravity: 9.8,
      maxLifetime: 1.0,
      initialPositions: positions.slice()
    };
    
    // Create particle material
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 1.0,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    
    // Create particle system
    const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    particleSystem.name = 'waterSplash';
    particleSystem.userData.creationTime = Date.now();
    
    // Add to scene
    scene.add(particleSystem);
    
    // Add to splash effects array for animation
    if (!this.splashEffects) this.splashEffects = [];
    this.splashEffects.push(particleSystem);
    
    // Create a small circular ripple at the impact point
    this.createRippleEffect(position, scene, intensity);
  }
  
  /**
   * Create a ripple effect on the water surface
   * @param {THREE.Vector3} position - The position to create the ripple at
   * @param {THREE.Scene} scene - The scene to add the ripple to
   * @param {number} intensity - The intensity of the ripple
   */
  createRippleEffect(position, scene, intensity = 1) {
    // Create a ring geometry for the ripple
    const innerRadius = 0.2;
    const outerRadius = 0.3;
    const segments = 16;
    const rippleGeometry = new THREE.RingGeometry(innerRadius, outerRadius, segments);
    
    // Rotate to be horizontal
    rippleGeometry.rotateX(-Math.PI / 2);
    
    // Position at water level
    rippleGeometry.translate(position.x, this.options.waterLevel + 0.02, position.z);
    
    // Create ripple material
    const rippleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    
    // Create ripple mesh
    const rippleMesh = new THREE.Mesh(rippleGeometry, rippleMaterial);
    rippleMesh.name = 'waterRipple';
    
    // Add custom userData for animation
    rippleMesh.userData = {
      creationTime: Date.now(),
      duration: 1.0 * intensity, // seconds
      maxSize: 2.0 * intensity,
      initialSize: innerRadius
    };
    
    // Add to scene
    scene.add(rippleMesh);
    
    // Add to ripple effects array for animation
    if (!this.rippleEffects) this.rippleEffects = [];
    this.rippleEffects.push(rippleMesh);
  }
  
  /**
   * Update splash and ripple effects animation
   * @param {number} deltaTime - Time since last frame in seconds
   * @param {THREE.Scene} scene - The scene containing the effects
   */
  updateSplashEffects(deltaTime, scene) {
    if (!scene) return;
    
    // Update splash particle systems
    if (this.splashEffects && this.splashEffects.length > 0) {
      for (let i = this.splashEffects.length - 1; i >= 0; i--) {
        const splash = this.splashEffects[i];
        const geometry = splash.geometry;
        const positions = geometry.getAttribute('position');
        const velocities = geometry.getAttribute('velocity');
        const sizes = geometry.getAttribute('size');
        const lifetimes = geometry.getAttribute('lifetime');
        
        // Update particle positions based on velocities and gravity
        geometry.userData.time += deltaTime;
        const time = geometry.userData.time;
        const gravity = geometry.userData.gravity;
        
        let allParticlesExpired = true;
        
        for (let j = 0; j < positions.count; j++) {
          // Update lifetime
          const lifetime = lifetimes.getX(j) - deltaTime;
          lifetimes.setX(j, lifetime);
          
          if (lifetime > 0) {
            allParticlesExpired = false;
            
            // Get current position and velocity
            const vx = velocities.getX(j);
            const vy = velocities.getY(j);
            const vz = velocities.getZ(j);
            
            // Update position based on velocity
            positions.setX(j, positions.getX(j) + vx * deltaTime);
            positions.setY(j, positions.getY(j) + vy * deltaTime);
            positions.setZ(j, positions.getZ(j) + vz * deltaTime);
            
            // Apply gravity to Y velocity
            velocities.setY(j, vy - gravity * deltaTime);
            
            // Fade out based on lifetime
            const lifeFactor = lifetime / geometry.userData.maxLifetime;
            splash.material.opacity = Math.min(0.8, lifeFactor * 0.8);
            
            // Update size based on lifetime (grow then shrink)
            const sizeFactor = Math.sin(lifeFactor * Math.PI);
            const size = sizes.getX(j) * sizeFactor;
            splash.material.size = size;
          }
        }
        
        // Mark attributes for update
        positions.needsUpdate = true;
        velocities.needsUpdate = true;
        lifetimes.needsUpdate = true;
        
        // Remove expired particle systems
        if (allParticlesExpired) {
          scene.remove(splash);
          this.splashEffects.splice(i, 1);
        }
      }
    }
    
    // Update ripple effects
    if (this.rippleEffects && this.rippleEffects.length > 0) {
      for (let i = this.rippleEffects.length - 1; i >= 0; i--) {
        const ripple = this.rippleEffects[i];
        const elapsed = (Date.now() - ripple.userData.creationTime) / 1000; // seconds
        const duration = ripple.userData.duration;
        
        if (elapsed < duration) {
          // Calculate expansion progress (0 to 1)
          const progress = elapsed / duration;
          
          // Expand the ripple
          const newSize = ripple.userData.initialSize + progress * ripple.userData.maxSize;
          ripple.scale.set(newSize, newSize, 1);
          
          // Fade out
          ripple.material.opacity = 0.7 * (1 - progress);
        } else {
          // Remove expired ripple
          scene.remove(ripple);
          this.rippleEffects.splice(i, 1);
        }
      }
    }
  }
  
  /**
   * Generate the terrain mesh
   */
  generateTerrain() {
    const { width, length, segmentsW, segmentsL } = this.options;
    
    // Create plane geometry
    const geometry = new THREE.PlaneGeometry(
      width, 
      length,
      segmentsW,
      segmentsL
    );
    
    // Initialize heightmap with appropriate dimensions (clear any previous data)
    this.heightMap = new Array(segmentsW + 1).fill(0).map(() => new Array(segmentsL + 1).fill(0));

    // Rotate to be horizontal (XZ plane)
    geometry.rotateX(-Math.PI / 2);
    
    // Access position data
    const positions = geometry.getAttribute('position');
    const colors = [];
    
    // Create tee and hole positions based on course layout
    this.placeTeeAndHole();
    
    // Define tee area as a flat zone
    const teeArea = this.createFlatArea(
      this.teePosition.x, 
      this.teePosition.z, 
      3, // radius of tee area
      this.teePosition.y
    );
    
    // Define putting green as a kidney-shaped flat zone
    const greenArea = this.createPuttingGreen(
      this.holePosition.x, 
      this.holePosition.z, 
      this.greenSize, // size of the kidney-shaped green
      this.holePosition.y
    );

    // Define water moat around the green
    const waterMoat = this.createWaterMoatAroundGreen(
      this.holePosition.x,
      this.holePosition.z,
      this.greenSize,
      this.options.waterLevel
    );

    // Define sand bunker area
    const sandBunker = this.createSandArea(
      width * 0.1, // X position
      -length * 0.2, // Z position
      10, // Radius
      this.terrainTypes[1].height + 0.1 // Slightly above bunker base
    );

    // Create hole depression at the hole position
    const holeDepression = this.createHoleDepression(
      this.holePosition.x,
      this.holePosition.z,
      this.holePosition.y
    );

    // Create bridge terrain at the correct height
    const bridgeTerrain = this.bridgeInfo ? this.createBridgeTerrainArea() : null;

    this.waterHazardArea = waterMoat;
    this.sandBunkerArea = sandBunker;
    
    // Create flat fairway between tee and hole
    const flatFairway = this.createFlatFairway();
    
    // Modify each vertex height based on noise
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      
      // World coordinates
      const worldX = x;
      const worldZ = z;
      
      // Check for special areas first (prioritized order)
      let y = teeArea(worldX, worldZ);
      if (y === null) y = greenArea(worldX, worldZ);
      
      // Apply hole depression - this should override green area if present
      const holeY = holeDepression(worldX, worldZ);
      if (holeY !== null) y = holeY;
      
      // Apply bridge terrain elevation 
      if (bridgeTerrain) {
        const bridgeY = bridgeTerrain(worldX, worldZ);
        if (bridgeY !== null) y = bridgeY;
      }
      
      if (y === null) y = waterMoat(worldX, worldZ);
      if (y === null) y = sandBunker(worldX, worldZ);
      if (y === null && flatFairway) y = flatFairway(worldX, worldZ);
      
      if (y === null) {
        // Use standard noise terrain for areas not covered by special zones
        y = this.getNoiseHeight(worldX, worldZ);
      }
      
      // Set the vertex height directly (no snapping)
      if (!Number.isFinite(y)) {
        console.warn(`Calculated height 'y' is non-finite for vertex (${worldX}, ${worldZ}). Setting to 0.`);
        y = 0;
      }
      positions.setY(i, y);

      // Store height in heightmap
      const xIndex = Math.floor((worldX + width / 2) / width * segmentsW);
      const zIndex = Math.floor((worldZ + length / 2) / length * segmentsL);
      if (xIndex >= 0 && xIndex <= segmentsW && zIndex >= 0 && zIndex <= segmentsL) {
        this.heightMap[xIndex][zIndex] = y;
      }
      
      // Determine terrain type based on height and add color
      let terrainType = this.getTerrainTypeAtHeight(y);
      
      // Force fairway coloring even if height would indicate otherwise
      if (this.isOnFairway(worldX, worldZ) && y >= -0.5) {
        terrainType = this.terrainTypes[3]; // Fairway color
      }
      
      const color = new THREE.Color(terrainType.color);
      colors.push(color.r, color.g, color.b);
    }
    
    // Add vertex colors to geometry
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    // Check for NaN values in positions attribute before computing normals
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      if (!Number.isFinite(y)) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        console.error(`NaN detected in terrain geometry at index ${i}, position (${x}, ${y}, ${z}). Setting y to 0.`);
        positions.setY(i, 0); 
      }
    }

    // Recalculate normals for lighting
    geometry.computeVertexNormals();
    
    // --- Begin TextureLoader and Material Setup ---
    const textureLoader = new THREE.TextureLoader();

    // Texture paths (relative to src/Textures)
    const texturePaths = {
      green: {
        map: 'src/Textures/Stylized_Grass_001_SD-20250506T130657Z-1-001/Stylized_Grass_001_SD/Stylized_Grass_001_basecolor.jpg',
        normalMap: 'src/Textures/Stylized_Grass_001_SD-20250506T130657Z-1-001/Stylized_Grass_001_SD/Stylized_Grass_001_normal.jpg',
        roughnessMap: 'src/Textures/Stylized_Grass_001_SD-20250506T130657Z-1-001/Stylized_Grass_001_SD/Stylized_Grass_001_roughness.jpg',
      },
      fairway: {
        map: 'src/Textures/Stylized_Grass_003_SD-20250506T130641Z-1-001/Stylized_Grass_003_SD/Stylized_Grass_003_basecolor.jpg',
        normalMap: 'src/Textures/Stylized_Grass_003_SD-20250506T130641Z-1-001/Stylized_Grass_003_SD/Stylized_Grass_003_normal.jpg',
        roughnessMap: 'src/Textures/Stylized_Grass_003_SD-20250506T130641Z-1-001/Stylized_Grass_003_SD/Stylized_Grass_003_roughness.jpg',
      },
      rough: {
        map: 'src/Textures/Stylized_Grass_002_SD-20250506T130649Z-1-001/Stylized_Grass_002_SD/Stylized_Grass_002_basecolor.jpg',
        normalMap: 'src/Textures/Stylized_Grass_002_SD-20250506T130649Z-1-001/Stylized_Grass_002_SD/Stylized_Grass_002_normal.jpg',
        roughnessMap: 'src/Textures/Stylized_Grass_002_SD-20250506T130649Z-1-001/Stylized_Grass_002_SD/Stylized_Grass_002_roughness.jpg',
      },
      bunker: {
        map: 'src/Textures/Sand_006_SD-20250506T130354Z-1-001/Sand_006_SD/Sand_006_baseColor.jpg',
        normalMap: 'src/Textures/Sand_006_SD-20250506T130354Z-1-001/Sand_006_SD/Sand_006_normal.jpg',
        roughnessMap: 'src/Textures/Sand_006_SD-20250506T130354Z-1-001/Sand_006_SD/Sand_006_roughness.jpg',
      }
    };

    // Helper to load textures with error logging and proper tiling
    function loadTextureWithTiling(path, renderer, repeat = 60) {
      const tex = textureLoader.load(
        path,
        () => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(repeat, repeat);
          if (renderer && renderer.capabilities) {
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          }
        },
        undefined,
        (err) => {
          console.warn('Texture failed to load:', path, err);
        }
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }


    // Get renderer for anisotropy settings
    const renderer = this.scene ? this.scene.renderer : null;

    // PS1-retro materials: flat-shaded, vertex-colored, no PBR normal/roughness maps.
    // We keep a single low-repeat base-color texture per surface for subtle grain;
    // the dominant look comes from the geometry's per-vertex colors + flat shading.
    const RETRO_TEXTURE_REPEAT = 60; // coarse tiling for a low-res PS1 feel

    this.surfaceMaterials = {
      water: new THREE.MeshPhongMaterial({
        color: new THREE.Color(0x3b6fb0),
        transparent: true,
        opacity: 0.82,
        shininess: 80,           // cheap specular highlight, no env map needed
        specular: 0xbfe0ff,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      green: new THREE.MeshLambertMaterial({
        map: loadTextureWithTiling(texturePaths.green.map, renderer, RETRO_TEXTURE_REPEAT),
        vertexColors: true,
        flatShading: true,
      }),
      fairway: new THREE.MeshLambertMaterial({
        map: loadTextureWithTiling(texturePaths.fairway.map, renderer, RETRO_TEXTURE_REPEAT),
        vertexColors: true,
        flatShading: true,
      }),
      rough: new THREE.MeshLambertMaterial({
        map: loadTextureWithTiling(texturePaths.rough.map, renderer, RETRO_TEXTURE_REPEAT),
        vertexColors: true,
        flatShading: true,
      }),
      bunker: new THREE.MeshLambertMaterial({
        map: loadTextureWithTiling(texturePaths.bunker.map, renderer, RETRO_TEXTURE_REPEAT),
        vertexColors: true,
        flatShading: true,
      }),
    };

    // Create an array of materials for the terrain
    const materials = [
      this.surfaceMaterials.water, // Index 0
      this.surfaceMaterials.bunker, // Index 1
      this.surfaceMaterials.rough, // Index 2
      this.surfaceMaterials.fairway, // Index 3
      this.surfaceMaterials.green // Index 4
    ];

    // Assign material indices to each face based on terrain type
    const materialIndices = [];
    const positionAttribute = geometry.getAttribute('position');
    const faceCount = geometry.index ? geometry.index.count / 3 : positionAttribute.count / 3;

    for (let i = 0; i < faceCount; i++) {
      const faceIndex = i * 3;
      let vertexIndex1, vertexIndex2, vertexIndex3;

      if (geometry.index) {
        vertexIndex1 = geometry.index.getX(faceIndex);
        vertexIndex2 = geometry.index.getX(faceIndex + 1);
        vertexIndex3 = geometry.index.getX(faceIndex + 2);
      } else {
        vertexIndex1 = faceIndex;
        vertexIndex2 = faceIndex + 1;
        vertexIndex3 = faceIndex + 2;
      }

      // Get the center of the face (triangle)
      const x1 = positionAttribute.getX(vertexIndex1);
      const z1 = positionAttribute.getZ(vertexIndex1);
      const x2 = positionAttribute.getX(vertexIndex2);
      const z2 = positionAttribute.getZ(vertexIndex2);
      const x3 = positionAttribute.getX(vertexIndex3);
      const z3 = positionAttribute.getZ(vertexIndex3);

      // Check for NaN values in vertex positions
      if (!Number.isFinite(x1) || !Number.isFinite(z1) ||
          !Number.isFinite(x2) || !Number.isFinite(z2) ||
          !Number.isFinite(x3) || !Number.isFinite(z3)) {
        console.warn(`Skipping face ${i} due to non-finite vertex positions.`);
        continue; // Skip this face
      }

      const centerX = (x1 + x2 + x3) / 3;
      const centerZ = (z1 + z2 + z3) / 3;

      const surfaceType = this.getSurfaceTypeAtPosition(centerX, centerZ);
      let materialIndex = 3; // Default to fairway

      switch (surfaceType) {
        case 'water':
          materialIndex = 0;
          break;
        case 'bunker':
          materialIndex = 1;
          break;
        case 'rough':
          materialIndex = 2;
          break;
        case 'fairway':
          materialIndex = 3;
          break;
        case 'green':
          materialIndex = 4;
          break;
      }
      geometry.addGroup(faceIndex, 3, materialIndex);
    }

    // Create and return the mesh with multiple materials
    this.terrainMesh = new THREE.Mesh(geometry, materials);
    return this.terrainMesh;
  }

  /**
   * Determine the terrain type based on height
   */
  getTerrainTypeAtHeight(height) {
    // Find appropriate terrain type based on height
    for (let i = 0; i < this.terrainTypes.length; i++) {
      if (height <= this.terrainTypes[i].height) {
        return this.terrainTypes[i];
      }
    }
    return this.terrainTypes[this.terrainTypes.length - 1];
  }

  /**
   * Place tee and hole at appropriate locations on the terrain
   */
  placeTeeAndHole() {
    const { width, length } = this.options;
    
    // Tee placement
    const teeX = -width * 0.3;
    const teeZ = 0;
    // Ensure teeY is above rough level
    const teeY = Math.max(0.8, this.terrainTypes[2].height + 0.1); // 0.8 is original, ensure it's above rough

    // Hole placement - on the putting green
    const holeX = width * 0.3;
    const holeZ = 0;
    // Get the base noise height without any terrain features applied (original surface)
    const baseHoleY = this.getNoiseHeight(holeX, holeZ);
    const holeY = Math.max(baseHoleY, this.terrainTypes[2].height + 0.1); // Ensure it's above rough
    
    // Store the original surface height for flag positioning (before hole depression is applied)
    this.holeSurfaceHeight = holeY;
    
    this.teePosition = new THREE.Vector3(teeX, teeY, teeZ);
    this.holePosition = new THREE.Vector3(holeX, holeY, holeZ);
    
    // Store green size for later use
    this.greenSize = 15; // Size of the kidney-shaped green

    // Create a fairway between tee and hole
    this.createFairway();
  }
  
  /**
   * Create and position the golf hole flag
   * @param {THREE.Scene} scene - The scene to add the flag to
   * @returns {THREE.Group} The flag object
   */
  createFlag(scene) {
    // Create a group to hold all flag components
    const flagGroup = new THREE.Group();
    flagGroup.name = 'golfFlag';
    
    // Load the 3D model
    const loader = new GLTFLoader();
    const modelPath = 'src/Assets/golf hole flag.glb';
    
    // Get the actual terrain height at the hole position
    loader.load(
      modelPath,
      (gltf) => {
        if (window.DEBUG) console.log('Flag model loaded successfully');
        // Remove all children (if fallback was added by error)
        while (flagGroup.children.length > 0) {
          const child = flagGroup.children[0];
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
          flagGroup.remove(child);
        }
        // Add the model to the group
        const model = gltf.scene;
        model.scale.set(2.5, 2.5, 2.5); // Increased scale
        
        // Calculate the bounding box to position the flag correctly
        const box = new THREE.Box3().setFromObject(model);
        const modelHeight = box.max.y - box.min.y;
        const modelBottom = box.min.y;
        
        // Position the model so its bottom sits at the group's origin (surface level)
        model.position.y = -modelBottom;
        
        flagGroup.add(model);
        model.traverse((child) => {
          if (child.isMesh && child.name.toLowerCase().includes('flag')) {
            flagGroup.userData.flagMesh = child;
          }
        });
      },
      undefined,
      (error) => {
        console.error('Error loading flag model:', error);
        // Only add fallback if model fails
        this.createFallbackFlag(flagGroup);
      }
    );
    
    
    // Position flagGroup at hole position
    if (this.holePosition && this.holeSurfaceHeight !== undefined) {
      // Use the stored original surface height instead of querying current terrain height
      // This ensures flag base stays at surface level even with hole depression
      const surfaceHeight = this.holeSurfaceHeight;
      
      flagGroup.position.set(
        this.holePosition.x,
        surfaceHeight, // Flag base at original ground surface level
        this.holePosition.z
      );
      
      // Store both surface level and hole level for collision detection
      flagGroup.userData.surfaceLevel = surfaceHeight;
      flagGroup.userData.holeLevel = surfaceHeight - 0.1; // Hole is 0.1 units below surface
    }
    
    // Add to scene if provided
    if (scene) {
      scene.add(flagGroup);
    }
    
    // Store reference to flag
    this.flagObject = flagGroup;
    
    // Add collision detection properties
    flagGroup.userData.isFlag = true;
    flagGroup.userData.holeRadius = 0.3;
    
    return flagGroup;
  }
  
  /**
   * Create a fallback flag for when the 3D model fails to load
   * @param {THREE.Group} flagGroup - The group to add the fallback flag to
   */
  createFallbackFlag(flagGroup) {
    // Create flag pole (cylinder)
    const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 3, 8);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xDDDDDD });
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 1.5; // Half height of pole
    flagGroup.add(pole);
    
    // Create flag (simple rectangle)
    const flagGeometry = new THREE.PlaneGeometry(1, 0.6);
    const flagMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFF0000, 
      side: THREE.DoubleSide
    });
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(0.5, 2.7, 0); // Position at top of pole
    flag.rotation.y = Math.PI / 2; // Orient perpendicular to pole
    flagGroup.add(flag);
    
    // Store reference for animations
    flagGroup.userData.flagMesh = flag;
  }
  
  /**
   * Create and position the bridge over the water moat
   * @param {THREE.Scene} scene - The scene to add the bridge to
   * @returns {THREE.Group} The bridge object
   */
  createBridge(scene) {
    if (!this.bridgeInfo) return null;
    
    // Create a group to hold the bridge
    const bridgeGroup = new THREE.Group();
    bridgeGroup.name = 'bridge';
    
    // Initialize collision meshes array
    this.bridgeCollisionMeshes = [];
    
    // Load the 3D bridge model
    const loader = new GLTFLoader();
    const modelPath = 'src/Assets/Small Bridge.glb';
    
    loader.load(
      modelPath,
      (gltf) => {
        if (window.DEBUG) console.log('Bridge model loaded successfully');
        
        // Add the model to the group
        const model = gltf.scene;
        model.scale.set(1.5, 1.5, 1.5); // Scale appropriately
        
        // Calculate the bounding box to position the bridge correctly
        const box = new THREE.Box3().setFromObject(model);
        const modelBottom = box.min.y;
        
        // Position the model so its bottom sits at the bridge height
        model.position.y = -modelBottom;
        
        bridgeGroup.add(model);
        
        // Extract collision geometry from the loaded model
        this.extractBridgeCollisionGeometry(model, bridgeGroup);
        
        // Mark bridge surfaces for audio system
        model.traverse((child) => {
          if (child.isMesh) {
            child.userData.surfaceType = 'bridge';
          }
        });
      },
      undefined,
      (error) => {
        console.error('Error loading bridge model:', error);
        // Create a simple fallback bridge with collision
        this.createFallbackBridge(bridgeGroup);
        this.createFallbackBridgeCollision(bridgeGroup);
      }
    );
    
    // Position bridge group at calculated position
    bridgeGroup.position.set(
      this.bridgeInfo.centerX,
      this.bridgeInfo.height,
      this.bridgeInfo.centerZ
    );
    
    // Add to scene if provided
    if (scene) {
      scene.add(bridgeGroup);
    }
    
    // Store reference to bridge
    this.bridgeObject = bridgeGroup;
    
    return bridgeGroup;
  }
  
  /**
   * Create a fallback bridge when 3D model fails to load
   * @param {THREE.Group} bridgeGroup - The group to add the fallback bridge to
   */
  createFallbackBridge(bridgeGroup) {
    // Create a simple wooden plank bridge
    const bridgeGeometry = new THREE.BoxGeometry(this.bridgeInfo.length, 0.2, this.bridgeInfo.width);
    const bridgeMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513, // Brown wood color
      roughness: 0.8
    });
    const bridge = new THREE.Mesh(bridgeGeometry, bridgeMaterial);
    bridge.position.y = 0.1; // Slightly above the group origin
    bridge.userData.surfaceType = 'bridge';
    bridgeGroup.add(bridge);
    
    // Add some railings
    const railingGeometry = new THREE.BoxGeometry(this.bridgeInfo.length, 0.8, 0.1);
    const railingMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
    
    const leftRailing = new THREE.Mesh(railingGeometry, railingMaterial);
    leftRailing.position.set(0, 0.5, this.bridgeInfo.width / 2 - 0.05);
    bridgeGroup.add(leftRailing);
    
    const rightRailing = new THREE.Mesh(railingGeometry, railingMaterial);
    rightRailing.position.set(0, 0.5, -this.bridgeInfo.width / 2 + 0.05);
    bridgeGroup.add(rightRailing);
  }
  
  /**
   * Extract collision geometry from loaded bridge model
   * @param {THREE.Object3D} model - The loaded bridge model
   * @param {THREE.Group} bridgeGroup - The bridge group for positioning
   */
  extractBridgeCollisionGeometry(model, bridgeGroup) {
    // Traverse the model to find collision-suitable meshes
    model.traverse((child) => {
      if (child.isMesh && child.geometry) {
        // Create invisible collision mesh with world transform
        const collisionMesh = child.clone();
        
        // Apply the bridge group's world transform to the collision mesh
        collisionMesh.updateMatrixWorld(true);
        
        // Make collision mesh invisible but keep geometry
        collisionMesh.material = new THREE.MeshBasicMaterial({ 
          transparent: true, 
          opacity: 0,
          visible: false 
        });
        
        // Store for collision detection
        this.bridgeCollisionMeshes.push({
          mesh: collisionMesh,
          originalMesh: child
        });
      }
    });
    
    if (window.DEBUG) console.log(`Created ${this.bridgeCollisionMeshes.length} bridge collision meshes`);
  }
  
  /**
   * Create collision geometry for fallback bridge
   * @param {THREE.Group} bridgeGroup - The bridge group
   */
  createFallbackBridgeCollision(bridgeGroup) {
    // Create a simple box collision mesh for the bridge deck
    const collisionGeometry = new THREE.BoxGeometry(
      this.bridgeInfo.length, 
      0.2, 
      this.bridgeInfo.width
    );
    
    const collisionMaterial = new THREE.MeshBasicMaterial({ 
      transparent: true, 
      opacity: 0,
      visible: false 
    });
    
    const collisionMesh = new THREE.Mesh(collisionGeometry, collisionMaterial);
    collisionMesh.position.y = 0.1; // Same as visible bridge
    
    // Store for collision detection
    this.bridgeCollisionMeshes = [{
      mesh: collisionMesh,
      originalMesh: null
    }];
    
    if (window.DEBUG) console.log('Created fallback bridge collision mesh');
  }
  
  /**
   * Check if the ball has entered the hole
   * @param {THREE.Object3D} ball - The golf ball object
   * @returns {boolean} Whether the ball is in the hole
   */
  checkBallInHole(ball) {
    if (!ball || !this.flagObject || !this.holePosition) return false;
    
    // Get ball position
    const ballPosition = ball.position.clone();
    
    // Calculate horizontal distance to hole
    const holePosition = this.holePosition.clone();
    const horizontalDist = new THREE.Vector2(
      ballPosition.x - holePosition.x,
      ballPosition.z - holePosition.z
    ).length();
    
    // Check if ball is within hole radius
    const isOverHole = horizontalDist < this.flagObject.userData.holeRadius;
    
    // Use the proper hole level (below surface) for collision detection
    const surfaceLevel = this.flagObject.userData.surfaceLevel || this.holePosition.y;
    const holeLevel = this.flagObject.userData.holeLevel || (surfaceLevel - 0.1);
    
    // Check if ball is at the right height - ball center should be at or below surface level
    // but above the bottom of the hole
    const isAtHoleLevel = (ballPosition.y <= surfaceLevel + 0.05) && 
                         (ballPosition.y >= holeLevel - 0.05);
    
    // Check if ball velocity is low enough to be considered stopped
    const isStopped = ball.velocity ? ball.velocity.length() < 0.5 : true;
    
    // Ball is in hole if all conditions are met
    const isInHole = isOverHole && isAtHoleLevel && isStopped;
    
    // If ball is in hole, make it sink gradually
    if (isInHole && ball.velocity) {
      // Apply downward force to make the ball sink into the hole
      ball.velocity.y = -0.5;
      ball.velocity.x *= 0.5;
      ball.velocity.z *= 0.5;
    }
    
    return isInHole;
  }

  /**
   * Create a flat fairway with smooth curves and natural shape between tee and hole
   * @returns {Function} A function that returns the height at a given point
   */
  createFlatFairway() {
    if (!this.teePosition || !this.holePosition) return null;
    
    const start = new THREE.Vector2(this.teePosition.x, this.teePosition.z);
    const end = new THREE.Vector2(this.holePosition.x, this.holePosition.z);
    const width = 22; // Slightly wider for more natural look
    const curveBlendRadius = 12; // Larger curved edge blending radius
    
    // Calculate fairway height as average between tee and hole
    const fairwayHeight = (this.teePosition.y + this.holePosition.y) / 2;
    
    return (x, z) => {
      const point = new THREE.Vector2(x, z);
      const line = end.clone().sub(start);
      const len = line.length();
      
      if (len === 0) return null; // Avoid division by zero
      
      const lineDir = line.clone().divideScalar(len);
      const pointVec = point.clone().sub(start);
      const projection = pointVec.dot(lineDir);
      
      // Check if point is along the fairway line
      if (projection < -width || projection > len + width) return null;
      
      // Calculate perpendicular distance from fairway centerline
      const perpDist = pointVec.clone().sub(lineDir.clone().multiplyScalar(Math.max(0, Math.min(len, projection)))).length();
      
      // Add organic width variation along the fairway length
      const progressAlongFairway = Math.max(0, Math.min(1, projection / len));
      const widthVariation = 1 + 0.3 * Math.sin(progressAlongFairway * Math.PI * 2) * Math.sin(progressAlongFairway * Math.PI * 3);
      const dynamicWidth = (width / 2) * widthVariation;
      
      // Core fairway area (completely flat) with organic shape
      if (perpDist <= dynamicWidth) {
        return fairwayHeight;
      }
      
      // Curved edge blending area with smooth organic curves
      if (perpDist <= dynamicWidth + curveBlendRadius) {
        const blendDistance = perpDist - dynamicWidth;
        const blendFactor = blendDistance / curveBlendRadius;
        
        // Use smooth organic curve for natural blending
        const smoothBlend = Math.pow(blendFactor, 1.5); // More gradual curve
        
        // Get surrounding terrain height for blending
        const terrainHeight = this.getNoiseHeight(x, z);
        return THREE.MathUtils.lerp(fairwayHeight, terrainHeight, smoothBlend);
      }
      
      return null; // Outside fairway influence area
    };
  }

  /**
   * Create a fairway between tee and hole
   */
  createFairway() {
    // This method will be used when generating terrain
    // to ensure a playable path between tee and hole
    this.fairwayPath = {
      start: new THREE.Vector2(this.teePosition.x, this.teePosition.z),
      end: new THREE.Vector2(this.holePosition.x, this.holePosition.z),
      width: 20, // Increased width for more natural look
      curveBlendRadius: 8 // Radius for curved edge blending
    };
  }

  /**
   * Check if a point is on the fairway (including curved edge area)
   */
  isOnFairway(x, z) {
    if (!this.fairwayPath) return false;
    
    const point = new THREE.Vector2(x, z);
    const start = this.fairwayPath.start;
    const end = this.fairwayPath.end;
    
    // Calculate distance from point to line segment (fairway)
    const line = end.clone().sub(start);
    const len = line.length();
    
    if (len === 0) return false;
    
    const lineDir = line.clone().divideScalar(len);
    const pointVec = point.clone().sub(start);
    const projection = pointVec.dot(lineDir);
    
    // Check if point is along the fairway line (with some extension)
    if (projection < -this.fairwayPath.width || projection > len + this.fairwayPath.width) return false;
    
    // Calculate perpendicular distance from fairway centerline
    const perpDist = pointVec.clone().sub(lineDir.clone().multiplyScalar(Math.max(0, Math.min(len, projection)))).length();
    
    // Add organic width variation to match the fairway shape
    const progressAlongFairway = Math.max(0, Math.min(1, projection / len));
    const widthVariation = 1 + 0.3 * Math.sin(progressAlongFairway * Math.PI * 2) * Math.sin(progressAlongFairway * Math.PI * 3);
    const dynamicWidth = (this.fairwayPath.width / 2) * widthVariation;
    
    // Check if within organic fairway width including curved blend area
    return perpDist <= dynamicWidth + (this.fairwayPath.curveBlendRadius || 0);
  }

  /**
   * Get terrain height at specific world coordinates (for physics)
   * Uses the same logic as terrain generation to ensure consistency
   */
  getHeightAtPosition(x, z) {
    // Check for bridge collision first (highest priority)
    const bridgeHeight = this.getBridgeHeightAtPosition(x, z);
    if (bridgeHeight !== null) {
      return bridgeHeight;
    }
    
    // Use the same terrain feature logic as in generateTerrain()
    // This ensures physics matches visual terrain
    
    // Check tee area
    if (this.teePosition) {
      const distanceFromTee = Math.sqrt((x - this.teePosition.x) ** 2 + (z - this.teePosition.z) ** 2);
      if (distanceFromTee < 3) {
        return this.teePosition.y;
      }
    }
    
    // Check putting green (kidney-shaped area around hole)
    if (this.greenParams) {
      const localX = x - this.greenParams.centerX;
      const localZ = z - this.greenParams.centerZ;
      const size = this.greenParams.size;
      
      const ellipseDistance = Math.sqrt((localX / 1.5) ** 2 + localZ ** 2) / size;
      const circleDistance = Math.sqrt((localX + size * 0.3) ** 2 + (localZ - size * 0.1) ** 2) / (size * 0.7);
      const kidneyDistance = Math.max(ellipseDistance, 1 - circleDistance);
      
      if (kidneyDistance < 1) {
        // Check for hole depression within green
        const holeDistance = Math.sqrt((x - this.holePosition.x) ** 2 + (z - this.holePosition.z) ** 2);
        if (holeDistance < 0.3) {
          // Core hole area
          return this.holePosition.y - 0.1;
        } else if (holeDistance < 0.6) {
          // Sloped lip around hole
          const blendFactor = (holeDistance - 0.3) / (0.6 - 0.3);
          return THREE.MathUtils.lerp(this.holePosition.y - 0.1, this.holePosition.y, blendFactor);
        }
        // Regular green area
        return this.holePosition.y;
      }
    }
    
    // Check water moat (if it exists)
    if (this.waterHazardArea) {
      const waterHeight = this.waterHazardArea(x, z);
      if (waterHeight !== null) {
        return waterHeight;
      }
    }
    
    // Check sand bunker (if it exists)
    if (this.sandBunkerArea) {
      const bunkerHeight = this.sandBunkerArea(x, z);
      if (bunkerHeight !== null) {
        return bunkerHeight;
      }
    }
    
    // Check fairway
    if (this.isOnFairway && this.isOnFairway(x, z)) {
      // Get fairway height - approximate based on tee and hole heights
      const fairwayHeight = (this.teePosition.y + this.holePosition.y) / 2;
      return fairwayHeight;
    }
    
    // Default to noise height for rough areas
    return this.getNoiseHeight(x, z);
  }

  /**
   * Get bridge height at position using 3D raycasting collision
   * @param {number} x - X coordinate in world space
   * @param {number} z - Z coordinate in world space
   * @returns {number|null} Bridge surface height or null if not over bridge
   */
  getBridgeHeightAtPosition(x, z) {
    if (!this.bridgeCollisionMeshes || this.bridgeCollisionMeshes.length === 0) {
      return null;
    }
    
    // Create a raycaster pointing downward from high above the bridge
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3(x, this.bridgeInfo.height + 10, z);
    const direction = new THREE.Vector3(0, -1, 0); // Pointing down
    
    raycaster.set(origin, direction);
    
    // Test intersection with all bridge collision meshes
    const collisionMeshes = this.bridgeCollisionMeshes.map(item => {
      // Update world matrix for accurate collision detection
      if (item.mesh.parent) {
        item.mesh.parent.updateMatrixWorld(true);
      }
      item.mesh.updateMatrixWorld(true);
      return item.mesh;
    });
    
    const intersections = raycaster.intersectObjects(collisionMeshes, true);
    
    if (intersections.length > 0) {
      // Return the highest intersection point (closest to ray origin)
      const highestIntersection = intersections.reduce((highest, current) => {
        return current.point.y > highest.point.y ? current : highest;
      });
      
      // Add small offset to prevent ball from clipping into bridge
      return highestIntersection.point.y + 0.05;
    }
    
    return null;
  }

  /**
   * Check if a position is a water hazard
   */
  isWaterHazard(x, y, z) {
    const height = this.getHeightAtPosition(x, z);
    return height < this.terrainTypes[0].height;
  }

  /**
   * Check if a position is in a sand bunker
   */
  isSandBunker(x, y, z) {
    const height = this.getHeightAtPosition(x, z);
    return height >= this.terrainTypes[0].height && height < this.terrainTypes[1].height;
  }

  /**
   * Estimate the terrain normal at a given (x, z) position.
   * Uses central differences on the height map.
   */
  getNormalAtPosition(x, z) {
    const delta = 0.1;
    const hL = this.getHeightAtPosition(x - delta, z);
    const hR = this.getHeightAtPosition(x + delta, z);
    const hD = this.getHeightAtPosition(x, z - delta);
    const hU = this.getHeightAtPosition(x, z + delta);

    // The normal is the cross product of the two tangents
    const normal = new THREE.Vector3(
      hL - hR, // x
      2 * delta, // y
      hD - hU  // z
    );
    normal.normalize();
    return normal;
  }

  /**
   * Get the surface type at a specific position on the terrain
   * @param {number} x - X coordinate in world space
   * @param {number} z - Z coordinate in world space
   * @returns {string} The surface type ("fairway", "green", "rough", "bunker", "water")
   */
  getSurfaceTypeAtPosition(x, z) {
    // Get the height at this position
    const y = this.getHeightAtPosition(x, z);
    
    // console.log(`getSurfaceTypeAtPosition(${x}, ${z}) - height: ${y}`); // Debugging

    // Check if it's in special areas
    
    // Check if on bridge
    if (this.bridgeInfo) {
      const isOnBridge = (
        Math.abs(x - this.bridgeInfo.centerX) < this.bridgeInfo.length / 2 &&
        Math.abs(z - this.bridgeInfo.centerZ) < this.bridgeInfo.width / 2 &&
        Math.abs(y - this.bridgeInfo.height) < 0.5 // Allow some height tolerance
      );
      if (isOnBridge) {
        return "bridge";
      }
    }
    
    // Check if on putting green (kidney-shaped area around hole)
    if (this.greenParams) {
      // Use the same kidney shape calculation as in createPuttingGreen
      const localX = x - this.greenParams.centerX;
      const localZ = z - this.greenParams.centerZ;
      const size = this.greenParams.size;
      
      const ellipseDistance = Math.sqrt((localX / 1.5) ** 2 + localZ ** 2) / size;
      const circleDistance = Math.sqrt((localX + size * 0.3) ** 2 + (localZ - size * 0.1) ** 2) / (size * 0.7);
      const kidneyDistance = Math.max(ellipseDistance, 1 - circleDistance);
      
      if (kidneyDistance < 1) {
        // console.log(`getSurfaceTypeAtPosition(${x}, ${z}) returning: green`); // Debugging
        return "green";
      }
    }
    
    // Check if on tee (near tee position)
    const distanceFromTee = new THREE.Vector2(x - this.teePosition.x, z - this.teePosition.z).length();
    if (distanceFromTee < 5) {
      // console.log(`getSurfaceTypeAtPosition(${x}, ${z}) returning: green (tee)`); // Debugging
      return "green"; // Tee box has similar properties to green
    }

    // Check for explicitly defined water hazard areas
    if (this.waterHazardArea && this.waterHazardArea(x, z) !== null) {
      return "water";
    }

    // Check for explicitly defined sand bunker areas
    if (this.sandBunkerArea && this.sandBunkerArea(x, z) !== null) {
      return "bunker";
    }
    
    // Check for water hazard (based on height)
    if (y <= this.terrainTypes[0].height) {
      // console.log(`getSurfaceTypeAtPosition(${x}, ${z}) returning: water`); // Debugging
      return "water";
    }
    
    // Check for sand bunker (based on height)
    if (y <= this.terrainTypes[1].height) {
      // console.log(`getSurfaceTypeAtPosition(${x}, ${z}) returning: bunker`); // Debugging
      return "bunker";
    }
    
    // Check if on fairway
    if (this.isOnFairway(x, z)) {
      // console.log(`getSurfaceTypeAtPosition(${x}, ${z}) returning: fairway`); // Debugging
      return "fairway";
    }
    
    // Default to rough
    // console.log(`getSurfaceTypeAtPosition(${x}, ${z}) returning: rough`); // Debugging
    return "rough";
  }
}

export default TerrainGenerator;
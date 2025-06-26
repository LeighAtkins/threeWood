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
      segmentsW: options.segmentsW || 100,
      segmentsL: options.segmentsL || 100,
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
   * Create a circular water area
   */
  createWaterArea(centerX, centerZ, radius, height) {
    return (x, z) => {
      const distance = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
      if (distance < radius) {
        return height;
      }
      return null;
    };
  }

  /**
   * Create a circular sand area (bunker)
   */
  createSandArea(centerX, centerZ, radius, height) {
    return (x, z) => {
      const distance = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
      if (distance < radius) {
        return height;
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
    
    // Create enhanced water material
    const waterMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x4477cc), // Slightly more vibrant blue
      transparent: true,
      opacity: 0.85,
      roughness: 0.05, // Very smooth for better reflections
      metalness: 0.1,
      reflectivity: 0.9, // High reflectivity
      clearcoat: 0.5, // Add clearcoat for better water look
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
      envMapIntensity: 1.5 // Enhance environment reflections
    });
    
    // Create water mesh
    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.name = 'waterSurface';
    this.waterMesh.receiveShadow = true;
    this.waterMesh.castShadow = false; // Water doesn't cast shadows
    
    // Add subtle blue point light under water for glow effect
    const waterLight = new THREE.PointLight(0x0066cc, 0.5, 50);
    waterLight.position.set(0, this.options.waterLevel - 2, 0);
    this.waterMesh.add(waterLight);
    
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
    
    // Update time with scaled delta for smoother animation
    this.waterTime += deltaTime * 0.8;
    
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
        
        // Primary wave pattern - larger, slower waves
        const wave1 = Math.sin(x * primaryWaveFreq + this.waterTime * primaryWaveSpeed) * 
                     Math.cos(z * primaryWaveFreq * 0.8 + this.waterTime * primaryWaveSpeed * 0.8) * 
                     primaryWaveHeight;
        
        // Secondary wave pattern - medium, perpendicular waves
        const wave2 = Math.sin(z * secondaryWaveFreq + this.waterTime * secondaryWaveSpeed) * 
                     Math.cos(x * secondaryWaveFreq * 0.9 + this.waterTime * secondaryWaveSpeed * 1.1) * 
                     secondaryWaveHeight;
        
        // Tertiary wave pattern - small ripples
        const wave3 = Math.sin((x + z) * tertiaryWaveFreq + this.waterTime * tertiaryWaveSpeed) * 
                     Math.sin((x - z) * tertiaryWaveFreq * 1.1 + this.waterTime * tertiaryWaveSpeed * 1.3) * 
                     tertiaryWaveHeight;
        
        // Combine wave patterns with distance-based attenuation for smoother edges
        const distFromCenter = Math.sqrt(x*x + z*z) / (this.options.width / 2);
        const edgeFactor = Math.max(0, 1 - Math.max(0, distFromCenter - 0.7) * 3);
        const combinedWave = (wave1 + wave2 + wave3) * edgeFactor;
        
        // Update Y position with combined wave pattern
        positions.setY(i, this.options.waterLevel + combinedWave);
      }
    }
    
    // Mark attributes for update
    positions.needsUpdate = true;
    
    // Update normals for better lighting
    this.waterMesh.geometry.computeVertexNormals();
    
    // Animate water material properties for subtle color changes
    if (this.waterMesh.material) {
      // Subtle opacity pulsing
      const opacityPulse = 0.85 + Math.sin(this.waterTime * 0.2) * 0.05;
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
    
    // Initialize heightmap with appropriate dimensions
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

    // Define water hazard area
    const waterHazard = this.createWaterArea(
      -width * 0.1, // X position
      length * 0.2, // Z position
      15, // Radius
      this.options.waterLevel // Height at water level
    );

    // Define sand bunker area
    const sandBunker = this.createSandArea(
      width * 0.1, // X position
      -length * 0.2, // Z position
      10, // Radius
      this.terrainTypes[1].height + 0.1 // Slightly above bunker base
    );

    this.waterHazardArea = waterHazard;
    this.sandBunkerArea = sandBunker;
    
    // Modify each vertex height based on noise
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      
      // World coordinates
      const worldX = x;
      const worldZ = z;
      
      // Check for special areas first
      let y = teeArea(worldX, worldZ);
      if (y === null) y = greenArea(worldX, worldZ);
      if (y === null) y = waterHazard(worldX, worldZ);
      if (y === null) y = sandBunker(worldX, worldZ);
      
      if (y === null) {
        y = this.getNoiseHeight(worldX, worldZ);
        
        // Ensure fairway is playable and flatter
        if (this.isOnFairway(worldX, worldZ)) {
          // Smooth fairway by averaging with neighbors and reducing height variation
          const samples = 5;
          let sum = y;
          for (let s = 0; s < samples; s++) {
            const offsetX = (Math.random() - 0.5) * 2;
            const offsetZ = (Math.random() - 0.5) * 2;
            sum += this.getNoiseHeight(worldX + offsetX, worldZ + offsetZ);
          }
          y = sum / (samples + 1);
          y = THREE.MathUtils.lerp(y, this.holePosition.y, 0.5); // Increased flattening towards hole
        }
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

    // === TEXTURE TILING CONSTANT ===
    const TERRAIN_TEXTURE_REPEAT = 50; // Increase/decrease for sharper or more stretched look

    // Helper to load textures with error logging and proper tiling
    function loadTextureWithTiling(path, renderer, repeat = TERRAIN_TEXTURE_REPEAT) {
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

    // Create a material for each surface type with proper tiling
    this.surfaceMaterials = {
      water: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x4477cc), // Slightly more vibrant blue
        transparent: true,
        opacity: 0.85,
        roughness: 0.05, // Very smooth for better reflections
        metalness: 0.1,
        reflectivity: 0.9, // High reflectivity
        clearcoat: 0.5, // Add clearcoat for better water look
        clearcoatRoughness: 0.1,
        side: THREE.DoubleSide,
        envMapIntensity: 1.5 // Enhance environment reflections
      }),
      green: new THREE.MeshStandardMaterial({
        map: loadTextureWithTiling(texturePaths.green.map, renderer),
        normalMap: loadTextureWithTiling(texturePaths.green.normalMap, renderer),
        roughnessMap: loadTextureWithTiling(texturePaths.green.roughnessMap, renderer),
        flatShading: false, // Set to false for smoother normals with normal maps
      }),
      fairway: new THREE.MeshStandardMaterial({
        map: loadTextureWithTiling(texturePaths.fairway.map, renderer),
        normalMap: loadTextureWithTiling(texturePaths.fairway.normalMap, renderer),
        roughnessMap: loadTextureWithTiling(texturePaths.fairway.roughnessMap, renderer),
        flatShading: false,
      }),
      rough: new THREE.MeshStandardMaterial({
        map: loadTextureWithTiling(texturePaths.rough.map, renderer),
        normalMap: loadTextureWithTiling(texturePaths.rough.normalMap, renderer),
        roughnessMap: loadTextureWithTiling(texturePaths.rough.roughnessMap, renderer),
        flatShading: false,
      }),
      bunker: new THREE.MeshStandardMaterial({
        map: loadTextureWithTiling(texturePaths.bunker.map, renderer),
        normalMap: loadTextureWithTiling(texturePaths.bunker.normalMap, renderer),
        roughnessMap: loadTextureWithTiling(texturePaths.bunker.roughnessMap, renderer),
        flatShading: false,
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
    // Dynamically get the terrain height at the hole position, ensure it's above rough level
    const baseHoleY = this.getHeightAtPosition(holeX, holeZ);
    const holeY = Math.max(baseHoleY, this.terrainTypes[2].height + 0.1); // Ensure it's above rough
    
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
        console.log('Flag model loaded successfully');
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
        model.position.y = 0; // Position at the group's origin
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
    if (this.holePosition) {
      flagGroup.position.set(
        this.holePosition.x,
        this.holePosition.y, // Use actual terrain height for the group's base
        this.holePosition.z
      );
    }
    
    // Add to scene if provided
    if (scene) {
      scene.add(flagGroup);
    }
    
    // Store reference to flag
    this.flagObject = flagGroup;
    
    // Add collision detection properties
    flagGroup.userData.isFlag = true;
    flagGroup.userData.holeRadius = 0.15;
    
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
    
    // Check if ball is at the right height (at or slightly below hole level)
    // The hole is now positioned below ground level, so check for a lower position
    const isAtHoleLevel = (ballPosition.y <= holePosition.y + 0.1) && 
                         (ballPosition.y >= holePosition.y - 0.3);
    
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
   * Create a fairway between tee and hole
   */
  createFairway() {
    // This method will be used when generating terrain
    // to ensure a playable path between tee and hole
    this.fairwayPath = {
      start: new THREE.Vector2(this.teePosition.x, this.teePosition.z),
      end: new THREE.Vector2(this.holePosition.x, this.holePosition.z),
      width: 15 // Width of the fairway
    };
  }

  /**
   * Check if a point is on the fairway
   */
  isOnFairway(x, z) {
    if (!this.fairwayPath) return false;
    
    const point = new THREE.Vector2(x, z);
    const start = this.fairwayPath.start;
    const end = this.fairwayPath.end;
    
    // Calculate distance from point to line segment (fairway)
    const line = end.clone().sub(start);
    const len = line.length();
    const lineDir = line.clone().divideScalar(len);
    
    const pointVec = point.clone().sub(start);
    const projection = pointVec.dot(lineDir);
    
    // Check if point is between start and end
    if (projection < 0 || projection > len) return false;
    
    // Calculate perpendicular distance
    const perpDist = pointVec.clone().sub(lineDir.clone().multiplyScalar(projection)).length();
    
    // Check if within fairway width
    return perpDist <= this.fairwayPath.width;
  }

  /**
   * Get terrain height at specific world coordinates (for physics)
   */
  getHeightAtPosition(x, z) {
    // If heightmap is available, use it for faster lookups
    if (this.heightMap && this.heightMap.length > 0) {
      const { width, length, segmentsW, segmentsL } = this.options;
      const xIndex = Math.floor((x + width / 2) / width * segmentsW);
      const zIndex = Math.floor((z + length / 2) / length * segmentsL);

      if (xIndex >= 0 && xIndex <= segmentsW && zIndex >= 0 && zIndex <= segmentsL) {
        return this.heightMap[xIndex][zIndex];
      }
    }
    
    // Fallback to the noise height if heightmap is not available or out of bounds
    const height = this.getNoiseHeight(x, z);
    return height;
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
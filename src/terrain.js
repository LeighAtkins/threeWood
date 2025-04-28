import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

/**
 * Terrain generation for ThreeWood
 * Generates procedural golf courses using Perlin noise
 */
class TerrainGenerator {
  constructor(options = {}) {
    this.options = {
      width: options.width || 100,
      length: options.length || 100,
      segmentsW: options.segmentsW || 100,
      segmentsL: options.segmentsL || 100,
      maxHeight: options.maxHeight || 5,
      minHeight: options.minHeight || -1,
      noise: options.noise || {
        octaves: 3,
        persistence: 0.4,
        lacunarity: 1.8,
        scale: 40,
        seed: Math.random() * 100
      },
      // PS1-like limitations
      snapVertices: options.snapVertices !== undefined ? options.snapVertices : true,
      snapPrecision: options.snapPrecision || 0.25, // PS1-like vertex snapping
    };

    // Create the noise function with the provided seed
    this.noise2D = createNoise2D();
    this.terrainTypes = [
      { name: 'water', height: -0.8, color: 0x4466aa },
      { name: 'sand', height: -0.3, color: 0xddcc88 },
      { name: 'rough', height: 0.2, color: 0x669944 },
      { name: 'fairway', height: 0.4, color: 0x99cc66 },
      { name: 'green', height: 0.6, color: 0x88dd66 },
    ];

    // Special areas like tee and hole
    this.teePosition = null;
    this.holePosition = null;
  }

  /**
   * Generate Perlin noise height at given coordinates
   */
  getNoiseHeight(x, y) {
    const { octaves, persistence, lacunarity, scale } = this.options.noise;
    let amplitude = 1;
    let frequency = 1;
    let noiseHeight = 0;

    for (let i = 0; i < octaves; i++) {
      const sampleX = x / scale * frequency;
      const sampleY = y / scale * frequency;
      
      const noise = this.noise2D(sampleX, sampleY);
      noiseHeight += noise * amplitude;
      
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    // Add a slight slope from tee to hole
    if (this.teePosition && this.holePosition) {
      const totalDistance = this.teePosition.distanceTo(this.holePosition);
      const distanceFromTee = Math.sqrt((x - this.teePosition.x) ** 2 + (y - this.teePosition.z) ** 2);
      const slopeFactor = (distanceFromTee / totalDistance) * 0.3; // Subtle slope
      noiseHeight -= slopeFactor;
    }

    // Normalize and scale to min/max height
    const { minHeight, maxHeight } = this.options;
    return THREE.MathUtils.mapLinear(noiseHeight, -1, 1, minHeight, maxHeight);
  }

  /**
   * PS1-style vertex snapping for authentic low-precision look
   */
  snapToGrid(value) {
    if (!this.options.snapVertices) return value;
    return Math.round(value / this.options.snapPrecision) * this.options.snapPrecision;
  }

  /**
   * Generate a flat area for a specified location
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
    
    // Define hole area as a flat zone
    const holeArea = this.createFlatArea(
      this.holePosition.x, 
      this.holePosition.z, 
      5, // radius of green
      this.holePosition.y
    );
    
    // Modify each vertex height based on noise
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      
      // World coordinates
      const worldX = x;
      const worldZ = z;
      
      // Check for special areas first
      let y = teeArea(worldX, worldZ);
      if (y === null) y = holeArea(worldX, worldZ);
      if (y === null) {
        y = this.getNoiseHeight(worldX, worldZ);
        
        // Ensure fairway is playable
        if (this.isOnFairway(worldX, worldZ)) {
          // Ensure fairway is above water level and not too steep
          y = Math.max(y, 0.1);
          
          // Smooth fairway by averaging with neighbors
          const samples = 5;
          let sum = y;
          for (let s = 0; s < samples; s++) {
            const offsetX = (Math.random() - 0.5) * 2;
            const offsetZ = (Math.random() - 0.5) * 2;
            sum += this.getNoiseHeight(worldX + offsetX, worldZ + offsetZ);
          }
          y = sum / (samples + 1);
        }
      }
      
      // Apply PS1-style vertex snapping
      positions.setY(i, this.snapToGrid(y));
      
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
    
    // Recalculate normals for lighting
    geometry.computeVertexNormals();
    
    // Create material
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true, // PS1-style flat shading
      roughness: 0.8,
      metalness: 0.1
    });
    
    // Create and return the mesh
    this.terrainMesh = new THREE.Mesh(geometry, material);
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
    
    // Simple placement for now - can be made more sophisticated
    const teeX = -width * 0.3;
    const teeZ = 0;
    const teeY = 0.8;
    
    const holeX = width * 0.3;
    const holeZ = 0;
    const holeY = 0.5;
    
    this.teePosition = new THREE.Vector3(teeX, teeY, teeZ);
    this.holePosition = new THREE.Vector3(holeX, holeY, holeZ);

    // Create a fairway between tee and hole
    this.createFairway();
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
    // If terrain mesh hasn't been created yet, use the raw noise height
    if (!this.terrainMesh) {
      return this.getNoiseHeight(x, z);
    }
    
    // Use raycasting for more accurate height detection
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, 100, z), // Start from high above
      new THREE.Vector3(0, -1, 0),  // Cast downward
      0,                            // Near plane
      200                           // Far plane
    );
    
    // Intersect with terrain
    const intersects = raycaster.intersectObject(this.terrainMesh);
    
    if (intersects.length > 0) {
      // Return the y-coordinate of the first intersection point
      return intersects[0].point.y;
    }
    
    // Fallback to the noise height if raycasting fails
    return this.getNoiseHeight(x, z);
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
    
    // Check if it's in special areas
    
    // Check if on green (near hole)
    const distanceFromHole = new THREE.Vector2(x - this.holePosition.x, z - this.holePosition.z).length();
    if (distanceFromHole < 6) {
      return "green";
    }
    
    // Check if on tee (near tee position)
    const distanceFromTee = new THREE.Vector2(x - this.teePosition.x, z - this.teePosition.z).length();
    if (distanceFromTee < 5) {
      return "green"; // Tee box has similar properties to green
    }
    
    // Check for water hazard
    if (y <= this.terrainTypes[0].height) {
      return "water";
    }
    
    // Check for sand bunker
    if (y <= this.terrainTypes[1].height) {
      return "bunker";
    }
    
    // Check if on fairway
    if (this.isOnFairway(x, z)) {
      return "fairway";
    }
    
    // Default to rough
    return "rough";
  }
}

export default TerrainGenerator; 
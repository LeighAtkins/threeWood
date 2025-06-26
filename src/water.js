/**
 * Basic Water Surface for ThreeWood Golf Game
 * A simplified water implementation that works with the existing codebase
 */

import * as THREE from 'three';

class WaterSurface {
  constructor(scene, options = {}) {
    this.scene = scene;
    
    // Default options
    this.options = {
      width: options.width || 400,
      length: options.length || 400,
      waterLevel: options.waterLevel || -0.8,
      waterColor: options.waterColor || 0x4466aa,
      waterOpacity: options.waterOpacity || 0.8,
      waveSpeed: options.waveSpeed || 0.5,
      waveHeight: options.waveHeight || 0.1,
      segments: options.segments || 50
    };
    
    this.time = 0;
    this.init();
  }
  
  init() {
    // Create geometry
    const geometry = new THREE.PlaneGeometry(
      this.options.width,
      this.options.length,
      this.options.segments,
      this.options.segments
    );
    
    // Rotate to be horizontal (XZ plane)
    geometry.rotateX(-Math.PI / 2);
    
    // Position at water level
    geometry.translate(0, this.options.waterLevel, 0);
    
    // Create material
    const material = new THREE.MeshStandardMaterial({
      color: this.options.waterColor,
      transparent: true,
      opacity: this.options.waterOpacity,
      roughness: 0.1,
      metalness: 0.8,
      side: THREE.DoubleSide
    });
    
    // Create mesh
    this.waterMesh = new THREE.Mesh(geometry, material);
    this.waterMesh.name = 'waterSurface';
    this.waterMesh.receiveShadow = true;
    
    // Add to scene
    this.scene.add(this.waterMesh);
    
    console.log('Basic water surface initialized');
  }
  
  /**
   * Update water animation
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    this.time += deltaTime;
    
    // Simple wave animation
    if (this.waterMesh && this.waterMesh.geometry) {
      const positions = this.waterMesh.geometry.attributes.position;
      const waveHeight = this.options.waveHeight;
      const waveSpeed = this.options.waveSpeed;
      
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        
        // Skip vertices at the edges to avoid visible seams
        if (Math.abs(x) < this.options.width / 2 - 5 && 
            Math.abs(z) < this.options.length / 2 - 5) {
          // Calculate wave height based on position and time
          const wave = Math.sin(x * 0.05 + this.time * waveSpeed) * 
                      Math.cos(z * 0.05 + this.time * waveSpeed) * 
                      waveHeight;
          
          // Update Y position with wave
          positions.setY(i, this.options.waterLevel + wave);
        }
      }
      
      // Mark attributes for update
      positions.needsUpdate = true;
      
      // Update normals
      this.waterMesh.geometry.computeVertexNormals();
    }
  }
  
  /**
   * Check if a position is below water level
   * @param {THREE.Vector3} position - Position to check
   * @returns {boolean} True if position is below water level
   */
  isUnderwater(position) {
    return position.y <= this.options.waterLevel;
  }
}

export default WaterSurface;

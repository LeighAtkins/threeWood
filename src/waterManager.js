/**
 * Water Manager for ThreeWood Golf Game
 * Handles water surface rendering and physics interactions
 */

import * as THREE from 'three';
import WaterSurface from './water.js';

class WaterManager {
  constructor(game, options = {}) {
    this.game = game;
    this.scene = game.scene;
    this.terrain = game.terrain;
    
    // Default options
    this.options = {
      waterLevel: -0.8,
      waterColor: 0x4466aa,
      waterDeepColor: 0x223366,
      waveHeight: 0.2,
      waveFrequency: 0.05,
      waveSpeed: 0.5,
      ...options
    };
    
    this.init();
  }
  
  init() {
    // Create water surface with shader effects
    this.waterSurface = new WaterSurface(this.scene, {
      width: this.terrain ? this.terrain.options.width : 400,
      length: this.terrain ? this.terrain.options.length : 400,
      waterLevel: this.options.waterLevel,
      waterColor: new THREE.Color(this.options.waterColor),
      waterDeepColor: new THREE.Color(this.options.waterDeepColor),
      waveHeight: this.options.waveHeight,
      waveFrequency: this.options.waveFrequency,
      waveSpeed: this.options.waveSpeed
    });
    
    // Setup ball collision detection
    this.setupBallCollision();
    
    console.log('Water manager initialized');
  }
  
  /**
   * Setup ball collision detection with water
   */
  setupBallCollision() {
    if (!this.game.ball) {
      console.warn('Ball not found, water collision detection not set up');
      return;
    }
    
    // We'll check for collisions in the update method instead of using events
    console.log('Water collision detection ready');
  }
  
  /**
   * Check if ball has collided with water
   */
  checkBallWaterCollision() {
    if (!this.game.ball || !this.waterSurface) return;
    
    const ballPosition = this.game.ball.mesh.position;
    
    // Check if ball is below water level
    if (ballPosition.y <= this.options.waterLevel) {
      // If ball just entered water
      if (!this.game.ball.inWaterHazard) {
        this.handleBallWaterEntry(ballPosition, this.game.ball.body.velocity);
      }
    }
  }
  
  /**
   * Handle ball entering water
   * @param {THREE.Vector3} position - Ball position
   * @param {CANNON.Vec3} velocity - Ball velocity
   */
  handleBallWaterEntry(position, velocity) {
    // Calculate splash force based on velocity
    const impactSpeed = velocity.length();
    const splashForce = Math.min(impactSpeed / 30, 1); // Normalize to 0-1
    
    // Create visual splash effect
    this.waterSurface.createSplash(position, splashForce);
    
    // Notify game of water hazard
    if (this.game.ball) {
      this.game.ball.handleWaterHazard();
    }
    
    console.log(`Ball entered water at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) with impact speed ${impactSpeed.toFixed(2)}`);
  }
  
  /**
   * Update water simulation
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    // Update water surface animation
    if (this.waterSurface) {
      this.waterSurface.update(deltaTime);
    }
    
    // Check for ball-water collision
    if (this.game.ball) {
      this.checkBallWaterCollision();
    }
  }
  
  /**
   * Set water wave properties
   * @param {Object} waveProps - Wave properties to update
   */
  setWaveProperties(waveProps) {
    if (this.waterSurface) {
      this.waterSurface.setWaveProperties(waveProps);
    }
  }
}

export { WaterManager };

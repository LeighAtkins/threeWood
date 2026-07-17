/**
 * GolfBall class using cannon-es physics
 * This is a replacement for the custom physics in the original ball.js
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Create an inline audio system since audio.js doesn't exist
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};

// Simple sound player function
function playSound(type, volume = 0.5) {
  try {
    if (!audioContext) return;
    
    // Create oscillator and gain node
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Set volume
    gainNode.gain.value = Math.min(0.3, volume);
    
    // Configure based on sound type
    switch (type) {
      case 'swing':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(110, audioContext.currentTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
        break;
      case 'ballHardImpact':
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
        break;
      case 'ballMediumImpact':
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);
        break;
      case 'ballSoftImpact':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(180, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(40, audioContext.currentTime + 0.08);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
        break;
      case 'stop':
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(80, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(40, audioContext.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.08);
        break;
      default:
        oscillator.frequency.value = 220;
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    }
  } catch (e) {
    console.warn('Error playing sound:', e);
  }
}

class CannonGolfBall {
  constructor(physicsManager, terrain, options = {}) {
    this.physicsManager = physicsManager;
    this.terrain = terrain;
    
    // Default options
    this.options = {
      radius: 0.02135, // standard golf ball radius in meters
      mass: 0.0459,  // standard golf ball mass in kg
      color: 0xffffff,
      segments: 32,
      dimples: true,
      dimpleCount: 336,
      dimpleSize: 0.002,
      dimpleDepth: 0.0005,
      spinCoefficient: 0.5,
      positionPrecision: 0.01, // for PS1-style position snapping
      sideSpinFactor: 0.2,
      // Added physics-specific options
      linearDamping: 0.3,      // increased air resistance
      angularDamping: 0.4,     // increased spin resistance
      restitution: 0.5,        // reduced bounciness
      friction: 0.6,           // increased surface friction
      contactStiffness: 1e6,   // for softer collision response
      contactEquationRelaxation: 3, // for softer collision
      ...options
    };
    
    // Create the mesh
    this.mesh = this.createMesh();
    
    // Initialize position
    this.position = new THREE.Vector3(0, 0, 0);
    
    // Create a special material for the ball with better collision properties
    const ballMaterial = new CANNON.Material('ballMaterial');
    ballMaterial.friction = this.options.friction;
    ballMaterial.restitution = this.options.restitution;
    
    // Create the physics body
    this.body = this.physicsManager.createGolfBall(this.position, {
      mass: this.options.mass,
      radius: this.options.radius,
      linearDamping: this.options.linearDamping,
      angularDamping: this.options.angularDamping,
      material: ballMaterial
    });
    
    // Create contact materials for better collision response
    const contactMaterial = new CANNON.ContactMaterial(
      ballMaterial,
      this.physicsManager.defaultMaterial,
      {
        friction: this.options.friction,
        restitution: this.options.restitution,
        contactEquationStiffness: this.options.contactStiffness,
        contactEquationRelaxation: this.options.contactEquationRelaxation
      }
    );
    
    // Add contact material to world
    this.physicsManager.world.addContactMaterial(contactMaterial);
    
    // Set up collision detection to prevent tunneling
    this.body.shapes.forEach(shape => {
      shape.collisionResponse = true;
      shape.collisionFilterGroup = 1;  // Ball group
      shape.collisionFilterMask = 1;   // Collide with everything
    });
    
    // Enable continuous collision detection to prevent tunneling
    this.body.allowSleep = true; // Allow the ball to sleep for physics efficiency
    this.body.sleepTimeLimit = 0.5; // Allow sleep after 0.5 seconds of inactivity (reduced)
    this.body.sleepSpeedLimit = 0.05; // Speed under which the ball can sleep (reduced)
    this.body.ccdSpeedThreshold = 1.0; // Enable CCD when the ball moves this fast
    this.body.ccdIterations = 5; // More iterations for better precision
    
    // Register body with physics manager
    this.physicsManager.registerBody(this.body, this.mesh);
    
    // Track spin and previous positions
    this.spin = 0;
    this.previousPosition = this.position.clone();
    this.isResting = false;
    this.wasResting = false;
    this.restingTime = 0;
    this.lastPlayedSound = 0;
    
    // For tracking time between physics steps
    this.lastUpdateTime = performance.now();
    
    // For collision detection
    this.previousTerrainHeight = 0;
    this.isBouncing = false;
    
    // Sound effects (use the same from original ball)
    this.hitSound = null;
    this.bounceSound = null;
    this.rollSound = null;
    
    // Add collision event listener
    this.body.addEventListener('collide', this.handleCollision.bind(this));
    
    // Movement trail
    this.trail = [];
    this.maxTrailLength = 50;
    
    // Add additional debug visualization (helper sphere to show physics body)
    this.debugHelper = null;
    if (options.debug) {
      this.createDebugHelper();
    }
    
    // Force initial resting state immediately, not with timeout
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.sleep();
    this.isResting = true;
    this.wasResting = true;
    this.restingTime = 1.0;
    console.log("Ball set to initial resting state");
    
    console.log(`Created ball with radius ${this.options.radius}, mass ${this.options.mass}`);
  }
  
  /**
   * Create the golf ball mesh
   */
  createMesh() {
    const geometry = new THREE.SphereGeometry(
      this.options.radius, 
      this.options.segments, 
      this.options.segments
    );
    
    // Add dimples if enabled
    if (this.options.dimples) {
      this.addDimples(geometry);
    }
    
    const material = new THREE.MeshPhongMaterial({ 
      color: this.options.color,
      specular: 0x444444,
      shininess: 40
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    
    return mesh;
  }
  
  /**
   * Add dimples to the golf ball
   */
  addDimples(geometry) {
    // Create a basic pattern of dimples
    // This is a simplified version - a real golf ball would have a more complex pattern
    const vertices = geometry.attributes.position;
    const dimpleCount = this.options.dimpleCount;
    const dimpleSize = this.options.dimpleSize;
    const dimpleDepth = this.options.dimpleDepth;
    
    // Fibonacci sphere pattern for even distribution
    const phi = Math.PI * (3 - Math.sqrt(5)); // Golden angle
    
    for (let i = 0; i < dimpleCount; i++) {
      const y = 1 - (i / (dimpleCount - 1)) * 2; // Range from 1 to -1
      const radius = Math.sqrt(1 - y * y);
      
      const theta = phi * i; // Golden angle increment
      
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      
      // Create a dimple by pushing vertices inward
      // For each vertex, check if it's within the dimple area
      for (let j = 0; j < vertices.count; j++) {
        const vx = vertices.getX(j);
        const vy = vertices.getY(j);
        const vz = vertices.getZ(j);
        
        const dx = vx - x * this.options.radius;
        const dy = vy - y * this.options.radius;
        const dz = vz - z * this.options.radius;
        
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (distance < dimpleSize) {
          // Calculate how much to push in (more at center, less at edges)
          const factor = 1 - (distance / dimpleSize);
          const pushAmount = dimpleDepth * factor;
          
          // Calculate direction from center of ball to vertex
          const dirX = vx;
          const dirY = vy;
          const dirZ = vz;
          
          const length = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
          
          // Normalize
          const normX = dirX / length;
          const normY = dirY / length;
          const normZ = dirZ / length;
          
          // Push inward
          vertices.setX(j, vx - normX * pushAmount);
          vertices.setY(j, vy - normY * pushAmount);
          vertices.setZ(j, vz - normZ * pushAmount);
        }
      }
    }
    
    // Update normals
    geometry.computeVertexNormals();
  }
  
  /**
   * Hit the ball with the given power and direction
   */
  hit(power, direction, loft = 10, sidespin = 0) {
    // Check if ball can be hit - either properly resting or force hit if ball appears stopped
    const velocity = this.body.velocity;
    const speed = Math.sqrt(
      velocity.x * velocity.x + 
      velocity.y * velocity.y + 
      velocity.z * velocity.z
    );
    
    // Allow hit if the ball is officially resting OR if speed is practically zero
    if (!this.isResting && speed > 0.001) {
      console.log(`Ball is moving, cannot hit. Speed: ${speed.toFixed(4)}, Resting time: ${this.restingTime.toFixed(2)}`);
      return false;
    }
    
    // Wake up the body before hitting
    this.body.wakeUp();
    
    // Get current terrain height using physics manager for accuracy
    const terrainY = this.physicsManager.getTerrainHeightAtPosition(
      this.position.x, 
      this.position.z
    );
    
    const heightAboveTerrain = this.position.y - terrainY;
    
    // Ensure ball is at a good position before hitting
    if (heightAboveTerrain < this.options.radius || heightAboveTerrain > this.options.radius * 3) {
      // Reposition ball to proper height
      this.body.position.y = terrainY + this.options.radius * 1.2;
      // Force position update
      this.position.y = this.body.position.y;
    }
    
    // Convert THREE direction to CANNON direction
    const cannonDirection = {
      x: direction.x,
      y: direction.y,
      z: direction.z
    };
    
    // Set initial spin based on loft and sidespin
    // Generally, higher loft = more backspin
    let spinAmount = -loft * 0.2; // Negative for backspin
    
    // Adjust spin based on sidespin parameter
    this.spin = spinAmount;
    
    // Play hit sound
    this.playHitSound(power);
    
    // Reset resting state
    this.isResting = false;
    this.wasResting = false;
    this.restingTime = 0;
    
    // SAFETY: Limit maximum power to prevent the ball from going into space
    const maxPower = 50;
    const appliedPower = Math.min(power, maxPower);
    
    if (power > maxPower) {
      console.log(`Power capped from ${power.toFixed(2)} to ${maxPower.toFixed(2)} to prevent out-of-bounds`);
    }
    
    // SAFETY: Limit maximum loft angle to prevent extreme vertical shots
    const maxLoft = 30;
    const appliedLoft = Math.min(loft, maxLoft);
    
    if (loft > maxLoft) {
      console.log(`Loft capped from ${loft.toFixed(2)} to ${maxLoft.toFixed(2)} to prevent extreme trajectories`);
    }
    
    // Invoke physics manager to apply the hit with safe values
    this.physicsManager.hitBall(this.body, appliedPower, cannonDirection, appliedLoft, spinAmount);
    
    // Apply sidespin if needed
    if (sidespin !== 0) {
      // Add a sideways component to angular velocity for hooks/slices
      const sideSpinImpulse = new CANNON.Vec3(
        0,
        sidespin * this.options.sideSpinFactor,
        0
      );
      this.body.angularVelocity.vadd(sideSpinImpulse, this.body.angularVelocity);
    }
    
    // Reset trail
    this.trail = [];
    
    console.log(`Ball hit with power ${appliedPower.toFixed(2)}, loft ${appliedLoft}°`);
    return true;
  }
  
  /**
   * Handle collision event
   */
  handleCollision(event) {
    const impactVelocity = event.contact.getImpactVelocityAlongNormal();
    
    // Only process significant impacts
    if (Math.abs(impactVelocity) > 1.0) {
      // Play bounce sound based on impact velocity
      this.playBounceSound(Math.abs(impactVelocity));
      
      // Get the collision normal
      const normal = event.contact.ni;
      
      // Convert to THREE Vector3 for effects
      const threeNormal = new THREE.Vector3(normal.x, normal.y, normal.z);
      
      // Emit particles or other effects
      this.emitBounceEffects(Math.abs(impactVelocity), threeNormal);
      
      // Update spin based on the impact
      this.updateSpinFromImpact(impactVelocity, normal);
      
      // Set bouncing flag
      this.isBouncing = true;
      
      // Clear bouncing flag after a short time
      setTimeout(() => {
        this.isBouncing = false;
      }, 200);
    }
  }
  
  /**
   * Update spin based on collision impact
   */
  updateSpinFromImpact(impactVelocity, normal) {
    // Reduce spin on bounce, more reduction on harder impacts
    const spinReductionFactor = Math.min(0.8, 0.5 + (Math.abs(impactVelocity) / 20));
    this.spin *= 1 - spinReductionFactor;
    
    // If hitting a relatively flat surface, convert some forward momentum to topspin
    if (normal.y > 0.8) { // Near vertical normal (flat ground)
      const velocity = this.body.velocity;
      const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      
      // Add topspin proportional to horizontal speed
      this.spin += horizontalSpeed * 0.1;
    }
  }
  
  /**
   * Update function called every frame
   */
  update(deltaTime) {
    // Calculate actual delta if not provided
    if (!deltaTime) {
      const now = performance.now();
      deltaTime = (now - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = now;
    }
    
    // Store previous position for rotation calculation
    this.previousPosition.copy(this.position);
    
    // Update position from physics body
    const bodyPosition = this.body.position;
    this.position.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
    
    // Check for out of bounds condition
    const terrainSize = 200; // Match the terrain bounds
    const outOfBounds = 
      Math.abs(this.position.x) > terrainSize || 
      Math.abs(this.position.z) > terrainSize ||
      this.position.y > 100 || // Prevent flying into space
      this.position.y < -10;   // Prevent falling through the world
    
    // Auto-reset if out of bounds
    if (outOfBounds && !this.recentlyReset) {
      console.warn(`Ball out of bounds at (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) - resetting`);
      
      // Determine reset position - use starting point or last in-bounds position
      const resetPosition = new THREE.Vector3(-120, 1, 0); // Default tee position
      
      this.reset(resetPosition);
      
      // Set a flag to prevent multiple resets in a row
      this.recentlyReset = true;
      
      // Clear the reset flag after a short delay
      setTimeout(() => {
        this.recentlyReset = false;
      }, 1000); // Wait 1 second before allowing another reset
      
      return;
    }
    
    // Apply PS1-style position snapping (visual only)
    const snappedPosition = new THREE.Vector3(
      Math.round(this.position.x / this.options.positionPrecision) * this.options.positionPrecision,
      Math.round(this.position.y / this.options.positionPrecision) * this.options.positionPrecision,
      Math.round(this.position.z / this.options.positionPrecision) * this.options.positionPrecision
    );
    
    // Update mesh position with snapped coordinates
    this.mesh.position.copy(snappedPosition);
    
    // Update mesh rotation from physics body
    this.mesh.quaternion.set(
      this.body.quaternion.x,
      this.body.quaternion.y,
      this.body.quaternion.z,
      this.body.quaternion.w
    );
    
    // Update debug helper if it exists
    if (this.debugHelper) {
      this.debugHelper.position.copy(this.position);
      this.debugHelper.quaternion.copy(this.mesh.quaternion);
    }
    
    // Force the ball to stay above the terrain - ONLY if in bounds
    if (!outOfBounds) {
      try {
        this.enforceTerrainCollision(deltaTime);
      } catch (e) {
        console.warn("Error in terrain collision:", e);
      }
    }
    
    // Always check if ball has come to rest
    try {
      this.checkBallStop(deltaTime);
    } catch (e) {
      console.warn("Error in ball stop check:", e);
    }
    
    // If the ball appears stopped but isn't officially resting, force resting state
    const velocity = this.body.velocity;
    const speed = Math.sqrt(
      velocity.x * velocity.x + 
      velocity.y * velocity.y + 
      velocity.z * velocity.z
    );
    
    if (speed < 0.001 && !this.isResting) {
      console.log(`Force resting state - ball appears stopped. Speed: ${speed.toFixed(6)}`);
      this.body.sleep();
      this.isResting = true;
      this.wasResting = true;
      this.restingTime = 1.0;
    }
    
    // Update trail
    this.updateTrail();
  }
  
  /**
   * Force the ball to stay above the terrain
   */
  enforceTerrainCollision(deltaTime) {
    // Safety check - only proceed if we're within terrain bounds
    const terrainSize = 200;
    if (
      Math.abs(this.position.x) > terrainSize || 
      Math.abs(this.position.z) > terrainSize
    ) {
      return; // Skip collision if out of bounds
    }
    
    // Get terrain height at current position using the physics manager for accuracy
    let terrainY;
    try {
      terrainY = this.physicsManager.getTerrainHeightAtPosition(
        this.position.x, 
        this.position.z
      );
    } catch (e) {
      console.warn("Error getting terrain height:", e);
      return; // Skip if error
    }
    
    // Store this for velocity calculations
    const prevTerrainHeight = this.previousTerrainHeight;
    this.previousTerrainHeight = terrainY;
    
    // Skip if terrain height is invalid
    if (isNaN(terrainY) || terrainY === undefined) {
      return;
    }
    
    // Calculate minimum allowed Y position (terrain height + ball radius)
    const minAllowedY = terrainY + this.options.radius;
    
    // If ball is below the terrain surface + radius
    if (this.position.y < minAllowedY) {
      // Calculate penetration depth
      const penetrationDepth = minAllowedY - this.position.y;
      
      // Only apply correction if penetration is significant
      if (penetrationDepth > 0.001) {
        // Move the ball up to be properly positioned above the terrain with a small buffer
        this.body.position.y = minAllowedY + 0.01; // Increased buffer to prevent clipping
        
        // Force position update to prevent getting stuck
        this.position.y = this.body.position.y;
        
        // Calculate terrain normal by sampling nearby points
        const stepSize = 0.1;
        const hL = this.physicsManager.getTerrainHeightAtPosition(this.position.x - stepSize, this.position.z);
        const hR = this.physicsManager.getTerrainHeightAtPosition(this.position.x + stepSize, this.position.z);
        const hT = this.physicsManager.getTerrainHeightAtPosition(this.position.x, this.position.z - stepSize);
        const hB = this.physicsManager.getTerrainHeightAtPosition(this.position.x, this.position.z + stepSize);
        
        // Make sure all heights are valid before calculating normal
        if (isNaN(hL) || isNaN(hR) || isNaN(hT) || isNaN(hB)) {
          // If invalid height is detected, use a default up normal
          this.handleDefaultBounce();
          return;
        }
        
        // Calculate normal vector from height differences
        const terrainNormal = new THREE.Vector3(
          (hL - hR) / (2 * stepSize),
          1.0,
          (hT - hB) / (2 * stepSize)
        ).normalize();
        
        // If moving downward, bounce with proper reflection based on terrain normal
        if (this.body.velocity.y < 0 && !this.isBouncing) {
          // Create CANNON vector for the normal
          const normal = new CANNON.Vec3(terrainNormal.x, terrainNormal.y, terrainNormal.z);
          
          // Get current velocity
          const velocity = this.body.velocity.clone();
          const speed = velocity.length();
          
          // Calculate reflection vector: v' = v - 2(v·n)n
          const dot = velocity.dot(normal);
          
          // Skip reflection if almost parallel to surface (rolling)
          if (dot < -0.1) {
            // Calculate reflected velocity with restitution
            const reflectionScale = -2 * dot;
            const reflection = new CANNON.Vec3(
              normal.x * reflectionScale,
              normal.y * reflectionScale,
              normal.z * reflectionScale
            );
            
            // Apply restitution (bounciness)
            reflection.scale(this.options.restitution, reflection);
            
            // Add the reflection to create the new velocity
            velocity.vadd(reflection, this.body.velocity);
            
            // Apply some damping to horizontal velocity based on surface type
            const surfaceType = this.getSurfaceType();
            let frictionFactor = 0.9; // Default friction
            
            // Adjust friction based on surface
            if (surfaceType === 'green') {
              frictionFactor = 0.92; // Less friction on green
            } else if (surfaceType === 'rough') {
              frictionFactor = 0.75; // More friction in rough
            } else if (surfaceType === 'sand') {
              frictionFactor = 0.6; // High friction in sand
            }
            
            this.body.velocity.x *= frictionFactor;
            this.body.velocity.z *= frictionFactor;
            
            // If speed is very low, help the ball come to rest
            if (speed < 1.0) {
              this.body.velocity.scale(0.7, this.body.velocity);
            }
            
            // Play bounce sound
            const impactSpeed = -dot; // Use dot product as impact speed
            this.playBounceSound(impactSpeed);
            
            // Make sure the ball is awake
            this.body.wakeUp();
            
            // Set bouncing flag to prevent multiple bounces in a single physics step
            this.isBouncing = true;
            setTimeout(() => { this.isBouncing = false; }, 100);
          } else {
            // Ball is rolling, apply more friction to horizontal movement
            this.body.velocity.x *= (1.0 - Math.min(0.5, penetrationDepth * 10) * deltaTime);
            this.body.velocity.z *= (1.0 - Math.min(0.5, penetrationDepth * 10) * deltaTime);
            
            // Apply slope force if on an incline
            if (terrainNormal.y < 0.99) {
              // Calculate horizontal component of normal
              const slopeDirection = new CANNON.Vec3(
                -terrainNormal.x,
                0,
                -terrainNormal.z
              );
              slopeDirection.normalize();
              
              // Calculate slope force based on steepness
              const slopeForce = (1.0 - terrainNormal.y) * 9.8 * this.options.mass;
              slopeDirection.scale(slopeForce, slopeDirection);
              
              // Apply slope force (stronger on steeper slopes)
              this.body.applyForce(slopeDirection, this.body.position);
            }
          }
        }
      }
    }
  }
  
  /**
   * Handle a default bounce when terrain normal can't be calculated
   */
  handleDefaultBounce() {
    // Use a default up normal
    const normal = new CANNON.Vec3(0, 1, 0);
    
    // Only bounce if moving downward
    if (this.body.velocity.y < 0 && !this.isBouncing) {
      // Get current velocity
      const velocity = this.body.velocity.clone();
      const speed = velocity.length();
      
      // Simple reflection based on vertical normal
      this.body.velocity.y = Math.abs(this.body.velocity.y) * this.options.restitution;
      
      // Apply damping to horizontal velocity
      this.body.velocity.x *= 0.9;
      this.body.velocity.z *= 0.9;
      
      // For very low speeds, help the ball stop
      if (speed < 1.0) {
        this.body.velocity.scale(0.7, this.body.velocity);
      }
      
      // Make sure the ball is awake
      this.body.wakeUp();
      
      // Set bouncing flag to prevent multiple bounces
      this.isBouncing = true;
      setTimeout(() => { this.isBouncing = false; }, 100);
    }
  }
  
  /**
   * Check if ball has come to rest
   */
  checkBallStop(deltaTime) {
    // Use velocity threshold to determine if the ball is at rest
    const velocity = this.body.velocity;
    const speed = Math.sqrt(
      velocity.x * velocity.x + 
      velocity.y * velocity.y + 
      velocity.z * velocity.z
    );
    
    // Ball is considered resting if speed is below threshold
    // Lower thresholds for more sensitive detection
    const speedThreshold = 0.02; // Reduced from 0.05
    const angularSpeedThreshold = 0.02; // Reduced from 0.05
    const angularSpeed = this.body.angularVelocity.length();
    
    // Check if ball is resting on the ground
    const terrainY = this.physicsManager.getTerrainHeightAtPosition(
      this.position.x, 
      this.position.z
    );
    
    const heightAboveTerrain = this.position.y - terrainY;
    // Use a more precise ground contact detection
    const ballRadius = this.options.radius;
    const isOnGround = heightAboveTerrain <= (ballRadius * 1.05);
    
    // Ball is resting if it's on the ground and moving slowly
    const isSlowEnough = speed < speedThreshold && angularSpeed < angularSpeedThreshold;
    
    // Debug logging for ball status
    if (!this.isResting && isSlowEnough && isOnGround) {
      console.log(`Ball slowing: speed=${speed.toFixed(4)}, angular=${angularSpeed.toFixed(4)}, height=${heightAboveTerrain.toFixed(4)}`);
    }
    
    // Track how long the ball has been resting
    if (isSlowEnough && isOnGround) {
      this.restingTime += deltaTime;
      
      // If we're very close to resting but not quite there, help it stop completely
      if (this.restingTime > 0.05 && !this.isResting) { // Reduced from 0.1
        this.body.velocity.setZero();
        this.body.angularVelocity.setZero();
        
        // Make sure the ball is properly positioned on the terrain
        const correctY = terrainY + ballRadius + 0.01;
        if (Math.abs(this.position.y - correctY) > 0.01) {
          this.body.position.y = correctY;
          this.position.y = correctY;
        }
        
        // Force the ball to sleep to ensure physics system knows it's at rest
        this.body.sleep();
        console.log("Ball forced to stop and sleep");
      }
    } else {
      this.restingTime = 0;
    }
    
    // Ball is officially resting if it's been slow for at least a short time
    // Reduced time for quicker detection
    this.isResting = this.restingTime > 0.1; // Reduced from 0.2
    
    // If newly coming to rest, play stop sound (with throttling to prevent sound spam)
    const now = Date.now();
    if (this.isResting && !this.wasResting && (now - this.lastPlayedSound > 1000)) {
      this.playStopSound();
      this.lastPlayedSound = now;
      
      // Put the body to sleep for physics efficiency
      this.body.sleep();
      console.log("Ball came to rest naturally");
    }
    
    this.wasResting = this.isResting;
    
    // If ball is almost stopped, help it come to rest completely
    if (isSlowEnough && isOnGround && !this.isResting) {
      // Apply additional damping to help it stop faster
      this.body.velocity.scale(0.5, this.body.velocity); // Increased damping from 0.7 to 0.5
      this.body.angularVelocity.scale(0.5, this.body.angularVelocity); // Increased damping
      
      // For very slow movement, just force it to stop
      if (speed < 0.05) {
        this.body.velocity.scale(0.2, this.body.velocity); // Even stronger damping for very slow speeds
      }
    }
  }
  
  /**
   * Update trail for visual effects
   */
  updateTrail() {
    // Add current position to trail
    if (!this.isResting && this.body.velocity.lengthSquared() > 0.5) {
      this.trail.push(this.position.clone());
      
      // Limit trail length
      if (this.trail.length > this.maxTrailLength) {
        this.trail.shift();
      }
    }
  }
  
  /**
   * Reset ball to a specific position
   */
  reset(position) {
    // Reset physics body
    this.body.position.set(position.x, position.y, position.z);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.force.setZero();
    this.body.torque.setZero();
    
    // Wake up the body
    this.body.wakeUp();
    
    // Reset ball state
    this.position.copy(position);
    this.previousPosition.copy(position);
    this.isResting = false;
    this.spin = 0;
    
    // Update mesh
    this.mesh.position.copy(position);
    this.mesh.quaternion.set(0, 0, 0, 1);
    
    // Clear trail
    this.trail = [];
  }
  
  /**
   * Get the mesh for rendering
   */
  getMesh() {
    return this.mesh;
  }
  
  /**
   * Play hit sound with volume based on power
   */
  playHitSound(power) {
    // Audio implementation would go here
    playSound('swing', Math.min(1.0, power / 50));
  }
  
  /**
   * Play bounce sound with volume based on impact speed
   */
  playBounceSound(impactSpeed) {
    // Only play sound if impact is significant and cooldown has passed
    if (impactSpeed > 0.5 && Date.now() - this.lastPlayedSound > 200) {
      // Scale volume based on impact velocity
      const volume = Math.min(1.0, impactSpeed / 10);
      
      // Play different sounds based on velocity
      if (impactSpeed > 5) {
        playSound('ballHardImpact', volume);
      } else if (impactSpeed > 2) {
        playSound('ballMediumImpact', volume);
      } else {
        playSound('ballSoftImpact', volume * 0.5);
      }
      
      // Record the time we played a sound
      this.lastPlayedSound = Date.now();
    }
  }
  
  /**
   * Play stop sound when ball comes to rest
   */
  playStopSound() {
    playSound('stop', 0.3);
  }
  
  /**
   * Emit visual effects when ball bounces
   */
  emitBounceEffects(speed, normal) {
    // Visual effects implementation would go here
    // Could be implemented later with particle systems
  }
  
  /**
   * Get the surface type at the ball's current position
   */
  getSurfaceType() {
    return this.physicsManager.getSurfaceTypeAtPosition(this.position, this.terrain);
  }
  
  /**
   * Create debug helper for physics visualization
   */
  createDebugHelper() {
    const geometry = new THREE.SphereGeometry(this.options.radius, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    });
    this.debugHelper = new THREE.Mesh(geometry, material);
    
    // Add to scene - needs to be done by the caller
    return this.debugHelper;
  }
}

export default CannonGolfBall; 
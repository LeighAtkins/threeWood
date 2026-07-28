import * as THREE from 'three';

/**
 * GolfBall class for ThreeWood
 * Handles ball physics, movement, and collision
 */
class GolfBall {
  constructor(terrain, audioManager = null, options = {}) {
    this.terrain = terrain;
    this.audioManager = audioManager;
    // Deterministic physics randomness — game wires in the seeded stream.
    this.rng = Math.random;
    this.options = {
      radius: options.radius || 0.05,
      mass: options.mass || 0.045, // kg (golf ball mass)
      restitution: options.restitution || 0.5, // Reduced from 0.6 for less bounce
      friction: options.friction || 0.18, // Increased from 0.12 for faster stopping
      gravity: options.gravity || -9.81, // m/s²
      rollResistance: options.rollResistance || 0.05, // Drastically reduced from 0.4 to allow rolling
      spinDecay: options.spinDecay || 0.97, // How quickly spin decays
      maxVelocity: options.maxVelocity || 80, // Maximum velocity cap (driver launches ~66)
      stopThreshold: options.stopThreshold || 0.1, // Reduced from 0.25 to allow slower rolling before stop
      // PS1-style limitations
      positionPrecision: options.positionPrecision || 0.01,
      // Collision detection options
      useSubstepping: true, // Enable physics sub-stepping for high velocities
      maxSubsteps: 4, // Enough steps that driver-speed shots never tunnel
      tunnelThreshold: 5, // Increased threshold to use substepping less often
      safeOffset: 0.005, // Safe offset from terrain - reduced for better ground contact
      // Phase 2: Enhanced bounce physics
      minBounceVelocity: options.minBounceVelocity || 0.3, // Minimum velocity to bounce
      spinTransfer: options.spinTransfer || 0.7, // How much impact transfers to spin
      randomBounceVariation: options.randomBounceVariation || 0.05, // Small random variation (5%)
      maxSpinRate: options.maxSpinRate || 5, // Maximum spin rate
      // Phase 3: Natural rolling and stopping
      slopeGravityFactor: options.slopeGravityFactor || 0.8, // How much slopes affect ball rolling (0.8 = 80%)
      minimumStopFrames: options.minimumStopFrames || 5, // Minimum frames below threshold before stopping
    };
    
    // Physics state
    this.position = new THREE.Vector3(0, 0, 0);
    this.previousPosition = new THREE.Vector3(0, 0, 0); // For continuous collision detection
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.acceleration = new THREE.Vector3(0, 0, 0);
    this.angularVelocity = new THREE.Vector3(0, 0, 0); // For rolling
    this.spin = 0; // Backspin/topspin factor
    this.sidespin = 0; // Sidespin factor
    this.forces = new THREE.Vector3(0, 0, 0);
    this.isResting = true;
    this.inAir = false;

    // Game state
    this.inWaterHazard = false;
    this.lastSafePosition = new THREE.Vector3();
    this.stationaryFrames = 0; // Count frames where ball is nearly stationary
    this.landingTimer = null; // Timer for forced stop after landing
    
    // Create the ball mesh
    this.createMesh();
    
    // Initialize audio context for sound effects
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.bounceTime = 0; // To prevent too many bounce sounds at once
    } catch (e) {
      console.error("Web Audio API not supported:", e);
      this.audioContext = null;
    }
    
    // For debug visualization
    this.debugRays = [];
  }

  /**
   * Wire a seeded RNG stream (from game) so physics is reproducible per seed.
   */
  setRng(rngFn) {
    this.rng = rngFn || Math.random;
  }

  /**
   * Whether the ball is currently in motion.
   * Convenience accessor mirroring isResting; game.js reads isMoving.
   */
  get isMoving() {
    return !this.isResting;
  }

  /**
   * Create the golf ball mesh
   */
  createMesh() {
    // Low-poly sphere for PS1 look
    const geometry = new THREE.IcosahedronGeometry(this.options.radius, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, // Reverted from bright red
      metalness: 0.3,
      roughness: 0.2,
      flatShading: true // PS1-style rendering
    });
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    
    // Add a simple dimple texture by adding small indentations
    this.addDimples();
  }
  
  /**
   * Add dimples to the golf ball (simplified for PS1 style)
   */
  addDimples() {
    // For a PS1-style game, we'll just use a simple texture or normal map
    // In a more detailed version, you could create actual geometry for dimples
  }
  
  /**
   * Apply a hit to the ball with specified power and direction
   * @param {number} power - Power of the hit (0-100)
   * @param {THREE.Vector3} direction - Direction vector
   * @param {number} loft - Loft angle in degrees
   * @param {number} sidespin - Side spin value (-1 to 1, negative = hook/left, positive = slice/right)
   * @param {Object} [strike] - Mishit outcome from core/swing.js (yaw/thin/fat).
   *                            Omit for a perfectly clean strike (legacy callers).
   * @param {Object} [shot] - Club launch profile from core/clubs.js:
   *                          { maxSpeed, spinFactor, lie? }. Defaults to the legacy
   *                          30 m/s flat profile. `lie` (core/lies.js) bleeds
   *                          speed/spin and adds yaw noise from bad lies.
   */
  hit(power, direction, loft, sidespin, strike = null, shot = null) {
    if (!this.isResting) return false;

    // Debug - log if the ball is potentially embedded in terrain
    const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
    if (this.position.y - this.options.radius < terrainHeight) {
      console.warn("Ball may be embedded in terrain before hit. Fixing position...");
      this.position.y = terrainHeight + this.options.radius + 0.002;
    }

    // Save current position as last safe position
    this.updateLastSafePosition();
    this.previousPosition.copy(this.position);

    // Convert power (0-100) to actual velocity (m/s); the club sets the max,
    // mishits bleed ball speed, and a bad lie bleeds more
    const lie = shot && shot.lie ? shot.lie : null;
    this.lastLie = lie;
    const maxSpeed = shot && shot.maxSpeed ? shot.maxSpeed : 30;
    const speedFactor = power / 100;
    const speed = maxSpeed * speedFactor
      * (strike ? strike.speedFactor : 1)
      * (lie ? lie.speedFactor : 1);

    // Mishit yaw rotates the aim at address (+ = pull left, - = push right);
    // rough/sand twists the clubhead too (seeded noise from the ball stream)
    const shotDirection = direction.clone();
    const lieYawDeg = lie && lie.dirNoiseDeg
      ? (this.rng() * 2 - 1) * lie.dirNoiseDeg
      : 0;
    const totalYawDeg = (strike ? strike.yawDeg : 0) + lieYawDeg;
    if (totalYawDeg) {
      shotDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), totalYawDeg * Math.PI / 180);
    }

    // Normalize direction vector
    const normalizedDir = shotDirection.normalize();

    // Apply loft (vertical angle) - Convert degrees to radians.
    // Thin strikes de-loft, fat strikes add loft (balloon ball); sand pops
    // the ball up (launchBonus).
    const effectiveLoft = Math.max(1, Math.min(64, (loft || 10)
      + (strike ? strike.loftDelta : 0)
      + (lie ? lie.launchBonus : 0)));
    const loftRadians = effectiveLoft * Math.PI / 180;
    normalizedDir.y = Math.sin(loftRadians);
    // Adjust horizontal components based on loft
    const horizontalFactor = Math.cos(loftRadians);
    normalizedDir.x *= horizontalFactor;
    normalizedDir.z *= horizontalFactor;
    
    // Set initial velocity
    this.velocity.copy(normalizedDir).multiplyScalar(speed);
    
    // Add backspin based on loft angle and power
    // Higher loft = more backspin, high power = more spin
    const spinIntensity = Math.min(1.0, power / 70); // Power factor (max at 70% power)
    
    // Store backspin/topspin in this.spin (vertical spin)
    this.spin = -loftRadians * 6 * spinIntensity; // Increased backspin factor
    
    // Add slight seeded variation to spin (±10%)
    this.spin *= 0.9 + this.rng() * 0.2;
    
    // Ensure vertical spin stays within reasonable limits
    this.spin = Math.max(-this.options.maxSpinRate, Math.min(0, this.spin));

    // Mishit contact changes the spin: thin = dead (little backspin), fat = balloon
    if (strike) this.spin *= strike.spinFactor;

    // Shot variant shapes the spin: punch knocks it down, flop jacks it up
    if (shot && shot.spinFactor) this.spin *= shot.spinFactor;

    // Bad lies strangle spin: grass/sand between face and ball = no grip
    if (lie) this.spin *= lie.spinFactor;

    // Store sidespin in a new property
    this.sidespin = (sidespin || 0) * spinIntensity * this.options.maxSpinRate;

    // Mishits add free curve on top of the player's spin selection
    if (strike && strike.sidespinAdd) {
      this.sidespin += strike.sidespinAdd * this.options.maxSpinRate * 0.35;
    }

    // Apply slight seeded variation to sidespin (±5%)
    this.sidespin *= 0.95 + this.rng() * 0.1;

    // Clamp total sidespin
    this.sidespin = Math.max(-this.options.maxSpinRate, Math.min(this.options.maxSpinRate, this.sidespin));
    
    // Log the spin values
    if (window.DEBUG) console.log(`Applied spin - Vertical: ${this.spin.toFixed(2)}, Side: ${this.sidespin.toFixed(2)}`);
    
    // Ball is now in motion
    this.isResting = false;
    this.inAir = true;
    this.inWaterHazard = false;
    this.stationaryFrames = 0;
    
    // Ball is already positioned properly at terrain + radius, no additional lift needed
    
    // Play hit sound
    this.playHitSound(power);
    
    // Log the hit for debugging
    if (window.DEBUG) console.log(`Ball hit with power: ${power.toFixed(1)}, speed: ${speed.toFixed(2)} m/s, loft: ${effectiveLoft.toFixed(1)}°, spin: ${this.spin.toFixed(2)}, sidespin: ${this.sidespin.toFixed(2)}, lie: ${lie ? lie.id : 'clean'}`);
    
    return true;
  }
  
  /**
   * Update the ball physics
   */
  update(deltaTime) {
    if (this.isResting) return;
    
    // Store the current position for collision detection
    this.previousPosition.copy(this.position);
    
    // Cap delta time to avoid instability
    const dt = Math.min(deltaTime, 0.033);
    
    // Determine if we need substepping based on velocity
    const useSubstepping = this.options.useSubstepping && 
                          this.velocity.length() > this.options.tunnelThreshold;
    
    if (useSubstepping) {
      // Subdivide the time step for more accurate collision detection
      const numSubsteps = Math.min(
        Math.ceil(this.velocity.length() / 5), // More steps for faster movement
        this.options.maxSubsteps
      );
      const subDt = dt / numSubsteps;

      for (let i = 0; i < numSubsteps; i++) {
        this.performPhysicsStep(subDt);
        this.checkTreeCollisions();
        // Exit early if ball has come to rest
        if (this.isResting) break;
      }
    } else {
      // Standard single step
      this.performPhysicsStep(dt);
      this.checkTreeCollisions();
    }
    
    // Update mesh position
    this.mesh.position.copy(this.position);
    
    // Rotate the ball based on movement
    if (!this.inAir && this.velocity.length() > 0.1) {
      // Calculate rotation axis (perpendicular to movement direction)
      const rotationAxis = new THREE.Vector3(this.velocity.z, 0, -this.velocity.x).normalize();
      
      // Calculate rotation amount based on distance traveled
      const displacement = this.position.clone().sub(this.previousPosition);
      const rotationAmount = displacement.length() / (2 * Math.PI * this.options.radius);
      
      // Apply rotation
      this.mesh.rotateOnAxis(rotationAxis, rotationAmount * Math.PI * 2);
    }
  }

  /**
   * Drive the ball into the cup during the SINKING state.
   * This bypasses the normal physics loop (which early-returns when isResting)
   * by writing position + mesh transform directly. Used by the Game's sink
   * tween so the ball visibly drops into the hole.
   * @param {THREE.Vector3} position - exact target position (mesh + physics)
   */
  sinkTo(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.isResting = true;
    this.inAir = false;
    if (this.mesh) this.mesh.position.copy(position);
  }

  /**
   * Update lastSafePosition — but never while in water, or a water-hazard
   * reset would drop the ball back into the pond (penalty loop).
   */
  updateLastSafePosition() {
    if (this.terrain) {
      if (this.position.y < this.terrain.options.waterLevel) return;
      const surface = this.terrain.getSurfaceTypeAtPosition?.(this.position.x, this.position.z);
      if (surface === 'water') return;
    }
    this.lastSafePosition.copy(this.position);
  }

  /**
   * Collide with tree trunks (course trees register cylinder colliders on the
   * terrain). Canopy pass-through: only the trunk cylinder blocks the ball.
   */
  checkTreeCollisions() {
    const colliders = this.terrain?.treeColliders;
    if (!colliders || colliders.length === 0) return;

    const p = this.position;
    const r = this.options.radius;
    for (const c of colliders) {
      if (p.y > c.top) continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-8) continue;

      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;

      // Push out of the trunk
      p.x = c.x + nx * rr;
      p.z = c.z + nz * rr;

      // Reflect horizontal velocity with heavy energy loss (wood thud)
      const vn = this.velocity.x * nx + this.velocity.z * nz;
      if (vn < 0) {
        this.velocity.x -= 2 * vn * nx;
        this.velocity.z -= 2 * vn * nz;
        this.velocity.x *= 0.35;
        this.velocity.z *= 0.35;
        this.velocity.y *= 0.5;
        this.spin *= 0.5;
        this.sidespin *= 0.5;
      }
    }
  }

  /**
   * Perform a single physics step
   */
  performPhysicsStep(dt) {
    // Start with gravity
    this.forces.set(0, this.options.gravity * this.options.mass, 0);
    
    // Calculate acceleration (F = ma, so a = F/m)
    this.acceleration.copy(this.forces).divideScalar(this.options.mass);
    
    // Update velocity (v = v0 + at)
    this.velocity.add(this.acceleration.clone().multiplyScalar(dt));
    
    // Get terrain height at current position for proximity checks
    const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
    
    // Determine how close the ball is to the ground
    const groundDistance = this.position.y - this.options.radius - terrainHeight;
    const nearGround = groundDistance < 0.1;
    
    // Apply spin effects when ball is close to the ground and moving
    if (this.inAir || (!this.inAir && Math.abs(this.spin) > 0.1)) {
      this.applySpinEffects(dt, nearGround);
    }
    
    // Speed limiter to avoid physics glitches
    const currentSpeed = this.velocity.length();
    if (currentSpeed > this.options.maxVelocity) {
      this.velocity.normalize().multiplyScalar(this.options.maxVelocity);
    }
    
    // Predict new position (p = p0 + vt)
    const newPosition = this.position.clone().add(this.velocity.clone().multiplyScalar(dt));
    
    // Check for continuous collision with terrain
    if (this.checkContinuousCollision(this.position, newPosition, dt)) {
      // Collision was handled within the method
    } else {
      // No collision, update position
      this.position.copy(newPosition);

      // Check ground collision using traditional method as backup
      this.checkGroundCollision(dt);
    }
    
    // Apply friction if on ground
    if (!this.inAir) {
      this.applyFriction(dt);
    }
    
    // If ball is moving extremely slowly and airborne but very close to ground, force it to ground
    if (this.inAir && nearGround && this.velocity.lengthSq() < 1.0) {
      this.position.y = terrainHeight + this.options.radius;
      this.velocity.y = 0;
      this.inAir = false;
    }
    
    // Check for out of bounds (far from the golf course)
    this.checkOutOfBounds();
    
    // Decay spin over time - faster decay when on ground
    if (this.inAir) {
    this.spin *= this.options.spinDecay;
    } else {
      this.spin *= (this.options.spinDecay * 0.9);
    }
    
    // Check if ball should come to rest
    this.checkBallStop();
  }

  /**
   * Apply spin effects (backspin, topspin, sidespin) to the ball
   * @param {number} dt - Time step in seconds
   * @param {boolean} nearGround - Whether the ball is near the ground
   */
  applySpinEffects(dt, nearGround) {
    // Skip if no significant spin (either vertical or side)
    if (Math.abs(this.spin) < 0.1 && Math.abs(this.sidespin || 0) < 0.1) return;
    
    // Get horizontal velocity components
    const horizontalVelocity = new THREE.Vector3(
      this.velocity.x, 
      0, 
      this.velocity.z
    );
    const horizontalSpeed = horizontalVelocity.length();
    
    // Normalize horizontal velocity if it exists
    if (horizontalSpeed > 0.1) {
      horizontalVelocity.normalize();
      
      // Airborne and near ground, or grounded with spin
      if ((this.inAir && nearGround) || !this.inAir) {
        // Calculate spin effects based on spin magnitude and direction
        
        // 1. Vertical lift/drop effect from backspin/topspin
        // Positive spin (topspin) pushes ball down, negative (backspin) creates lift
        const liftForce = -this.spin * dt * 3.0;
        this.velocity.y += liftForce;
        
        // 2. Forward/backward effect on horizontal movement from backspin/topspin
        // Topspin accelerates forward, backspin slows
        const horizontalForce = -this.spin * dt * 1.8;
        
        // Apply horizontal force in direction of movement
        this.velocity.x += horizontalVelocity.x * horizontalForce;
        this.velocity.z += horizontalVelocity.z * horizontalForce;
      }
      
      // 3. Apply sidespin effect (hook/slice)
      if (this.inAir && Math.abs(this.sidespin || 0) > 0.1) {
        // Create a perpendicular vector for the side force (right hand rule)
        // For golf:
        // - Negative sidespin (hook) curves left (for right-handed golfer)
        // - Positive sidespin (slice) curves right (for right-handed golfer)
        const sideDirection = new THREE.Vector3(
          -horizontalVelocity.z,  // Perpendicular to velocity
          0,
          horizontalVelocity.x
        );
        
        // Calculate side force magnitude based on sidespin value
        const sideForce = -(this.sidespin || 0) * dt * 0.8;
        
        // Apply side force - negative sidespin (hook) creates right-to-left curve
        this.velocity.x += sideDirection.x * sideForce;
        this.velocity.z += sideDirection.z * sideForce;
        
        // Add slight downward force for slice, slight upward for hook
        // (Slices tend to lose distance, hooks tend to roll more)
        if (this.sidespin > 0) {
          // Slice - add downward component
          this.velocity.y -= Math.abs(this.sidespin) * dt * 0.3;
        } else if (this.sidespin < 0) {
          // Hook - add very slight upward component initially, then more roll
          if (this.inAir && this.velocity.y > 0) {
            this.velocity.y += Math.abs(this.sidespin) * dt * 0.15;
          }
        }
      }
    }
    
    // Decay sidespin over time (slightly faster than backspin)
    if (this.sidespin) {
      if (this.inAir) {
        this.sidespin *= this.options.spinDecay;
      } else {
        this.sidespin *= (this.options.spinDecay * 0.8);
      }
    }
  }
  
  /**
   * Check for collision using continuous collision detection
   * @param {THREE.Vector3} startPos - Starting position
   * @param {THREE.Vector3} endPos - Ending position
   * @param {number} dt - Time step
   * @returns {boolean} - Whether a collision was detected and handled
   */
  checkContinuousCollision(startPos, endPos, dt) {
    if (!this.terrain || !this.terrain.terrainMesh) return false;
    
    // First check if start position is already embedded in terrain
    // This can happen due to numerical issues or previous physics steps
    const startTerrainHeight = this.terrain.getHeightAtPosition(startPos.x, startPos.z);
    const embeddingDepth = startTerrainHeight - (startPos.y - this.options.radius);
    
    // Only consider it embedded if significantly below terrain (avoid numerical noise)
    if (embeddingDepth > 0.01) {
      // Ball is significantly embedded - fix position without bouncing
      this.position.y = startTerrainHeight + this.options.radius;

      // Stop vertical velocity to prevent oscillation
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }

      // Only an AIRBORNE ball can bounce. A grounded ball that gravity just
      // re-embedded this frame must not re-run bounce handling — the old code
      // paid the bounce/roll-conversion penalty every frame, so a rolling
      // ball lost ~15% speed per frame and putts died within a yard.
      if (this.inAir && this.velocity.length() > 2.0) {
        const normal = this.terrain.getNormalAtPosition(startPos.x, startPos.z) || new THREE.Vector3(0, 1, 0);
        this.handleBounce(normal, dt);
      } else {
        // Just settle the ball on the ground
        this.inAir = false;
      }
      return true;
    }
    
    // Create ray from start position to end position
    const direction = endPos.clone().sub(startPos).normalize();
    const distance = endPos.distanceTo(startPos) + this.options.radius;
    
    // Create raycaster
    const raycaster = new THREE.Raycaster(startPos, direction, 0, distance);
    
    // Cast ray against the terrain mesh
    const intersects = raycaster.intersectObject(this.terrain.terrainMesh);
    
    if (intersects.length > 0) {
      // We hit something! Get the closest intersection
      const intersection = intersects[0];
      const intersectionPoint = intersection.point;
      const normal = intersection.face.normal.clone();
      
      // Transform local normal to world space
      normal.transformDirection(this.terrain.terrainMesh.matrixWorld);
      
      // Position the ball at the intersection point plus radius offset in normal direction
      const positionOffset = normal.clone().multiplyScalar(this.options.radius + this.options.safeOffset);
      this.position.copy(intersectionPoint).add(positionOffset);

      if (this.inAir) {
        // Genuine impact — handle bounce off the surface
        this.handleBounce(normal, dt);
      } else if (this.velocity.dot(normal) < 0) {
        // Rolling ball following terrain (e.g. rolling onto an upslope):
        // settle onto the surface, don't bounce
        const intoSurface = normal.clone().multiplyScalar(this.velocity.dot(normal));
        this.velocity.sub(intoSurface);
      }
      return true;
    }
    
    return false;
  }
  
  /**
   * Handle bounce physics when ball collides with an object
   * 
   * @param {Object|THREE.Vector3} intersectionOrNormal - Intersection object from raycaster or Vector3 normal
   * @param {number} [dt] - Delta time for physics calculations
   */
  handleBounce(intersectionOrNormal, dt) {
    if (!intersectionOrNormal) return;
    
    let normal;
    
    // Extract normal vector based on parameter type
    if (intersectionOrNormal instanceof THREE.Vector3) {
      // Direct normal vector provided
      normal = intersectionOrNormal.clone();
    } else if (intersectionOrNormal.face && intersectionOrNormal.face.normal) {
      // Regular intersection object with face normal
      normal = intersectionOrNormal.face.normal.clone();
      
      // Transform normal to world space if possible
      if (intersectionOrNormal.object && intersectionOrNormal.object.matrixWorld) {
        normal.transformDirection(intersectionOrNormal.object.matrixWorld);
      } else if (this.terrain && this.terrain.terrainMesh && this.terrain.terrainMesh.matrixWorld) {
        normal.transformDirection(this.terrain.terrainMesh.matrixWorld);
      }
    } else {
      // Invalid parameter, use default up vector
      console.warn('Invalid intersection or normal provided to handleBounce');
      normal = new THREE.Vector3(0, 1, 0);
    }
    
    // Skip rest of physics if ball isn't moving
    if (this.velocity.lengthSq() < 0.001) {
      this.inAir = false;
      this.velocity.set(0, 0, 0);
      return;
    }

    // Store pre-bounce velocity for calculations
    const preBounceVelocity = this.velocity.clone();
    const speed = preBounceVelocity.length();
    
    // Calculate impact angle between velocity and surface normal
    const velocityUnit = preBounceVelocity.normalize();
    const impactDot = Math.abs(velocityUnit.dot(normal));
    const impactAngle = Math.acos(impactDot);
    
    // Bounce logging disabled for performance

    const isDownwardShot = this.velocity.y < -0.1;

    // Check if this is a surface that we can skim along (mostly flat)
    const surfaceFlatness = normal.y; // How upward-facing is the normal (0-1)

    // For shots almost directly into the terrain, convert more energy to spin
    if (isDownwardShot && surfaceFlatness > 0.7 && impactAngle > Math.PI / 4) {
      // Increase bounce effect for descending shots hitting flatter terrain
      const verticalSpeed = Math.abs(this.velocity.y);
      
      if (verticalSpeed > 1.0) {
        // Generate significant spin when hitting down into the terrain
        this.spin = Math.max(-this.options.maxSpinRate, -verticalSpeed * 0.4);
      }
    }
    
    // Check if this is a very shallow bounce that should be converted to rolling
    const upVector = new THREE.Vector3(0, 1, 0);
    const normalVerticalness = normal.dot(upVector);
    
    // If bouncing on a nearly level surface with low vertical velocity, convert to rolling
    if (normalVerticalness > 0.9 && Math.abs(this.velocity.y) < 1.0 && speed < 5.0) {
      this.handleConversionToRolling(normal);
      return;
    }
    
    // If we get here, proceed with the bounce: split velocity into
    // surface-normal and tangential parts and scale each down. Energy only
    // ever decreases — the old reflect()-based math had restitution climb
    // toward 1.0 as impact speed rose (an inverted velocity factor), and a
    // reflection across a tilted normal converted horizontal speed into
    // 50+ m/s vertical launches (the "driver balloons to 130y" bug).
    const surfaceType = this.getSurfaceType();
    const absorption = this.getBounceAbsorption(surfaceType);

    const normalSpeed = this.velocity.dot(normal); // negative = into surface
    const normalComponent = normal.clone().multiplyScalar(normalSpeed);
    const tangentialComponent = this.velocity.clone().sub(normalComponent);

    // Normal rebound is soft and dies as impacts get faster (ball digs in)
    const impactIntoSurface = Math.abs(normalSpeed);
    const normalRestitution =
      Math.max(0.05, 0.32 - impactIntoSurface * 0.012) * absorption;

    // Tangential retention: high-speed impacts skid and lose more
    const tangentialRetention = Math.max(0.5, 0.9 - speed * 0.006) * absorption;

    // Small seeded variation for a natural feel
    const randomFactor = 1 + (this.rng() * 2 - 1) * this.options.randomBounceVariation;

    normalComponent.multiplyScalar(-normalRestitution * randomFactor);
    tangentialComponent.multiplyScalar(Math.min(0.95, tangentialRetention * randomFactor));

    // Calculate spin based on impact
    this.updateSpinFromImpact(preBounceVelocity, normal, impactAngle, surfaceType);

    // Set new velocity
    this.velocity.copy(tangentialComponent).add(normalComponent);

    // Handle low bounces to prevent endless small bounces
    if (this.velocity.y > 0 && this.velocity.y < this.options.minBounceVelocity) {
      this.handleConversionToRolling(normal);
    } else if (this.velocity.y <= 0) {
      // Bounce fully absorbed — stay on the ground
      this.velocity.y = 0;
      this.inAir = false;
    }

    // Emit sound effects proportional to impact velocity
    this.emitBounceEffects(speed, normal);

    // Apply post-bounce stabilization
    this.applyPostBounceStabilization();
  }
  
  /**
   * Handle conversion from bounce to rolling motion
   * @param {THREE.Vector3} normal - Surface normal
   */
  handleConversionToRolling(normal) {
    // Convert to rolling motion by killing vertical velocity 
    this.velocity.y = 0;
    this.inAir = false;
      
    // Get the surface plane and project velocity onto it
    const horizontalVelocity = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    const horizontalSpeed = horizontalVelocity.length();
    
    if (horizontalSpeed > 0.1) {
      // Ensure velocity follows the terrain surface by removing normal component
      const normalComponent = normal.clone().multiplyScalar(this.velocity.dot(normal));
      this.velocity.sub(normalComponent);
    }
    
    // Position exactly on the ground (ball center at terrain height + radius)
    const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
    this.position.y = terrainHeight + this.options.radius;
    
    // Update the last safe position
    this.updateLastSafePosition();
  }
  
  /**
   * Update ball spin based on impact
   * @param {THREE.Vector3} velocity - Pre-bounce velocity
   * @param {THREE.Vector3} normal - Surface normal
   * @param {number} impactAngle - Angle of impact in radians
   * @param {string} surfaceType - Type of surface
   */
  updateSpinFromImpact(velocity, normal, impactAngle, surfaceType) {
    // Calculate horizontal component for determining spin direction
    const horizontalVelocity = new THREE.Vector3(velocity.x, 0, velocity.z);
    const horizontalSpeed = horizontalVelocity.length();
    
    // Surface spin factors - different surfaces affect spin differently
    const spinFactors = {
      green: 1.3,    // More spin on green
      fairway: 1.0,  // Normal spin on fairway
      rough: 0.6,    // Less spin in rough
      bunker: 0.3,   // Minimal spin in sand
      cart_path: 1.5, // More spin on cart path
      default: 1.0
    };
    
    const surfaceSpinFactor = spinFactors[surfaceType] || spinFactors.default;
    
    // Existing spin affects the new spin (preserves some spin)
    const existingSpinContribution = this.spin * 0.3;
    
    // Calculate new spin based on impact
    let newSpin = 0;
    
    // Frontal impacts (velocity opposing normal) generate backspin
    if (impactAngle > Math.PI * 0.5) { // Greater than 90 degrees
      // More direct impacts = more backspin
      const backspinFactor = Math.min(1.0, (impactAngle - Math.PI * 0.5) / (Math.PI * 0.5));
      newSpin = -horizontalSpeed * backspinFactor * this.options.spinTransfer;
    } 
    // Glancing impacts (velocity mostly parallel to normal) generate topspin
    else if (impactAngle < Math.PI * 0.3) { // Less than 54 degrees
      // More parallel = more topspin
      const topspinFactor = 1.0 - (impactAngle / (Math.PI * 0.3));
      newSpin = horizontalSpeed * topspinFactor * this.options.spinTransfer;
    }
    
    // Apply surface factor to new spin
    newSpin *= surfaceSpinFactor;
    
    // Combine with existing spin
    this.spin = Math.max(
      -this.options.maxSpinRate,
      Math.min(this.options.maxSpinRate, 
        newSpin + existingSpinContribution
      )
    );
  }
  
  /**
   * Check if the ball should come to a complete stop
   */
  checkBallStop() {
    if (this.inAir) {
      // For airborne balls, check if they're hovering just above ground
      // This helps prevent the "bobbing" effect where the ball never quite touches ground
      if (this.velocity.lengthSq() < 0.1 && this.position.y - this.options.radius < 
          this.terrain.getHeightAtPosition(this.position.x, this.position.z) + 0.02) {
        // Force grounding for very low energy balls near the ground
        const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
        this.position.y = terrainHeight + this.options.radius;
        this.velocity.y = 0;
        this.inAir = false;
      }
      return;
    }
    
    const speed = this.velocity.length();
    
    // Ball is moving very slowly
    if (speed < this.options.stopThreshold) {
      this.stationaryFrames++;
      
      // After several frames of being slow, fully stop the ball
      if (this.stationaryFrames > this.options.minimumStopFrames) { 
        // Ensure the ball is properly resting on the terrain
        const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
        this.position.y = terrainHeight + this.options.radius; // Ball center at terrain + radius
        
        // Zero out all movement
        this.velocity.set(0, 0, 0);
        this.spin = 0;
        
        // Mark as resting
        this.isResting = true;
        
        // Save current position as safe position when coming to rest
        this.updateLastSafePosition();
        if (window.DEBUG) console.log("Ball has come to rest");
        
        // Play stop sound
        this.playStopSound();
      }
    } else {
      this.stationaryFrames = 0;
    }
  }
  
  /**
   * Check if the ball is out of bounds
   */
  checkOutOfBounds() {
    if (!this.terrain) return;
    const maxX = this.terrain.options.width / 2;
    const maxZ = this.terrain.options.length / 2;
    const minY = -10; // Define a minimum y level as out of bounds

    if (
      Math.abs(this.position.x) > maxX || 
      Math.abs(this.position.z) > maxZ || 
      this.position.y < minY
    ) { 
      console.warn("Ball out of bounds! Resetting to last safe position.");
      this.reset(this.lastSafePosition);
    }
  }
  
  /**
   * Check for collisions with terrain
   * 
   * @param {number} dt - Time delta
   * @returns {boolean} - Whether a collision was detected
   */
  checkGroundCollision(dt) {
    // If ball is below terrain, handle collision
    const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
    const ballBottomHeight = this.position.y - this.options.radius;
    
    // Ball has penetrated terrain or is exactly at terrain height
    if (ballBottomHeight <= terrainHeight) {
      // Position ball precisely on terrain surface (center at terrain + radius)
      this.position.y = terrainHeight + this.options.radius;

      // A ball already rolling on the ground just re-settles — no bounce and
      // no per-frame friction penalty
      if (!this.inAir) {
        if (this.velocity.y < 0) this.velocity.y = 0;
        return true;
      }

      // Check if this is a high-speed impact or a gentle landing
      const impactSpeed = Math.abs(this.velocity.y);
      
      if (impactSpeed < 0.5 && this.velocity.lengthSq() < 4.0) {
        // For gentle landings, just kill vertical velocity to start rolling
        this.velocity.y = 0;
        this.inAir = false;
        
        // Apply a small friction penalty for touchdown
        const horizontalSpeed = new THREE.Vector2(this.velocity.x, this.velocity.z).length();
        if (horizontalSpeed > 0) {
          const horizontalDir = new THREE.Vector2(this.velocity.x, this.velocity.z).normalize();
          this.velocity.x = horizontalDir.x * horizontalSpeed * 0.9;
          this.velocity.z = horizontalDir.y * horizontalSpeed * 0.9;
        }
        
        // We're officially on the ground now
        this.updateLastSafePosition();
      return true;
      }
      
      // For more significant impacts, calculate bounce
      // Create a terrain normal for the bounce calculation
      const normal = this.terrain.getNormalAtPosition(this.position.x, this.position.z);
      if (!normal) {
        // Fallback to pure up vector if we couldn't get terrain normal
        const mockNormal = new THREE.Vector3(0, 1, 0);
        this.handleBounce(mockNormal, dt);
      } else {
        // Use actual terrain normal
        this.handleBounce(normal, dt);
      }
      
      return true;
    }
    
    // Special case for near-ground low energy situations
    if (!this.inAir) {
      // Ball was on ground but might be slightly above it now (e.g., after moving on a slope)
      if (ballBottomHeight > terrainHeight && 
          ballBottomHeight < terrainHeight + 0.1) {
        // Gently reset to exactly on ground (center at terrain + radius)
        this.position.y = terrainHeight + this.options.radius;
        this.velocity.y = 0;
      }
    }
    
    return false;
  }
  
  /**
   * Calculate slope at a point for more realistic physics
   */
  calculateSlope(x, z, direction) {
    if (!this.terrain) return 0;
    
    const delta = 0.1; // Small distance for slope calculation
    let h1, h2;
    
    if (direction === 'x') {
      h1 = this.terrain.getHeightAtPosition(x - delta, z);
      h2 = this.terrain.getHeightAtPosition(x + delta, z);
    } else { // 'z'
      h1 = this.terrain.getHeightAtPosition(x, z - delta);
      h2 = this.terrain.getHeightAtPosition(x, z + delta);
    }
    
    // Calculate slope (rise/run)
    return (h2 - h1) / (2 * delta);
  }
  
  /**
   * Align velocity with ground slope for realistic hill rolling
   */
  alignVelocityWithSlope(slopeX, slopeZ) {
    // Calculate slope-induced acceleration (gravity component along slope)
    const slopeMagnitude = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
    
    // Only apply if on a meaningful slope
    if (slopeMagnitude > 0.01) {
      // Add a downhill component to velocity
      const gravityForce = 9.81 * this.options.mass * slopeMagnitude * 0.8; // Increased from 0.5 for better downhill movement
      
      // Create a normalized vector in the downhill direction
      const downhillDirection = new THREE.Vector3(slopeX, 0, slopeZ).normalize();
      
      // Apply force in downhill direction
      this.velocity.add(
        downhillDirection.multiplyScalar(gravityForce * 0.016) // Approximate for a 60fps frame
      );
    }
  }
  
  /**
   * Handle water hazard collision
   */
  handleWaterHazard() {
    if (this.inWaterHazard) return; // Already handled
    
    if (window.DEBUG) console.log("Ball in water hazard!");
    this.inWaterHazard = true;
    
    // Reset to last safe position
    this.reset(this.lastSafePosition);
  }
  
  /**
   * Apply friction when the ball is on the ground
   */
  applyFriction(dt) {
    // Ensure we're not below the terrain (fix for potential embedding)
    const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
    if (this.position.y - this.options.radius < terrainHeight) {
      this.position.y = terrainHeight + this.options.radius;
    }
    
    if (this.velocity.lengthSq() < 0.0001) {
      this.velocity.set(0, 0, 0);
      return;
    }
    
    // Get current speed
    const speed = this.velocity.length();
    
    // Get slope information at current position
    const slopeData = this.calculateSlopeAtPosition();
    
    // Apply slope effects (ball rolls downhill)
    this.applySlopeForces(slopeData, dt);
    
    // Different friction for different surfaces
    const surfaceType = this.getSurfaceType();
    const frictionFactors = this.getSurfaceFrictionFactors(surfaceType);
    
    // Apply friction based on surface and speed
    this.applyGroundFriction(dt, speed, frictionFactors);
    
    // Check if ball is very slow and count frames to fully stop
    if (speed < this.options.stopThreshold) {
      this.stationaryFrames++;
    } else {
      this.stationaryFrames = 0;
    }
  }
  
  /**
   * Calculate the slope at the current ball position
   * @returns {Object} Slope data including normal, angle, and gradient
   */
  calculateSlopeAtPosition() {
    if (!this.terrain || !this.terrain.terrainMesh) {
      return { 
        normal: new THREE.Vector3(0, 1, 0),
        gradient: new THREE.Vector2(0, 0),
        angle: 0
      };
    }
    
    // Get terrain normal at current position
    const normal = this.terrain.getNormalAtPosition(this.position.x, this.position.z) || 
                  new THREE.Vector3(0, 1, 0);
    
    // Calculate slope angle from normal (angle from vertical)
    const upVector = new THREE.Vector3(0, 1, 0);
    const angle = Math.acos(Math.max(-1, Math.min(1, normal.dot(upVector))));
    
    // Calculate XZ gradient (how steep in which direction)
    const gradient = new THREE.Vector2(
      -normal.x / Math.max(0.1, normal.y), // X gradient (east-west slope)
      -normal.z / Math.max(0.1, normal.y)  // Z gradient (north-south slope)
    );
    
    return { normal, gradient, angle };
  }
  
  /**
   * Apply forces that make the ball roll along slopes
   * @param {Object} slopeData - Slope data calculated earlier
   * @param {number} dt - Delta time
   */
  applySlopeForces(slopeData, dt) {
    const { gradient, angle } = slopeData;
    
    // Only apply slope forces if there is actually a slope
    if (angle < 0.01) return; // Skip if nearly flat
    
    // Calculate gravitational force affecting the ball along the slope
    // Force = mass * gravity * sin(angle) * slope direction
    const slopeForceMagnitude = this.options.mass * 
                            Math.abs(this.options.gravity) * 
                            Math.sin(angle) * 
                            this.options.slopeGravityFactor;
    
    // Apply force in direction of the slope gradient
    this.velocity.x += gradient.x * slopeForceMagnitude * dt;
    this.velocity.z += gradient.y * slopeForceMagnitude * dt;
    
    // Reduce uphill velocity more than downhill
    const currentDirection = new THREE.Vector2(this.velocity.x, this.velocity.z).normalize();
    const dotProduct = currentDirection.dot(gradient.clone().normalize());
    
    // If moving uphill (opposing gradient), apply additional resistance
    if (dotProduct < -0.2) { // Moving significantly uphill
      const uphillResistance = Math.abs(dotProduct) * angle * 0.5 * dt;
      this.velocity.multiplyScalar(Math.max(0, 1 - uphillResistance));
    }
  }
  
  /**
   * Get friction factors for different surface types
   * @param {string} surfaceType - Type of surface 
   * @returns {Object} Friction factors for this surface
   */
  getSurfaceFrictionFactors(surfaceType) {
    // Roll-out model: exponential decay time constant tau (s) + a small
    // constant deceleration aMin (m/s²). Runout from speed v is ~tau*v at
    // high speed and ~v²/(2*aMin) at putt speeds — predictable per surface.
    const frictionMap = {
      green:     { tau: 5.0,  aMin: 0.5 }, // A 6 m/s putt rolls ~15y
      fairway:   { tau: 1.3,  aMin: 0.8 }, // Driver runs out ~18-20y after the skips
      rough:     { tau: 0.6,  aMin: 1.2 }, // Grass kills runout
      bunker:    { tau: 0.35, aMin: 2.0 }, // Sand stops the ball
      cart_path: { tau: 6.0,  aMin: 0.3 }, // Ball runs forever (fun)
      default:   { tau: 1.3,  aMin: 0.8 }
    };

    return frictionMap[surfaceType] || frictionMap.default;
  }
  
  /**
   * Apply ground friction based on surface type and ball state
   * @param {number} dt - Delta time
   * @param {number} speed - Current ball speed
   * @param {Object} frictionFactors - Friction factors for current surface
   */
  applyGroundFriction(dt, speed, frictionFactors) {
    // Roll-out = exponential decay (high-speed skid/runout) + a small constant
    // deceleration (dominates at putt speeds and terminates the tail cleanly).
    // Framerate-independent and direction-preserving.
    if (speed < 0.01) {
      this.velocity.set(0, 0, 0);
      return;
    }

    const decay = Math.exp(-dt / frictionFactors.tau);
    const newSpeed = speed * decay - frictionFactors.aMin * dt;

    if (newSpeed <= 0.01) {
      // Ball is stopping
      this.velocity.set(0, 0, 0);
      return;
    }

    const scale = newSpeed / speed;
    this.velocity.x *= scale;
    this.velocity.z *= scale;
    this.velocity.y = 0; // No vertical drift while grounded
  }
  
  /**
   * Reset the ball to the tee or specified position
   */
  reset(position) {
    if (position) {
      this.position.copy(position);
      
      // Ensure ball is not embedded in terrain
      if (this.terrain) {
        const terrainHeight = this.terrain.getHeightAtPosition(this.position.x, this.position.z);
        // Make sure ball is properly positioned above terrain
        if (this.position.y < terrainHeight + this.options.radius) {
          this.position.y = terrainHeight + this.options.radius;
        }
      }
    } else {
      // Reset to tee position
      this.position.copy(this.terrain.teePosition);
      // Position ball so it's exactly touching the ground (center at terrain height + radius)
      this.position.y += this.options.radius;
    }
      
      // This is now our safe position
      this.updateLastSafePosition();
    
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.forces.set(0, 0, 0);
    this.spin = 0;
    this.sidespin = 0;
    this.isResting = true;
    this.inAir = false;
    this.inWaterHazard = false;
    this.stationaryFrames = 0;
    
    // Update mesh position
    this.mesh.position.copy(this.position);
  }
  
  /**
   * Get the ball's mesh object for adding to the scene
   */
  getMesh() {
    return this.mesh;
  }
  
  /**
   * Play sound effect for hitting the ball
   */
  playHitSound(power) {
    if (!this.audioManager) return;
    
    // Get current hit parameters
    const speed = this.velocity.length();
    const surfaceType = this.terrain?.getSurfaceTypeAtPosition?.(this.position.x, this.position.z) || 'fairway';
    
    // Play appropriate hit sound based on power, loft, and speed
    this.audioManager.playHitSound(power, this.currentLoft || 10, speed, surfaceType);
  }
  
  /**
   * Play bounce sound effect
   */
  playBounceSound(impactSpeed) {
    if (!this.audioManager) return;
    
    // Prevent too many bounce sounds in quick succession
    const now = Date.now();
    if (now - this.bounceTime < 150) return;
    this.bounceTime = now;
    
    // Get surface type at current position
    const surfaceType = this.terrain?.getSurfaceTypeAtPosition?.(this.position.x, this.position.z) || 'fairway';
    
    // Play appropriate surface sound based on impact force
    this.audioManager.playSurfaceSound(surfaceType, impactSpeed);
  }
  
  /**
   * Play sound when ball stops
   */
  playStopSound() {
    if (!this.audioContext) return;
    
    try {
      // Create oscillator for stop sound (gentle thud)
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // Set properties
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(80, this.audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        40,
        this.audioContext.currentTime + 0.3
      );
      
      // Volume envelope - very quiet
      gainNode.gain.setValueAtTime(0.0001, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.05,
        this.audioContext.currentTime + 0.02
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        this.audioContext.currentTime + 0.3
      );
      
      // Start and stop
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.3);
    } catch (e) {
      console.error("Error playing stop sound:", e);
    }
  }
  
  /**
   * Get the surface type at current ball position
   * @returns {string} The surface type ("fairway", "green", "rough", "bunker", etc.)
   */
  getSurfaceType() {
    if (!this.terrain) {
      return "default";
    }
    
    // Check terrain type at current position
    return this.terrain.getSurfaceTypeAtPosition(this.position.x, this.position.z) || "default";
  }
  
  /**
   * Get bounce absorption based on surface type
   * @param {string} surfaceType - The type of surface
   * @returns {number} Absorption factor (lower = deader bounce)
   */
  getBounceAbsorption(surfaceType) {
    const absorption = {
      green: 0.85,     // Receptive — approaches sit
      fairway: 1.0,    // Firm — full skip and runout
      rough: 0.7,      // Grass kills the skip
      bunker: 0.45,    // Sand plugs
      cart_path: 1.05, // Hard — extra skip
      default: 1.0
    };

    return absorption[surfaceType] || absorption.default;
  }
  
  /**
   * Emit effects from bounce like sound and particles
   * @param {number} speed - Impact speed
   * @param {THREE.Vector3} normal - Surface normal
   */
  emitBounceEffects(speed, normal) {
    // Play bounce sound if speed is significant
    if (speed > 0.5) {
      // Scale volume based on impact speed
      const volume = Math.min(1.0, speed * 0.2);
      
      if (this.options.playSounds && window.game.soundEnabled) {
        // Simple bounce sound implementation
        if (this.bounceSound) {
          this.bounceSound.volume = volume;
          this.bounceSound.currentTime = 0;
          this.bounceSound.play().catch(e => console.error("Sound play error:", e));
        }
      }
      
      // Visual feedback for impact
      if (speed > 2.0 && this.options.showImpactEffects) {
        // Could add particle effects or other visual indicators here
        if (window.DEBUG) console.log(`Impact at speed: ${speed.toFixed(2)}`);
      }
    }
  }
  
  /**
   * Apply stabilization after bounce to prevent unrealistic behavior
   */
  applyPostBounceStabilization() {
    // Prevent extremely low but non-zero velocities
    if (this.velocity.lengthSq() < 0.01) {
      this.velocity.set(0, 0, 0);
      this.inAir = false;
    }
    
    // Update the last safe position whenever we have a successful collision
    this.updateLastSafePosition();
  }
}

export default GolfBall; 
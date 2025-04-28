import * as THREE from 'three';

/**
 * Camera controller for ThreeWood
 * Handles different camera modes and following the ball
 */
class CameraController {
  constructor(camera, target, options = {}) {
    this.camera = camera;
    this.target = target; // Usually the golf ball
    
    // Log initial positions before setup
    console.log('[CameraController.constructor] Initial Cam Pos:', camera.position.toArray(), 'Initial Target (Ball) Pos:', target.position.toArray());
    
    // Camera modes
    this.MODES = {
      FOLLOW: 'follow',     // Follow behind the ball
      OVERVIEW: 'overview', // Bird's eye view
      AIMING: 'aiming',     // Aiming mode
      WATCHING: 'watching'  // Watch the ball in flight
    };
    
    this.options = {
      followDistance: options.followDistance || 2, // Reduced from 3 for closer camera
      followHeight: options.followHeight || 1.8, // Increased for better visibility
      minFollowHeight: options.minFollowHeight || 1.2, // Minimum height to avoid terrain clipping
      overviewHeight: options.overviewHeight || 15,
      transitionSpeed: options.transitionSpeed || 3.5, // Increased from 2 for faster camera response
      fastTransitionSpeed: options.fastTransitionSpeed || 7, // Faster transition for when ball is moving quickly
      lookAheadFactor: options.lookAheadFactor || 1.2, // Increased from 0.5 to look further ahead
      // PS1-style camera limitations
      jitterAmount: options.jitterAmount || 0.015, // Reduced jitter for better visibility
      positionSnap: options.positionSnap || 0.1,
      positionSnapEnabled: options.positionSnapEnabled !== undefined ? options.positionSnapEnabled : true,
      // Safe box in normalized screen space (0-1)
      safeBox: options.safeBox || { minX: 0.35, maxX: 0.65, minY: 0.4, maxY: 0.6 },
    };
    
    // Current state
    this.currentMode = this.MODES.FOLLOW;
    this.currentPosition = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();
    this.targetLookAt = new THREE.Vector3();
    
    // Dynamic camera properties
    this.lastTargetPosition = new THREE.Vector3(); // Track target's last position
    this.targetVelocity = new THREE.Vector3(); // For predicting movement
    
    // Aiming and control
    this.aimingAngle = 0; // Horizontal angle in radians
    this.aimingDistance = this.options.followDistance;
    
    // Initialize camera position
    this.updateCameraTargets();
    // If starting in AIMING mode or at game start, use aiming centering logic
    const aimingTargets = this.getAimingCameraTargets();
    this.targetPosition.copy(aimingTargets.position);
    this.targetLookAt.copy(aimingTargets.lookAt);
    this.snapToTargets();
    // Loop to enforce safe box at initialization (max 10 iterations)
    for (let i = 0; i < 10; i++) {
      this.enforceBallInSafeBox();
      // Check if ball is in the box, break if so
      const ballScreenPos = this.target.position.clone().project(this.camera);
      const screenX = (ballScreenPos.x + 1) / 2;
      const screenY = (1 - ballScreenPos.y) / 2;
      const { minX, maxX, minY, maxY } = this.options.safeBox;
      if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) break;
    }
    
    // Log final initial snapped position
    console.log('[CameraController.constructor] Final Snapped Cam Pos:', this.camera.position.toArray());
    this._ballOffScreenWarned = false;
  }
  
  /**
   * Update the camera position and rotation based on current mode
   */
  update(deltaTime) {
    // Calculate target velocity for prediction
    if (this.target.position) {
      this.targetVelocity.subVectors(this.target.position, this.lastTargetPosition)
        .divideScalar(Math.max(deltaTime, 0.016)); // Prevent division by zero
      
      // Store current position for next frame
      this.lastTargetPosition.copy(this.target.position);
    }
    
    // Update target positions based on current mode
    this.updateCameraTargets();
    
    // Determine transition speed based on target velocity
    let transitionSpeed = this.options.transitionSpeed;
    if (this.targetVelocity.length() > 5) {
      // Use faster transitions when target is moving quickly
      transitionSpeed = this.options.fastTransitionSpeed;
    }
    
    // Interpolate toward target position and lookAt
    this.interpolateToTargets(deltaTime, transitionSpeed);
    
    // Adjust camera height to avoid clipping through terrain
    this.adjustCameraHeight();
    
    // Apply PS1-style jitter if enabled
    this.applyJitter();
    
    // Actually update the camera
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);

    // Enforce safe box constraint for the ball
    this.enforceBallInSafeBox();
  }
  
  /**
   * Adjust camera height to avoid clipping through terrain
   */
  adjustCameraHeight() {
    if (!this.target.terrain) return;
    
    // Only adjust in follow or aiming modes
    if (this.currentMode !== this.MODES.FOLLOW && this.currentMode !== this.MODES.AIMING) return;
    
    // Get terrain height at camera position
    const terrainHeight = this.target.terrain.getHeightAtPosition(
      this.currentPosition.x,
      this.currentPosition.z
    );
    
    // Add a safety margin
    const safetyMargin = 0.5;
    
    // If camera is below terrain + safety margin, elevate it
    if (this.currentPosition.y < terrainHeight + safetyMargin + this.options.minFollowHeight) {
      this.currentPosition.y = terrainHeight + safetyMargin + this.options.minFollowHeight;
    }
  }
  
  /**
   * Update the target positions based on current mode
   */
  updateCameraTargets() {
    switch (this.currentMode) {
      case this.MODES.FOLLOW:
        this.updateFollowMode();
        break;
      case this.MODES.OVERVIEW:
        this.updateOverviewMode();
        break;
      case this.MODES.AIMING:
        this.updateAimingMode();
        break;
      case this.MODES.WATCHING:
        this.updateWatchingMode();
        break;
    }
  }
  
  /**
   * Update camera targets for follow mode
   */
  updateFollowMode() {
    // Position behind the ball
    const ballPosition = this.target.position;
    
    // Direction ball is moving (or a default direction if stationary)
    let direction;
    if (this.targetVelocity.length() > 0.1) {
      // Use actual velocity direction when moving
      direction = this.targetVelocity.clone().normalize();
    } else if (this.target.velocity && this.target.velocity.length() > 0.1) {
      direction = this.target.velocity.clone().normalize();
    } else {
      direction = new THREE.Vector3(0, 0, -1); // Default direction
    }
    
    // Reverse and flatten the direction for camera position
    direction.y = 0;
    direction.normalize().multiplyScalar(-this.options.followDistance);
    
    // Set target position behind the ball, with prediction based on velocity
    const predictionFactor = 0.5; // Controls how much to lead the camera
    const prediction = this.targetVelocity.clone().multiplyScalar(predictionFactor);
    prediction.y = 0; // Don't predict vertical movement
    
    // Apply prediction only when ball is moving significantly
    const positionWithPrediction = ballPosition.clone();
    if (this.targetVelocity.length() > 1) {
      positionWithPrediction.add(prediction);
    }
    
    this.targetPosition.copy(positionWithPrediction).add(direction);
    
    // Check terrain height at target position if terrain available
    if (this.target.terrain) {
      const terrainHeight = this.target.terrain.getHeightAtPosition(
        this.targetPosition.x,
        this.targetPosition.z
      );
      
      // Ensure camera is above terrain with a minimum height
      const heightAboveTerrain = Math.max(
        this.options.followHeight,
        terrainHeight + this.options.minFollowHeight
      );
      
      this.targetPosition.y = ballPosition.y + heightAboveTerrain;
    } else {
      this.targetPosition.y = ballPosition.y + this.options.followHeight;
    }
    
    // Look at the ball, slightly ahead in its direction of travel
    let lookAheadDirection;
    if (this.targetVelocity.length() > 1) {
      // Use actual movement direction when moving significantly
      lookAheadDirection = this.targetVelocity.clone().normalize();
    } else if (this.target.velocity && this.target.velocity.length() > 0.1) { 
      lookAheadDirection = this.target.velocity.clone().normalize();
    } else {
      lookAheadDirection = new THREE.Vector3();
    }
    
    const lookAhead = lookAheadDirection.multiplyScalar(this.options.lookAheadFactor);
    this.targetLookAt.copy(ballPosition).add(lookAhead);
    
    // --- Debug logging ---
    if (window.DEBUG_CAMERA) {
      console.log('[CameraController][FOLLOW] Camera position:', this.targetPosition.toArray(), 'LookAt:', this.targetLookAt.toArray(), 'Ball:', ballPosition.toArray());
    }
  }
  
  /**
   * Update camera targets for overview mode
   */
  updateOverviewMode() {
    // Position high above the ball
    const ballPosition = this.target.position;
    
    this.targetPosition.set(
      ballPosition.x,
      ballPosition.y + this.options.overviewHeight,
      ballPosition.z
    );
    
    // Look at the ball
    this.targetLookAt.copy(ballPosition);
  }
  
  /**
   * Update camera targets for aiming mode
   */
  updateAimingMode() {
    // Use the same logic as getAimingCameraTargets
    const aimingTargets = this.getAimingCameraTargets();
    this.targetPosition.copy(aimingTargets.position);
    this.targetLookAt.copy(aimingTargets.lookAt);
    
    // After adjusting, check if the ball is off screen
    const ballScreenPos = this.target.position.clone().project(this.camera);
    if (
      (ballScreenPos.x < -1 || ballScreenPos.x > 1 || ballScreenPos.y < -1 || ballScreenPos.y > 1)
      && !this._ballOffScreenWarned
    ) {
      console.warn('[CameraController] WARNING: Ball is off screen in AIMING mode!', ballScreenPos);
      this._ballOffScreenWarned = true;
    } else if (
      ballScreenPos.x >= -1 && ballScreenPos.x <= 1 && ballScreenPos.y >= -1 && ballScreenPos.y <= 1
    ) {
      this._ballOffScreenWarned = false;
    }
    // --- Debug logging ---
    if (window.DEBUG_CAMERA) {
      console.log('[CameraController][AIMING] Mode: AIMING, Cam Target:', this.targetPosition.toArray(), 'LookAt Target:', this.targetLookAt.toArray(), 'Ball:', this.target.position.toArray());
    }
  }
  
  /**
   * Update camera targets for watching mode (ball in flight)
   */
  updateWatchingMode() {
    // In watching mode, we use a dynamic position based on the ball's movement
    const ballPosition = this.target.position;
    
    // --- Start: Modified velocity check ---
    // Prioritize current velocity if significant, otherwise use calculated frame-to-frame velocity
    let primaryVelocity = this.targetVelocity; // Default to frame-to-frame velocity change
    if (this.target.velocity && this.target.velocity.length() > 1.0) {
      primaryVelocity = this.target.velocity; // Use physics velocity if ball is moving
    }
    const isMovingFast = primaryVelocity.length() > 5;
    const isMovingMedium = primaryVelocity.length() > 2;
    // --- End: Modified velocity check ---
    
    if (isMovingFast) {
      // For fast motion, position camera behind and above the ball
      // --- Start: Use primaryVelocity ---
      const directionNormalized = primaryVelocity.clone().normalize();
      // --- End: Use primaryVelocity ---
      
      // Position camera behind the ball but not too far (reduced distance for closer camera)
      const cameraOffset = directionNormalized.clone().multiplyScalar(-3); // Reduced from -5
      cameraOffset.y = 2; // Reduced from 3 for closer camera height
      
      this.targetPosition.copy(ballPosition).add(cameraOffset);
    } else if (isMovingMedium) {
      // For medium speed, just adjust the current camera position smoothly
      // Don't reset position entirely, just update the look target
      // But keep camera closer than before
      // --- Start: Use primaryVelocity ---
      const directionNormalized = primaryVelocity.clone().normalize();
      // --- End: Use primaryVelocity ---
      const cameraOffset = directionNormalized.clone().multiplyScalar(-2); // Closer for medium speed
      cameraOffset.y = 1.5;
      this.targetPosition.lerp(ballPosition.clone().add(cameraOffset), 0.1); // Use lerp for smoother transition at medium speeds
    } else {
      // For slow movement or stopped ball, maintain a stable position
      // This avoids jerky camera when ball almost stops
    }
    
    // Always look at the ball
    this.targetLookAt.copy(ballPosition);
    
    // If ball is high in the air, adjust camera height
    if (ballPosition.y > 2) {
      // Add a slight upward adjustment to better track the ball
      this.targetPosition.y += (ballPosition.y - this.targetPosition.y) * 0.1;
    }
  }
  
  /**
   * Interpolate camera toward target position and lookAt
   */
  interpolateToTargets(deltaTime, transitionSpeed) {
    const t = Math.min(1, transitionSpeed * deltaTime);
    
    // Interpolate position
    this.currentPosition.lerp(this.targetPosition, t);
    
    // Interpolate lookAt
    this.currentLookAt.lerp(this.targetLookAt, t);
    
    // PS1-style position snapping
    if (this.options.positionSnapEnabled) {
      this.currentPosition.x = Math.round(this.currentPosition.x / this.options.positionSnap) * this.options.positionSnap;
      this.currentPosition.y = Math.round(this.currentPosition.y / this.options.positionSnap) * this.options.positionSnap;
      this.currentPosition.z = Math.round(this.currentPosition.z / this.options.positionSnap) * this.options.positionSnap;
    }
  }
  
  /**
   * Apply PS1-style random jitter to camera position
   */
  applyJitter() {
    // Only apply jitter when in motion to simulate PS1 camera instability
    // and reduce jitter amount at higher speeds for more stable viewing
    if (this.target.velocity && this.target.velocity.length() > 1.0) {
      const speedFactor = Math.min(1, 3 / this.target.velocity.length());
      const jitterAmount = this.options.jitterAmount * speedFactor;
      
      const jitterX = (Math.random() * 2 - 1) * jitterAmount;
      const jitterY = (Math.random() * 2 - 1) * jitterAmount;
      const jitterZ = (Math.random() * 2 - 1) * jitterAmount;
      
      this.currentPosition.x += jitterX;
      this.currentPosition.y += jitterY;
      this.currentPosition.z += jitterZ;
    }
  }
  
  /**
   * Immediately snap to target positions
   */
  snapToTargets() {
    this.currentPosition.copy(this.targetPosition);
    this.currentLookAt.copy(this.targetLookAt);
    
    // Initialize last position
    if (this.target.position) {
      this.lastTargetPosition.copy(this.target.position);
    }
    
    // Adjust to avoid terrain clipping
    this.adjustCameraHeight();
    
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
    
    // Log the position set by snapToTargets
    console.log('[CameraController.snapToTargets] Position Set:', this.camera.position.toArray(), 'LookAt Set:', this.currentLookAt.toArray());
  }
  
  /**
   * Change camera mode
   */
  setMode(mode) {
    if (Object.values(this.MODES).includes(mode)) {
      this.currentMode = mode;
      // Immediately update targets when mode changes
      this.updateCameraTargets();
      // If entering AIMING mode, snap camera to target immediately
      if (mode === this.MODES.AIMING) {
        this.snapToTargets();
      }
      return true;
    }
    return false;
  }
  
  /**
   * Rotate aiming angle (for aiming mode)
   */
  rotateAim(angleDelta) {
    this.aimingAngle += angleDelta;
    
    // Keep angle between 0 and 2π
    this.aimingAngle = this.aimingAngle % (Math.PI * 2);
    if (this.aimingAngle < 0) this.aimingAngle += Math.PI * 2;
    
    // Update targets if in aiming mode
    if (this.currentMode === this.MODES.AIMING) {
      this.updateCameraTargets();
    }
  }
  
  /**
   * Get current aiming direction (for hitting the ball)
   */
  getAimDirection() {
    // Ensure aimingAngle is normalized
    let normalizedAngle = this.aimingAngle % (Math.PI * 2);
    if (normalizedAngle < 0) normalizedAngle += Math.PI * 2;

    return new THREE.Vector3(
      -Math.sin(normalizedAngle),
      0,
      -Math.cos(normalizedAngle)
    ).normalize();
  }
  
  /**
   * Change to watching mode (call when ball is hit)
   */
  watchBallInFlight() {
    // --- Start: New code to immediately position camera ---
    const ballPosition = this.target.position;
    const aimDirection = this.getAimDirection(); // Get the direction we were aiming

    // Calculate initial camera position behind the ball based on aim direction
    const initialWatchDistance = 3; // Distance behind the ball
    const initialWatchHeight = 1.5; // Height above the ball
    const cameraOffset = aimDirection.clone().multiplyScalar(-initialWatchDistance); // Go backwards along aim direction

    this.targetPosition.copy(ballPosition).add(cameraOffset);
    this.targetPosition.y = ballPosition.y + initialWatchHeight; // Set initial height

    // Look directly at the ball initially
    this.targetLookAt.copy(ballPosition);

    // Snap camera immediately to these targets
    this.snapToTargets();
    // --- End: New code ---

    // Now set the mode (after snapping)
    this.setMode(this.MODES.WATCHING);
    console.log('[CameraController.watchBallInFlight] Snapped camera for WATCHING mode.');
  }
  
  /**
   * Change to follow mode (call when ball comes to rest)
   */
  followBall() {
    this.setMode(this.MODES.FOLLOW);
  }
  
  /**
   * Ensure the ball stays within a safe box in screen space
   */
  enforceBallInSafeBox() {
    // Project ball position to NDC
    const ballScreenPos = this.target.position.clone().project(this.camera);
    const screenX = (ballScreenPos.x + 1) / 2;
    const screenY = (1 - ballScreenPos.y) / 2;
    const { minX, maxX, minY, maxY } = this.options.safeBox;
    let needsAdjustment = false;
    let offsetX = 0, offsetY = 0;
    if (screenX < minX) { offsetX = minX - screenX; needsAdjustment = true; }
    if (screenX > maxX) { offsetX = maxX - screenX; needsAdjustment = true; }
    if (screenY < minY) { offsetY = minY - screenY; needsAdjustment = true; }
    if (screenY > maxY) { offsetY = maxY - screenY; needsAdjustment = true; }
    if (needsAdjustment) {
      // Move lookAt in camera's local axes
      const cameraDir = new THREE.Vector3();
      this.camera.getWorldDirection(cameraDir);
      const up = this.camera.up.clone().normalize();
      const right = new THREE.Vector3().crossVectors(cameraDir, up).normalize();
      // Nudge lookAt
      const nudgeAmount = 2; // Tune for sensitivity
      this.targetLookAt.add(
        right.clone().multiplyScalar(offsetX * nudgeAmount)
      );
      this.targetLookAt.add(
        up.clone().multiplyScalar(-offsetY * nudgeAmount)
      );
    }
  }
  
  /**
   * Helper to compute camera position/lookAt for aiming mode centering
   */
  getAimingCameraTargets() {
    const ballPosition = this.target.position;
    const safeBox = this.options.safeBox;
    const targetScreenY = (safeBox.minY + safeBox.maxY) / 2;
    const behindDistance = 3.0;
    const lookAheadDistance = 15;
    const fov = this.camera.fov * Math.PI / 180;
    const ndcY = 1 - 2 * targetScreenY;
    const dx = Math.sin(this.aimingAngle);
    const dz = Math.cos(this.aimingAngle);
    const forward = new THREE.Vector3(dx, 0, dz).normalize();
    const camOffset = forward.clone().multiplyScalar(-behindDistance);
    const z = behindDistance;
    const verticalOffset = ndcY * z * Math.tan(fov / 2);
    const cameraPos = ballPosition.clone().add(camOffset);
    cameraPos.y = ballPosition.y + verticalOffset;
    const lookAtTarget = ballPosition.clone().add(forward.clone().multiplyScalar(lookAheadDistance));
    lookAtTarget.y = ballPosition.y;
    return { position: cameraPos, lookAt: lookAtTarget };
  }
}

export default CameraController; 
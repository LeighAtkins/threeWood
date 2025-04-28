import * as THREE from 'three';
import TerrainGenerator from './terrain.js';
import GolfBall from './ball.js';
import CameraController from './camera.js';
import UI from './ui.js';

/**
 * Main game controller for ThreeWood
 * Integrates all components and handles game loop
 */
class Game {
  constructor() {
    // Scene and renderer
    this.scene = new THREE.Scene();
    this.renderer = null;
    
    // Camera
    this.camera = null;
    this.cameraController = null;
    
    // Game objects
    this.terrain = null;
    this.terrainMesh = null;
    this.ball = null;
    this.shotArrow = null;
    
    // UI
    this.ui = null;
    
    // Loft constants and state
    this.MIN_LOFT = 5;  // Minimum loft angle in degrees
    this.MAX_LOFT = 45; // Maximum loft angle in degrees
    this.LOFT_INCREMENT = 1; // Degrees to change loft per input
    this.currentLoft = 10; // Initial loft angle in degrees
    
    // Game state
    this.score = 0;
    this.strokes = 0;
    this.par = 3; // Default par for the hole
    this.gameState = 'TITLE'; // TITLE, AIMING, HITTING, WATCHING, CAMERA_TRANSITION, READY_TO_HIT
    
    // Camera transition timing
    this.cameraTransitionTime = 0;
    this.CAMERA_TRANSITION_DURATION = 1.5; // Time in seconds for camera transition
    
    // Time tracking
    this.clock = new THREE.Clock();
    this.deltaTime = 0;
    
    // Input state
    this.keys = {};
    this.mousePosition = new THREE.Vector2();
    this.isMouseDown = false;
    this.powerMeter = {
      active: false,
      power: 0,
      direction: 1, // 1 for increasing, -1 for decreasing
      speed: 50 // Power change per second
    };
    
    // Pause state
    this.isPaused = false;
    
    // First hit flag
    this.firstHit = true;
    
    // Initialize the game
    this.init();
  }
  
  /**
   * Initialize the game
   */
  init() {
    try {
      console.log("Game initialization started");
      
      // Initialize renderer
      this.initRenderer();
      
      // Initialize camera
      this.initCamera();
      
      // Initialize lighting
      this.initLighting();
      
      // Initialize game objects
      this.initGameObjects();
      
      // Initialize UI
      this.ui = new UI(this);
      
      // Initialize input handlers
      this.initInputHandlers();
      
      // Set starting game state - we'll be ready to aim after instructions are dismissed
      this.setGameState('READY_TO_HIT');
      
      // Start the game loop
      this.animate();
      
      // Show instructions after a brief delay
      setTimeout(() => {
        console.log("Showing initial game instructions");
        this.ui.showInstructions();
        
        // Pause ability to hit ball until instructions are dismissed
        this.isPaused = true;
        console.log("Game interaction paused until instructions dismissed");
        
        // Add listener for the instructions dismissal
        document.addEventListener('instructionsDismissed', () => {
          console.log("Instructions dismissed event received");
          this.isPaused = false;
          console.log("Game interaction resumed");
        }, { once: true });
      }, 800);
      
      // Force initial render to ensure the scene is visible
      this.renderer.render(this.scene, this.camera);
      console.log("Initial render forced");
      
      console.log("Game initialized successfully");
    } catch (error) {
      console.error("Error initializing game:", error);
    }
  }
  
  /**
   * Initialize the WebGL renderer
   */
  initRenderer() {
    console.log("Initializing renderer");
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x87CEEB); // Sky blue background
    this.renderer.shadowMap.enabled = true;
    
    // Add to DOM
    const container = document.getElementById('container');
    if (container) {
      container.appendChild(this.renderer.domElement);
    } else {
      console.error("Container element not found");
      document.body.appendChild(this.renderer.domElement);
    }
    
    // Ensure renderer is visible with explicit styling
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.zIndex = '5';
    
    // Handle window resize
    window.addEventListener('resize', () => {
      console.log("Window resize event detected");
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      
      // Force a render after resize
      if (this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
        console.log("Forced render after resize");
      }
    });
  }
  
  /**
   * Initialize the camera
   */
  initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      75, window.innerWidth / window.innerHeight, 0.1, 1000
    );
  }
  
  /**
   * Initialize scene lighting
   */
  initLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    
    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 200, 100);
    directionalLight.castShadow = true;
    
    // Configure shadow properties
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 10;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    
    this.scene.add(directionalLight);
    
    // Add a hemisphere light for more natural lighting
    const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x448844, 0.6);
    this.scene.add(hemisphereLight);
  }
  
  /**
   * Initialize game objects (terrain, ball, etc.)
   */
  initGameObjects() {
    console.log("Initializing game objects");
    
    // Create terrain
    this.terrain = new TerrainGenerator({
      width: 400, 
      length: 400,
      maxHeight: 5,
      minHeight: -1,
      segmentsW: 200,
      segmentsL: 200
    });
    
    this.terrainMesh = this.terrain.generateTerrain();
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
    console.log('[Game.init] Tee Position:', this.terrain.teePosition.toArray());

    // Create golf ball
    this.ball = new GolfBall(this.terrain);
    this.scene.add(this.ball.getMesh());
    console.log('[Game.init] Ball created at Pos:', this.ball.position.toArray());
    
    // Reset ball to tee position
    this.ball.reset(this.terrain.teePosition);
    console.log('[Game.init] Ball reset to Pos:', this.ball.position.toArray());
    
    // Create ArrowHelper for shot direction
    const arrowDir = new THREE.Vector3(0, 0.2, -1).normalize();
    const arrowLength = 1.2;
    const arrowColor = 0xffd700; // Gold
    this.shotArrow = new THREE.ArrowHelper(arrowDir, new THREE.Vector3(0, 0, 0), arrowLength, arrowColor, 0.25, 0.15);
    this.shotArrow.visible = false;
    this.scene.add(this.shotArrow);
    
    // Initialize camera controller with ball as target
    this.cameraController = new CameraController(this.camera, this.ball);
    console.log('[Game.init] CameraController created. Initial Cam Pos:', this.camera.position.toArray());
    
    // Add a hole flag
    this.addHoleFlag();
    
    console.log("Game objects initialized successfully");
  }
  
  /**
   * Add a flag at the hole position
   */
  addHoleFlag() {
    if (!this.terrain || !this.terrain.holePosition) return;
    
    // Create flag pole
    const poleGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 8);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xEEEEEE });
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    
    // Position at hole
    pole.position.copy(this.terrain.holePosition);
    pole.position.y += 0.5; // Half height of pole
    
    // Create flag
    const flagGeometry = new THREE.PlaneGeometry(0.3, 0.2);
    const flagMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFF0000,
      side: THREE.DoubleSide
    });
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(0.15, 0.3, 0);
    flag.rotation.y = Math.PI / 2;
    
    // Add flag to pole
    pole.add(flag);
    
    // Add to scene
    this.scene.add(pole);
  }
  
  /**
   * Initialize input handlers
   */
  initInputHandlers() {
    // Keyboard events
    window.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
      this.handleKeyPress(e.key);
    });
    
    window.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
    });
    
    // Mouse events
    window.addEventListener('mousemove', (e) => {
      this.mousePosition.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mousePosition.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    
    window.addEventListener('mousedown', () => {
      this.isMouseDown = true;
      this.handleMouseDown();
    });
    
    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
      this.handleMouseUp();
    });

    // Mouse Wheel for Loft Adjustment
    window.addEventListener('wheel', (e) => {
      if (this.gameState === 'AIMING') {
        // Determine scroll direction (normalize across browsers)
        const delta = Math.sign(e.deltaY); 
        this.adjustLoft(-delta); // Invert delta: scroll down = increase loft, scroll up = decrease
        e.preventDefault(); // Prevent page scrolling
      }
    }, { passive: false }); // Need passive: false to preventDefault
  }
  
  /**
   * Handle key press events
   */
  handleKeyPress(key) {
    // If game is paused (instructions showing), only allow 'h' key to work
    if (this.isPaused && key !== 'h') {
      console.log("Game input ignored while instructions are showing");
      return;
    }
    
    switch (key) {
      case ' ': // Space bar
        if (this.gameState === 'AIMING') {
          this.startPowerMeter();
        } else if (this.gameState === 'HITTING') {
          this.hitBall();
        } else if (this.gameState === 'TITLE') {
          this.setGameState('READY_TO_HIT');
        }
        break;
        
      case 'c': // Change camera mode
        if (this.gameState === 'READY_TO_HIT' || this.gameState === 'AIMING') {
          this.toggleCameraMode();
        }
        break;
        
      case 'r': // Reset ball to tee
        if (this.gameState === 'READY_TO_HIT') {
          this.resetBall();
        }
        break;
        
      case 'h': // Show instructions
        this.ui.showInstructions();
        break;

      case 'ArrowUp':
        if (this.gameState === 'AIMING') {
          this.adjustLoft(1); // Use +1 direction
        }
        break;
      case 'ArrowDown':
        if (this.gameState === 'AIMING') {
          this.adjustLoft(-1); // Use -1 direction
        }
        break;
    }
  }
  
  /**
   * Handle mouse down events
   */
  handleMouseDown() {
    // If game is paused (instructions showing), ignore mouse input
    if (this.isPaused) {
      console.log("Mouse input ignored while instructions are showing");
      return;
    }
    
    if (this.gameState === 'AIMING') {
      this.ui.hideReadyIndicator(); // Hide indicator when starting swing
      this.startPowerMeter();
    } else if (this.gameState === 'TITLE') {
      this.setGameState('READY_TO_HIT');
    }
  }
  
  /**
   * Handle mouse up events
   */
  handleMouseUp() {
    if (this.gameState === 'HITTING') {
      this.hitBall();
    }
  }
  
  /**
   * Update game state
   */
  update() {
    this.deltaTime = this.clock.getDelta();
    
    // Update animation mixer if it exists
    if (this.mixer) {
      this.mixer.update(this.deltaTime);
    }

    // Update ball physics
    if (this.gameState === 'WATCHING') {
      // Ball is in motion after being hit
      this.ball.update(this.deltaTime);
    }
    
    // Log state BEFORE camera update
    if (window.DEBUG_CAMERA) {
      console.log(`Camera before update: ${this.camera.position.toArray()}`);
      console.log(`Ball before update: ${this.ball.position.toArray()}`);
    }
    
    // Update camera controller
    this.cameraController.update(this.deltaTime);
    
    // Log state AFTER camera update
    if (window.DEBUG_CAMERA) {
      console.log(`Camera after update: ${this.camera.position.toArray()}`);
    }
    
    // Update shot arrow position and direction if visible
    if (this.gameState === 'AIMING' && this.shotArrow) {
      const ballPos = this.ball.position;
      // Get the direction from the camera to the ball (XZ plane)
      const camToBall = ballPos.clone().sub(this.camera.position);
      camToBall.y = 0;
      camToBall.normalize();
      const axis = new THREE.Vector3().crossVectors(camToBall, new THREE.Vector3(0, 1, 0)).normalize();
      const loftRadians = this.currentLoft * Math.PI / 180;
      const shotDir = camToBall.clone();
      shotDir.applyAxisAngle(axis, loftRadians);
      shotDir.normalize();
      
      // Store the current shot direction for use when hitting
      this.currentShotDirection = {
        horizontal: camToBall.clone(), // Store horizontal direction (no loft)
        full: shotDir.clone()          // Store full direction (with loft)
      };
      
      // --- Deflection warning ---
      let arrowColor = 0xffd700; // Gold by default
      if (this.ball.terrain && this.ball.terrain.getNormalAtPosition) {
        const surfaceNormal = this.ball.terrain.getNormalAtPosition(ballPos.x, ballPos.z);
        if (surfaceNormal) {
          // Calculate the angle between the shot direction and surface normal
          const angle = Math.acos(Math.max(-1, Math.min(1, shotDir.dot(surfaceNormal))));
          
          // Check if this is a shot that would hit directly into the terrain
          // We need to distinguish between shots that would skim along the ground (good)
          // vs. shots directly into terrain (bad)
          
          // Get the horizontal component of the shot direction
          const horizontalShotDir = shotDir.clone();
          horizontalShotDir.y = 0;
          horizontalShotDir.normalize();
          
          // Calculate how much of the shot direction is downward into the terrain
          // vs. horizontal skimming along the surface
          const isDownwardShot = shotDir.y < -0.1;
          const horizontalComponent = horizontalShotDir.length();
          
          // Only show warning if:
          // 1. The angle with normal is steep (greater than 60 degrees instead of 45)
          // 2. AND the shot is significantly downward
          // 3. OR if the shot is almost directly into the terrain (very small horizontal component)
          if ((angle > Math.PI / 3 && isDownwardShot) || horizontalComponent < 0.4) {
            arrowColor = 0xff3333; // Red warning
          }
        }
      }
      this.shotArrow.setColor(new THREE.Color(arrowColor));
      // --- End deflection warning ---
      this.shotArrow.position.copy(ballPos).add(new THREE.Vector3(0, this.ball.options.radius + 0.02, 0));
      this.shotArrow.setDirection(shotDir);
      this.shotArrow.setLength(1.2, 0.25, 0.15);
      this.shotArrow.visible = true;
    } else if (this.shotArrow) {
      this.shotArrow.visible = false;
    }
    
    // Check if ball has stopped after being hit
    if (this.gameState === 'WATCHING' && this.ball.isResting) {
      console.log("Ball has come to rest");
      this.cameraController.followBall();
      this.setGameState('CAMERA_TRANSITION');
      this.cameraTransitionTime = 0;
    }
    
    // If in camera transition phase
    if (this.gameState === 'CAMERA_TRANSITION') {
      this.cameraTransitionTime += this.deltaTime;
      
      // Show a visual indicator that camera is transitioning
      if (this.ui) {
        const progress = Math.min(this.cameraTransitionTime / this.CAMERA_TRANSITION_DURATION, 1);
        this.ui.updateTransitionProgress(progress);
      }
      
      // If transition is complete
      if (this.cameraTransitionTime >= this.CAMERA_TRANSITION_DURATION) {
        
        // Before switching to READY_TO_HIT, ensure ball is properly positioned
        if (this.ball && this.terrain) {
          const terrainHeight = this.terrain.getHeightAtPosition(
            this.ball.position.x, this.ball.position.z
          );
          
          // Check if ball is embedded in terrain
          if (this.ball.position.y - this.ball.options.radius < terrainHeight) {
            console.log("Correcting ball position after camera transition");
            this.ball.position.y = terrainHeight + this.ball.options.radius + 0.01;
            // Update mesh position
            this.ball.getMesh().position.copy(this.ball.position);
          }
        }
        
        this.setGameState('READY_TO_HIT');
        if (this.ui) {
          this.ui.hideTransitionProgress();
        }
      }
    }
    
    // Handle input based on game state
    this.handleInput();
    
    // Update power meter
    this.updatePowerMeter();
    
    // Check if ball is in the hole
    this.checkBallInHole();
  }
  
  /**
   * Handle continuous input based on game state
   */
  handleInput() {
    if (this.gameState === 'AIMING') {
      // Adjust aim with left/right arrow keys
      if (this.keys['ArrowLeft']) {
        this.cameraController.rotateAim(0.03);
      }
      if (this.keys['ArrowRight']) {
        this.cameraController.rotateAim(-0.03);
      }
      // Adjust loft with up/down arrow keys
      // Need to check if key was *just* pressed to avoid rapid changes
      // (We'll handle this logic in handleKeyPress for single trigger)
    }
  }
  
  /**
   * Update power meter when active
   */
  updatePowerMeter() {
    if (!this.powerMeter.active) return;
    
    // Update power based on direction
    this.powerMeter.power += this.powerMeter.direction * this.powerMeter.speed * this.deltaTime;
    
    // Reverse direction at limits
    if (this.powerMeter.power >= 100) {
      this.powerMeter.power = 100;
      this.powerMeter.direction = -1;
    } else if (this.powerMeter.power <= 0) {
      this.powerMeter.power = 0;
      this.powerMeter.direction = 1;
    }
    
    // Update UI power meter
    this.ui.updatePowerMeter(this.powerMeter.power);
  }
  
  /**
   * Start the power meter
   */
  startPowerMeter() {
    this.powerMeter.active = true;
    this.powerMeter.power = 0;
    this.powerMeter.direction = 1;
    this.setGameState('HITTING');
    
    // Show UI power meter
    this.ui.showPowerMeter();
  }
  
  /**
   * Hit the ball with current power and direction
   */
  hitBall() {
    // Get current power and direction
    let power = this.powerMeter.power;
    
    // Use the stored shot direction if available, otherwise fall back to camera direction
    let direction;
    if (this.currentShotDirection && this.currentShotDirection.horizontal) {
      direction = this.currentShotDirection.horizontal.clone();
    } else {
      direction = this.cameraController.getAimDirection();
    }
    
    let loft = this.currentLoft;
    // On the first hit, override power and loft for a dramatic launch
    if (this.firstHit) {
      power = 95;
      loft = 30;
      this.firstHit = false;
    }
    
    // --- Calculate the true launch vector (aim + loft) for collision checks ---
    let launchDirection;
    
    // Use the pre-calculated full direction if available
    if (this.currentShotDirection && this.currentShotDirection.full) {
      launchDirection = this.currentShotDirection.full.clone();
    } else {
      // Fallback to calculating from direction and loft
      launchDirection = direction.clone();
      const loftRadians = loft * Math.PI / 180;
      const upVector = new THREE.Vector3(0, 1, 0);
      const rotationAxis = new THREE.Vector3().crossVectors(upVector, launchDirection).normalize();
      launchDirection.applyAxisAngle(rotationAxis, loftRadians);
    }
    
    launchDirection.normalize();
    
    // Store this direction on the ball for deflection logic on first impact
    this.ball.lastShotDirection = launchDirection.clone();
    
    // Hit the ball using the *horizontal* direction and loft angle
    // The ball.hit() method applies loft internally to calculate initial velocity
    this.ball.hit(power, direction, loft);
    
    // Increment stroke count
    this.strokes++;
    
    // Reset power meter
    this.powerMeter.active = false;
    this.ui.hidePowerMeter();
    
    // Change camera mode to watch the ball
    this.cameraController.watchBallInFlight();
    
    // Change game state
    this.setGameState('WATCHING');
    
    // Update UI
    this.ui.updateStrokes(this.strokes);
  }
  
  /**
   * Toggle camera mode (follow/overview)
   */
  toggleCameraMode() {
    if (this.cameraController.currentMode === this.cameraController.MODES.FOLLOW) {
      this.cameraController.setMode(this.cameraController.MODES.OVERVIEW);
    } else {
      this.cameraController.setMode(this.cameraController.MODES.FOLLOW);
    }
  }
  
  /**
   * Reset the ball to the tee
   */
  resetBall() {
    console.log('[Game.resetBall] Resetting ball. Tee Pos:', this.terrain.teePosition.toArray());
    this.ball.reset(); // Ball.reset() uses terrain.teePosition if no arg is given
    console.log('[Game.resetBall] Ball position after reset:', this.ball.position.toArray());
    this.strokes = 0;
    
    // Update UI
    this.ui.updateStrokes(this.strokes);
  }
  
  /**
   * Check if the ball is in the hole
   */
  checkBallInHole() {
    // Distance from ball to hole
    const distanceToHole = this.ball.position.distanceTo(this.terrain.holePosition);
    
    // Height difference between ball and hole
    const heightDifference = Math.abs(this.ball.position.y - this.terrain.holePosition.y);
    
    // Ball is in hole if it's close enough horizontally and not too far above/below the hole
    if (distanceToHole < 0.2 && heightDifference < 0.1 && this.ball.isResting) {
      // Ball is in the hole!
      console.log(`Hole completed in ${this.strokes} strokes!`);
      
      // Update score
      const relativeScore = this.strokes - this.par;
      this.score += relativeScore;
      
      // Update UI
      this.ui.updateScore(this.score);
      this.ui.showHoleCompleteMessage(this.strokes, this.par);
      
      // Reset for next hole
      setTimeout(() => {
        this.resetBall();
      }, 3000);
    }
  }
  
  /**
   * Set the game state
   */
  setGameState(state) {
    console.log(`Game state changing from ${this.gameState} to ${state}`);
    this.gameState = state;
    
    // Handle state transitions
    switch (state) {
      case 'READY_TO_HIT':
        // Prepare for the next shot (e.g., enable aiming)
        this.setGameState('AIMING'); // Immediately transition to aiming
        break;
      case 'AIMING':
        // Reset aiming angle when entering aiming state after a shot
        if (this.cameraController) { // Ensure controller exists
          this.cameraController.aimingAngle = 0; // Reset aim to forward
        }
        // Set camera to aiming mode
        this.cameraController?.setMode(this.cameraController.MODES.AIMING);
        console.log("Player can now aim/adjust loft");
        break;
      case 'HITTING':
        // Start power meter
        console.log("Power meter active");
        if (this.shotArrow) this.shotArrow.visible = false; // Hide visual indicator
        break;
      case 'WATCHING':
        // Ball is in motion
        console.log("Ball in motion");
        if (this.shotArrow) this.shotArrow.visible = false; // Hide visual indicator
        break;
      case 'CAMERA_TRANSITION':
        // Camera is smoothly moving to aiming position
        console.log("Camera transitioning to aiming position");
        // Notify UI to show transition indicator if needed
        if (this.ui && this.ui.showTransitionIndicator) {
          this.ui.showTransitionIndicator();
        }
        break;
    }
  }
  
  /**
   * Main animation/game loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());
    
    try {
      // Update game state
      this.update();
      
      // Render the scene
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      console.error("Error in animation loop:", error);
    }
  }

  /**
   * Adjust the loft angle
   */
  adjustLoft(direction) { // Parameter is now direction (+1 or -1)
    if (this.gameState !== 'AIMING') return;

    this.currentLoft += direction * this.LOFT_INCREMENT; // Use this.LOFT_INCREMENT
    // Clamp loft angle
    this.currentLoft = Math.max(this.MIN_LOFT, Math.min(this.MAX_LOFT, this.currentLoft)); // Use this.MIN_LOFT, this.MAX_LOFT
    
    console.log(`Loft changed to: ${this.currentLoft.toFixed(1)}°`);
    // Update UI display
    if (this.ui) {
      this.ui.updateLoftDisplay(this.currentLoft);
    }
    // No need to update indicator geometry here, 'update' loop handles rotation
  }
}

export default Game; 
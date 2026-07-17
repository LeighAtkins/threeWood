import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import TerrainGenerator from './terrain.js';
import GolfBall from './ball.js';
import CameraController from './camera.js';
import UI from './ui.js';
import handleHoleComplete from './holeComplete.js';
import { DirectionArrow } from './directionArrow.js';
import { AudioManager } from './audioManager.js';

/**
 * Main game controller for ThreeWood
 * Integrates all components and handles game loop
 */
class Game {
  constructor(fpsCounter) {
    this.fpsCounter = fpsCounter;
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
    this.directionArrow = null;
    
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
    
    // Audio system
    this.audioManager = new AudioManager();
    
    // Input state
    this.keys = {};
    this.mousePosition = new THREE.Vector2();
    this.isMouseDown = false;
    this.lastMousePosition = new THREE.Vector2();
    this.mouseSensitivity = 0.003; // Mouse sensitivity for aiming
    this.powerMeter = {
      active: false,
      power: 0,
      direction: 1, // 1 for increasing, -1 for decreasing
      speed: 50 // Power change per second
    };
    
    // Pause state
    this.isPaused = false;

    // Spin selector state
    this.isSpinSelectorOpen = false;
    
    this.renderDirty = true;
    
    // Initialize the game
    this.init();
  }
  
  /**
   * Initialize the game
   */
  init() {
    try {
      if (window.DEBUG) console.log("Game initialization started");
      
      // Initialize renderer
      this.initRenderer();
      
      // Initialize camera
      this.initCamera();
      
      // Initialize lighting
      this.initLighting();

      // Initialize gradient sky + fog
      this.initSky();

      // Initialize game objects
      this.initGameObjects();
      
      // Initialize UI
      this.ui = new UI(this);
      
      // Initialize input handlers
      this.initInputHandlers();
      
      // Initialize mouse position tracking
      this.lastMousePosition.set(window.innerWidth / 2, window.innerHeight / 2);
      
      // Set starting game state - we'll be ready to aim after instructions are dismissed
      this.setGameState('READY_TO_HIT');
      
      // Start the game loop
      this.animate();
      
      // Show instructions after a brief delay
      setTimeout(() => {
        if (window.DEBUG) console.log("Showing initial game instructions");
        this.ui.showInstructions();
        
        // Pause ability to hit ball until instructions are dismissed
        this.isPaused = true;
        if (window.DEBUG) console.log("Game interaction paused until instructions dismissed");
        
        // Add listener for the instructions dismissal
        document.addEventListener('instructionsDismissed', () => {
          if (window.DEBUG) console.log("Instructions dismissed event received");
          this.isPaused = false;
          if (window.DEBUG) console.log("Game interaction resumed");
        }, { once: true });
      }, 800);
      
      // Force initial render to ensure the scene is visible
      this.renderer.render(this.scene, this.camera);
      this.renderDirty = true;
      if (window.DEBUG) console.log("Initial render forced");
      
      if (window.DEBUG) console.log("Game initialized successfully");
    } catch (error) {
      console.error("Error initializing game:", error);
    }
  }
  
  /**
   * Initialize the WebGL renderer
   */
  initRenderer() {
    if (window.DEBUG) console.log("Initializing renderer");
    this.renderer = new THREE.WebGLRenderer({ antialias: false }); // Disabled for performance + PS1 aesthetic
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap lower for PS1-style crispness + perf
    // No tone mapping: PS1 hardware had none, keeps colors flat and saturated
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // Hard-edged PS1-style shadows (PCFSoftShadowMap is modern/soft)
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

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
      if (window.DEBUG) console.log("Window resize event detected");
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      
      // Force a render after resize
      if (this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
        if (window.DEBUG) console.log("Forced render after resize");
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
    // Lower ambient so the sun reads harder — flatter, harsher PS1 look
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambientLight);

    // Directional light (sun)
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
    sun.position.set(60, 90, 40);
    sun.castShadow = true;

    // Tighter shadow frustum centered on the play area + crisper 1024 map
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.bias = -0.0005;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Hemisphere light for sky/ground bounce, tuned to the sky gradient
    const hemisphereLight = new THREE.HemisphereLight(0x88bbff, 0x4a6b3a, 0.5);
    this.scene.add(hemisphereLight);
  }

  /**
   * Build a vertical gradient sky as the scene background and add matching
   * distance fog. Both are authentic to the PS1 aesthetic (fog masked the
   * short draw distance) and hide terrain edge pop-in.
   */
  initSky() {
    // --- Gradient sky via canvas texture ---
    const skyTop = new THREE.Color(0x2a6cc4);     // deep blue zenith
    const skyHorizon = new THREE.Color(0xbfe0ff); // pale horizon
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `rgb(${skyTop.r * 255 | 0},${skyTop.g * 255 | 0},${skyTop.b * 255 | 0})`);
    grad.addColorStop(0.6, `rgb(${skyHorizon.r * 255 | 0},${skyHorizon.g * 255 | 0},${skyHorizon.b * 255 | 0})`);
    grad.addColorStop(1, `rgb(${skyHorizon.r * 255 | 0},${skyHorizon.g * 255 | 0},${skyHorizon.b * 255 | 0})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
    const skyTexture = new THREE.CanvasTexture(canvas);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTexture;

    // --- Distance fog (color matches the horizon) ---
    this.scene.fog = new THREE.Fog(0xbfe0ff, 120, 340);
  }

  /**
   * Initialize game objects (terrain, ball, etc.)
   */
  initGameObjects() {
    if (window.DEBUG) console.log("Initializing game objects");
    
    // Create terrain
    this.terrain = new TerrainGenerator({
      width: 400, 
      length: 400,
      maxHeight: 5,
      minHeight: -1,
      segmentsW: 50,  // Reduced from 100 for 4x performance gain
      segmentsL: 50,  // Reduced from 100 for 4x performance gain
      waterLevel: -0.8,
      waterColor: 0x4466aa,
      waterOpacity: 0.8
    });
    
    // Generate terrain mesh
    this.terrainMesh = this.terrain.generateTerrain();
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
    
    // Create water surface
    this.terrain.createWaterSurface(this.scene);
    
    // Create golf hole flag
    this.flag = this.terrain.createFlag(this.scene);
    
    // Create bridge over water moat
    this.bridge = this.terrain.createBridge(this.scene);
    
    if (window.DEBUG) console.log('[Game.init] Tee Position:', this.terrain.teePosition.toArray());

    // Create golf ball
    this.ball = new GolfBall(this.terrain, this.audioManager);
    this.scene.add(this.ball.getMesh());
    if (window.DEBUG) console.log('[Game.init] GolfBall created at Pos:', this.ball.position.toArray());
    
    // Reset golf ball to tee position
    this.ball.reset(this.terrain.teePosition);
    if (window.DEBUG) console.log('[Game.init] Ball reset to Pos:', this.ball.position.toArray());
    
    // Create ArrowHelper for shot direction
    const arrowDir = new THREE.Vector3(0, 0.2, -1).normalize();
    const arrowLength = 1.2;
    const arrowColor = 0xffd700; // Gold
    this.shotArrow = new THREE.ArrowHelper(arrowDir, new THREE.Vector3(0, 0, 0), arrowLength, arrowColor, 0.25, 0.15);
    this.shotArrow.visible = false;
    this.scene.add(this.shotArrow);
    
    // Initialize camera controller with ball as target
    this.cameraController = new CameraController(this.camera, this.ball, { terrain: this.terrain });
    // Set a reference to the game instance in the camera controller
    this.cameraController.game = this;
    if (window.DEBUG) console.log('[Game.init] CameraController created. Initial Cam Pos:', this.camera.position.toArray());

    // Calculate initial aiming angle towards the hole after terrain is ready
    if (this.terrain && this.terrain.teePosition && this.terrain.holePosition) {
      const teeToHole = new THREE.Vector2(
        this.terrain.holePosition.x - this.terrain.teePosition.x,
        this.terrain.holePosition.z - this.terrain.teePosition.z
      );
      this.cameraController.aimingAngle = 0; // Set to 0 to point along positive X-axis (towards hole)
      if (window.DEBUG) console.log('[Game.init] Initial aiming angle set to:', this.cameraController.aimingAngle);
    }
    
    // Add a hole flag
    // this.addHoleFlag(); // Removed as flag is created in TerrainGenerator
    
    // Create direction arrow UI
    this.createDirectionArrow();
    
    if (window.DEBUG) console.log("Game objects initialized successfully");
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
      // Update normalized mouse position for UI interactions
      this.mousePosition.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mousePosition.y = -(e.clientY / window.innerHeight) * 2 + 1;
      
      // Handle mouse aiming when in AIMING state
      if (this.gameState === 'AIMING' && !this.isPaused && !this.isSpinSelectorOpen) {
        const mouseDeltaX = e.clientX - this.lastMousePosition.x;
        
        // Only rotate if there's significant mouse movement
        if (Math.abs(mouseDeltaX) > 1) {
          const rotationAmount = mouseDeltaX * this.mouseSensitivity;
          this.cameraController.rotateAim(rotationAmount);
          this.renderDirty = true;
        }
      }
      
      // Update last mouse position
      this.lastMousePosition.set(e.clientX, e.clientY);
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
   * Handle key press
   */
  handleKeyPress(key) {
    if (this.isPaused) return;
    this.renderDirty = true;
    
    switch (key.toLowerCase()) {
      case ' ': // Space bar
        if (this.gameState === 'AIMING') {
          // Start power meter (if not already active)
          if (!this.powerMeter.active) {
            this.startPowerMeter();
            this.setGameState('HITTING');
          }
        } else if (this.gameState === 'HITTING') {
          // Execute hit with current power
          this.hitBall();
        }
        break;
      case 'r': // Reset ball
        this.resetBall();
        this.setGameState('AIMING');
        break;
      case 'c': // Toggle camera mode
        this.toggleCameraMode();
        break;
      case 'arrowup': // Increase loft
        this.adjustLoft(1);
        break;
      case 'arrowdown': // Decrease loft
        this.adjustLoft(-1);
        break;
      case 's': // Toggle spin selector
        if (this.gameState === 'AIMING') {
          this.toggleSpinSelector();
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
      if (window.DEBUG) console.log("Mouse input ignored while instructions are showing");
      return;
    }
    
    // Skip if user is interacting with the spin selector
    if (this.isSpinSelectorOpen) {
      if (window.DEBUG) console.log("Mouse input ignored while spin selector is open");
      return;
    }
    this.renderDirty = true;
    
    if (this.gameState === 'AIMING') {
      this.ui.hideReadyIndicator(); // Hide indicator when starting swing
      
      // Start power meter
      this.startPowerMeter();
      this.setGameState('HITTING');
    } else if (this.gameState === 'HITTING') {
      // Execute hit with current power
      this.hitBall();
    } else if (this.gameState === 'TITLE') {
      this.setGameState('READY_TO_HIT');
    }
  }
  
  /**
   * Handle mouse up events
   */
  handleMouseUp() {
    // We're now using a two-click process for hitting the ball,
    // so mouse up does not automatically trigger the hit
    // This is intentionally empty
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
      // Store previous position to check if ball moved
      const prevPosition = this.ball.position.clone();
      
      // Ball is in motion after being hit
      this.ball.update(this.deltaTime);
      
      // Only mark dirty if ball actually moved significantly
      if (prevPosition.distanceTo(this.ball.position) > 0.001) {
        this.renderDirty = true;
      }
      
      // Check if ball has entered the hole
      if (this.terrain && this.terrain.checkBallInHole && this.terrain.checkBallInHole(this.ball)) {
        // Ball has entered the hole!
        this.handleHoleComplete();
      }
    }
    
    // Update water animation and check for ball-water collisions
    if (this.terrain) {
      // Update water surface waves
      if (this.terrain.updateWater) {
        this.terrain.updateWater(this.deltaTime);
      }
      
      // Check for ball-water collision and create splash if needed
      if (this.gameState === 'WATCHING' && this.ball && this.terrain.checkBallWaterCollision) {
        // Get ball velocity for splash intensity
        const ballVelocity = this.ball.velocity ? this.ball.velocity.length() : 0;
        
        // Check collision and create splash if needed
        const isInWater = this.terrain.checkBallWaterCollision(
          this.ball, 
          this.scene, 
          ballVelocity
        );
        
        // Apply water physics to ball if in water
        if (isInWater) {
          // Make sure ball has velocity object
          if (!this.ball.velocity) {
            this.ball.velocity = new THREE.Vector3(0, 0, 0);
          }
          
          // Slow down the ball in water (water resistance)
          this.ball.velocity.multiplyScalar(0.95);
          
          // Apply slight downward force (sinking)
          this.ball.velocity.y -= 0.05;
          
          // Ensure the ball keeps moving if it's in water
          if (this.ball.velocity.length() < 0.1) {
            // Add a small random movement to prevent complete stopping in water
            this.ball.velocity.x += (Math.random() - 0.5) * 0.02;
            this.ball.velocity.z += (Math.random() - 0.5) * 0.02;
            this.ball.velocity.y -= 0.1; // Ensure it sinks
          }
        }
      }
      
      // Update splash and ripple effects
      if (this.terrain.updateSplashEffects) {
        this.terrain.updateSplashEffects(this.deltaTime, this.scene);
      }
    }
    
    // Log state BEFORE camera update
    if (window.DEBUG_CAMERA) {
      if (window.DEBUG) console.log(`Camera before update: ${this.camera.position.toArray()}`);
      if (window.DEBUG) console.log(`Ball before update: ${this.ball.position.toArray()}`);
    }
    
    // Update camera controller
    this.cameraController.update(this.deltaTime);
    
    // Update direction arrow to point to hole
    this.updateDirectionArrow();
    
    // Log state AFTER camera update
    if (window.DEBUG_CAMERA) {
      if (window.DEBUG) console.log(`Camera after update: ${this.camera.position.toArray()}`);
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
      this.renderDirty = true;
    } else if (this.shotArrow) {
      this.shotArrow.visible = false;
      this.renderDirty = true;
    }
    
    // Check if ball has stopped after being hit
    if (this.gameState === 'WATCHING' && this.ball.isResting) {
      if (window.DEBUG) console.log("Ball has come to rest");
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
            if (window.DEBUG) console.log("Correcting ball position after camera transition");
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
      // Adjust aim with left/right arrow keys (fixed inversion)
      if (this.keys['ArrowLeft']) {
        this.cameraController.rotateAim(-0.03);  // Fixed: left arrow now rotates left
      }
      if (this.keys['ArrowRight']) {
        this.cameraController.rotateAim(0.03);   // Fixed: right arrow now rotates right
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
    
    // Store previous power to check if it changed
    const prevPower = this.powerMeter.power;
    
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
    
    // Only update UI and mark dirty if power actually changed
    if (Math.abs(prevPower - this.powerMeter.power) > 0.1) {
      this.ui.updatePowerMeter(this.powerMeter.power);
      this.renderDirty = true;
    }
  }
  
  /**
   * Start the power meter
   */
  startPowerMeter() {
    // Don't start if already active
    if (this.powerMeter.active) {
      if (window.DEBUG) console.log("Power meter already active");
      return;
    }
    
    // Initialize power meter
    this.powerMeter.active = true;
    this.powerMeter.power = 0;
    this.powerMeter.direction = 1;
    
    // Change game state
    this.setGameState('HITTING');
    
    // Show UI power meter
    this.ui.showPowerMeter();
    
    if (window.DEBUG) console.log("Power meter started - Click again to hit ball");
  }
  
  /**
   * Hit the ball with current power and direction
   */
  hitBall() {
    // Ensure the power meter is active
    if (!this.powerMeter.active) {
      console.warn("Attempted to hit ball without active power meter");
      return;
    }
    
    // Play swing sound before hitting
    this.audioManager.playSwingSound();
    
    if (window.DEBUG) console.log("Hitting ball with power: " + this.powerMeter.power.toFixed(1));
    
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
    
    // Get spin values with safe default
    let spinValues = this.spinValues || { x: 0, y: 0 };
    if (!spinValues.x && !spinValues.y) {
      // If no spin values stored, try getting from UI
      try {
        if (this.ui && this.ui.spinValues) {
          spinValues = this.ui.spinValues;
        }
      } catch (e) {
        console.warn("Error getting spin values:", e);
      }
    }
    
    // Calculate sidespin based on horizontal (x) position
    // Negative x = left spin (hook), Positive x = right spin (slice)
    let sidespin = (spinValues.x || 0); // Use raw value from spin selector
    
    // Hit the ball using the horizontal direction, loft angle, and sidespin
    this.ball.hit(power, direction, loft, sidespin);
    
    // Hide the spin selector and indicator after hitting
    try {
      if (this.ui) {
        if (this.ui.hideSpinSelector) this.ui.hideSpinSelector();
        if (this.ui.hideSpinIndicator) this.ui.hideSpinIndicator();
      }
    } catch (e) {
      console.warn("Error hiding spin UI:", e);
    }
    
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
   * Show the spin selector UI
   */
  showSpinSelector() {
    if (this.gameState !== 'AIMING') return;
    
    // Show the spin selector UI
    this.ui.showSpinSelector();
  }
  
  /**
   * Toggle camera mode (follow/overview)
   */
  toggleCameraMode() {
    this.renderDirty = true;
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
    this.renderDirty = true;
    if (window.DEBUG) console.log('[Game.resetBall] Resetting ball. Tee Pos:', this.terrain.teePosition.toArray());
    this.ball.reset(); // Ball.reset() uses terrain.teePosition if no arg is given
    if (window.DEBUG) console.log('[Game.resetBall] Ball position after reset:', this.ball.position.toArray());
    this.strokes = 0;
    
    // Update UI
    this.ui.updateStrokes(this.strokes);
    
    // Point the camera toward the hole before setting game state
    if (this.cameraController && this.terrain && this.terrain.holePosition) {
      // Calculate direction from ball to hole
      const ballPos = this.ball.position;
      const holePos = this.terrain.holePosition;
      
      // Calculate angle to hole in the XZ plane
      const angleToHole = Math.atan2(
        holePos.x - ballPos.x,
        holePos.z - ballPos.z
      );
      
      // Reset the camera controller's aiming angle to point at the hole
      this.cameraController.aimingAngle = angleToHole;
      if (window.DEBUG) console.log('[Game.resetBall] Camera aimed toward hole at angle:', angleToHole);
    }
    
    // Ensure the game state is set to allow hitting
    // We need to set it to READY_TO_HIT which will transition to AIMING
    // This is critical for allowing the player to hit the ball again
    this.setGameState('READY_TO_HIT');
    
    // Show the shot arrow again
    if (this.shotArrow) {
      this.shotArrow.visible = true;
    }
    
    // Reset any other game state variables that might prevent hitting
    this.powerMeter.active = false;
    if (this.ui) {
      this.ui.hidePowerMeter();
      this.ui.showReadyIndicator();
    }
  }
  
  /**
   * Check if the ball is in the hole
   */
  checkBallInHole() {
    // Use the terrain's sophisticated hole detection method
    if (this.terrain && this.terrain.checkBallInHole && this.terrain.checkBallInHole(this.ball.getMesh())) {
      // Ball is in the hole!
      if (window.DEBUG) console.log(`Hole completed in ${this.strokes} strokes!`);
      
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
    if (window.DEBUG) console.log(`Game state changing from ${this.gameState} to ${state}`);
    
    // Store previous state for reference
    const previousState = this.gameState;
    this.gameState = state;
    this.renderDirty = true;
    
    // Handle state transitions
    switch (state) {
      case 'READY_TO_HIT':
        // Prepare for the next shot (e.g., enable aiming)
        
        // Reset any lingering state from previous gameplay
        if (previousState === 'HOLE_COMPLETE') {
          if (window.DEBUG) console.log('Transitioning from HOLE_COMPLETE to READY_TO_HIT');
          // Make sure ball is not moving
          if (this.ball && this.ball.velocity) {
            this.ball.velocity.set(0, 0, 0);
            this.ball.isResting = true;
          }
        }
        
        // Immediately transition to aiming
        this.setGameState('AIMING');
        break;
      case 'AIMING':
        // Reset aiming angle when entering aiming state after a shot
        if (this.cameraController) { // Ensure controller exists
          this.cameraController.aimingAngle = 0; // Reset aim to forward
        }
        // Set camera to aiming mode
        this.cameraController?.setMode(this.cameraController.MODES.AIMING);
        if (window.DEBUG) console.log("Player can now aim/adjust loft");
        
        // Reset spin values for a new shot
        this.resetSpinValues();
        
        // Show spin indicator if there's spin applied
        try {
          if (this.ui && this.ui.spinValues && 
              (Math.abs(this.ui.spinValues.x) > 0.05 || Math.abs(this.ui.spinValues.y) > 0.05)) {
            this.ui.updateSpinIndicator();
          }
        } catch (e) {
          console.warn("Could not update spin indicator:", e);
        }
        break;
      case 'HITTING':
        // Start power meter
        if (window.DEBUG) console.log("Power meter active");
        if (this.shotArrow) this.shotArrow.visible = false; // Hide visual indicator
        break;
      case 'WATCHING':
        // Ball is in motion
        if (window.DEBUG) console.log("Ball in motion");
        if (this.shotArrow) this.shotArrow.visible = false; // Hide visual indicator
        
        // Hide spin indicator while ball is in motion
        try {
          if (this.ui && this.ui.hideSpinIndicator) {
            this.ui.hideSpinIndicator();
          }
        } catch (e) {
          console.warn("Could not hide spin indicator:", e);
        }
        break;
      case 'CAMERA_TRANSITION':
        // Camera is smoothly moving to aiming position
        if (window.DEBUG) console.log("Camera transitioning to aiming position");
        // Notify UI to show transition indicator if needed
        if (this.ui && this.ui.showTransitionIndicator) {
          this.ui.showTransitionIndicator();
        }
        break;
    }
  }
  
  /**
   * Toggle the spin selector visibility
   */
  toggleSpinSelector() {
    try {
      if (!this.ui) return;
      
      if (!this.isSpinSelectorOpen) {
        // Show spin selector
        this.isSpinSelectorOpen = true;
        
        // Use the UI's showSpinSelector method
        if (this.ui.showSpinSelector) {
          this.ui.showSpinSelector((spinValues) => {
            // This is the callback when spin is confirmed
            if (window.DEBUG) console.log("Spin applied:", spinValues);
            // Store spin values for use when hitting
            this.spinValues = spinValues;
          });
        }
      } else {
        // Hide spin selector
        this.isSpinSelectorOpen = false;
        
        if (this.ui.closeSpinSelector) {
          this.ui.closeSpinSelector(false); // false = don't call callback
        }
      }
    } catch (e) {
      console.warn("Error toggling spin selector:", e);
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
      
      // Render the scene only when necessary
      const shouldRender = this.renderDirty || 
                          this.gameState === 'WATCHING' || 
                          this.gameState === 'CAMERA_TRANSITION' ||
                          (this.gameState === 'HITTING' && this.powerMeter.active);
                          
      if (shouldRender) {
        this.renderer.render(this.scene, this.camera);
        this.renderDirty = false;
      }

      // Update FPS counter
      if (this.fpsCounter) {
        this.fpsCounter.update();
      }
    } catch (error) {
      console.error("Error in animation loop:", error);
    }
  }

  /**
   * Adjust the loft angle
   */
  adjustLoft(direction) { // Parameter is now direction (+1 or -1)
    if (this.gameState !== 'AIMING') return;
    this.renderDirty = true;

    this.currentLoft += direction * this.LOFT_INCREMENT; // Use this.LOFT_INCREMENT
    // Clamp loft angle
    this.currentLoft = Math.max(this.MIN_LOFT, Math.min(this.MAX_LOFT, this.currentLoft)); // Use this.MIN_LOFT, this.MAX_LOFT
    
    // Loft logging removed for performance
    // Update UI display
    if (this.ui) {
      this.ui.updateLoftDisplay(this.currentLoft);
    }
    // No need to update indicator geometry here, 'update' loop handles rotation
  }

  /**
   * Reset power meter state
   * Called when closing spin selector or other cases where we need
   * to cancel any accidental power meter activation
   */
  resetPowerMeterState() {
    if (this.gameState === 'HITTING' && !this.ball.isMoving) {
      // Only reset if we're in HITTING state but the ball isn't moving yet
      this.powerMeter.active = false;
      this.ui.hidePowerMeter();
      this.setGameState('AIMING');
      
      // Show ready indicator again
      if (this.ui && this.ui.showReadyIndicator) {
        this.ui.showReadyIndicator();
      }
      
      if (window.DEBUG) console.log("Power meter state reset");
    }
  }

  /**
   * Reset spin values for a new shot
   */
  resetSpinValues() {
    this.spinValues = { x: 0, y: 0 };
    if (this.ui) {
      this.ui.updateSpinIndicator();
    }
  }
  
  /**
   * Create the direction arrow UI element
   */
  createDirectionArrow() {
    // Create the direction arrow UI element
    const container = document.getElementById('game-container') || document.body;
    this.directionArrow = new DirectionArrow(container);
    
    // Initially hide the arrow until the game starts
    this.directionArrow.setVisible(false);
  }
  
  /**
   * Update the direction arrow to point toward the hole
   * Dynamically recalculates orientation based on camera position
   */
  updateDirectionArrow() {
    if (!this.directionArrow || !this.ball || !this.terrain || !this.terrain.holePosition || !this.camera) {
      return;
    }

    // Only show the arrow when the ball is stationary and we're ready to hit
    const shouldShowArrow = ['READY_TO_HIT', 'AIMING'].includes(this.gameState) && !this.ball.isMoving;

    // Only flag a re-render when visibility actually changes (avoid dirtying every frame)
    if (shouldShowArrow !== this._dirArrowVisible) {
      this._dirArrowVisible = shouldShowArrow;
      this.renderDirty = true;
    }

    this.directionArrow.setVisible(shouldShowArrow);

    if (shouldShowArrow) {
      // Update the arrow direction with camera position for perspective adjustment
      this.directionArrow.update(
        this.ball.position,
        this.terrain.holePosition,
        this.camera.position
      );
    }
  }
}

// Add the handleHoleComplete method to the Game class prototype
Game.prototype.handleHoleComplete = handleHoleComplete;

export default Game;
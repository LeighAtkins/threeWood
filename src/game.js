import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as TWEEN from '@tweenjs/tween.js';
import TerrainGenerator from './terrain.js';
import GolfBall from './ball.js';
import CameraController from './camera.js';
import UI from './ui.js';
import handleHoleComplete from './holeComplete.js';
import { DirectionArrow } from './directionArrow.js';
import { AudioManager } from './audioManager.js';
import { Minimap } from './minimap.js';
import { createGameRng, getSeedFromUrl, generateSeed } from './core/rng.js';
import { StateMachine } from './core/states.js';
import { createSwing, startSwing, swingClick, swingStep, strikeFromTiming, describeStrike } from './core/swing.js';
import { CLUBS, VARIANTS, effectiveLoft, launchSpeed, estimateDistance, autoSelectClub } from './core/clubs.js';
import { getLieAt, describeLie } from './core/lies.js';
import { designHole, ARCHETYPES } from './course/holeDesigner.js';
import { createTrees } from './course/trees.js';

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
    this.minimap = null;
    
    // UI
    this.ui = null;
    
    // Club bag state (see core/clubs.js). The effective loft/maxSpeed of the
    // current club + shot variant drive aiming, the strike model, and launch.
    this.clubIndex = 0;
    this.variantIndex = 0;
    // Fine trajectory trim on the mouse wheel (degrees, ±8). Resets whenever
    // the club or variant changes — it's a per-shot adjustment, not a setting.
    this.loftTrim = 0;
    
    // Deterministic seed — everything in the round derives from this.
    this.seed = getSeedFromUrl() || generateSeed();
    this.gameRng = createGameRng(this.seed);
    this.fxRng = this.gameRng.fork('fx').rng; // cosmetic/secondary effects

    // Round state
    this.holeNumber = 1;
    this.roundLength = 3; // 3-hole rounds for now; 18 when biomes land
    this.roundScores = []; // { hole, par, strokes }

    // Game state
    this.score = 0;
    this.strokes = 0;
    this.par = 3; // Default par for the hole
    this.fsm = this.createStateMachine();
    
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

    // 3-click swing (power -> accuracy -> strike); see core/swing.js
    this.swing = createSwing();
    this.lastStrike = null; // last strike outcome, for tuning/replay debug
    
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

      // Seed badge (shareable round identity)
      this.initSeedBadge();
      
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

      // Debug/replay scaffolding: scripted access for tuning, tests, replays
      window.THREEWOOD = this;
      
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
    // Elevated stylized low-poly: clean edges, soft shadows, filmic tonemap.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
    // Golden-hour key light: warm, low, long soft shadows. Hemisphere provides
    // the cool sky fill — the warm/cool contrast is what makes low-poly read
    // as art direction instead of "no textures".
    const sun = new THREE.DirectionalLight(0xffdfb0, 2.4);
    sun.position.set(90, 70, 45);
    sun.castShadow = true;

    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Sky bounce (cool blue) over ground bounce (warm green)
    const hemisphereLight = new THREE.HemisphereLight(0xa8ccff, 0x7a9455, 1.1);
    this.scene.add(hemisphereLight);

    // Faint warm ambient lift so shadowed faces never go muddy
    const ambientLight = new THREE.AmbientLight(0xfff0dd, 0.15);
    this.scene.add(ambientLight);
  }

  /**
   * Vertical gradient sky + matching distance fog. Horizon and fog share one
   * warm haze color so terrain melts into the sky at the draw distance.
   */
  initSky() {
    const skyZenith = new THREE.Color(0x63b4f2);   // clear cerulean (punchy: ACES desaturates)
    const skyHorizon = new THREE.Color(0xffd493);  // warm golden haze
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `rgb(${skyZenith.r * 255 | 0},${skyZenith.g * 255 | 0},${skyZenith.b * 255 | 0})`);
    grad.addColorStop(0.55, `rgb(${skyHorizon.r * 255 | 0},${skyHorizon.g * 255 | 0},${skyHorizon.b * 255 | 0})`);
    grad.addColorStop(1, `rgb(${skyHorizon.r * 255 | 0},${skyHorizon.g * 255 | 0},${skyHorizon.b * 255 | 0})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
    const skyTexture = new THREE.CanvasTexture(canvas);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTexture;

    // Distance fog melts terrain into the horizon haze (hides the far edge)
    this.scene.fog = new THREE.Fog(0xffd493, 120, 320);
  }

  /**
   * Small HUD badge showing the round seed. Click to copy a shareable URL.
   */
  initSeedBadge() {
    const badge = document.createElement('div');
    badge.textContent = `SEED ${this.seed}`;
    badge.title = 'Click to copy a shareable link to this exact round';
    Object.assign(badge.style, {
      position: 'absolute',
      bottom: '8px',
      left: '8px',
      padding: '4px 8px',
      fontFamily: 'monospace',
      fontSize: '11px',
      letterSpacing: '0.5px',
      color: '#fff',
      background: 'rgba(20, 30, 20, 0.55)',
      borderRadius: '4px',
      cursor: 'pointer',
      zIndex: '30',
      userSelect: 'none',
    });
    badge.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}?seed=${encodeURIComponent(this.seed)}`;
      try {
        await navigator.clipboard.writeText(url);
        badge.textContent = 'LINK COPIED';
        setTimeout(() => { badge.textContent = `SEED ${this.seed}`; }, 1200);
      } catch {
        window.prompt('Copy this link:', url);
      }
    });
    const container = document.getElementById('game-container') || document.body;
    container.appendChild(badge);
    this.seedBadge = badge;
  }

  /**
   * Initialize game objects: load hole 1, then create the one-time objects
   * (ball, arrows, camera rig, minimap) that persist across holes.
   */
  initGameObjects() {
    if (window.DEBUG) console.log("Initializing game objects");

    this.loadHole(1);

    // Create golf ball — physics randomness comes from the round seed
    this.ball = new GolfBall(this.terrain, this.audioManager);
    this.ball.setRng(this.gameRng.fork('ball').rng);
    this.scene.add(this.ball.getMesh());
    this.ball.reset(this.terrain.teePosition);

    // Create ArrowHelper for shot direction
    const arrowDir = new THREE.Vector3(0, 0.2, -1).normalize();
    const arrowLength = 1.2;
    const arrowColor = 0xffd700; // Gold
    this.shotArrow = new THREE.ArrowHelper(arrowDir, new THREE.Vector3(0, 0, 0), arrowLength, arrowColor, 0.25, 0.15);
    this.shotArrow.visible = false;
    this.scene.add(this.shotArrow);

    // Initialize camera controller with ball as target
    this.cameraController = new CameraController(this.camera, this.ball, { terrain: this.terrain });
    this.cameraController.game = this;

    // Face the camera toward the opening shot's intended line.
    this.cameraController.faceHole(this.getAimTarget(this.terrain.teePosition), this.terrain.teePosition);

    // Create direction arrow UI
    this.createDirectionArrow();

    // Create the overhead minimap (canvas HUD)
    const mmContainer = document.getElementById('game-container') || document.body;
    this.minimap = new Minimap(mmContainer, this);

    if (window.DEBUG) console.log("Game objects initialized successfully");
  }

  /**
   * Design and load hole N of the round: dispose the old hole's meshes,
   * generate terrain/water/flag/trees from the seed, rewire dependents.
   */
  loadHole(n) {
    this.holeNumber = n;

    // --- Dispose previous hole ---
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      if (this.terrain.surfaceMaterials) {
        Object.values(this.terrain.surfaceMaterials).forEach(m => m.dispose());
      }
    }
    if (this.terrain?.waterMesh) {
      this.scene.remove(this.terrain.waterMesh);
      this.terrain.waterMesh.geometry.dispose();
      this.terrain.waterMesh.material.dispose();
    }
    if (this.flag) {
      this.scene.remove(this.flag);
      this.flag.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    if (this.treesGroup) {
      this.scene.remove(this.treesGroup);
      this.treesGroup.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }

    // --- Design + build the new hole (deterministic from round seed) ---
    const spec = designHole(this.seed, n);
    this.holeSpec = spec;
    if (window.DEBUG) console.log(`[loadHole] #${n}: ${spec.archetype} par ${spec.par}, fitness`, spec.fitness);

    this.terrain = new TerrainGenerator({
      width: 400,
      length: 400,
      maxHeight: 5,
      minHeight: -1,
      segmentsW: 64,
      segmentsL: 64,
      waterLevel: -0.8,
      seed: `${this.seed}:hole-${n}`,
      holeNumber: n,
      holeSpec: spec,
    });

    this.terrainMesh = this.terrain.generateTerrain();
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    this.terrain.createWaterSurface(this.scene);
    this.flag = this.terrain.createFlag(this.scene);

    // Parkland trees (2 instanced draw calls) + trunk colliders for physics
    const treeResult = createTrees(spec, this.terrain, this.scene);
    this.treesGroup = treeResult.group;
    this.terrain.treeColliders = treeResult.colliders;

    this.par = spec.par;
    this.strokes = 0;

    // --- Rewire dependents to the new terrain ---
    if (this.ball) {
      this.ball.terrain = this.terrain;
      this.ball.reset(this.terrain.teePosition);
    }
    if (this.cameraController) {
      this.cameraController.terrain = this.terrain;
      this.cameraController.faceHole(this.getAimTarget(this.terrain.teePosition), this.terrain.teePosition);
    }
    this.updateHoleBadge();
    this.renderDirty = true;
  }

  /**
   * Where the player should aim from ballPos: the next path waypoint ahead,
   * so doglegs aim at the corner instead of through the trees.
   */
  getAimTarget(ballPos) {
    const path = this.terrain?.spec?.path;
    if (!path || path.length < 2) return this.terrain?.holePosition;
    const info = this.terrain.fairwayInfo(ballPos.x, ballPos.z);
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
      walked += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      if (walked > info.along + 15) {
        const y = this.terrain.getHeightAtPosition(path[i].x, path[i].z);
        return new THREE.Vector3(path[i].x, y, path[i].z);
      }
    }
    return this.terrain.holePosition;
  }

  /**
   * Advance after a hole is sunk: next hole, or a fresh round on a new seed.
   */
  advanceHole() {
    this.roundScores.push({ hole: this.holeNumber, par: this.par, strokes: this.strokes });

    if (this.holeNumber < this.roundLength) {
      this.loadHole(this.holeNumber + 1);
      this.setGameState('READY_TO_HIT');
    } else {
      // Round complete — show the card, then start a fresh round on a new seed
      const total = this.roundScores.reduce((s, h) => s + (h.strokes - h.par), 0);
      const scoreText = total === 0 ? 'E' : (total > 0 ? `+${total}` : `${total}`);
      const card = this.roundScores.map(h => `#${h.hole}: ${h.strokes} (par ${h.par})`).join(' · ');
      this.ui?.showMessage(`ROUND COMPLETE — ${scoreText}`, card, 'A new course is being grown for you…', 5000);
      setTimeout(() => {
        this.seed = generateSeed();
        this.gameRng = createGameRng(this.seed);
        this.fxRng = this.gameRng.fork('fx').rng;
        this.ball?.setRng(this.gameRng.fork('ball').rng);
        this.roundScores = [];
        this.score = 0;
        this.ui?.updateScore(0);
        if (this.seedBadge) this.seedBadge.textContent = `SEED ${this.seed}`;
        this.loadHole(1);
        this.setGameState('READY_TO_HIT');
      }, 5000);
    }
  }

  /**
   * Top-center badge: hole number, par, archetype (the hole's identity).
   */
  updateHoleBadge() {
    if (!this.holeBadge) {
      const badge = document.createElement('div');
      Object.assign(badge.style, {
        position: 'absolute',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 14px',
        fontFamily: 'Lato, sans-serif',
        fontSize: '15px',
        fontWeight: 'bold',
        letterSpacing: '1px',
        color: '#fff8ec',
        background: 'rgba(20, 30, 20, 0.55)',
        borderRadius: '6px',
        zIndex: '30',
        userSelect: 'none',
        pointerEvents: 'none',
        textShadow: '1px 1px 2px rgba(0,0,0,0.4)',
      });
      (document.getElementById('game-container') || document.body).appendChild(badge);
      this.holeBadge = badge;
    }
    const spec = this.holeSpec;
    const arch = ARCHETYPES[spec.archetype]?.label || spec.archetype;
    this.holeBadge.textContent = `HOLE ${spec.number}/${this.roundLength} · PAR ${spec.par} · ${arch}`;
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

    // Mouse Wheel for fine trajectory height (loft trim). Clubs stay on the
    // arrow keys so scroll does one thing: higher/lower flight.
    window.addEventListener('wheel', (e) => {
      if (this.gameState === 'AIMING') {
        // Determine scroll direction (normalize across browsers)
        const delta = Math.sign(e.deltaY);
        this.adjustLoftTrim(-delta); // Scroll up = higher flight, down = lower
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
      case ' ': // Space bar — 3-click swing: start, set power, strike
        if (this.gameState === 'AIMING') {
          if (this.swing.phase === 'idle') this.startSwing();
        } else if (this.gameState === 'HITTING') {
          this.advanceSwing();
        }
        break;
      case 'escape': // Cancel an in-progress swing
        this.cancelSwing();
        break;
      case 'h': // Help overlay (re-open; initial show is handled in init)
        if (this.ui && !this.ui.isInstructionsVisible) {
          this.ui.showInstructions();
          this.isPaused = true;
          document.addEventListener('instructionsDismissed', () => {
            this.isPaused = false;
          }, { once: true });
        }
        break;
      case 'r': // Reset ball
        this.resetBall();
        this.setGameState('AIMING');
        break;
      case 'c': // Toggle camera mode
        this.toggleCameraMode();
        break;
      case 'arrowup': // Longer club
        this.cycleClub(-1);
        break;
      case 'arrowdown': // Shorter club
        this.cycleClub(1);
        break;
      case 'v': // Cycle shot variant (full / punch / flop / chip)
        this.cycleVariant();
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
      this.startSwing();
    } else if (this.gameState === 'HITTING') {
      this.advanceSwing();
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
      
      // Check if ball has entered the hole -> begin the sink animation
      if (this.terrain && this.terrain.checkBallInHole && this.terrain.checkBallInHole(this.ball)) {
        this.startSink();
      }
    }

    // Drive the sink animation: move the ball into the cup, then complete.
    if (this.gameState === 'SINKING') {
      TWEEN.update();
      this.renderDirty = true;
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
            this.ball.velocity.x += (this.fxRng() - 0.5) * 0.02;
            this.ball.velocity.z += (this.fxRng() - 0.5) * 0.02;
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

    // Update the overhead minimap (course layout + live shot prediction)
    this.updateMinimap();
    
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
    
    // Check if ball has stopped after being hit.
    // Don't transition away if the ball is resting over the hole — let
    // checkBallInHole (in the WATCHING branch above) claim it and start the
    // sink instead. This prevents a slow roller from resting on the lip and
    // skipping the hole completion.
    if (this.gameState === 'WATCHING' && this.ball.isResting) {
      const overHole = this.terrain && this.terrain.hole &&
        Math.hypot(this.ball.position.x - this.terrain.hole.x,
                    this.ball.position.z - this.terrain.hole.z) < this.terrain.hole.radius + 0.05;
      if (!overHole) {
        // Water hazard rule: ball at rest in water = +1 penalty, replay the shot
        const surface = this.terrain?.getSurfaceTypeAtPosition?.(this.ball.position.x, this.ball.position.z);
        const inWater = surface === 'water' || this.ball.position.y < this.terrain.options.waterLevel;
        if (inWater) {
          this.strokes += 1;
          this.ui?.updateStrokes(this.strokes);
          this.ui?.showMessage('WATER HAZARD', '+1 penalty stroke', '', 2500);
          this.ball.reset(this.ball.lastSafePosition);
        }
        if (window.DEBUG) console.log("Ball has come to rest");
        this.cameraController.followBall();
        this.setGameState('CAMERA_TRANSITION');
        this.cameraTransitionTime = 0;
      }
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

    // Update the 3-click swing meter
    this.updateSwingMeter();
    // NOTE: hole-in detection is handled in the WATCHING branch above via
    // terrain.checkBallInHole() -> handleHoleComplete(), which is guarded to
    // fire once. Do not add a second detection path here.
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
   * Advance the 3-click swing meter (power up-sweep, accuracy down-sweep).
   * Auto-locks power at 100 and auto-hits (max late) at the strike floor.
   */
  updateSwingMeter() {
    if (this.swing.phase === 'idle') return;

    // Clamp the step: a frame hitch (tab switch, slow frame) must slow the
    // marker, never jump it — big dt could otherwise skip past the strike
    // line or even auto-fire the hit.
    const dt = Math.min(this.deltaTime, 0.05);
    const event = swingStep(this.swing, dt);
    this.ui.updateSwingMeter(this.swing);
    this.renderDirty = true;

    if (!event) return;
    if (event.type === 'powerLocked') {
      this.ui.setSwingPhase('accuracy');
    } else if (event.type === 'strike') {
      this.executeSwingHit(event.timing);
    }
  }

  /**
   * Begin the swing (click 1): the marker sweeps up for power.
   */
  startSwing() {
    if (this.swing.phase !== 'idle') return;

    startSwing(this.swing);
    this.setGameState('HITTING');
    this.ui.showSwingMeter();
    this.ui.setSwingPhase('power');

    if (window.DEBUG) console.log("Swing started - click to set power");
  }

  /**
   * A swing click: click 2 locks power, click 3 strikes the ball.
   */
  advanceSwing() {
    const event = swingClick(this.swing);
    if (!event) return;

    if (event.type === 'powerLocked') {
      this.ui.setSwingPhase('accuracy');
      this.ui.updateSwingMeter(this.swing);
      this.renderDirty = true;
    } else if (event.type === 'strike') {
      this.executeSwingHit(event.timing);
    }
  }

  /**
   * Cancel an in-progress swing (Escape) and return to aiming.
   */
  cancelSwing() {
    if (this.gameState !== 'HITTING' || this.swing.phase === 'idle') return;
    this.swing.phase = 'idle';
    this.ui.hideSwingMeter();
    this.setGameState('AIMING');
    if (this.ui.showReadyIndicator) this.ui.showReadyIndicator();
    if (window.DEBUG) console.log("Swing cancelled");
  }

  /**
   * Debug/replay hook (window.THREEWOOD.debugSwing): execute a full swing
   * with exact inputs from AIMING. timing: + = early/pull, - = late/push.
   */
  debugSwing(power, timing = 0) {
    if (this.gameState !== 'AIMING' || !this.ball || !this.ball.isResting) return false;
    this.swing.power = Math.max(2, Math.min(100, power));
    this.executeSwingHit(timing);
    return true;
  }

  /**
   * Strike the ball with the locked power and a signed timing error.
   * @param {number} timing -1..1 (+ early/pull, - late/push) from the meter
   */
  executeSwingHit(timing) {
    // Play swing sound before hitting
    this.audioManager.playSwingSound();

    // Compute the strike outcome (mishit model) from the seeded ball stream
    const strike = strikeFromTiming(timing, this.currentLoft, this.ball.rng);
    this.lastStrike = strike;

    if (window.DEBUG) {
      console.log(`Strike: power ${this.swing.power.toFixed(1)}, timing ${timing.toFixed(3)} ->`,
        describeStrike(strike), strike);
    }

    // Get current power and direction
    let power = this.swing.power;
    
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
    
    // Hit the ball using the horizontal direction, loft angle, sidespin, the
    // strike outcome (mishit yaw / thin-fat launch changes), and the club's
    // launch profile (max ball speed + spin shaping) — plus the lie, which
    // bleeds speed/spin and twists the club in rough and sand
    const shot = {
      maxSpeed: this.currentMaxSpeed,
      spinFactor: VARIANTS[this.currentVariant].spinFactor,
      lie: getLieAt(this.terrain, this.ball.position),
    };
    this.ball.hit(power, direction, loft, sidespin, strike, shot);

    // Strike feedback on the meter ("PURE!", "PULL · THIN", ...)
    this.ui.showStrikeFeedback(describeStrike(strike), strike.grade);
    
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

    // Reset the swing
    this.swing.phase = 'idle';
    this.ui.hideSwingMeter();
    
    // Change camera mode to watch the ball
    this.cameraController.watchBallInFlight();
    
    // Change game state
    this.setGameState('WATCHING');
    
    // Update UI
    this.ui.updateStrokes(this.strokes);
  }

  /**
   * Begin the sink animation: tween the ball from its current position down
   * into the cup, then fire hole-complete. The ball physics loop can't do this
   * (it early-returns when isResting and the state would stop calling it), so
   * the Game drives the sink directly via ball.sinkTo().
   */
  startSink() {
    if (!this.terrain || !this.terrain.hole) return;
    const hole = this.terrain.hole;
    const ballRadius = this.ball.options.radius;

    // Capture the ball's current position and snap horizontally to hole center.
    const start = {
      x: this.ball.position.x,
      y: this.ball.position.y,
      z: this.ball.position.z,
    };
    // End: centered in the cup, resting on the cup floor.
    const end = {
      x: hole.x,
      y: hole.bottomY + ballRadius, // ball sits on the cup floor
      z: hole.z,
    };

    this.setGameState('SINKING');

    // Keep existing tweens from piling up if startSink fires twice.
    if (this._sinkTween) this._sinkTween.stop();

    // NOTE: second arg `true` adds the tween to the mainGroup — without it
    // TWEEN.update() never advances this tween (sink would hang in SINKING).
    this._sinkTween = new TWEEN.Tween(start, true)
      .to(end, 600)
      .easing(TWEEN.Easing.Quadratic.In)
      .onUpdate(() => {
        this.ball.sinkTo(new THREE.Vector3(start.x, start.y, start.z));
      })
      .onComplete(() => {
        this._sinkTween = null;
        this.handleHoleComplete();
      })
      .start();
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

      // Aim the camera at the hole (faceHole uses the correct atan2 convention
      // for the aim vector (cos θ, 0, sin θ)).
      this.cameraController.faceHole(holePos, ballPos);
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
    this.swing.phase = 'idle';
    if (this.ui) {
      this.ui.hideSwingMeter();
      this.ui.showReadyIndicator();
    }
  }

  // Hole-in detection is handled in update()'s WATCHING branch via
  // terrain.checkBallInHole(this.ball) -> this.handleHoleComplete().
  // That path is guarded to fire once; no separate checkBallInHole here.
  
  /**
   * Set the game state
   */
  /** Current game state name (delegates to the state machine). */
  get gameState() {
    return this.fsm.state;
  }

  /**
   * Declare every legal state and its enter hook. Replaces the old
   * string-switch; unknown states now throw instead of silently no-op'ing.
   */
  createStateMachine() {
    return new StateMachine({
      TITLE: {},
      READY_TO_HIT: {
        enter: (previousState) => {
          // Reset any lingering state from previous gameplay
          if (previousState === 'HOLE_COMPLETE') {
            if (window.DEBUG) console.log('Transitioning from HOLE_COMPLETE to READY_TO_HIT');
            if (this.ball && this.ball.velocity) {
              this.ball.velocity.set(0, 0, 0);
              this.ball.isResting = true;
            }
          }
          // Immediately transition to aiming
          this.setGameState('AIMING');
        }
      },
      AIMING: {
        enter: (previousState) => {
          // Aim at the next path waypoint ahead (dogleg corner, not through
          // the trees) so the intended line is readable from every lie.
          if (this.cameraController && this.terrain && this.ball) {
            this.cameraController.faceHole(this.getAimTarget(this.ball.position), this.ball.position);
          }
          this.cameraController?.setMode(this.cameraController.MODES.AIMING);
          if (window.DEBUG) console.log("Player can now aim/adjust club");

          // Auto club selection on a new lie (skipped when we arrived here by
          // cancelling a swing — keep the player's manual choice then).
          // Lie-aware: rough/sand penalties call for more club.
          if (previousState !== 'HITTING' && this.terrain?.holePosition && this.ball) {
            const distToPin = Math.hypot(
              this.ball.position.x - this.terrain.holePosition.x,
              this.ball.position.z - this.terrain.holePosition.z
            );
            const lie = getLieAt(this.terrain, this.ball.position);
            this.selectClub(autoSelectClub(distToPin, lie.id === 'green', lie));
          }

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
        }
      },
      HITTING: {
        enter: () => {
          if (window.DEBUG) console.log("Power meter active");
          if (this.shotArrow) this.shotArrow.visible = false;
        }
      },
      WATCHING: {
        enter: () => {
          if (window.DEBUG) console.log("Ball in motion");
          if (this.shotArrow) this.shotArrow.visible = false;
          try {
            if (this.ui && this.ui.hideSpinIndicator) {
              this.ui.hideSpinIndicator();
            }
          } catch (e) {
            console.warn("Could not hide spin indicator:", e);
          }
        }
      },
      CAMERA_TRANSITION: {
        enter: () => {
          if (window.DEBUG) console.log("Camera transitioning to aiming position");
          if (this.ui && this.ui.showTransitionIndicator) {
            this.ui.showTransitionIndicator();
          }
        }
      },
      SINKING: {},
      HOLE_COMPLETE: {},
    }, {
      onTransition: (prev, next) => {
        if (window.DEBUG) console.log(`Game state changing from ${prev} to ${next}`);
        this.renderDirty = true;
      }
    });
  }

  /**
   * Change the current game state (delegates to the state machine).
   */
  setGameState(state) {
    this.fsm.set(state);
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
                          this.gameState === 'SINKING' ||
                          this.gameState === 'CAMERA_TRANSITION' ||
                          (this.gameState === 'HITTING' && this.swing.phase !== 'idle');
                          
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

  /** Current club object from the bag. */
  get currentClub() {
    return CLUBS[this.clubIndex];
  }

  /** Current shot variant id ('full' | 'punch' | 'flop' | 'chip'). */
  get currentVariant() {
    const club = this.currentClub;
    return club.variants[this.variantIndex] || 'full';
  }

  /** Effective launch loft in degrees (club + variant + wheel trim). */
  get currentLoft() {
    const base = effectiveLoft(this.currentClub, this.currentVariant);
    return Math.max(1, Math.min(64, base + this.loftTrim));
  }

  /** Ball speed at 100% power for the current club + variant. */
  get currentMaxSpeed() {
    return launchSpeed(this.currentClub, this.currentVariant);
  }

  /**
   * Cycle the club selection (up-down arrows). +1 = shorter club.
   */
  cycleClub(direction) {
    if (this.gameState !== 'AIMING') return;
    this.renderDirty = true;

    const n = CLUBS.length;
    this.clubIndex = ((this.clubIndex + direction) % n + n) % n;
    // Keep the variant valid for the new club
    if (this.variantIndex >= this.currentClub.variants.length) {
      this.variantIndex = 0;
    }
    this.loftTrim = 0; // New club, fresh trajectory
    this.updateClubDisplay();
  }

  /**
   * Cycle the shot variant for the current club (V key).
   */
  cycleVariant() {
    if (this.gameState !== 'AIMING') return;
    this.renderDirty = true;

    const variants = this.currentClub.variants;
    this.variantIndex = (this.variantIndex + 1) % variants.length;
    this.loftTrim = 0; // New shot type, fresh trajectory
    this.updateClubDisplay();
  }

  /**
   * Fine trajectory height on the mouse wheel: ±0.5° per notch, clamped to
   * ±8° around the club + variant loft. Scroll up = higher, down = lower.
   */
  adjustLoftTrim(direction) {
    if (this.gameState !== 'AIMING') return;
    this.renderDirty = true;

    const next = this.loftTrim + direction * 0.5;
    this.loftTrim = Math.max(-8, Math.min(8, next));
    this.updateClubDisplay();
  }

  /**
   * Select a club by id (auto club selection on a new lie).
   */
  selectClub(clubId) {
    const index = CLUBS.findIndex(c => c.id === clubId);
    if (index === -1) return;
    this.clubIndex = index;
    this.variantIndex = 0;
    this.loftTrim = 0;
    this.updateClubDisplay();
  }

  /** Lie under the ball right now (fairway fallback when terrain is gone). */
  get currentLie() {
    return this.terrain && this.ball
      ? getLieAt(this.terrain, this.ball.position)
      : null;
  }

  /**
   * Push the current club/variant/distance estimate to the HUD. The yardage
   * is lie-adjusted — from the rough the book honestly says you get less.
   */
  updateClubDisplay() {
    if (!this.ui) return;
    const club = this.currentClub;
    const variant = this.currentVariant;
    const lie = this.currentLie;
    this.ui.updateClubDisplay({
      clubName: club.name,
      variantName: VARIANTS[variant].name,
      loft: this.currentLoft,
      loftTrim: this.loftTrim,
      distance: estimateDistance(club, variant, lie),
      lieText: lie ? describeLie(lie) : null,
    });
  }

  /**
   * Reset an in-progress swing
   * Called when closing spin selector or other cases where we need
   * to cancel any accidental swing activation
   */
  resetPowerMeterState() {
    if (this.gameState === 'HITTING' && !this.ball.isMoving) {
      this.cancelSwing();
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

  /**
   * Update the overhead minimap. Visible whenever the player can act or is
   * watching a shot; draws the live predicted arc only while aiming.
   */
  updateMinimap() {
    if (!this.minimap || !this.ball || !this.terrain) return;

    const aimable = ['READY_TO_HIT', 'AIMING', 'HITTING'].includes(this.gameState);
    const showMap = aimable || this.gameState === 'WATCHING' || this.gameState === 'SINKING';
    this.minimap.setVisible(showMap);

    if (!showMap) return;

    // Aim direction: prefer the camera->ball shot direction computed during
    // AIMING; fall back to the camera controller's aim vector.
    let aimDir = null;
    if (this.currentShotDirection && this.currentShotDirection.horizontal) {
      aimDir = this.currentShotDirection.horizontal;
    } else if (this.cameraController) {
      aimDir = this.cameraController.getAimDirection();
    }

    // The predicted arc respects the lie: a flyer from the rough flies shorter
    const lieFactor = this.currentLie ? this.currentLie.speedFactor : 1;
    this.minimap.update({
      ball: this.ball.position,
      aimDir,
      loft: this.currentLoft,
      maxSpeed: this.currentMaxSpeed * lieFactor,
      power: this.swing.phase === 'power' ? this.swing.marker
        : this.swing.phase === 'accuracy' ? this.swing.power : 60,
      showShot: this.gameState === 'AIMING' || this.gameState === 'HITTING',
    });
  }
}

// Add the handleHoleComplete method to the Game class prototype
Game.prototype.handleHoleComplete = handleHoleComplete;

export default Game;
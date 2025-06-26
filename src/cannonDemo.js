/**
 * Cannon-ES Physics Demo
 * This file demonstrates how to use the cannon-es physics engine with ThreeWood
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import PhysicsManager from './physics.js';
import CannonGolfBall from './cannonBall.js';
import TerrainGenerator from './terrain.js';

class CannonDemo {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.physicsManager = null;
    this.terrain = null;
    this.ball = null;
    this.clock = new THREE.Clock();
    
    this.init();
  }
  
  /**
   * Initialize the demo
   */
  init() {
    // Create THREE.js scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    
    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 1000
    );
    
    // Camera will be positioned properly after terrain and ball are created
    
    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    document.body.appendChild(this.renderer.domElement);
    
    // Create physics manager with debug mode
    this.physicsManager = new PhysicsManager({
      gravity: -9.82,
      substeps: 10  // Increased substeps for better physics stability
    });
    
    // Debug flags
    this.debugMode = true;
    this.debugPhysics = true;
    
    // Create terrain
    this.createTerrain();
    
    // Create grid helper for visual reference
    const gridHelper = new THREE.GridHelper(100, 20, 0x000000, 0x444444);
    this.scene.add(gridHelper);
    
    // Create axes helper
    const axesHelper = new THREE.AxesHelper(5);
    this.scene.add(axesHelper);
    
    // Create golf ball
    this.createBall();
    
    // Now position camera relative to the ball
    this.initializeCamera();
    
    // Add lighting
    this.addLighting();
    
    // Add input handlers
    this.addInputHandlers();
    
    // Create UI elements
    this.createUI();
    
    // Add debug overlay
    if (this.debugMode) {
      this.createDebugOverlay();
    }
    
    // Start animation loop
    this.animate();
    
    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
    
    console.log('Demo initialized');
  }
  
  /**
   * Initialize camera position relative to ball
   */
  initializeCamera() {
    if (!this.ball) {
      console.error("Ball must be created before initializing camera");
      return;
    }
    
    const ballPos = this.ball.position;
    
    // Position camera behind and above the ball
    this.camera.position.set(
      ballPos.x - 5, // Behind the ball
      ballPos.y + 3, // Above the ball
      ballPos.z + 8  // Offset to the side
    );
    
    // Look at the ball
    this.camera.lookAt(ballPos);
    
    // Store initial offset for camera follow
    this.cameraOffset = new THREE.Vector3().subVectors(
      this.camera.position,
      ballPos
    );
    
    // Set initial camera target
    this.camera.target = ballPos.clone();
    
    console.log(`Camera initialized at position: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
  }
  
  /**
   * Create terrain
   */
  createTerrain() {
    // Create terrain generator with flatter terrain
    const terrainGenerator = new TerrainGenerator({
      width: 100,
      length: 100,
      maxHeight: 3,       // Reduced from 5 for flatter terrain
      minHeight: -1,      // Changed from -2 for less extreme valleys
      noiseScale: 0.2,    // Increased from 0.1 for smoother terrain
      flattenStrength: 0.8, // Increased from 0.5 for more flat areas
      waterHeight: -0.5   // Raised water level
    });
    
    // Generate terrain mesh
    const terrainMesh = terrainGenerator.generateTerrain();
    this.scene.add(terrainMesh);
    this.terrain = terrainGenerator;
    
    // Create physics representation of the terrain
    const terrainBody = this.physicsManager.createTerrainFromMesh(terrainMesh, {
      width: 100,
      depth: 100,
      sizeX: 64,
      sizeZ: 64
    });
    
    // Add terrain body to physics world
    this.physicsManager.world.addBody(terrainBody);
    
    // Add ground regions
    // Add green around the hole
    const holePosition = terrainGenerator.getHolePosition();
    this.physicsManager.addTerrainRegion(
      terrainBody,
      {
        minX: holePosition.x - 5,
        maxX: holePosition.x + 5,
        minZ: holePosition.z - 5,
        maxZ: holePosition.z + 5
      },
      'green'
    );
    
    // Add sand bunkers
    const bunkerPositions = [
      { x: 10, z: 15, radius: 3 },
      { x: -5, z: 8, radius: 4 }
    ];
    
    for (const bunker of bunkerPositions) {
      this.physicsManager.addTerrainRegion(
        terrainBody,
        {
          minX: bunker.x - bunker.radius,
          maxX: bunker.x + bunker.radius,
          minZ: bunker.z - bunker.radius,
          maxZ: bunker.z + bunker.radius
        },
        'bunker'
      );
    }
    
    // Add a hole marker
    const holeMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.5, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    holeMarker.position.set(holePosition.x, holePosition.y + 1, holePosition.z);
    this.scene.add(holeMarker);
    
    // Add a flag
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8),
      new THREE.MeshBasicMaterial({ color: 0x333333 })
    );
    flagPole.position.set(0, 0.6, 0);
    
    const flagMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      side: THREE.DoubleSide
    });
    const flagGeometry = new THREE.PlaneGeometry(0.4, 0.3);
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(0.2, 1.0, 0);
    flag.rotation.y = Math.PI / 2;
    
    const flagGroup = new THREE.Group();
    flagGroup.add(flagPole);
    flagGroup.add(flag);
    flagGroup.position.set(holePosition.x, holePosition.y, holePosition.z);
    this.scene.add(flagGroup);
  }
  
  /**
   * Create golf ball
   */
  createBall() {
    // Get tee position
    const teePosition = this.terrain.getTeePosition();
    
    // Before creating the ball, make sure the terrain height is valid
    // by directly sampling the height at tee position
    let terrainHeight = this.terrain.getHeightAtPosition(teePosition.x, teePosition.z);
    
    // If terrain height is invalid, use teePosition.y
    if (isNaN(terrainHeight) || terrainHeight < -10) {
      console.warn("Invalid terrain height at tee position, using default value");
      terrainHeight = teePosition.y;
    }
    
    // Make sure we have the physics representation of the terrain
    const physicsTerrainHeight = this.physicsManager.getTerrainHeightAtPosition(teePosition.x, teePosition.z);
    
    // Log the heights to debug the issue
    console.log(`Visual terrain height: ${terrainHeight}, Physics terrain height: ${physicsTerrainHeight}`);
    
    // We'll use visual terrain height and add a significant offset to ensure
    // the ball stays above the terrain
    const heightOffset = 0.5; // Increased from 0.2 to 0.5 for more clearance
    
    // Create ball at tee position with higher clearance
    const ballPosition = new THREE.Vector3(
      teePosition.x,
      terrainHeight + heightOffset, // Use visual terrain height with larger offset
      teePosition.z
    );
    
    // Add a smaller, more translucent debug sphere to visualize tee position
    const debugSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 16), // Smaller sphere
      new THREE.MeshBasicMaterial({ 
        color: 0xff0000, 
        wireframe: true,
        transparent: true,
        opacity: 0.3 // More translucent
      })
    );
    debugSphere.position.copy(teePosition);
    this.scene.add(debugSphere);
    
    console.log(`Creating ball at position: (${ballPosition.x}, ${ballPosition.y}, ${ballPosition.z})`);
    console.log(`Visual terrain height: ${terrainHeight}, Using offset: ${heightOffset}`);
    
    // Create ball with better physics properties
    this.ball = new CannonGolfBall(this.physicsManager, this.terrain, {
      radius: 0.05, // Good size for visibility and physics stability
      color: 0xffffff,
      mass: 0.1, // Slightly heavier for more stable physics
      linearDamping: 0.1, // Lower damping for better movement
      angularDamping: 0.1, // Lower damping for better rotation
      restitution: 0.5, // More realistic bounce
      debug: false // Don't enable debug visualization by default
    });
    
    // Reset to tee position and ensure ball is awake
    this.ball.reset(ballPosition);
    this.ball.body.wakeUp();
    
    // Add ball mesh to scene
    this.scene.add(this.ball.getMesh());
    
    // Add debug helper if available, but make it less obtrusive
    if (this.ball.debugHelper) {
      this.ball.debugHelper.material.opacity = 0.2; // Make it more transparent
      this.scene.add(this.ball.debugHelper);
    }
  }
  
  /**
   * Add lighting to the scene
   */
  addLighting() {
    // Add ambient light
    const ambient = new THREE.AmbientLight(0x666666);
    this.scene.add(ambient);
    
    // Add directional light (sun)
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(10, 20, 10);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    directional.shadow.camera.left = -30;
    directional.shadow.camera.right = 30;
    directional.shadow.camera.top = 30;
    directional.shadow.camera.bottom = -30;
    directional.shadow.camera.far = 100;
    this.scene.add(directional);
  }
  
  /**
   * Add input handlers
   */
  addInputHandlers() {
    // Space to hit the ball
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        this.hitBall();
      }
    });
    
    // Mouse for camera control
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    
    document.addEventListener('mousedown', (event) => {
      isDragging = true;
      previousMousePosition = { x: event.clientX, y: event.clientY };
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    document.addEventListener('mousemove', (event) => {
      if (isDragging) {
        const deltaMove = {
          x: event.clientX - previousMousePosition.x,
          y: event.clientY - previousMousePosition.y
        };
        
        if (deltaMove.x !== 0 || deltaMove.y !== 0) {
          // Rotate camera around ball
          const ballPosition = this.ball.position;
          const cameraOffset = new THREE.Vector3().subVectors(
            this.camera.position, ballPosition
          );
          
          // Rotate horizontally
          const horizontalRotation = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -deltaMove.x * 0.01
          );
          cameraOffset.applyQuaternion(horizontalRotation);
          
          // Rotate vertically (with limits)
          const verticalAxis = new THREE.Vector3().crossVectors(
            cameraOffset, new THREE.Vector3(0, 1, 0)
          ).normalize();
          const verticalRotation = new THREE.Quaternion().setFromAxisAngle(
            verticalAxis,
            -deltaMove.y * 0.01
          );
          
          // Apply rotation
          cameraOffset.applyQuaternion(verticalRotation);
          
          // Update camera position
          this.camera.position.copy(ballPosition).add(cameraOffset);
          this.camera.lookAt(ballPosition);
        }
        
        previousMousePosition = { x: event.clientX, y: event.clientY };
      }
    });
  }
  
  /**
   * Create UI elements
   */
  createUI() {
    // Create a simple power meter (just a div for now)
    const powerMeterContainer = document.createElement('div');
    powerMeterContainer.id = 'power-meter-container';
    powerMeterContainer.style.position = 'absolute';
    powerMeterContainer.style.bottom = '20px';
    powerMeterContainer.style.left = '50%';
    powerMeterContainer.style.transform = 'translateX(-50%)';
    powerMeterContainer.style.width = '300px';
    powerMeterContainer.style.height = '20px';
    powerMeterContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    powerMeterContainer.style.border = '2px solid white';
    
    const powerFill = document.createElement('div');
    powerFill.id = 'power-fill';
    powerFill.style.width = '0%';
    powerFill.style.height = '100%';
    powerFill.style.backgroundColor = '#4CAF50';
    
    powerMeterContainer.appendChild(powerFill);
    document.body.appendChild(powerMeterContainer);
    
    // Store references
    this.powerMeterElement = powerMeterContainer;
    this.powerFillElement = powerFill;
    
    // Add instructions
    const instructions = document.createElement('div');
    instructions.style.position = 'absolute';
    instructions.style.top = '20px';
    instructions.style.left = '20px';
    instructions.style.color = 'white';
    instructions.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    instructions.style.padding = '10px';
    instructions.style.borderRadius = '5px';
    instructions.innerHTML = `
      <h3>Cannon-ES Physics Demo</h3>
      <ul>
        <li>Space: Hit ball</li>
        <li>Mouse: Drag to move camera</li>
      </ul>
    `;
    document.body.appendChild(instructions);
  }
  
  /**
   * Create debug overlay
   */
  createDebugOverlay() {
    const debugDiv = document.createElement('div');
    debugDiv.style.position = 'absolute';
    debugDiv.style.top = '80px';
    debugDiv.style.right = '20px';
    debugDiv.style.padding = '10px';
    debugDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    debugDiv.style.color = 'white';
    debugDiv.style.fontFamily = 'monospace';
    debugDiv.style.fontSize = '12px';
    debugDiv.style.borderRadius = '5px';
    debugDiv.style.zIndex = '100';
    debugDiv.style.maxWidth = '300px';
    debugDiv.style.maxHeight = '500px';
    debugDiv.style.overflow = 'auto';
    debugDiv.id = 'debug-overlay';
    document.body.appendChild(debugDiv);
    
    // Reset button
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset Ball';
    resetButton.style.display = 'block';
    resetButton.style.margin = '5px 0';
    resetButton.style.padding = '5px';
    resetButton.addEventListener('click', () => this.resetBall());
    debugDiv.appendChild(resetButton);
    
    // Toggle debug mode button
    const toggleDebugButton = document.createElement('button');
    toggleDebugButton.textContent = 'Toggle Debug Mode';
    toggleDebugButton.style.display = 'block';
    toggleDebugButton.style.margin = '5px 0';
    toggleDebugButton.style.padding = '5px';
    toggleDebugButton.addEventListener('click', () => {
      this.debugPhysics = !this.debugPhysics;
      toggleDebugButton.textContent = this.debugPhysics ? 'Hide Debug' : 'Show Debug';
    });
    debugDiv.appendChild(toggleDebugButton);
    
    // Apply force buttons with different directions
    const upButton = document.createElement('button');
    upButton.textContent = 'Apply Upward Force';
    upButton.style.display = 'block';
    upButton.style.margin = '5px 0';
    upButton.style.padding = '5px';
    upButton.addEventListener('click', () => {
      if (this.ball && this.ball.body) {
        // Apply a moderate upward force to the ball (not the camera)
        const force = new CANNON.Vec3(0, 5, 0);
        this.ball.body.applyImpulse(force, this.ball.body.position);
        // Wake up the ball if it was sleeping
        this.ball.body.wakeUp();
      }
    });
    debugDiv.appendChild(upButton);
    
    // Forward force button
    const forwardButton = document.createElement('button');
    forwardButton.textContent = 'Apply Forward Force';
    forwardButton.style.display = 'block';
    forwardButton.style.margin = '5px 0';
    forwardButton.style.padding = '5px';
    forwardButton.addEventListener('click', () => {
      if (this.ball && this.ball.body) {
        // Apply a forward force (in the negative Z direction)
        const force = new CANNON.Vec3(0, 0.5, -3);
        this.ball.body.applyImpulse(force, this.ball.body.position);
        this.ball.body.wakeUp();
      }
    });
    debugDiv.appendChild(forwardButton);
    
    // Rolling force button
    const rollButton = document.createElement('button');
    rollButton.textContent = 'Apply Rolling Force';
    rollButton.style.display = 'block';
    rollButton.style.margin = '5px 0';
    rollButton.style.padding = '5px';
    rollButton.addEventListener('click', () => {
      if (this.ball && this.ball.body) {
        // Get terrain height at current position
        const terrainHeight = this.terrain.getHeightAtPosition(
          this.ball.position.x, 
          this.ball.position.z
        );
        
        // Only apply force if the ball is near the ground
        const heightAboveTerrain = this.ball.position.y - terrainHeight;
        if (heightAboveTerrain < this.ball.options.radius * 2) {
          // Apply a horizontal force with slight upward component
          const force = new CANNON.Vec3(1, 0.1, -1);
          force.normalize();
          force.scale(2, force); // Scale to appropriate magnitude
          this.ball.body.applyImpulse(force, this.ball.body.position);
          this.ball.body.wakeUp();
        }
      }
    });
    debugDiv.appendChild(rollButton);
    
    this.debugOverlay = debugDiv;
  }
  
  /**
   * Update debug overlay
   */
  updateDebugOverlay() {
    if (!this.debugOverlay || !this.ball) return;
    
    // Create fresh content
    const ballPos = this.ball.position;
    const ballVel = this.ball.body.velocity;
    const terrainHeight = this.terrain.getHeightAtPosition(ballPos.x, ballPos.z);
    
    const infoDiv = document.createElement('div');
    infoDiv.innerHTML = `
      <div style="margin: 5px 0;">
        <strong>Ball Position:</strong> 
        <br>X: ${ballPos.x.toFixed(2)}, Y: ${ballPos.y.toFixed(2)}, Z: ${ballPos.z.toFixed(2)}
      </div>
      <div style="margin: 5px 0;">
        <strong>Ball Velocity:</strong> 
        <br>X: ${ballVel.x.toFixed(2)}, Y: ${ballVel.y.toFixed(2)}, Z: ${ballVel.z.toFixed(2)}
        <br>Speed: ${ballVel.length().toFixed(2)}
      </div>
      <div style="margin: 5px 0;">
        <strong>Terrain Height at Ball:</strong> ${terrainHeight.toFixed(2)}
      </div>
      <div style="margin: 5px 0;">
        <strong>Height Above Terrain:</strong> ${(ballPos.y - terrainHeight).toFixed(2)}
      </div>
      <div style="margin: 5px 0;">
        <strong>Ball Resting:</strong> ${this.ball.isResting ? 'Yes' : 'No'}
      </div>
    `;
    
    // Update the overlay content
    // Keep the buttons by replacing only the status div
    const statusDiv = this.debugOverlay.querySelector('#status-info');
    if (statusDiv) {
      statusDiv.remove();
    }
    infoDiv.id = 'status-info';
    this.debugOverlay.appendChild(infoDiv);
  }
  
  /**
   * Reset ball to tee position
   */
  resetBall() {
    if (!this.ball || !this.terrain) return;
    
    const teePosition = this.terrain.getTeePosition();
    
    // Get terrain height
    const terrainHeight = this.terrain.getHeightAtPosition(teePosition.x, teePosition.z);
    
    // Use a larger offset to ensure ball stays above terrain
    const heightOffset = 0.5;
    
    const ballPosition = new THREE.Vector3(
      teePosition.x,
      terrainHeight + heightOffset, // Increased offset
      teePosition.z
    );
    
    this.ball.reset(ballPosition);
    
    // Ensure the ball is awake and will respond to gravity
    this.ball.body.wakeUp();
    
    console.log(`Ball reset to position: (${ballPosition.x}, ${ballPosition.y}, ${ballPosition.z})`);
    console.log(`Using visual terrain height: ${terrainHeight} with offset: ${heightOffset}`);
  }
  
  /**
   * Hit the ball
   */
  hitBall() {
    // Calculate direction from camera to ball
    const direction = new THREE.Vector3();
    const ballPosition = this.ball.position;
    
    // Use camera direction as shot direction
    this.camera.getWorldDirection(direction);
    
    // Project direction onto XZ plane and normalize
    direction.y = 0;
    direction.normalize();
    
    // Generate random power between 50-80
    const power = 50 + Math.random() * 30;
    
    // Generate random loft between 10-30 degrees
    const loft = 10 + Math.random() * 20;
    
    // Generate random sidespin between -2 and 2
    const sidespin = Math.random() * 4 - 2;
    
    // Hit the ball
    this.ball.hit(power, direction, loft, sidespin);
    
    console.log(`Hit ball with power: ${power.toFixed(1)}, loft: ${loft.toFixed(1)}°, sidespin: ${sidespin.toFixed(2)}`);
  }
  
  /**
   * Handle window resize
   */
  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  /**
   * Animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());
    
    const deltaTime = Math.min(this.clock.getDelta(), 0.1); // Clamp deltaTime to avoid large jumps
    
    // Update debug overlay
    if (this.debugMode) {
      this.updateDebugOverlay();
    }
    
    // Update physics
    this.physicsManager.update(deltaTime);
    
    // Update ball and enforce visual terrain constraints
    if (this.ball) {
      this.ball.update(deltaTime);
      
      // Check if ball is below terrain and force correction
      const ballPos = this.ball.position;
      const terrainHeight = this.terrain.getHeightAtPosition(ballPos.x, ballPos.z);
      const minHeightAboveTerrain = this.ball.options.radius;
      
      // If ball is below terrain or too close to it, force correction
      if (ballPos.y < terrainHeight + minHeightAboveTerrain) {
        // Move the ball up to be properly positioned above the terrain
        this.ball.body.position.y = terrainHeight + minHeightAboveTerrain + 0.01;
        this.ball.position.y = this.ball.body.position.y;
        
        // Update the mesh position
        this.ball.mesh.position.y = this.ball.body.position.y;
        
        // Dampen vertical velocity if moving downward
        if (this.ball.body.velocity.y < 0) {
          // Apply bounce effect
          this.ball.body.velocity.y = Math.abs(this.ball.body.velocity.y) * 0.5;
        }
        
        // Log correction (but only for significant corrections to avoid spam)
        const correction = terrainHeight + minHeightAboveTerrain - ballPos.y;
        if (correction > 0.1) {
          console.log(`Corrected ball position, raised by ${correction.toFixed(2)} units`);
        }
      }
      
      // Auto-reset if ball falls too far
      if (this.ball.position.y < -20) {
        console.log("Ball fell too far, auto-resetting");
        this.resetBall();
      }
    }
    
    // Update camera to smoothly follow ball
    this.updateCamera(deltaTime);
    
    // Render scene
    this.renderer.render(this.scene, this.camera);
  }
  
  /**
   * Update camera to follow the ball with smoother motion
   */
  updateCamera(deltaTime) {
    if (!this.ball || !this.cameraOffset) return;
    
    const ballPosition = this.ball.position;
    
    // Smoothly update camera target with lower lerp factor for smoother following
    if (!this.camera.target) {
      this.camera.target = ballPosition.clone();
    } else {
      // Slower lerp factor (0.05 instead of 0.1) for smoother camera
      this.camera.target.lerp(ballPosition, 0.05);
    }
    
    // Calculate desired camera position by adding offset to target
    const desiredPosition = this.camera.target.clone().add(this.cameraOffset);
    
    // Smoothly move camera to desired position (slower lerp for smoother motion)
    this.camera.position.lerp(desiredPosition, 0.05);
    
    // Look at target
    this.camera.lookAt(this.camera.target);
  }
}

// Start the demo when the page loads
window.addEventListener('DOMContentLoaded', () => {
  new CannonDemo();
});

export default CannonDemo; 
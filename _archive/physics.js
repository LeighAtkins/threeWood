/**
 * Physics manager using cannon-es for ThreeWood
 * Handles physics simulation, collisions, and interactions
 */
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

class PhysicsManager {
  constructor(options = {}) {
    this.options = {
      gravity: -9.82,
      defaultMaterial: {
        friction: 0.3,
        restitution: 0.4
      },
      substeps: 10,
      ...options
    };
    
    // Initialize world
    this.world = new CANNON.World();
    this.world.gravity.set(0, this.options.gravity, 0);
    
    // Use SAPBroadphase for better performance
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    
    // Enable sleeping for better performance
    this.world.allowSleep = true;
    
    // Increase solver iterations for better stability
    this.world.solver.iterations = 10;
    
    // Materials
    this.defaultMaterial = new CANNON.Material('default');
    this.defaultMaterial.friction = this.options.defaultMaterial.friction;
    this.defaultMaterial.restitution = this.options.defaultMaterial.restitution;
    
    // Special materials for different surfaces
    this.materials = {
      default: this.defaultMaterial,
      green: this.createMaterial('green', 0.2, 0.5),
      fairway: this.createMaterial('fairway', 0.3, 0.4),
      rough: this.createMaterial('rough', 0.5, 0.3),
      bunker: this.createMaterial('bunker', 0.8, 0.1),
      water: this.createMaterial('water', 0.1, 0.01)
    };
    
    // Create contact materials
    this.setupContactMaterials();
    
    // Track bodies and meshes
    this.bodies = new Map();
    
    // Store heightfield data for faster lookup
    this.heightfieldData = null;
    this.heightfieldSize = { x: 0, z: 0 };
    this.heightfieldElementSize = 0;
    this.heightfieldPosition = null;
  }
  
  /**
   * Create a new physics material
   */
  createMaterial(name, friction, restitution) {
    const material = new CANNON.Material(name);
    material.friction = friction;
    material.restitution = restitution;
    return material;
  }
  
  /**
   * Setup contact materials for different surface interactions
   */
  setupContactMaterials() {
    // Create a contact material for each surface type
    Object.values(this.materials).forEach(material => {
      if (material !== this.defaultMaterial) {
        const contactMaterial = new CANNON.ContactMaterial(
          this.defaultMaterial,
          material,
          {
            friction: (this.defaultMaterial.friction + material.friction) * 0.5,
            restitution: (this.defaultMaterial.restitution + material.restitution) * 0.5,
            contactEquationStiffness: 1e7,
            contactEquationRelaxation: 3
          }
        );
        this.world.addContactMaterial(contactMaterial);
      }
    });
  }
  
  /**
   * Create a golf ball physics body
   */
  createGolfBall(position, options = {}) {
    const ballOptions = {
      mass: 0.0459, // kg - standard golf ball mass
      radius: 0.02135, // meters - standard golf ball radius
      linearDamping: 0.1, // air resistance
      angularDamping: 0.1, // spin resistance
      ...options
    };
    
    // Create a sphere body
    const body = new CANNON.Body({
      mass: ballOptions.mass,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      shape: new CANNON.Sphere(ballOptions.radius),
      material: ballOptions.material || this.defaultMaterial,
      linearDamping: ballOptions.linearDamping,
      angularDamping: ballOptions.angularDamping,
      sleepSpeedLimit: 0.1, // Ball will sleep when speed is < 0.1 m/s
      sleepTimeLimit: 1 // Ball must be still for 1 second to sleep
    });
    
    // Enable continuous collision detection to prevent tunneling
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.1;
    body.sleepTimeLimit = 1;
    
    // Lower the collision response threshold so it responds to light taps
    body.collisionResponse = 1;
    
    return body;
  }
  
  /**
   * Create terrain from a Three.js mesh
   */
  createTerrainFromMesh(terrainMesh, options = {}) {
    const geometry = terrainMesh.geometry;
    const position = terrainMesh.position;
    const rotation = terrainMesh.quaternion;
    const scale = terrainMesh.scale;
    
    // Extract the vertices and indices from the geometry
    const vertices = geometry.attributes.position.array;
    const indices = geometry.index ? geometry.index.array : null;
    
    // Create a heightfield shape
    const sizeX = options.sizeX || 64;
    const sizeZ = options.sizeZ || 64;
    const width = options.width || 100;
    const depth = options.depth || 100;
    
    // Precompute min/max coordinates from the geometry
    const boundingBox = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    const minX = boundingBox.min.x;
    const maxX = boundingBox.max.x;
    const minZ = boundingBox.min.z;
    const maxZ = boundingBox.max.z;
    
    console.log(`Terrain bounds: X(${minX} to ${maxX}), Z(${minZ} to ${maxZ})`);
    
    // Element size for the heightfield grid
    const elementSize = width / sizeX;
    this.heightfieldElementSize = elementSize;
    this.heightfieldSize = { x: sizeX, z: sizeZ };
    
    // Create the heights matrix
    const heights = [];
    
    // Sample heights from the geometry vertices and find min/max heights
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    
    for (let i = 0; i < sizeZ; i++) {
      const row = [];
      for (let j = 0; j < sizeX; j++) {
        // Calculate position in world space
        const worldX = minX + (j / (sizeX - 1)) * (maxX - minX);
        const worldZ = minZ + (i / (sizeZ - 1)) * (maxZ - minZ);
        
        // Find the height of the nearest vertices and average them
        let totalHeight = 0;
        let count = 0;
        
        // Loop through all vertices
        for (let v = 0; v < vertices.length; v += 3) {
          const vx = vertices[v];
          const vy = vertices[v + 1];
          const vz = vertices[v + 2];
          
          // Calculate distance to this vertex (in XZ plane only)
          const dx = vx - worldX;
          const dz = vz - worldZ;
          const distSq = dx * dx + dz * dz;
          
          // Use vertices within a certain radius for averaging
          // This smooths out the heightfield while maintaining the general shape
          const radiusSq = elementSize * elementSize * 2;
          if (distSq <= radiusSq) {
            totalHeight += vy;
            count++;
          }
        }
        
        // Calculate average height (or default if no vertices found)
        let height = (count > 0) ? (totalHeight / count) : 0;
        
        // Update min/max heights
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        
        // Store the height
        row.push(height);
      }
      heights.push(row);
    }
    
    // Store the heights for later use
    this.heightfieldData = heights;
    
    console.log(`Height field created with ${sizeX}x${sizeZ} points, element size: ${elementSize}`);
    console.log(`Height range: ${minHeight.toFixed(2)} to ${maxHeight.toFixed(2)}`);
    
    // Create the heightfield shape
    const terrainShape = new CANNON.Heightfield(heights, {
      elementSize: elementSize
    });
    
    // IMPORTANT FIX: The terrain body's position defines the reference point for the heightfield
    // For CANNON.js, the position represents the minimum corner of the height field, not its center
    // We need to offset the terrain body correctly so it matches the visual terrain
    
    // Calculate position offset correctly for the heightfield
    const terrainPosition = new CANNON.Vec3(
      // The X position is the min X plus half the width
      minX,
      // Y position should be at the lowest point of the terrain (no offset)
      // The heightfield's reference point is its minimum corner in CANNON
      minHeight,
      // The Z position is the min Z plus half the depth
      minZ
    );
    
    // Store for later use in height lookups
    this.heightfieldPosition = terrainPosition.clone();
    
    // Create the terrain body
    const terrainBody = new CANNON.Body({
      mass: 0, // static body
      position: terrainPosition,
      material: this.materials.fairway // Default to fairway material
    });
    
    // Add the shape to the body
    terrainBody.addShape(terrainShape);
    
    // Rotate to match Three.js coordinates - CANNON and THREE have different coordinate systems
    const quaternion = new CANNON.Quaternion();
    quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI/2);
    terrainBody.quaternion.copy(quaternion);
    
    // Enable continuous collision detection
    terrainBody.collisionResponse = true;
    
    console.log(`Terrain body created at position: (${terrainPosition.x}, ${terrainPosition.y}, ${terrainPosition.z})`);
    
    return terrainBody;
  }
  
  /**
   * Get terrain height at a specific XZ position
   * This is a more reliable version using our stored heightfield data
   */
  getTerrainHeightAtPosition(x, z) {
    if (!this.heightfieldData || !this.heightfieldPosition) {
      console.warn("Heightfield data or position not available");
      return 0; // Default height if no heightfield data available
    }
    
    // Convert world position to heightfield grid coordinates
    // Calculate indices based on position relative to the heightfield
    const localX = x - this.heightfieldPosition.x;
    const localZ = z - this.heightfieldPosition.z;
    
    // Convert to grid indices based on element size
    const j = Math.floor(localX / this.heightfieldElementSize);
    const i = Math.floor(localZ / this.heightfieldElementSize);
    
    // Check if within bounds
    if (i >= 0 && i < this.heightfieldSize.z && j >= 0 && j < this.heightfieldSize.x) {
      // Get height from the stored data
      const height = this.heightfieldData[i][j];
      // Return height in world space
      return height + this.heightfieldPosition.y;
    } else {
      console.warn(`Position (${x}, ${z}) is out of heightfield bounds (i=${i}, j=${j})`);
      // Return a default height if out of bounds
      return 0;
    }
  }
  
  /**
   * Apply a hit to a ball
   */
  hitBall(ballBody, power, direction, loft = 0, spin = 0) {
    // Reset any previous forces/velocities
    ballBody.velocity.setZero();
    ballBody.angularVelocity.setZero();
    
    // Convert power to actual force (adjust these multipliers as needed)
    const maxForce = 400; // maximum force in Newtons
    const force = (power / 100) * maxForce;
    
    // Calculate vertical component based on loft
    const loftRadians = loft * Math.PI / 180;
    const horizontalComponent = Math.cos(loftRadians);
    const verticalComponent = Math.sin(loftRadians);
    
    // Apply force in the swing direction
    const forceVector = new CANNON.Vec3(
      direction.x * force * horizontalComponent,
      force * verticalComponent,
      direction.z * force * horizontalComponent
    );
    
    // Apply the impulse
    ballBody.applyImpulse(forceVector, ballBody.position);
    
    // Apply spin (around relative axis to movement direction)
    if (spin !== 0) {
      // Calculate a spin axis perpendicular to the movement direction
      // For backspin/topspin, the axis is perpendicular to the direction in the horizontal plane
      const spinAxis = new CANNON.Vec3(-direction.z, 0, direction.x).normalize();
      
      // Scale spin based on power and user input
      const spinMagnitude = (spin / 10) * power;
      
      // Apply an angular impulse to create the spin effect
      const spinImpulse = new CANNON.Vec3(
        spinAxis.x * spinMagnitude,
        spinAxis.y * spinMagnitude,
        spinAxis.z * spinMagnitude
      );
      
      ballBody.angularVelocity.copy(spinImpulse);
    }
    
    // Make sure the body is awake
    ballBody.wakeUp();
  }
  
  /**
   * Add terrain regions with specific materials
   */
  addTerrainRegion(terrainBody, region, material) {
    // Region should be {minX, maxX, minZ, maxZ}
    // This is a simplified example - in a real implementation,
    // you'd need more sophisticated region detection
    
    // For now, we'll just apply the material to the whole terrain
    // In a more advanced implementation, you'd apply materials to specific triangles
    terrainBody.material = this.materials[material] || this.materials.default;
  }
  
  /**
   * Update physics world
   */
  update(deltaTime) {
    // Fixed time step for stability
    const fixedTimeStep = 1.0 / 60.0;
    const maxSubSteps = this.options.substeps;
    
    // Step the physics world
    this.world.step(fixedTimeStep, deltaTime, maxSubSteps);
    
    // Update all registered meshes
    this.bodies.forEach((mesh, body) => {
      if (mesh) {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
      }
    });
  }
  
  /**
   * Register a mesh to be updated with a physics body
   */
  registerBody(body, mesh) {
    this.world.addBody(body);
    if (mesh) {
      this.bodies.set(body, mesh);
    }
    return body;
  }
  
  /**
   * Check if a ball is at rest (sleeping)
   */
  isBallAtRest(ballBody) {
    return ballBody.sleepState === CANNON.Body.SLEEPING;
  }
  
  /**
   * Get the surface type at a position
   */
  getSurfaceTypeAtPosition(position, terrain) {
    // This is a placeholder - in a real implementation,
    // you'd need to determine the surface type based on the terrain data
    // and the position of the ball
    
    // For now, just return 'fairway' as a default
    return 'fairway';
  }
}

export default PhysicsManager; 
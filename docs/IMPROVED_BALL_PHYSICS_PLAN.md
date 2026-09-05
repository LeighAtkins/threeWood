# Improved Ball Physics Plan for ThreeWood Golf

## Current Problems

After analyzing the code, I've identified three key issues with the current ball physics:

1. **Tunneling Through Mesh**: The ball can fall through the terrain mesh when it has high vertical velocity, resulting in the ball being reset to its previous position.
2. **Unrealistic Bouncing**: The current bounce physics don't produce natural bouncing behavior for a golf ball, especially on angled terrain.
3. **Abrupt Stopping**: The ball can stop too quickly after landing, not allowing for natural rolling movement.

## Root Causes

### Tunneling Issue
- **Discrete Collision Detection**: The current system only checks for collisions once per frame, which can miss collisions if the ball moves too fast.
- **Simple Penetration Resolution**: The code detects tunneling but simply resets the ball rather than preventing it.
- **Limited Tunneling Detection**: Only checks for tunneling with downward velocity < -5, missing other cases.

### Bouncing Issues
- **Basic Reflection Model**: Current bounce mechanics don't adequately account for material properties and energy loss.
- **Fixed Restitution**: Uses a constant restitution coefficient regardless of impact velocity.
- **Limited Angle Handling**: Deflections are handled with a simple threshold (85 degrees).

### Stopping Issues
- Fixed landing timer that forces the ball to stop after a short period.

## Step-by-Step Improvement Plan

### Phase 1: Prevent Tunneling Through Mesh

1. **Implement Continuous Collision Detection (CCD)**
   - Use ray casting between previous and current positions to detect potential collision points
   - Compute the time of impact to place the ball at the exact contact point

2. **Improve Tunneling Detection**
   - Add safety checks to detect high-speed movement in any direction
   - Implement sub-stepping to handle multiple collision checks per frame for high-velocity balls

3. **Better Position Correction**
   - Implement proper contact resolution using penetration depth
   - Add a larger safe offset from the terrain to prevent immediate re-penetration

### Phase 2: Realistic Bouncing Physics

1. **Improved Bounce Model**
   - Implement a velocity-dependent coefficient of restitution (slower impacts should bounce less)
   - Preserve more horizontal momentum during bounces
   - Properly reflect velocity based on surface normal

2. **Enhanced Angular Momentum**
   - Improve spin calculation based on impact angle and velocity
   - Implement spin-to-velocity coupling (backspin causes lift, etc.)

3. **Surface-Based Bouncing**
   - Vary bounce parameters based on terrain type (sand, fairway, rough)
   - Add random variation to bounce angle for more natural behavior

### Phase 3: Natural Rolling to Stop

1. **Improved Friction Model**
   - Implement rolling friction vs. sliding friction
   - Apply appropriate torque to generate realistic rolling motion
   - Scale friction based on terrain type

2. **Slope-Based Movement**
   - Enhance slope detection to better influence ball rolling direction
   - Implement proper gravitational influence on slopes

3. **Gradual Speed Reduction**
   - Replace the fixed landing timer with a more dynamic friction-based approach
   - Allow the ball to naturally roll to a stop based on terrain and physics

## Implementation Details

### Phase 1: Detailed Implementation Steps

```javascript
// 1. Continuous Collision Detection
checkCollision(dt) {
  const prevPos = this.position.clone().sub(this.velocity.clone().multiplyScalar(dt));
  const direction = this.velocity.clone().normalize();
  const distance = this.velocity.length() * dt;
  
  // Cast ray from previous position in velocity direction
  const ray = new THREE.Raycaster(prevPos, direction, 0, distance + this.options.radius);
  const intersections = ray.intersectObject(this.terrain.terrainMesh);
  
  if (intersections.length > 0) {
    // Found intersection, place ball at contact point
    const contact = intersections[0].point;
    const normal = intersections[0].face.normal;
    
    // Position ball at contact point plus radius in normal direction
    this.position.copy(contact).add(normal.clone().multiplyScalar(this.options.radius + 0.03));
    
    // Handle bounce with the normal
    this.handleBounce(normal, intersections[0].face);
    return true;
  }
  
  return false;
}
```

### Phase 2: Improved Bouncing

```javascript
handleBounce(normal, impactFace) {
  // Store pre-bounce velocity
  const preVelocity = this.velocity.clone();
  const impactSpeed = preVelocity.length();
  
  // Calculate impact angle
  const impactAngle = Math.acos(Math.max(-1, Math.min(1, 
                     preVelocity.clone().normalize().dot(normal))));
  
  // Velocity-dependent restitution (higher speed = more energy loss)
  const effectiveRestitution = Math.max(
    0.1, 
    this.options.restitution * (1 - impactSpeed * 0.01)
  );
  
  // Calculate reflection vector
  const reflection = this.calculateReflection(preVelocity, normal);
  
  // Apply restitution to reduce bounce energy
  reflection.multiplyScalar(effectiveRestitution);
  
  // Calculate spin based on impact
  this.spin = this.calculateSpinFromImpact(preVelocity, normal, impactAngle);
  
  // Set new velocity
  this.velocity.copy(reflection);
  
  // Play bounce sound based on impact force
  this.playBounceSound(impactSpeed);
}
```

### Phase 3: Rolling and Stopping

```javascript
applyRollingPhysics(dt) {
  if (!this.inAir) {
    // Get slope information
    const slopeX = this.calculateSlope(this.position.x, this.position.z, 'x');
    const slopeZ = this.calculateSlope(this.position.x, this.position.z, 'z');
    
    // Create slope normal vector
    const slopeNormal = new THREE.Vector3(-slopeX, 1, -slopeZ).normalize();
    
    // Apply gravity component along slope
    const gravityForce = 9.81 * this.options.mass;
    const slopeForce = new THREE.Vector3(
      slopeX * gravityForce,
      0,
      slopeZ * gravityForce
    );
    
    // Apply to velocity
    this.velocity.add(slopeForce.multiplyScalar(dt));
    
    // Apply rolling friction
    const rollingFriction = this.getRollingFriction();
    const frictionForce = this.velocity.clone().normalize().multiplyScalar(-rollingFriction);
    
    // Only apply if it wouldn't reverse direction
    if (frictionForce.lengthSq() * dt * dt < this.velocity.lengthSq()) {
      this.velocity.add(frictionForce.multiplyScalar(dt));
    } else {
      // Ball is stopping
      this.velocity.set(0, 0, 0);
      if (this.velocity.lengthSq() < 0.01) {
        this.isResting = true;
      }
    }
  }
}
```

## Testing Strategy

For each phase, we'll implement and test in isolation before moving to the next phase:

1. **Phase 1 Testing**:
   - Create test courses with steep slopes and drops
   - Test high-velocity impacts at various angles
   - Verify ball never passes through terrain
   - Ensure proper collision normal calculation

2. **Phase 2 Testing**:
   - Test bouncing on flat surfaces at different velocities
   - Test bouncing on angled surfaces
   - Verify spin generation from impacts
   - Compare with real golf ball physics videos

3. **Phase 3 Testing**: 
   - Test ball rolling on various slopes
   - Measure stopping distances on different terrains
   - Verify natural-looking deceleration
   - Ensure ball stops correctly in depressions

## Risks and Mitigations

1. **Performance Impact**: 
   - Continuous collision detection may impact performance
   - Mitigation: Only use CCD for high-velocity situations, implement adaptive physics time steps

2. **Complexity Management**:
   - Physics systems can become complex and difficult to debug
   - Mitigation: Implement good debugging visualizations and phase the implementation

3. **Edge Cases**:
   - Unusual terrain features might still cause issues
   - Mitigation: Add special handling for extreme slopes and edges

## Expected Outcomes

After implementing these improvements:
1. The ball will never fall through the terrain
2. Bounces will look natural and realistic
3. The ball will roll and come to a stop in a physically convincing way
4. The overall gameplay will feel more satisfying and predictable

This approach focuses on incremental improvements that can be tested at each stage, ensuring that we maintain a playable game throughout the development process. 
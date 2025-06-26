import * as THREE from 'three';

/**
 * Creates a direction arrow UI element that points toward the hole
 * and can also display wind direction
 */
export class DirectionArrow {
  /**
   * Initialize the direction arrow
   * @param {HTMLElement} container - DOM element to attach the arrow to
   */
  constructor(container) {
    // Create the UI container
    this.element = document.createElement('div');
    this.element.className = 'direction-arrow';
    container.appendChild(this.element);
    
    // Create the arrow element
    this.arrow = document.createElement('div');
    this.arrow.className = 'arrow';
    this.element.appendChild(this.arrow);
    
    // Create the label element
    this.label = document.createElement('div');
    this.label.className = 'label';
    this.label.textContent = 'HOLE';
    this.element.appendChild(this.label);
    
    // Create wind indicator (hidden by default)
    this.windIndicator = document.createElement('div');
    this.windIndicator.className = 'wind-indicator';
    this.windIndicator.style.display = 'none';
    this.element.appendChild(this.windIndicator);
    
    // Add styles
    this.addStyles();
  }
  
  /**
   * Add CSS styles for the direction arrow
   */
  addStyles() {
    // Check if styles already exist
    if (document.getElementById('direction-arrow-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'direction-arrow-styles';
    style.textContent = `
      .direction-arrow {
        position: absolute;
        bottom: 30px;
        left: 30px;
        width: 100px;
        height: 100px;
        background-color: rgba(0, 0, 0, 0.7);
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 1000;
        border: 2px solid white;
      }
      
      .direction-arrow .arrow {
        width: 0;
        height: 0;
        border-left: 20px solid transparent;
        border-right: 20px solid transparent;
        border-bottom: 40px solid gold;
        transform-origin: center;
        margin-bottom: 5px;
        filter: drop-shadow(0px 0px 3px rgba(0,0,0,0.7));
      }
      
      .direction-arrow .label {
        color: white;
        font-size: 16px;
        font-family: Arial, sans-serif;
        font-weight: bold;
        text-align: center;
        text-shadow: 1px 1px 2px black;
        margin-top: 5px;
      }
      
      .direction-arrow .wind-indicator {
        position: absolute;
        top: 10px;
        width: 100%;
        text-align: center;
        color: #00ffff;
        font-size: 10px;
      }
    `;
    document.head.appendChild(style);
  }
  
  /**
   * Update the arrow direction to point toward the hole
   * @param {THREE.Vector3} ballPosition - Current position of the ball
   * @param {THREE.Vector3} holePosition - Position of the hole
   * @param {THREE.Vector3} cameraPosition - Current position of the camera
   */
  update(ballPosition, holePosition, cameraPosition) {
    if (!ballPosition || !holePosition) return;
    
    // Calculate direction from ball to hole (in the XZ plane)
    const direction = new THREE.Vector2(
      holePosition.x - ballPosition.x,
      holePosition.z - ballPosition.z
    );
    
    // Calculate angle in radians for the direction to hole
    const angleToHole = Math.atan2(direction.y, direction.x);

    // Calculate camera's forward direction in XZ plane
    const cameraDirection = new THREE.Vector3();
    cameraDirection.subVectors(ballPosition, cameraPosition).normalize();
    const cameraAngle = Math.atan2(cameraDirection.z, cameraDirection.x);

    // Calculate the relative angle between the camera's forward direction and the hole's direction
    // We want the arrow to point 'up' when the hole is directly in front of the camera
    // and rotate clockwise as the hole moves to the right.
    let relativeAngle = angleToHole - cameraAngle;

    // Normalize angle to be between -PI and PI
    if (relativeAngle > Math.PI) relativeAngle -= 2 * Math.PI;
    if (relativeAngle < -Math.PI) relativeAngle += 2 * Math.PI;

    // Convert to degrees for CSS rotation
    const angleInDegrees = relativeAngle * (180 / Math.PI);

    // Update arrow rotation
    this.arrow.style.transform = `rotate(${angleInDegrees}deg)`;
    
    // Calculate distance to hole
    const distance = direction.length();
    const distanceInYards = Math.round(distance * 3.28084 / 3); // Convert to yards
    
    // Update label with distance
    this.label.textContent = `HOLE ${distanceInYards}y`;
  }
  
  /**
   * Update the wind indicator
   * @param {Object} wind - Wind data with direction and speed
   */
  updateWind(wind) {
    if (!wind) {
      this.windIndicator.style.display = 'none';
      return;
    }
    
    // Show wind indicator
    this.windIndicator.style.display = 'block';
    
    // Update wind text
    this.windIndicator.textContent = `WIND: ${wind.speed} mph`;
    
    // Add a small arrow indicating wind direction
    // This could be enhanced later
  }
  
  /**
   * Show or hide the direction arrow
   * @param {boolean} visible - Whether the arrow should be visible
   */
  setVisible(visible) {
    this.element.style.display = visible ? 'flex' : 'none';
  }
}

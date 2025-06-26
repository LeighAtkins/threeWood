import * as THREE from 'three';

/**
 * Handle hole completion (ball in hole)
 */
function handleHoleComplete() {
  // Only handle once
  if (this.gameState === 'HOLE_COMPLETE') return;
  
  console.log(`🏆 Hole completed in ${this.strokes} strokes!`);
  
  // Update game state
  this.setGameState('HOLE_COMPLETE');
  
  // Update score
  const relativeScore = this.strokes - this.par;
  this.score += relativeScore;
  
  // Update UI
  if (this.ui) {
    this.ui.updateScore(this.score);
    this.ui.showHoleCompleteMessage(this.strokes, this.par);
  }
  
  // Special effects - make the flag wave or animate
  if (this.flag) {
    // Try to find flag mesh in the model
    let flagMesh = null;
    
    // First check if we have a reference in userData
    if (this.flag.userData && this.flag.userData.flagMesh) {
      flagMesh = this.flag.userData.flagMesh;
    } else {
      // Otherwise try to find a suitable mesh in the children
      flagMesh = this.flag.children.find(child => 
        child.geometry instanceof THREE.PlaneGeometry || 
        (child.name && child.name.toLowerCase().includes('flag')));
    }
    
    if (flagMesh) {
      // Create animation for the flag
      this.flagAnimation = setInterval(() => {
        flagMesh.rotation.y += 0.1;
      }, 50);
    }
  }
  
  // Automatically reset after a delay
  setTimeout(() => {
    // Clear flag animation if it exists
    if (this.flagAnimation) {
      clearInterval(this.flagAnimation);
      this.flagAnimation = null;
    }
    
    // Reset for next hole
    if (this.resetBall) {
      // resetBall now handles game state transition internally
      this.resetBall();
      console.log('[handleHoleComplete] Ball reset complete, game state should be AIMING');
    } else if (this.reset) {
      this.reset(); // Alternative reset method
      // Ensure game state is set properly if reset doesn't handle it
      if (this.setGameState) {
        this.setGameState('READY_TO_HIT');
      }
    } else {
      console.warn('No reset method found on game object');
      // Fallback - try to reset ball position directly
      if (this.ball && this.terrain && this.terrain.teePosition) {
        this.ball.reset(this.terrain.teePosition);
        if (this.setGameState) {
          this.setGameState('READY_TO_HIT');
        }
      }
    }
    
    // Force camera to follow mode
    if (this.cameraController) {
      this.cameraController.followBall();
    }
  }, 3000);
}

export default handleHoleComplete;

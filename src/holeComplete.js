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
  
  // Automatically advance to the next hole after a delay
  setTimeout(() => {
    // Clear flag animation if it exists
    if (this.flagAnimation) {
      clearInterval(this.flagAnimation);
      this.flagAnimation = null;
    }

    if (this.advanceHole) {
      this.advanceHole(); // handles camera via the AIMING state hook
    } else {
      console.warn('No advanceHole method found on game object');
      if (this.ball && this.terrain && this.terrain.teePosition) {
        this.ball.reset(this.terrain.teePosition);
        if (this.setGameState) {
          this.setGameState('READY_TO_HIT');
        }
      }
      if (this.cameraController) {
        this.cameraController.followBall();
      }
    }
  }, 3000);
}

export default handleHoleComplete;

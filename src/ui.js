/**
 * UI manager for ThreeWood
 * Handles game UI including power meter, score display, etc.
 */
class UI {
  constructor(game) {
    console.log("UI constructor initialized");
    this.game = game;
    
    // UI elements
    this.powerMeterElement = null;
    this.powerFillElement = null;
    this.scoreElement = null;
    this.strokesElement = null;
    this.instructionsElement = null;
    this.readyIndicatorElement = null;
    this.loftDisplayElement = null;
    this.transitionIndicatorElement = null;
    
    // UI state
    this.isPowerMeterVisible = false;
    this.isInstructionsVisible = false;
    
    // Initialize UI
    this.initUI();
  }
  
  /**
   * Initialize UI elements
   */
  initUI() {
    console.log("UI initialization started");
    this.createPowerMeter();
    this.createStrokesDisplay();
    this.createScoreDisplay();
    this.createReadyIndicator();
    this.createLoftDisplay();
    this.createTransitionIndicator();
    
    // Hide power meter initially
    this.hidePowerMeter();
    console.log("UI initialization completed");
  }
  
  /**
   * Create power meter UI element
   */
  createPowerMeter() {
    // Create container
    const powerMeterContainer = document.createElement('div');
    powerMeterContainer.id = 'power-meter-container';
    powerMeterContainer.style.position = 'absolute';
    powerMeterContainer.style.bottom = '20px';
    powerMeterContainer.style.left = '50%';
    powerMeterContainer.style.transform = 'translateX(-50%)';
    powerMeterContainer.style.width = '300px';
    powerMeterContainer.style.height = '30px';
    powerMeterContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    powerMeterContainer.style.border = '3px solid #fff';
    powerMeterContainer.style.borderRadius = '5px';
    powerMeterContainer.style.zIndex = '100';
    
    // Create power fill
    const powerFill = document.createElement('div');
    powerFill.id = 'power-fill';
    powerFill.style.width = '0%';
    powerFill.style.height = '100%';
    powerFill.style.backgroundColor = '#ffcc00';
    powerFill.style.transition = 'background-color 0.2s';
    
    // Create power label
    const powerLabel = document.createElement('div');
    powerLabel.id = 'power-label';
    powerLabel.textContent = 'POWER';
    powerLabel.style.position = 'absolute';
    powerLabel.style.top = '50%';
    powerLabel.style.left = '50%';
    powerLabel.style.transform = 'translate(-50%, -50%)';
    powerLabel.style.color = '#fff';
    powerLabel.style.fontFamily = 'Lato, sans-serif';
    powerLabel.style.fontWeight = 'bold';
    powerLabel.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.8)';
    
    // Assemble power meter
    powerMeterContainer.appendChild(powerFill);
    powerMeterContainer.appendChild(powerLabel);
    document.body.appendChild(powerMeterContainer);
    
    // Store references
    this.powerMeterElement = powerMeterContainer;
    this.powerFillElement = powerFill;
  }
  
  /**
   * Create strokes display
   */
  createStrokesDisplay() {
    const strokesDisplay = document.createElement('div');
    strokesDisplay.id = 'strokes-display';
    strokesDisplay.style.position = 'absolute';
    strokesDisplay.style.top = '20px';
    strokesDisplay.style.left = '20px';
    strokesDisplay.style.padding = '10px 15px';
    strokesDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    strokesDisplay.style.color = '#fff';
    strokesDisplay.style.fontFamily = 'Lato, sans-serif';
    strokesDisplay.style.borderRadius = '5px';
    strokesDisplay.style.zIndex = '100';
    strokesDisplay.textContent = 'Strokes: 0';
    
    document.body.appendChild(strokesDisplay);
    this.strokesElement = strokesDisplay;
  }
  
  /**
   * Create score display
   */
  createScoreDisplay() {
    const scoreDisplay = document.createElement('div');
    scoreDisplay.id = 'score-display';
    scoreDisplay.style.position = 'absolute';
    scoreDisplay.style.top = '20px';
    scoreDisplay.style.right = '20px';
    scoreDisplay.style.padding = '10px 15px';
    scoreDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    scoreDisplay.style.color = '#fff';
    scoreDisplay.style.fontFamily = 'Lato, sans-serif';
    scoreDisplay.style.borderRadius = '5px';
    scoreDisplay.style.zIndex = '100';
    scoreDisplay.textContent = 'Score: 0';
    
    document.body.appendChild(scoreDisplay);
    this.scoreElement = scoreDisplay;
  }
  
  /**
   * Create ready indicator element
   */
  createReadyIndicator() {
    const readyIndicator = document.createElement('div');
    readyIndicator.id = 'ready-indicator';
    readyIndicator.textContent = 'READY - Click to Aim';
    readyIndicator.style.position = 'absolute';
    readyIndicator.style.bottom = '80px';
    readyIndicator.style.left = '50%';
    readyIndicator.style.transform = 'translateX(-50%)';
    readyIndicator.style.padding = '8px 15px';
    readyIndicator.style.backgroundColor = 'rgba(76, 175, 80, 0.8)';
    readyIndicator.style.color = '#fff';
    readyIndicator.style.fontFamily = 'Lato, sans-serif';
    readyIndicator.style.fontSize = '16px';
    readyIndicator.style.fontWeight = 'bold';
    readyIndicator.style.borderRadius = '5px';
    readyIndicator.style.zIndex = '100';
    readyIndicator.style.display = 'none';
    readyIndicator.style.transition = 'opacity 0.3s ease-in-out';
    readyIndicator.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.5)';
    
    document.body.appendChild(readyIndicator);
    this.readyIndicatorElement = readyIndicator;
  }
  
  /**
   * Create loft display element
   */
  createLoftDisplay() {
    const loftDisplay = document.createElement('div');
    loftDisplay.id = 'loft-display';
    loftDisplay.style.position = 'absolute';
    loftDisplay.style.bottom = '55px';
    loftDisplay.style.left = '50%';
    loftDisplay.style.transform = 'translateX(-50%)';
    loftDisplay.style.padding = '5px 10px';
    loftDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    loftDisplay.style.color = '#fff';
    loftDisplay.style.fontFamily = 'Lato, sans-serif';
    loftDisplay.style.fontSize = '14px';
    loftDisplay.style.borderRadius = '4px';
    loftDisplay.style.zIndex = '100';
    loftDisplay.style.display = 'none';
    loftDisplay.style.transition = 'opacity 0.3s ease-in-out';
    loftDisplay.textContent = 'Loft: 10°';

    document.body.appendChild(loftDisplay);
    this.loftDisplayElement = loftDisplay;
  }
  
  /**
   * Create camera transition indicator
   */
  createTransitionIndicator() {
    const transitionIndicator = document.createElement('div');
    transitionIndicator.id = 'transition-indicator';
    transitionIndicator.style.position = 'absolute';
    transitionIndicator.style.bottom = '120px';
    transitionIndicator.style.left = '50%';
    transitionIndicator.style.transform = 'translateX(-50%)';
    transitionIndicator.style.width = '250px';
    transitionIndicator.style.height = '8px';
    transitionIndicator.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
    transitionIndicator.style.borderRadius = '4px';
    transitionIndicator.style.zIndex = '100';
    transitionIndicator.style.overflow = 'hidden';
    transitionIndicator.style.display = 'none';
    
    // Create progress fill
    const progressFill = document.createElement('div');
    progressFill.id = 'transition-progress';
    progressFill.style.width = '0%';
    progressFill.style.height = '100%';
    progressFill.style.backgroundColor = '#4CAF50';
    
    // Create label
    const label = document.createElement('div');
    label.textContent = 'REPOSITIONING';
    label.style.position = 'absolute';
    label.style.top = '-20px';
    label.style.left = '50%';
    label.style.transform = 'translateX(-50%)';
    label.style.color = '#fff';
    label.style.fontFamily = 'Lato, sans-serif';
    label.style.fontSize = '12px';
    label.style.fontWeight = 'bold';
    label.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.7)';
    
    transitionIndicator.appendChild(progressFill);
    transitionIndicator.appendChild(label);
    document.body.appendChild(transitionIndicator);
    
    this.transitionIndicatorElement = transitionIndicator;
    this.transitionProgressElement = progressFill;
  }
  
  /**
   * Show power meter
   */
  showPowerMeter() {
    if (this.powerMeterElement) {
      this.powerMeterElement.style.display = 'block';
      this.isPowerMeterVisible = true;
    }
  }
  
  /**
   * Hide power meter
   */
  hidePowerMeter() {
    if (this.powerMeterElement) {
      this.powerMeterElement.style.display = 'none';
      this.isPowerMeterVisible = false;
    }
  }
  
  /**
   * Update power meter fill
   */
  updatePowerMeter(power) {
    if (this.powerFillElement) {
      // Update fill width
      this.powerFillElement.style.width = `${power}%`;
      
      // Update color based on power level
      if (power < 30) {
        this.powerFillElement.style.backgroundColor = '#33cc33'; // Low power (green)
      } else if (power < 70) {
        this.powerFillElement.style.backgroundColor = '#ffcc00'; // Medium power (yellow)
      } else {
        this.powerFillElement.style.backgroundColor = '#ff3300'; // High power (red)
      }
    }
  }
  
  /**
   * Update strokes display
   */
  updateStrokes(strokes) {
    if (this.strokesElement) {
      this.strokesElement.textContent = `Strokes: ${strokes}`;
    }
  }
  
  /**
   * Update score display
   */
  updateScore(score) {
    if (this.scoreElement) {
      this.scoreElement.textContent = `Score: ${score}`;
    }
  }
  
  /**
   * Show hole completion message
   */
  showHoleCompleteMessage(strokes, par) {
    // Calculate relative to par
    let relativeScore = strokes - par;
    let scoreText = '';
    
    if (relativeScore === -2) scoreText = 'EAGLE!';
    else if (relativeScore === -1) scoreText = 'BIRDIE!';
    else if (relativeScore === 0) scoreText = 'PAR';
    else if (relativeScore === 1) scoreText = 'BOGEY';
    else if (relativeScore === 2) scoreText = 'DOUBLE BOGEY';
    else if (relativeScore < -2) scoreText = 'AMAZING SHOT!';
    else scoreText = `+${relativeScore}`;
    
    const messageContainer = document.createElement('div');
    messageContainer.id = 'hole-complete-message';
    messageContainer.style.position = 'absolute';
    messageContainer.style.top = '50%';
    messageContainer.style.left = '50%';
    messageContainer.style.transform = 'translate(-50%, -50%)';
    messageContainer.style.padding = '20px 30px';
    messageContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    messageContainer.style.color = '#fff';
    messageContainer.style.fontFamily = 'Lato, sans-serif';
    messageContainer.style.fontSize = '24px';
    messageContainer.style.textAlign = 'center';
    messageContainer.style.borderRadius = '10px';
    messageContainer.style.zIndex = '200';
    messageContainer.style.boxShadow = '0 0 20px rgba(255, 215, 0, 0.6)';
    messageContainer.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 10px;">Hole Complete!</div>
      <div>Strokes: ${strokes} | Par: ${par}</div>
      <div style="font-size: 36px; margin-top: 15px; color: #FFD700;">${scoreText}</div>
    `;
    
    document.body.appendChild(messageContainer);
    
    // Remove after a delay
    setTimeout(() => {
      document.body.removeChild(messageContainer);
    }, 3000);
  }
  
  /**
   * Show game instructions
   */
  showInstructions() {
    if (this.isInstructionsVisible) return;
    
    this.isInstructionsVisible = true;
    
    // Fade out game canvas slightly to emphasize instructions
    const gameCanvas = document.getElementById('game-canvas');
    if (gameCanvas) {
      gameCanvas.style.opacity = '0.3';
      gameCanvas.style.transition = 'opacity 0.5s ease-out';
    }
    
    // Create instructions container
    const instructions = document.createElement('div');
    instructions.className = 'instructions';
    instructions.id = 'instructions';
    
    // Apply styles
    Object.assign(instructions.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%) scale(1)',
      width: '80%',
      maxWidth: '600px',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      color: 'white',
      padding: '20px',
      borderRadius: '8px',
      boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)',
      zIndex: '100',
      textAlign: 'center',
      opacity: '0',
      transition: 'opacity 0.5s ease-in, transform 0.4s ease-out'
    });
    
    // Add title
    const title = document.createElement('h2');
    title.textContent = 'Three Wood - Game Controls';
    title.style.marginBottom = '15px';
    title.style.color = '#4CAF50';
    instructions.appendChild(title);
    
    // Add instructions content
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="text-align: left; margin-bottom: 20px;">
        <p><strong>Mouse controls:</strong></p>
        <ul style="padding-left: 20px; margin-bottom: 15px;">
          <li>Click and hold to begin swing</li>
          <li>Release to hit the ball</li>
          <li>Move mouse horizontally while holding to adjust direction</li>
        </ul>
        <p><strong>Keyboard controls:</strong></p>
        <ul style="padding-left: 20px; margin-bottom: 15px;">
          <li>Space: Alternate camera view</li>
          <li>R: Reset ball position</li>
          <li>Esc: Show/hide this help</li>
        </ul>
      </div>
    `;
    instructions.appendChild(content);
    
    // Add continue button
    const continueBtn = document.createElement('button');
    continueBtn.id = 'continue-btn';
    continueBtn.textContent = 'Continue';
    Object.assign(continueBtn.style, {
      padding: '8px 20px',
      backgroundColor: '#4CAF50',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '16px',
      marginTop: '10px',
      transition: 'background-color 0.3s'
    });
    
    continueBtn.addEventListener('mouseover', () => {
      continueBtn.style.backgroundColor = '#45a049';
    });
    
    continueBtn.addEventListener('mouseout', () => {
      continueBtn.style.backgroundColor = '#4CAF50';
    });
    
    continueBtn.addEventListener('click', () => {
      this.dismissInstructions();
    });
    
    instructions.appendChild(continueBtn);
    document.body.appendChild(instructions);
    
    // Display instructions with animation
    setTimeout(() => {
      instructions.style.opacity = '1';
    }, 10);
    
    // Set up ESC key to dismiss instructions
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && this.isInstructionsVisible) {
        this.dismissInstructions();
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    // Auto dismiss after 8 seconds
    this.instructionsTimeout = setTimeout(() => {
      if (this.isInstructionsVisible) {
        this.dismissInstructions();
      }
    }, 8000);
  }
  
  /**
   * Dismiss the instructions modal
   */
  dismissInstructions() {
    if (!this.isInstructionsVisible) return;
    
    const instructions = document.getElementById('instructions');
    if (!instructions) return;
    
    // Fade out instructions
    instructions.style.opacity = '0';
    instructions.style.transform = 'translate(-50%, -50%) scale(0.95)';
    
    // Restore game canvas opacity
    const gameCanvas = document.getElementById('game-canvas');
    if (gameCanvas) {
      gameCanvas.style.opacity = '1';
    }
    
    // Clear any existing timeout
    if (this.instructionsTimeout) {
      clearTimeout(this.instructionsTimeout);
      this.instructionsTimeout = null;
    }
    
    // Remove instructions element after animation completes
    setTimeout(() => {
      if (instructions && instructions.parentNode) {
        instructions.parentNode.removeChild(instructions);
      }
      this.isInstructionsVisible = false;
      
      // Dispatch instructionsDismissed event
      document.dispatchEvent(new CustomEvent('instructionsDismissed'));
      
      // Trigger resize event to ensure renderer updates properly
      window.dispatchEvent(new Event('resize'));
    }, 500);
  }
  
  /**
   * Ensure the game canvas is visible
   */
  ensureGameVisible() {
    const gameCanvas = document.getElementById('game-canvas');
    if (gameCanvas) {
      gameCanvas.style.opacity = '1';
      gameCanvas.style.transition = 'opacity 0.5s ease-in';
      
      // Force a small window resize event to ensure renderer updates properly
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        console.log("Triggered resize event to refresh renderer");
      }, 100);
    }
  }
  
  /**
   * Show ready indicator
   */
  showReadyIndicator() {
    if (this.readyIndicatorElement) {
      this.readyIndicatorElement.style.display = 'block';
      this.readyIndicatorElement.style.opacity = '1';
      if (this.loftDisplayElement) {
        this.loftDisplayElement.style.display = 'block';
        this.loftDisplayElement.style.opacity = '1';
      }
    }
  }
  
  /**
   * Hide ready indicator
   */
  hideReadyIndicator() {
    if (this.readyIndicatorElement) {
      this.readyIndicatorElement.style.opacity = '0';
      setTimeout(() => {
          if (this.readyIndicatorElement) { 
              this.readyIndicatorElement.style.display = 'none';
          }
      }, 300); 
    }
    if (this.loftDisplayElement) {
      this.loftDisplayElement.style.opacity = '0';
      setTimeout(() => {
          if (this.loftDisplayElement) { 
              this.loftDisplayElement.style.display = 'none';
          }
      }, 300); 
    }
  }
  
  /**
   * Update loft display
   */
  updateLoftDisplay(loft) {
    if (this.loftDisplayElement) {
      this.loftDisplayElement.textContent = `Loft: ${loft.toFixed(0)}°`;
      if (this.game.gameState === 'AIMING') {
        this.loftDisplayElement.style.display = 'block';
        this.loftDisplayElement.style.opacity = '1';
      } else {
        this.loftDisplayElement.style.opacity = '0';
        setTimeout(() => {
          if (this.loftDisplayElement && this.game.gameState !== 'AIMING') { 
            this.loftDisplayElement.style.display = 'none';
          }
        }, 300); 
      }
    }
  }
  
  /**
   * Show transition indicator
   */
  showTransitionIndicator() {
    if (this.transitionIndicatorElement) {
      this.transitionIndicatorElement.style.display = 'block';
    }
  }
  
  /**
   * Hide transition indicator
   */
  hideTransitionProgress() {
    if (this.transitionIndicatorElement) {
      this.transitionIndicatorElement.style.display = 'none';
    }
  }
  
  /**
   * Update transition progress
   */
  updateTransitionProgress(progress) {
    if (this.transitionProgressElement) {
      this.transitionProgressElement.style.width = `${progress * 100}%`;
    }
  }
}

export default UI; 
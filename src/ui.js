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
    
    // Initialize spin values to prevent errors
    this.spinValues = { x: 0, y: 0 };
    
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
    
    // Create spin selector but don't call its show/hide methods yet
    this.createSpinSelector();
    
    // Create spin indicator but keep it hidden initially
    this.createSpinIndicator();
    if (this.spinIndicatorElement) {
      this.spinIndicatorElement.style.display = 'none';
    }
    
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
    
    // Create instruction label
    const instructionLabel = document.createElement('div');
    instructionLabel.id = 'power-instruction';
    instructionLabel.textContent = 'CLICK AGAIN TO HIT';
    instructionLabel.style.position = 'absolute';
    instructionLabel.style.top = '-25px';
    instructionLabel.style.left = '50%';
    instructionLabel.style.transform = 'translateX(-50%)';
    instructionLabel.style.color = '#fff';
    instructionLabel.style.fontFamily = 'Lato, sans-serif';
    instructionLabel.style.fontSize = '14px';
    instructionLabel.style.fontWeight = 'bold';
    instructionLabel.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    instructionLabel.style.padding = '4px 10px';
    instructionLabel.style.borderRadius = '4px';
    instructionLabel.style.whiteSpace = 'nowrap';
    
    // Assemble power meter
    powerMeterContainer.appendChild(powerFill);
    powerMeterContainer.appendChild(powerLabel);
    powerMeterContainer.appendChild(instructionLabel);
    document.body.appendChild(powerMeterContainer);
    
    // Store references
    this.powerMeterElement = powerMeterContainer;
    this.powerFillElement = powerFill;
    this.powerInstructionElement = instructionLabel;
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
   * Create the spin selector UI
   */
  createSpinSelector() {
    // Create overlay to block clicks on the game area
    const overlay = document.createElement('div');
    overlay.id = 'spin-selector-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '199';
    overlay.style.display = 'none';
    
    // Add click handler to prevent clicks outside from triggering hits
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Don't close the selector when clicking the overlay
    });
    
    // Main container for the spin selector
    const spinSelector = document.createElement('div');
    spinSelector.id = 'spin-selector';
    spinSelector.style.position = 'fixed';
    spinSelector.style.top = '50%';
    spinSelector.style.left = '50%';
    spinSelector.style.transform = 'translate(-50%, -50%)';
    spinSelector.style.backgroundColor = '#f0f0f0';
    spinSelector.style.padding = '20px';
    spinSelector.style.borderRadius = '10px';
    spinSelector.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    spinSelector.style.zIndex = '200';
    spinSelector.style.display = 'none';
    spinSelector.style.flexDirection = 'column';
    spinSelector.style.alignItems = 'center';
    spinSelector.style.width = '300px';
    
    // Add click handler to prevent event propagation
    spinSelector.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    // Create feedback text element with improved styling
    const spinFeedback = document.createElement('div');
    spinFeedback.id = 'spin-feedback';
    spinFeedback.style.marginTop = '15px';
    spinFeedback.style.padding = '8px 15px';
    spinFeedback.style.backgroundColor = '#f8f8f8';
    spinFeedback.style.borderRadius = '5px';
    spinFeedback.style.fontWeight = 'bold';
    spinFeedback.style.textAlign = 'center';
    spinFeedback.style.display = 'none';
    spinFeedback.style.color = '#000000'; // Black text by default
    spinFeedback.textContent = 'No Spin';
    
    // Title
    const title = document.createElement('h2');
    title.textContent = 'Apply Spin';
    title.style.margin = '0 0 15px 0';
    title.style.color = '#333';
    spinSelector.appendChild(title);
    
    // Spin visualization area
    const spinArea = document.createElement('div');
    spinArea.id = 'spin-area';
    spinArea.style.width = '200px';
    spinArea.style.height = '200px';
    spinArea.style.borderRadius = '50%';
    spinArea.style.border = '2px solid #333';
    spinArea.style.position = 'relative';
    spinArea.style.backgroundColor = '#fff';
    spinArea.style.cursor = 'pointer';
    spinArea.style.backgroundImage = 'radial-gradient(circle, #f8f8f8, #e0e0e0)';
    
    // Add the ball marker to show the impact point
    const spinMarker = document.createElement('div');
    spinMarker.id = 'spin-marker';
    spinMarker.style.width = '20px';
    spinMarker.style.height = '20px';
    spinMarker.style.borderRadius = '50%';
    spinMarker.style.backgroundColor = '#e74c3c';
    spinMarker.style.position = 'absolute';
    spinMarker.style.top = '50%';
    spinMarker.style.left = '50%';
    spinMarker.style.transform = 'translate(-50%, -50%)';
    spinMarker.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    spinArea.appendChild(spinMarker);
    
    // Add the grid lines for reference
    const horizontalLine = document.createElement('div');
    horizontalLine.style.position = 'absolute';
    horizontalLine.style.top = '50%';
    horizontalLine.style.left = '0';
    horizontalLine.style.width = '100%';
    horizontalLine.style.height = '1px';
    horizontalLine.style.backgroundColor = '#aaa';
    spinArea.appendChild(horizontalLine);
    
    const verticalLine = document.createElement('div');
    verticalLine.style.position = 'absolute';
    verticalLine.style.top = '0';
    verticalLine.style.left = '50%';
    verticalLine.style.width = '1px';
    verticalLine.style.height = '100%';
    verticalLine.style.backgroundColor = '#aaa';
    spinArea.appendChild(verticalLine);
    
    // Add labels for the regions
    const topLabel = document.createElement('div');
    topLabel.textContent = 'Backspin';
    topLabel.style.position = 'absolute';
    topLabel.style.top = '5px';
    topLabel.style.left = '50%';
    topLabel.style.transform = 'translateX(-50%)';
    topLabel.style.fontSize = '12px';
    topLabel.style.color = '#666';
    spinArea.appendChild(topLabel);
    
    const bottomLabel = document.createElement('div');
    bottomLabel.textContent = 'Topspin';
    bottomLabel.style.position = 'absolute';
    bottomLabel.style.bottom = '5px';
    bottomLabel.style.left = '50%';
    bottomLabel.style.transform = 'translateX(-50%)';
    bottomLabel.style.fontSize = '12px';
    bottomLabel.style.color = '#666';
    spinArea.appendChild(bottomLabel);
    
    const leftLabel = document.createElement('div');
    leftLabel.textContent = 'Hook';
    leftLabel.style.position = 'absolute';
    leftLabel.style.top = '50%';
    leftLabel.style.left = '5px';
    leftLabel.style.transform = 'translateY(-50%)';
    leftLabel.style.fontSize = '12px';
    leftLabel.style.color = '#666';
    spinArea.appendChild(leftLabel);
    
    const rightLabel = document.createElement('div');
    rightLabel.textContent = 'Slice';
    rightLabel.style.position = 'absolute';
    rightLabel.style.top = '50%';
    rightLabel.style.right = '5px';
    rightLabel.style.transform = 'translateY(-50%)';
    rightLabel.style.fontSize = '12px';
    rightLabel.style.color = '#666';
    spinArea.appendChild(rightLabel);
    
    // Add event listeners to update the impact point
    spinArea.addEventListener('mousedown', (e) => {
      // Prevent event propagation to stop triggering power meter
      e.preventDefault();
      e.stopPropagation();
      
      const rect = spinArea.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      // Get position relative to center (normalized to -1 to 1)
      const x = (e.clientX - rect.left - centerX) / centerX;
      const y = (e.clientY - rect.top - centerY) / centerY;
      
      // Limit to the circle (normalize if outside)
      const distance = Math.sqrt(x * x + y * y);
      const radius = distance > 1 ? 1 : distance;
      
      // Update the marker and store values
      const normalizedX = distance > 1 ? x / distance : x;
      const normalizedY = distance > 1 ? y / distance : y;
      
      this.updateSpinMarker(normalizedX, normalizedY);
      this.updateSpinFeedback({ x: normalizedX, y: normalizedY, radius });
      
      // Store the selected spin
      this.selectedSpin = { x: normalizedX, y: normalizedY };
      
      // Enable mouse tracking while dragging
      const onMouseMove = (moveEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        const newRect = spinArea.getBoundingClientRect();
        const newCenterX = newRect.width / 2;
        const newCenterY = newRect.height / 2;
        
        // Get new position relative to center
        const newX = (moveEvent.clientX - newRect.left - newCenterX) / newCenterX;
        const newY = (moveEvent.clientY - newRect.top - newCenterY) / newCenterY;
        
        // Limit to the circle
        const newDistance = Math.sqrt(newX * newX + newY * newY);
        const newRadius = newDistance > 1 ? 1 : newDistance;
        
        const newNormalizedX = newDistance > 1 ? newX / newDistance : newX;
        const newNormalizedY = newDistance > 1 ? newY / newDistance : newY;
        
        this.updateSpinMarker(newNormalizedX, newNormalizedY);
        this.updateSpinFeedback({ x: newNormalizedX, y: newNormalizedY, radius: newRadius });
        
        // Store the selected spin
        this.selectedSpin = { x: newNormalizedX, y: newNormalizedY };
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    spinSelector.appendChild(spinArea);
    
    // Create controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'spin-controls';
    controlsContainer.style.display = 'none';
    controlsContainer.style.width = '100%';
    controlsContainer.style.marginTop = '15px';
    controlsContainer.style.display = 'flex';
    controlsContainer.style.justifyContent = 'space-between';
    
    // Create cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.padding = '8px 15px';
    cancelButton.style.backgroundColor = '#ccc';
    cancelButton.style.border = 'none';
    cancelButton.style.borderRadius = '5px';
    cancelButton.style.cursor = 'pointer';
    cancelButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeSpinSelector(false);
    });
    
    // Create confirm button
    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Apply Spin';
    confirmButton.style.padding = '8px 15px';
    confirmButton.style.backgroundColor = '#3498db';
    confirmButton.style.color = 'white';
    confirmButton.style.border = 'none';
    confirmButton.style.borderRadius = '5px';
    confirmButton.style.cursor = 'pointer';
    confirmButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeSpinSelector(true);
    });
    
    controlsContainer.appendChild(cancelButton);
    controlsContainer.appendChild(confirmButton);
    
    spinSelector.appendChild(spinFeedback);
    spinSelector.appendChild(controlsContainer);
    
    // Add to the document
    document.body.appendChild(overlay);
    document.body.appendChild(spinSelector);
    
    // Store references
    this.spinSelectorElement = spinSelector;
    this.spinSelectorOverlay = overlay;
    this.spinAreaElement = spinArea;
    this.spinMarkerElement = spinMarker;
    this.spinFeedbackElement = spinFeedback;
    this.controlsContainer = controlsContainer;
    this.confirmButton = confirmButton;
    this.cancelButton = cancelButton;
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
    // Check if instructions already exist
    if (this.instructionsElement) {
      this.instructionsElement.style.display = 'flex';
      return;
    }
    
    // Create instructions overlay
    const instructionsOverlay = document.createElement('div');
    instructionsOverlay.id = 'instructions-overlay';
    instructionsOverlay.style.position = 'fixed';
    instructionsOverlay.style.top = '0';
    instructionsOverlay.style.left = '0';
    instructionsOverlay.style.width = '100%';
    instructionsOverlay.style.height = '100%';
    instructionsOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    instructionsOverlay.style.display = 'flex';
    instructionsOverlay.style.flexDirection = 'column';
    instructionsOverlay.style.justifyContent = 'center';
    instructionsOverlay.style.alignItems = 'center';
    instructionsOverlay.style.color = '#fff';
    instructionsOverlay.style.fontFamily = 'Lato, sans-serif';
    instructionsOverlay.style.zIndex = '1000';
    
    // Create title
    const title = document.createElement('h1');
    title.textContent = 'ThreeWood Golf';
    title.style.marginBottom = '40px';
    title.style.fontSize = '36px';
    title.style.textShadow = '2px 2px 4px rgba(0, 0, 0, 0.5)';
    
    // Create instructions content
    const instructionsContent = document.createElement('div');
    instructionsContent.style.width = '80%';
    instructionsContent.style.maxWidth = '600px';
    instructionsContent.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    instructionsContent.style.padding = '30px';
    instructionsContent.style.borderRadius = '10px';
    instructionsContent.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
    
    // Instructions text
    instructionsContent.innerHTML = `
      <h2 style="text-align: center; margin-bottom: 20px;">How to Play</h2>
      <ul style="list-style-type: none; padding: 0; line-height: 1.8;">
        <li><strong>Move Mouse</strong>: Aim the shot</li>
        <li><strong>First Click</strong>: Start power meter</li>
        <li><strong>Second Click</strong>: Hit ball with current power</li>
        <li><strong>Up/Down Arrows</strong>: Adjust shot loft</li>
        <li><strong>S Key</strong>: Open spin selector</li>
        <li><strong>C Key</strong>: Toggle camera mode</li>
        <li><strong>R Key</strong>: Reset ball to tee</li>
        <li><strong>H Key</strong>: Show this help screen</li>
      </ul>
      <div style="margin-top: 20px; text-align: center;">
        <h3>Spin Control</h3>
        <p>Press S to open the spin selector, then click on the ball to set your impact point.</p>
        <p>Click the CONFIRM button when you're satisfied with your spin selection.</p>
        <ul style="list-style-type: none; padding: 0; line-height: 1.6;">
          <li>Center = No spin</li>
          <li>Left side = Hook (left curve)</li>
          <li>Right side = Slice (right curve)</li>
          <li>Top = Backspin (ball stops quickly)</li>
          <li>Bottom = Topspin (ball rolls further)</li>
        </ul>
      </div>
    `;
    
    // Create dismiss button
    const dismissButton = document.createElement('button');
    dismissButton.textContent = 'PLAY GOLF!';
    dismissButton.style.marginTop = '30px';
    dismissButton.style.padding = '12px 30px';
    dismissButton.style.backgroundColor = '#4CAF50';
    dismissButton.style.color = '#fff';
    dismissButton.style.border = 'none';
    dismissButton.style.borderRadius = '5px';
    dismissButton.style.fontSize = '18px';
    dismissButton.style.cursor = 'pointer';
    dismissButton.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
    dismissButton.style.transition = 'background-color 0.2s';
    
    // Hover effect
    dismissButton.addEventListener('mouseover', () => {
      dismissButton.style.backgroundColor = '#3e8e41';
    });
    dismissButton.addEventListener('mouseout', () => {
      dismissButton.style.backgroundColor = '#4CAF50';
    });
    
    // Button click event
    dismissButton.addEventListener('click', () => {
      this.dismissInstructions();
    });
    
    // Also allow closing with Escape key
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'h') {
        this.dismissInstructions();
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    
    // Assemble instructions
    instructionsOverlay.appendChild(title);
    instructionsOverlay.appendChild(instructionsContent);
    instructionsOverlay.appendChild(dismissButton);
    document.body.appendChild(instructionsOverlay);
    
    // Store reference
    this.instructionsElement = instructionsOverlay;
    this.isInstructionsVisible = true;
  }
  
  /**
   * Dismiss instructions
   */
  dismissInstructions() {
    if (!this.isInstructionsVisible) return;
    
    const instructions = document.getElementById('instructions-overlay');
    if (!instructions) return;
    
    // Hide the instructions
    instructions.style.display = 'none';
    this.isInstructionsVisible = false;
    
    // Dispatch custom event for game to resume
    const dismissEvent = new CustomEvent('instructionsDismissed');
    document.dispatchEvent(dismissEvent);
    
    console.log("Instructions dismissed");
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
  
  /**
   * Show the spin selector UI
   * @param {Function} onConfirm - Callback function when spin is confirmed
   */
  showSpinSelector(onConfirm) {
    if (!this.spinSelectorElement) this.createSpinSelector();
    
    // Show overlay to block game interaction
    const overlay = document.getElementById('spin-selector-overlay');
    if (overlay) {
      overlay.style.display = 'block';
    }
    
    this.spinSelectorElement.style.display = 'flex';
    this.controlsContainer.style.display = 'flex';
    this.spinFeedbackElement.style.display = 'block';
    this.confirmButton.style.display = 'block';
    
    // Store the callback
    this.onSpinConfirm = onConfirm;
    
    // Reset the spin selector
    this.selectedSpin = { x: 0, y: 0 };
    this.updateSpinFeedback({ x: 0, y: 0, radius: 0 });
    this.updateSpinMarker(0, 0);
    
    // Set game state to prevent ball hits
    if (this.game) {
      this.game.isSpinSelectorOpen = true;
    }
  }

  /**
   * Close the spin selector UI
   * @param {boolean} [callCallback=false] - Whether to call the onConfirm callback
   */
  closeSpinSelector(callCallback = false) {
    if (this.spinSelectorElement) {
      this.spinSelectorElement.style.display = 'none';
      this.controlsContainer.style.display = 'none';
      this.spinFeedbackElement.style.display = 'none';
      this.confirmButton.style.display = 'none';
    }
    
    // Hide overlay
    const overlay = document.getElementById('spin-selector-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
    
    // Call the callback if needed
    if (callCallback && this.onSpinConfirm) {
      this.onSpinConfirm(this.selectedSpin);
    }
    
    // Clear the callback
    this.onSpinConfirm = null;
    
    // Reset game state to allow ball hits after a delay
    if (this.game) {
      // Keep spin selector state as open temporarily
      this.game.isSpinSelectorOpen = true;
      
      // Add a short delay before allowing hits to prevent accidental hit activation
      setTimeout(() => {
        this.game.isSpinSelectorOpen = false;
        // Also disable any pending hit action that might have been triggered
        if (this.game.gameState === 'HITTING' && !this.game.powerMeterStarted) {
          this.game.resetPowerMeterState();
        }
      }, 300);
    }
  }
  
  /**
   * Update impact point position
   * @param {number} x - X position (-1 to 1, 0 is center)
   * @param {number} y - Y position (-1 to 1, 0 is center)
   */
  updateImpactPoint(x, y) {
    if (!this.impactPointElement) return;
    
    // Limit to circle bounds
    const radius = Math.sqrt(x*x + y*y);
    if (radius > 1) {
      x = x / radius;
      y = y / radius;
    }
    
    // Convert to pixel position (40px is radius of the ball visual)
    const pixelX = x * 60;
    const pixelY = y * 60;
    
    // Update position (50% is center)
    this.impactPointElement.style.left = `calc(50% + ${pixelX}px)`;
    this.impactPointElement.style.top = `calc(50% + ${pixelY}px)`;
    
    // Update visual feedback based on spin type
    this.updateSpinFeedback({ x, y, radius });
    
    // Return normalized coordinates
    return { x, y };
  }
  
  /**
   * Update the spin feedback text based on spin values
   * @param {Object} options - The options
   * @param {number} options.x - Horizontal spin value (-1 to 1)
   * @param {number} options.y - Vertical spin value (-1 to 1)
   * @param {number} options.radius - The radius of the spin selector
   */
  updateSpinFeedback({ x, y, radius }) {
    // Safety check for element existence
    if (!this.spinFeedbackElement) return;
    
    // Calculate spin strength on a scale from 0 to 1
    const distance = Math.sqrt(x * x + y * y);
    const normalizedDistance = Math.min(distance, radius) / radius;
    
    // Map the normalized distance to spin strength labels
    let strengthLabel;
    if (normalizedDistance < 0.25) {
      strengthLabel = 'Light';
    } else if (normalizedDistance < 0.6) {
      strengthLabel = 'Medium';
    } else {
      strengthLabel = 'Strong';
    }
    
    // Determine spin type
    let spinType = 'No';
    if (distance > 0.1) {  // If there is some significant spin
      if (Math.abs(y) > Math.abs(x)) {
        // More vertical than horizontal
        spinType = y < 0 ? 'Backspin' : 'Topspin';
      } else {
        // More horizontal than vertical
        spinType = x < 0 ? 'Hook' : 'Slice';
      }
      
      // If both components are significant, use combined names
      if (Math.abs(y) > 0.3 && Math.abs(x) > 0.3) {
        if (y < 0 && x < 0) {
          spinType = 'Backspin Hook';
        } else if (y < 0 && x > 0) {
          spinType = 'Backspin Slice';
        } else if (y > 0 && x < 0) {
          spinType = 'Topspin Hook';
        } else if (y > 0 && x > 0) {
          spinType = 'Topspin Slice';
        }
      }
    }
    
    // Set the feedback text
    let feedbackText = '';
    if (spinType === 'No') {
      feedbackText = 'No Spin';
    } else {
      feedbackText = `${strengthLabel} ${spinType}`;
    }
    
    // Update feedback element
    this.spinFeedbackElement.textContent = feedbackText;
    
    // Set color based on spin type
    if (spinType.includes('Backspin')) {
      this.spinFeedbackElement.style.color = '#0066cc';
    } else if (spinType.includes('Topspin')) {
      this.spinFeedbackElement.style.color = '#cc3300';
    } else if (spinType.includes('Hook')) {
      this.spinFeedbackElement.style.color = '#339933';
    } else if (spinType.includes('Slice')) {
      this.spinFeedbackElement.style.color = '#cc9900';
    } else {
      this.spinFeedbackElement.style.color = '#000000';
    }
  }
  
  /**
   * Create a simple spin indicator UI element to show current spin
   */
  createSpinIndicator() {
    // Create main container
    const spinIndicator = document.createElement('div');
    spinIndicator.id = 'spin-indicator';
    spinIndicator.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 80px;
      height: 80px;
      background-color: rgba(0, 0, 0, 0.7);
      border-radius: 50%;
      display: none;
      z-index: 999;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
      border: 2px solid #fff;
    `;
    
    // Create the ball icon
    const ballIcon = document.createElement('div');
    ballIcon.className = 'ball-icon';
    ballIcon.style.cssText = `
      position: absolute;
      width: 40px;
      height: 40px;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      background-color: #fff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // Add a pattern to the ball to make rotation visible
    const ballPattern = document.createElement('div');
    ballPattern.style.cssText = `
      width: 20px;
      height: 2px;
      background-color: #333;
      position: absolute;
    `;
    
    // Add another perpendicular line for visibility
    const ballPatternVertical = document.createElement('div');
    ballPatternVertical.style.cssText = `
      width: 2px;
      height: 20px;
      background-color: #333;
      position: absolute;
    `;
    
    // Add the spin indicator dot
    const spinDot = document.createElement('div');
    spinDot.className = 'spin-indicator-dot';
    spinDot.style.cssText = `
      position: absolute;
      width: 10px;
      height: 10px;
      background-color: #ff3b30;
      border-radius: 50%;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 1000;
    `;
    
    // Add grid lines for reference
    const horizontalLine = document.createElement('div');
    horizontalLine.style.cssText = `
      position: absolute;
      width: 70px;
      height: 1px;
      background-color: rgba(255, 255, 255, 0.3);
      left: 50%;
      top: 50%;
      transform: translateX(-50%);
    `;
    
    const verticalLine = document.createElement('div');
    verticalLine.style.cssText = `
      position: absolute;
      width: 1px;
      height: 70px;
      background-color: rgba(255, 255, 255, 0.3);
      left: 50%;
      top: 50%;
      transform: translateY(-50%) translateX(-50%);
    `;
    
    // Add spin type labels
    const topLabel = document.createElement('div');
    topLabel.style.cssText = `
      position: absolute;
      left: 50%;
      top: 5px;
      transform: translateX(-50%);
      color: white;
      font-size: 8px;
      text-align: center;
    `;
    topLabel.textContent = 'Topspin';
    
    const bottomLabel = document.createElement('div');
    bottomLabel.style.cssText = `
      position: absolute;
      left: 50%;
      bottom: 5px;
      transform: translateX(-50%);
      color: white;
      font-size: 8px;
      text-align: center;
    `;
    bottomLabel.textContent = 'Backspin';
    
    const leftLabel = document.createElement('div');
    leftLabel.style.cssText = `
      position: absolute;
      left: 5px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-size: 8px;
    `;
    leftLabel.textContent = 'Hook';
    
    const rightLabel = document.createElement('div');
    rightLabel.style.cssText = `
      position: absolute;
      right: 5px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-size: 8px;
    `;
    rightLabel.textContent = 'Slice';
    
    // Assemble the elements
    ballIcon.appendChild(ballPattern);
    ballIcon.appendChild(ballPatternVertical);
    
    spinIndicator.appendChild(horizontalLine);
    spinIndicator.appendChild(verticalLine);
    spinIndicator.appendChild(ballIcon);
    spinIndicator.appendChild(spinDot);
    spinIndicator.appendChild(topLabel);
    spinIndicator.appendChild(bottomLabel);
    spinIndicator.appendChild(leftLabel);
    spinIndicator.appendChild(rightLabel);
    
    // Add to document
    document.body.appendChild(spinIndicator);
    
    // Store references
    this.spinIndicatorElement = spinIndicator;
    this.spinIndicatorDotElement = spinDot;
    this.spinIndicatorBallElement = ballIcon;
    this.spinIndicatorBallPattern = ballPattern;
    this.spinIndicatorBallPatternVertical = ballPatternVertical;
    
    // Initial update
    this.updateSpinIndicator();
  }
  
  /**
   * Update the spin indicator
   * @param {Object} spinValues The x and y spin values
   */
  updateSpinIndicator() {
    // Use the class references instead of querying the DOM again
    if (!this.spinIndicatorElement || !this.spinIndicatorDotElement) return;
    
    // Make sure the indicator is visible
    this.spinIndicatorElement.style.display = 'block';
    
    const x = this.spinValues?.x || 0;
    const y = this.spinValues?.y || 0;
    
    // If no significant spin, center the dot
    if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) {
      this.spinIndicatorDotElement.style.left = '50%';
      this.spinIndicatorDotElement.style.top = '50%';
      this.stopSpinAnimation();
      return;
    }
    
    // Calculate the position of the spin dot based on spin values
    // x and y are in range -1 to 1, we need to map them to 0-100%
    const dotX = 50 + (x * 40); // 40% is the maximum offset from center
    const dotY = 50 - (y * 40); // Invert Y since CSS top 0 is at the top
    
    this.spinIndicatorDotElement.style.left = `${dotX}%`;
    this.spinIndicatorDotElement.style.top = `${dotY}%`;
    
    // Start animation based on spin values
    this.animateSpinIndicator(x, y);
  }
  
  /**
   * Animate the spin indicator based on spin values
   * @param {number} x Horizontal spin (-1 to 1)
   * @param {number} y Vertical spin (-1 to 1)
   */
  animateSpinIndicator(x, y) {
    if (!this.spinIndicatorBallElement) return;
    
    // Stop any existing animation
    this.stopSpinAnimation();
    
    // Determine animation speed based on spin magnitude
    const spinMagnitude = Math.sqrt(x*x + y*y);
    const animationDuration = Math.max(0.5, 1.5 - spinMagnitude); // Faster animation for more spin
    
    // Create keyframe animations for the ball
    const keyframes = [];
    
    // Apply horizontal spin animation (left-right rotation)
    if (Math.abs(x) > 0.05) {
      const rotationDirection = x < 0 ? 1 : -1; // Negative x (hook) = clockwise
      const rotationAmount = Math.min(360, Math.abs(x) * 360);
      keyframes.push(`@keyframes spinBallHorizontal {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(${rotationDirection * rotationAmount}deg); }
      }`);
    }
    
    // Apply vertical spin animation (top-bottom rotation)
    if (Math.abs(y) > 0.05) {
      const scaleFactor = y < 0 ? 0.7 : 1.3; // Backspin = compress, Topspin = expand
      keyframes.push(`@keyframes spinBallVertical {
        0%, 100% { transform: scaleY(1); }
        50% { transform: scaleY(${scaleFactor}); }
      }`);
    }
    
    // Create a style element for our animations
    const styleElement = document.createElement('style');
    styleElement.id = 'spin-animations';
    styleElement.textContent = keyframes.join('\n');
    document.head.appendChild(styleElement);
    
    // Apply the animations to the ball
    if (Math.abs(x) > 0.05) {
      this.spinIndicatorBallElement.style.animation = `spinBallHorizontal ${animationDuration}s linear infinite`;
    }
    
    if (Math.abs(y) > 0.05) {
      const existingAnimation = this.spinIndicatorBallElement.style.animation;
      if (existingAnimation) {
        // If horizontal animation is already applied, add vertical
        this.spinIndicatorBallElement.style.animation = `${existingAnimation}, spinBallVertical ${animationDuration}s ease-in-out infinite`;
      } else {
        this.spinIndicatorBallElement.style.animation = `spinBallVertical ${animationDuration}s ease-in-out infinite`;
      }
    }
  }
  
  /**
   * Stop the spin animation
   */
  stopSpinAnimation() {
    // Remove any existing animation style element
    const existingStyle = document.getElementById('spin-animations');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Reset the ball animation using class reference
    if (this.spinIndicatorBallElement) {
      this.spinIndicatorBallElement.style.animation = 'none';
    }
  }
  
  /**
   * Hide the spin indicator
   */
  hideSpinIndicator() {
    const spinIndicator = document.getElementById('spin-indicator');
    if (spinIndicator) {
      spinIndicator.style.display = 'none';
      this.stopSpinAnimation();
    }
  }
  
  /**
   * Update spin marker position in the spin selector
   * @param {number} x - X position (-1 to 1, 0 is center)
   * @param {number} y - Y position (-1 to 1, 0 is center)
   */
  updateSpinMarker(x, y) {
    if (!this.spinMarkerElement) return;
    
    // Calculate pixel position from normalized coordinates
    // The spin area is 200px in diameter, so 100px radius
    const radius = 100;
    const pixelX = x * radius;
    const pixelY = y * radius;
    
    // Update marker position
    this.spinMarkerElement.style.transform = `translate(calc(-50% + ${pixelX}px), calc(-50% + ${pixelY}px))`;
    
    // Update stored values
    this.spinValues = { x, y };
    
    // Also update the spin indicator if it's visible
    if (this.spinIndicatorElement && this.spinIndicatorElement.style.display !== 'none') {
      this.updateSpinIndicator();
    }
  }
}

export default UI; 
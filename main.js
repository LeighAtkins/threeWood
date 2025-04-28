import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Game from './src/game.js';

// Create scene for the title screen
const titleScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// WebGL renderer for 3D elements
const webGLRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
webGLRenderer.setSize(window.innerWidth, window.innerHeight);
webGLRenderer.setPixelRatio(window.devicePixelRatio);
webGLRenderer.setClearColor(0x000000, 1);
webGLRenderer.domElement.style.position = 'absolute';
webGLRenderer.domElement.style.top = 0;
webGLRenderer.domElement.style.zIndex = '1'; // Ensure proper z-index
document.getElementById('container').appendChild(webGLRenderer.domElement);

// CSS3D renderer for the title text
const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
cssRenderer.domElement.style.position = 'absolute';
cssRenderer.domElement.style.top = 0;
cssRenderer.domElement.style.pointerEvents = 'none';
cssRenderer.domElement.style.zIndex = '2'; // Ensure proper z-index
document.getElementById('container').appendChild(cssRenderer.domElement);

// Create a rotating cube for the title screen
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ 
  color: 0xFFD700, // Gold color
  wireframe: true // PS1-style wireframe look
});
const cube = new THREE.Mesh(geometry, material);
titleScene.add(cube);

// Add ambient lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
titleScene.add(ambientLight);

// Add directional lighting 
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
titleScene.add(directionalLight);

// Variables to track state
let isGameStarted = false;
let isTransitioning = false;
let game = null;
let transitionStartTime = 0;
const TRANSITION_DURATION = 1000; // 1 second transition

// Create loading text element
const loadingElement = document.createElement('div');
loadingElement.id = 'loading-text';
loadingElement.textContent = 'LOADING...';
loadingElement.style.position = 'absolute';
loadingElement.style.top = '60%';
loadingElement.style.width = '100%';
loadingElement.style.textAlign = 'center';
loadingElement.style.color = '#FFD700';
loadingElement.style.fontFamily = 'Lato, sans-serif';
loadingElement.style.fontSize = '2rem';
loadingElement.style.fontWeight = 'bold';
loadingElement.style.zIndex = '150';
loadingElement.style.opacity = '0';
loadingElement.style.transition = 'opacity 0.3s ease-in-out';
document.body.appendChild(loadingElement);

// Create visual click feedback element
const clickFeedback = document.createElement('div');
clickFeedback.id = 'click-feedback';
clickFeedback.style.position = 'absolute';
clickFeedback.style.bottom = '10%';
clickFeedback.style.width = '100%';
clickFeedback.style.textAlign = 'center';
clickFeedback.style.color = '#FFD700';
clickFeedback.style.fontFamily = 'Lato, sans-serif';
clickFeedback.style.fontSize = '1.5rem';
clickFeedback.style.zIndex = '150';
clickFeedback.style.opacity = '0';
clickFeedback.style.transition = 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out';
clickFeedback.textContent = 'STARTING GAME...';
document.body.appendChild(clickFeedback);

// Handle window resize
window.addEventListener('resize', () => {
  console.log("Window resize event detected in main.js");
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  webGLRenderer.setSize(width, height);
  cssRenderer.setSize(width, height);
  
  // If game is active, ensure it renders properly
  if (game && game.renderer) {
    game.renderer.setSize(width, height);
    console.log("Game renderer size updated in resize handler");
  }
});

// Handle click events to start the game
window.addEventListener('click', handleStartInput);
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    handleStartInput();
  }
});

// Handle game start input
function handleStartInput() {
  if (!isGameStarted && !isTransitioning) {
    // Play click sound
    playClickSound();
    
    // Start transition
    startGameTransition();
  }
}

// Play click sound
function playClickSound() {
  // Create simple click sound
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.value = 800;
    gainNode.gain.value = 0.1;
    
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (e) {
    console.error("Error playing sound:", e);
  }
}

// Start game transition
function startGameTransition() {
  if (isTransitioning) return;
  
  console.log("Starting game transition");
  isTransitioning = true;
  transitionStartTime = Date.now();
  
  // Show click feedback
  clickFeedback.style.opacity = '1';
  clickFeedback.style.transform = 'translateY(-20px)';
  
  // Modify title and info element style for transition
  const titleElement = document.getElementById('title');
  const infoElement = document.getElementById('info');
  
  if (titleElement) {
    titleElement.style.animation = 'none';
    titleElement.style.transform = 'perspective(400px) rotateX(5deg) scale(1.1)';
    titleElement.style.transition = 'transform 1s ease-out, opacity 1s ease-out';
    titleElement.style.opacity = '0.5';
  }
  
  if (infoElement) {
    infoElement.style.animation = 'none';
    infoElement.style.opacity = '0';
    infoElement.style.transition = 'opacity 0.5s ease-out';
  }
  
  // After a short delay, show loading and initialize game
  setTimeout(() => {
    // Hide feedback, show loading
    clickFeedback.style.opacity = '0';
    loadingElement.style.opacity = '1';
    
    // Preload game assets
    setTimeout(() => {
      // Initialize game
      try {
        console.log("Creating game instance");
        game = new Game();
        
        // Remove event listeners
        window.removeEventListener('click', handleStartInput);
        window.removeEventListener('keydown', handleStartInput);
        
        // Complete transition
        finishTransition();
      } catch (error) {
        console.error("Error initializing game:", error);
      }
    }, 500);
  }, 500);
}

// Finish transition to game
function finishTransition() {
  console.log("Finishing transition animation");
  
  // Hide title elements with animation
  const titleElement = document.getElementById('title');
  if (titleElement) {
    titleElement.style.opacity = '0';
    titleElement.style.transform = 'perspective(400px) rotateX(30deg) scale(0.5)';
  }
  
  // Zoom cube animation
  const zoomDuration = 800; // ms
  const startTime = Date.now();
  
  function animateZoom() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / zoomDuration, 1);
    
    // Move camera closer to cube
    camera.position.z = 5 - progress * 4;
    
    // Scale and spin cube faster
    cube.scale.set(1 + progress * 10, 1 + progress * 10, 1 + progress * 10);
    cube.rotation.x += 0.02;
    cube.rotation.y += 0.04;
    
    // Render the updated scene
    webGLRenderer.render(titleScene, camera);
    
    if (progress < 1) {
      requestAnimationFrame(animateZoom);
    } else {
      // Complete transition
      completeTransition();
    }
  }
  
  // Start zoom animation
  animateZoom();
}

// Complete transition to game
function completeTransition() {
  console.log("Completing transition to game");
  
  // Hide loading text
  loadingElement.style.opacity = '0';
  
  // Hide title elements
  const titleElement = document.getElementById('title');
  const infoElement = document.getElementById('info');
  
  if (titleElement) titleElement.style.display = 'none';
  if (infoElement) infoElement.style.display = 'none';
  
  // Mark game as started
  isGameStarted = true;
  
  // Stop title animation
  cancelAnimationFrame(animationId);
  
  // Cleanup loading elements after transition
  setTimeout(() => {
    if (loadingElement.parentNode) {
      loadingElement.parentNode.removeChild(loadingElement);
    }
    if (clickFeedback.parentNode) {
      clickFeedback.parentNode.removeChild(clickFeedback);
    }
    
    // Force a window resize event to ensure the renderer updates correctly
    console.log("Forcing window resize to refresh game view");
    window.dispatchEvent(new Event('resize'));
    
    // Make sure game renderer is visible and properly sized
    if (game && game.renderer) {
      ensureGameVisible();
    }
  }, 500);
  
  console.log("Game transition completed");
}

// Function to ensure game is visible
function ensureGameVisible() {
  console.log("Ensuring game is visible");
  
  if (!game || !game.renderer) {
    console.error("Game or renderer not available");
    return;
  }
  
  // Make sure game renderer is visible and properly set up
  game.renderer.domElement.style.zIndex = '10';
  game.renderer.domElement.style.position = 'absolute';
  game.renderer.domElement.style.top = '0';
  game.renderer.domElement.style.left = '0';
  game.renderer.setSize(window.innerWidth, window.innerHeight);
  
  // Force a render
  if (game.scene && game.camera) {
    game.renderer.render(game.scene, game.camera);
    console.log("Forced initial game render");
  }
}

// Title screen animation
let animationId;
function animate() {
  animationId = requestAnimationFrame(animate);
  
  // Rotate the cube slowly
  cube.rotation.x += 0.005;
  cube.rotation.y += 0.01;
  
  // Render both scenes
  webGLRenderer.render(titleScene, camera);
  cssRenderer.render(new THREE.Scene(), camera); // Empty scene for CSS renderer
}

// Start the title animation
animate();
/**
 * AudioManager handles all golf game sound effects
 * Maps sound effects to appropriate game events and hit strengths
 */
export class AudioManager {
  constructor() {
    this.sounds = {};
    this.volume = 0.7;
    this.enabled = true;
    
    // Define sound mappings based on file analysis
    this.soundMap = {
      // Hit strength based sounds
      weak: 'mixkit-quick-golf-hit-2121.wav',           // Power < 30
      moderate: 'mixkit-golf-ball-hit-2105.wav',        // Power 30-60
      strong: 'mixkit-hard-golf-swing-2119.wav',        // Power 60-80
      powerful: 'mixkit-powerful-golf-shot-2126.wav',   // Power > 80
      
      // Loft/trajectory based sounds
      sharp: 'mixkit-sharp-golf-hit-2122.wav',          // High loft (>25°)
      whistling: 'mixkit-golf-shot-with-whistle-2118.wav', // Fast, long shots
      airBreaking: 'mixkit-golf-shot-breaking-the-air-2124.wav', // Very fast shots
      
      // Surface interaction sounds
      bouncing: 'mixkit-golf-ball-bouncing-2075.wav',   // Hard surface hits
      metalHit: 'mixkit-golf-metal-shot-2123.wav',      // Bridge/metal surface
      
      // General swing sounds
      swing: 'mixkit-golf-ball-swing-2117.wav',         // Swing sound
      shortShot: 'mixkit-short-golf-shot-2127.wav',     // Very short putts
      quickShot: 'mixkit-quick-shot-golf-2125.wav',     // Quick follow-up shots
      generalHit: 'mixkit-hitting-golf-ball-2080.wav',  // Fallback hit sound
      hardHit: 'mixkit-golf-ball-hard-hit-2120.wav'     // Alternative hard hit
    };
    
    // Zolopher sound effects for high-power hits (>80% power)
    this.zolophers = [
      '75204__zolopher__golf-10.wav',
      '75205__zolopher__golf-11.wav', 
      '75206__zolopher__golf-12.wav',
      '75207__zolopher__golf-13.wav',
      '75209__zolopher__golf-15.wav',
      '75210__zolopher__golf-16.wav',
      '75211__zolopher__golf-2.wav',
      '75213__zolopher__golf-4.wav',
      '75215__zolopher__golf-6.wav'
    ];
    
    this.loadSounds();
  }
  
  /**
   * Load all sound files
   */
  loadSounds() {
    const basePath = 'src/sfx/';
    
    // Load standard sound effects
    Object.entries(this.soundMap).forEach(([key, filename]) => {
      const audio = new Audio();
      audio.src = basePath + filename;
      audio.volume = this.volume;
      audio.preload = 'auto';
      
      // Handle loading errors gracefully
      audio.addEventListener('error', (e) => {
        console.warn(`Failed to load audio: ${filename}`, e);
      });
      
      this.sounds[key] = audio;
    });
    
    // Load Zolopher sound effects for high-power hits
    this.zolophers.forEach((filename, index) => {
      const audio = new Audio();
      audio.src = basePath + filename;
      audio.volume = this.volume;
      audio.preload = 'auto';
      
      // Handle loading errors gracefully
      audio.addEventListener('error', (e) => {
        console.warn(`Failed to load Zolopher audio: ${filename}`, e);
      });
      
      this.sounds[`zolopher_${index}`] = audio;
    });
  }
  
  /**
   * Play appropriate sound based on golf shot parameters
   * @param {number} power - Shot power (0-100)
   * @param {number} loft - Loft angle in degrees
   * @param {number} speed - Ball speed in m/s
   * @param {string} surfaceType - Surface type (fairway, green, rough, etc.)
   */
  playHitSound(power, loft = 0, speed = 0, surfaceType = 'fairway') {
    if (!this.enabled) return;
    
    let soundKey = 'generalHit'; // Default fallback
    
    // For high-power hits (>80% power), use random Zolopher sound
    if (power > 80) {
      const randomIndex = Math.floor(Math.random() * this.zolophers.length);
      soundKey = `zolopher_${randomIndex}`;
      this.playSound(soundKey);
      return;
    }
    
    // Determine primary sound based on power
    if (power < 20) {
      soundKey = 'shortShot';
    } else if (power < 30) {
      soundKey = 'weak';
    } else if (power < 60) {
      soundKey = 'moderate';
    } else if (power < 80) {
      soundKey = 'strong';
    } else {
      soundKey = 'powerful';
    }
    
    // Override based on loft for high shots (but not for >80% power)
    if (loft > 25 && power <= 80) {
      soundKey = 'sharp';
    }
    
    // Override based on speed for special effects (but not for >80% power)
    if (power <= 80) {
      if (speed > 25) {
        soundKey = 'whistling';
      } else if (speed > 30) {
        soundKey = 'airBreaking';
      }
    }
    
    this.playSound(soundKey);
  }
  
  /**
   * Play surface interaction sound
   * @param {string} surfaceType - Type of surface hit
   * @param {number} impactForce - Force of impact
   */
  playSurfaceSound(surfaceType, impactForce = 1) {
    if (!this.enabled) return;
    
    let soundKey = 'bouncing'; // Default bounce
    
    switch (surfaceType) {
      case 'bridge':
      case 'metal':
        soundKey = 'metalHit';
        break;
      case 'water':
        // Water splash is handled separately in terrain
        return;
      case 'bunker':
      case 'rough':
        if (impactForce > 2) {
          soundKey = 'bouncing';
        }
        break;
      case 'green':
      case 'fairway':
        if (impactForce > 3) {
          soundKey = 'bouncing';
        }
        break;
    }
    
    this.playSound(soundKey);
  }
  
  /**
   * Play swing sound (before ball is hit)
   */
  playSwingSound() {
    if (!this.enabled) return;
    this.playSound('swing');
  }
  
  /**
   * Play a specific sound by key
   * @param {string} soundKey - Key from soundMap
   */
  playSound(soundKey) {
    if (!this.enabled || !this.sounds[soundKey]) return;
    
    const sound = this.sounds[soundKey];
    
    // Reset and play
    sound.currentTime = 0;
    sound.play().catch(e => {
      console.warn(`Failed to play sound: ${soundKey}`, e);
    });
  }
  
  /**
   * Set master volume
   * @param {number} volume - Volume level (0-1)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    Object.values(this.sounds).forEach(sound => {
      sound.volume = this.volume;
    });
  }
  
  /**
   * Toggle audio on/off
   * @param {boolean} enabled - Whether audio is enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  
  /**
   * Stop all currently playing sounds
   */
  stopAll() {
    Object.values(this.sounds).forEach(sound => {
      sound.pause();
      sound.currentTime = 0;
    });
  }
}
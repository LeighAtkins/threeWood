/**
 * Advanced Water Surface Effects with Custom Shaders
 * Implements realistic water with reflections, ripples, and depth effects
 */

import * as THREE from 'three';

// Vertex shader for water surface
const waterVertexShader = `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWaveFrequency;
  uniform float uWaveSpeed;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec4 vScreenPosition;
  
  void main() {
    vUv = uv;
    
    // Calculate wave effect
    float waveX = sin(position.x * uWaveFrequency + uTime * uWaveSpeed) * 
                  sin(position.z * uWaveFrequency * 0.8 + uTime * uWaveSpeed * 0.8) * 
                  uWaveHeight;
    float waveZ = sin(position.z * uWaveFrequency + uTime * uWaveSpeed) * 
                  sin(position.x * uWaveFrequency * 0.6 + uTime * uWaveSpeed * 1.2) * 
                  uWaveHeight;
    
    // Apply wave displacement
    vec3 newPosition = position + vec3(0.0, waveX + waveZ, 0.0);
    
    // Calculate normal based on wave derivatives
    vec3 tangent = normalize(vec3(1.0, 
      cos(position.x * uWaveFrequency + uTime * uWaveSpeed) * 
      cos(position.z * uWaveFrequency * 0.8 + uTime * uWaveSpeed * 0.8) * 
      uWaveFrequency * uWaveHeight, 
      0.0));
    
    vec3 bitangent = normalize(vec3(0.0, 
      cos(position.z * uWaveFrequency + uTime * uWaveSpeed) * 
      cos(position.x * uWaveFrequency * 0.6 + uTime * uWaveSpeed * 1.2) * 
      uWaveFrequency * uWaveHeight, 
      1.0));
    
    vNormal = normalize(cross(tangent, bitangent));
    
    // Set varying variables for fragment shader
    vPosition = newPosition;
    vWorldPosition = (modelMatrix * vec4(newPosition, 1.0)).xyz;
    
    // Calculate screen position for reflections
    vec4 modelViewPosition = modelViewMatrix * vec4(newPosition, 1.0);
    vScreenPosition = projectionMatrix * modelViewPosition;
    
    gl_Position = vScreenPosition;
  }
`;

// Fragment shader for water surface
const waterFragmentShader = `
  uniform float uTime;
  uniform vec3 uWaterColor;
  uniform vec3 uWaterDeepColor;
  uniform float uColorOffset;
  uniform float uColorScale;
  uniform float uDepthScale;
  uniform float uShininess;
  uniform float uOpacity;
  uniform float uReflectivity;
  uniform sampler2D uNormalMap;
  uniform sampler2D uReflectionMap;
  uniform sampler2D uRefractionMap;
  uniform sampler2D uDepthMap;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec4 vScreenPosition;
  
  void main() {
    // Calculate screen coordinates for reflection/refraction texture lookup
    vec2 screenUV = (vScreenPosition.xy / vScreenPosition.w) * 0.5 + 0.5;
    
    // Sample normal map and apply animation
    vec2 normalUV = vUv * 5.0; // Tiling
    vec2 normalUV1 = normalUV + vec2(uTime * 0.03, uTime * 0.01);
    vec2 normalUV2 = normalUV * 1.2 + vec2(-uTime * 0.04, uTime * 0.02);
    
    // We'll use normal maps when integrated with the game
    vec3 normalColor1 = vec3(0.5, 0.5, 1.0); // Placeholder
    vec3 normalColor2 = vec3(0.5, 0.5, 1.0); // Placeholder
    
    // Combine normal maps
    vec3 normalMap = normalize(normalColor1 + normalColor2 - 1.0);
    
    // Calculate fresnel effect (more reflective at glancing angles)
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(0.0, dot(viewDirection, vNormal)), 5.0) * uReflectivity;
    
    // Distort reflection/refraction based on normal map
    vec2 reflectionUV = screenUV + normalMap.xy * 0.05;
    vec2 refractionUV = screenUV + normalMap.xy * 0.03;
    
    // We'll use actual reflection/refraction textures when integrated
    vec3 reflectionColor = vec3(0.2, 0.3, 0.8); // Placeholder sky color
    vec3 refractionColor = mix(uWaterDeepColor, uWaterColor, 0.5); // Placeholder
    
    // Depth-based water color
    float depth = 1.0; // Placeholder, will use actual depth
    float waterDepth = clamp(depth * uDepthScale, 0.0, 1.0);
    vec3 depthColor = mix(uWaterColor, uWaterDeepColor, waterDepth);
    
    // Combine reflection and refraction based on fresnel
    vec3 finalColor = mix(depthColor, reflectionColor, fresnel);
    
    // Add specular highlight
    vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
    vec3 halfDir = normalize(lightDir + viewDirection);
    float specular = pow(max(0.0, dot(vNormal, halfDir)), uShininess);
    finalColor += specular * 0.5;
    
    // Apply subtle wave pattern to color
    float colorWave = sin(vPosition.x * 2.0 + vPosition.z * 2.0 + uTime * 0.5) * 0.05;
    finalColor += colorWave;
    
    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

/**
 * Creates a water surface with advanced shader effects
 */
class WaterSurface {
  constructor(scene, options = {}) {
    this.scene = scene;
    
    // Default options
    this.options = {
      width: 400,
      length: 400,
      segmentsW: 100,
      segmentsL: 100,
      waterLevel: -0.8,
      waterColor: options.waterColor || new THREE.Color(0x4466aa),
      waterDeepColor: options.waterDeepColor || new THREE.Color(0x223366),
      waveHeight: 0.2,
      waveFrequency: 0.05,
      waveSpeed: 0.5,
      shininess: 100,
      opacity: 0.8,
      reflectivity: 0.7
    };
    
    // Merge options
    if (options) {
      Object.keys(options).forEach(key => {
        if (key !== 'waterColor' && key !== 'waterDeepColor') {
          this.options[key] = options[key];
        }
      });
    }
    
    this.init();
  }
  
  init() {
    // Create geometry
    const geometry = new THREE.PlaneGeometry(
      this.options.width,
      this.options.length,
      this.options.segmentsW,
      this.options.segmentsL
    );
    
    // Rotate to be horizontal (XZ plane)
    geometry.rotateX(-Math.PI / 2);
    
    // Position at water level
    geometry.translate(0, this.options.waterLevel, 0);
    
    // Create shader material
    this.uniforms = {
      uTime: { value: 0 },
      uWaterColor: { value: this.options.waterColor },
      uWaterDeepColor: { value: this.options.waterDeepColor },
      uWaveHeight: { value: this.options.waveHeight },
      uWaveFrequency: { value: this.options.waveFrequency },
      uWaveSpeed: { value: this.options.waveSpeed },
      uColorOffset: { value: 0.05 },
      uColorScale: { value: 0.5 },
      uDepthScale: { value: 0.4 },
      uShininess: { value: this.options.shininess },
      uOpacity: { value: this.options.opacity },
      uReflectivity: { value: this.options.reflectivity },
      // These textures will be set when we implement the full reflection system
      uNormalMap: { value: null },
      uReflectionMap: { value: null },
      uRefractionMap: { value: null },
      uDepthMap: { value: null }
    };
    
    // Create shader material
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      transparent: true,
      side: THREE.DoubleSide
    });
    
    // Create mesh
    this.waterMesh = new THREE.Mesh(geometry, material);
    this.waterMesh.name = 'waterSurface';
    
    // Add to scene
    this.scene.add(this.waterMesh);
    
    // Setup for physics interaction
    this.setupPhysicsInteraction();
  }
  
  /**
   * Setup physics interaction with the water surface
   */
  setupPhysicsInteraction() {
    // This will be implemented in a future step
    // It will handle ball-water collisions and create splash effects
  }
  
  /**
   * Update water simulation
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    if (this.uniforms) {
      this.uniforms.uTime.value += deltaTime;
    }
  }
  
  /**
   * Set water wave properties
   * @param {Object} waveProps - Wave properties to update
   */
  setWaveProperties(waveProps) {
    if (waveProps.height !== undefined) {
      this.uniforms.uWaveHeight.value = waveProps.height;
    }
    if (waveProps.frequency !== undefined) {
      this.uniforms.uWaveFrequency.value = waveProps.frequency;
    }
    if (waveProps.speed !== undefined) {
      this.uniforms.uWaveSpeed.value = waveProps.speed;
    }
  }
  
  /**
   * Set water visual properties
   * @param {Object} visualProps - Visual properties to update
   */
  setVisualProperties(visualProps) {
    if (visualProps.waterColor) {
      this.uniforms.uWaterColor.value = new THREE.Color(visualProps.waterColor);
    }
    if (visualProps.waterDeepColor) {
      this.uniforms.uWaterDeepColor.value = new THREE.Color(visualProps.waterDeepColor);
    }
    if (visualProps.opacity !== undefined) {
      this.uniforms.uOpacity.value = visualProps.opacity;
    }
    if (visualProps.reflectivity !== undefined) {
      this.uniforms.uReflectivity.value = visualProps.reflectivity;
    }
    if (visualProps.shininess !== undefined) {
      this.uniforms.uShininess.value = visualProps.shininess;
    }
  }
  
  /**
   * Create a splash effect at the specified position
   * @param {THREE.Vector3} position - Position of the splash
   * @param {number} force - Force of the impact (0-1)
   */
  createSplash(position, force) {
    // This will be implemented in a future step
    console.log(`Water splash at (${position.x}, ${position.y}, ${position.z}) with force ${force}`);
  }
}

export { WaterSurface };

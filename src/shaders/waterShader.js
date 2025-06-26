const waterVertexShader = `
    uniform float time;
    uniform float waveFrequency;
    uniform float waveAmplitude;
    uniform float waterLevel;

    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
        vNormal = normal;
        vPosition = position;

        vec3 newPosition = position;
        // Simple sine wave for demonstration
        newPosition.y = waterLevel + sin(position.x * waveFrequency + time) * waveAmplitude + cos(position.z * waveFrequency * 0.8 + time * 1.2) * waveAmplitude * 0.7;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
`;

const waterFragmentShader = `
    uniform vec3 waterColor;
    uniform float opacity;
    uniform float time;

    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
        // Basic water color with some light reflection based on normal
        vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.5)); // Example light direction
        float diffuse = max(dot(vNormal, lightDirection), 0.0);
        vec3 color = waterColor * (0.3 + diffuse * 0.7);

        // Simple reflection/specular effect based on camera angle
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        vec3 reflection = reflect(-viewDirection, vNormal);
        float spec = pow(max(dot(reflection, lightDirection), 0.0), 32.0);
        color += vec3(spec);

        gl_FragColor = vec4(color, opacity);
    }
`;

export { waterVertexShader, waterFragmentShader };

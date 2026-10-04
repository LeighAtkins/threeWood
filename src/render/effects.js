import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/**
 * Shot feedback: the aim arc and landing ring, the putt line and slope beads,
 * the ball trail, and one pooled particle system for every puff, splash and
 * confetti burst in the game.
 */

// --- Fat polylines (aim arc, putt line, trail) --------------------------------

class Ribbon {
  constructor(scene, { color, width, dashed = false, opacity = 1, depthTest = true, vertexColors = false }) {
    this.material = new LineMaterial({
      color, linewidth: width, transparent: true, opacity, dashed, vertexColors,
      dashSize: 2.2, gapSize: 1.6, depthTest, depthWrite: false,
    });
    this.geometry = new LineGeometry();
    this.line = new Line2(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = 5;
    scene.add(this.line);
  }

  /** points: flat [x, y, z, ...]; colors optional flat [r, g, b, ...]. */
  set(points, colors) {
    if (points.length < 6) { this.line.visible = false; return; }
    // LineGeometry cannot grow in place: swap in a fresh one
    this.geometry.dispose();
    this.geometry = new LineGeometry();
    this.geometry.setPositions(points);
    if (colors) this.geometry.setColors(colors);
    this.line.geometry = this.geometry;
    if (this.material.dashed) this.line.computeLineDistances();
    this.line.visible = true;
  }

  hide() { this.line.visible = false; }

  resize(w, h) { this.material.resolution.set(w, h); }
}

// --- Particles -------------------------------------------------------------------

const MAX_PARTICLES = 420;

class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.baseSize = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    this.cursor = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          if (dot(d, d) > 0.25) discard;
          gl_FragColor = vec4(vColor, 1.0);
        }`,
    });
    this.material = material;
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, size, life, gravity = 9) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.baseSize[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.gravity[i] = gravity;
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] = this.baseSize[i] * Math.min(1, t * 2.5);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

// --- Slope beads (green reading aid) -----------------------------------------------

const MAX_BEADS = 260;

class SlopeBeads {
  constructor(scene) {
    const geo = new THREE.CircleGeometry(0.1, 6).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(
      geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), MAX_BEADS);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.beads = [];
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  /** Lay beads over the green between the ball and the cup. */
  layout(world, ball) {
    this.beads.length = 0;
    const cup = world.cup;
    const dx = cup.x - ball.x, dz = cup.z - ball.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const step = len > 16 ? 1.3 : 0.95;
    const halfWide = Math.min(7, 3.5 + len * 0.18);
    const g = [0, 0];
    for (let a = -3; a <= len + 4 && this.beads.length < MAX_BEADS; a += step) {
      for (let s = -halfWide; s <= halfWide && this.beads.length < MAX_BEADS; s += step) {
        const x = ball.x + ux * a - uz * s, z = ball.z + uz * a + ux * s;
        const surface = world.surfaceAt(x, z);
        if (surface !== 'green' && surface !== 'fringe') continue;
        world.gradAt(x, z, g);
        const slope = Math.hypot(g[0], g[1]);
        this.beads.push({
          x, z, slope,
          // Downhill direction
          dx: slope > 1e-5 ? -g[0] / slope : 0,
          dz: slope > 1e-5 ? -g[1] / slope : 0,
          phase: (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1,
          span: step,
        });
      }
    }
    this.mesh.count = this.beads.length;
    this.world = world;
    this.mesh.visible = this.beads.length > 0;
  }

  update(time) {
    if (!this.mesh.visible) return;
    const d = this.dummy;
    for (let i = 0; i < this.beads.length; i++) {
      const b = this.beads[i];
      // Beads drift downhill; steeper = faster and hotter
      const speed = 0.25 + b.slope * 26;
      const t = ((time * speed + Math.abs(b.phase) * b.span) % b.span) - b.span / 2;
      const x = b.x + b.dx * t, z = b.z + b.dz * t;
      d.position.set(x, this.world.heightAt(x, z) + 0.02, z);
      const fade = 1 - Math.abs(t) / (b.span / 2);
      d.scale.setScalar(0.35 + fade * 0.75);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      const heat = Math.min(1, b.slope / 0.045);
      this.color.setRGB(1, 1 - heat * 0.55, 1 - heat * 0.9);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  hide() { this.mesh.visible = false; }
}

// --- Facade -----------------------------------------------------------------------

const SURFACE_PUFF = {
  fairway: 0x86c860, tee: 0x86c860, fringe: 0x9bd86a, green: 0xa9e66f,
  rough: 0x5a8f45, bunker: 0xf3e2b0, water: 0xcfefff,
};
const CONFETTI = [0xff4d6d, 0xffd23f, 0x3bceac, 0x4d9de0, 0xffffff, 0xff8c42];

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.aimArc = new Ribbon(scene, { color: 0xffffff, width: 3.5, dashed: true, opacity: 0.9, depthTest: false });
    this.puttLine = new Ribbon(scene, { color: 0xffffff, width: 4.5, opacity: 0.95, depthTest: false, vertexColors: true });
    this.trail = new Ribbon(scene, { color: 0xffffff, width: 5, opacity: 0.9, vertexColors: true });
    this.particles = new Particles(scene);
    this.beads = new SlopeBeads(scene);
    this.tmpColor = new THREE.Color();

    // Landing ring + beacon
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), ringMat);
    this.ringDot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16).rotateX(-Math.PI / 2), ringMat);
    this.ring.add(this.ringDot);
    // Beacon: a soft pillar of light so the landing spot reads from 200 yards
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.3, 14, 8, 1, true).translate(0, 7, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.ring.add(this.beam);
    this.ring.renderOrder = 4;
    this.ring.visible = false;
    scene.add(this.ring);

    this.trailPts = [];
    this.trailColor = new THREE.Color(0xffffff);
  }

  resize(w, h, pixelRatio) {
    this.aimArc.resize(w, h);
    this.puttLine.resize(w, h);
    this.trail.resize(w, h);
    this.particles.material.uniforms.uScale.value = h * pixelRatio * 0.9;
  }

  // Aim preview -------------------------------------------------------------
  showAim(points, landX, landY, landZ, cameraDist) {
    this.aimArc.set(points);
    this.ring.position.set(landX, landY + 0.12, landZ);
    this.ring.scale.setScalar(Math.max(1.2, cameraDist * 0.03));
    this.ring.visible = true;
  }

  showPutt(points, holed) {
    const n = points.length / 3;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      // White at the ball, fading to gold (or green when the read drops)
      colors[i * 3] = holed ? 1 - t * 0.6 : 1;
      colors[i * 3 + 1] = holed ? 1 : 1 - t * 0.18;
      colors[i * 3 + 2] = holed ? 1 - t * 0.5 : 1 - t * 0.75;
    }
    const lifted = points.slice();
    for (let i = 1; i < lifted.length; i += 3) lifted[i] += 0.03;
    this.puttLine.set(lifted, colors);
  }

  hideAim() {
    this.aimArc.hide();
    this.puttLine.hide();
    this.ring.visible = false;
  }

  // Trail --------------------------------------------------------------------
  startTrail(color) {
    this.trailPts.length = 0;
    this.trailColor.set(color);
    this.trail.hide();
  }

  addTrailPoint(x, y, z) {
    const p = this.trailPts;
    p.push(x, y, z);
    if (p.length > 90 * 3) p.splice(0, 3);
    const n = p.length / 3;
    if (n < 2) return;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = Math.pow(i / (n - 1), 1.5);
      colors[i * 3] = this.trailColor.r * t;
      colors[i * 3 + 1] = this.trailColor.g * t;
      colors[i * 3 + 2] = this.trailColor.b * t;
    }
    this.trail.set(p, colors);
    this.trail.material.blending = THREE.AdditiveBlending;
  }

  endTrail() { this.trail.hide(); }

  // Bursts -------------------------------------------------------------------
  puff(x, y, z, surface, strength = 1) {
    const c = this.tmpColor.setHex(SURFACE_PUFF[surface] ?? 0xffffff);
    const n = Math.round(8 + strength * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 1.8) * strength;
      this.particles.emit(x, y + 0.05, z, Math.cos(a) * s, 1.2 + Math.random() * 2.6 * strength, Math.sin(a) * s,
        c, 0.1 + Math.random() * 0.12, 0.45 + Math.random() * 0.4);
    }
  }

  splash(x, y, z) {
    const c = this.tmpColor.setHex(0xe6f7ff);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.5 + Math.random() * 2.2;
      this.particles.emit(x, y, z, Math.cos(a) * s, 3 + Math.random() * 5.5, Math.sin(a) * s,
        c, 0.12 + Math.random() * 0.16, 0.7 + Math.random() * 0.5);
    }
  }

  strikeFlash(x, y, z, gold) {
    const c = this.tmpColor.setHex(gold ? 0xffd84a : 0xffffff);
    for (let i = 0; i < (gold ? 26 : 12); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 4;
      this.particles.emit(x, y, z, Math.cos(a) * s, Math.random() * 3, Math.sin(a) * s,
        c, 0.08 + Math.random() * 0.1, 0.25 + Math.random() * 0.25, 2);
    }
  }

  confetti(x, y, z, amount = 90) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 2.6;
      const c = this.tmpColor.setHex(CONFETTI[i % CONFETTI.length]);
      this.particles.emit(x, y + 0.1, z, Math.cos(a) * s, 4 + Math.random() * 4.5, Math.sin(a) * s,
        c, 0.1 + Math.random() * 0.1, 1.3 + Math.random() * 0.9, 5.5);
    }
  }

  update(dt, time) {
    this.particles.update(dt);
    this.beads.update(time);
    if (this.ring.visible) {
      const pulse = 1 + Math.sin(time * 5) * 0.06;
      this.ringDot.scale.setScalar(pulse);
    }
  }
}

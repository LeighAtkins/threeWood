import * as THREE from 'three';
import {
  sunPosition, moonPosition, sunDay, hourOfAltitude, atLocalHour, localHour, localPlace,
} from '../core/almanac.js';

/**
 * The sky, and everything the sky does to the course.
 *
 * It is the real sky over the player: the sun and moon stand where they
 * stand outside their window right now, and the whole scene is lit to match.
 * One number does most of the work — the sun's height above the horizon —
 * which picks a palette from the keyframes below (dawn and dusk differ, so
 * each key may carry an `am` variant). The palette drives the dome shader,
 * the key light (sun by day, moon by night), the fill light, fog and exposure.
 */

const DEG = 180 / Math.PI;
const MODE_KEY = 'threewood.sky.v1';

/** Live follows the clock; the rest pin today's sky to a moment worth seeing. */
export const SKY_MODES = ['live', 'dawn', 'day', 'golden', 'dusk', 'night'];

// Colours are sRGB hex. `alt` is the sun's altitude in degrees.
//   zenith/mid/horizon  the dome gradient          fog      distance haze (and the dome's rim)
//   glow                scatter around the sun     disc     the sun itself
//   sun/sunI            key light                  hemi/hemiI  fill from the sky
//   cloud/cloudLit      shaded and sunlit cloud    bounce   how much the ground throws back
//   dim                 brightness of unlit things (water)
const KEYS = [
  {
    alt: -18,
    zenith: 0x030716, mid: 0x08102a, horizon: 0x16224a, fog: 0x131d3c,
    glow: 0x000000, disc: 0xff4a2a, anti: 0,
    sun: 0xff6a2e, sunI: 0, hemi: 0x4660b0, hemiI: 1.0, bounce: 0.3,
    cloud: 0x0e1428, cloudLit: 0x2a3860, stars: 1, exposure: 1.2, dim: 0.3,
    fogNear: 110, fogFar: 600,
  },
  {
    alt: -9,
    zenith: 0x08122f, mid: 0x1a2250, horizon: 0x503a68, fog: 0x2c2a52,
    glow: 0x7a3048, disc: 0xff4a2a, anti: 0,
    sun: 0xff6a2e, sunI: 0, hemi: 0x5c68b8, hemiI: 1.35, bounce: 0.5,
    cloud: 0x1a1c3a, cloudLit: 0x64486e, stars: 0.8, exposure: 1.2, dim: 0.4,
    fogNear: 110, fogFar: 600,
    am: { horizon: 0x3a4a80, fog: 0x283460, glow: 0x44529a, cloudLit: 0x4c5a90 },
  },
  {
    alt: -4,
    zenith: 0x172c6a, mid: 0x6c4a8c, horizon: 0xf2783e, fog: 0x8c5c76,
    glow: 0xff5622, disc: 0xff4a2a, anti: 0.35,
    sun: 0xff6a2e, sunI: 0, hemi: 0x9c8cd0, hemiI: 1.9, bounce: 0.9,
    cloud: 0x34284e, cloudLit: 0xff7052, stars: 0.3, exposure: 1.3, dim: 0.6,
    fogNear: 120, fogFar: 610,
    am: { mid: 0x6660a8, horizon: 0xf29c9c, fog: 0x86789c, glow: 0xff8686, cloudLit: 0xff9cac, fogNear: 60, fogFar: 430 },
  },
  {
    alt: 0,
    zenith: 0x2a54a4, mid: 0xdc8684, horizon: 0xffa646, fog: 0xe89c72,
    glow: 0xff6418, disc: 0xff6a30, anti: 0.55,
    sun: 0xff7a38, sunI: 2.8, hemi: 0xb4a4dc, hemiI: 1.8, bounce: 1,
    cloud: 0x4e3a5e, cloudLit: 0xff9450, stars: 0.05, exposure: 1.3, dim: 0.82,
    fogNear: 130, fogFar: 620,
    am: { mid: 0xd8a6c6, horizon: 0xffc6a2, fog: 0xe6c0c2, glow: 0xff9872, cloudLit: 0xffb6a6, sun: 0xff9a76, disc: 0xff9a70, fogNear: 45, fogFar: 380 },
  },
  {
    alt: 5,
    zenith: 0x3470c6, mid: 0xb2b6da, horizon: 0xffcc84, fog: 0xf4cc9c,
    glow: 0xff9632, disc: 0xffc070, anti: 0.2,
    sun: 0xffa650, sunI: 3.5, hemi: 0xb6c2f2, hemiI: 1.35, bounce: 1,
    cloud: 0x5c5068, cloudLit: 0xffce9c, stars: 0, exposure: 1.2, dim: 0.95,
    fogNear: 140, fogFar: 630,
    am: { mid: 0xc6cae8, horizon: 0xffe0c6, fog: 0xf2dcd6, glow: 0xffbe96, cloudLit: 0xffe0d0, sun: 0xffc08e, disc: 0xffd8a8, fogNear: 55, fogFar: 420 },
  },
  {
    alt: 12,
    zenith: 0x3a80dc, mid: 0x8ec0f0, horizon: 0xf4e4c4, fog: 0xeadfc8,
    glow: 0xffd08a, disc: 0xfff0c8, anti: 0,
    sun: 0xffd9a0, sunI: 2.7, hemi: 0xc0d4ff, hemiI: 1.1, bounce: 1,
    cloud: 0x666672, cloudLit: 0xfff2e0, stars: 0, exposure: 1.12, dim: 1,
    fogNear: 150, fogFar: 640,
    am: { horizon: 0xf0ecdc, fog: 0xe6e6dc, fogNear: 100, fogFar: 540 },
  },
  {
    alt: 30,
    zenith: 0x2f86e0, mid: 0x7fbdf2, horizon: 0xcfeaff, fog: 0xcfe6f5,
    glow: 0xfff4d6, disc: 0xfffdf0, anti: 0,
    sun: 0xfff1d6, sunI: 2.4, hemi: 0xbfdcff, hemiI: 1.0, bounce: 1,
    cloud: 0x666666, cloudLit: 0xffffff, stars: 0, exposure: 1.12, dim: 1,
    fogNear: 150, fogFar: 640,
  },
  {
    alt: 65,
    zenith: 0x1f72d6, mid: 0x5eaaf0, horizon: 0xbfe2ff, fog: 0xc4e2f8,
    glow: 0xffffff, disc: 0xffffff, anti: 0,
    sun: 0xfffaf0, sunI: 2.6, hemi: 0xc4e0ff, hemiI: 1.05, bounce: 1,
    cloud: 0x6a6a6c, cloudLit: 0xffffff, stars: 0, exposure: 1.12, dim: 1,
    fogNear: 150, fogFar: 640,
  },
];

const COLOR_FIELDS = ['zenith', 'mid', 'horizon', 'fog', 'glow', 'disc', 'sun', 'hemi', 'cloud', 'cloudLit'];
const SCALAR_FIELDS = ['anti', 'sunI', 'hemiI', 'bounce', 'stars', 'exposure', 'dim', 'fogNear', 'fogFar'];

// Each key resolved to [evening, morning] values, colours in working space
const STOPS = KEYS.map((key) => {
  const stop = { alt: key.alt };
  for (const f of COLOR_FIELDS) stop[f] = [new THREE.Color(key[f]), new THREE.Color(key.am?.[f] ?? key[f])];
  for (const f of SCALAR_FIELDS) stop[f] = [key[f], key.am?.[f] ?? key[f]];
  return stop;
});

const MOONLIGHT = new THREE.Color(0x9ab6ff);
const ANTI = new THREE.Color(0xe89ab4);
const NO_MOON_DIR = new THREE.Vector3(0.3, 0.8, 0.4).normalize();
const MIN_LIGHT_ALT = 20 / DEG; // lower than this and the ground goes dark and shadows run for miles

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Compass bearing + elevation to a world direction: north is -z, east is +x. */
function toDir(out, azimuth, altitude) {
  const c = Math.cos(altitude);
  return out.set(Math.sin(azimuth) * c, Math.sin(altitude), -Math.cos(azimuth) * c);
}

const DOME_VERTEX = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 1200.0, 1.0);
    gl_Position = p.xyww;
  }`;

const DOME_FRAGMENT = /* glsl */`
  uniform vec3 uZenith, uMid, uHorizon, uFog, uGlow, uDisc, uAnti, uCloud, uCloudLit, uMoonTint;
  uniform vec3 uSunDir, uMoonDir, uLightDir;
  uniform mat3 uStarRot;
  uniform vec2 uDrift;
  uniform float uStars, uAntiAmount, uCover, uMoon, uTime;
  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
    return s;
  }

  // One layer of stars: a jittered point in some cells of a grid wrapped round the sphere
  float starLayer(vec3 d, float scale, float density, float size) {
    vec3 p = d * scale;
    vec3 id = floor(p);
    float h = hash31(id);
    if (h < 1.0 - density) return 0.0;
    vec3 centre = vec3(hash31(id + 3.1), hash31(id + 7.7), hash31(id + 11.3)) * 0.5 + 0.25;
    float spark = smoothstep(size, 0.0, length(fract(p) - centre));
    float rank = fract(h * 91.7);
    float twinkle = 0.72 + 0.28 * sin(uTime * (1.5 + rank * 4.0) + h * 80.0);
    return spark * (0.35 + 0.65 * rank * rank) * twinkle;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);

    // Atmosphere: three bands, with the colour packed low where the camera looks
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
    col = mix(col, uZenith, smoothstep(0.1, 0.72, h));

    float sunDot = max(dot(d, uSunDir), 0.0);
    float low = 1.0 - smoothstep(0.0, 0.5, d.y);

    // Opposite the sun at twilight: the pink band above the earth's shadow
    vec2 flat2 = normalize(d.xz + 1e-5), sun2 = normalize(uSunDir.xz + 1e-5);
    float away = pow(max(dot(flat2, -sun2), 0.0), 1.5);
    col = mix(col, uAnti, uAntiAmount * away * smoothstep(0.03, 0.12, d.y) * (1.0 - smoothstep(0.14, 0.4, d.y)));

    // Stars and the Milky Way turn about the pole
    if (uStars > 0.01) {
      vec3 s = uStarRot * d;
      float stars = starLayer(s, 70.0, 0.1, 0.16);
      #ifdef RICH
        stars += starLayer(s, 150.0, 0.14, 0.2) * 0.6;
        float band = exp(-pow(dot(s, vec3(0.48, 0.6, 0.64)) * 3.2, 2.0));
        col += vec3(0.34, 0.4, 0.62) * band * fbm(s.xy * 5.0 + s.z * 3.0) * 0.16 * uStars;
      #endif
      col += vec3(0.9, 0.95, 1.0) * stars * uStars * smoothstep(0.02, 0.3, d.y);
    }

    // Moon: a little lit sphere, so its phase and tilt are simply correct
    if (uMoon > 0.0) {
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
      vec3 up = cross(uMoonDir, right);
      vec2 q = vec2(dot(d, right), dot(d, up)) / 0.042;
      float r2 = dot(q, q);
      float facing = dot(d, uMoonDir);
      if (facing > 0.0) {
        float halo = exp(-r2 * 0.11) * 0.28 + exp(-r2 * 0.012) * 0.07;
        col += uMoonTint * halo * uMoon;
        if (r2 < 1.0) {
          vec3 n = right * q.x + up * q.y - uMoonDir * sqrt(1.0 - r2);
          float lit = smoothstep(-0.05, 0.12, dot(n, uSunDir));
          float seas = 0.82 + 0.18 * smoothstep(0.35, 0.6, vnoise(q * 2.3 + 4.0));
          vec3 face = uMoonTint * (0.05 + 1.25 * lit) * seas;
          col = mix(col, face, smoothstep(1.0, 0.86, r2) * (0.1 + 0.9 * uMoon));
        }
      }
    }

    // Sun: scatter hugging the horizon, a tight halo, then the disc, fatter as it sets
    col += uGlow * (pow(sunDot, 5.0) * 0.4 * low + pow(sunDot, 48.0) * 0.45);
    float size = mix(0.9993, 0.9984, low * low);
    float discEdge = smoothstep(size, size + 0.00035, sunDot);
    col = mix(col, uDisc * 1.25, discEdge * step(-0.06, uSunDir.y));
    col += uDisc * pow(sunDot, 900.0) * 0.5;

    // High cloud, drifting on the hole's wind and lit from the key light
    if (d.y > 0.0 && uCover > 0.0) {
      vec2 uv = d.xz / (d.y + 0.14) * 1.15 + uDrift;
      float n = fbm(uv);
      float detail = fbm(uv * 2.9 + 31.0);
      float c = smoothstep(1.0 - uCover, 1.32 - uCover, n * 0.78 + detail * 0.3 + 0.12);
      c *= smoothstep(0.015, 0.2, d.y);
      float toward = pow(max(dot(d, uLightDir), 0.0), 4.0);
      vec3 cc = mix(uCloud, uCloudLit, clamp(0.3 + (n - 0.45) * 1.6 + toward * 0.8, 0.0, 1.0));
      cc += uGlow * toward * 0.35;
      col = mix(col, cc, c * 0.9);
    }

    // The rim of the dome is the fog, so the far hills dissolve into it
    col = mix(uFog, col, smoothstep(-0.012, 0.07, d.y));

    col += (hash21(gl_FragCoord.xy) - 0.5) / 180.0; // dither: night gradients band badly
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <colorspace_fragment>
  }`;

export class Sky {
  constructor({ scene, renderer, sun, hemi, lowDetail = false }) {
    this.scene = scene;
    this.renderer = renderer;
    this.sun = sun;
    this.hemi = hemi;

    const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    this.place = localPlace();
    // ?place=lat,lon — stand somewhere else (for seeing other people's skies)
    const [lat, lon] = (query.get('place') || '').split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) this.place = { lat, lon, name: '', source: 'url' };

    // ?date=2026-09-26 — borrow another day's sun and moon
    const day = Date.parse(`${query.get('date')}T12:00:00`);
    this.dateShift = Number.isFinite(day) ? atLocalHour(new Date(day), 0) - atLocalHour(new Date(), 0) : 0;

    // ?sky=dusk or ?sky=17.5 (a local hour) pins the sky for this visit only
    const pinned = query.get('sky');
    this.fixedHour = pinned !== null && pinned !== '' && Number.isFinite(Number(pinned)) ? Number(pinned) : null;
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch { /* private mode */ }
    this.mode = SKY_MODES.includes(pinned) ? pinned : SKY_MODES.includes(saved) ? saved : 'live';

    // What the rest of the game reads
    this.lightDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.night = 0;       // 0 day .. 1 full night
    this.dim = 1;         // brightness of unlit surfaces
    this.altitude = 0;    // sun, degrees
    this.evening = 1;
    this.look = {};       // the current palette
    for (const f of COLOR_FIELDS) this.look[f] = new THREE.Color();
    this.lightColor = new THREE.Color();
    this.tint = new THREE.Color();

    this.ground = new THREE.Color(0x86a85a);
    this.haze = new THREE.Color(0xcfe6f5);
    this.hazeAmount = 0;
    this.drift = new THREE.Vector2();
    this.wind = new THREE.Vector2(0.004, 0.002);

    this.uniforms = {
      uZenith: { value: this.look.zenith }, uMid: { value: this.look.mid },
      uHorizon: { value: this.look.horizon }, uFog: { value: this.look.fog },
      uGlow: { value: this.look.glow }, uDisc: { value: this.look.disc },
      uCloud: { value: this.look.cloud }, uCloudLit: { value: this.look.cloudLit },
      uAnti: { value: ANTI }, uAntiAmount: { value: 0 },
      uMoonTint: { value: new THREE.Color(0xe6ecff) }, uMoon: { value: 0 },
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uLightDir: { value: this.lightDir },
      uStarRot: { value: new THREE.Matrix3() },
      uDrift: { value: this.drift }, uCover: { value: 0.45 },
      uStars: { value: 0 }, uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 3),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
        defines: lowDetail ? { OCTAVES: 3 } : { OCTAVES: 4, RICH: '' },
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
      }));
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.name = 'sky';
    scene.add(this.dome);

    this.hour = this.targetHour();
    this._a = new THREE.Color();
    this._b = new THREE.Color();
    this._m4 = new THREE.Matrix4();
    this._pole = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.update(0, 0);
  }

  // --- Time ---------------------------------------------------------------------

  now() { return new Date(Date.now() + this.dateShift); }

  /** Today's landmarks, recomputed when the date rolls over. */
  day(now = this.now()) {
    const stamp = now.toDateString();
    if (this._dayStamp !== stamp) {
      this._dayStamp = stamp;
      this._day = sunDay(now, this.place.lat, this.place.lon);
    }
    return this._day;
  }

  /** The local hour the sky should be showing. */
  targetHour(now = this.now()) {
    if (this.fixedHour !== null) return this.fixedHour;
    if (this.mode === 'live') return localHour(now);
    const { lat, lon } = this.place;
    const { noon, high } = this.day(now);
    const at = (deg, evening) => hourOfAltitude(now, lat, lon, deg / DEG, evening ? noon : noon - 12, evening ? noon + 12 : noon);
    switch (this.mode) {
      case 'dawn': return at(-1.5, false);
      case 'day': return at(Math.min(42, high * DEG * 0.8), false);
      case 'golden': return at(6, true);
      case 'dusk': return at(-2.5, true);
      default: return at(-20, true);
    }
  }

  setMode(mode) {
    this.mode = SKY_MODES.includes(mode) ? mode : 'live';
    this.fixedHour = null;
    try { localStorage.setItem(MODE_KEY, this.mode); } catch { /* private mode */ }
  }

  /** Step to the next mode; returns it. */
  cycleMode() {
    this.setMode(SKY_MODES[(SKY_MODES.indexOf(this.mode) + 1) % SKY_MODES.length]);
    return this.mode;
  }

  // --- Per hole --------------------------------------------------------------------

  /** A hole brings its own ground bounce, haze, wind and cloud cover. */
  setHole(world) {
    const { biome, spec } = world;
    this.ground.setHex(biome.hemiGround);
    this.haze.setHex(biome.haze);
    this.hazeAmount = biome.hazeAmount;
    const [lo, hi] = biome.cloud;
    // Cheap, stable variety: the same hole always has the same sky cover
    const k = Math.abs(Math.sin(spec.number * 12.9898 + spec.length * 0.37)) % 1;
    this.uniforms.uCover.value = lo + (hi - lo) * k;
    this.wind.set(spec.wind.x, spec.wind.z).multiplyScalar(0.0011).addScalar(0.0015);
  }

  // --- Frame -----------------------------------------------------------------------

  update(dt, time) {
    const now = this.now();
    // Ease towards the target hour the short way round, so changing mode
    // sweeps the sun across the sky rather than cutting
    let target = this.targetHour(now);
    target += Math.round((this.hour - target) / 24) * 24;
    const gap = target - this.hour;
    this.hour = Math.abs(gap) < 0.002 || dt === 0 ? target : this.hour + gap * (1 - Math.exp(-dt * 2.2));

    const { lat, lon } = this.place;
    const date = atLocalHour(now, this.hour);
    const sun = sunPosition(date, lat, lon);
    const moon = moonPosition(date, lat, lon);
    const alt = sun.altitude * DEG;
    this.altitude = alt;
    toDir(this.sunDir, sun.azimuth, sun.altitude);
    toDir(this.moonDir, moon.azimuth, moon.altitude);
    this.evening = smooth(0.15, -0.15, this.sunDir.x);
    this.moonFraction = moon.fraction;
    this.moonUp = smooth(-3, 6, moon.altitude * DEG);

    this.sample(alt, this.evening);
    const look = this.look;
    this.night = smooth(-4, -11, alt);
    const day = smooth(4, 22, alt);

    // The biome's own air, by day
    look.fog.lerp(this.haze, this.hazeAmount * day);
    look.horizon.lerp(this.haze, this.hazeAmount * day * 0.7);

    // Key light: the sun until it is well down, then the moon (or starlight)
    const moonlight = (0.2 + 0.8 * moon.fraction) * this.moonUp;
    const nightI = this.night * (0.55 + 0.75 * moonlight);
    if (alt > -4) {
      toDir(this.lightDir, sun.azimuth, Math.max(sun.altitude, MIN_LIGHT_ALT));
      this.lightColor.copy(look.sun);
      this.sun.intensity = look.sunI;
    } else {
      toDir(this._v, moon.azimuth, Math.max(moon.altitude, MIN_LIGHT_ALT * 1.3));
      this.lightDir.copy(NO_MOON_DIR).lerp(this._v, this.moonUp).normalize();
      this.lightColor.copy(MOONLIGHT);
      this.sun.intensity = nightI;
    }
    this.sun.color.copy(this.lightColor);
    this.hemi.color.copy(look.hemi);
    this.hemi.groundColor.copy(this.ground).multiplyScalar(look.bounce);
    this.hemi.intensity = look.hemiI;

    const fog = this.scene.fog;
    fog.color.copy(look.fog);
    fog.near = look.fogNear;
    fog.far = look.fogFar;
    this.renderer.toneMappingExposure = look.exposure;
    this.dim = look.dim;
    this.tint.setRGB(1, 1, 1).lerp(look.hemi, this.night * 0.8).multiplyScalar(look.dim);

    // Dome
    const u = this.uniforms;
    u.uTime.value = time;
    u.uStars.value = look.stars;
    u.uAntiAmount.value = look.anti;
    u.uMoon.value = this.moonUp * (0.25 + 0.75 * smooth(6, -6, alt));
    this.drift.addScaledVector(this.wind, dt);
    // Stars hold still against the turning earth: spin them about the pole
    this._pole.set(0, Math.sin(lat / DEG), -Math.cos(lat / DEG));
    const turn = ((+date / 86164090.5) % 1) * Math.PI * 2;
    u.uStarRot.value.setFromMatrix4(this._m4.makeRotationAxis(this._pole, turn));
  }

  /** Blend the palette for a sun altitude (degrees) into `this.look`. */
  sample(alt, evening) {
    let i = 0;
    while (i < STOPS.length - 2 && alt >= STOPS[i + 1].alt) i++;
    const a = STOPS[i], b = STOPS[i + 1];
    const t = smooth(a.alt, b.alt, alt);
    const am = 1 - evening;
    for (const f of COLOR_FIELDS) {
      this._a.copy(a[f][0]).lerp(a[f][1], am);
      this._b.copy(b[f][0]).lerp(b[f][1], am);
      this.look[f].copy(this._a).lerp(this._b, t);
    }
    for (const f of SCALAR_FIELDS) {
      const from = a[f][0] + (a[f][1] - a[f][0]) * am;
      const to = b[f][0] + (b[f][1] - b[f][0]) * am;
      this.look[f] = from + (to - from) * t;
    }
  }

  // --- Words -----------------------------------------------------------------------

  /** What to call this light. */
  phase() {
    const a = this.altitude, pm = this.evening > 0.5;
    if (a < -9) return this.moonUp > 0.5 && this.moonFraction > 0.4 ? 'MOONLIGHT' : 'STARLIGHT';
    if (a < -1) return pm ? 'DUSK' : 'DAWN';
    if (a < 4) return pm ? 'SUNSET' : 'SUNRISE';
    if (a < 12) return 'GOLDEN HOUR';
    return pm ? 'AFTERNOON' : 'MORNING';
  }

  /** One line for the title screen: the light, the place, and what the sun does next. */
  describe(now = this.now()) {
    const parts = [this.mode === 'live' && this.fixedHour === null ? 'LIVE SKY' : 'SKY'];
    parts.push(this.place.name ? `${this.phase()} IN ${this.place.name.toUpperCase()}` : this.phase());
    const { rise, set } = this.day(now);
    if (this.mode === 'live' && this.fixedHour === null && rise != null) {
      const h = localHour(now);
      const clock = (hour) => atLocalHour(now, hour).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase();
      parts.push(h > rise && h < set ? `SUNSET ${clock(set)}` : `SUNRISE ${clock(rise)}`);
    }
    return parts.join(' · ');
  }
}

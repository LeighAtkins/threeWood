import * as THREE from 'three';
import { createGameRng, getSeedFromUrl, generateSeed } from './core/rng.js';
import {
  createBall, copyBall, placeBall, launchBall, puttBall, stepBall, SIM_DT, BALL_R,
} from './core/ballSim.js';
import { CLUBS, PUTTER, autoSelectClub, clubAllowed, distanceAt, lieFor, powerFor } from './core/clubs.js';
import {
  createSwing, startSwing, swingClick, swingStep, strikeFromTiming, describeStrike, markerToPercent, SWING,
} from './core/swing.js';
import {
  buildLaunch, previewShot, previewPutt, puttSpeedFor, puttMeterMax, puttSpeedAt, slopeAlong,
} from './core/shotPlanner.js';
import { designHole, roundHoles, ARCHETYPES, ROUND_PLAN } from './course/holeDesigner.js';
import { buildWorld, aimTarget } from './course/courseWorld.js';
import { BIOMES } from './course/biomes.js';
import { buildTerrainMesh } from './render/terrainMesh.js';
import { buildScenery, updateScenery, updateFlag, disposeGroup, setSceneryViewport } from './render/scenery.js';
import { Effects } from './render/effects.js';
import { Sky } from './render/sky.js';
import { CameraRig } from './render/cameraRig.js';
import { ClubRig } from './render/club.js';
import {
  playerLevel, assistsFor, nextHeat, difficultyPips, caddieTip, challengeFor, newHoleLog,
} from './core/progression.js';
import { Hud, scoreName } from './ui/hud.js';
import { Fishing } from './ui/fishing.js';
import { Audio } from './audio.js';
import { Music } from './music.js';

const SAVE_KEY = 'threewood.save.v2';
const BEST_KEY = 'threewood.best.v2';
const HINT_KEY = 'threewood.hints.v2';
const DAILY_KEY = 'threewood.daily.v1';

/** Everyone gets the same course each day. */
function dailySeed() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `DAILY-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const PUTT_METER_RATE = 82;   // meter units per second while holding PUTT
const INTRO_TIME = 4.6;

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const feet = (yards) => Math.max(1, Math.round(yards * 3));

/**
 * The game: owns the scene, the round, and the per-shot state machine.
 *
 *   title -> intro -> aim -> swing -> flight -> (settle -> aim)* -> holed -> result -> intro ...
 */
export class Game {
  constructor(container) {
    this.container = container;
    this.coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1600);
    this.rig = new CameraRig(this.camera);
    this.initRenderer();
    this.initLights();
    this.sky = new Sky({ scene: this.scene, renderer: this.renderer, sun: this.sun, hemi: this.hemi, lowDetail: this.coarse });

    this.effects = new Effects(this.scene);
    this.clubRig = new ClubRig(this.scene);
    this.follow = null; // follow-through animation after a strike
    this.audio = new Audio();
    this.music = new Music(this.audio);
    this.hud = new Hud({
      onSwingDown: () => this.swingDown(),
      onSwingUp: () => this.swingUp(),
      onClub: (dir) => this.cycleClub(dir),
      onMenu: () => this.openMenu(),
      onStart: (choice) => this.startFromTitle(choice),
      onMusic: () => this.toggleMusic(),
    });
    this.fishing = new Fishing(this.hud.root, this.hud.layer);
    this.initBall();
    this.initInput();

    this.state = 'title';
    this.paused = false;
    this.time = 0;
    this.stateTime = 0;
    this.timeScale = 1;
    this.simAccumulator = 0;
    this.events = [];
    this.swing = createSwing();
    this.hints = { swing: 0, putt: 0, spin: 0, fish: 0, ...(store.get(HINT_KEY) || {}) };

    this.seedPinned = !!getSeedFromUrl();
    this.seed = getSeedFromUrl() || store.get(SAVE_KEY)?.seed || generateSeed();
    this.round = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      this.clock.getDelta();
      if (document.visibilityState === 'visible' && this.round) this.keepAwake();
    });

    this.showTitle();
    this.clock = new THREE.Clock();
    this.frameTimes = [];
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);

    window.THREEWOOD = this; // debug + automated play-testing hook
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this.coarse ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
  }

  initLights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.3);
    this.sun.castShadow = true;
    const size = this.coarse ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.near = 20; cam.far = 700;
    cam.left = -95; cam.right = 95; cam.top = 95; cam.bottom = -95;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1);
    this.scene.add(this.hemi);
    // Colours, direction and fog distances all belong to the sky
    this.scene.fog = new THREE.Fog(0xffffff, 150, 640);
  }

  initBall() {
    this.ball = createBall();
    // A proper ball: round, dimpled, and marked so you can see it spin
    const skin = document.createElement('canvas');
    skin.width = 256; skin.height = 128;
    const ctx = skin.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#dfe3e6';
    for (let row = 0; row < 9; row++) {
      const v = (row + 0.5) / 9, count = Math.max(4, Math.round(22 * Math.sin(v * Math.PI)));
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.ellipse(((i + (row % 2) * 0.5) / count) * 256, v * 128, 3.4 / Math.max(0.35, Math.sin(v * Math.PI)), 3.4, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(96, 60, 64, 8);            // alignment stripe
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(220, 52, 14, 24);          // a second mark, so every spin axis shows
    const map = new THREE.CanvasTexture(skin);
    map.colorSpace = THREE.SRGBColorSpace;
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 24, 16),
      new THREE.MeshStandardMaterial({ map, roughness: 0.4, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.42 }));
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
    // Blob shadow: the depth cue that makes ball flight readable
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    this.blob.renderOrder = 2;
    this.scene.add(this.blob);
    this.ballScale = 1.4;
    this.sink = 0;
  }

  initInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0 };
      try { c.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const prevY = drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy));
      drag.x = e.clientX; drag.y = e.clientY;
      if (this.state === 'aim' && !this.paused) {
        // Putts need a jeweller's touch; full shots a quicker turn
        const base = this.putting ? 0.0011 : 0.003;
        this.aimAngle += dx * base * (420 / Math.max(320, Math.min(window.innerWidth, 900)));
        this.planDirty = true;
        if (drag.moved > 14) this.hud.demo(null); // they have got it
      } else if (this.state === 'flight' && !this.paused) {
        this.afterTouch(dx, e.clientY - prevY);
      }
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const tap = drag.moved < 12 && performance.now() - drag.t < 400;
      drag = null;
      if (tap) this.tap();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    for (const type of ['pointerdown', 'touchend', 'click']) {
      document.addEventListener(type, () => { this.audio.unlock(); this.music.wake(); }, { capture: true, passive: true });
    }

    this.keys = {};
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.audio.unlock();
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (this.state === 'intro') this.tap(); else this.swingDown();
      } else if (e.code === 'ArrowUp') this.cycleClub(-1);
      else if (e.code === 'ArrowDown') this.cycleClub(1);
      else if (e.code === 'Escape') { if (this.paused) this.closeMenu(); else this.openMenu(); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Space' || e.code === 'Enter') this.swingUp();
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
    this.effects.resize(w, h, this.pixelRatio);
    setSceneryViewport(h * this.pixelRatio);
  }

  // ===========================================================================
  // Title / round lifecycle
  // ===========================================================================

  showTitle() {
    this.state = 'title';
    this.music.setScene('title');
    this.round = null;
    this.hud.setPlayVisible(false);
    this.loadWorld(designHole(this.seed, 1));
    this.ballMesh.visible = this.blob.visible = false;
    const saved = store.get(SAVE_KEY);
    const usable = saved && saved.index < saved.holes.length;
    this.hud.showTitle({
      saved: usable ? { hole: saved.index + 1, total: saved.scores.reduce((s, h) => s + h.strokes - h.par, 0) - 2 * (saved.gold || 0) } : null,
      best: store.get(BEST_KEY),
      daily: store.get(DAILY_KEY)?.[dailySeed()] ?? null,
      seed: this.seed,
      music: this.music.enabled,
      sky: this.sky.describe(),
    });
    this.rig.cut();
  }

  startFromTitle(choice) {
    this.audio.unlock();
    this.audio.tap();
    if (choice === 'fishing') { this.practiceFishing(() => this.showTitle()); return; }
    const saved = store.get(SAVE_KEY);
    if (choice === 'continue' && saved) {
      this.seed = saved.seed;
      this.round = saved;
    } else {
      if (choice === 'daily') {
        this.seed = dailySeed();
      } else if (!this.seedPinned && saved && saved.seed === this.seed) {
        // Abandoning a round: grow a new course rather than replaying it
        this.seed = generateSeed();
      }
      const length = choice === 'daily' ? 18 : Number(choice);
      this.round = {
        daily: choice === 'daily',
        seed: this.seed,
        length,
        holes: roundHoles(length),
        index: 0,
        scores: [],
        points: 0,
        pureStreak: 0,
        stats: { fairways: 0, fairwayChances: 0, gir: 0, putts: 0, longestDrive: 0, longestPutt: 0, pures: 0, swings: 0 },
      };
      store.set(SAVE_KEY, this.round);
    }
    this.rng = createGameRng(`${this.seed}:play:${Date.now()}`).rng;
    this.hud.clearLayer();
    this.keepAwake();
    this.startHole();
  }

  /** Keep the screen on during a round (it is a long time between taps on a putt read). */
  async keepAwake() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* not supported or denied: fine */ }
  }

  /** Swap in a new hole's world, mesh and scenery. */
  loadWorld(spec) {
    if (this.terrain) {
      this.scene.remove(this.terrain, this.scenery.group);
      disposeGroup(this.terrain);
      disposeGroup(this.scenery.group);
    }
    this.world = buildWorld(spec);
    this.terrain = buildTerrainMesh(this.world);
    this.scenery = buildScenery(this.world, { lowDetail: this.coarse });
    this.scene.add(this.terrain, this.scenery.group);
    this.sky.setHole(this.world);
    this.rig.setWorld(this.world, this.scenery.placed);
    this.effects.hideAim();
    this.effects.beads.hide();
    this.effects.clearTrail();
    this.env = { windX: spec.wind.x, windZ: spec.wind.z };
  }

  startHole() {
    const round = this.round;
    const number = round.holes[round.index];
    const spec = designHole(round.seed, number);
    this.loadWorld(spec);

    this.strokes = 0;
    this.putts = 0;
    this.bonuses = [];
    this.holePoints = 0;
    placeBall(this.ball, this.world, this.world.tee.x, this.world.tee.z);
    this.ballMesh.visible = this.blob.visible = true;
    this.sink = 0;

    this.hud.setPlayVisible(true);
    this.hud.setControlsVisible(false);
    this.hud.setHole({ index: round.index + 1, total: round.holes.length, par: spec.par, yards: spec.length });
    this.hud.setPoints(round.points);
    this.updateScoreHud();
    // Where this hole sits on the ramp: what help is left, and what it asks
    this.level = playerLevel(round.index, round.holes.length, round.heat || 0);
    this.assists = assistsFor(this.level);
    const seenOfPar = round.scores.filter((h) => h.par === spec.par).length;
    this.challenge = challengeFor(spec.par, seenOfPar);
    this.holeLog = newHoleLog(spec.par);
    this.hud.setChallenge(this.challenge.text, null);
    this.hud.showIntro(this.introCard());
    this.landing = null;
    this.aimAngle = Math.atan2(this.world.cup.z - this.ball.z, this.world.cup.x - this.ball.x);
    this.hud.drawMinimap(this.world, this.ball, null);

    // Resuming mid-hole (the tab was closed on the 14th fairway): pick up
    // exactly where the ball was lying.
    const live = round.live;
    if (live && live.index === round.index && live.strokes > 0) {
      this.strokes = live.strokes;
      this.putts = live.putts;
      this.bonuses = live.bonuses || [];
      this.holePoints = live.holePoints || 0;
      if (live.holeLog) this.holeLog = live.holeLog;
      placeBall(this.ball, this.world, live.x, live.z);
      this.hud.clearLayer();
      this.beginAim();
      return;
    }
    this.setState('intro');
    this.rig.flyover(0);
    this.rig.cut();
    this.audio.whoosh();
  }

  introCard() {
    const { round } = this, spec = this.world.spec, arch = ARCHETYPES[spec.archetype];
    return {
      index: round.index + 1, total: round.holes.length,
      name: arch.label, blurb: arch.blurb, par: spec.par, yards: spec.length,
      biome: BIOMES[spec.biome].name,
      pips: difficultyPips(spec.difficulty ?? 0, this.level),
      wind: spec.wind.speed,
      tip: caddieTip(round.index, this.level),
      challenge: this.challenge,
    };
  }

  roundTotal() {
    return this.round.scores.reduce((s, h) => s + h.strokes - h.par, 0) - 2 * (this.round.gold || 0);
  }

  updateScoreHud(label) {
    this.hud.setScore({ strokes: this.strokes, total: this.roundTotal(), shotLabel: label });
  }

  cardData() {
    const round = this.round;
    return {
      currentLabel: round.holes[round.index],
      holes: round.holes.map((n, i) => ({
        label: n,
        par: ROUND_PLAN[n - 1].par,
        strokes: round.scores[i]?.strokes ?? null,
        current: i === round.index,
      })),
    };
  }

  setState(state) {
    if (state !== 'fishing' && this.fishing?.active) this.fishing.stop();
    this.state = state;
    this.stateTime = 0;
    this.music.setScene(state);
  }

  // ===========================================================================
  // Aiming
  // ===========================================================================

  get putting() { return this.club === PUTTER; }

  clubKind() {
    if (this.putting) return 'putter';
    return this.club.id === 'driver' || this.club.id === 'wood3' ? 'wood' : 'iron';
  }

  /** Swing angle for the club model, read straight off the meter. */
  updateClub(dt) {
    const { ball } = this;
    // Drawn large enough to read from the tee camera
    const camDist = Math.hypot(this.camera.position.x - ball.x, this.camera.position.y - ball.y, this.camera.position.z - ball.z);
    const size = Math.max(1.15, Math.min(2.3, camDist / 4.6));
    if (this.follow) {
      // Through the ball and up, then fade away
      const f = this.follow;
      f.t += dt;
      const k = Math.min(1, f.t / 0.26);
      const ease = 1 - (1 - k) * (1 - k);
      const theta = (f.putt ? 0.55 : 2.5) * ease;
      const fade = Math.max(0, 1 - Math.max(0, f.t - 0.45) / 0.3);
      this.clubRig.pose(f, f.dirX, f.dirZ, theta, f.kind, f.size, fade);
      if (fade <= 0) this.follow = null;
      return;
    }
    if (!this.round || (this.state !== 'aim' && this.state !== 'swing')) { this.clubRig.hide(); return; }
    const dirX = Math.cos(this.aimAngle), dirZ = Math.sin(this.aimAngle);
    let theta = Math.sin(this.time * 2.2) * 0.035; // waggle at address
    if (this.state === 'swing') {
      if (this.putting) {
        theta = -0.6 * (this.puttPower / 100);
      } else {
        const sw = this.swing;
        const reach = this.club.carry < 40 ? 1.3 : 2.7;
        const top = (p) => -reach * (0.3 + 0.7 * p / 100);
        if (sw.phase === 'power') {
          const p = sw.marker / 100;
          theta = -reach * (0.3 * Math.min(1, p * 4) + 0.7 * p);
        } else if (sw.phase === 'accuracy') {
          // Down from the top: the head reaches the ball as the marker
          // reaches the line (and swings past it if you are late)
          const span = Math.max(1, sw.power - SWING.LINE);
          const k = (sw.marker - SWING.LINE) / span;
          theta = top(sw.power) * (k >= 0 ? k * k : k * 0.6);
        }
      }
    }
    this.clubSize = size;
    this.clubRig.pose(ball, dirX, dirZ, theta, this.clubKind(), size, 1);
  }

  beginAim() {
    const { ball, world } = this;
    placeBall(ball, world, ball.x, ball.z);
    this.sink = 0;
    this.timeScale = 1;
    this.fastForward = false;
    this.onTee = this.strokes === 0;
    this.lie = lieFor(ball.surface);

    const toPin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    this.target = this.lie.id === 'green' ? { x: world.cup.x, z: world.cup.z, isPin: true } : aimTarget(world, ball.x, ball.z);
    this.targetDist = Math.hypot(this.target.x - ball.x, this.target.z - ball.z);
    this.aimAngle = Math.atan2(this.target.z - ball.z, this.target.x - ball.x);
    this.setClub(autoSelectClub(this.targetDist, this.lie, this.onTee));
    this.toPin = toPin;

    this.round.live = {
      index: this.round.index, x: ball.x, z: ball.z,
      strokes: this.strokes, putts: this.putts, bonuses: this.bonuses, holePoints: this.holePoints,
      holeLog: this.holeLog,
    };
    store.set(SAVE_KEY, this.round);

    this.blocked = false;
    this.effects.aimArc.material.color.setHex(0xffffff);
    this.setState('aim');
    this.swing.phase = 'idle';
    this.charging = false;
    this.hud.setControlsVisible(true);
    this.hud.setSwinging(false);
    this.hud.setCarry(null);
    this.updateScoreHud();
    this.rig.cut();
    this.ballScale = 1.4;
    this.showHint();
  }

  setClub(club) {
    this.club = club;
    this.planDirty = true;
    this.puttMax = null;
    if (this.putting) {
      // Putts always start aimed at the hole, whatever the path says
      this.target = { x: this.world.cup.x, z: this.world.cup.z, isPin: true };
      this.targetDist = Math.hypot(this.target.x - this.ball.x, this.target.z - this.ball.z);
      this.effects.beads.layout(this.world, this.ball);
    } else {
      this.effects.beads.hide();
    }
    this.refreshClubHud();
  }

  availableClubs() {
    return CLUBS.filter((c) => clubAllowed(c, this.lie, this.onTee));
  }

  cycleClub(dir) {
    if (this.state !== 'aim' || this.paused) return;
    const list = this.availableClubs();
    const i = list.indexOf(this.club);
    const next = list[Math.max(0, Math.min(list.length - 1, i + dir))];
    if (next && next !== this.club) {
      this.audio.tap();
      const wasPutting = this.putting;
      this.setClub(next);
      if (wasPutting !== this.putting) this.aimAngle = Math.atan2(this.world.cup.z - this.ball.z, this.world.cup.x - this.ball.x);
    }
  }

  refreshClubHud() {
    const lie = this.lie;
    const penalty = Math.round((1 - lie.speedFactor) * 100);
    const lieText = this.onTee ? 'TEE' : penalty ? `${lie.name.toUpperCase()} −${penalty}%` : lie.name.toUpperCase();
    if (this.putting) {
      this.hud.setClub({ name: 'Putter', yards: `${feet(this.targetDist)} ft to hole`, lie: lieText, canChange: this.availableClubs().length > 1 });
      this.hud.setAction('hold');
    } else {
      const max = Math.round(distanceAt(this.club, 100, lie.speedFactor));
      this.hud.setClub({ name: this.club.name, yards: `${max}y max`, lie: lieText, lieBad: penalty > 0, canChange: true });
      this.hud.setAction('swing', this.fullPower);
    }
  }

  /** The shot needs everything the club has: power sets itself, two taps. */
  get fullPower() { return !this.putting && !this.idealPower; }

  /** Recompute the shot preview for the current aim/club. */
  updatePlan() {
    const { ball, world } = this;
    const dirX = Math.cos(this.aimAngle), dirZ = Math.sin(this.aimAngle);
    this.dirX = dirX; this.dirZ = dirZ;

    if (this.putting) {
      const dist = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
      this.idealSpeed = puttSpeedFor(world, ball, dirX, dirZ, dist);
      if (!this.puttMax) this.puttMax = puttMeterMax(this.idealSpeed);
      this.idealPct = Math.min(96, (this.idealSpeed / this.puttMax) * 100);
      const preview = previewPutt(world, ball, dirX, dirZ, this.idealSpeed);
      this.effects.aimArc.hide();
      this.effects.ring.visible = false;
      const a = this.assists;
      const keep = Math.max(2, Math.ceil((preview.points.length / 3) * a.puttLine));
      this.effects.showPutt(preview.points.slice(0, keep * 3), a.confirmLine && preview.holed);
      this.landing = null;
      this.hud.showPuttMeter(this.idealPct);
      // A tick when the read is right (while that help lasts)
      this.hud.setMeterCaption(a.confirmLine && preview.holed ? 'ok' : '');
      this.hud.setMeterFlag(this.idealPct, 'release');
      this.hud.setMeterSteps(null);
    } else {
      const reach = distanceAt(this.club, 100, this.lie.speedFactor);
      // Near enough to everything the club has counts as a full shot: asking
      // for a tap a hair before the bar tops out is a trap, not a skill
      const want = reach >= this.targetDist ? powerFor(this.club, this.targetDist, this.lie.speedFactor) : null;
      this.idealPower = want && want < 96 ? want : null;
      this.slope = slopeAlong(world, ball, dirX, dirZ);
      const launch = buildLaunch({
        club: this.club, power: this.idealPower ?? 100, dirX, dirZ, lie: this.lie, slope: this.slope,
      });
      const preview = previewShot(world, ball, launch);
      if (preview.blocked !== this.blocked) {
        this.blocked = preview.blocked;
        this.effects.aimArc.material.color.setHex(preview.blocked ? 0xff5a3c : 0xffffff);
        if (this.state === 'aim') {
          if (preview.blocked) this.hud.demo('drag', { warn: '🌲' });
          else this.showHint();
        }
      }
      this.effects.puttLine.hide();
      this.landing = { x: preview.landX, y: preview.landY, z: preview.landZ };
      const camDist = Math.hypot(preview.landX - this.camera.position.x, preview.landZ - this.camera.position.z);
      this.effects.showAim(preview.points, preview.landX, world.heightAt(preview.landX, preview.landZ), preview.landZ, camDist);
      if (this.state === 'aim') { this.hud.hideMeter(); this.hud.setAction('swing', this.fullPower); }
    }
    this.planDirty = false;
  }

  showHint() {
    if (this.putting) {
      this.hud.demo(this.hints.putt < 3 ? 'drag' : null, { high: true });
    } else {
      this.hud.demo(this.hints.swing < 3 ? 'drag' : null);
    }
  }

  // ===========================================================================
  // Swing input
  // ===========================================================================

  /** Tap on the course (not a button). */
  tap() {
    if (this.paused) return;
    if (this.state === 'intro' && this.stateTime > 0.5) this.endIntro();
    else if (this.state === 'swing' && !this.putting) this.advanceSwing();
    else if (this.state === 'swing' && this.putting && this.puttLatched) this.releasePutt();
    else if (this.state === 'flight') this.fastForward = true;
    else if (this.state === 'result') this.nextHole?.();
  }

  swingDown() {
    if (this.paused) return;
    if (this.state === 'fishing') { this.fishing.tap(); return; }
    if (this.state === 'intro') { if (this.stateTime > 0.5) this.endIntro(); return; }
    if (this.state === 'flight') { this.fastForward = true; return; }
    if (this.state === 'aim') {
      this.coachHeld = null;
      if (this.planDirty) this.updatePlan();
      if (this.putting) {
        this.charging = true;
        this.coach = [ 'hold', 0.6 ][this.hints.putt] ?? null;
        this.puttLatched = false;
        this.puttPower = 0;
        this.puttDir = 1;
        this.setState('swing');
        this.hud.setAction('release');
        this.hud.setMeterFlag(this.idealPct, 'release');
        this.hud.setMeterSteps(null);
        this.hud.demo(null);
      } else {
        startSwing(this.swing);
        this.lockGrace = 0;
        // First swings are coached: the meter waits for you, then runs slow
        this.coach = [ 'hold', 0.6, 0.8 ][this.hints.swing] ?? null;
        this.setState('swing');
        this.hud.setSwinging(true);
        this.hud.showSwingMeter(this.idealPower, this.coach ? 1 : 1 / this.assists.tight);
        this.hud.setMeterSteps(2);
        if (this.idealPower) {
          this.hud.setMeterCaption('');
          this.hud.setMeterFlag(markerToPercent(this.idealPower), 'tap');
          this.hud.setAction('power');
        } else {
          // Full power: the bar fills itself to MAX, no second tap needed.
          // The one tap still to come is already marked, dimmed, on the line
          this.hud.setMeterCaption('');
          this.hud.setMeterAuto(true);
          this.hud.setMeterFlag(markerToPercent(SWING.LINE), 'tap', false, true);
          this.hud.setAction('wait');
        }
        this.hud.demo(null);
        this.audio.tap();
      }
    } else if (this.state === 'swing') {
      if (this.putting) { if (this.puttLatched) this.releasePutt(); } else this.advanceSwing();
    }
  }

  swingUp() {
    if (this.state !== 'swing' || !this.putting || !this.charging || this.puttLatched) return;
    if (this.stateTime < 0.22 || this.puttPower < 12) {
      // A quick tap rather than a hold: keep the bar running and let the
      // next tap play the stroke, so both habits work.
      this.puttLatched = true;
      this.hud.setAction('tap');
      this.hud.setMeterFlag(this.idealPct, 'tap');
      return;
    }
    this.releasePutt();
  }

  releasePutt() {
    this.charging = false;
    this.puttLatched = false;
    this.hitPutt(Math.max(4, this.puttPower));
  }

  advanceSwing() {
    // Swallow the over-eager tap right after power locks (a double tap, or a
    // tap that arrives as the bar tops out) so it cannot ruin the strike.
    if (this.lockGrace > 0) return;
    // Full-power shots lock themselves: taps on the way up are ignored
    if (this.swing.phase === 'power' && !this.idealPower) return;
    const event = swingClick(this.swing);
    if (event) this.handleSwingEvent(event);
  }

  handleSwingEvent(event) {
    if (event.type === 'powerLocked') {
      this.lockGrace = 0.2;
      this.audio.powerLock(event.power);
      this.hud.setAction('strike', !this.idealPower);
      this.hud.setMeterCaption('');
      this.hud.setMeterFlag(markerToPercent(SWING.LINE), 'tap');
      this.hud.setMeterSteps(3);
    } else if (event.type === 'strike') {
      this.hitShot(event.timing);
    }
  }

  /**
   * Swiping during a well-struck shot works the ball in the air: sideways
   * bends it, up/down takes spin off or puts it on. Something to do with your
   * thumb while the ball is flying.
   */
  afterTouch(dx, dy) {
    const { ball, shot } = this;
    if (!shot || shot.putt || !shot.shapeable || ball.mode !== 'air' || ball.landed) return;
    const k = 420 / Math.max(320, Math.min(window.innerWidth, 900));
    const side = Math.max(-1.3, Math.min(1.3, shot.bend + dx * 0.0045 * k));
    ball.side += side - shot.bend;
    shot.bend = side;
    const back = Math.max(-0.6, Math.min(0.9, shot.bite + dy * 0.004 * k));
    ball.back = Math.max(0, ball.back + (back - shot.bite));
    shot.bite = back;
    shot.replan = true;
    if (!shot.shaped) {
      shot.shaped = true;
      this.hud.demo(null);
      if (this.hints.spin < 4) { this.hints.spin += 1; store.set(HINT_KEY, this.hints); }
    }
  }

  // ===========================================================================
  // Hitting
  // ===========================================================================

  beginFlight(wasPutt) {
    const { ball } = this;
    this.shot = {
      putt: wasPutt,
      fromX: ball.x, fromZ: ball.z,
      fromSurface: this.onTee ? 'tee' : ball.surface,
      toPin: this.toPin,
      treeCalled: false,
      shapeable: false, bend: 0, bite: 0, replan: false, shaped: false,
    };
    this.follow = { t: 0, putt: wasPutt, dirX: this.dirX, dirZ: this.dirZ, x: ball.x, y: ball.y, z: ball.z, kind: this.clubKind(), size: this.clubSize || 1.3 };
    this.hud.setMeterFlag(null);
    this.hud.setMeterSteps(null);
    this.hud.setSwinging(false);
    this.strokes += 1;
    this.round.stats.swings += 1;
    this.updateScoreHud(`SHOT ${this.strokes}`);
    this.hud.hideMeter();
    this.hud.demo(null);
    this.hud.setControlsVisible(false);
    this.effects.hideAim();
    this.effects.beads.hide();
    this.setState('flight');
    this.simAccumulator = 0;
  }

  /** Dry-run the shot so the camera knows where the ball will end up. */
  planShot() {
    const b = copyBall(this.ball);
    const events = [];
    let t = 0, landTime = b.landed ? b.time : null;
    while ((b.mode === 'air' || b.mode === 'roll') && t < 40) {
      stepBall(b, this.world, this.env, SIM_DT, events);
      t += SIM_DT;
      if (landTime === null && b.landed) landTime = b.time;
    }
    return {
      landTime: landTime ?? b.time,
      time: t,
      restX: b.x, restZ: b.z,
      landX: b.landed ? b.landX : b.x, landZ: b.landed ? b.landZ : b.z,
      holed: b.mode === 'holed',
      lipout: events.some((e) => e.type === 'lipout'),
    };
  }

  hitShot(timing) {
    const { ball } = this;
    // Later in the round the same miss costs more
    const tight = this.coach ? 1 : this.assists.tight;
    const strike = strikeFromTiming(Math.max(-1, Math.min(1, timing * tight)), this.club.loft, this.rng);
    const launch = buildLaunch({
      club: this.club, power: this.swing.power, dirX: this.dirX, dirZ: this.dirZ,
      lie: this.lie, strike, scatter: this.rng() * 2 - 1, slope: this.slope,
    });
    this.beginFlight(false);
    launchBall(ball, launch);
    this.plan = this.planShot();
    this.shot.chase = this.plan.landTime > 2.1;
    // A decent strike can be worked in the air
    this.shot.shapeable = strike.grade === 'pure' || strike.grade === 'good';
    if (this.shot.shapeable && this.shot.chase && this.hints.spin < 4) {
      this.hud.demo('shape');
    }

    const pure = strike.grade === 'pure';
    this.audio.strike(this.swing.power, strike.grade);
    this.effects.strikeFlash(ball.x, ball.y, ball.z, pure);
    this.effects.startTrail(pure ? 0xffd84a : 0xffffff);
    this.rig.addShake(pure ? 0.22 : 0.12);
    this.hud.callout(describeStrike(strike), pure ? 'gold' : strike.grade === 'good' ? '' : 'bad');

    const round = this.round;
    if (pure) {
      round.pureStreak += 1;
      this.holeLog.pures += 1;
      round.stats.pures += 1;
      this.award(round.pureStreak > 1 ? `Pure strike ×${round.pureStreak}` : 'Pure strike', 50 * Math.min(5, round.pureStreak), true);
    } else {
      round.pureStreak = 0;
    }
    if (this.hints.swing < 3) { this.hints.swing += 1; store.set(HINT_KEY, this.hints); }
  }

  hitPutt(power) {
    const speed = puttSpeedAt(this.puttMax, power);
    this.beginFlight(true);
    this.putts += 1;
    this.round.stats.putts += 1;
    puttBall(this.ball, { speed, dirX: this.dirX, dirZ: this.dirZ });
    this.plan = this.planShot();
    this.audio.putt(speed);
    const off = (power - this.idealPct) / this.idealPct;
    if (Math.abs(off) < 0.06) this.hud.callout('PERFECT PACE', 'gold small');
    if (this.hints.putt < 3) { this.hints.putt += 1; store.set(HINT_KEY, this.hints); }
  }

  /** Add points; `now` pops it on screen immediately. */
  award(label, points, now = false) {
    this.bonuses.push({ label, points });
    this.holePoints += points;
    this.round.points += points;
    this.hud.setPoints(this.round.points, true);
    if (now) {
      this.hud.callout(`+${points}`, 'pts');
      this.audio.reward(this.bonuses.length);
    }
  }

  // ===========================================================================
  // Flight
  // ===========================================================================

  updateFlight(dt) {
    const { ball, world, plan, shot } = this;

    // Drama: slow the last moment of a putt that is going to scare the hole
    let scale = 1;
    const cupDist = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    if (shot.putt && (plan.holed || plan.lipout) && cupDist < 1.6 && cupDist > 0.2) scale = 0.4;
    else if (this.fastForward && ball.mode === 'roll') scale = 3;
    this.timeScale += (scale - this.timeScale) * Math.min(1, dt * 10);

    this.simAccumulator += dt * this.timeScale;
    this.events.length = 0;
    let steps = 0;
    while (this.simAccumulator >= SIM_DT && steps < 40 && (ball.mode === 'air' || ball.mode === 'roll')) {
      stepBall(ball, world, this.env, SIM_DT, this.events);
      this.simAccumulator -= SIM_DT;
      steps++;
    }

    if (shot.replan && ball.mode === 'air') {
      shot.replan = false;
      this.plan = this.planShot();
    }
    if (!shot.putt) {
      // Live yardage: the number climbing is half the fun of a good drive
      let sub = '';
      if (shot.shaped) {
        const b = Math.round(Math.abs(shot.bend) / 1.3 * 100);
        const parts = [];
        if (b >= 5) parts.push(shot.bend < 0 ? `↶ DRAW ${b}%` : `FADE ${b}% ↷`);
        if (Math.abs(shot.bite) > 0.08) parts.push(shot.bite > 0 ? 'BACKSPIN' : 'RUN');
        sub = parts.join(' · ');
      } else if (shot.shapeable && ball.mode === 'air' && !ball.landed) {
        sub = 'SWIPE TO SHAPE';
      }
      this.hud.setCarry(`${Math.round(Math.hypot(ball.x - shot.fromX, ball.z - shot.fromZ))}y`, sub);
    }

    for (const e of this.events) this.handleBallEvent(e);
    if (this.state !== 'flight') return;

    // Camera
    if (shot.putt) {
      // Walk in behind the ball as it tracks toward the hole
      const d = cupDist || 1;
      // (no controls on screen now, so frame the ball lower)
      this.rig.putt(ball, (world.cup.x - ball.x) / d, (world.cup.z - ball.z) / d, Math.max(1.2, cupDist), 0.9 + cupDist * 0.07);
      this.rig.stiffness = 2.2;
    } else if (shot.chase) {
      if (ball.time > plan.landTime - 1.05 || ball.mode !== 'air') {
        this.rig.landing(ball, plan, shot.fromX, shot.fromZ);
      } else {
        this.rig.chase(ball);
      }
    } else {
      this.rig.watch(ball, 0.1);
    }
  }

  handleBallEvent(e) {
    const fx = this.effects;
    switch (e.type) {
      case 'land':
        if (this.hints.spin < 4) this.hud.demo(null);
        fx.puff(e.x, e.y, e.z, e.surface, Math.min(1.6, e.speed / 18));
        this.audio.bounce(e.speed * 0.5, e.surface);
        break;
      case 'bounce':
        fx.puff(e.x, e.y, e.z, e.surface, Math.min(1, e.speed / 12));
        this.audio.bounce(e.speed, e.surface);
        break;
      case 'tree':
        this.audio.tree();
        fx.puff(e.x, e.y, e.z, 'rough', 1.2);
        if (!this.shot.treeCalled) { this.hud.callout('TIMBER!', 'bad small'); this.shot.treeCalled = true; }
        break;
      case 'lipout':
        this.audio.lipOut();
        this.hud.callout('LIP OUT!', 'bad');
        break;
      case 'splash':
        fx.splash(e.x, e.y, e.z);
        this.audio.splash();
        this.penalty(this.world.biome.liquid === 'lava' ? 'LAVA' : 'WATER');
        break;
      case 'oob':
        this.penalty('OUT OF BOUNDS');
        break;
      case 'holed':
        this.holed(e);
        break;
      case 'rest':
        this.atRest();
        break;
      default:
        break;
    }
  }

  penalty(label) {
    this.effects.endTrail();
    this.round.pureStreak = 0;
    this.holeLog.dirty = true;
    this.hud.setCarry(null);
    this.hud.callout(label, 'bad');
    this.ballMesh.visible = this.blob.visible = false;
    this.setState('settle');
    if (label === 'WATER') {
      // Water gives one chance to fish the ball out before the stroke is added
      this.settleFor = 0.9;
      this.afterSettle = () => this.goFishing();
    } else {
      this.takePenalty();
    }
  }

  /** The fishing minigame: hook the sinking ball and the penalty is forgiven. */
  goFishing() {
    const a = this.audio;
    this.setState('fishing');
    // Two games take turns. Lose two balls running and the third trip is the
    // golden ball: catch it and those two strokes come back as well, so the
    // water has cost nothing. It can never give back more than it took.
    const round = this.round;
    const trips = round.stats.waters = (round.stats.waters || 0) + 1;
    const mode = (round.waterLost || 0) >= 2 ? 'gold' : ['drop', 'steer'][(trips - 1) % 2];
    this.fishing.start({
      mode,
      level: this.assists.level,
      color: this.world.biome.water,
      hint: this.hints.fish < 6,
      sounds: {
        drop: () => a.whoosh(),
        hooked: () => a.tap(),
        catch: () => { a.reward(4); a.vibrate?.(30); },
        fish: () => a.reward(0),
        miss: () => a.penalty(),
      },
      onDone: (result) => {
        if (this.hints.fish < 6) { this.hints.fish += 1; store.set(HINT_KEY, this.hints); }
        this.setState('settle');
        // Only balls lost in a row count toward the golden one
        round.waterLost = result === 'ball' || mode === 'gold' ? 0 : (round.waterLost || 0) + 1;
        if (result === 'gold') {
          // The golden ball: no stroke this time, and the last two are refunded
          this.round.gold = (this.round.gold || 0) + 1;
          this.round.stats.fished = (this.round.stats.fished || 0) + 1;
          this.hud.callout('GOLDEN BALL!', 'gold');
          this.hud.callout('3 STROKES SAVED', 'gold small');
          this.award('Golden ball', 1000, true);
          this.audio.fanfare?.(2);
          this.updateScoreHud();
          this.dropBall(1.6);
        } else if (result === 'ball') {
          this.round.stats.fished = (this.round.stats.fished || 0) + 1;
          this.hud.callout('SAVED!', 'gold');
          this.hud.callout('NO PENALTY', 'gold small');
          this.award('Fished it out', 150, true);
          this.dropBall(1.1);
        } else {
          if (result === 'fish') { this.hud.callout('A FISH!', 'small'); this.award('Caught a fish', 50, true); }
          this.takePenalty();
        }
      },
    });
  }

  takePenalty() {
    this.strokes += 1;
    this.hud.callout('+1 PENALTY', 'bad small');
    this.audio.penalty();
    this.updateScoreHud();
    this.dropBall(1.5);
  }

  /** Back on dry land after a hazard, once the callouts have had their moment. */
  dropBall(wait) {
    this.setState('settle');
    this.settleFor = wait;
    this.afterSettle = () => {
      const { ball, world, shot } = this;
      // Drop a touch back from where it last crossed dry land
      let x = ball.dryX, z = ball.dryZ;
      const dx = shot.fromX - x, dz = shot.fromZ - z;
      const d = Math.hypot(dx, dz);
      if (d > 3) { x += (dx / d) * 2; z += (dz / d) * 2; }
      if (world.surfaceAt(x, z) === 'water') { x = shot.fromX; z = shot.fromZ; }
      placeBall(ball, world, x, z);
      this.ballMesh.visible = this.blob.visible = true;
      if (!this.pickUpIfDone()) this.beginAim();
    };
  }

  /** Too many strokes: concede the hole so a bad one never stalls the round. */
  pickUpIfDone() {
    const limit = this.world.spec.par + 5;
    if (this.strokes < limit) return false;
    this.strokes = limit;
    this.hud.callout('PICKED UP', 'bad');
    this.finishHole();
    return true;
  }

  atRest() {
    const { ball, world, shot, round } = this;
    this.effects.endTrail();
    const toPin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    const carried = Math.hypot(ball.x - shot.fromX, ball.z - shot.fromZ);
    const surface = ball.surface;
    const par = world.spec.par;

    if (shot.putt) {
      if (toPin < this.assists.gimme) {
        // Conceded: knock it in without making the player line up a six-incher
        this.strokes += 1;
        this.putts += 1;
        round.stats.putts += 1;
        this.shot.gimme = true;
        this.hud.callout('TAP-IN', 'small');
        const d = toPin || 1;
        puttBall(ball, { speed: 1.1, dirX: (world.cup.x - ball.x) / d, dirZ: (world.cup.z - ball.z) / d });
        this.plan = this.planShot();
        this.updateScoreHud();
        return;
      }
      this.hud.callout(`${feet(toPin)} ft left`, 'small');
      if (shot.toPin > 8 && toPin < 1.2) this.award('Great lag putt', 100, true);
    } else {
      if (shot.fromSurface === 'tee' && par > 3) {
        round.stats.fairwayChances += 1;
        round.stats.longestDrive = Math.max(round.stats.longestDrive, Math.round(carried));
        this.holeLog.longestDrive = Math.round(carried);
        if (surface === 'fairway') {
          this.holeLog.fairway = true;
          round.stats.fairways += 1;
          this.hud.callout('FAIRWAY!', '');
          this.award('Fairway hit', 100, true);
          if (carried >= 195) { this.hud.callout(`${Math.round(carried)}y BOMB`, 'gold small'); this.award('Big drive', 100); }
        }
      }
      if (surface === 'rough' || surface === 'bunker') this.holeLog.dirty = true;
      if (surface === 'green') {
        if (this.holeLog.onGreenIn === null) {
          this.holeLog.onGreenIn = this.strokes;
          this.holeLog.firstProximity = toPin;
        }
        if (shot.fromSurface !== 'green') {
          this.hud.callout('ON THE GREEN', '');
          this.award('Hit the green', 150, true);
          if (this.strokes <= par - 2) { round.stats.gir += 1; this.award('Green in regulation', 100); }
        }
        if (toPin * 3 <= 6) { this.hud.callout(`STONE DEAD · ${feet(toPin)} ft`, 'gold small'); this.award('Stone dead', 400); }
        else if (toPin * 3 <= 15) { this.hud.callout(`STUCK IT · ${feet(toPin)} ft`, 'gold small'); this.award('Stuck it close', 250); }
        else this.hud.callout(`${feet(toPin)} ft to the hole`, 'small');
      } else if (surface === 'bunker') {
        this.hud.callout('BUNKER', 'bad');
      } else if (surface === 'rough') {
        this.hud.callout('ROUGH', 'bad small');
      } else if (surface === 'fringe') {
        this.hud.callout('FRINGE', 'small');
      } else if (surface === 'fairway' && shot.fromSurface !== 'tee') {
        this.hud.callout(`${Math.round(toPin)}y to go`, 'small');
      }
    }

    this.setState('settle');
    this.settleFor = 1.0;
    this.afterSettle = () => { if (!this.pickUpIfDone()) this.beginAim(); };
  }

  // ===========================================================================
  // Holing out
  // ===========================================================================

  holed(e) {
    const { shot, world, round } = this;
    const par = world.spec.par;
    this.holeLog.holed = true;
    if (!shot.putt && this.holeLog.onGreenIn === null) { this.holeLog.onGreenIn = this.strokes; this.holeLog.firstProximity = 0; }
    this.effects.endTrail();
    this.hud.setCarry(null);
    this.audio.cup();
    this.music.accent();
    this.sink = 0.001;
    this.timeScale = 1;
    this.effects.confetti(world.cup.x, world.cup.y, world.cup.z, 70 + Math.max(0, par - this.strokes) * 50);
    this.rig.addShake(0.08);

    if (shot.putt && !shot.gimme) {
      const ft = feet(shot.toPin);
      round.stats.longestPutt = Math.max(round.stats.longestPutt, ft);
      if (ft >= 20) this.hud.callout(`${ft} FT BOMB!`, 'gold');
      this.award(`${ft} ft putt holed`, Math.min(600, 40 + ft * 14));
      if (this.putts === 1) this.award('One-putt', 150);
    } else if (!shot.putt) {
      if (this.strokes === 1) this.award('HOLE IN ONE', 10000);
      else if (shot.toPin > 60) this.award('Holed from the fairway', 3000);
      else this.award(e.dunk ? 'Slam dunk' : 'Chip-in', 1000);
      this.hud.callout(this.strokes === 1 ? 'ACE!!!' : 'HOLED IT!', 'gold');
    }

    const d = this.strokes - par;
    const scoreBonus = d <= -2 ? 1500 : d === -1 ? 600 : d === 0 ? 200 : d === 1 ? 50 : 0;
    if (scoreBonus) this.award(scoreName(this.strokes, par).replace('!', ''), scoreBonus);

    this.setState('holed');
    this.celebrateAngle = Math.atan2(this.camera.position.z - world.cup.z, this.camera.position.x - world.cup.x);
    this.announced = false;
  }

  finishHole() {
    const { round, world } = this;
    const par = world.spec.par;
    const log = this.holeLog;
    log.strokes = this.strokes; log.putts = this.putts;
    const won = !!this.challenge.test(log);
    if (won) {
      this.award(`★ ${this.challenge.text}`, this.challenge.points);
      round.stars = (round.stars || 0) + 1;
    }
    this.hud.setChallenge(this.challenge.text, won);
    round.heat = nextHeat(round.heat || 0, this.strokes, par);
    round.scores[round.index] = { number: world.spec.number, par, strokes: this.strokes, putts: this.putts, star: won };
    const last = round.index >= round.holes.length - 1;
    const card = this.cardData();
    round.index += 1;
    round.live = null;
    store.set(SAVE_KEY, round);

    const d = this.strokes - par;
    this.hud.setPlayVisible(false);
    this.updateScoreHud();
    this.setState('result');
    this.nextHole = () => {
      this.nextHole = null;
      this.audio.tap();
      this.hud.clearLayer();
      if (last) this.showSummary(); else this.startHole();
    };
    this.hud.showResult({
      title: scoreName(this.strokes, par),
      kind: d < 0 ? 'gold' : '',
      strokes: this.strokes, par,
      bonuses: this.bonuses,
      holePoints: this.holePoints,
      challenge: { text: this.challenge.text, won },
      card, last,
      onNext: () => this.nextHole?.(),
    });
  }

  showSummary() {
    const round = this.round;
    const total = this.roundTotal();
    const strokes = round.scores.reduce((s, h) => s + h.strokes, 0) - 2 * (round.gold || 0);
    const par = round.scores.reduce((s, h) => s + h.par, 0);
    const st = round.stats;
    let best = false;
    if (round.length === 18) {
      const prev = store.get(BEST_KEY);
      if (!prev || total < prev.score || (total === prev.score && round.points > prev.points)) {
        store.set(BEST_KEY, { score: total, points: round.points, seed: round.seed });
        best = true;
      }
    }
    if (round.daily) {
      const all = store.get(DAILY_KEY) || {};
      const prev = all[round.seed];
      if (!prev || total < prev.score) { all[round.seed] = { score: total, points: round.points }; best = true; }
      // Only today's (and a few recent) results are worth keeping
      for (const key of Object.keys(all).sort().slice(0, -7)) delete all[key];
      store.set(DAILY_KEY, all);
    }
    store.del(SAVE_KEY);
    this.wakeLock?.release?.().catch(() => {});
    this.setState('summary');
    this.audio.fanfare(total <= 0 ? 3 : 1);
    const card = this.cardData();
    card.holes.forEach((h) => { h.current = false; });
    this.hud.showSummary({
      total, par, strokes, points: round.points, best, seed: round.seed, card,
      stats: [
        { label: 'FAIRWAYS', value: `${st.fairways}/${st.fairwayChances}` },
        { label: 'GREENS IN REG', value: `${st.gir}/${round.holes.length}` },
        { label: 'PUTTS', value: st.putts },
        { label: 'PURE STRIKES', value: st.pures },
        { label: 'LONGEST DRIVE', value: `${st.longestDrive}y` },
        { label: 'CHALLENGES', value: `★ ${round.stars || 0}/${round.holes.length}` },
      ],
      onAgain: () => {
        this.seedPinned = false;
        this.seed = generateSeed();
        history.replaceState(null, '', location.pathname);
        this.hud.clearLayer();
        this.showTitle();
      },
      onShare: async (button) => {
        const url = `${location.origin}${location.pathname}?seed=${encodeURIComponent(round.seed)}`;
        const text = `I shot ${total === 0 ? 'even par' : total > 0 ? `+${total}` : total} on ThreeWood course ${round.seed}. Beat it:`;
        try {
          if (navigator.share) await navigator.share({ title: 'ThreeWood', text, url });
          else { await navigator.clipboard.writeText(`${text} ${url}`); button.textContent = 'LINK COPIED'; }
        } catch { /* cancelled */ }
      },
    });
  }

  endIntro() {
    this.hud.clearLayer();
    this.audio.tap();
    this.beginAim();
  }

  // ===========================================================================
  // Menu
  // ===========================================================================

  openMenu() {
    if (!this.round || this.paused || this.state === 'result' || this.state === 'summary' || this.state === 'fishing') return;
    this.paused = true;
    this.audio.tap();
    this.hud.showMenu({
      muted: this.audio.muted,
      music: this.music.enabled,
      card: this.cardData(),
      onResume: () => this.closeMenu(),
      onMute: () => { this.audio.setMuted(!this.audio.muted); return this.audio.muted; },
      sky: this.sky.mode,
      onSky: () => this.sky.cycleMode(),
      onMusic: () => this.toggleMusic(),
      onHelp: () => this.hud.showHelp(() => this.openMenuAgain()),
      onFishing: () => this.practiceFishing(() => this.openMenuAgain()),
      onQuit: () => { this.paused = false; this.hud.clearLayer(); this.showTitle(); },
    });
  }

  toggleMusic() {
    this.audio.unlock();
    return this.music.setEnabled(!this.music.enabled);
  }

  openMenuAgain() { this.paused = false; this.openMenu(); }

  /**
   * Practice fishing: the three games in turn, for as long as you like, with
   * nothing at stake. Runs on its own clock so it works from the title and
   * from the pause menu, where the game itself is standing still.
   */
  practiceFishing(onClose) {
    const a = this.audio;
    const modes = ['drop', 'steer', 'gold'];
    let i = 0, last = performance.now(), open = true;
    this.hud.clearLayer();
    const next = () => this.fishing.start({
      mode: modes[i++ % modes.length],
      level: 0.3,
      color: this.world.biome.liquid === 'lava' ? 0x3c9cc4 : this.world.biome.water,
      hint: true,
      sounds: {
        drop: () => a.whoosh(), hooked: () => a.tap(),
        catch: () => a.reward(4), fish: () => a.reward(0), miss: () => a.penalty(),
      },
      onDone: next,
      onClose: () => { open = false; onClose(); },
    });
    next();
    const tick = (now) => {
      if (!open) return;
      this.fishing.update(Math.min(0.05, (now - last) / 1000));
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  closeMenu() {
    this.paused = false;
    this.hud.clearLayer();
    if (this.state === 'intro') {
      // The menu replaced the intro card: put it back
      this.hud.showIntro(this.introCard());
    }
  }

  // ===========================================================================
  // Frame
  // ===========================================================================

  loop() {
    requestAnimationFrame(this.loop);
    if (this.manual) return;
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.adaptQuality(raw);
    this.music.setMuffled(this.paused);
    if (!this.paused) this.update(dt);
    this.updateVisuals(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.time += dt;
    this.stateTime += dt;
    const { ball, world } = this;

    switch (this.state) {
      case 'title': {
        const g = world.spec.green;
        this.rig.orbit(g.x, world.cup.y, g.z, 34, 11, this.time * 0.12);
        break;
      }
      case 'intro': {
        this.rig.flyover(Math.min(1, this.stateTime / (INTRO_TIME - 0.6)));
        if (this.stateTime > INTRO_TIME) this.endIntro();
        break;
      }
      case 'aim': {
        const turn = (this.keys.ArrowRight ? 1 : 0) - (this.keys.ArrowLeft ? 1 : 0);
        if (turn) { this.aimAngle += turn * dt * (this.putting ? 0.12 : 0.7); this.planDirty = true; }
        if (this.planDirty) this.updatePlan();
        this.aimCamera();
        break;
      }
      case 'swing': {
        this.aimCamera();
        if (this.putting) {
          if (this.charging) {
            const rate = PUTT_METER_RATE * (this.coach ? (this.coach === 'hold' ? 0.7 : this.coach) : this.assists.puttRate);
            this.puttPower += this.puttDir * rate * dt;
            if (this.coach === 'hold' && this.puttDir > 0 && this.puttPower >= this.idealPct) {
              // Coached first putt: the bar stops on the mark and waits
              this.puttPower = this.idealPct;
              if (!this.coachHeld) {
                this.coachHeld = true;
                this.hud.setMeterFlag(this.idealPct, this.puttLatched ? 'tap' : 'release', true);
              }
            }
            if (this.puttPower >= 100) { this.puttPower = 100; this.puttDir = -1; }
            if (this.puttPower <= 0) { this.puttPower = 0; this.puttDir = 1; }
            this.hud.updatePuttMeter(this.puttPower);
          }
        } else {
          this.lockGrace = Math.max(0, (this.lockGrace || 0) - dt);
          const sw = this.swing;
          let step = dt * (this.coach ? (this.coach === 'hold' ? 0.75 : this.coach) : this.assists.tempo);
          if (this.coach === 'hold') {
            // Coached first swing: the marker stops where the tap belongs and waits
            const atPower = sw.phase === 'power' && this.idealPower && sw.marker >= this.idealPower;
            const atLine = sw.phase === 'accuracy' && sw.marker <= SWING.LINE + 0.6;
            if (atPower || atLine) {
              step = 0;
              sw.marker = atPower ? this.idealPower : SWING.LINE;
              if (this.coachHeld !== sw.phase) {
                this.coachHeld = sw.phase;
                this.hud.setMeterFlag(markerToPercent(sw.marker), 'tap', true);
              }
            }
          }
          const event = swingStep(this.swing, step);
          this.hud.updateSwingMeter(this.swing);
          if (event) this.handleSwingEvent(event);
        }
        break;
      }
      case 'flight':
        this.updateFlight(dt);
        break;
      case 'fishing':
        this.fishing.update(dt);
        break;
      case 'settle':
        if (this.shot?.putt) this.rig.watch(ball); else if (this.rig.mode === 'landing') this.rig.landing(ball, this.plan, this.shot.fromX, this.shot.fromZ);
        if (this.stateTime > this.settleFor) this.afterSettle();
        break;
      case 'holed':
        this.celebrateAngle += dt * 0.5;
        this.rig.orbit(world.cup.x, world.cup.y, world.cup.z, 5.2, 2.3, this.celebrateAngle);
        if (!this.announced && this.stateTime > 0.45) {
          this.announced = true;
          const d = this.strokes - world.spec.par;
          this.hud.callout(scoreName(this.strokes, world.spec.par), d < 0 ? 'gold' : d > 0 ? 'bad' : '');
          this.audio.fanfare(d <= -2 ? 3 : d === -1 ? 2 : d === 0 ? 1 : 0);
        }
        if (this.stateTime > 2.6) this.finishHole();
        break;
      case 'result':
        this.celebrateAngle += dt * 0.25;
        this.rig.orbit(world.cup.x, world.cup.y, world.cup.z, 9, 4, this.celebrateAngle);
        this.hud.setAutoProgress(this.stateTime / 9);
        if (this.stateTime > 9) this.nextHole?.();
        break;
      default:
        break;
    }
  }

  aimCamera() {
    const { ball } = this;
    const dirX = Math.cos(this.aimAngle), dirZ = Math.sin(this.aimAngle);
    if (this.putting) {
      this.rig.putt(ball, dirX, dirZ, this.targetDist);
    } else {
      const reach = this.idealPower ? this.targetDist : distanceAt(this.club, 100, this.lie.speedFactor);
      this.rig.aim(ball, dirX, dirZ, reach);
    }
  }

  updateVisuals(dt) {
    const { ball, world, camera } = this;
    this.rig.update(dt);

    // Ball: drawn a little larger with distance so it never becomes a pixel
    const camDist = Math.hypot(camera.position.x - ball.x, camera.position.y - ball.y, camera.position.z - ball.z);
    // (only enough to stay visible: beyond that it must grow and shrink with
    // distance like a real thing, or a ball flying at the camera looks wrong)
    const want = Math.max(1.4, Math.min(12, camDist / (this.rig.portrait ? 8.5 : 11)));
    // Shrink at once (camera cuts), grow smoothly (ball flying away)
    this.ballScale = want < this.ballScale ? want : this.ballScale + (want - this.ballScale) * Math.min(1, dt * 8);
    const s = this.ballScale;
    const ground = world.heightAt(ball.x, ball.z);
    const lift = Math.max(0, ball.y - BALL_R - ground);
    // Centred on the real ball in the air; resting on the turf when it is down
    let y = Math.max(ball.y, ground + BALL_R * s);
    if (this.sink > 0) {
      this.sink = Math.min(1, this.sink + dt * 3.2);
      y -= this.sink * 0.42;
      this.ballMesh.position.x += (world.cup.x - this.ballMesh.position.x) * 0.3;
      this.ballMesh.position.z += (world.cup.z - this.ballMesh.position.z) * 0.3;
      this.ballMesh.position.y = y;
    } else {
      this.ballMesh.position.set(ball.x, y, ball.z);
    }
    this.ballMesh.scale.setScalar(s);
    if (ball.mode === 'roll' || ball.mode === 'air') {
      const speed = Math.hypot(ball.vx, ball.vz);
      if (speed > 0.05) {
        this._axis = this._axis || new THREE.Vector3();
        this._axis.set(ball.vz, 0, -ball.vx).normalize();
        this.ballMesh.rotateOnWorldAxis(this._axis, (speed * dt * this.timeScale) / (BALL_R * s));
      }
    }
    // Trail: laid from where the ball is drawn, so it can never come adrift
    const inFlight = this.state === 'flight' && this.shot && !this.shot.putt;
    const pace = Math.hypot(ball.vx, ball.vy, ball.vz);
    const airborne = ball.mode === 'air';
    this.effects.comet.update(
      this.ballMesh.position, this.time, camera, BALL_R * s,
      airborne ? 0.6 : 0.28,
      inFlight ? (airborne ? 1 : Math.min(1, Math.max(0, (pace - 2) / 8))) : 0);
    this.blob.position.set(this.ballMesh.position.x, ground + 0.03, this.ballMesh.position.z);
    this.blob.scale.setScalar(BALL_R * s * (1.25 + lift * 0.04));
    this.blob.material.opacity = this.sink > 0 ? 0 : Math.max(0.1, 0.34 - lift * 0.006);

    // Sun follows the action so one shadow map covers it
    const fx = Math.round(this.rig.look.x / 8) * 8, fz = Math.round(this.rig.look.z / 8) * 8;
    this.sun.target.position.set(fx, 0, fz);
    this.sky.update(dt, this.time);
    const light = this.sky.lightDir;
    this.sun.position.set(fx + light.x * 260, light.y * 260, fz + light.z * 260);

    this.updateClub(dt);
    updateScenery(this.scenery, this.time, dt, this.sky);
    const onGreen = this.round && (this.putting || ball.surface === 'green') && this.state !== 'intro' && this.state !== 'title';
    updateFlag(this.scenery.flag, this.time, onGreen && this.state !== 'holed' && this.state !== 'result', camera);
    this.effects.update(dt, this.time);

    if (!this.round) return;

    // HUD that tracks the 3D scene
    const showTag = (this.state === 'aim' || this.state === 'swing') && !this.putting;
    if (showTag) {
      this._v = this._v || new THREE.Vector3();
      this._v.set(world.cup.x, world.cup.y + 4.1, world.cup.z).project(camera);
      const visible = this._v.z < 1 && Math.abs(this._v.x) < 1.1;
      const d = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
      this.hud.setPinTag(`${Math.round(d)}y`, (this._v.x * 0.5 + 0.5) * window.innerWidth, (-this._v.y * 0.5 + 0.5) * window.innerHeight, visible);
    } else {
      this.hud.setPinTag('', 0, 0, false);
    }

    if (this.state === 'aim' || this.state === 'swing' || this.state === 'flight') {
      // Wind arrow in screen space: up = away from the camera
      const dirX = Math.cos(this.aimAngle), dirZ = Math.sin(this.aimAngle);
      const w = world.spec.wind;
      const forward = w.x * dirX + w.z * dirZ;
      const right = w.x * -dirZ + w.z * dirX;
      this.hud.setWind(w.speed, Math.atan2(right, forward));
      this.mapTimer = (this.mapTimer || 0) - dt;
      if (this.mapTimer <= 0) {
        this.mapTimer = 0.08;
        this.hud.drawMinimap(world, ball, this.state === 'flight' ? null : this.landing);
      }
    }
  }

  /** Test/capture hook: with `manual` set, advance exactly one frame. */
  debugFrame(dt, render = true) {
    if (!this.paused) this.update(dt);
    this.updateVisuals(dt);
    if (render) this.renderer.render(this.scene, this.camera);
  }

  /** Test hook: jump to hole `index` (0-based) of the round. */
  debugGoto(index) {
    this.round.index = index;
    this.hud.clearLayer();
    this.startHole();
  }

  /** Test hook: rebuild the current hole in another world (a biome id). */
  debugBiome(biome) {
    const spec = designHole(this.world.spec.seed, this.world.spec.number, { biome });
    this.loadWorld(spec);
    placeBall(this.ball, this.world, this.world.tee.x, this.world.tee.z);
    this.aimAngle = Math.atan2(this.world.cup.z - this.ball.z, this.world.cup.x - this.ball.x);
    if (this.state === 'aim') this.beginAim();
  }

  /** Test hook: drop the ball `dist` yards from the pin and take aim. */
  debugPlace(dist, angle = 0.6) {
    const { world, ball } = this;
    this.hud.clearLayer();
    this.hud.setPlayVisible(true);
    this.strokes = Math.max(1, this.strokes);
    placeBall(ball, world, world.cup.x + Math.cos(angle) * dist, world.cup.z + Math.sin(angle) * dist);
    this.ballMesh.visible = this.blob.visible = true;
    this.beginAim();
  }

  /** Drop resolution if the device cannot hold frame rate. */
  adaptQuality(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg <= 1 / 42) return;
    if (this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    } else if (this.sun.castShadow) {
      // Last resort: real shadows go, the ball's blob shadow stays
      this.sun.castShadow = false;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }
}

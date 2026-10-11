/**
 * Audio — one Web Audio context for everything.
 *
 * Club strikes use the recorded samples in /public/sfx (decoded lazily, a few
 * small files); every other sound is synthesised, so the game is audible the
 * instant the first tap unlocks the context, with nothing to download.
 * Also owns haptics (navigator.vibrate) so "feedback" lives in one place.
 */

const STRIKE_SAMPLES = [
  '75204__zolopher__golf-10.wav',
  '75205__zolopher__golf-11.wav',
  '75209__zolopher__golf-15.wav',
  '75210__zolopher__golf-16.wav',
  '75207__zolopher__golf-13.wav',
];

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = [];
    this.muted = false;
    this.rollNode = null;
    try { this.muted = localStorage.getItem('threewood.muted') === '1'; } catch { /* private mode */ }
  }

  /** Must be called from a user gesture (first tap). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
      this.loadSamples();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    try { localStorage.setItem('threewood.muted', muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = muted ? 0 : 0.8;
  }

  async loadSamples() {
    for (const name of STRIKE_SAMPLES) {
      try {
        const res = await fetch(`/sfx/${name}`);
        const data = await res.arrayBuffer();
        this.buffers.push(await this.ctx.decodeAudioData(data));
      } catch { /* a missing sample just falls back to synth */ }
    }
  }

  makeNoise() {
    const len = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // --- Building blocks -----------------------------------------------------

  tone(freq, dur, { type = 'sine', gain = 0.2, to = null, delay = 0, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  burst(dur, { gain = 0.2, freq = 1200, q = 0.8, type = 'bandpass', to = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  vibrate(pattern) {
    if (this.muted) return;
    try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
  }

  // --- Game sounds -----------------------------------------------------------

  tap() { this.tone(660, 0.07, { type: 'triangle', gain: 0.12 }); }

  /** Rising blip as power locks; pitch tracks the meter. */
  powerLock(power) {
    this.tone(300 + power * 5, 0.09, { type: 'square', gain: 0.07 });
    this.vibrate(8);
  }

  strike(power, grade) {
    if (!this.ctx) return;
    const pure = grade === 'pure';
    if (this.buffers.length) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers[Math.floor(Math.random() * this.buffers.length)];
      src.playbackRate.value = 0.85 + (power / 100) * 0.3 + (pure ? 0.08 : 0);
      const g = this.ctx.createGain();
      g.gain.value = 0.45 + (power / 100) * 0.55;
      src.connect(g).connect(this.master);
      src.start();
    } else {
      this.burst(0.09, { gain: 0.5, freq: 2600, q: 0.6 });
    }
    // Body of the hit + the whoosh of the swing
    this.tone(pure ? 190 : 140, 0.12, { type: 'triangle', gain: 0.3, to: 70 });
    this.burst(0.22, { gain: 0.12, freq: 500, to: 2400, q: 0.5 });
    if (pure) {
      this.tone(1320, 0.35, { gain: 0.09, delay: 0.03 });
      this.tone(1980, 0.4, { gain: 0.06, delay: 0.06 });
    }
    this.vibrate(pure ? [18, 30, 28] : grade === 'good' ? 22 : [10, 40, 10]);
  }

  putt(speed) {
    this.tone(520, 0.05, { type: 'triangle', gain: 0.22, to: 260 });
    this.burst(0.04, { gain: 0.12, freq: 3200, q: 1 });
    this.vibrate(Math.min(25, 8 + speed * 2));
  }

  bounce(speed, surface) {
    const g = Math.min(0.4, 0.06 + speed * 0.022);
    if (surface === 'bunker') {
      this.burst(0.2, { gain: g * 1.2, freq: 900, q: 0.4, type: 'lowpass' });
    } else if (surface === 'rough') {
      this.burst(0.12, { gain: g, freq: 1500, q: 0.5 });
      this.tone(90, 0.1, { gain: g * 0.6, to: 55 });
    } else {
      this.tone(150, 0.12, { type: 'sine', gain: g, to: 60 });
      this.burst(0.05, { gain: g * 0.5, freq: 2200, q: 0.7 });
    }
    if (speed > 6) this.vibrate(10);
  }

  tree() {
    this.burst(0.3, { gain: 0.22, freq: 3800, to: 1500, q: 0.4 });
    this.tone(240, 0.07, { type: 'square', gain: 0.1, to: 120 });
    this.vibrate(15);
  }

  splash() {
    this.burst(0.6, { gain: 0.35, freq: 1400, to: 350, q: 0.3, type: 'lowpass' });
    this.tone(180, 0.25, { gain: 0.18, to: 60 });
    this.vibrate([30, 40, 60]);
  }

  lipOut() {
    this.tone(880, 0.09, { type: 'triangle', gain: 0.16, to: 500 });
    this.tone(420, 0.3, { type: 'sawtooth', gain: 0.05, to: 200, delay: 0.12 });
    this.vibrate([10, 30, 10]);
  }

  /** The cup: hollow rattle, then the reward. */
  cup() {
    for (let i = 0; i < 4; i++) {
      this.tone(880 - i * 90, 0.06, { type: 'triangle', gain: 0.24 - i * 0.04, delay: i * 0.055 });
      this.burst(0.03, { gain: 0.1, freq: 1800, q: 3, delay: i * 0.055 });
    }
    this.vibrate([20, 40, 20, 40, 60]);
  }

  /** Short fanfare scaled by how good the result is (0 = bogey .. 3 = eagle+). */
  fanfare(level) {
    const scales = [
      [392, 330],
      [523, 659, 784],
      [523, 659, 784, 1047],
      [523, 659, 784, 1047, 1319, 1568],
    ];
    const notes = scales[Math.max(0, Math.min(3, level))];
    notes.forEach((f, i) => {
      this.tone(f, 0.28, { type: 'triangle', gain: 0.16, delay: i * 0.11 });
      this.tone(f * 2, 0.2, { gain: 0.05, delay: i * 0.11 });
    });
    if (level >= 1) this.applause(0.6 + level * 0.5);
  }

  applause(dur = 1.2) {
    this.burst(dur, { gain: 0.11, freq: 2400, q: 0.3, delay: 0.15 });
    this.burst(dur * 0.8, { gain: 0.07, freq: 5200, q: 0.4, delay: 0.25 });
  }

  /** Reward chime; pitch climbs with the streak. */
  reward(step = 0) {
    const f = 880 * Math.pow(1.122, Math.min(8, step));
    this.tone(f, 0.16, { type: 'triangle', gain: 0.13 });
    this.tone(f * 1.5, 0.22, { gain: 0.08, delay: 0.06 });
  }

  penalty() {
    this.tone(300, 0.2, { type: 'sawtooth', gain: 0.08, to: 150 });
    this.tone(200, 0.3, { type: 'sawtooth', gain: 0.08, to: 100, delay: 0.16 });
  }

  whoosh() { this.burst(0.5, { gain: 0.1, freq: 400, to: 1800, q: 0.6 }); }

  // --- Ambience: the course is never silent -------------------------------------

  /**
   * Called every frame. A breeze that swells with the wind, birdsong by day,
   * crickets after dark, each very quiet and all synthesised. level: 0..1,
   * how much of it there should be (the menus and minigames turn it down).
   */
  ambience(dt, { night = 0, wind = 0, level = 1 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!this.breeze) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 500; filter.Q.value = 0.4;
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.breeze = { filter, gain, t: 0 };
      this.nextBird = 2; this.nextCricket = 0;
    }
    const b = this.breeze;
    b.t += dt;
    // Gusts: two slow waves, a little stronger in a strong wind
    const gust = 0.55 + 0.3 * Math.sin(b.t * 0.37) + 0.15 * Math.sin(b.t * 1.13 + 1);
    const want = level * (0.012 + Math.min(15, wind) * 0.0016) * gust;
    b.gain.gain.setTargetAtTime(want, this.ctx.currentTime, 0.4);
    b.filter.frequency.setTargetAtTime(380 + 420 * gust, this.ctx.currentTime, 0.6);
    if (level < 0.2) return;
    // A bird now and then while the sun is up
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 3 + Math.random() * 7;
      if (night < 0.5) this.chirp(level * (1 - night));
    }
    // Crickets after dark: short trills in a steady rhythm
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      this.nextCricket = 0.9 + Math.random() * 0.5;
      if (night > 0.4) for (let i = 0; i < 3; i++) this.tone(4300 + Math.random() * 120, 0.035, { gain: 0.014 * level * night, delay: i * 0.06 });
    }
  }

  /** One small bird: a few quick falling (or rising) notes. */
  chirp(level = 1) {
    const base = 2600 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3), up = Math.random() < 0.4;
    for (let i = 0; i < n; i++) {
      const f = base * (1 + (Math.random() - 0.5) * 0.08);
      this.tone(f, 0.07, { gain: 0.016 * level, to: up ? f * 1.25 : f * 0.72, delay: i * (0.09 + Math.random() * 0.04) });
    }
  }

  /** Kuri: a small happy yip. */
  yip() {
    const f = 820 + Math.random() * 160;
    this.tone(f, 0.07, { type: 'triangle', gain: 0.13, to: f * 1.45 });
    this.tone(f * 1.2, 0.09, { type: 'triangle', gain: 0.1, to: f * 0.9, delay: 0.08 });
  }

  /** Something picked: a soft pop. */
  pop() {
    this.tone(520, 0.08, { gain: 0.16, to: 980 });
    this.burst(0.04, { gain: 0.06, freq: 2500, q: 2 });
  }

  /** Into the pot (or the pond). */
  plop() {
    this.tone(340, 0.14, { gain: 0.18, to: 120 });
    this.burst(0.18, { gain: 0.08, freq: 900, to: 300, q: 0.6, type: 'lowpass' });
  }

  /** The pot boiling over. */
  sizzle() { this.burst(0.7, { gain: 0.1, freq: 5200, to: 3000, q: 0.5 }); }

  /** A stone skipping: each touch a step higher. */
  skip(n) {
    const f = 600 * Math.pow(1.09, Math.min(14, n));
    this.tone(f, 0.05, { type: 'triangle', gain: 0.12, to: f * 0.7 });
    this.burst(0.05, { gain: 0.05, freq: 1800, q: 1.5 });
  }
}

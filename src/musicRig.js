/**
 * The band: every voice of the soundtrack, played with Tone.js.
 *
 * Loaded on demand by music.js, so Tone and the break are only downloaded by
 * players who switch music on. One sixteenth-note callback reads the patterns
 * in core/dnbPattern.js and plays whatever falls on that step.
 *
 * The drums are one recorded breakbeat, sped up, sliced into eighth notes and
 * re-ordered; everything else is synthesised.
 *
 * Break: "Amen Break G (165 BPM)" by Kevcio, CC0 — https://freesound.org/s/321221/
 */
import * as Tone from 'tone';
import {
  BPM, STEPS, BREAK_BPM, breakStep, bassStep, padStep, stabStep, isBreakdown, isReentry,
} from './core/dnbPattern.js';

const BREAK_URL = '/music/break-165.mp3';
const SIXTEENTH = 60 / BPM / 4;
const BREAK_EIGHTH = 60 / BREAK_BPM / 2;
const BREAK_RATE = BPM / BREAK_BPM;
const BREAK_GAIN = [0.6, 1, 1]; // by level
const DRUM_CUTOFF = [700, 20000, 20000];
const REESE_CUTOFF = [120, 260, 2600];
const MASTER_GAIN = 0.5;

const up = (note, semis) => Tone.Frequency(note).transpose(semis).toFrequency();

export class MusicRig {
  /** @param {AudioContext} ctx the game's own (already unlocked) context */
  static async create(ctx) {
    Tone.setContext(ctx);
    Tone.getContext().lookAhead = 0.2; // ride out a dropped frame or two
    return new MusicRig(await Tone.ToneAudioBuffer.fromUrl(BREAK_URL));
  }

  constructor(breakBuffer) {
    this.break = breakBuffer;
    this.transport = Tone.getTransport();
    this.transport.bpm.value = BPM;
    this.pos = 0;
    this.level = 0;
    this.crashDue = false;

    // Master: muffle filter (pause menu) -> limiter -> fader
    this.out = new Tone.Gain(0).toDestination();
    const limiter = new Tone.Limiter(-2).connect(this.out);
    this.muffle = new Tone.Filter(20000, 'lowpass').connect(limiter);

    // Shared space
    const reverb = new Tone.Reverb({ decay: 3.2, wet: 1 }).connect(this.muffle);
    const echo = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.45, wet: 1 }).connect(this.muffle);
    echo.connect(reverb);

    // Drums: the break, driven a little, and a cymbal for the big moments
    const drive = new Tone.Distortion({ distortion: 0.1, wet: 0.4 }).connect(this.muffle);
    this.drums = new Tone.Filter({ frequency: DRUM_CUTOFF[0], type: 'lowpass', Q: 1 }).connect(drive);
    this.drums.connect(new Tone.Gain(0.07).connect(reverb));
    const crashTone = new Tone.Filter(5000, 'highpass').connect(this.muffle);
    crashTone.connect(new Tone.Gain(0.4).connect(reverb));
    this.crash = new Tone.NoiseSynth({
      noise: { type: 'white' }, volume: -17,
      envelope: { attack: 0.002, decay: 1.4, sustain: 0, release: 0.2 },
    }).connect(crashTone);

    // Bass: an 808-style sub that slides between notes, warmed up enough to
    // survive small speakers, and a detuned-saw reese that only opens for the drop
    const warmth = new Tone.Distortion({ distortion: 0.18, wet: 0.5 }).connect(this.muffle);
    const subTone = new Tone.Filter(520, 'lowpass').connect(warmth);
    this.sub = new Tone.Synth({
      oscillator: { type: 'triangle' }, portamento: 0.07, volume: -9,
      envelope: { attack: 0.006, decay: 0.3, sustain: 0.85, release: 0.12 },
    }).connect(subTone);
    const reeseLevel = new Tone.Gain(0.45).connect(this.muffle); // the distortion is loud whatever goes in
    this.reeseCutoff = new Tone.Filter({ frequency: REESE_CUTOFF[0], type: 'lowpass', rolloff: -24 }).connect(reeseLevel);
    const growl = new Tone.Distortion({ distortion: 0.35, wet: 0.6 }).connect(this.reeseCutoff);
    const wobble = new Tone.Filter({ type: 'lowpass', Q: 3 }).connect(growl);
    this.wobbleLfo = new Tone.LFO({ frequency: '2n', min: 350, max: 2600 }).connect(wobble.frequency).start();
    this.reese = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', count: 3, spread: 32 }, portamento: 0.07, volume: -16,
      envelope: { attack: 0.015, decay: 0.2, sustain: 0.8, release: 0.1 },
    }).connect(wobble);

    // Atmosphere: slow dark pads, mostly reverb
    const padTone = new Tone.Filter(1100, 'lowpass').connect(this.muffle);
    padTone.connect(new Tone.Gain(0.8).connect(reverb));
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 22 }, volume: -21,
      envelope: { attack: 0.9, decay: 0.5, sustain: 0.8, release: 1.6 },
    }).connect(padTone);
    this.pad.maxPolyphony = 8;

    // Rave stabs, thrown into the echo
    const stabTone = new Tone.Filter({ frequency: 2400, type: 'lowpass', Q: 2 }).connect(this.muffle);
    stabTone.connect(new Tone.Gain(0.6).connect(echo));
    this.stab = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 40 }, volume: -18,
      envelope: { attack: 0.003, decay: 0.16, sustain: 0, release: 0.08 },
    }).connect(stabTone);
    this.stab.maxPolyphony = 6;

    this.transport.scheduleRepeat((time) => this.step(time), '16n');
  }

  play() {
    this.out.gain.rampTo(MASTER_GAIN, 0.4);
    if (this.transport.state !== 'started') this.transport.start();
  }

  pause() {
    this.out.gain.rampTo(0, 0.08);
    this.transport.pause('+0.1');
  }

  setLevel(level) {
    if (level === this.level) return;
    if (level === 2) this.crashDue = true; // announce the drop
    this.level = level;
    this.drums.frequency.rampTo(DRUM_CUTOFF[level], 0.25);
    this.reeseCutoff.frequency.rampTo(REESE_CUTOFF[level], level === 2 ? 0.08 : 0.5);
  }

  /** Pause-menu "next room" filter. */
  setMuffled(on) {
    this.muffle.frequency.rampTo(on ? 420 : 20000, 0.35);
  }

  /** A cymbal for the big moments (the ball dropping). */
  accent() { this.crashDue = true; }

  step(time) {
    const bar = Math.floor(this.pos / STEPS), step = this.pos % STEPS;
    this.pos++;
    const level = this.level;

    const hit = breakStep(bar, step, level);
    if (hit) {
      // Each slice rings until the next one cuts it off
      new Tone.ToneBufferSource({
        url: this.break, playbackRate: BREAK_RATE * 2 ** (hit.semis / 12), fadeOut: 0.004,
      }).connect(this.drums).start(time, hit.slice * BREAK_EIGHTH, hit.steps * SIXTEENTH, BREAK_GAIN[level]);
    }
    if (this.crashDue || (level > 0 && isReentry(bar, step))) {
      this.crashDue = false;
      this.crash.triggerAttackRelease(1.2, time);
    }

    const bass = bassStep(bar, step);
    if (bass) {
      const dur = bass.steps * SIXTEENTH * 0.95;
      this.sub.triggerAttackRelease(bass.note, dur, time);
      this.reese.triggerAttackRelease(up(bass.note, 12), dur, time);
    }
    const pad = padStep(bar, step);
    if (pad) this.pad.triggerAttackRelease(pad.notes, pad.steps * SIXTEENTH * 0.9, time, isBreakdown(bar) ? 1 : 0.75);
    const stab = stabStep(bar, step, level);
    if (stab) this.stab.triggerAttackRelease(stab.map((n) => up(n, 12)), 0.12, time);
  }
}

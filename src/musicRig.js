/**
 * The band: every voice of the soundtrack, synthesised with Tone.js.
 *
 * Loaded on demand by music.js, so Tone is only downloaded by players who
 * switch music on. One sixteenth-note callback reads the patterns in
 * core/dnbPattern.js and plays whatever falls on that step.
 */
import * as Tone from 'tone';
import { BPM, STEPS, drumStep, bassStep, padStep, stabStep, leadStep } from './core/dnbPattern.js';

const SIXTEENTH = 60 / BPM / 4;
const REESE_CUTOFF = [220, 750, 3800]; // by level
const MASTER_GAIN = 0.5;

export class MusicRig {
  /** @param {AudioContext} ctx the game's own (already unlocked) context */
  constructor(ctx) {
    Tone.setContext(ctx);
    Tone.getContext().lookAhead = 0.2; // ride out a dropped frame or two
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
    const reverb = new Tone.Reverb({ decay: 2.8, wet: 1 }).connect(this.muffle);
    const echo = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.38, wet: 1 }).connect(this.muffle);
    echo.connect(reverb);

    // Drums
    const drums = new Tone.Distortion({ distortion: 0.12, wet: 0.5 }).connect(this.muffle);
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.028, octaves: 5.5, volume: -3,
      envelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.05 },
    }).connect(drums);
    const snareTone = new Tone.Filter({ frequency: 2200, type: 'bandpass', Q: 0.5 }).connect(drums);
    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' }, volume: -5,
      envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.03 },
    }).connect(snareTone);
    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.012, octaves: 1.4, volume: -9,
      envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.03 },
    }).connect(drums);
    const snareVerb = new Tone.Gain(0.12).connect(reverb);
    snareTone.connect(snareVerb);
    const hatTone = new Tone.Filter(9000, 'highpass').connect(this.muffle);
    this.hat = new Tone.NoiseSynth({
      noise: { type: 'white' }, volume: -19,
      envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 },
    }).connect(hatTone);
    this.openHat = new Tone.NoiseSynth({
      noise: { type: 'white' }, volume: -22,
      envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.05 },
    }).connect(hatTone);
    const crashTone = new Tone.Filter(5000, 'highpass').connect(this.muffle);
    crashTone.connect(new Tone.Gain(0.4).connect(reverb));
    this.crash = new Tone.NoiseSynth({
      noise: { type: 'white' }, volume: -17,
      envelope: { attack: 0.002, decay: 1.4, sustain: 0, release: 0.2 },
    }).connect(crashTone);

    // Everything tonal ducks under the kick
    this.duck = new Tone.Gain(1).connect(this.muffle);

    // Bass: a clean sine sub, and a detuned-saw reese whose filter opens with the level
    this.sub = new Tone.Synth({
      oscillator: { type: 'sine' }, volume: -7,
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.08 },
    }).connect(this.duck);
    this.reeseCutoff = new Tone.Filter({ frequency: REESE_CUTOFF[0], type: 'lowpass', rolloff: -24 }).connect(this.duck);
    const growl = new Tone.Distortion({ distortion: 0.35, wet: 0.6 }).connect(this.reeseCutoff);
    const wobble = new Tone.Filter({ type: 'lowpass', Q: 3 }).connect(growl);
    this.wobbleLfo = new Tone.LFO({ frequency: '2n', min: 350, max: 2600 }).connect(wobble.frequency).start();
    this.reese = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', count: 3, spread: 32 }, volume: -15,
      envelope: { attack: 0.015, decay: 0.2, sustain: 0.8, release: 0.1 },
    }).connect(wobble);

    // Pads, stabs and the pluck line
    const padTone = new Tone.Filter(1400, 'lowpass').connect(this.duck);
    padTone.connect(new Tone.Gain(0.5).connect(reverb));
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 18 }, volume: -27,
      envelope: { attack: 0.6, decay: 0.4, sustain: 0.8, release: 1.2 },
    }).connect(padTone);
    this.pad.maxPolyphony = 8;
    const stabTone = new Tone.Filter(2600, 'lowpass').connect(this.duck);
    stabTone.connect(new Tone.Gain(0.45).connect(echo));
    this.stab = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' }, volume: -24,
      envelope: { attack: 0.004, decay: 0.14, sustain: 0, release: 0.08 },
    }).connect(stabTone);
    this.stab.maxPolyphony = 8;
    this.lead = new Tone.Synth({
      oscillator: { type: 'triangle' }, volume: -17,
      envelope: { attack: 0.004, decay: 0.2, sustain: 0, release: 0.1 },
    }).connect(this.duck);
    this.lead.connect(new Tone.Gain(0.5).connect(echo));

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

    const d = drumStep(bar, step, level);
    if (d.kick) {
      this.kick.triggerAttackRelease('F1', 0.2, time, d.kick);
      const g = this.duck.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(0.35, time);
      g.linearRampToValueAtTime(1, time + 0.17);
    }
    if (d.snare) {
      this.snare.triggerAttackRelease(0.15, time, d.snare);
      if (d.snare === 1) this.snareBody.triggerAttackRelease('G3', 0.1, time);
    }
    // Every other hat leans back a touch: the difference between a grid and a groove
    if (d.hat) this.hat.triggerAttackRelease(0.03, time + (step % 2 ? 0.006 : 0), d.hat * (step % 4 === 2 ? 1 : 0.7));
    if (d.open) this.openHat.triggerAttackRelease(0.2, time, d.open);
    if (this.crashDue) {
      this.crashDue = false;
      this.crash.triggerAttackRelease(1.2, time);
    }

    const bass = bassStep(bar, step);
    if (bass) {
      const dur = bass.steps * SIXTEENTH * 0.92;
      this.sub.triggerAttackRelease(bass.note, dur, time);
      this.reese.triggerAttackRelease(Tone.Frequency(bass.note).transpose(12).toFrequency(), dur, time);
    }
    const pad = padStep(bar, step);
    if (pad) this.pad.triggerAttackRelease(pad.notes, pad.steps * SIXTEENTH * 0.9, time);
    const stab = stabStep(bar, step, level);
    if (stab) this.stab.triggerAttackRelease(stab.map((n) => Tone.Frequency(n).transpose(12).toFrequency()), 0.1, time);
    const lead = leadStep(bar, step);
    if (lead) this.lead.triggerAttackRelease(lead, 0.12, time, level === 2 ? 0.6 : 1);
  }
}

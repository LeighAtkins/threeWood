/**
 * The band: every voice of the soundtrack, played with Tone.js.
 *
 * Loaded on demand by music.js, so Tone and the break are only downloaded by
 * players who switch music on. One sixteenth-note callback reads the patterns
 * in core/dnbPattern.js and plays whatever falls on that step.
 *
 * The drums are one recorded breakbeat, sped up and sliced into eighth notes;
 * everything else is synthesised: a sub, an electric piano, strings, three
 * lead instruments that take turns with the tune, and a hummed voice (a saw
 * through vowel formants, mostly reverb).
 *
 * Break: "Amen Break G (165 BPM)" by Kevcio, CC0 — https://freesound.org/s/321221/
 */
import * as Tone from 'tone';
import {
  BPM, STEPS, BREAK_BPM, breakStep, bassStep, padStep, compStep, leadStep, humStep, isBreakdown, isReentry,
} from './core/dnbPattern.js';

const BREAK_URL = '/music/break-165.mp3';
const SIXTEENTH = 60 / BPM / 4;
const BREAK_EIGHTH = 60 / BREAK_BPM / 2;
const BREAK_RATE = BPM / BREAK_BPM;
const BREAK_GAIN = [0.5, 0.72, 0.8]; // by level
const DRUM_CUTOFF = [900, 20000, 20000];
const REESE_CUTOFF = [120, 180, 800];
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
    const hall = new Tone.Reverb({ decay: 7, preDelay: 0.03, wet: 1 }).connect(this.muffle);
    const echo = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.45, wet: 1 }).connect(this.muffle);
    echo.connect(reverb);

    // Drums: the break, driven a little, and a cymbal for the big moments
    const drive = new Tone.Distortion({ distortion: 0.06, wet: 0.2 }).connect(this.muffle);
    this.drums = new Tone.Filter({ frequency: DRUM_CUTOFF[0], type: 'lowpass', Q: 1 }).connect(drive);
    this.drums.connect(new Tone.Gain(0.07).connect(reverb));
    const crashTone = new Tone.Filter(5000, 'highpass').connect(this.muffle);
    crashTone.connect(new Tone.Gain(0.4).connect(reverb));
    this.crash = new Tone.NoiseSynth({
      noise: { type: 'white' }, volume: -17,
      envelope: { attack: 0.002, decay: 1.4, sustain: 0, release: 0.2 },
    }).connect(crashTone);

    // Bass: an 808-style sub that slides between notes, warmed up enough to
    // survive small speakers, and a detuned-saw layer an octave up that opens a little for the drop
    const warmth = new Tone.Distortion({ distortion: 0.18, wet: 0.5 }).connect(this.muffle);
    const subTone = new Tone.Filter(520, 'lowpass').connect(warmth);
    this.sub = new Tone.Synth({
      oscillator: { type: 'triangle' }, portamento: 0.07, volume: -9,
      envelope: { attack: 0.006, decay: 0.3, sustain: 0.85, release: 0.12 },
    }).connect(subTone);
    const reeseLevel = new Tone.Gain(0.3).connect(this.muffle);
    this.reeseCutoff = new Tone.Filter({ frequency: REESE_CUTOFF[0], type: 'lowpass', rolloff: -24 }).connect(reeseLevel);
    this.reese = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', count: 3, spread: 24 }, portamento: 0.07, volume: -16,
      envelope: { attack: 0.015, decay: 0.2, sustain: 0.8, release: 0.1 },
    }).connect(this.reeseCutoff);

    // Strings: a soft bed under everything, mostly reverb
    const padTone = new Tone.Filter(1700, 'lowpass').connect(new Tone.Gain(0.35).connect(this.muffle));
    padTone.connect(new Tone.Gain(0.8).connect(reverb));
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 18 }, volume: -25,
      envelope: { attack: 0.7, decay: 0.5, sustain: 0.8, release: 1.4 },
    }).connect(padTone);
    this.pad.maxPolyphony = 16;

    // Electric piano: FM with a bark that fades, through a chorus
    const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 4, depth: 0.5, wet: 0.5 }).connect(this.muffle).start();
    chorus.connect(new Tone.Gain(0.25).connect(reverb));
    this.keys = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1, modulationIndex: 4.5, volume: -17,
      oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.004, decay: 1.2, sustain: 0.25, release: 0.3 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0.1, release: 0.3 },
    }).connect(chorus);
    this.keys.maxPolyphony = 24;

    // The tune, on whichever instrument has it this time round
    const leadBus = new Tone.Gain(1).connect(this.muffle);
    leadBus.connect(new Tone.Gain(0.28).connect(echo));
    leadBus.connect(new Tone.Gain(0.3).connect(reverb));
    const synthTone = new Tone.Filter({ frequency: 2600, type: 'lowpass', Q: 1 }).connect(leadBus);
    this.leads = {
      // Glassy FM bell
      bell: new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01, modulationIndex: 9, volume: -17,
        envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.9 },
        modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.4 },
      }).connect(leadBus),
      // Warm gliding synth lead with a little vibrato
      synth: new Tone.Synth({
        oscillator: { type: 'fatsawtooth', count: 2, spread: 14 }, portamento: 0.04, volume: -19,
        envelope: { attack: 0.02, decay: 0.25, sustain: 0.7, release: 0.25 },
      }).chain(new Tone.Vibrato(5.5, 0.08), synthTone),
      // Plucked string, koto-bright
      koto: new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2, modulationIndex: 14, volume: -15,
        envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.3 },
        modulationEnvelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.1 },
      }).connect(leadBus),
    };

    // The voice: two saws through three vowel formants ("ooh"), gliding
    // between notes with a slow vibrato, and sent almost entirely to the hall
    const humOut = new Tone.Gain(0.22).connect(this.muffle);
    const humBus = new Tone.Filter(3000, 'lowpass').connect(humOut);
    humBus.connect(new Tone.Gain(1.1).connect(hall));
    const vibrato = new Tone.Vibrato(5.1, 0.1);
    for (const [frequency, Q, gain] of [[380, 4, 3.2], [860, 6, 1.6], [2500, 8, 0.5]]) {
      vibrato.connect(new Tone.Filter({ frequency, type: 'bandpass', Q }).connect(new Tone.Gain(gain).connect(humBus)));
    }
    this.hum = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', count: 2, spread: 10 }, portamento: 0.11, volume: -12,
      envelope: { attack: 0.22, decay: 0.4, sustain: 0.85, release: 0.9 },
    }).connect(vibrato);

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
    if (pad) this.pad.triggerAttackRelease(pad.notes, pad.steps * SIXTEENTH * 0.9, time, 0.8);
    const comp = compStep(bar, step);
    if (comp) this.keys.triggerAttackRelease(comp.notes, comp.steps * SIXTEENTH * 0.9, time, step === 0 ? 0.9 : 0.65);
    const lead = leadStep(bar, step);
    if (lead) this.leads[lead.voice].triggerAttackRelease(lead.note, lead.steps * SIXTEENTH * 0.92, time);
    const hum = humStep(bar, step);
    if (hum) this.hum.triggerAttackRelease(hum.note, hum.steps * SIXTEENTH * 0.95, time, isBreakdown(bar) ? 1 : 0.8);
  }
}

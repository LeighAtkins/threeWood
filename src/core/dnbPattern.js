/**
 * The soundtrack as data: 170 BPM liquid drum & bass with a city-pop heart.
 * A real breakbeat played the way the drummer played it (a fill every eighth
 * bar, a few extra cuts when the ball is in the air), under a rolling sub,
 * electric-piano sevenths and ninths, and a pentatonic tune that is handed
 * from instrument to instrument, answered by a hummed line drowned in reverb.
 *
 * Pure (no audio) so it can be tested and tweaked without a browser. Time is
 * counted in sixteenths: 16 steps to a bar, a 16-bar form, and four passes
 * through the form before the instrumentation comes round again. `level` is
 * how hard the track is playing:
 *   0  lobby  — the break heard through a wall
 *   1  groove — the break as recorded
 *   2  drop   — a few extra cuts, the bass opens up
 */
import { mulberry32 } from './rng.js';

export const BPM = 170;
export const STEPS = 16;

/** Which level each game state plays at. */
export const SCENE_LEVEL = {
  title: 0, summary: 0,
  intro: 1, aim: 1, swing: 1, settle: 1, holed: 1, result: 1,
  flight: 2,
};

// --- The break ---------------------------------------------------------------
// The recording is BREAK_BARS bars of a drummer at BREAK_BPM, cut into eighth
// notes: slice n is eighth (n % 8) of bar floor(n / 8). The chopper knows
// nothing else about it, so any tight loop of a break can be swapped in.

export const BREAK_BPM = 165;
export const BREAK_BARS = 8;
const EIGHTHS = 8;
const BACKBEATS = [2, 6]; // the eighths a drummer puts the snare on

// How often each move is made, by level: [stutter, misplaced snare, roll].
// Sparingly: the drummer is the groove, the edits are seasoning.
const MOVES = [[0, 0, 0], [0, 0, 0], [0.05, 0, 0.07]];
// How often an eighth comes from the bar the recording has reached, not a borrowed one
const HOME = [1, 1, 1];

const bars = new Map();

/**
 * One bar of break edits: 16 entries, each null (let it ring) or
 * { slice, semis }. The same bar and level always give the same edit.
 */
function breakBar(bar, level) {
  const key = bar * 3 + level;
  if (bars.has(key)) return bars.get(key);
  const rng = mulberry32(0x7a31 + key * 7919);
  const pick = (n) => Math.floor(rng() * n);
  const row = new Array(STEPS).fill(null);
  const home = bar % BREAK_BARS;
  const from = (eighth) => (rng() < HOME[level] ? home : pick(BREAK_BARS)) * EIGHTHS + eighth;
  const [stutter, misplace, roll] = MOVES[level];
  let last = from(0);
  for (let e = 0; e < EIGHTHS; e++) {
    const r = e === 0 ? 1 : rng(); // the one is always the one
    let slice = from(e);
    if (r < stutter) slice = last;
    else if (r < stutter + misplace) slice = pick(BREAK_BARS) * EIGHTHS + BACKBEATS[pick(2)];
    row[e * 2] = { slice, semis: 0 };
    if (r >= stutter + misplace && r < stutter + misplace + roll) row[e * 2 + 1] = { slice, semis: 2 };
    last = slice;
  }
  // Every 8th bar ends on a short snare fill, falling in pitch
  if (level > 0 && bar % 8 === 7) {
    const snare = home * EIGHTHS + BACKBEATS[0];
    for (let s = 12; s < STEPS; s++) row[s] = { slice: snare, semis: 3 - (s - 12) };
  }
  if (bars.size > 512) bars.clear();
  bars.set(key, row);
  return row;
}

/** The break slice starting on this step, if any: { slice, semis, steps }. */
export function breakStep(bar, step, level) {
  const row = breakBar(bar, level);
  const hit = row[step];
  if (!hit) return null;
  let steps = 1;
  while (step + steps < STEPS && !row[step + steps]) steps++;
  return { ...hit, steps };
}

// --- Arrangement -------------------------------------------------------------

export const FORM_BARS = 16;
/** The last 4 bars of every 16 drop the bass out and leave room for the voice. */
export const isBreakdown = (bar) => bar % FORM_BARS >= 12;
/** A cymbal marks the bass coming back. */
export const isReentry = (bar, step) => step === 0 && bar % FORM_BARS === 0 && bar > 0;
/** Which pass through the form this is (0..3): decides who has the tune. */
export const sectionOf = (bar) => Math.floor(bar / FORM_BARS) % 4;

// --- Harmony -----------------------------------------------------------------
// Ab major, and the progression half of city pop is built on: IV - V - iii - vi
// (Dbmaj9, Eb9, Cm9, Fm9), two bars each; the second time round it goes home
// by way of a ii-V into the IV (Ebm9, Ab13). Keys voicings are rootless: the
// bass has the root.

const CHORDS = {
  Db:  { bass: ['Db2', 'Ab2', 'Db3'], keys: ['F3', 'Ab3', 'C4', 'Eb4'] },
  Eb:  { bass: ['Eb2', 'Bb2', 'Eb3'], keys: ['G3', 'Bb3', 'Db4', 'F4'] },
  Cm:  { bass: ['C2', 'G2', 'C3'],    keys: ['Bb3', 'D4', 'Eb4', 'G4'] },
  Fm:  { bass: ['F2', 'C3', 'F3'],    keys: ['Ab3', 'C4', 'Eb4', 'G4'] },
  Ebm: { bass: ['Eb2', 'Bb2', 'Eb3'], keys: ['Gb3', 'Bb3', 'Db4', 'F4'] },
  Ab:  { bass: ['Ab2', 'Eb3', 'Ab3'], keys: ['Gb3', 'Bb3', 'C4', 'F4'] },
};
const FORM = ['Db', 'Db', 'Eb', 'Eb', 'Cm', 'Cm', 'Fm', 'Fm', 'Db', 'Db', 'Eb', 'Eb', 'Fm', 'Fm', 'Ebm', 'Ab'];
const chordAt = (bar) => CHORDS[FORM[bar % FORM_BARS]];
const chordStarts = (bar) => bar % FORM_BARS === 0 || FORM[bar % FORM_BARS] !== FORM[(bar % FORM_BARS) - 1];

/** The pad chord starting on this step, if any: { notes, steps }. */
export function padStep(bar, step) {
  if (step !== 0 || !chordStarts(bar)) return null;
  let bars = 1;
  while (bars < 2 && !chordStarts(bar + bars)) bars++;
  return { notes: chordAt(bar).keys, steps: bars * STEPS };
}

// Electric piano comping: [step, length], pushed off the beat the way the style likes it
const COMP = [
  [[0, 5], [6, 4], [11, 4]],
  [[0, 3], [3, 3], [8, 5], [14, 2]],
];
const COMP_INTRO = [[[0, 10]], [[0, 6], [11, 4]]];

/** The keys chord starting on this step, if any: { notes, steps }. The first pass is sparse. */
export function compStep(bar, step) {
  const hit = (sectionOf(bar) === 0 ? COMP_INTRO : COMP)[bar % 2].find((n) => n[0] === step);
  return hit ? { notes: chordAt(bar).keys, steps: hit[1] } : null;
}

// --- Bass --------------------------------------------------------------------
// [step, chord degree (0 root, 1 fifth, 2 octave), length]: a long root, then it rolls

const BASS = [
  [[0, 0, 6], [8, 0, 2], [11, 2, 2], [14, 1, 2]],
  [[0, 0, 5], [6, 1, 2], [8, 0, 4], [14, 2, 2]],
];

/** The bass note starting on this step, if any: { note, steps }. */
export function bassStep(bar, step) {
  if (isBreakdown(bar)) return null;
  const hit = BASS[bar % 2].find((n) => n[0] === step);
  return hit ? { note: chordAt(bar).bass[hit[1]], steps: hit[2] } : null;
}

// --- The tune ----------------------------------------------------------------
// Sixteen bars, written on the major pentatonic (the "yonanuki" scale of
// Japanese pop: no 4th, no 7th) with the odd chord tone borrowed for colour.
// One row per bar: [step, note, length].

const TUNE = [
  [[4, 'C5', 2], [6, 'Eb5', 2], [8, 'F5', 4], [12, 'Eb5', 2], [14, 'C5', 2]],
  [[0, 'Ab4', 6], [10, 'Bb4', 2], [12, 'C5', 4]],
  [[0, 'Bb4', 6], [8, 'G4', 2], [10, 'Bb4', 2], [12, 'F5', 4]],
  [[0, 'Eb5', 8], [12, 'C5', 2], [14, 'Bb4', 2]],
  [[0, 'G4', 4], [4, 'Bb4', 2], [6, 'C5', 4], [10, 'Eb5', 2], [12, 'G5', 4]],
  [[0, 'F5', 2], [2, 'Eb5', 6], [12, 'C5', 2], [14, 'Eb5', 2]],
  [[0, 'F5', 6], [6, 'Eb5', 2], [8, 'C5', 4], [12, 'Ab4', 4]],
  [[0, 'C5', 10]],
  [[2, 'F5', 2], [4, 'Ab5', 4], [8, 'F5', 2], [10, 'Eb5', 2], [12, 'C5', 4]],
  [[0, 'Eb5', 6], [6, 'F5', 2], [8, 'Ab5', 6]],
  [[0, 'G5', 4], [4, 'F5', 2], [6, 'Eb5', 4], [10, 'Bb4', 2], [12, 'Db5', 4]],
  [[0, 'Eb5', 8], [10, 'G5', 2], [12, 'Bb5', 4]],
  [[0, 'Ab5', 4], [4, 'G5', 2], [6, 'F5', 4], [10, 'Eb5', 2], [12, 'C5', 4]],
  [[0, 'Eb5', 6], [6, 'C5', 2], [8, 'Ab4', 6]],
  [[0, 'Bb4', 2], [2, 'Db5', 2], [4, 'F5', 4], [8, 'Gb5', 4], [12, 'F5', 4]],
  [[0, 'Eb5', 4], [4, 'C5', 4], [8, 'Bb4', 2], [10, 'C5', 6]],
];

// Who plays the tune on each pass through the form. The first pass has no
// lead at all: the voice introduces the song.
export const LEAD_VOICES = [null, 'bell', 'synth', 'koto'];

/** The lead note starting on this step, if any: { note, steps, voice }. */
export function leadStep(bar, step) {
  const voice = LEAD_VOICES[sectionOf(bar)];
  if (!voice) return null;
  const hit = TUNE[bar % FORM_BARS].find((n) => n[0] === step);
  return hit ? { note: hit[1], steps: hit[2], voice } : null;
}

// The hummed line: long notes that lean on the colour of each chord.
// [step within the two-bar chord, note, length]
const HUM = [
  [[0, 'C5', 22], [24, 'Eb5', 8]],
  [[0, 'Db5', 20], [22, 'Bb4', 10]],
  [[0, 'Bb4', 22], [24, 'G4', 8]],
  [[0, 'Ab4', 20], [22, 'C5', 10]],
  [[0, 'F5', 22], [24, 'Eb5', 8]],
  [[0, 'G5', 16], [18, 'F5', 14]],
  [[0, 'Eb5', 22], [24, 'C5', 8]],
  [[0, 'Db5', 14], [16, 'C5', 16]],
];

/**
 * The hummed note starting on this step, if any: { note, steps }. The voice
 * sings the first and third passes, and every breakdown.
 */
export function humStep(bar, step) {
  if (sectionOf(bar) % 2 === 1 && !isBreakdown(bar)) return null;
  const at = (bar % 2) * STEPS + step;
  const hit = HUM[Math.floor((bar % FORM_BARS) / 2)].find((n) => n[0] === at);
  return hit ? { note: hit[1], steps: hit[2] } : null;
}

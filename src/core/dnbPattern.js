/**
 * The soundtrack as data: 170 BPM jungle. A real breakbeat, re-chopped
 * differently every bar, over a heavy sliding sub, dark pads and the odd
 * rave stab. No melody to get sick of.
 *
 * Pure (no audio) so it can be tested and tweaked without a browser. Time is
 * counted in sixteenths: 16 steps to a bar, a 4-bar chord loop, a 16-bar
 * arrangement. `level` is how hard the track is playing:
 *   0  lobby  — the break heard through a wall, pads and sub
 *   1  groove — the break chopped, stabs
 *   2  drop   — the break shredded, the reese opens
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

// How often each move is made, by level: [stutter, misplaced snare, roll]
const MOVES = [[0, 0, 0], [0.14, 0.12, 0.08], [0.2, 0.26, 0.2]];
// How often an eighth comes from the bar the recording has reached, not a borrowed one
const HOME = [1, 0.7, 0.4];

const bars = new Map();

/**
 * One bar of break edits: 16 entries, each null (let it ring) or
 * { slice, semis }. The same bar and level always give the same edit, and no
 * two bars are cut alike.
 */
function breakBar(bar, level) {
  const key = bar * 3 + level;
  if (bars.has(key)) return bars.get(key);
  const rng = mulberry32(0x7a31 + key * 7919);
  const pick = (n) => Math.floor(rng() * n);
  const row = new Array(STEPS).fill(null);
  // The lobby just loops the recording; the round borrows eighths from other bars
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
  // Every 8th bar ends on the junglist's signature: a snare rush falling in pitch
  if (level > 0 && bar % 8 === 7) {
    const snare = pick(BREAK_BARS) * EIGHTHS + BACKBEATS[0];
    for (let s = 8; s < STEPS; s++) row[s] = { slice: snare, semis: 5 - (s - 8) };
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

/** The last 4 bars of every 16 drop the bass out and leave the break alone. */
export const isBreakdown = (bar) => bar % 16 >= 12;
/** A cymbal marks the bass coming back. */
export const isReentry = (bar, step) => step === 0 && bar % 16 === 0 && bar > 0;

// --- Bass --------------------------------------------------------------------
// [step, note, length in steps]: long 808-style notes that slide into each other

const BASS = [
  [[0, 'F1', 7], [10, 'F1', 2], [12, 'Ab1', 4]],
  [[0, 'F1', 7], [8, 'C2', 3], [12, 'Eb2', 4]],
  [[0, 'Db2', 6], [8, 'Db2', 2], [10, 'C2', 6]],
  [[0, 'Bb1', 6], [8, 'C2', 4], [12, 'E2', 2], [14, 'C2', 2]],
];

/** The bass note starting on this step, if any: { note, steps }. */
export function bassStep(bar, step) {
  if (isBreakdown(bar)) return null;
  const hit = BASS[bar % 4].find((n) => n[0] === step);
  return hit ? { note: hit[1], steps: hit[2] } : null;
}

// --- Harmony -----------------------------------------------------------------
// Fm9 for two bars, then Dbmaj7, then Bbm7

const CHORDS = [
  { bars: 2, notes: ['F3', 'Ab3', 'C4', 'G4'] },
  null,
  { bars: 1, notes: ['Db3', 'F3', 'Ab3', 'C4'] },
  { bars: 1, notes: ['Bb2', 'Db3', 'F3', 'Ab3'] },
];
const chordAt = (bar) => CHORDS[bar % 4] ?? CHORDS[(bar % 4) - 1];

/** The pad chord starting on this step, if any: { notes, steps }. */
export function padStep(bar, step) {
  const chord = step === 0 ? CHORDS[bar % 4] : null;
  return chord ? { notes: chord.notes, steps: chord.bars * STEPS } : null;
}

// Rave stabs, sparse: bar of the 4-bar loop -> steps
const STABS = { 1: [6, 9], 3: [12] };

/** The chord stabbed on this step, if any. The lobby has none. */
export function stabStep(bar, step, level) {
  return level > 0 && STABS[bar % 4]?.includes(step) ? chordAt(bar).notes.slice(1) : null;
}

/**
 * The soundtrack as data: a 174 BPM drum & bass loop in F minor.
 *
 * Pure (no audio) so it can be tested and tweaked without a browser. Time is
 * counted in sixteenths: 16 steps to a bar, a 4-bar harmonic loop, a drum
 * fill every 8th bar. `level` is how hard the track is playing:
 *   0  lobby  — kick, hats, sub and pads; no snare
 *   1  groove — the full two-step
 *   2  drop   — ghost snares, rolling hats, open reese and stabs
 */

export const BPM = 174;
export const STEPS = 16;

/** Which level each game state plays at. */
export const SCENE_LEVEL = {
  title: 0, summary: 0,
  intro: 1, aim: 1, swing: 1, settle: 1, holed: 1, result: 1,
  flight: 2,
};

// x = full hit, o = ghost, . = rest
const row = (pattern) => [...pattern].map((c) => (c === 'x' ? 1 : c === 'o' ? 0.3 : 0));

const KICK = {
  lobby: row('x.........x.....'),
  groove: [row('x.........x.....'), row('x.........x.....'), row('x.........x.....'), row('x.....x...x.....')],
  drop: [row('x.........x.....'), row('x.x.......xx....'), row('x.........x.....'), row('x.....x...x..x..')],
};
const SNARE = {
  groove: row('....x.......x...'),
  drop: [row('....x..o.o..x...'), row('....x..o.o..x..o')],
  fill: row('....x..o..x.xxxx'),
};
const HAT = {
  lobby: row('o.x.o.x.o.x.o.x.'),
  groove: row('x.x.x.x.x.x.x.x.'),
  drop: row('xoxoxoxoxoxoxoxo'),
};
const OPEN_HAT = row('..............x.');

/** Velocities (0..1) for each drum voice at one step. */
export function drumStep(bar, step, level) {
  if (level <= 0) return { kick: KICK.lobby[step] * 0.8, snare: 0, hat: HAT.lobby[step], open: 0 };
  const fill = bar % 8 === 7;
  if (level === 1) {
    return {
      kick: KICK.groove[bar % 4][step],
      snare: (fill ? SNARE.fill : SNARE.groove)[step],
      hat: HAT.groove[step],
      open: bar % 2 ? OPEN_HAT[step] : 0,
    };
  }
  return {
    kick: KICK.drop[bar % 4][step],
    snare: (fill ? SNARE.fill : SNARE.drop[bar % 2])[step],
    hat: HAT.drop[step],
    open: OPEN_HAT[step],
  };
}

// [step, note, length in steps] — the sub plays these, the reese an octave up
const BASS = [
  [[0, 'F1', 5], [6, 'F1', 2], [10, 'Ab1', 3], [14, 'G1', 2]],
  [[0, 'F1', 5], [6, 'F2', 1], [8, 'Eb1', 4], [12, 'C2', 3]],
  [[0, 'Db2', 5], [6, 'Db2', 2], [10, 'C2', 3], [14, 'Bb1', 2]],
  [[0, 'Bb1', 6], [8, 'C2', 3], [12, 'Eb2', 2], [14, 'E2', 2]],
];

/** The bass note starting on this step, if any: { note, steps }. */
export function bassStep(bar, step) {
  const hit = BASS[bar % 4].find((n) => n[0] === step);
  return hit ? { note: hit[1], steps: hit[2] } : null;
}

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

/** Off-beat chord stabs; only the drop has them. */
export function stabStep(bar, step, level) {
  return level >= 2 && (step === 3 || step === 11) ? chordAt(bar).notes : null;
}

// A two-bar pluck line that floats over everything
const LEAD = {
  0: 'C5', 3: 'Ab4', 6: 'G4', 10: 'Eb4', 14: 'F4',
  16: 'C5', 19: 'Eb5', 22: 'C5', 26: 'G4',
};

export function leadStep(bar, step) {
  return LEAD[(bar % 2) * STEPS + step] ?? null;
}

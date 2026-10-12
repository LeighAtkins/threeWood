/**
 * The meta-game in a room: every hole has a contest, the winner wears the
 * crown on the next hole, and the crown comes with a perk. Everything here is
 * pure and seeded, so every phone picks the same contest and judges the same
 * winner from the same numbers (the stats each player reports when done).
 *
 * Stats per player per hole: strokes, putts, drive (yards the tee shot
 * carried, par 4/5), pin (yards from the pin after the tee shot, par 3),
 * near (yards from the pin the first time on the green, or null).
 */

import { hashSeed, mulberry32 } from './rng.js';

const ft = (v) => `${Math.round(v * 3)} FT`;

export const CONTESTS = {
  drive: { label: 'LONGEST DRIVE', stat: 'drive', best: 'max', min: 30, fmt: (v) => `${Math.round(v)}Y` },
  pin:   { label: 'CLOSEST TO THE PIN', stat: 'pin', best: 'min', fmt: ft },
  near:  { label: 'CLOSEST APPROACH', stat: 'near', best: 'min', fmt: ft },
  putts: { label: 'FEWEST PUTTS', stat: 'putts', best: 'min', tie: 'strokes', fmt: (v) => `${v} PUTT${v === 1 ? '' : 'S'}` },
  hole:  { label: 'HOLE WINNER', stat: 'strokes', best: 'min', tie: 'putts', fmt: (v) => `${v} STROKE${v === 1 ? '' : 'S'}` },
};

// What each par can be contested on (repeats weight the draw)
const DRAW = {
  3: ['pin', 'pin', 'putts', 'hole'],
  4: ['drive', 'near', 'putts', 'hole'],
  5: ['drive', 'drive', 'near', 'hole', 'putts'],
  minigolf: ['hole', 'putts'],
};

/** The contest on hole `index` of the round. The first hole is always the classic. */
export function contestFor(seed, index, par, archetype = null) {
  const pool = DRAW[archetype] || DRAW[par] || DRAW[4];
  let id;
  if (index === 0 && !DRAW[archetype]) id = par === 3 ? 'pin' : 'drive';
  else id = pool[Math.floor(mulberry32(hashSeed(`${seed}:contest:${index}`))() * pool.length)];
  return { id, ...CONTESTS[id] };
}

/**
 * Who won. entries: [{ id, stats }]. The best value wins outright; a tie is
 * broken by the contest's tie stat (fewer is better); still tied, nobody wins.
 * Returns { id, v } or null.
 */
export function judgeContest(contest, entries) {
  const val = (s) => {
    const v = s?.[contest.stat];
    if (v == null || !Number.isFinite(v)) return null;
    if (contest.min != null && v < contest.min) return null;
    return v;
  };
  let best = null;
  const tied = [];
  for (const e of entries) {
    const v = val(e.stats);
    if (v === null) continue;
    if (best === null || (contest.best === 'max' ? v > best : v < best)) { best = v; tied.length = 0; tied.push(e); }
    else if (v === best) tied.push(e);
  }
  if (!tied.length) return null;
  if (tied.length === 1) return { id: tied[0].id, v: best };
  if (!contest.tie) return null;
  let low = Infinity, who = [];
  for (const e of tied) {
    const t = e.stats?.[contest.tie];
    if (t == null) continue;
    if (t < low) { low = t; who = [e]; } else if (t === low) who.push(e);
  }
  return who.length === 1 ? { id: who[0].id, v: best } : null;
}

/** What the crown is worth on the hole after you win it. */
export const PERKS = {
  tailwind: { label: 'TAILWIND', blurb: 'A breeze at your back all hole.', wind: 8 },
  bigcup:   { label: 'BIG CUP', blurb: 'The hole is half again as wide.', cup: 1.5 },
  surefoot: { label: 'SURE FOOTING', blurb: 'Rough and sand cost you half as much.', lieHalf: true },
};

export function perkFor(seed, index) {
  const ids = Object.keys(PERKS);
  const id = ids[Math.floor(mulberry32(hashSeed(`${seed}:perk:${index}`))() * ids.length)];
  return { id, ...PERKS[id] };
}

import { createBall, launchBall, simulate, flatWorld, BALL_R } from './ballSim.js';

/**
 * The club bag.
 *
 * Each club is a launch profile: loft, backspin, and a target carry. The ball
 * speed that produces that carry is solved against the real physics at load
 * (so retuning drag or lift can never leave the yardage book out of date).
 *
 * Power is a 0..100 meter reading; speed = maxSpeed · (power/100)^POWER_CURVE.
 * distanceAt()/powerFor() convert between meter and yards using a per-club
 * table measured on a flat fairway. Pure module: no THREE, no DOM.
 */

const POWER_CURVE = 0.6;

const BAG = [
  { id: 'driver', name: 'Driver',     short: 'DR', loft: 12, spin: 0.25, carry: 170 },
  { id: 'wood3',  name: '3 Wood',     short: '3W', loft: 14, spin: 0.30, carry: 155 },
  { id: 'iron5',  name: '5 Iron',     short: '5i', loft: 19, spin: 0.45, carry: 138 },
  { id: 'iron7',  name: '7 Iron',     short: '7i', loft: 24, spin: 0.60, carry: 120 },
  { id: 'iron9',  name: '9 Iron',     short: '9i', loft: 30, spin: 0.75, carry: 102 },
  { id: 'pw',     name: 'Pitching Wedge', short: 'PW', loft: 37, spin: 0.90, carry: 85 },
  { id: 'sw',     name: 'Sand Wedge', short: 'SW', loft: 46, spin: 1.00, carry: 62 },
  { id: 'chip',   name: 'Chipper',    short: 'CH', loft: 26, spin: 0.20, carry: 24 },
  { id: 'putter', name: 'Putter',     short: 'PT', loft: 0,  spin: 0,    carry: 0 },
];

const LAWN = flatWorld('fairway');
const POWER_STEPS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function flight(club, speed) {
  const ball = createBall(0, BALL_R, 0);
  launchBall(ball, { speed, dirX: 1, dirZ: 0, loftDeg: club.loft, back: club.spin });
  simulate(ball, LAWN, null, { maxTime: 40 });
  return { carry: ball.landX, total: ball.x };
}

function solveSpeed(club) {
  let lo = 5, hi = 120;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (flight(club, mid).carry < club.carry) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function speedAt(club, power) {
  return club.maxSpeed * Math.pow(Math.max(0, Math.min(100, power)) / 100, POWER_CURVE);
}

export const CLUBS = BAG.map((def) => {
  const club = { ...def };
  if (club.id === 'putter') {
    club.maxSpeed = 0;
    club.table = [];
    club.total = 0;
    return club;
  }
  club.maxSpeed = solveSpeed(club);
  club.table = POWER_STEPS.map((p) => ({ power: p, ...flight(club, speedAt(club, p)) }));
  club.total = club.table[club.table.length - 1].total;
  return club;
});

export const PUTTER = CLUBS[CLUBS.length - 1];

export function clubById(id) {
  return CLUBS.find((c) => c.id === id) || CLUBS[0];
}

/** Total distance (carry + roll, flat fairway) at a meter reading. */
export function distanceAt(club, power, speedFactor = 1) {
  const t = club.table;
  if (!t.length) return 0;
  // A lie that bleeds speed is the same as swinging at a lower meter reading
  const p = Math.max(0, Math.min(100, power * Math.pow(speedFactor, 1 / POWER_CURVE)));
  if (p <= t[0].power) return t[0].total * (p / t[0].power);
  for (let i = 1; i < t.length; i++) {
    if (p <= t[i].power) {
      const f = (p - t[i - 1].power) / (t[i].power - t[i - 1].power);
      return t[i - 1].total + (t[i].total - t[i - 1].total) * f;
    }
  }
  return t[t.length - 1].total;
}

/** Meter reading that sends the ball `distance` yards. Clamped to 4..100. */
export function powerFor(club, distance, speedFactor = 1) {
  let lo = 0, hi = 100;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (distanceAt(club, mid, speedFactor) < distance) lo = mid; else hi = mid;
  }
  return Math.max(4, Math.min(100, (lo + hi) / 2));
}

// --- Lies -------------------------------------------------------------------

/**
 * What the ground does to the strike. Grass between face and ball bleeds
 * speed and spin; sand takes more and pops the ball up.
 */
export const LIES = {
  tee:     { id: 'tee',     name: 'Tee',     speedFactor: 1,    spinFactor: 1,    loftBonus: 0, scatterDeg: 0 },
  fairway: { id: 'fairway', name: 'Fairway', speedFactor: 1,    spinFactor: 1,    loftBonus: 0, scatterDeg: 0 },
  fringe:  { id: 'fringe',  name: 'Fringe',  speedFactor: 1,    spinFactor: 1,    loftBonus: 0, scatterDeg: 0 },
  green:   { id: 'green',   name: 'Green',   speedFactor: 1,    spinFactor: 1,    loftBonus: 0, scatterDeg: 0 },
  rough:   { id: 'rough',   name: 'Rough',   speedFactor: 0.86, spinFactor: 0.5,  loftBonus: 0, scatterDeg: 2 },
  bunker:  { id: 'bunker',  name: 'Bunker',  speedFactor: 0.72, spinFactor: 0.6,  loftBonus: 4, scatterDeg: 1.5 },
};

export function lieFor(surface) {
  return LIES[surface] || LIES.fairway;
}

/** Clubs that make sense from a lie (no driver off the deck, wedges from sand). */
export function clubAllowed(club, lie, onTee) {
  if (club.id === 'driver') return onTee;
  if (lie.id === 'bunker') return ['iron9', 'pw', 'sw'].includes(club.id);
  if (lie.id === 'rough') return club.id !== 'wood3';
  if (club.id === 'putter') return lie.id === 'green' || lie.id === 'fringe' || lie.id === 'fairway';
  return true;
}

/**
 * Pick the club for a distance: the shortest one whose full swing still gets
 * there, so the asking shot is a confident swing rather than a feathered one.
 */
export function autoSelectClub(distance, lie, onTee) {
  if (lie.id === 'green') return PUTTER;
  if (lie.id === 'fringe' && distance < 12) return PUTTER;
  let longest = null;
  for (let i = CLUBS.length - 2; i >= 0; i--) {
    const club = CLUBS[i];
    if (!clubAllowed(club, lie, onTee)) continue;
    longest = club;
    if (distanceAt(club, 100, lie.speedFactor) >= distance) return club;
  }
  return longest || CLUBS[3];
}

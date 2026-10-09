/**
 * Progression — how a round teaches, then tests.
 *
 * A first-time player must never be confused, and a player who has got it
 * must never be bored. So the round is a ramp:
 *
 *   - the COURSE gets meaner hole by hole (wind, green slopes, tucked pins,
 *     tighter fairways) — deterministic from the hole number, so a shared
 *     seed is the same course for everyone;
 *   - the ASSISTS fade (meter tempo, strike windows, how much of the putt
 *     line is drawn, conceded tap-ins) — by how far into the round you are,
 *     plus "heat": play well and they fade faster, struggle and they return;
 *   - each hole sets one CHALLENGE, and the early holes each carry one new
 *     idea from the caddie.
 *
 * Pure module: no THREE, no DOM.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** 0..1 for a course hole (1..18): hole 1 is a welcome, then it climbs to full by the 12th. */
export function holeDifficulty(number) {
  return clamp01((number - 1) / 11);
}

/** What the generator dials up as the course goes on. */
export function courseTuning(number) {
  const d = holeDifficulty(number);
  return {
    difficulty: d,
    wind: lerp(0.35, 1.3, d),          // multiplies the biome's wind
    slope: lerp(0.6, 1.25, d),         // green tilt and undulation
    pinNear: lerp(0.15, 0.42, d),      // pin distance from the middle, as a
    pinFar: lerp(0.5, 0.8, d),         //   fraction of the green's size
    pinEdge: lerp(0.62, 0.84, d),      // how close to the edge a pin may sit
    fairway: lerp(1.12, 0.86, d),      // fairway width
  };
}

/** Player-side level 0..1: position in the round plus how hot they are. */
export function playerLevel(index, total, heat = 0) {
  const base = total > 1 ? index / (total - 1) : 0;
  // Front-load the climb: a first session is about nine holes, and it has to
  // have become a real test by then or there is nothing to come back for
  return clamp01(Math.sqrt(base) + (index ? heat : 0));
}

/** Heat moves with results: birdies turn the screw, bogeys ease it. */
export function nextHeat(heat, strokes, par) {
  const d = strokes - par;
  const step = d <= -2 ? 0.16 : d === -1 ? 0.1 : d === 0 ? 0.03 : d === 1 ? -0.06 : -0.12;
  return Math.max(-0.25, Math.min(0.35, heat + step));
}

/** The assists at a level. */
export function assistsFor(level) {
  const l = clamp01(level);
  return {
    level: l,
    tempo: lerp(1, 1.45, l),            // meter speed
    tight: lerp(1, 1.9, l),             // strike windows shrink by this factor
    puttLine: l < 0.12 ? 1 : lerp(0.75, 0.28, clamp01((l - 0.12) / 0.7)), // share of the putt line drawn
    confirmLine: l < 0.3,               // tell the player when the read is right
    puttRate: lerp(1, 1.45, l),         // putt bar speed
    gimme: lerp(0.55, 0.22, l),         // conceded tap-in distance (yards)
  };
}

/** Five pips for the intro card. */
export function difficultyPips(courseD, level) {
  return Math.max(1, Math.min(5, 1 + Math.round(((courseD + level) / 2) * 4)));
}

// --- Caddie tips: one new idea per early hole --------------------------------

// Short, plain words and a picture each: they must work for someone reading
// in their second language. icon names are drawn by ui/glyphs.js.
const TIPS = [
  { icon: 'tap3', text: 'One tap for each dot on the button. This first time, the bar waits for you.' },
  { icon: 'wind', text: 'Wind pushes the ball. Aim a little into it.' },
  { icon: 'shape', text: 'Good hit? Swipe to curve the ball.' },
  { icon: 'dots', text: 'The dots roll downhill. Your putt line is shorter now.' },
  { icon: 'pin', text: 'The flag is near the edge. The middle is safe.' },
  { icon: 'fast', text: 'The bar is faster now.' },
];

export function caddieTip(index, level) {
  if (index < TIPS.length) return TIPS[index];
  if (level > 0.85) return { icon: 'pin', text: 'No more help. Good luck!' };
  return null;
}

// --- Challenges ----------------------------------------------------------------

/**
 * One objective per hole. `test(h)` reads the hole log:
 *   h.strokes, h.par, h.putts, h.fairway (tee shot found it), h.onGreenIn
 *   (stroke count when first on the green, or null), h.firstProximity (yards
 *   from the pin when first on the green), h.pures, h.longestDrive, h.dirty
 *   (rough, sand or a penalty at any point), h.longestPutt (feet holed)
 */
const C = {
  fairway:   { text: 'Hit the fairway', points: 200, test: (h) => h.fairway },
  onGreen:   { text: 'Hit the green in 1 shot', points: 300, test: (h) => h.onGreenIn === 1 },
  inTwo:     { text: 'On the green in 2 shots', points: 300, test: (h) => h.onGreenIn !== null && h.onGreenIn <= 2 },
  inThree:   { text: 'On the green in 3 shots', points: 250, test: (h) => h.onGreenIn !== null && h.onGreenIn <= 3 },
  reachTwo:  { text: 'On the green in 2 shots', points: 800, test: (h) => h.onGreenIn !== null && h.onGreenIn <= 2 },
  pure:      { text: '1 perfect hit', points: 200, test: (h) => h.pures >= 1 },
  twoPures:  { text: '2 perfect hits', points: 400, test: (h) => h.pures >= 2 },
  close:     { text: 'Land within 20 ft of the hole', points: 400, test: (h) => h.firstProximity !== null && h.firstProximity * 3 <= 20 },
  closer:    { text: 'Land within 10 ft of the hole', points: 700, test: (h) => h.firstProximity !== null && h.firstProximity * 3 <= 10 },
  twoPutt:   { text: '2 putts or fewer', points: 200, test: (h) => h.putts <= 2 && h.holed },
  onePutt:   { text: 'Only 1 putt', points: 400, test: (h) => h.putts <= 1 && h.holed },
  bomb:      { text: 'Drive 195 yards', points: 300, test: (h) => h.longestDrive >= 195 },
  clean:     { text: 'No rough, sand or water', points: 400, test: (h) => !h.dirty && h.holed },
  par:       { text: 'Par or better', points: 300, test: (h) => h.holed && h.strokes <= h.par },
  birdie:    { text: 'Birdie', points: 700, test: (h) => h.holed && h.strokes < h.par },
  inTwoShots: { text: 'Hole it in 2 shots', points: 500, test: (h) => h.holed && h.strokes <= 2 },
};

// Holes that play like something else ask for something else
const SPECIAL = { bucket: ['inTwoShots'], minigolf: ['par', 'inTwoShots'] };

// What is asked of each hole in turn, by par: early entries are the gentle
// ones, and each list is walked as the round goes on.
const LADDER = {
  3: ['onGreen', 'close', 'twoPutt', 'closer', 'birdie'],
  4: ['fairway', 'inTwo', 'pure', 'twoPutt', 'bomb', 'clean', 'onePutt', 'twoPures', 'par', 'birdie'],
  5: ['inThree', 'bomb', 'clean', 'reachTwo', 'birdie'],
};

/** The challenge for the hole at `index` in the round. `seen` counts earlier holes of that par. */
export function challengeFor(par, seenOfPar, archetype = null, seenOfKind = 0) {
  const ladder = SPECIAL[archetype] || LADDER[par] || LADDER[4];
  const id = ladder[Math.min(SPECIAL[archetype] ? seenOfKind : seenOfPar, ladder.length - 1)];
  return { id, ...C[id] };
}

export function newHoleLog(par) {
  return {
    par, strokes: 0, putts: 0, holed: false,
    fairway: false, onGreenIn: null, firstProximity: null,
    pures: 0, longestDrive: 0, dirty: false,
  };
}

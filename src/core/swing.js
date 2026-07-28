/**
 * The swing — ThreeWood's core interaction (Pillar 2).
 *
 * Classic 3-click, Everybody's Golf style:
 *   click 1 — start the marker climbing (power phase)
 *   click 2 — lock power; marker sweeps back down (accuracy phase)
 *   click 3 — stop the marker at the strike line
 *
 * Timing error on the strike line produces mishits:
 *   EARLY (marker above the line) -> closed face -> pull/hook, favors thin
 *   LATE  (marker past the line)  -> open face   -> push/slice, favors fat
 *   big errors also thin/fat the contact: less ball speed, wrong launch.
 *
 * Pure module: no THREE, no DOM, no timers. The seeded rng is passed in for
 * the thin/fat split so a whole round replays identically from its seed.
 */

export const SWING = {
  POWER_SPEED: 90,      // marker units/s on the way up (0 -> 100 in ~1.1s)
  ACCURACY_SPEED: 165,  // marker units/s on the way back down
  LINE: 8,              // strike line value on the return sweep
  WINDOW: 45,           // units of marker travel mapped to timing -1..+1
  FLOOR: 8 - 45,        // = -37: unclicked marker auto-hits here (max late)
  // Grade thresholds on |timing| (0..1). Pure is a ~±20ms skill window.
  PURE_MAX: 0.08,
  GOOD_MAX: 0.30,
  POOR_MAX: 0.60,
};

export function createSwing() {
  return {
    phase: 'idle', // 'idle' | 'power' | 'accuracy'
    power: 0,      // locked power 0..100
    marker: 0,     // live marker position (domain FLOOR..100)
  };
}

export function startSwing(swing) {
  swing.phase = 'power';
  swing.power = 0;
  swing.marker = 0;
}

/**
 * Click during a swing: power click locks power, accuracy click returns the
 * signed timing error for the strike. Returns null when the click was noise.
 */
export function swingClick(swing) {
  if (swing.phase === 'power') {
    swing.power = Math.max(2, Math.min(100, swing.marker));
    swing.marker = swing.power; // return sweep starts at the locked power
    swing.phase = 'accuracy';
    return { type: 'powerLocked', power: swing.power };
  }
  if (swing.phase === 'accuracy') {
    const timing = timingFromMarker(swing.marker);
    swing.phase = 'idle';
    return { type: 'strike', timing };
  }
  return null;
}

/**
 * Advance the marker. Auto-locks power at 100; auto-hits (max late) at FLOOR.
 * Returns the same event shapes as swingClick, or null while sweeping.
 */
export function swingStep(swing, dt) {
  if (swing.phase === 'power') {
    swing.marker += SWING.POWER_SPEED * dt;
    if (swing.marker >= 100) {
      swing.marker = 100;
      swing.power = 100;
      swing.phase = 'accuracy';
      return { type: 'powerLocked', power: 100, auto: true };
    }
  } else if (swing.phase === 'accuracy') {
    swing.marker -= SWING.ACCURACY_SPEED * dt;
    if (swing.marker <= SWING.FLOOR) {
      swing.marker = SWING.FLOOR;
      swing.phase = 'idle';
      return { type: 'strike', timing: -1, auto: true };
    }
  }
  return null;
}

/** Signed timing error from a marker stop: + early (pull side), - late (push). */
export function timingFromMarker(marker) {
  const t = (marker - SWING.LINE) / SWING.WINDOW;
  return Math.max(-1, Math.min(1, t));
}

/**
 * Map a timing error to the full strike outcome.
 * @param {number} timing -1..1 (+ early / - late), from timingFromMarker
 * @param {number} loft   current shot loft in degrees
 * @param {() => number} rng seeded stream (only consumed for poor/terrible)
 */
export function strikeFromTiming(timing, loft, rng) {
  const t = Math.max(-1, Math.min(1, timing));
  const at = Math.abs(t);
  const early = t > 0;

  const grade =
    at <= SWING.PURE_MAX ? 'pure' :
    at <= SWING.GOOD_MAX ? 'good' :
    at <= SWING.POOR_MAX ? 'poor' : 'terrible';

  // Higher-lofted clubs disperse less (shorter shots, more loft = less side yaw)
  const maxYawDeg = Math.max(5, 17.5 - 0.25 * loft);

  const strike = {
    timing: t,
    grade,
    early,
    contact: 'clean',
    yawDeg: 0,        // aim rotation at address (+ = left/pull, - = right/push)
    loftDelta: 0,     // launch loft adjustment
    speedFactor: 1,   // ball speed multiplier
    spinFactor: 1,    // backspin multiplier
    sidespinAdd: 0,   // free curve added on top of the player's spin selection
  };

  if (grade === 'pure') return strike;

  if (grade === 'good') {
    strike.yawDeg = t * maxYawDeg * 0.55;
    strike.speedFactor = 1 - 0.10 * at;
    strike.sidespinAdd = t * 0.9;
    return strike;
  }

  // Poor/terrible: seeded thin/fat split. Early misses favor thin (catching it
  // on the upswing), late misses favor fat (stuck behind it).
  const thinChance = early ? 0.65 : 0.35;
  strike.contact = (rng ? rng() : 0.5) < thinChance ? 'thin' : 'fat';

  if (strike.contact === 'thin') {
    strike.yawDeg = t * maxYawDeg;
    strike.loftDelta = -7;
    strike.speedFactor = 1 - (0.22 + 0.45 * at);
    strike.spinFactor = 0.45;
    strike.sidespinAdd = t * 1.3;
  } else {
    strike.yawDeg = t * maxYawDeg * 0.7;
    strike.loftDelta = 9;
    strike.speedFactor = 1 - (0.30 + 0.50 * at);
    strike.spinFactor = 1.6;
    strike.sidespinAdd = t * 0.9;
  }
  return strike;
}

/** Short HUD label for a strike, e.g. "PURE", "PULL · THIN", "PUSH". */
export function describeStrike(strike) {
  if (strike.grade === 'pure') return 'PURE!';
  const shape = strike.early ? 'PULL' : 'PUSH';
  const parts = [];
  if (strike.grade === 'terrible') parts.push('BIG');
  parts.push(shape);
  if (strike.contact !== 'clean') parts.push(`· ${strike.contact.toUpperCase()}`);
  return parts.join(' ');
}

/** Map a marker value to bar width % for the UI meter. */
export function markerToPercent(marker) {
  return ((marker - SWING.FLOOR) / (100 - SWING.FLOOR)) * 100;
}

/** Map a marker value to bar left-edge % for the UI meter. */
export function markerToLeftPercent(marker) {
  return markerToPercent(marker);
}

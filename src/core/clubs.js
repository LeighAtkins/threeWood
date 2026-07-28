/**
 * The club bag — ThreeWood's shot vocabulary (Pillar 2).
 *
 * A club is a launch profile (loft + max ball speed). A variant is a strike
 * style layered on top (full / punch / flop / chip). The raw loft slider is
 * gone: the player picks a club and a shot type, and the swing meter decides
 * how well it comes off.
 *
 * Speeds are tuned so a pure full swing's projectile carry matches the course
 * generator's geometry (PAR_BANDS, MAX_CARRY = 185): driver carries ~180 and
 * runs out past 200, so a par 4 is drive + approach and a par 5 is three
 * honest shots. Pure module: no THREE, no DOM.
 */

export const GRAVITY = 9.81;

export const VARIANTS = {
  full:  { name: 'Full',  loftDelta: 0,  speedFactor: 1,    spinFactor: 1 },
  punch: { name: 'Punch', loftDelta: -7, speedFactor: 0.85, spinFactor: 0.45 },
  flop:  { name: 'Flop',  loftDelta: 8,  speedFactor: 0.75, spinFactor: 1.6 },
  chip:  { name: 'Chip',  loftDelta: -2, speedFactor: 0.32, spinFactor: 0.35 },
};

// Long -> short. maxSpeed solved from carry = v²·sin(2θ)/g for target carries
// (4i≈165, 7i≈140, pw≈110, sw≈80, lw≈55), then rounded.
export const CLUBS = [
  { id: 'driver', name: 'Driver',       loft: 12, maxSpeed: 66, rollEst: 25, variants: ['full', 'punch'] },
  { id: 'iron4',  name: '4-Iron',       loft: 22, maxSpeed: 48, rollEst: 18, variants: ['full', 'punch'] },
  { id: 'iron7',  name: '7-Iron',       loft: 30, maxSpeed: 40, rollEst: 12, variants: ['full', 'punch', 'chip'] },
  { id: 'pw',     name: 'Pitching Wedge', loft: 42, maxSpeed: 33, rollEst: 7, variants: ['full', 'punch', 'flop', 'chip'] },
  { id: 'sw',     name: 'Sand Wedge',   loft: 52, maxSpeed: 28, rollEst: 4, variants: ['full', 'punch', 'flop', 'chip'] },
  { id: 'lw',     name: 'Lob Wedge',    loft: 58, maxSpeed: 24, rollEst: 2, variants: ['full', 'punch', 'flop', 'chip'] },
  { id: 'putter', name: 'Putter',       loft: 2,  maxSpeed: 11, rollEst: 0, variants: ['full'] },
];

export function effectiveLoft(club, variant) {
  return Math.max(1, Math.min(64, club.loft + VARIANTS[variant].loftDelta));
}

/** Ball speed at 100% power for this club + variant. */
export function launchSpeed(club, variant) {
  return club.maxSpeed * VARIANTS[variant].speedFactor;
}

/**
 * Estimated TOTAL distance (carry + expected roll) of a pure 100% swing,
 * flat ground, no wind. Projectile carry + a per-club roll estimate.
 * The putter estimate is its max useful roll on a green.
 * A bad lie (core/lies.js) scales launch speed — carry by v², roll by v.
 */
export function estimateDistance(club, variant = 'full', lie = null) {
  const lieFactor = lie ? lie.speedFactor : 1;
  const v = launchSpeed(club, variant) * lieFactor;
  const loftRad = effectiveLoft(club, variant) * Math.PI / 180;
  const carry = (v * v * Math.sin(2 * loftRad)) / GRAVITY;
  if (club.id === 'putter') return Math.round(v * 2.5); // ground ball
  const roll = club.rollEst * VARIANTS[variant].speedFactor * lieFactor;
  return Math.round((carry + roll) / 5) * 5;
}

/**
 * Pick a club for a distance: the shortest club that still reaches, so a full
 * swing is the asking shot. On the green within putting range -> putter.
 * Lie-aware: rough/bunker penalties call for more club.
 * @returns club id
 */
export function autoSelectClub(dist, onGreen = false, lie = null) {
  if (onGreen && dist <= 30) return 'putter';
  // Scan shortest -> longest, first club that covers the distance
  for (let i = CLUBS.length - 2; i >= 0; i--) { // skip putter
    if (estimateDistance(CLUBS[i], 'full', lie) >= dist) return CLUBS[i].id;
  }
  return 'driver';
}

/**
 * Lie consequences — ThreeWood's strike context (Pillar 2, slice 3).
 *
 * Where the ball sits changes what the club can do to it. Grass between face
 * and ball bleeds ball speed and kills backspin (the flier lie); sand explodes
 * with the ball and launches it higher with little spin. Fairway, green, tee
 * (terrain reports the tee box as 'green') and cart path are clean lies.
 *
 * The lie rides into ball.hit() on the `shot` object ({ maxSpeed, spinFactor,
 * lie }) so the strike model and the club bag never need to know it exists.
 * Direction noise is drawn from the seeded ball stream inside hit() — pure
 * data here, no rng, no THREE, no DOM.
 */

export const LIES = {
  fairway:   { id: 'fairway',   name: 'Fairway',   speedFactor: 1,    spinFactor: 1,    launchBonus: 0, dirNoiseDeg: 0 },
  green:     { id: 'green',     name: 'Green',     speedFactor: 1,    spinFactor: 1,    launchBonus: 0, dirNoiseDeg: 0 },
  tee:       { id: 'tee',       name: 'Tee',       speedFactor: 1,    spinFactor: 1,    launchBonus: 0, dirNoiseDeg: 0 },
  cart_path: { id: 'cart_path', name: 'Cart Path', speedFactor: 1,    spinFactor: 1,    launchBonus: 0, dirNoiseDeg: 0 },
  rough:     { id: 'rough',     name: 'Rough',     speedFactor: 0.85, spinFactor: 0.55, launchBonus: 0, dirNoiseDeg: 2.5 },
  bunker:    { id: 'bunker',    name: 'Bunker',    speedFactor: 0.7,  spinFactor: 0.5,  launchBonus: 3, dirNoiseDeg: 1.5 },
};

/** True when the lie imposes no penalty (used to keep the HUD quiet). */
export function isCleanLie(lie) {
  return !lie || lie.speedFactor === 1;
}

/**
 * Resolve the lie at a world position. Unknown surfaces (water is a penalty,
 * never a lie) fall back to fairway.
 * @returns one of LIES
 */
export function getLieAt(terrain, position) {
  const surface = terrain?.getSurfaceTypeAtPosition?.(position.x, position.z);
  return LIES[surface] || LIES.fairway;
}

/**
 * One-line HUD summary of the lie's bite, e.g. "Rough −15%".
 * Returns null for clean lies so the display can skip it.
 */
export function describeLie(lie) {
  if (isCleanLie(lie)) return null;
  const loss = Math.round((1 - lie.speedFactor) * 100);
  return `${lie.name} −${loss}%`;
}

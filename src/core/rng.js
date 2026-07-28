import { createNoise2D } from 'simplex-noise';

/**
 * Seeded RNG foundations for ThreeWood.
 *
 * THE RULE: no Math.random() in generation or physics. Everything that
 * affects gameplay derives from one shareable seed string so a round is
 * reproducible byte-for-byte. Cosmetic-only randomness may use Math.random
 * but should prefer a forked stream anyway.
 */

/** String hash (xmur3-style) → 32-bit unsigned seed. */
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 PRNG — tiny, fast, good-enough distribution for games. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a namespaced randomness source from a seed string.
 * Fork to give each subsystem its own stream so consumption order in one
 * subsystem can't perturb another.
 */
export function createGameRng(seedString) {
  const seed = hashSeed(String(seedString));
  const rng = mulberry32(seed);
  return {
    seed: String(seedString),
    rng,                                                  // float in [0, 1)
    range: (min, max) => min + rng() * (max - min),
    int: (min, maxInclusive) => Math.floor(min + rng() * (maxInclusive - min + 1)),
    pick: (arr) => arr[Math.floor(rng() * arr.length)],
    sign: () => (rng() < 0.5 ? -1 : 1),
    noise2D: createNoise2D(rng),
    fork: (label) => createGameRng(`${seedString}:${label}`),
  };
}

/** Read ?seed= from the URL, or null. */
export function getSeedFromUrl() {
  if (typeof window === 'undefined') return null;
  const s = new URLSearchParams(window.location.search).get('seed');
  return s && s.trim() ? s.trim() : null;
}

/** Generate a human-shareable seed like "K7X2-9QPD" (unambiguous alphabet). */
export function generateSeed() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

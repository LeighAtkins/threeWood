/**
 * Room events: now and then, a whole hole is played under a twist that
 * everyone in the room shares. Seeded from the course, so every phone and the
 * room server (for its bots) apply the same one; rooms only (a solo round's
 * holes never change). Applied to the hole's spec before its world is built.
 */

import { hashSeed, mulberry32 } from './rng.js';
import { CUP_R } from './ballSim.js';

export const EVENTS = {
  moon:   { e: '🌙', label: 'Moon Gravity', blurb: 'Everything floats. Club down!' },
  gale:   { e: '🌬️', label: 'Gale', blurb: 'The wind has picked right up' },
  bucket: { e: '🪣', label: 'Bucket Holes', blurb: 'Every cup is huge this hole' },
};

/** The event on hole `index` of the round (none on the first, nor on crazy golf), or null. */
export function eventFor(seed, index, spec) {
  if (index === 0 || spec.green.channel) return null;
  const r = mulberry32(hashSeed(`${seed}:event:${index}`));
  if (r() > 0.3) return null;
  // (no gale underground: the cave has no wind to pick up)
  const ids = Object.keys(EVENTS).filter((k) => !(k === 'gale' && spec.biome === 'cave'));
  const id = ids[Math.floor(r() * ids.length)];
  return { id, ...EVENTS[id] };
}

/** The hole's spec under its event (a new object; the spec is not changed). */
export function withEvent(spec, ev) {
  if (!ev) return spec;
  if (ev.id === 'moon') return { ...spec, gravity: 9.81 * 0.55 };
  if (ev.id === 'gale') {
    const w = spec.wind, k = w.speed >= 3 ? 2.6 : 0, a = Math.atan2(w.z, w.x);
    // (a calm day gets a proper wind, from the side)
    const speed = k ? Math.round(w.speed * k) : 11;
    const ang = k ? a : a + Math.PI / 2;
    return { ...spec, wind: { speed, x: Math.cos(ang) * speed, z: Math.sin(ang) * speed } };
  }
  if (ev.id === 'bucket') return { ...spec, cupR: (spec.cupR || CUP_R) * 1.7 };
  return spec;
}

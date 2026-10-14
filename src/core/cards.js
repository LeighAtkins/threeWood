/**
 * Camp Cards: the rogue-lite bit of a room. After each hole everyone is
 * dealt three and keeps one for the next hole: a boost for yourself, or a bit
 * of mischief for whoever is one place above you on the board. The further
 * back you are, the more mischief you are dealt; the leader is dealt none, so
 * the pack is always chasing.
 *
 * Every effect is played on the phone of whoever it lands on (or by the
 * server, for a bot), so nothing has to agree between phones but the card's
 * id. Effects (for one hole):
 *   wind: m/s of wind along the hole (+ at your back, - in your face)
 *   cup: the cup's size, times
 *   lieHalf: rough and sand cost half as much
 *   tight: how hard the swing timing is, times (< 1 is kinder)
 */

export const CARDS = {
  tailwind: { e: '🍃', label: 'Tailwind', blurb: 'A breeze at your back', kind: 'self', wind: 8 },
  bigcup:   { e: '🕳️', label: 'Bucket Cup', blurb: 'Your cup is half again as wide', kind: 'self', cup: 1.5 },
  boots:    { e: '🥾', label: 'Good Boots', blurb: 'Rough and sand cost half', kind: 'self', lieHalf: true },
  steady:   { e: '🧘', label: 'Steady Hands', blurb: 'An easier swing', kind: 'self', tight: 0.6 },
  rain:     { e: '🌧️', label: 'Rain Cloud', blurb: 'It rains on them: wet, slippery turf and a headwind', kind: 'mischief', wind: -4, slick: 1.7, rain: true },
  tiny:     { e: '🤏', label: 'Tiny Cup', blurb: 'Their cup shrinks to a thimble', kind: 'mischief', cup: 0.72 },
  wobble:   { e: '🫨', label: 'The Wobbles', blurb: 'They sway about and their swing meter shakes', kind: 'mischief', tight: 1.5, wobble: true },
  // Only in Tabi's shop (never dealt)
  rocket:    { e: '🚀', label: 'Rocket Ball', blurb: 'Your full shots fly 12% further', kind: 'self', shop: true, power: 1.12 },
  moon:      { e: '🌙', label: 'Moon Ball', blurb: 'Your ball floats like it is on the moon', kind: 'self', shop: true, gravity: 0.6 },
  magnet:    { e: '🧲', label: 'Cup Magnet', blurb: 'Your cup is a bucket', kind: 'self', shop: true, cup: 1.45 },
  mulligan:  { e: '↩️', label: 'Mulligan', blurb: 'Take back one shot, no stroke', kind: 'self', shop: true, mulligan: 1 },
  fog:       { e: '🌫️', label: 'Fog Bank', blurb: 'Their course vanishes into thick fog', kind: 'mischief', shop: true, fog: true },
  bouncy:    { e: '🏀', label: 'Rubber Ball', blurb: 'Their ball bounces about like rubber', kind: 'mischief', shop: true, bouncy: 1.55 },
  backwards: { e: '🔄', label: 'Backwards Day', blurb: 'Their aiming goes the wrong way round', kind: 'mischief', shop: true, backwards: true },
};

/** Tabi the tanuki's stock and prices (★ points). Mischief only sells in a room. */
export const SHOP = [
  { id: 'rocket', price: 600 }, { id: 'moon', price: 500 }, { id: 'magnet', price: 700 }, { id: 'mulligan', price: 800 },
  { id: 'fog', price: 450 }, { id: 'bouncy', price: 400 }, { id: 'backwards', price: 600 },
  { id: 'rain', price: 400 }, { id: 'tiny', price: 500 }, { id: 'wobble', price: 400 },
];

const SELF = Object.keys(CARDS).filter((k) => CARDS[k].kind === 'self' && !CARDS[k].shop);
const MISCHIEF = Object.keys(CARDS).filter((k) => CARDS[k].kind === 'mischief' && !CARDS[k].shop);

/**
 * Three cards for someone placed `rank` (1 = leading) of `of` players.
 * rng: () => [0, 1). The leader gets no mischief (nobody is above them);
 * last place gets two.
 */
export function deal(rng, rank, of, mischief = true) {
  const pick = (pool, taken) => { const left = pool.filter((k) => !taken.includes(k)); return left[Math.floor(rng() * left.length)]; };
  const behind = of > 1 ? (rank - 1) / (of - 1) : 0; // 0 leading .. 1 last
  const nasty = !mischief || rank <= 1 ? 0 : behind > 0.6 ? 2 : 1;
  const hand = [];
  for (let i = 0; i < nasty; i++) hand.push(pick(MISCHIEF, hand));
  while (hand.length < 3) hand.push(pick(SELF, hand));
  // (shuffle, so mischief is not always on the left)
  for (let i = hand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [hand[i], hand[j]] = [hand[j], hand[i]]; }
  return hand;
}

/** The combined effect of a list of card ids (plus a crown perk, if any) for one hole. */
export function combine(ids, perk = null) {
  const out = { wind: 0, cup: 1, lieHalf: false, tight: 1, slick: 1, rain: false, wobble: false, power: 1, gravity: 1, mulligan: 0, fog: false, bouncy: 1, backwards: false };
  for (const c of [...ids.map((id) => CARDS[id]).filter(Boolean), perk].filter(Boolean)) {
    out.wind += c.wind || 0;
    out.cup *= c.cup || 1;
    out.lieHalf ||= !!c.lieHalf;
    out.tight *= c.tight || 1;
    out.slick *= c.slick || 1;
    out.rain ||= !!c.rain;
    out.wobble ||= !!c.wobble;
    out.power *= c.power || 1;
    out.gravity *= c.gravity || 1;
    out.mulligan += c.mulligan || 0;
    out.fog ||= !!c.fog;
    out.bouncy *= c.bouncy || 1;
    out.backwards ||= !!c.backwards;
  }
  out.cup = Math.max(0.6, Math.min(2, out.cup));
  out.tight = Math.max(0.4, Math.min(2, out.tight));
  return out;
}

/** Who a mischief card from `id` lands on: the player one place above (board: ids best first). */
export function targetFor(board, id) {
  const i = board.indexOf(id);
  return i > 0 ? board[i - 1] : null;
}

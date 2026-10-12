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
  rain:     { e: '🌧️', label: 'Rain Cloud', blurb: 'A headwind for them', kind: 'mischief', wind: -7 },
  tiny:     { e: '🤏', label: 'Tiny Cup', blurb: 'Their cup shrinks', kind: 'mischief', cup: 0.72 },
  wobble:   { e: '🫨', label: 'The Wobbles', blurb: 'Their swing gets twitchy', kind: 'mischief', tight: 1.5 },
};

const SELF = Object.keys(CARDS).filter((k) => CARDS[k].kind === 'self');
const MISCHIEF = Object.keys(CARDS).filter((k) => CARDS[k].kind === 'mischief');

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
  const out = { wind: 0, cup: 1, lieHalf: false, tight: 1 };
  for (const c of [...ids.map((id) => CARDS[id]).filter(Boolean), perk].filter(Boolean)) {
    out.wind += c.wind || 0;
    out.cup *= c.cup || 1;
    out.lieHalf ||= !!c.lieHalf;
    out.tight *= c.tight || 1;
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

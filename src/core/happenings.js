/**
 * Happenings: what a shot did that the room should hear about. The good
 * (a bomb, a chip-in, a snake of a putt) and, mostly, the funny (a swim, a
 * tree, a topped drive, a putt that zooms past). Pure: the player's own
 * phone (or the server, for a bot) classifies its own shot and tells the
 * room, so every phone shows the same feed and counts the same awards.
 *
 * shot: {
 *   putt, fromSurface, fromX, fromZ, cupX, cupZ,
 *   mode (rest | holed | water | oob), surface (where it stopped), x, z,
 *   events: [type...], strokes (counting this one), par, lane (crazy golf)
 * }
 * Returns { k, v } (v: a number worth saying, yards or feet) or null.
 */

export function classify(s) {
  const toPin0 = Math.hypot(s.cupX - s.fromX, s.cupZ - s.fromZ);
  const toPin1 = Math.hypot(s.cupX - s.x, s.cupZ - s.z);
  const carried = Math.hypot(s.x - s.fromX, s.z - s.fromZ);
  const holed = s.mode === 'holed';
  const has = (t) => s.events.includes(t);
  if (holed) {
    if (s.strokes === 1) return { k: 'ace', v: Math.round(toPin0) };
    if (!s.putt && toPin0 > 4) return { k: 'chipin', v: Math.round(toPin0) };
    if (s.putt && toPin0 * 3 >= 25) return { k: 'snake', v: Math.round(toPin0 * 3) };
    if (s.strokes <= s.par - 2) return { k: 'eagle', v: s.strokes };
    if (s.strokes === s.par - 1) return { k: 'birdie', v: s.strokes };
    return null;
  }
  if (s.mode === 'water') return { k: 'splash', v: 0 };
  if (s.mode === 'oob') return { k: 'lost', v: 0 };
  // (a real lip-out stays by the hole; a ball that rolled over it at pace and on is a zoom)
  if (has('lipout') && toPin1 < 2.5) return { k: 'lipout', v: 0 };
  if (!s.putt) {
    if (has('tree')) return { k: 'tree', v: 0 };
    if (s.fromSurface === 'tee' && s.par > 3 && carried >= 232) return { k: 'bomb', v: Math.round(carried) };
    if (toPin0 > 60 && carried < 22) return { k: 'topped', v: Math.round(carried) };
    if (s.surface === 'bunker' && s.fromSurface !== 'bunker') return { k: 'sand', v: 0 };
    if (s.fromSurface === 'bunker' && s.surface === 'bunker') return { k: 'stuck', v: 0 };
    if (s.surface === 'green' && toPin1 * 3 <= 6) return { k: 'dead', v: Math.max(1, Math.round(toPin1 * 3)) };
    return null;
  }
  // Putts
  if (toPin0 * 3 <= 4) return { k: 'yips', v: Math.max(1, Math.round(toPin0 * 3)) };
  if (s.lane) return null; // (crazy golf: the walls make every putt wander)
  const along = ((s.x - s.fromX) * (s.cupX - s.fromX) + (s.z - s.fromZ) * (s.cupZ - s.fromZ)) / (toPin0 || 1);
  if (along > toPin0 && toPin1 * 3 > 12 && toPin1 > toPin0 * 0.5) return { k: 'zoom', v: Math.round(toPin1 * 3) };
  if (s.surface !== 'green' && s.surface !== 'fringe') return { k: 'offgreen', v: 0 };
  return null;
}

/**
 * How the room hears it. tone: 'wow' (gold, applause) or 'lol' (a laugh).
 * The texts are short: they share a phone screen with seven friends.
 */
export const HAPPENINGS = {
  ace:      { e: '🤯', tone: 'wow', say: (n) => `${n} HOLE IN ONE!!` },
  chipin:   { e: '🎯', tone: 'wow', say: (n, v) => `${n} chipped in from ${v}y` },
  snake:    { e: '🐍', tone: 'wow', say: (n, v) => `${n} drained a ${v} ft snake` },
  eagle:    { e: '🦅', tone: 'wow', say: (n) => `${n} made eagle` },
  birdie:   { e: '🐦', tone: 'wow', say: (n) => `${n} made birdie` },
  bomb:     { e: '🚀', tone: 'wow', say: (n, v) => `${n} launched one ${v}y` },
  dead:     { e: '📌', tone: 'wow', say: (n, v) => `${n} stuck it to ${v} ft` },
  splash:   { e: '💦', tone: 'lol', say: (n) => `${n} went for a swim` },
  lost:     { e: '🌲', tone: 'lol', say: (n) => `${n} is lost in the woods` },
  tree:     { e: '🌳', tone: 'lol', say: (n) => `${n} hugged a tree` },
  topped:   { e: '🐛', tone: 'lol', say: (n, v) => `${n} topped it ${v}y` },
  sand:     { e: '🏖️', tone: 'lol', say: (n) => `${n} is at the beach` },
  stuck:    { e: '🏰', tone: 'lol', say: (n) => `${n} is building a sandcastle` },
  lipout:   { e: '😩', tone: 'lol', say: (n) => `${n} lipped out` },
  yips:     { e: '🫣', tone: 'lol', say: (n, v) => `${n} missed from ${v} ft` },
  zoom:     { e: '💨', tone: 'lol', say: (n, v) => `${n} zoomed ${v} ft past` },
  offgreen: { e: '🛝', tone: 'lol', say: (n) => `${n} putted off the green` },
  // The cozy news: not from a shot, from the walk between them
  shroom:   { e: '🍄', tone: 'nice', say: (n, v) => `${n} found ${['some shimeji', 'a shiitake', 'a glowcap', 'a GOLDEN chanterelle'][v] || 'a mushroom'}` },
  fish:     { e: '🐟', tone: 'nice', say: (n, v) => `${n} caught ${v > 1 ? `${v} fish` : 'a fish'}` },
};

/**
 * End-of-round awards from everyone's happening counts. counts: Map id ->
 * { k: n }. Each award goes to whoever has the most of its kinds (at least
 * one); nobody gets two, so more of the room is mentioned.
 */
export const AWARDS = [
  { id: 'fish', e: '🐟', label: 'Fish Whisperer', kinds: ['splash'] },
  { id: 'lumber', e: '🌳', label: 'Tree Hugger', kinds: ['tree', 'lost'] },
  { id: 'beach', e: '🏖️', label: 'Beach Bum', kinds: ['sand', 'stuck'] },
  { id: 'rocket', e: '🚀', label: 'Rocket Launcher', kinds: ['bomb'] },
  { id: 'magic', e: '🎯', label: 'Magician', kinds: ['ace', 'chipin', 'snake', 'eagle'] },
  { id: 'bird', e: '🐦', label: 'Bird Watcher', kinds: ['birdie'] },
  { id: 'dart', e: '📌', label: 'Dart Thrower', kinds: ['dead'] },
  { id: 'speed', e: '💨', label: 'Speed Demon', kinds: ['zoom', 'offgreen'] },
  { id: 'worm', e: '🐛', label: 'Worm Burner', kinds: ['topped'] },
  { id: 'heart', e: '💔', label: 'Heartbreaker', kinds: ['lipout', 'yips'] },
  { id: 'forager', e: '🍄', label: 'Forager', kinds: ['shroom'] },
  { id: 'angler', e: '🎣', label: 'Angler', kinds: ['fish'] },
];

export function awards(counts, order = [...counts.keys()]) {
  const out = [];
  const taken = new Set();
  for (const a of AWARDS) {
    let best = null, n = 0;
    for (const id of order) {
      if (taken.has(id)) continue;
      const c = counts.get(id) || {};
      const m = a.kinds.reduce((s, k) => s + (c[k] || 0), 0);
      if (m > n) { n = m; best = id; }
    }
    if (best) { taken.add(best); out.push({ ...a, id: best, award: a.id, n }); }
  }
  return out;
}

/**
 * What the bots say back, by happening (and 'bonked': a ball off the head).
 * Sent over the wire as an index, never as text, so nothing anyone types
 * can reach another phone. {n}: the name of whoever it is aimed at.
 */
export const QUIPS = {
  splash: ['Bring a snorkel, {n}', 'Splish splash!', 'The fish say hi', '{n} fed the koi', 'Swimming lessons?'],
  lost: ['Send a search party', 'Bye bye ball!', '{n}, the woods are that way'],
  tree: ['TIMBER!', 'The tree started it', 'Lumberjack {n}!', 'Leaf it to {n}'],
  topped: ['Worm burner!', 'It rolled… a bit', 'Is that a putt, {n}?', 'Grass cutter!'],
  sand: ['Sun’s out, {n}!', 'Bring a bucket', 'Beach day!'],
  stuck: ['Nice castle, {n}', 'Still at the beach?', 'Need a moat?'],
  lipout: ['NOOO', 'So close!', 'The hole spat it out', 'Rude hole'],
  yips: ['From THERE?', 'Oh {n}…', 'Tap-in… almost'],
  zoom: ['Brakes, {n}!', 'Express delivery', 'Too much juice!', 'Zoom zoom'],
  offgreen: ['Wrong way, {n}', 'Off it goes!'],
  bomb: ['Show-off!', 'Into orbit!', '{n} ate their oats', 'Rocket!'],
  dead: ['Darts, {n}!', 'Stuck it!', 'Tap-in city'],
  chipin: ['NO WAY {n}!', 'Get in the hole!', 'Magic!'],
  snake: ['What a putt!', 'Snake bite!', 'Green reader {n}!'],
  ace: ['ACE!!!', 'Drinks on {n}!', 'I saw it!!'],
  eagle: ['Eagle eyes!', 'Fly {n}, fly'],
  birdie: ['Tweet tweet!', 'Birdie for {n}!', 'Nice one, {n}'],
  shroom: ['Save me one, {n}', 'Hot pot tonight!', 'Ooh, mushrooms', 'Is that one safe?'],
  fish: ['Dinner!', 'Nice catch, {n}!', 'Grill it!', 'Fish fry!'],
  bonked: ['OW!', 'My head, {n}!', 'Watch it, {n}!', 'Fore?! FORE?!', 'Seeing stars…'],
  // Answers to the quick-chat lines (SAYINGS in netplay, in order)
  niceshot: ['Thank you, {n}!', 'I try ✨', 'Pure luck', 'Did you see that?!'],
  unlucky: ['Rub of the green', 'Next time!', 'The wind did it'],
  fore: ['*ducks*', 'WHERE?!', 'Not again!'],
  hurry: ['Can\u2019t rush art', 'Coming!', 'Patience, {n} 🐢', 'Five more minutes'],
  watch: ['Ooh', 'No pressure, {n}', 'Watching…', 'Don\u2019t miss!'],
  gg: ['GG!', 'Rematch?', 'GG {n}!'],
};

/** Fill in a quip's name. */
export function quipText(kind, i, name) {
  const list = QUIPS[kind];
  if (!list) return null;
  const q = list[((i % list.length) + list.length) % list.length];
  return q.replace('{n}', name);
}

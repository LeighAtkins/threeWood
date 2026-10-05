/**
 * The camp — who you are out here, and what you have earned.
 *
 * ThreeWood's golfers are solo campers who happen to carry a bag of clubs:
 * a cute, round camper you build yourself (boy or girl, hair, skin), dressed
 * in outfits that are the game's unlocks. Each outfit is earned by doing one
 * camp-or-golf thing, counted across every round you play.
 *
 * Pure module: no THREE, no DOM. render/camper.js draws a look.
 */

export const SKINS = [0xffe2c8, 0xf6cfa6, 0xd9a273, 0x9a6642];
export const HAIR_COLORS = [0x3a2a22, 0x6b4a32, 0xc98d4b, 0xf2d58a, 0x2f3a5c, 0xe58fa6, 0x8e9aa6];
export const HAIR_STYLES = ['short', 'bob', 'bun', 'long', 'twintails', 'ponytail'];
export const EYE_COLORS = [0x4aa3d9, 0x8a5fd0, 0x4fae6a, 0xc98a3a, 0xd9587a, 0x5a4a42];

/**
 * Outfits, layered the way a camper dresses: a top over a shirt, bottoms over
 * tights, shoes, something on the head.
 *   top:     coat (open puffer, shirt showing) | long (the same to the thigh) |
 *            hoodie (closed) | vest (sleeveless, shirt sleeves showing)
 *   bottoms: shorts | skirt | pants        legs: tights colour (null = bare)
 *   hat:     none | beanie | pom | cap | bucket | earflap | bandana | flat
 *   goal:    [stat, count] — unlocked when stats[stat] >= count (none = from the start)
 */
export const OUTFITS = [
  { id: 'trail', name: 'Trail Hoodie', top: 'hoodie', jacket: 0xf6edd6, trim: 0x6fae5c, shirt: 0x6fae5c,
    bottoms: 'shorts', bottomColor: 0x4f8a5c, legs: 0x3b3b46, shoes: 0xf08a3c, hat: 'none' },
  { id: 'beanie', name: 'Blue Beanie', top: 'coat', jacket: 0x33363f, trim: 0xf6f1e6, shirt: 0xe3a42c, collar: true,
    bottoms: 'pants', bottomColor: 0x23252c, legs: null, shoes: 0x8a2f3a, hat: 'pom', hatColor: 0x3d68b0, scarf: 0xf2e6c8,
    goal: ['rounds', 1], how: 'Finish a round' },
  { id: 'ranger', name: 'Ranger', top: 'vest', jacket: 0xb9a26a, trim: 0x6b5a34, shirt: 0x5f8f5a,
    bottoms: 'shorts', bottomColor: 0x8a7a4a, legs: null, shoes: 0x6b4a2e, hat: 'bucket', hatColor: 0x8a9a55, pack: 0xc65a3a,
    goal: ['fairways', 10], how: 'Hit 10 fairways' },
  { id: 'puffer', name: 'Snow Puffer', top: 'long', jacket: 0xf7f2f4, trim: 0xf7f2f4, shirt: 0xc8363c, collar: true,
    bottoms: 'shorts', bottomColor: 0x6f9fd0, legs: 0x26262c, shoes: 0xc8363c, hat: 'beanie', hatColor: 0xf7f2f4, pack: 0xcdb98a,
    goal: ['fish', 3], how: 'Catch 3 fish' },
  { id: 'flannel', name: 'Camp Flannel', top: 'coat', jacket: 0xc6402f, trim: 0x2b2b2b, shirt: 0xf6f1e6, check: true,
    bottoms: 'pants', bottomColor: 0x3f5f8f, legs: null, shoes: 0x7a5632, hat: 'cap', hatColor: 0x2b2b2b,
    goal: ['friends', 1], how: 'Play a hole with a friend' },
  { id: 'owl', name: 'Night Owl', top: 'long', jacket: 0x5a4a9a, trim: 0xffd23f, shirt: 0x2a2740, collar: true,
    bottoms: 'skirt', bottomColor: 0x2a2740, legs: 0x2a2740, shoes: 0xffd23f, hat: 'pom', hatColor: 0xffd23f, scarf: 0xffd23f,
    goal: ['birdies', 5], how: 'Make 5 birdies' },
  { id: 'chef', name: 'Camp Chef', top: 'hoodie', jacket: 0xffffff, trim: 0xd9483b, shirt: 0xffffff, apron: 0xd9483b,
    bottoms: 'pants', bottomColor: 0x40444f, legs: null, shoes: 0x33363f, hat: 'bandana', hatColor: 0xd9483b,
    goal: ['perfectGrill', 1], how: 'Grill a perfect yakizakana' },
  { id: 'classic', name: 'Clubhouse', top: 'vest', jacket: 0x2e6b4f, trim: 0xf3ead2, shirt: 0xffffff, check: true,
    bottoms: 'pants', bottomColor: 0xe8dcc0, legs: null, shoes: 0xffffff, hat: 'flat', hatColor: 0x8a6a4a,
    goal: ['holes', 18], how: 'Play 18 holes' },
  { id: 'gold', name: 'Golden Hour', top: 'long', jacket: 0xf0b63a, trim: 0xfff4c8, shirt: 0xff7a3c, collar: true,
    bottoms: 'shorts', bottomColor: 0x7a5a1e, legs: 0x4a3524, shoes: 0xfff4c8, hat: 'earflap', hatColor: 0xfff4c8,
    goal: ['gold', 1], how: 'Catch the golden ball' },
];

export const outfitById = (id) => OUTFITS.find((o) => o.id === id) || OUTFITS[0];

export function defaultLook() {
  return { body: 'girl', skin: 0, hair: 'long', hairColor: 5, eyes: 0, outfit: 'trail', name: 'Camper' };
}

export function newCamp() {
  return {
    look: defaultLook(),
    made: false, // has the player been through the creator yet
    stats: { rounds: 0, holes: 0, fairways: 0, birdies: 0, fish: 0, perfectGrill: 0, gold: 0, friends: 0 },
    unlocked: ['trail'],
  };
}

/** Bring a stored camp up to date with the current outfit list. */
export function loadCamp(saved) {
  const fresh = newCamp();
  if (!saved) return fresh;
  return {
    look: { ...fresh.look, ...saved.look },
    made: !!saved.made,
    stats: { ...fresh.stats, ...saved.stats },
    unlocked: [...new Set(['trail', ...(saved.unlocked || [])])],
  };
}

export const isUnlocked = (camp, id) => camp.unlocked.includes(id);

/** Add to a stat; returns the outfits that this has just earned. */
export function bump(camp, stat, by = 1) {
  camp.stats[stat] = (camp.stats[stat] || 0) + by;
  const earned = OUTFITS.filter((o) => o.goal && !camp.unlocked.includes(o.id) && camp.stats[o.goal[0]] >= o.goal[1]);
  for (const o of earned) camp.unlocked.push(o.id);
  return earned;
}

/** "2/3" style progress toward an outfit's goal. */
export function progress(camp, outfit) {
  if (!outfit.goal) return '';
  return `${Math.min(outfit.goal[1], camp.stats[outfit.goal[0]] || 0)}/${outfit.goal[1]}`;
}

/** A look is safe to wear (and to accept from another player over the wire). */
export function cleanLook(look = {}) {
  const base = defaultLook();
  return {
    body: look.body === 'boy' ? 'boy' : 'girl',
    skin: Number.isInteger(look.skin) && look.skin >= 0 && look.skin < SKINS.length ? look.skin : base.skin,
    hair: HAIR_STYLES.includes(look.hair) ? look.hair : base.hair,
    hairColor: Number.isInteger(look.hairColor) && look.hairColor >= 0 && look.hairColor < HAIR_COLORS.length ? look.hairColor : base.hairColor,
    eyes: Number.isInteger(look.eyes) && look.eyes >= 0 && look.eyes < EYE_COLORS.length ? look.eyes : base.eyes,
    outfit: OUTFITS.some((o) => o.id === look.outfit) ? look.outfit : base.outfit,
    name: String(look.name || base.name).replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 10) || base.name,
  };
}

import { hashSeed, mulberry32 } from '../core/rng.js';

/**
 * Biomes — the worlds a round tours.
 *
 * A course visits six of these, three holes apiece, drawn and ordered by its
 * seed: the same routing of pars and hole shapes, but one round goes desert ->
 * snow -> volcano and the next goes blossom -> tropics -> toadstools. A biome
 * sets the ground palette, the shape of the land, the wind, what grows and
 * stands on it (render/props.js builds those from the names here), what rings
 * the horizon and what drifts through the air. The time of day is not theirs
 * to set: the sky follows the player's own sun (render/sky.js), and a biome
 * only colours the air under it. Pure data: colours are hex ints.
 *
 *   treeKind / treeShape   how a tree looks / which collider it gets
 *   props                  [kind, count] small dressing scattered in the rough
 *   features               [kind, count] set pieces standing well clear of play
 *   backdrop               the ring of far hills; landmarks stand among them
 *   ambient                particles in the air: [kind, colours]
 *   liquid                 what the "water" hazard is made of
 *   tufts                  how grassy the rough is (1 = thick with tufts)
 */
export const BIOMES = {
  parkland: {
    id: 'parkland',
    name: 'Parkland',
    // Terrain shape
    base: 1.6, amp1: 1.5, amp2: 0.35, greenUndulation: 0.16,
    // Ground palette
    rough: 0x4a8a3a, fairway: 0x7bc552, fringe: 0x8fd35e, green: 0xa9e66f,
    tee: 0x93d862, sand: 0xf0deaa, bed: 0x3d6b5a, deepRough: 0x3d7634,
    // Air: daytime haze tint and how strongly it takes, high-cloud cover
    // range, and the colour the ground throws back up into the shadows
    haze: 0xcfe6f5, hazeAmount: 0, cloud: [0.3, 0.55], hemiGround: 0x86a85a,
    water: 0x3c9cc4, liquid: 'water',
    // Scenery
    treeKind: 'round', treeShape: 'round', treeCount: 70,
    canopy: [0x3f7a34, 0x4e8f3a, 0x5da344, 0x6b9a3e, 0x478c41],
    trunk: 0x6b4a2f, tuft: 0x4f913d, flowers: [0xffffff, 0xffd84a, 0xff8fa3],
    props: [['bush', 46], ['fence', 9], ['rock', 14]],
    features: [['cottage', 2], ['windmill', 1], ['haystack', 5]],
    backdrop: { style: 'hills', color: 0x7fae7a, height: [28, 80] },
    landmarks: ['village'],
    ambient: ['pollen', [0xfffbe0]],
    // Weather (mph)
    wind: [0, 6],
  },
  links: {
    id: 'links',
    name: 'Links',
    base: 1.4, amp1: 1.0, amp2: 0.85, greenUndulation: 0.22,
    rough: 0xb8a55a, fairway: 0x8fbf55, fringe: 0x9fd062, green: 0xb2e274,
    tee: 0x9fd062, sand: 0xf6e7b8, bed: 0x4a7f86, deepRough: 0xa08c48,
    haze: 0xe9e6d6, hazeAmount: 0.75, cloud: [0.45, 0.7], hemiGround: 0xb5a868,
    water: 0x2f8fae, liquid: 'water',
    treeKind: 'scrub', treeShape: 'scrub', treeCount: 16,
    canopy: [0x6f8f42, 0x7d9a45, 0x5f7f3a],
    trunk: 0x77583a, tuft: 0xc2ae62, tufts: 0.6, flowers: [0xf2e39a, 0xd9c7ff, 0xffffff],
    props: [['marram', 70], ['rock', 22], ['fence', 6]],
    features: [['standingStones', 2], ['beachHut', 4], ['boat', 2]],
    backdrop: { style: 'dunes', color: 0xa9b98a, height: [14, 34] },
    landmarks: ['lighthouse', 'seaStacks'],
    ambient: null,
    wind: [6, 14],
  },
  pines: {
    id: 'pines',
    name: 'Pines',
    base: 1.9, amp1: 2.2, amp2: 0.4, greenUndulation: 0.19,
    rough: 0x3f7a40, fairway: 0x6fb650, fringe: 0x82c95b, green: 0x9fde6a,
    tee: 0x86cc5e, sand: 0xf2d9a0, bed: 0x35596a, deepRough: 0x336636,
    haze: 0xc2dadc, hazeAmount: 0.6, cloud: [0.2, 0.45], hemiGround: 0x8a9a60,
    water: 0x3a7fb0, liquid: 'water',
    treeKind: 'pine', treeShape: 'pine', treeCount: 110,
    canopy: [0x2f6b3a, 0x2a5f38, 0x3a7a44, 0x246040],
    trunk: 0x5c4030, tuft: 0x3f7a40, flowers: [0xffb347, 0xffffff, 0xff7f6e],
    props: [['boulder', 26], ['logPile', 9], ['fern', 40]],
    features: [['cabin', 2], ['watchtower', 1], ['tent', 3]],
    backdrop: { style: 'peaks', color: 0x5f7f86, cap: 0xf4f8ff, capAt: 0.62, height: [70, 170] },
    landmarks: ['greatPeak'],
    ambient: null,
    wind: [2, 9],
  },
  desert: {
    id: 'desert',
    name: 'Dry Gulch',
    base: 1.7, amp1: 1.8, amp2: 0.7, greenUndulation: 0.18,
    rough: 0xd9a35c, fairway: 0x8cc452, fringe: 0xa2d260, green: 0xb6e572,
    tee: 0xa2d260, sand: 0xfff0c2, bed: 0x4f8a80, deepRough: 0xc98444,
    haze: 0xf1d6a8, hazeAmount: 0.8, cloud: [0.05, 0.25], hemiGround: 0xd9a868,
    water: 0x38b0b0, liquid: 'water',
    treeKind: 'cactus', treeShape: 'scrub', treeCount: 34,
    canopy: [0x4f8f4a, 0x5a9a50, 0x457f48],
    trunk: 0x7a5a3a, tuft: 0xa89a52, tufts: 0.3, flowers: [0xff5f8a, 0xffd84a, 0xff9a3c],
    props: [['redRock', 30], ['barrelCactus', 30], ['bones', 6], ['deadBush', 26]],
    features: [['rockArch', 2], ['wagon', 2], ['oilRig', 1], ['hoodoo', 5]],
    backdrop: { style: 'mesas', color: 0xc8703c, cap: 0xe09a58, capAt: 0.55, height: [50, 120] },
    landmarks: ['pyramids'],
    ambient: ['dust', [0xf2d6a0]],
    wind: [3, 11],
  },
  tropics: {
    id: 'tropics',
    name: 'Coconut Cove',
    base: 1.2, amp1: 1.1, amp2: 0.35, greenUndulation: 0.17,
    rough: 0x3fa64a, fairway: 0x7fd65a, fringe: 0x93e066, green: 0xaeee78,
    tee: 0x93e066, sand: 0xfff6dc, bed: 0x3aa6a0, deepRough: 0xf2dfae,
    haze: 0xc8f0f0, hazeAmount: 0.6, cloud: [0.25, 0.5], hemiGround: 0xbfd28a,
    water: 0x1fc4c8, liquid: 'water',
    treeKind: 'palm', treeShape: 'round', treeCount: 46,
    canopy: [0x3f9a3c, 0x4fae42, 0x2f8a3a],
    trunk: 0x9a7a52, tuft: 0x49b052, tufts: 0.6, flowers: [0xff4f7a, 0xffb02e, 0xffffff, 0xb05cff],
    props: [['shell', 18], ['hibiscus', 40], ['surfboard', 8], ['rock', 12]],
    features: [['tiki', 4], ['parasol', 6], ['beachHut', 3], ['boat', 2]],
    backdrop: { style: 'islands', color: 0x4fa870, height: [30, 90] },
    landmarks: ['islandVolcano'],
    ambient: null,
    wind: [3, 9],
  },
  snow: {
    id: 'snow',
    name: 'Frostbite Ridge',
    base: 1.8, amp1: 2.0, amp2: 0.45, greenUndulation: 0.17,
    rough: 0xe9f1f7, fairway: 0x7fc08a, fringe: 0x93cf98, green: 0xa6e0a2,
    tee: 0x93cf98, sand: 0xe8cf96, bed: 0x4a7fa0, deepRough: 0xd4e2ee,
    haze: 0xe4eef6, hazeAmount: 0.85, cloud: [0.5, 0.75], hemiGround: 0xd8e4f0,
    water: 0x7fc8e8, liquid: 'water',
    treeKind: 'snowPine', treeShape: 'pine', treeCount: 80,
    canopy: [0x2f6652, 0x2a5a4c, 0x3a7260],
    trunk: 0x5a4436, tuft: 0xf6fbff, tufts: 0.3, flowers: [0xffffff, 0xcfe8ff, 0xe84a4a],
    props: [['snowman', 9], ['iceShard', 26], ['snowRock', 26], ['present', 8]],
    features: [['igloo', 3], ['cabin', 2], ['iceArch', 2]],
    backdrop: { style: 'peaks', color: 0x9db4c8, cap: 0xffffff, capAt: 0.3, height: [70, 180] },
    landmarks: ['iceCastle'],
    ambient: ['snow', [0xffffff]],
    wind: [4, 12],
  },
  autumn: {
    id: 'autumn',
    name: 'Maple Hollow',
    base: 1.7, amp1: 1.7, amp2: 0.4, greenUndulation: 0.17,
    rough: 0x8f8a3c, fairway: 0x86c050, fringe: 0x98cf5c, green: 0xace26c,
    tee: 0x98cf5c, sand: 0xf0d9a0, bed: 0x4a6a5a, deepRough: 0xa8702e,
    haze: 0xf2dcc0, hazeAmount: 0.7, cloud: [0.3, 0.6], hemiGround: 0xb58a4a,
    water: 0x4a8fa8, liquid: 'water',
    treeKind: 'round', treeShape: 'round', treeCount: 84,
    canopy: [0xe8792a, 0xd9482a, 0xf2b23a, 0xb8342a, 0xe89a2a, 0x9a8a2e],
    trunk: 0x4f3626, tuft: 0xb8923a, flowers: [0xf2b23a, 0xd9482a, 0xfff0c0],
    props: [['pumpkin', 34], ['leafPile', 24], ['toadstool', 22], ['fence', 8]],
    features: [['barn', 1], ['haystack', 7], ['scarecrow', 4], ['cottage', 1]],
    backdrop: { style: 'hills', color: 0xc07a3a, height: [30, 90] },
    landmarks: ['greatTree'],
    ambient: ['leaves', [0xe8792a, 0xd9482a, 0xf2b23a]],
    wind: [2, 8],
  },
  blossom: {
    id: 'blossom',
    name: 'Blossom Garden',
    base: 1.4, amp1: 1.3, amp2: 0.3, greenUndulation: 0.15,
    rough: 0x5a9a52, fairway: 0x8ad268, fringe: 0x9cdc74, green: 0xb4ec84,
    tee: 0x9cdc74, sand: 0xf4ead0, bed: 0x4a7a78, deepRough: 0x4a8a56,
    haze: 0xf6dfe8, hazeAmount: 0.7, cloud: [0.2, 0.5], hemiGround: 0xb0c090,
    water: 0x4aa8b8, liquid: 'water',
    treeKind: 'blossom', treeShape: 'round', treeCount: 62,
    canopy: [0xffb7d0, 0xff9cc0, 0xffd0e0, 0xf582ac, 0xffffff],
    trunk: 0x3c2a2a, tuft: 0x62a65a, tufts: 0.6, flowers: [0xffb7d0, 0xffffff, 0xff7fa8],
    props: [['bamboo', 30], ['mossRock', 24], ['lantern', 16]],
    features: [['torii', 3], ['teaHouse', 2], ['archBridge', 2]],
    backdrop: { style: 'hills', color: 0x7aa890, height: [24, 60] },
    landmarks: ['snowCone', 'pagoda'],
    ambient: ['petals', [0xffc4d8, 0xffffff, 0xff9cc0]],
    wind: [0, 5],
  },
  volcano: {
    id: 'volcano',
    name: 'Cinder Peak',
    base: 2.0, amp1: 2.4, amp2: 0.65, greenUndulation: 0.2,
    rough: 0x4a4246, fairway: 0x5fae4c, fringe: 0x74c058, green: 0x92dc66,
    tee: 0x74c058, sand: 0xa89a90, bed: 0x5a1a08, deepRough: 0x2e2a30,
    haze: 0x8a6a66, hazeAmount: 0.85, cloud: [0.5, 0.8], hemiGround: 0x7a4a3a,
    water: 0xff6a14, liquid: 'lava',
    treeKind: 'charred', treeShape: 'scrub', treeCount: 40,
    canopy: [0x2a2426, 0x34282a, 0x221e22],
    trunk: 0x2a2224, tuft: 0x5a4a44, tufts: 0.3, flowers: [0xff7a1e, 0xffc23a, 0xe83a1a],
    props: [['obsidian', 40], ['vent', 12], ['basalt', 30], ['bones', 6]],
    features: [['lavaPool', 5], ['skullRock', 2], ['ruin', 3]],
    backdrop: { style: 'peaks', color: 0x3a3034, cap: 0xff5a14, capAt: 0.86, capGlow: true, height: [60, 150] },
    landmarks: ['eruption', 'fortress'],
    ambient: ['embers', [0xff8a2a, 0xffc24a, 0xff4a1a]],
    wind: [1, 7],
  },
  toadstool: {
    id: 'toadstool',
    name: 'Toadstool Glen',
    base: 1.7, amp1: 1.8, amp2: 0.5, greenUndulation: 0.18,
    rough: 0x3f8a72, fairway: 0x7fd07a, fringe: 0x92dc88, green: 0xaaf096,
    tee: 0x92dc88, sand: 0xf2e2c4, bed: 0x3a5a8a, deepRough: 0x2f6a6a,
    haze: 0xd8d0f4, hazeAmount: 0.7, cloud: [0.3, 0.55], hemiGround: 0x7aa89a,
    water: 0x5a8ae8, liquid: 'water',
    treeKind: 'mushroom', treeShape: 'round', treeCount: 52,
    canopy: [0xe8423a, 0xf29a2a, 0x9a5ae8, 0x3aa8e8, 0xe85aa8],
    trunk: 0xf2ead8, tuft: 0x4a9a80, tufts: 0.6, flowers: [0xc49aff, 0x7ae8ff, 0xfff27a],
    props: [['toadstool', 60], ['crystal', 26], ['mossRock', 18], ['fern', 30]],
    features: [['shroomHouse', 4], ['crystalCluster', 3], ['stoneRing', 1]],
    backdrop: { style: 'shrooms', color: 0x5a8a9a, height: [50, 130] },
    landmarks: ['giantShroom'],
    ambient: ['spores', [0xc8f0ff, 0xf0c8ff, 0xfff6b0]],
    wind: [0, 5],
  },
};

export const BIOME_IDS = Object.keys(BIOMES);
const WORLDS_PER_ROUND = 6;

/** The six worlds this course tours, in order. Every round is a different trip. */
export function courseBiomes(seedString) {
  const rng = mulberry32(hashSeed(`${seedString}:worlds`));
  const pool = [...BIOME_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, WORLDS_PER_ROUND);
}

/** Which world hole `number` (1-based) of a course is played in. */
export function biomeForHole(seedString, number) {
  return courseBiomes(seedString)[Math.floor(((number - 1) % 18) / 3)];
}

/**
 * Biomes — the look and the weather of each third of the round.
 * A round walks parkland (morning) -> links (afternoon) -> pines (sunset),
 * so the back nine never looks like the front. Pure data: colours are hex
 * ints, consumed by the terrain mesher, scenery and lighting.
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
    // Sky + light
    skyTop: 0x4aa3ee, skyHorizon: 0xcfeaff, fog: 0xcfe6f5,
    sun: 0xfff1d6, sunIntensity: 2.3, sunDir: [0.55, 0.75, 0.35],
    hemiSky: 0xbfdcff, hemiGround: 0x86a85a, hemiIntensity: 1.0,
    water: 0x3c9cc4,
    // Scenery
    treeKind: 'round', treeCount: 74,
    canopy: [0x3f7a34, 0x4e8f3a, 0x5da344, 0x6b9a3e, 0x478c41],
    trunk: 0x6b4a2f, hills: 0x7fae7a, flowers: [0xffffff, 0xffd84a, 0xff8fa3],
    // Weather (mph)
    wind: [0, 6],
  },
  links: {
    id: 'links',
    name: 'Links',
    base: 1.4, amp1: 1.0, amp2: 0.85, greenUndulation: 0.22,
    rough: 0xb8a55a, fairway: 0x8fbf55, fringe: 0x9fd062, green: 0xb2e274,
    tee: 0x9fd062, sand: 0xf6e7b8, bed: 0x4a7f86, deepRough: 0xa08c48,
    skyTop: 0x5b9fd8, skyHorizon: 0xf3ecd8, fog: 0xe9e6d6,
    sun: 0xfff6e0, sunIntensity: 2.5, sunDir: [-0.35, 0.85, 0.4],
    hemiSky: 0xd6e6f5, hemiGround: 0xb5a868, hemiIntensity: 1.05,
    water: 0x2f8fae,
    treeKind: 'scrub', treeCount: 16,
    canopy: [0x6f8f42, 0x7d9a45, 0x5f7f3a],
    trunk: 0x77583a, hills: 0xa9b98a, flowers: [0xf2e39a, 0xd9c7ff, 0xffffff],
    wind: [6, 14],
  },
  pines: {
    id: 'pines',
    name: 'Pines',
    base: 1.9, amp1: 2.2, amp2: 0.4, greenUndulation: 0.19,
    rough: 0x3f7a40, fairway: 0x6fb650, fringe: 0x82c95b, green: 0x9fde6a,
    tee: 0x86cc5e, sand: 0xf2d9a0, bed: 0x35596a, deepRough: 0x336636,
    skyTop: 0x4f7fd0, skyHorizon: 0xffc98a, fog: 0xf6c99a,
    sun: 0xffd29a, sunIntensity: 3.0, sunDir: [0.7, 0.55, -0.45],
    hemiSky: 0xc4d4ff, hemiGround: 0x8a9a60, hemiIntensity: 1.5,
    water: 0x3a7fb0,
    treeKind: 'pine', treeCount: 110,
    canopy: [0x2f6b3a, 0x2a5f38, 0x3a7a44, 0x246040],
    trunk: 0x5c4030, hills: 0x6b8f8a, flowers: [0xffb347, 0xffffff, 0xff7f6e],
    wind: [2, 9],
  },
};

# ThreeWood

A PS1-style procedurally generated golf game for the browser, built with Three.js.

Every round is a 3-hole course generated from a shareable seed string — same seed, same course, so you can dare a friend to beat your score on identical terrain. Hole pacing is hand-authored (a warm-up, a signature, a test) from a 9-hole plan, with 18-hole biomes on the roadmap.

## Features

- **Seeded procedural courses** — one seed string drives every gameplay-affecting roll (terrain shape, hole layout, tree placement) via an xmur3 hash + mulberry32 PRNG. Holes are planned, not random noise: warm-up par 4, signature over-water par 3, doglegs, bottlenecks, elevated greens — with per-par carry bands tuned against the physics so every hole is playable.
- **A real golf swing** — 3-click swing meter (start → power → strike) where the meter decides how well the shot comes off. Pick a club and a strike style — full, punch, flop, chip — each a launch profile layered on top of the club's loft and speed. Mishits bite.
- **Physics that respects the ground** — projectile ball flight with terrain interaction, plus a deflection-warning system: the aim arrow turns red when your shot is about to launch into a wall or steep slope.
- **Atmosphere** — custom GLSL water shader, simplex-noise terrain, pre-rendered minimap per hole, procedural Web Audio sound effects, and a low-poly PS1-era look.

## Controls

| Input | Action |
| --- | --- |
| Click / Space / Enter | Start round |
| Mouse | Aim the shot |
| Click ×3 | Swing: start → set power → strike at the line (early pulls left, late pushes right) |
| Up / Down | Change club |
| Mouse wheel | Fine-tune trajectory height |
| V | Shot type: full / punch / flop / chip |
| S | Spin selector (hook, slice, backspin, topspin) |
| C | Toggle camera mode |
| R | Reset ball to tee |
| Esc | Cancel the swing |
| H | Help |

## Getting started

```bash
git clone https://github.com/LeighAtkins/threeWood.git
cd threeWood
npm install
npm run dev
```

Then open http://localhost:5173.

### Production build

```bash
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

Deployed on Vercel — the included `vercel.json` configures the Vite build (`npm run build` → `dist/`).

## Tech

- [Three.js](https://threejs.org/) 0.160 — rendering, plus custom GLSL for water
- [simplex-noise](https://github.com/jwagner/simplex-noise.js) — terrain generation
- [@tweenjs/tween.js](https://github.com/tweenjs/tween.js) — camera transitions
- [Vite](https://vitejs.dev/) — dev server and build

## Project layout

```
main.js              bootstrap, scene setup, game start flow
src/
  game.js            game loop, input, rendering
  core/
    rng.js           seeded PRNG (seed string → deterministic randomness)
    clubs.js         club bag + strike variants as launch profiles
    swing.js         3-click swing meter
    lies.js          lie-based shot modifiers
    states.js        game state machine
  course/
    holeDesigner.js  hole archetypes, par pacing, tee→green layout
    trees.js         scattered vegetation
  terrain.js         simplex-noise heightfield
  shaders/water.js   custom GLSL water
  minimap.js         per-hole minimap
  audioManager.js    procedural SFX
docs/                design docs, physics plans, test results
```

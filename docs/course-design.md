# Course design: what the bots say

How the 18 holes were laid out, and the numbers behind it. The tool is
`tests/bot.js`, a headless golfer that plays with the game's own shot planner
at a skill setting (timing and pace error), run over many seeds. Three
golfers: **pro** (skill 0.3, a tidy club player), **par** (0.75, an average
player of this game), **easy** (1.3, a first-timer). `aggressive` makes the
bot go straight for the flag whenever a club can reach it instead of
following the fairway round.

Run it: `node /tmp/study2.mjs` (archetype × safe/aggressive) and
`node /tmp/study3.mjs` (whole round by hole and skill); both scripts are
small and reproduce from the imports at the top.

## What was wrong before

- **The Bucket** (a cup 2.3 m wide) was a novelty, not golf. Out.
- **Crazy Golf** could be played with a wedge, and was easier that way. It
  is putter-only now: the lane and its walls are the whole puzzle.
- **Par 5s** were 350–400 yards: a driver (200) and a 3-wood reached every one
  of them. The par bot averaged −1.0 on the half-pipe and −1.2 on the
  terraces. They are 425–475 now; getting home in two takes two pure strikes.
- **No hole offered a choice.** The safe-vs-aggressive study showed a zero
  "edge" on sixteen of seventeen archetypes: going straight for the flag
  cost nothing and risked nothing, because the inside of every corner was
  dry rough. The doglegs' trees were not in the way of a straight shot.

## What changed

| Hole | Change | Why |
|---|---|---|
| Doglegs | A pond inside the corner, trees behind it | Cutting the corner now carries water for a wedge in; round the outside is dry and leaves a mid-iron. Par bot: safe −0.47, aggressive −0.27 and 0.37 wet shots a hole. The gamble costs a quarter of a shot on average but wins when it comes off. |
| The Serpent | Sharper turns, a lake on the straight line at driver distance | The straight line used to be the best line with no risk. |
| The Gorge | A creek along the bottom of the ravine | Short of the carry used to roll out to the bottom unpunished; now it is a drop, so the lay-up short is a real option. Par bot +0.5, the hardest par 4. |
| Par 5s | 425–475 yards | Two decisions per hole instead of one. |

## The routing (par 72)

The order is the shape of a round: an easy downhill opener to learn the
swing, a putting puzzle, then the first decision at the third tee. A par 3
and a par 5 in each half. The water holes in the middle, the two hardest
asks (the Gorge, the Island) after the turn, and a punchbowl to finish on
that feeds the ball to the flag, so the round ends on a good feeling.

## What the bots shoot (12 seeds, mean over par)

| | pro | par | easy |
|---|---|---|---|
| Round | −12 | −2.4 | +27 |
| Easiest holes | 18 punchbowl (−1.6), 9 hog's back (−1.0) | 18 (−1.2), 8 terraces (−0.6) | 18 (0), 7 chute (+0.3) |
| Hardest holes | 13 gorge (+0.1) | 13 gorge, 16 ascent (+0.5) | 15 serpent (+3.4), 16 (+3.3) |

The pro is too good: −12 means the course has no teeth for a strong
player yet. That is partly the bot (it never three-putts and reads every
green perfectly) and partly the greens being easy. Next: faster greens and
tighter pins late in the round, measured the same way.

## How to use this when designing a hole

1. Write the hole. Give it a safe line and a brave line.
2. Run `study2`: the brave line should be a little **worse on average** for
   the par bot (edge +0.2 to +0.4) and better for the pro. If the edge is
   zero there is no decision; if it is over +1 nobody will take it.
3. Run `study3`: a par 4 should sit between −0.5 and +0.5 for the par bot.
4. Look at it from above (`~/tw-scratch/sweep.mjs`): water and sand must be
   where the numbers say they are, and visible from the tee.

// Plays full 18-hole rounds in a real browser through the game's own state
// machine (frames stepped by hand, so it runs much faster than real time).
// Usage: node scripts/dev/autoplay.mjs SEED [SEED...]
import { openPhone, URL } from './browser.mjs';

const { browser, page } = await openPhone();
for (const seed of process.argv.slice(2)) {
  await page.goto(`${URL}?seed=${seed}`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());
  await page.locator('[data-a="18"]').tap();
  const result = await page.evaluate((seed) => {
    const g = window.THREEWOOD;
    g.manual = true;
    let r = 12345;
    const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    const log = [];
    let steps = 0, holeSteps = 0, lastIdx = 0;
    while (g.state !== 'summary' && steps < 400000) {
      steps++; holeSteps++;
      if (g.round.index !== lastIdx) { lastIdx = g.round.index; holeSteps = 0; }
      if (holeSteps > 30000) { log.push(`STALL hole ${g.round.index + 1} state ${g.state} mode ${g.ball.mode}`); break; }
      if (g.state === 'intro') g.endIntro();
      else if (g.state === 'aim') {
        g.updatePlan();
        if (g.putting) {
          g.swingDown(); g.puttPower = Math.min(100, g.idealPct * (0.9 + rnd() * 0.22)); g.releasePutt();
        } else {
          g.swingDown(); g.swing.power = Math.min(100, (g.idealPower ?? 100) * (0.95 + rnd() * 0.1)); g.swing.phase = 'idle';
          g.hitShot((rnd() - 0.5) * 0.6);
        }
      } else if (g.state === 'result') {
        const sc = g.round.scores[g.round.index - 1];
        log.push(`${sc.number}:${sc.strokes}/${sc.par}`);
        g.nextHole();
      } else g.debugFrame(1 / 30, false);
    }
    const total = g.round.scores.reduce((s, h) => s + h.strokes - h.par, 0);
    return { seed, state: g.state, total, points: g.round.points, stats: g.round.stats, gameMinutes: (g.time / 60).toFixed(1), log: log.join(' ') };
  }, seed);
  console.log(JSON.stringify(result));
  await page.evaluate(() => { window.THREEWOOD.manual = false; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/tmp/tw/summary-${seed}.png` });
}
await browser.close();

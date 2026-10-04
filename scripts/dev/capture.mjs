// Captures gameplay as PNG frames with the game stepped by hand, so the
// footage is smooth no matter how slowly the machine renders.
// Usage: node scripts/dev/capture.mjs <scene> [outDir]
// Then:  python3 scripts/dev/make_gif.py <outDir> <file.gif>
import fs from 'node:fs';
import { openPhone, URL } from './browser.mjs';

const scene = process.argv[2] || 'drive';
const out = process.argv[3] || `/tmp/tw/frames/${scene}`;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const FPS = 20;
const SUB = 3; // physics/input substeps per captured frame
const { browser, page } = await openPhone({ scale: 1 });
let n = 0;

/** Advance one captured frame. `act` runs between substeps and may press things. */
async function frame(act) {
  await page.evaluate(({ dt, sub, act }) => {
    const g = window.THREEWOOD;
    for (let i = 0; i < sub; i++) {
      if (act) new Function('g', act)(g);
      g.debugFrame(dt / sub, i === sub - 1);
    }
    // CSS animations run on the capture clock too
    for (const a of document.getAnimations()) {
      if (!a.__held) { a.pause(); a.__held = true; }
      a.currentTime = (a.currentTime || 0) + dt * 1000;
    }
  }, { dt: 1 / FPS, sub: SUB, act: act || null });
  await page.screenshot({ path: `${out}/${String(n++).padStart(4, '0')}.png` });
}
const hold = async (seconds, act) => { for (let i = 0; i < seconds * FPS; i++) await frame(act); };
const until = async (cond, act, max = 30) => {
  for (let i = 0; i < max * FPS; i++) {
    await frame(act);
    if (await page.evaluate(new Function('g', `return (${cond})`).toString().replace(/^function anonymous\(g\n\) \{\n/, '(g => {').replace(/\n\}$/, '})(window.THREEWOOD)'))) return;
  }
};
const state = (expr) => page.evaluate(`(g => (${expr}))(window.THREEWOOD)`);
const waitFor = async (expr, act, max = 30) => {
  for (let i = 0; i < max * FPS; i++) { await frame(act); if (await state(expr)) return true; }
  return false;
};

// A swing with human-looking taps: power at the dashed box, strike on the line
const SWING = `
  if (g.state === 'swing' && !g.putting) {
    if (g.swing.phase === 'power' && g.swing.marker >= (g.idealPower ?? 100) - 0.7) g.advanceSwing();
    else if (g.swing.phase === 'accuracy' && g.swing.marker <= 9.2) g.advanceSwing();
  }`;
const PUTT = `
  if (g.state === 'swing' && g.putting && g.charging && g.puttPower >= g.idealPct - 1) g.swingUp();`;

async function start(seed, hole = 0) {
  await page.goto(`${URL}?seed=${seed}`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('threewood.hints.v2', '{"swing":9,"putt":9}'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.locator('[data-a="18"]').tap();
  await page.evaluate((hole) => {
    const g = window.THREEWOOD; g.manual = true; g.audio.setMuted(true);
    if (hole) g.debugGoto(hole);
  }, hole);
}

/** Sweep the aim a little, as a thumb would, then settle on the read. */
async function wiggle(amount, seconds = 1.2) {
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    const d = Math.cos(t * Math.PI * 2) * amount * (Math.PI * 2 / frames);
    await frame(`if (g.state === 'aim') { g.aimAngle += ${d / SUB}; g.planDirty = true; }`);
  }
}

/** Aim (with a little thumb movement), swing or putt, and watch it finish. */
async function playShot() {
  await hold(0.7);
  const putting = await state('g.putting');
  if (putting) {
    // Find the line that drops, then show the thumb easing onto it
    const read = await page.evaluate(() => {
      const g = window.THREEWOOD; const base = g.aimAngle; let found = 0;
      outer: for (let i = 0; i < 90; i++) for (const sgn of [1, -1]) {
        g.aimAngle = base + sgn * i * 0.004; g.updatePlan();
        if (document.querySelector('.meter .caption').textContent.startsWith('GOOD')) { found = g.aimAngle - base; break outer; }
      }
      g.aimAngle = base; g.planDirty = true; return { base, found };
    });
    const frames = 24;
    for (let i = 0; i < frames; i++) {
      const k = (1 - Math.cos((i / (frames - 1)) * Math.PI)) / 2;
      const a = read.base + (-read.found * 0.8) * (1 - k) + read.found * k;
      await frame(`if (g.state === 'aim') { g.aimAngle = ${a}; g.planDirty = true; }`);
    }
    await hold(0.5);
  } else {
    await wiggle(0.035, 1.0);
    await hold(0.3);
  }
  await page.evaluate(() => window.THREEWOOD.swingDown());
  await waitFor(`g.state === 'aim' || g.state === 'result'`, putting ? PUTT : SWING, 30);
}

const marks = {};
if (scene === 'hole') {
  // One whole hole, tee to cup. Frame marks let the GIFs be cut per beat.
  await start(process.argv[4] || 'GIFS-01', Number(process.argv[5] || 0));
  await hold(1.6);
  await page.evaluate(() => window.THREEWOOD.endIntro());
  for (let i = 0; i < 8; i++) {
    marks[`shot${i + 1}`] = n;
    await playShot();
    if (await state(`g.state === 'result'`)) break;
  }
  marks.result = n;
  await hold(2.5);
  fs.writeFileSync(`${out}/marks.json`, JSON.stringify(marks));
  console.log(marks);
} else if (scene === 'drive') {
  await start('GIFS-01');
  await hold(1.2);
  await page.evaluate(() => window.THREEWOOD.endIntro());
  await hold(0.8);
  await wiggle(0.05);
  await hold(0.4);
  await page.evaluate(() => window.THREEWOOD.swingDown());
  await waitFor(`g.state === 'settle'`, SWING, 20);
  await hold(1.4);
} else if (scene === 'approach') {
  await start('GIFS-01');
  await page.evaluate(() => { const g = window.THREEWOOD; g.endIntro(); g.debugPlace(96, 2.6); });
  await hold(0.9);
  await wiggle(0.03, 0.9);
  await page.evaluate(() => window.THREEWOOD.swingDown());
  await waitFor(`g.state === 'settle'`, SWING, 20);
  await hold(1.5);
} else if (scene === 'putt') {
  await start('GIFS-01');
  await page.evaluate(() => { const g = window.THREEWOOD; g.endIntro(); g.strokes = 2; g.debugPlace(5.5, 0.9); g.strokes = 2; g.updateScoreHud(); });
  await hold(0.8);
  // Find the line that drops, then show the thumb finding it
  const read = await page.evaluate(() => {
    const g = window.THREEWOOD; const base = g.aimAngle;
    for (let i = 0; i < 80; i++) for (const s of [1, -1]) {
      g.aimAngle = base + s * i * 0.004; g.updatePlan();
      if (g.effects.puttLine.material && g.idealSpeed && g.state === 'aim') {
        const holed = document.querySelector('.meter .caption').textContent.startsWith('GOOD');
        if (holed) { const a = g.aimAngle; g.aimAngle = base; g.planDirty = true; return a - base; }
      }
    }
    g.aimAngle = base; g.planDirty = true; return 0;
  });
  const frames = 26;
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    // Start on the wrong side, ease across to the right read
    const k = (1 - Math.cos(t * Math.PI)) / 2;
    const target = -read * 0.9 * (1 - k) + read * k;
    await frame(`if (g.state === 'aim') { g.aimAngle = ${await state('Math.atan2(g.world.cup.z - g.ball.z, g.world.cup.x - g.ball.x)')} + ${target}; g.planDirty = true; }`);
  }
  await hold(0.5);
  await page.evaluate(() => window.THREEWOOD.swingDown());
  await waitFor(`g.state === 'result'`, PUTT, 25);
  await hold(2.2);
} else if (scene === 'island') {
  await start('GIFS-01', 16);
  await waitFor(`g.state === 'aim'`, null, 8);
  await hold(0.8);
  await page.evaluate(() => window.THREEWOOD.swingDown());
  await waitFor(`g.state === 'settle'`, SWING, 20);
  await hold(1.4);
}
console.log(scene, 'frames', n, await state(`({ state: g.state, strokes: g.strokes, surface: g.ball.surface, toPin: Math.hypot(g.world.cup.x - g.ball.x, g.world.cup.z - g.ball.z).toFixed(1), bonuses: g.bonuses.map(b => b.label) })`));
await browser.close();

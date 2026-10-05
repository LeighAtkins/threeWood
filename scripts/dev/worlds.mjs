// Postcards from every world, for tuning the biomes.
// Usage: node scripts/dev/worlds.mjs [outDir] [biomes,comma] [hole] [sky hour]
// Then:  python3 scripts/dev/sheet.py <outDir> <sheet.png> 1 4
import fs from 'node:fs';
import { openPhone, URL } from './browser.mjs';

const out = process.argv[2] || '/tmp/tw/worlds';
const hole = Number(process.argv[4] || 0);
const hour = process.argv[5] || '15';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const { browser, page } = await openPhone({ scale: 1, landscape: process.env.LANDSCAPE === '1' });
await page.goto(`${URL}?seed=GIFS-01&sky=${hour}`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.evaluate(() => { localStorage.setItem('threewood.hints.v2', '{"swing":9,"putt":9}'); });
await page.locator('[data-a="18"]').tap();
const all = await page.evaluate(async (hole) => {
  const g = window.THREEWOOD; g.manual = true; g.audio.setMuted(true);
  if (hole) g.debugGoto(hole);
  g.endIntro();
  return Object.keys((await import('/src/course/biomes.js')).BIOMES);
}, hole);
const biomes = process.argv[3] ? process.argv[3].split(',') : all;

let n = 0;
const shot = async () => page.screenshot({ path: `${out}/${String(n++).padStart(4, '0')}.png` });
for (const biome of biomes) {
  const ms = await page.evaluate((biome) => {
    const g = window.THREEWOOD, t0 = performance.now();
    g.debugBiome(biome);
    const ms = performance.now() - t0;
    for (let i = 0; i < 30; i++) g.debugFrame(1 / 30, i === 29);
    return ms;
  }, biome);
  console.log(biome, `${ms.toFixed(0)}ms`, await page.evaluate(() => window.THREEWOOD.renderer.info.render));
  if (!process.env.NOHUD) await shot();
  // Three looks without the HUD: down the hole from above, off to the side, and back from the green
  for (const view of ['high', 'side', 'green']) {
    await page.evaluate((view) => {
      const g = window.THREEWOOD, t = g.world.tee, c = g.world.cup, cam = g.camera;
      g.hud.root.style.visibility = 'hidden';
      const dx = c.x - t.x, dz = c.z - t.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      if (view === 'high') { cam.position.set(t.x - ux * 30, t.y + 26, t.z - uz * 30); cam.lookAt(c.x, c.y + 12, c.z); }
      if (view === 'side') { cam.position.set(t.x + ux * len * 0.4, t.y + 5, t.z + uz * len * 0.4); cam.lookAt(t.x + ux * len * 0.5 - uz * 80, t.y + 9, t.z + uz * len * 0.5 + ux * 80); }
      if (view === 'green') { cam.position.set(c.x + ux * 26 + uz * 8, c.y + 7, c.z + uz * 26 - ux * 8); cam.lookAt(c.x - ux * 30, c.y + 5, c.z - uz * 30); }
      for (const o of [g.scenery.ambient].filter(Boolean)) o.visible = true;
      g.renderer.render(g.scene, cam);
    }, view);
    await shot();
  }
}
await browser.close();

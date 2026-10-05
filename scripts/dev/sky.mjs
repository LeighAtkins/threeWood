// Contact shots of the sky through a day, for tuning the palette.
// Usage: node scripts/dev/sky.mjs [outDir] [hours,comma,separated] [hole] [place lat,lon]
// Then:  python3 scripts/dev/sheet.py <outDir> <sheet.png> 1 6
import fs from 'node:fs';
import { openPhone, URL } from './browser.mjs';

const out = process.argv[2] || '/tmp/tw/sky';
const hours = (process.argv[3] || '0,4,5,5.5,6,6.5,7,8,10,12,15,17,18,18.5,19,19.5,20,22').split(',').map(Number);
const hole = Number(process.argv[4] || 0);
const place = process.argv[5] ? `&place=${process.argv[5]}` : '';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const { browser, page } = await openPhone({ scale: 1 });
await page.goto(`${URL}?seed=GIFS-01&sky=${hours[0]}${place}`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.evaluate(() => { localStorage.setItem('threewood.hints.v2', '{"swing":9,"putt":9}'); });
await page.locator('[data-a="18"]').tap();
await page.evaluate((hole) => {
  const g = window.THREEWOOD; g.manual = true; g.audio.setMuted(true);
  if (hole) g.debugGoto(hole);
  g.endIntro();
}, hole);

let n = 0;
for (const h of hours) {
  const info = await page.evaluate((h) => {
    const g = window.THREEWOOD;
    g.sky.fixedHour = h; g.sky.hour = h;
    for (let i = 0; i < 20; i++) g.debugFrame(1 / 30, i === 19);
    return `${g.sky.phase()} alt ${g.sky.altitude.toFixed(1)}`;
  }, h);
  console.log(h, info);
  await page.screenshot({ path: `${out}/${String(n++).padStart(4, '0')}.png` });
  // And one with the chin up, facing the sun or moon, HUD out of the way
  await page.evaluate(() => {
    const g = window.THREEWOOD, t = g.world.tee, d = g.sky.night > 0.5 && g.sky.moonUp > 0.5 ? g.sky.moonDir : g.sky.sunDir;
    document.querySelector('#hud, .hud')?.style.setProperty('visibility', 'hidden');
    g.camera.position.set(t.x, t.y + 6, t.z);
    g.camera.lookAt(t.x + d.x * 100, t.y + 6 + 32, t.z + d.z * 100);
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: `${out}/${String(n++).padStart(4, '0')}.png` });
  await page.evaluate(() => document.querySelector('#hud, .hud')?.style.removeProperty('visibility'));
}
await browser.close();

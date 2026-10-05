// Clearance audit: on every hole of several courses, in every world, nothing
// may crowd the tee, ring the green, stand on a short cut, or poke the horizon
// into the course. Also renders cup close-ups. Needs the dev server (imports /src).
// Usage: GAME_URL=http://localhost:5199/ node scripts/dev/audit.mjs
import { openPhone, URL } from './browser.mjs';

const { browser, page } = await openPhone({ scale: 1 });
await page.goto(`${URL}?seed=AUDIT-1&sky=13`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('[data-a="18"]').tap();
const report = await page.evaluate(async () => {
  const g = window.THREEWOOD; g.manual = true; g.audio.setMuted(true);
  const { BIOMES } = await import('/src/course/biomes.js');
  const { designHole } = await import('/src/course/holeDesigner.js');
  const { buildWorld } = await import('/src/course/courseWorld.js');
  const { buildProps } = await import('/src/render/props.js');
  const { createGameRng } = await import('/src/core/rng.js');
  const { greenDistance } = await import('/src/course/shapes.js');
  const seg = (x, z, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l)); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
  const bad = {}; let checked = 0, holes = 0, minHorizon = Infinity;
  const note = (k, v) => { (bad[k] = bad[k] || []).push(v); };
  const biomes = Object.keys(BIOMES);
  for (const seed of ['AUDIT-1', 'AUDIT-2', 'AUDIT-3']) {
    for (let n = 1; n <= 18; n++) {
      const biome = biomes[(n + seed.length + Number(seed.slice(-1)) * 3) % biomes.length];
      const spec = designHole(seed, n, { biome });
      const world = buildWorld(spec);
      const built = buildProps(world, createGameRng(`${seed}:props-${n}`).rng, {});
      holes++;
      const path = spec.path;
      for (const p of built.placed) {
        checked++;
        const big = p.type === 'feature';
        const tee = Math.hypot(p.x - world.tee.x, p.z - world.tee.z);
        const gd = greenDistance(spec.green, p.x, p.z);
        if (tee < (big ? 36 : 13)) note('nearTee', `${seed}#${n} ${p.kind} ${tee.toFixed(0)}`);
        if (gd < (big ? 2.4 : 1.5)) note('nearGreen', `${seed}#${n} ${p.kind} ${gd.toFixed(2)}`);
        if (big) {
          for (let i = 0; i + 2 < path.length; i++) if (seg(p.x, p.z, path[i], path[i + 2]) < spec.fairwayHalf + 16) note('onShortCut', `${seed}#${n} ${p.kind}`);
          for (let i = 0; i + 1 < path.length; i++) if (seg(p.x, p.z, path[i], path[i + 1]) < spec.fairwayHalf + 20) note('onFairway', `${seed}#${n} ${p.kind}`);
        }
      }
      // Horizon: no backdrop vertex above the turf inside the course's reach
      const pos = built.backdrop.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 4) continue;
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r < minHorizon) minHorizon = r;
      }
      for (const m of [built.trees, built.props, built.backdrop, built.glow]) { m.geometry.dispose(); m.material.dispose(); }
    }
  }
  return { holes, checked, minHorizon: Math.round(minHorizon), bad: Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, `${v.length}: ${v.slice(0, 4).join(', ')}`])) };
});
console.log(JSON.stringify(report, null, 1));

// Cup close-ups on a sloping green, from low and from above
for (const [i, view] of [[0, 'low'], [1, 'mid'], [2, 'top']]) {
  await page.evaluate((view) => {
    const g = window.THREEWOOD;
    if (g.state === 'intro') g.endIntro();
    g.debugPlace(1.4, 0.4);
    g.hud.root.style.visibility = 'hidden';
    g.effects.hideAim(); g.effects.beads.hide(); g.clubRig.hide();
    g.debugFrame(1 / 60, false);
    const c = g.world.cup, cam = g.camera;
    cam.clearViewOffset(); cam.fov = 30; cam.updateProjectionMatrix();
    const h = { low: 0.35, mid: 1.0, top: 2.6 }[view];
    cam.position.set(c.x + 2.0, c.y + h, c.z + 1.2);
    cam.lookAt(c.x, c.y, c.z);
    g.scenery.flag.userData.poleMat.opacity = 0.15;
    g.debugFrame(0, false);
    cam.position.set(c.x + 2.0, c.y + h, c.z + 1.2);
    cam.lookAt(c.x, c.y, c.z);
    g.renderer.render(g.scene, cam);
  }, view);
  await page.screenshot({ path: `/tmp/tw/cup-${view}.png` });
}
await browser.close();

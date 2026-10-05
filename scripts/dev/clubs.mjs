// Close-up turntable of the club models, for judging their shapes.
// Usage: node scripts/dev/clubs.mjs  ->  /tmp/tw/clubs.png
import { openPhone, URL } from './browser.mjs';

const { browser, page } = await openPhone({ landscape: true, scale: 1 });
await page.goto(`${URL}?seed=CLUBS`, { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.evaluate(() => localStorage.clear());
await page.locator('[data-a="18"]').tap();
const shots = [];
for (const [club, dist] of [['driver', 0], ['iron7', 120], ['putter', 4]]) {
  for (const view of ['behind', 'front', 'top-swing']) {
    await page.evaluate(({ club, dist, view }) => {
      const g = window.THREEWOOD;
      g.manual = true;
      if (g.state === 'intro') g.endIntro();
      if (dist) g.debugPlace(dist, 1);
      g.hud.setPlayVisible(false);
      g.effects.hideAim(); g.effects.beads.hide();
      const theta = view === 'top-swing' ? (club === 'putter' ? -0.5 : -1.9) : 0;
      const b = g.ball, dx = Math.cos(g.aimAngle), dz = Math.sin(g.aimAngle);
      g.debugFrame(1 / 60, false);
      g.clubRig.pose(b, dx, dz, theta, g.clubKind(), 1.3, 1);
      const cam = g.camera;
      // behind: where the player looks from; front: looking back at the face
      const s = view === 'front' ? 1 : -1;
      cam.clearViewOffset(); cam.fov = 40; cam.updateProjectionMatrix();
      if (view === 'top-swing') {
        cam.position.set(b.x - dx * 0.5 - dz * 3.2, b.y + 1.6, b.z - dz * 0.5 + dx * 3.2);
        cam.lookAt(b.x - dx * 0.6, b.y + 1.3, b.z - dz * 0.6);
      } else {
        cam.position.set(b.x + dx * 1.5 * s + dz * 0.7, b.y + 0.6, b.z + dz * 1.5 * s - dx * 0.7);
        cam.lookAt(b.x + dz * 0.25, b.y + 0.25, b.z - dx * 0.25);
      }
      g.renderer.render(g.scene, cam);
    }, { club, dist, view });
    const path = `/tmp/tw/club-${club}-${view}.png`;
    await page.screenshot({ path });
    shots.push(path);
  }
}
await browser.close();
console.log(shots.join('\n'));

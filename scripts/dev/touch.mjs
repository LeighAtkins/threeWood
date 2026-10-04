// Real-time smoke test with genuine pointer input (no test hooks for input):
// drag-to-aim, three-tap swing, hold-to-putt, reload-and-resume, daily course.
import { openPhone, URL } from './browser.mjs';

const { browser, page } = await openPhone();
const g = (expr) => page.evaluate(`(g => (${expr}))(window.THREEWOOD)`);
const check = (name, ok, extra = '') => console.log(ok ? 'PASS' : 'FAIL', name, extra);

await page.goto(`${URL}?seed=TOUCH-1`, { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.locator('[data-a="18"]').tap();
// Software rendering runs the game clock slowly: poll rather than sleep
const waitG = async (expr, max = 60) => { for (let i = 0; i < max * 4; i++) { if (await g(expr)) return true; await page.waitForTimeout(250); } return false; };
await waitG(`g.state === 'intro' && g.stateTime > 0.6`);
const vp = page.viewportSize();
await page.touchscreen.tap(vp.width / 2, vp.height / 2); // skip intro
await waitG(`g.state === 'aim'`, 5);
check('intro tap -> aim', await g(`g.state === 'aim'`));

// Drag to aim
const a0 = await g('g.aimAngle');
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', 200, 300);
for (let i = 1; i <= 8; i++) { await touch('touchMove', 200 + i * 6, 300); await page.waitForTimeout(16); }
await touch('touchEnd');
const a1 = await g('g.aimAngle');
check('drag right turns aim right', a1 > a0 + 0.05, `${(a1 - a0).toFixed(3)} rad for 48px`);
check('drag did not start a swing', await g(`g.state === 'aim'`));

// Club buttons
const c0 = await g('g.club.id');
await page.locator('.club .next').tap();
check('club next', (await g('g.club.id')) !== c0, `${c0} -> ${await g('g.club.id')}`);
await page.locator('.club .prev').tap();

// Three taps on the button
await page.locator('.swing-btn').tap({ force: true });
check('tap 1 starts swing', await g(`g.state === 'swing' && g.swing.phase === 'power'`));
await waitG(`g.swing.marker > 40`, 10);
await page.locator('.swing-btn').tap({ force: true });
check('tap 2 locks power', await g(`g.swing.phase === 'accuracy' && g.swing.power > 5`), `power ${await g('g.swing.power.toFixed(0)')}`);
await page.touchscreen.tap(vp.width / 2, vp.height / 2); // tap 3 anywhere on the course
check('tap 3 (on course) strikes', await g(`g.state === 'flight' && g.strokes === 1`));
for (let i = 0; i < 60 && (await g('g.state')) !== 'aim'; i++) { await page.touchscreen.tap(vp.width / 2, 200); await page.waitForTimeout(500); }
check('ball comes to rest -> aim', await g(`g.state === 'aim'`), `lie ${await g('g.ball.surface')}`);

// Reload mid-hole and resume
const before = await g(`({ x: g.ball.x, z: g.ball.z, strokes: g.strokes })`);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('[data-a="continue"]').tap();
await waitG(`g.state === 'aim'`, 5);
const after = await g(`({ x: g.ball.x, z: g.ball.z, strokes: g.strokes, state: g.state })`);
check('resume mid-hole', after.state === 'aim' && after.strokes === before.strokes && Math.abs(after.x - before.x) < 0.01, JSON.stringify(after));

// Hold-to-putt with real pointer events
await page.evaluate(() => window.THREEWOOD.debugPlace(4, 1));
await page.waitForTimeout(600);
check('putter on green', await g(`g.putting`));
await page.locator('.swing-btn').dispatchEvent('pointerdown', { pointerId: 7, bubbles: true });
await waitG(`g.puttPower > 25`, 10);
const charging = await g('g.charging && g.puttPower > 5');
await page.locator('.swing-btn').dispatchEvent('pointerup', { pointerId: 7, bubbles: true });
check('hold charges, release putts', charging && (await g(`g.state === 'flight' || g.state === 'holed' || g.state === 'settle'`)));

// Menu
for (let i = 0; i < 40 && !['aim', 'result'].includes(await g('g.state')); i++) await page.waitForTimeout(500);
if ((await g('g.state')) === 'aim') {
  await page.locator('.menu-btn').tap();
  check('menu pauses', await g('g.paused'));
  await page.screenshot({ path: '/tmp/tw/menu.png' });
  await page.locator('[data-a="quit"]').tap();
} else {
  await page.evaluate(() => { window.THREEWOOD.hud.clearLayer(); window.THREEWOOD.showTitle(); });
}
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/tw/title.png' });
await page.locator('[data-a="daily"]').tap();
await page.waitForTimeout(500);
check('daily course seed', (await g('g.round.seed')).startsWith('DAILY-'), await g('g.round.seed'));
check('service worker registered', await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration())));
await browser.close();

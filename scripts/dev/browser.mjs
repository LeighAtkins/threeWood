// Shared launcher for the dev scripts in this folder. Playwright is not a
// dependency of the game; point PLAYWRIGHT at any install of it.
const PLAYWRIGHT = process.env.PLAYWRIGHT || '/home/leigh/projects/threeWood/node_modules/playwright/index.mjs';
const { chromium, devices } = await import(PLAYWRIGHT);

export const URL = process.env.GAME_URL || 'http://localhost:4317/';

export async function openPhone({ landscape = false, scale } = {}) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const device = { ...devices[landscape ? 'iPhone 13 landscape' : 'iPhone 13'] };
  if (scale) device.deviceScaleFactor = scale;
  const context = await browser.newContext(device);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 5).join(' | ')));
  return { browser, page };
}

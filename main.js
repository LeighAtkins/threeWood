import { Game } from './src/game.js';

const container = document.getElementById('container');
new Game(container);
// The splash fades out once the first frames are on screen, rather than
// blinking away to a half-drawn scene
const splash = document.getElementById('loading');
if (splash) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 500);
  }));
}

// Offline play (installed to the home screen, or just a cached tab)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

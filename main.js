import { Game } from './src/game.js';

const container = document.getElementById('container');
document.getElementById('loading')?.remove();
new Game(container);

// Offline play (installed to the home screen, or just a cached tab)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

import { Game } from './src/game.js';

const container = document.getElementById('container');
document.getElementById('loading')?.remove();
new Game(container);

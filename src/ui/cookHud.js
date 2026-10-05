/**
 * The grill's HUD: one bar per flank of the fish, and the EAT button.
 *
 * Each bar is the same scale as render/grill.js: grey is raw, green is
 * cooked, the gold band is perfect, red is burnt. A flame sits on the bar of
 * the flank that is over the fire, and the whole thing pulses in a flare-up.
 */

import { glyph } from './glyphs.js';
import { COOK } from '../render/grill.js';

const pct = (d) => `${(Math.min(COOK.MAX, d) / COOK.MAX) * 100}%`;

const BAR = `
  <div class="cook-bar">
    <i class="flame"></i>
    <div class="track">
      <div class="zone ok" style="left:${pct(COOK.DONE)};width:calc(${pct(COOK.BURNT)} - ${pct(COOK.DONE)})"></div>
      <div class="zone best" style="left:${pct(COOK.PERFECT_LO)};width:calc(${pct(COOK.PERFECT_HI)} - ${pct(COOK.PERFECT_LO)})"></div>
      <div class="zone bad" style="left:${pct(COOK.BURNT)};right:0"></div>
      <div class="mark"></div>
    </div>
  </div>`;

export class CookHud {
  constructor(root, before, onEat) {
    this.node = document.createElement('div');
    this.node.className = 'cook hidden';
    this.node.innerHTML = `
      <div class="cook-bars">${BAR}${BAR}</div>
      <div class="cook-cue">${glyph('drag')}</div>
      <button class="cook-eat">EAT</button>`;
    root.insertBefore(this.node, before);
    this.bars = [...this.node.querySelectorAll('.cook-bar')];
    this.marks = this.bars.map((b) => b.querySelector('.mark'));
    this.cue = this.node.querySelector('.cook-cue');
    this.eat = this.node.querySelector('.cook-eat');
    this.eat.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onEat(); });
  }

  show(hint) {
    this.node.classList.remove('hidden', 'over');
    this.cue.classList.toggle('hidden', !hint);
  }

  hide() { this.node.classList.add('hidden'); }

  /** The player has turned it: the drag cue has done its job. */
  hideCue() { this.cue.classList.add('hidden'); }

  /** No more input: the fish is off the fire (or black). */
  finish() { this.node.classList.add('over'); this.cue.classList.add('hidden'); }

  /** @param {import('../render/grill.js').Grill} grill */
  update(grill) {
    for (const i of [0, 1]) {
      this.marks[i].style.left = pct(grill.done[i]);
      this.bars[i].classList.toggle('lit', grill.exposure(i) > 0.35);
    }
    this.node.classList.toggle('flare', grill.flare > 0.5);
    // EAT turns gold when both flanks are in the perfect band
    const d = grill.done;
    const perfect = d.every((v) => v >= COOK.PERFECT_LO && v <= COOK.PERFECT_HI);
    const edible = d.every((v) => v >= COOK.DONE);
    this.eat.classList.toggle('best', perfect);
    this.eat.classList.toggle('ready', edible && !perfect);
  }
}

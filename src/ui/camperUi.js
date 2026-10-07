/**
 * The camper creator and the campfire pose bar.
 *
 * The creator is a panel over the bottom of the screen; the 3D camper stands
 * above it and changes as you pick. Outfits you have not earned can be tried
 * on but not worn out of the shop: the panel says what earns them.
 */

import { SKINS, HAIR_COLORS, EYE_COLORS, HAIR_STYLES, OUTFITS, isUnlocked, progress } from '../core/camp.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const HAIR_NAMES = { short: 'Short', bob: 'Bob', bun: 'Bun', long: 'Long', twintails: 'Twin tails', ponytail: 'Ponytail' };

export class CamperUi {
  constructor(root, before) {
    this.node = document.createElement('div');
    this.node.className = 'camper-ui hidden';
    root.insertBefore(this.node, before);
    this.poses = document.createElement('div');
    this.poses.className = 'pose-bar hidden';
    root.insertBefore(this.poses, before);
  }

  /**
   * @param {object} camp     core/camp.js state (look, unlocked, stats)
   * @param {(look: object) => void} onChange  preview this look
   * @param {(look: object) => void} onDone    wear this look (always an unlocked outfit)
   */
  open(camp, onChange, onDone) {
    const look = { ...camp.look };
    const swatches = (list, key) => list.map((c, i) => `<button class="sw" data-k="${key}" data-v="${i}" style="background:${hex(c)}"></button>`).join('');
    this.node.innerHTML = `
      <div class="panel">
        <div class="row seg">
          <button data-k="body" data-v="girl">GIRL</button>
          <button data-k="body" data-v="boy">BOY</button>
        </div>
        <div class="row"><span>SKIN</span><div class="sws">${swatches(SKINS, 'skin')}</div></div>
        <div class="row"><span>EYES</span><div class="sws">${swatches(EYE_COLORS, 'eyes')}</div></div>
        <div class="row"><span>HAIR</span>
          <div class="step"><button data-step="hair" data-d="-1">‹</button><b class="hair-name"></b><button data-step="hair" data-d="1">›</button></div>
        </div>
        <div class="row"><span></span><div class="sws">${swatches(HAIR_COLORS, 'hairColor')}</div></div>
        <div class="row"><span>OUTFIT</span>
          <div class="step"><button data-step="outfit" data-d="-1">‹</button><b class="fit-name"></b><button data-step="outfit" data-d="1">›</button></div>
        </div>
        <div class="lock"></div>
        <div class="row"><span>NAME</span><input class="name" maxlength="10" autocomplete="off" spellcheck="false"></div>
        <button class="btn done">DONE</button>
      </div>`;
    const q = (s) => this.node.querySelector(s);
    const name = q('.name');
    name.value = look.name;
    const paint = () => {
      for (const b of this.node.querySelectorAll('[data-k]')) {
        const v = b.dataset.k === 'body' ? b.dataset.v : Number(b.dataset.v);
        b.classList.toggle('on', look[b.dataset.k] === v);
      }
      q('.hair-name').textContent = HAIR_NAMES[look.hair];
      const fit = OUTFITS.find((o) => o.id === look.outfit);
      const open = isUnlocked(camp, fit.id);
      q('.fit-name').textContent = `${OUTFITS.indexOf(fit) + 1}/${OUTFITS.length} · ${fit.name}`;
      q('.lock').innerHTML = open ? '' : `<i></i>${fit.how} · ${progress(camp, fit)}`;
      q('.lock').classList.toggle('on', !open);
      q('.done').textContent = open ? 'DONE' : 'LOCKED';
      q('.done').classList.toggle('ghost', !open);
    };
    this.node.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.k) look[b.dataset.k] = b.dataset.k === 'body' ? b.dataset.v : Number(b.dataset.v);
      else if (b.dataset.step === 'hair') {
        look.hair = HAIR_STYLES[(HAIR_STYLES.indexOf(look.hair) + Number(b.dataset.d) + HAIR_STYLES.length) % HAIR_STYLES.length];
      } else if (b.dataset.step === 'outfit') {
        const i = OUTFITS.findIndex((o) => o.id === look.outfit);
        look.outfit = OUTFITS[(i + Number(b.dataset.d) + OUTFITS.length) % OUTFITS.length].id;
      } else if (b.classList.contains('done')) {
        if (!isUnlocked(camp, look.outfit)) return;
        look.name = name.value.trim() || 'Camper';
        this.close();
        onDone(look);
        return;
      } else return;
      paint();
      onChange(look);
    };
    paint();
    this.node.classList.remove('hidden');
  }

  close() { this.node.classList.add('hidden'); this.node.innerHTML = ''; }

  /** Pose buttons for the campfire. onPose(name); onBack() returns to the card. */
  showPoses(onPose, onBack, onPhoto = null) {
    const names = [['sit', 'SIT'], ['warm', 'WARM UP'], ['peace', 'PEACE'], ['cheer', 'CHEER'], ['hello', 'HELLO']];
    this.poses.innerHTML = `${names.map(([id, label]) => `<button data-p="${id}">${label}</button>`).join('')}${onPhoto ? '<button class="photo" data-p="photo">📷 PHOTO</button>' : ''}<button class="back" data-p="">BACK</button>`;
    this.poses.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.p === 'photo') { this.hidePoses(); onPhoto(); return; }
      if (!b.dataset.p) { this.hidePoses(); onBack(); return; }
      for (const o of this.poses.children) o.classList.toggle('on', o === b);
      onPose(b.dataset.p);
    };
    this.poses.classList.remove('hidden');
  }

  hidePoses() { this.poses.classList.add('hidden'); }
}

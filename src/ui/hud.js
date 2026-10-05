import { SWING, markerToPercent } from '../core/swing.js';
import { glyph, pips, tipIcon } from './glyphs.js';
import { blobRadius, greenDistance } from '../course/shapes.js';

/**
 * The HUD — DOM over the canvas, laid out for thumbs.
 *
 *   top:     menu · hole/par/yards · score
 *   sides:   wind + points (left), minimap (right)
 *   bottom:  club picker (left thumb), SWING button (right thumb), meter above
 *
 * The HUD holds no game state: the game pushes values in and gets callbacks
 * out, so it can be restyled without touching the rules.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};

const vsPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
const skyLabel = (mode) => `SKY · ${mode.toUpperCase()}`;
const musicLabel = (on) => (on ? '♪ MUSIC ON' : '♪ MUSIC OFF');
/** The first switch-on downloads the band, so the label waits for the outcome. */
const toggleMusic = (button, onMusic) => {
  button.textContent = '♪ MUSIC …';
  onMusic().then((on) => { button.textContent = musicLabel(on); });
};

export function scoreName(strokes, par) {
  if (strokes === 1) return 'HOLE IN ONE!';
  const d = strokes - par;
  if (d <= -3) return 'ALBATROSS!';
  if (d === -2) return 'EAGLE!';
  if (d === -1) return 'BIRDIE!';
  if (d === 0) return 'PAR';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOUBLE BOGEY';
  return `+${d}`;
}

export class Hud {
  constructor(handlers) {
    this.h = handlers;
    this.root = el('div');
    this.root.id = 'hud';
    document.body.appendChild(this.root);

    this.root.innerHTML = `
      <div class="top play">
        <button class="menu-btn" aria-label="Menu">☰</button>
        <div class="pill hole-pill"><div class="big"></div><div class="small"></div></div>
        <div class="spacer"></div>
        <div class="pill score-pill"><div class="big">E</div><div class="small">SHOT 1</div></div>
      </div>
      <div class="side-left play">
        <div class="pill wind"><svg class="wind-arrow" viewBox="0 0 24 24"><path d="M12 2 L19 14 L13.5 12.5 L13.5 22 L10.5 22 L10.5 12.5 L5 14 Z" fill="#fff8ec"/></svg><span></span></div>
        <div class="pill points">★ 0</div>
        <div class="pill goal hidden"></div>
      </div>
      <div class="side-right play"><canvas id="minimap" width="208" height="208"></canvas></div>
      <div class="pin-tag play hidden"></div>
      <div class="carry hidden"></div>
      <div class="callouts"></div>
      <div class="pill hint hidden"></div>
      <div class="meter hidden">
        <div class="steps hidden"><i>1 START</i><i>2 POWER</i><i>3 STRIKE</i></div>
        <div class="caption"></div>
        <div class="flag-rail"><div class="flag hidden"></div><div class="max-tag">MAX</div></div>
        <div class="track">
          <div class="fill"></div>
          <div class="zone good"></div><div class="zone pure"></div>
          <div class="ideal"></div>
          <div class="line"></div>
          <div class="lock hidden"></div>
          <div class="marker"></div>
        </div>
      </div>
      <div class="bottom play">
        <div class="club-wrap">
          <div class="pill lie hidden"></div>
          <div class="club">
            <button class="prev" aria-label="Longer club">‹</button>
            <div class="info"><div class="name"></div><div class="yards"></div></div>
            <button class="next" aria-label="Shorter club">›</button>
          </div>
        </div>
        <button class="swing-btn">SWING</button>
      </div>
      <div class="layer"></div>
    `;

    const q = (s) => this.root.querySelector(s);
    this.playEls = [...this.root.querySelectorAll('.play')];
    this.holeBig = q('.hole-pill .big');
    this.holeSmall = q('.hole-pill .small');
    this.scoreBig = q('.score-pill .big');
    this.scoreSmall = q('.score-pill .small');
    this.wind = q('.wind');
    this.windArrow = q('.wind-arrow');
    this.windText = q('.wind span');
    this.points = q('.points');
    this.goal = q('.goal');
    this.minimap = q('#minimap');
    this.pinTag = q('.pin-tag');
    this.callouts = q('.callouts');
    this.carry = q('.carry');
    this.hintEl = q('.hint');
    this.meter = q('.meter');
    this.meterCaption = q('.meter .caption');
    this.meterFlag = q('.meter .flag');
    this.meterSteps = q('.meter .steps');
    this.fill = q('.meter .fill');
    this.zoneGood = q('.meter .zone.good');
    this.zonePure = q('.meter .zone.pure');
    this.ideal = q('.meter .ideal');
    this.line = q('.meter .line');
    this.lock = q('.meter .lock');
    this.marker = q('.meter .marker');
    this.clubName = q('.club .name');
    this.clubYards = q('.club .yards');
    this.lie = q('.lie');
    this.swingBtn = q('.swing-btn');
    this.layer = q('.layer');
    this.bottom = q('.bottom');

    q('.menu-btn').addEventListener('click', () => this.h.onMenu());
    q('.club .prev').addEventListener('click', () => this.h.onClub(-1));
    q('.club .next').addEventListener('click', () => this.h.onClub(1));
    q('.club .info').addEventListener('click', () => this.h.onClub(1));

    // The swing button works on press AND release (putts are hold-to-charge)
    const down = (e) => {
      e.preventDefault();
      try { this.swingBtn.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      this.swingBtn.classList.add('down');
      this.h.onSwingDown();
    };
    const up = (e) => {
      e.preventDefault();
      if (!this.swingBtn.classList.contains('down')) return;
      this.swingBtn.classList.remove('down');
      this.h.onSwingUp();
    };
    this.swingBtn.addEventListener('pointerdown', down);
    this.swingBtn.addEventListener('pointerup', up);
    this.swingBtn.addEventListener('pointercancel', up);
    this.swingBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    this.mapCtx = this.minimap.getContext('2d');
    this.setPlayVisible(false);
  }

  // --- Visibility -------------------------------------------------------------

  setPlayVisible(v) {
    for (const node of this.playEls) node.classList.toggle('hidden', !v);
    if (!v) { this.meter.classList.add('hidden'); this.hintEl.classList.add('hidden'); this.demo(null); }
  }

  setControlsVisible(v) { this.bottom.classList.toggle('hidden', !v); }

  /** Mid-swing layout: the club picker gives its space to the meter. */
  setSwinging(v) { this.root.classList.toggle('swinging', v); }

  // --- Top / side readouts ------------------------------------------------------

  setHole({ index, total, par, yards }) {
    this.holeBig.textContent = `HOLE ${index}`;
    this.holeSmall.textContent = `PAR ${par} · ${yards}y · ${index}/${total}`;
  }

  setScore({ strokes, total, shotLabel }) {
    this.scoreBig.textContent = vsPar(total);
    this.scoreSmall.textContent = shotLabel || `SHOT ${strokes + 1}`;
  }

  setPoints(points, bump) {
    this.points.textContent = `★ ${points.toLocaleString()}`;
    if (bump) {
      this.points.classList.remove('bump');
      void this.points.offsetWidth;
      this.points.classList.add('bump');
    }
  }

  /** The hole's challenge, under the points. done: null = in play, true/false = result. */
  setChallenge(text, done) {
    this.goal.classList.toggle('hidden', !text);
    this.goal.classList.toggle('won', done === true);
    this.goal.textContent = text ? `${done === true ? '★' : '☆'} ${text}` : '';
  }

  /** angle: radians, 0 = blowing straight up the screen (away from camera). */
  setWind(speed, angle) {
    this.wind.classList.toggle('calm', speed < 1);
    this.windText.textContent = speed < 1 ? 'CALM' : `${speed} mph`;
    this.windArrow.style.transform = `rotate(${angle}rad)`;
  }

  setClub({ name, yards, lie, lieBad, canChange }) {
    this.clubName.textContent = name;
    this.clubYards.textContent = yards;
    this.lie.textContent = lie || '';
    this.lie.classList.toggle('hidden', !lie);
    this.lie.classList.toggle('bad', !!lieBad);
    this.bottom.querySelector('.club').style.opacity = canChange ? 1 : 0.6;
  }

  setPinTag(text, x, y, visible) {
    this.pinTag.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.pinTag.textContent = text;
    this.pinTag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  /**
   * The button shows the gesture it wants next, as a picture:
   *   swing / power / strike  tap (the dots count the three taps)
   *   wait     hands off, the bar is filling itself
   *   full     a full-power shot: two taps, the middle step is a MAX tag
   *   hold     press and keep pressing      release  let go now
   *   tap      one tap (tap-tap putting)
   */
  setAction(kind, full = false) {
    const faces = {
      swing:   [glyph('tap') + pips(0, 3, full), 'ready', full ? 'Tap to swing at full power' : 'Tap to swing'],
      power:   [glyph('tap') + pips(1), 'go', 'Tap to set power'],
      wait:    [glyph('wait') + pips(1, 3, true), 'disabled', 'Wait'],
      strike:  [glyph('tap') + pips(2, 3, full), 'go', 'Tap to strike'],
      hold:    [glyph('hold'), 'ready', 'Hold to putt'],
      release: [glyph('release'), 'go', 'Let go'],
      tap:     [glyph('tap'), 'go', 'Tap to putt'],
    };
    const [html, mode, label] = faces[kind];
    const key = `${kind}${full ? '+' : ''}`;
    if (this.actionKind !== key) {
      this.actionKind = key;
      this.swingBtn.innerHTML = html;
      this.swingBtn.setAttribute('aria-label', label);
    }
    this.swingBtn.classList.toggle('pulse', mode === 'ready');
    this.swingBtn.classList.toggle('go', mode === 'go');
    this.swingBtn.classList.toggle('disabled', mode === 'disabled');
  }

  // --- Meter --------------------------------------------------------------------

  /** Full-swing meter: late zone | strike line | power -> */
  showSwingMeter(idealPower, zone = 1) {
    this.meter.classList.remove('hidden');
    this.meter.dataset.mode = 'swing';
    const pct = markerToPercent;
    // zone < 1: the sweet spot has shrunk (later in the round)
    const pure = SWING.PURE_MAX * SWING.WINDOW * zone, good = SWING.GOOD_MAX * SWING.WINDOW * zone;
    this.line.style.left = `${pct(SWING.LINE)}%`;
    this.zonePure.style.left = `${pct(SWING.LINE - pure)}%`;
    this.zonePure.style.width = `${pct(SWING.LINE + pure) - pct(SWING.LINE - pure)}%`;
    this.zoneGood.style.left = `${pct(SWING.LINE - good)}%`;
    this.zoneGood.style.width = `${pct(SWING.LINE + good) - pct(SWING.LINE - good)}%`;
    this.zonePure.classList.remove('hidden');
    this.zoneGood.classList.remove('hidden');
    this.line.classList.remove('hidden');
    this.ideal.classList.toggle('hidden', idealPower == null || idealPower >= 99.5);
    if (idealPower != null) this.ideal.style.left = `${pct(idealPower)}%`;
    this.lock.classList.add('hidden');
    this.fill.style.left = `${pct(0)}%`;
    this.fill.style.width = '0%';
    this.setMeterAuto(false);
  }

  /** Full-power shot: the bar is filling itself to the MAX tag at its end. */
  setMeterAuto(on) { this.meter.classList.toggle('auto', on); }

  updateSwingMeter(swing) {
    const pct = markerToPercent;
    this.marker.style.left = `${pct(swing.marker)}%`;
    if (swing.phase === 'power') {
      this.fill.style.width = `${pct(swing.marker) - pct(0)}%`;
    } else if (swing.phase === 'accuracy') {
      this.fill.style.width = `${pct(swing.power) - pct(0)}%`;
      this.lock.classList.remove('hidden');
      this.lock.style.left = `${pct(swing.power)}%`;
    }
  }

  /** Putt meter: plain 0..100 fill with the dead-weight pace marked. */
  showPuttMeter(idealPct) {
    this.meter.classList.remove('hidden');
    this.meter.dataset.mode = 'putt';
    this.setMeterAuto(false);
    this.zonePure.classList.add('hidden');
    this.zoneGood.classList.add('hidden');
    this.line.classList.add('hidden');
    this.lock.classList.add('hidden');
    this.ideal.classList.remove('hidden');
    this.ideal.style.left = `${idealPct}%`;
    this.fill.style.left = '0%';
    this.fill.style.width = '0%';
    this.marker.style.left = '0%';
  }

  updatePuttMeter(power) {
    this.fill.style.width = `${power}%`;
    this.marker.style.left = `${power}%`;
  }

  /** Only ever a symbol now: 'ok' shows a tick (the putt line is good). */
  setMeterCaption(mark) { this.meterCaption.innerHTML = mark === 'ok' ? '<span class="ok">✓</span>' : ''; }

  /**
   * A gesture glyph standing on the bar exactly where the tap (or the
   * release) belongs. kind: 'tap' | 'release'; now = do it this instant,
   * later = not yet (dimmed: it marks the tap that is still to come).
   */
  setMeterFlag(pct, kind = 'tap', now = false, later = false) {
    this.meterFlag.classList.toggle('hidden', pct == null);
    if (pct == null) return;
    if (this.flagKind !== kind) { this.flagKind = kind; this.meterFlag.innerHTML = glyph(kind); }
    this.meterFlag.classList.toggle('now', now);
    this.meterFlag.classList.toggle('later', later);
    this.meterFlag.style.left = `${pct}%`;
  }

  /** Highlight which of the three swing taps comes next (null hides). */
  setMeterSteps(current) {
    current = null; // the button's dots count the taps now
    this.meterSteps.classList.toggle('hidden', current == null);
    [...this.meterSteps.children].forEach((node, i) => {
      node.classList.toggle('done', current != null && i + 1 < current);
      node.classList.toggle('now', i + 1 === current);
    });
  }

  hideMeter() { this.meter.classList.add('hidden'); }

  // --- Callouts / hints ---------------------------------------------------------

  callout(text, kind = '') {
    const node = el('div', `callout ${kind}`);
    node.textContent = text;
    this.callouts.appendChild(node);
    while (this.callouts.children.length > 4) this.callouts.firstChild.remove();
    node.addEventListener('animationend', () => node.remove());
  }

  /** Big live distance readout while a shot is in the air. */
  setCarry(text, sub = '') {
    this.carry.classList.toggle('hidden', !text);
    if (!text) return;
    const html = sub ? `${text}<small>${sub}</small>` : text;
    if (this.carryHtml !== html) { this.carryHtml = html; this.carry.innerHTML = html; }
  }

  /**
   * A ghost hand over the course showing a drag. kind: 'drag' | 'shape' |
   * null; warn adds a symbol above it (a tree in the way).
   */
  demo(kind, { high = false, warn = '' } = {}) {
    if (!this.demoEl) {
      this.demoEl = el('div', 'demo hidden');
      this.root.insertBefore(this.demoEl, this.layer);
    }
    const key = kind ? `${kind}|${warn}` : '';
    this.demoEl.classList.toggle('hidden', !kind);
    this.demoEl.classList.toggle('high', high);
    if (kind && this.demoKey !== key) this.demoEl.innerHTML = `${warn ? `<span class="warn">${warn}</span>` : ''}${glyph(kind)}`;
    this.demoKey = key;
  }

  hint(text, high = false) {
    this.hintEl.classList.toggle('hidden', !text);
    this.hintEl.classList.toggle('high', high);
    if (text) this.hintEl.textContent = text;
  }

  // --- Overlays -------------------------------------------------------------------

  clearLayer() { this.layer.innerHTML = ''; }

  showTitle({ saved, best, daily, seed, music, sky }) {
    this.clearLayer();
    const node = el('div', 'title', `
      <div class="logo">
        <h1>THREE<span>WOOD</span></h1>
        <p>18 HOLES · NEW COURSE EVERY ROUND</p>
      </div>
      <div class="title-actions">
        ${saved ? `<button class="btn" data-a="continue">CONTINUE · HOLE ${saved.hole} (${vsPar(saved.total)})</button>` : ''}
        <button class="btn ${saved ? 'ghost' : ''}" data-a="18">PLAY 18 HOLES</button>
        <div class="btn-row">
          <button class="btn ghost" data-a="daily">DAILY${daily ? ` · ${vsPar(daily.score)}` : ''}</button>
          <button class="btn ghost" data-a="9">QUICK 9</button>
        </div>
        <div class="title-foot">${best ? `BEST ROUND ${vsPar(best.score)} · ★ ${best.points.toLocaleString()}<br>` : ''}COURSE ${seed}${sky ? `<br>${sky}` : ''}</div>
        <button class="music-toggle" data-a="music">${musicLabel(music)}</button>
        <button class="music-toggle" data-a="friends">PLAY WITH FRIENDS</button>
        <button class="music-toggle" data-a="camper">MY CAMPER</button>
        <button class="music-toggle" data-a="fishing">PRACTICE FISHING</button>
        <button class="music-toggle" data-a="grill">PRACTICE GRILL</button>
      </div>`);
    node.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'music') toggleMusic(e.target, this.h.onMusic);
      else if (a) this.h.onStart(a);
    });
    this.layer.appendChild(node);
  }

  showIntro({ index, total, name, par, yards, blurb, biome, pips = 1, wind = 0, tip, challenge }) {
    this.clearLayer();
    const dots = '●'.repeat(pips) + '○'.repeat(5 - pips);
    const node = el('div', 'overlay pass', `
      <div class="intro">
        <div class="num">HOLE ${index} OF ${total} · ${biome.toUpperCase()}</div>
        <div class="name">${name}</div>
        <div class="meta">PAR ${par} · ${yards} YARDS</div>
        <div class="cond"><span class="pips">${dots}</span> ${wind >= 1 ? `· WIND ${wind} MPH` : '· CALM'}</div>
        <div class="blurb">${blurb}</div>
        ${challenge ? `<div class="quest">☆ ${challenge.text} <b>+${challenge.points}</b></div>` : ''}
        ${tip ? `<div class="tip">${tipIcon(tip.icon)}<span>${tip.text}</span></div>` : ''}
        <div class="skip">${glyph('tap')}</div>
      </div>`);
    this.layer.appendChild(node);
  }

  showResult({ title, kind, strokes, par, bonuses, holePoints, challenge, card, last, onNext }) {
    this.clearLayer();
    const node = el('div', 'overlay', `
      <div class="card result">
        <h2>HOLE ${card.currentLabel}</h2>
        <h1 class="${kind}">${title}</h1>
        <div class="result-score">${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} · par ${par}</div>
        ${challenge && !challenge.won ? `<div class="missed">☆ Missed: ${challenge.text}</div>` : ''}
        <div class="bonus-list">
          ${mergeBonuses(bonuses).map((b, i) => `<div class="bonus" style="animation-delay:${0.25 + i * 0.12}s"><span>${b.label}</span><b>+${b.points}</b></div>`).join('')}
          <div class="total-line"><span>HOLE POINTS</span><span class="gold">★ ${holePoints.toLocaleString()}</span></div>
        </div>
        ${scorecardHtml(card, true)}
        <button class="btn" data-a="next">${last ? 'FINISH ROUND' : 'NEXT HOLE'}<span class="auto"></span></button>
      </div>`);
    node.querySelector('[data-a="next"]').addEventListener('click', onNext);
    this.layer.appendChild(node);
  }

  showSummary({ total, par, strokes, points, stats, card, best, seed, outfits = [], board = null, onAgain, onShare, onCamp }) {
    this.clearLayer();
    const node = el('div', 'overlay dim', `
      <div class="card">
        <h2>ROUND COMPLETE</h2>
        <h1 class="gold">${vsPar(total)}</h1>
        <div class="result-score">${strokes} strokes · par ${par} · ★ ${points.toLocaleString()}${best ? ' · <b class="gold">NEW BEST!</b>' : ''}</div>
        ${board ? `<div class="board">${board.map((b, i) => `<div class="${b.me ? 'me' : ''}"><span>${i + 1}. ${esc(b.name)}</span><span>${vsPar(b.total)}</span></div>`).join('')}</div>` : ''}
        ${scorecardHtml(card)}
        <div class="stats">${stats.map((s) => `<div class="stat"><b>${s.value}</b><span>${s.label}</span></div>`).join('')}</div>
        ${outfits.map((name) => `<div class="new-fit">NEW OUTFIT · ${name.toUpperCase()}</div>`).join('')}
        <button class="btn" data-a="camp">SIT BY THE FIRE</button>
        <button class="btn ghost" data-a="again">NEW COURSE</button>
        <button class="btn ghost" data-a="share">CHALLENGE A FRIEND · ${seed}</button>
      </div>`);
    node.querySelector('[data-a="camp"]').addEventListener('click', onCamp);
    node.querySelector('[data-a="again"]').addEventListener('click', onAgain);
    node.querySelector('[data-a="share"]').addEventListener('click', (e) => onShare(e.currentTarget));
    this.layer.appendChild(node);
  }

  showMenu({ muted, music, sky, card, onResume, onMute, onMusic, onSky, onQuit, onHelp, onFishing }) {
    this.clearLayer();
    const node = el('div', 'overlay dim', `
      <div class="card">
        <h2>PAUSED</h2>
        ${scorecardHtml(card)}
        <button class="btn" data-a="resume">RESUME</button>
        <div class="btn-row">
          <button class="btn ghost" data-a="mute">${muted ? 'SFX OFF' : 'SFX ON'}</button>
          <button class="btn ghost" data-a="music">${musicLabel(music)}</button>
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-a="sky">${skyLabel(sky)}</button>
          <button class="btn ghost" data-a="help">HELP</button>
        </div>
        <button class="btn ghost" data-a="fishing">PRACTICE FISHING</button>
        <button class="btn ghost" data-a="quit">QUIT TO TITLE</button>
      </div>`);
    node.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'resume') onResume();
      if (a === 'mute') e.target.textContent = onMute() ? 'SFX OFF' : 'SFX ON';
      if (a === 'music') toggleMusic(e.target, onMusic);
      if (a === 'sky') e.target.textContent = skyLabel(onSky());
      if (a === 'help') onHelp();
      if (a === 'fishing') onFishing();
      if (a === 'quit') onQuit();
    });
    this.layer.appendChild(node);
  }

  showHelp(onClose) {
    this.clearLayer();
    const row = (pic, title, text) => `<div class="help-row"><div class="pic">${pic}</div><div><b>${title}</b><span>${text}</span></div></div>`;
    const node = el('div', 'overlay dim', `
      <div class="card">
        <h2>HOW TO PLAY</h2>
        ${row(glyph('drag'), 'Aim', 'Drag left or right')}
        ${row(glyph('tap') + pips(0), 'Swing', 'Tap 3 times: start, power, hit')}
        ${row(glyph('tap') + pips(0, 3, true), 'Long shot', 'MAX power fills itself: tap 2 times')}
        ${row(glyph('shape'), 'Curve', 'Good hit? Swipe while it flies')}
        ${row(glyph('hold'), 'Putt', 'Hold, then let go on the mark')}
        <button class="btn" data-a="close">OK</button>
      </div>`);
    node.querySelector('[data-a="close"]').addEventListener('click', onClose);
    this.layer.appendChild(node);
  }

  /** Progress bar on the result card's button (auto-advance). */
  setAutoProgress(f) {
    const bar = this.layer.querySelector('.btn .auto');
    if (bar) bar.style.width = `${Math.min(100, f * 100)}%`;
  }

  // --- Minimap ----------------------------------------------------------------------

  /**
   * Overhead map, rotated so the hole plays up the screen.
   * @param {object} world
   * @param {{x:number,z:number}} ball
   * @param {{x:number,z:number}|null} landing predicted landing point
   */
  drawMinimap(world, ball, landing) {
    const ctx = this.mapCtx;
    const S = this.minimap.width;
    const spec = world.spec;
    ctx.clearRect(0, 0, S, S);

    // Frame: tee at the bottom, green at the top
    const tee = world.tee, cup = world.cup;
    const ang = Math.atan2(cup.z - tee.z, cup.x - tee.x);
    const cos = Math.cos(-ang - Math.PI / 2), sin = Math.sin(-ang - Math.PI / 2);
    const pts = spec.path.map((p) => ({ x: p.x * cos - p.z * sin, y: p.x * sin + p.z * cos }));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const pad = 34;
    const scale = (S - 28) / Math.max(maxX - minX + pad * 2, maxY - minY + pad * 2);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const P = (x, z) => [S / 2 + (x * cos - z * sin - cx) * scale, S / 2 + (x * sin + z * cos - cy) * scale];
    const biome = world.biome;
    const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

    const blob = (shape, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const r = blobRadius(shape, a);
        const [x, y] = P(shape.x + Math.cos(a) * r, shape.z + Math.sin(a) * r);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.fill();
    };

    for (const w of spec.water) blob(w, hex(biome.water));

    // Fairway ribbon
    ctx.strokeStyle = hex(biome.fairway);
    ctx.lineWidth = spec.fairwayHalf * 2 * scale;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false, walked = 0;
    for (let i = 0; i < spec.path.length; i++) {
      if (i > 0) walked += Math.hypot(spec.path[i].x - spec.path[i - 1].x, spec.path[i].z - spec.path[i - 1].z);
      if (walked < spec.fairwayStart && i < spec.path.length - 1) continue;
      const [x, y] = P(spec.path[i].x, spec.path[i].z);
      if (!started) {
        // Begin where the short grass begins
        const prev = spec.path[Math.max(0, i - 1)];
        const seg = Math.hypot(spec.path[i].x - prev.x, spec.path[i].z - prev.z) || 1;
        const back = Math.min(seg, Math.max(0, walked - spec.fairwayStart));
        const [sx, sy] = P(spec.path[i].x - (spec.path[i].x - prev.x) / seg * back, spec.path[i].z - (spec.path[i].z - prev.z) / seg * back);
        ctx.moveTo(sx, sy);
        started = true;
      }
      ctx.lineTo(x, y);
    }
    if (started) ctx.stroke();

    // Green
    ctx.fillStyle = hex(biome.green);
    ctx.beginPath();
    const g = spec.green;
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      let r = g.size * 1.5;
      for (let k = 0; k < 9; k++) {
        if (greenDistance(g, g.x + Math.cos(a) * r, g.z + Math.sin(a) * r) < 1) break;
        r *= 0.88;
      }
      const [x, y] = P(g.x + Math.cos(a) * r, g.z + Math.sin(a) * r);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.fill();

    for (const b of spec.bunkers) blob(b, hex(biome.sand));

    ctx.fillStyle = 'rgba(20,50,30,0.75)';
    for (const t of spec.trees) {
      const [x, y] = P(t.x, t.z);
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, 2.6 * t.s * scale), 0, 6.3); ctx.fill();
    }

    // Aim line
    const [bx, by] = P(ball.x, ball.z);
    if (landing) {
      const [lx, ly] = P(landing.x, landing.z);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(lx, ly, 6, 0, 6.3); ctx.stroke();
    }

    // Pin + ball
    const [px, py] = P(cup.x, cup.z);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 15); ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath(); ctx.moveTo(px, py - 15); ctx.lineTo(px + 10, py - 11); ctx.lineTo(px, py - 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#12261a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, 5, 0, 6.3); ctx.fill(); ctx.stroke();
  }
}

/** Keep the list short: the biggest six, the rest rolled into one line. */
function mergeBonuses(bonuses) {
  if (bonuses.length <= 6) return bonuses;
  const sorted = [...bonuses].sort((a, b) => b.points - a.points);
  const rest = sorted.slice(5);
  return [...sorted.slice(0, 5), { label: `${rest.length} more`, points: rest.reduce((s, b) => s + b.points, 0) }];
}

function scorecardHtml(card, compact = false) {
  // card: { holes: [{ label, par, strokes|null, current }] }
  let halves = [];
  for (let i = 0; i < card.holes.length; i += 9) halves.push(card.holes.slice(i, i + 9));
  // Compact: just the nine being played (keeps the result card on one screen)
  const all = halves.length;
  if (compact && all > 1) halves = halves.filter((half) => half.some((h) => h.current)).slice(0, 1);
  const mark = (h) => {
    if (h.strokes == null) return `<span class="s ${h.current ? 'now' : ''}">${h.current ? '·' : ''}</span>`;
    const d = h.strokes - h.par;
    const cls = d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'worse' : '';
    return `<span class="s ${cls}">${h.strokes}</span>`;
  };
  return halves.map((half, hi) => {
    const played = half.filter((h) => h.strokes != null);
    const sum = played.reduce((s, h) => s + h.strokes, 0);
    const label = all > 1 ? (half[0] === card.holes[0] ? 'OUT' : 'IN') : 'TOT';
    return `<table class="sc">
      <tr><th class="lbl">HOLE</th>${half.map((h) => `<th>${h.label}</th>`).join('')}<th>${label}</th></tr>
      <tr class="par"><td class="lbl">PAR</td>${half.map((h) => `<td>${h.par}</td>`).join('')}<td>${half.reduce((s, h) => s + h.par, 0)}</td></tr>
      <tr><td class="lbl">YOU</td>${half.map((h) => `<td>${mark(h)}</td>`).join('')}<td class="sum">${played.length ? sum : ''}</td></tr>
    </table>`;
  }).join('');
}

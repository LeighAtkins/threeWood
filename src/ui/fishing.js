/**
 * Fishing — a second chance when the ball finds the water.
 *
 * A side-on look under the surface: the ball sinks and a hook goes after it.
 * Hook the ball before it reaches the bottom and the penalty stroke is
 * forgiven. Fish get in the way: hook one of those and you keep the fish, not
 * the ball. Three games take turns, one per trip into the water:
 *
 *   drop   the hook swings by itself; one tap drops the line (timing)
 *   steer  tap to cast, then drag left and right: the line goes down by
 *          itself to the ball on the bottom and brings it back up, and you
 *          steer it past the fish both ways. A fish knocks the hook back to
 *          the top and the ball off it
 *   gold   the same, after a golden ball that will not keep still. Offered
 *          after two lost balls in a row: it forgives this stroke and gives
 *          those two back
 *
 * The drag games run against the clock (the bar along the bottom), long
 * enough that where you steer is what decides it.
 *
 * Drags are relative (the hook moves as far as the finger does), so the finger
 * never has to cover the ball. Over in a few seconds either way. Driven by the game clock (update(dt)), drawn on a
 * 2D canvas; all positions are in a 0..1 box, x across and y down.
 */

import { glyph } from './glyphs.js';

const SURFACE = 0.14;   // y of the waterline
const BED = 0.9;        // y of the bottom
const BALL_R = 0.045;
const FISH_HUES = ['#ff8a3c', '#ffd23f', '#ff6b8b', '#9be37a'];

const FISH_ICON = `<svg viewBox="0 0 48 48" width="62" height="62" aria-hidden="true"><g fill="#ffd23f" stroke="#12261a" stroke-width="2.6" stroke-linejoin="round">
  <path d="M12 24 L3 15 V33 Z"/><ellipse cx="26" cy="24" rx="16" ry="10"/></g><circle cx="34" cy="21" r="2.2" fill="#12261a"/></svg>`;

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Fishing {
  constructor(root, before) {
    this.node = document.createElement('div');
    this.node.className = 'fishing hidden';
    this.node.innerHTML = `
      <div class="pond">
        <canvas></canvas>
        <div class="stake"><s>+1</s><b><s>+3</s></b></div>
        <div class="verdict hidden"></div>
      </div>
      <div class="cue"></div>
      <button class="btn ghost done hidden">DONE</button>`;
    root.insertBefore(this.node, before);
    this.canvas = this.node.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.cue = this.node.querySelector('.cue');
    this.verdict = this.node.querySelector('.verdict');
    // Practice only: a way out. It must not count as a touch on the pond
    this.doneBtn = this.node.querySelector('.done');
    this.doneBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.doneBtn.addEventListener('click', () => { const { onClose } = this; this.stop(); onClose?.(); });
    this.active = false;
    this.finger = null;
    this.node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { this.node.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      this.finger = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.press();
    });
    this.node.addEventListener('pointermove', (e) => {
      if (!this.finger || this.finger.id !== e.pointerId) return;
      const box = this.canvas.getBoundingClientRect();
      this.drag((e.clientX - this.finger.x) / (box.width || 1), (e.clientY - this.finger.y) / (box.height || 1));
      this.finger.x = e.clientX; this.finger.y = e.clientY;
    });
    const up = (e) => {
      if (!this.finger || this.finger.id !== e.pointerId) return;
      this.finger = null;
      this.release();
    };
    this.node.addEventListener('pointerup', up);
    this.node.addEventListener('pointercancel', up);
  }

  setCue(kind) {
    if (this.cueKind === kind) return;
    this.cueKind = kind;
    this.cue.innerHTML = kind ? glyph(kind) : '';
    this.cue.classList.toggle('hidden', !kind);
  }

  /**
   * @param {object} o
   * @param {number} o.level   0..1 player level: faster hook, smaller catch
   * @param {number} o.color   water colour (hex number)
   * @param {() => number} o.rng
   * @param {boolean} o.hint   show the gesture cue
   * @param {'drop'|'steer'|'gold'} o.mode
   * @param {(result: 'ball'|'gold'|'fish'|'miss') => void} o.onDone
   * @param {{ drop?: Function, catch?: Function, fish?: Function, miss?: Function }} o.sounds
   * @param {() => void} [o.onClose] practice: show a DONE button that calls this
   */
  start({ mode = 'drop', level = 0, color = 0x3c9cc4, rng = Math.random, hint = true, onDone, onClose = null, sounds = {} }) {
    this.onClose = onClose;
    this.doneBtn.classList.toggle('hidden', !onClose);
    this.mode = mode;
    this.hint = hint;
    this.held = false;
    this.finger = null;
    this.onDone = onDone;
    this.sounds = sounds;
    this.color = hex(color);
    this.t = 0;
    this.phase = mode === 'drop' ? 'swing' : 'play'; // drop: swing -> drop -> reel -> done; drag games: play -> done
    this.result = null;
    this.endT = 0;
    this.catchR = 0.1 - 0.035 * level;
    this.sweep = 1.5 + 0.9 * level;          // hook swing, rad/s
    this.sinkFor = 5.2 - 1.2 * level;        // drop: seconds for the ball to reach the bed
    this.limit = (mode === 'gold' ? 14 : 12) - 3 * level; // drag games: seconds on the clock
    this.wander = mode === 'gold' ? 0.26 + 0.06 * level : 0.05;  // how far the ball strays sideways
    this.wanderRate = mode === 'gold' ? 1.0 + 0.5 * level : 1.3;
    this.restY = mode === 'gold' ? 0.66 : BED - BALL_R;        // where a loose ball ends up
    this.targetX = 0.5;                      // where a drag has asked the hook to be
    this.targetY = SURFACE - 0.04;
    this.stun = 0;                           // a fish has knocked the hook: no control
    this.cast = false;                       // drag games: the line is in the water
    this.clock = 0;                          // drag games: seconds since the cast
    this.dirY = 1;                           // drag games: the line is going down (1) or up (-1)
    this.moved = 0;
    this.ballX0 = 0.3 + rng() * 0.4;
    this.ballPhase = rng() * 6.28;
    this.hookPhase = rng() * 6.28;
    this.hook = { x: 0.5, y: SURFACE - 0.04 };
    this.ball = { x: this.ballX0, y: SURFACE + 0.08 };
    this.carry = null; // what is on the hook: 'ball' | fish object
    const count = (mode === 'drop' ? 2 : mode === 'steer' ? 4 : 5) + Math.round(level * 2);
    this.fish = [];
    for (let i = 0; i < count; i++) {
      const dir = rng() < 0.5 ? -1 : 1;
      this.fish.push({
        x: rng(), y: SURFACE + (mode === 'drop' ? 0.2 : 0.14) + (i / count) * (mode === 'drop' ? 0.42 : 0.5) + rng() * 0.05,
        v: dir * (0.1 + rng() * 0.12 + level * 0.06), size: 0.05 + rng() * 0.025,
        hue: FISH_HUES[i % FISH_HUES.length], wag: rng() * 6.28, hooked: false,
      });
    }
    this.bubbles = [];
    this.weeds = Array.from({ length: 7 }, (_, i) => ({ x: 0.06 + i * 0.15 + rng() * 0.05, h: 0.07 + rng() * 0.09, p: rng() * 6.28 }));
    this.setCue(hint ? 'tap' : null);
    this.verdict.classList.add('hidden');
    this.node.classList.remove('hidden', 'won', 'lost', 'gold');
    this.node.classList.toggle('gold', mode === 'gold');
    this.active = true;
    this.resize();
    this.draw();
  }

  stop() {
    this.active = false;
    this.node.classList.add('hidden');
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(box.width * dpr)), h = Math.max(2, Math.round(box.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  /** Drop the line where the hook is now. */
  dropLine() {
    if (!this.active || this.phase !== 'swing' || this.t < 0.35) return false;
    this.phase = 'drop';
    this.setCue(null);
    this.sounds.drop?.();
    return true;
  }

  /** Button or key: drops the line in the games that have a drop. */
  tap() { return this.mode === 'drop' ? this.dropLine() : this.castLine(); }

  /** Drag games: send the line down. From then on it is steered sideways. */
  castLine() {
    if (!this.active || this.phase !== 'play' || this.cast) return false;
    this.cast = true;
    this.setCue(this.hint ? 'drag' : null);
    this.sounds.drop?.();
    return true;
  }

  press() {
    if (!this.active) return;
    this.held = true;
    if (this.mode === 'drop') this.dropLine(); else this.castLine();
  }

  /** dx: finger travel as a fraction of the pond's width. Sideways only. */
  drag(dx) {
    if (!this.active || this.mode === 'drop' || this.phase !== 'play' || !this.cast || this.stun > 0) return;
    this.targetX = Math.max(0.05, Math.min(0.95, this.targetX + dx));
    this.moved += Math.abs(dx);
    if (this.moved > 0.25) this.setCue(null); // they have got it
  }

  release() { this.held = false; }

  /**
   * The drag games: once cast, the line travels down and up by itself and the
   * finger only steers it sideways.
   */
  updateDrag(dt) {
    const { hook, ball } = this;
    const top = SURFACE - 0.04;
    if (!this.cast) {
      hook.y = top;
      if (this.t > 3) this.castLine(); // nobody tapped: go anyway, so it never stalls
      return;
    }
    this.clock += dt;
    if (this.clock >= this.limit) { this.finish('miss'); return; }
    if (this.stun > 0) {
      // Knocked by a fish: the hook shoots back to the top, then goes down again
      this.stun -= dt;
      hook.y = Math.max(top, hook.y - 1.6 * dt);
      this.targetX = hook.x;
      this.dirY = 1;
    } else {
      const max = 0.85 * dt;
      hook.x += Math.max(-max, Math.min(max, this.targetX - hook.x));
      // Down to look for the ball; up with it (slowly), or up empty for another go
      hook.y += this.dirY * (this.carry || this.dirY > 0 ? 0.3 : 0.9) * dt;
      if (!this.carry && this.dirY > 0 && hook.y >= BED - 0.03) this.dirY = -1;
      else if (!this.carry && this.dirY < 0 && hook.y <= top) { hook.y = top; this.dirY = 1; }
      const fish = this.fish.find((f) => Math.abs(f.x - hook.x) < f.size * 0.95 && Math.abs(f.y - hook.y) < f.size * 0.6);
      if (fish) {
        this.stun = 0.5;
        if (this.carry) { this.carry = null; this.ballX0 = hook.x; this.ballPhase = -this.t * this.wanderRate; }
        this.sounds.bump?.();
      } else if (!this.carry && Math.abs(hook.x - ball.x) < this.catchR * 0.75 && Math.abs(hook.y - ball.y) < 0.055) {
        this.carry = 'ball';
        this.dirY = -1;
        this.sounds.hooked?.();
      }
    }
    if (this.carry) {
      ball.x = hook.x; ball.y = hook.y + 0.035;
      if (hook.y <= SURFACE) this.finish(this.mode === 'gold' ? 'gold' : 'ball');
    }
  }

  finish(result) {
    this.result = result;
    this.phase = 'done';
    this.endT = this.t;
    const won = result === 'ball' || result === 'gold';
    this.node.classList.add(won ? 'won' : 'lost');
    this.verdict.classList.remove('hidden');
    this.verdict.innerHTML = won ? '✓' : result === 'fish' ? FISH_ICON : '✕';
    this.setCue(null);
    (won ? this.sounds.catch : result === 'fish' ? this.sounds.fish : this.sounds.miss)?.();
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const { hook, ball } = this;

    // The ball sinks, wandering a little, until something has it
    if (this.carry !== 'ball' && this.phase !== 'done') {
      if (this.mode === 'drop') {
        const f = Math.min(1, this.t / this.sinkFor);
        ball.y = SURFACE + 0.08 + (BED - BALL_R - SURFACE - 0.08) * f;
      } else {
        // Loose in a drag game: it sinks to where it rests (gold bobs there)
        const rest = this.restY + (this.mode === 'gold' ? Math.sin(this.t * 1.7) * 0.1 : 0);
        ball.y = Math.min(rest, ball.y + 0.3 * dt);
      }
      ball.x = Math.max(0.08, Math.min(0.92, this.ballX0 + Math.sin(this.t * this.wanderRate + this.ballPhase) * this.wander));
      if (Math.random() < dt * 5) this.bubbles.push({ x: ball.x, y: ball.y - BALL_R, r: 0.006 + Math.random() * 0.008, v: 0.12 + Math.random() * 0.1 });
    }
    for (const b of this.bubbles) { b.y -= b.v * dt; b.x += Math.sin(this.t * 6 + b.r * 900) * 0.02 * dt; }
    this.bubbles = this.bubbles.filter((b) => b.y > SURFACE);

    for (const f of this.fish) {
      if (f.hooked) continue;
      f.x += f.v * dt;
      if (f.x > 1.15) f.x = -0.15;
      if (f.x < -0.15) f.x = 1.15;
    }

    if (this.phase === 'play') {
      this.updateDrag(dt);
    } else if (this.phase === 'swing') {
      hook.y = SURFACE - 0.04;
      hook.x = 0.5 + Math.sin(this.t * this.sweep + this.hookPhase) * 0.4;
      // Never dropped: the ball is on the bottom and gone
      if (this.t >= this.sinkFor + 0.3) this.finish('miss');
    } else if (this.phase === 'drop') {
      // Swept test: whatever the hook passed through this step counts, so a
      // slow frame cannot carry it straight past the ball
      const from = hook.y - 0.03;
      hook.y += 1.5 * dt;
      const reached = (y) => y >= from && y <= hook.y + 0.03;
      const fish = this.fish
        .filter((f) => !f.hooked && Math.abs(f.x - hook.x) < f.size * 0.9 && reached(f.y))
        .sort((p, q) => p.y - q.y)[0];
      const ballHit = reached(ball.y) && Math.abs(hook.x - ball.x) < this.catchR;
      if (fish && !(ballHit && ball.y < fish.y)) {
        fish.hooked = true;
        this.carry = fish;
        hook.y = fish.y;
        this.phase = 'reel';
      } else if (ballHit) {
        hook.y = ball.y;
        this.carry = 'ball';
        this.phase = 'reel';
        this.sounds.hooked?.();
      } else if (hook.y >= BED - 0.02) {
        this.phase = 'reel';
      }
    } else if (this.phase === 'reel') {
      hook.y -= 1.1 * dt;
      if (this.carry === 'ball') { ball.x += (hook.x - ball.x) * Math.min(1, dt * 14); ball.y = hook.y + 0.035; }
      else if (this.carry) { this.carry.x = hook.x; this.carry.y = hook.y + 0.04; }
      if (hook.y <= SURFACE - 0.02) this.finish(this.carry === 'ball' ? 'ball' : this.carry ? 'fish' : 'miss');
    } else if (this.phase === 'done' && this.t - this.endT > 1.0) {
      const { result, onDone } = this;
      this.stop();
      onDone?.(result);
      return;
    }
    this.draw();
  }

  draw() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const u = Math.min(W, H); // sizes scale with the short side
    ctx.clearRect(0, 0, W, H);

    // Sky strip, then the water
    ctx.fillStyle = '#cfeeff';
    ctx.fillRect(0, 0, W, SURFACE * H);
    const water = ctx.createLinearGradient(0, SURFACE * H, 0, H);
    water.addColorStop(0, this.color);
    water.addColorStop(1, '#0b2a3c');
    ctx.fillStyle = water;
    ctx.fillRect(0, SURFACE * H, W, H);

    // Light shafts
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      const x = (0.1 + i * 0.27 + Math.sin(t * 0.4 + i) * 0.03) * W;
      ctx.beginPath();
      ctx.moveTo(x, SURFACE * H); ctx.lineTo(x + 0.1 * W, SURFACE * H);
      ctx.lineTo(x + 0.02 * W, H); ctx.lineTo(x - 0.16 * W, H);
      ctx.fill();
    }
    ctx.restore();

    // Bed and weeds
    ctx.fillStyle = '#c9b27a';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i <= 10; i++) ctx.lineTo((i / 10) * W, (BED + Math.sin(i * 1.7) * 0.012) * H);
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.strokeStyle = '#1d7a4a';
    ctx.lineWidth = 0.014 * u;
    ctx.lineCap = 'round';
    for (const w of this.weeds) {
      ctx.beginPath();
      ctx.moveTo(w.x * W, BED * H);
      ctx.quadraticCurveTo((w.x + Math.sin(t * 1.4 + w.p) * 0.04) * W, (BED - w.h * 0.6) * H, (w.x + Math.sin(t * 1.4 + w.p) * 0.03) * W, (BED - w.h) * H);
      ctx.stroke();
    }

    // Waterline
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.008 * u;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const x = (i / 24) * W, y = (SURFACE + Math.sin(i * 0.9 + t * 3) * 0.006) * H;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();

    // Bubbles
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.004 * u;
    for (const b of this.bubbles) { ctx.beginPath(); ctx.arc(b.x * W, b.y * H, b.r * u, 0, 6.3); ctx.stroke(); }

    // Fish
    for (const f of this.fish) this.drawFish(f, W, H, u);

    // Where the hook will fall: a faint plumb line while it swings
    const hx = this.hook.x * W, hy = this.hook.y * H;
    if (this.phase === 'swing') {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.setLineDash([0.012 * u, 0.02 * u]);
      ctx.lineWidth = 0.005 * u;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, BED * H); ctx.stroke();
      ctx.setLineDash([]);
    }

    // The ball, with a ring showing how close is close enough
    const bx = this.ball.x * W, by = this.ball.y * H;
    if (this.phase === 'swing' || this.phase === 'drop' || (this.phase === 'play' && !this.carry)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.006 * u;
      ctx.beginPath(); ctx.ellipse(bx, by, this.catchR * W, BALL_R * 1.5 * u, 0, 0, 6.3); ctx.stroke();
    }
    if (!(this.phase === 'done' && this.carry !== 'ball' && this.t - this.endT > 0.4)) {
      const gold = this.mode === 'gold';
      if (gold) { // a glow, so the prize reads as a prize
        const glow = ctx.createRadialGradient(bx, by, 0, bx, by, BALL_R * u * 2.6);
        glow.addColorStop(0, 'rgba(255, 210, 63, 0.55)');
        glow.addColorStop(1, 'rgba(255, 210, 63, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(bx, by, BALL_R * u * 2.6, 0, 6.3); ctx.fill();
      }
      ctx.fillStyle = gold ? '#ffd23f' : '#fff';
      ctx.strokeStyle = '#12261a';
      ctx.lineWidth = 0.007 * u;
      ctx.beginPath(); ctx.arc(bx, by, BALL_R * u, 0, 6.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(18,38,26,0.16)';
      for (const [dx, dy] of [[-0.3, -0.2], [0.25, -0.35], [0.1, 0.25], [-0.35, 0.3], [0.45, 0.1]]) {
        ctx.beginPath(); ctx.arc(bx + dx * BALL_R * u, by + dy * BALL_R * u, BALL_R * u * 0.14, 0, 6.3); ctx.fill();
      }
    }

    // Line and hook
    ctx.strokeStyle = '#fff8ec';
    ctx.lineWidth = 0.006 * u;
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = '#12261a';
    ctx.lineWidth = 0.016 * u;
    ctx.beginPath(); ctx.arc(hx - 0.022 * u, hy, 0.022 * u, 0, Math.PI * 0.95); ctx.stroke();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 0.009 * u;
    ctx.beginPath(); ctx.arc(hx - 0.022 * u, hy, 0.022 * u, 0, Math.PI * 0.95); ctx.stroke();

    // Time left: the bar along the bottom drains as the ball sinks
    if (this.phase === 'swing' || this.phase === 'play') {
      const left = Math.max(0, this.phase === 'play' ? 1 - this.clock / this.limit : 1 - this.t / this.sinkFor);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, H - 0.02 * u, W, 0.02 * u);
      ctx.fillStyle = left < 0.3 ? '#ff5a3c' : '#ffd23f';
      ctx.fillRect(0, H - 0.02 * u, W * left, 0.02 * u);
    }
  }

  drawFish(f, W, H, u) {
    const { ctx } = this;
    const s = f.size * u;
    ctx.save();
    ctx.translate(f.x * W, f.y * H);
    if (f.hooked) ctx.rotate(-Math.PI / 2); else if (f.v < 0) ctx.scale(-1, 1);
    const wag = Math.sin(this.t * 9 + f.wag) * 0.35;
    ctx.fillStyle = f.hue;
    ctx.strokeStyle = '#12261a';
    ctx.lineWidth = 0.006 * u;
    ctx.beginPath(); // tail
    ctx.moveTo(-s * 0.8, 0); ctx.lineTo(-s * 1.5, -s * 0.5 + wag * s); ctx.lineTo(-s * 1.5, s * 0.5 + wag * s); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#12261a';
    ctx.beginPath(); ctx.arc(s * 0.55, -s * 0.12, s * 0.1, 0, 6.3); ctx.fill();
    ctx.restore();
  }
}

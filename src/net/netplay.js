/**
 * Playing a round with friends in a room.
 *
 * Everyone plays the same course on their own phone, their own ball, at the
 * same time. What keeps it a shared round rather than four solo ones:
 *
 *   - you see the others: their campers walk to their balls, their shots fly;
 *   - shots are taken together. Tap the button to say you are READY; when
 *     everyone still playing the hole is ready the room says GO and you all
 *     swing. (Nobody is held up for ever: half a minute after the first
 *     player is ready, the ready ones go.)
 *   - the next hole starts for everybody at once.
 *
 * The host's phone decides GO and NEXT; everything else is each player
 * reporting what they did. Game hooks call in here; this calls back into Game
 * for the few things that change (starting a round, moving to the next hole).
 */

import { Room, cleanCode } from './room.js';
import { Others } from '../render/others.js';
import { cleanLook } from '../core/camp.js';
import { generateSeed } from '../core/rng.js';

const WAIT_LIMIT = 30;  // seconds the ready players wait for the rest
const NEXT_DELAY = 8;   // seconds on the result card once everyone has finished

const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const vsPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

export class NetPlay {
  constructor(game) {
    this.g = game;
    const { root, layer } = game.hud;
    this.others = new Others(game.scene, root, layer);
    this.pill = document.createElement('div');
    this.pill.className = 'net-pill hidden';
    root.insertBefore(this.pill, layer);
    this.lobby = document.createElement('div');
    this.lobby.className = 'overlay dim hidden';
    root.appendChild(this.lobby);
    this.room = null;
    this.inRound = false;
    this.players = [];
    this.status = new Map();  // id -> aim | ready | busy | done
    this.scores = new Map();  // id -> { total, strokes }
    this.cleared = false;     // this volley: I may swing
    this.waitT = null;        // host: seconds since the first player was ready
    this.nextT = null;        // host: seconds since everyone finished the hole
    this.error = '';
  }

  /** In a round with at least the room open. */
  get active() { return !!this.room && this.inRound; }
  get friends() { return this.players.filter((p) => p.id !== this.room?.me.id); }
  get myId() { return this.room?.me.id; }

  // ===========================================================================
  // Lobby
  // ===========================================================================

  openLobby(code = '') {
    this.g.hud.clearLayer();
    this.lobby.classList.remove('hidden');
    this.renderLobby(cleanCode(code));
    if (code && !this.room) this.join(code);
  }

  closeLobby() { this.lobby.classList.add('hidden'); this.lobby.innerHTML = ''; }

  connect() {
    this.error = '';
    this.room = new Room({ look: cleanLook(this.g.camp.look) }, {
      open: () => this.renderLobby(),
      roster: (players) => this.onRoster(players),
      message: (from, msg) => this.onMessage(from, msg),
      closed: (reason) => {
        const wasPlaying = this.inRound;
        this.reset();
        this.error = reason;
        if (wasPlaying) this.g.hud.callout(reason.toUpperCase(), 'bad small'); // carry on alone
        else if (!this.lobby.classList.contains('hidden')) this.renderLobby();
      },
    });
    return this.room;
  }

  create() { this.connect().host(); this.renderLobby(); }

  join(code) {
    const clean = cleanCode(code);
    if (clean.length !== 4) { this.error = 'A room code is 4 letters.'; this.renderLobby(clean); return; }
    this.connect().join(clean);
    this.renderLobby();
  }

  /** Leave the room entirely. */
  leave() {
    this.room?.leave();
    this.reset();
  }

  reset() {
    this.room = null;
    this.inRound = false;
    this.players = [];
    this.status.clear();
    this.scores.clear();
    this.cleared = false;
    this.waitT = this.nextT = null;
    this.others.clear();
    this.pill.classList.add('hidden');
  }

  renderLobby(typed = '') {
    const room = this.room;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let body;
    if (!room) {
      body = `
        <h2>PLAY WITH FRIENDS</h2>
        <p>Same course, same time. Everyone swings together.</p>
        <button class="btn" data-a="create">MAKE A ROOM</button>
        <div class="join-row"><input class="code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(typed)}"><button class="btn ghost" data-a="join">JOIN</button></div>
        ${this.error ? `<p class="net-error">${esc(this.error)}</p>` : ''}
        <button class="btn ghost" data-a="back">BACK</button>`;
    } else if (!room.me.id || !this.players.length) {
      body = `<h2>PLAY WITH FRIENDS</h2><p>Connecting…</p><button class="btn ghost" data-a="leave">CANCEL</button>`;
    } else {
      const list = this.players.map((p) => `<div class="net-player"><i></i>${esc(cleanLook(p.look).name)}${p.host ? ' <small>HOST</small>' : ''}${p.id === room.me.id ? ' <small>YOU</small>' : ''}</div>`).join('');
      body = `
        <h2>ROOM CODE</h2>
        <h1 class="gold room-code">${esc(room.code)}</h1>
        <button class="btn ghost" data-a="share">SHARE THE LINK</button>
        <div class="net-list">${list}</div>
        ${room.isHost
          ? `<div class="btn-row"><button class="btn" data-a="go9">START 9</button><button class="btn" data-a="go18">START 18</button></div>`
          : `<p>Waiting for the host to start…</p>`}
        <button class="btn ghost" data-a="leave">LEAVE</button>`;
    }
    this.lobby.innerHTML = `<div class="card">${body}</div>`;
    this.lobby.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      this.g.audio.unlock(); this.g.audio.tap();
      if (a === 'create') this.create();
      else if (a === 'join') this.join(this.lobby.querySelector('.code').value);
      else if (a === 'back') { this.closeLobby(); this.g.showTitle(); }
      else if (a === 'leave') { this.leave(); this.error = ''; this.renderLobby(); }
      else if (a === 'go9' || a === 'go18') this.startRound(a === 'go9' ? 9 : 18);
      else if (a === 'share') {
        const url = `${location.origin}${location.pathname}?room=${room.code}`;
        const text = `Play ThreeWood with me — room ${room.code}`;
        try {
          if (navigator.share) await navigator.share({ title: 'ThreeWood', text, url });
          else { await navigator.clipboard.writeText(`${text} ${url}`); e.target.textContent = 'LINK COPIED'; }
        } catch { /* cancelled */ }
      }
    };
  }

  // ===========================================================================
  // Room traffic
  // ===========================================================================

  onRoster(players) {
    this.players = players;
    const ids = new Set(players.map((p) => p.id));
    for (const id of [...this.status.keys()]) if (!ids.has(id)) { this.status.delete(id); this.scores.delete(id); }
    for (const p of players) if (!this.status.has(p.id)) this.status.set(p.id, this.inRound ? 'aim' : 'aim');
    this.others.sync(this.friends);
    if (this.inRound && this.g.world) {
      for (const o of this.others.map.values()) if (!o.placed) this.others.toTee(this.g.world);
    }
    if (!this.lobby.classList.contains('hidden')) this.renderLobby();
    this.paint();
    this.judge();
  }

  onMessage(from, msg) {
    const g = this.g;
    switch (msg.t) {
      case 'start':
        if (from === 'host' && !this.room.isHost) this.begin(String(msg.seed).slice(0, 40), msg.length === 9 ? 9 : 18);
        break;
      case 'at':
        this.status.set(from, 'aim');
        if (this.inRound && msg.hole === g.round?.index) this.others.at(from, g.world, num(msg.x, -400, 400), num(msg.z, -400, 400));
        this.others.setStatus(from, 'aim');
        break;
      case 'status':
        if (msg.s === 'ready' || msg.s === 'aim') { this.status.set(from, msg.s); this.others.setStatus(from, msg.s); }
        break;
      case 'go':
        if (from === 'host') this.go(Array.isArray(msg.ids) ? msg.ids : []);
        break;
      case 'shot':
        if (this.inRound && msg.hole === g.round?.index) {
          const l = msg.launch || {};
          this.others.shot(from, g.world, {
            kind: msg.kind === 'putt' ? 'putt' : 'full', x: num(msg.x, -400, 400, NaN), z: num(msg.z, -400, 400, NaN),
            speed: num(msg.speed, 0, 30), dirX: num(msg.dirX, -1, 1), dirZ: num(msg.dirZ, -1, 1),
            launch: { speed: num(l.speed, 0, 120), dirX: num(l.dirX, -1, 1), dirZ: num(l.dirZ, -1, 1), loftDeg: num(l.loftDeg, 0, 80), back: num(l.back, -5, 5), side: num(l.side, -5, 5) },
          });
        }
        this.status.set(from, 'busy');
        this.others.setStatus(from, 'busy');
        break;
      case 'holed':
        this.others.holed(from);
        break;
      case 'done':
        this.status.set(from, 'done');
        this.others.setStatus(from, 'done');
        this.scores.set(from, { total: num(msg.total, -99, 199), strokes: num(msg.strokes, 0, 20) });
        break;
      case 'next':
        if (from === 'host' && this.inRound && msg.hole === g.round?.index) g.nextHole?.();
        break;
      default:
        return;
    }
    this.paint();
    this.judge();
  }

  // ===========================================================================
  // The round
  // ===========================================================================

  /** Host: start a round for the whole room. */
  startRound(length) {
    if (!this.room?.isHost) return;
    const seed = generateSeed();
    this.room.send({ t: 'start', seed, length });
    this.begin(seed, length);
  }

  begin(seed, length) {
    this.inRound = true;
    this.scores.clear();
    this.closeLobby();
    this.g.startNetRound(seed, length);
  }

  /** A hole has loaded. */
  atHole() {
    if (!this.active) return;
    for (const p of this.players) this.status.set(p.id, 'aim');
    this.cleared = false;
    this.waitT = this.nextT = null;
    this.others.sync(this.friends);
    this.others.toTee(this.g.world);
    this.paint();
  }

  /** I am at my ball, lining up. */
  atAim() {
    if (!this.active) return;
    this.cleared = false;
    this.status.set(this.myId, 'aim');
    const { ball, round } = this.g;
    this.room.send({ t: 'at', x: ball.x, z: ball.z, hole: round.index });
    this.paint();
    this.judge();
  }

  /**
   * The swing button was pressed while aiming. Returns true if the swing may
   * start; otherwise the press was "I am ready" (or "not yet" if pressed again).
   */
  clearToSwing() {
    if (!this.active || this.cleared || this.players.length < 2) return true;
    const ready = this.status.get(this.myId) !== 'ready';
    this.status.set(this.myId, ready ? 'ready' : 'aim');
    this.room.send({ t: 'status', s: ready ? 'ready' : 'aim' });
    this.g.hud.setAction(ready ? 'wait' : 'swing', this.g.fullPower);
    if (ready) this.g.hud.callout('READY', 'small');
    this.paint();
    this.judge();
    return false;
  }

  /** Host: is it time to say GO, or to move everyone on? */
  judge() {
    if (!this.active || !this.room.isHost) return;
    const playing = this.players.filter((p) => this.status.get(p.id) !== 'done');
    const ready = playing.filter((p) => this.status.get(p.id) === 'ready');
    if (!ready.length) { this.waitT = null; }
    else if (ready.length === playing.length) this.sayGo(ready.map((p) => p.id));
    else if (this.waitT === null) this.waitT = 0;
    if (this.players.length && !playing.length) { if (this.nextT === null) this.nextT = 0; } else this.nextT = null;
  }

  sayGo(ids) {
    this.waitT = null;
    this.room.send({ t: 'go', ids });
    this.go(ids);
  }

  go(ids) {
    for (const id of ids) if (this.status.get(id) === 'ready') { this.status.set(id, 'busy'); this.others.setStatus(id, 'busy'); }
    if (ids.includes(this.myId) && this.g.state === 'aim') {
      this.cleared = true;
      this.g.hud.callout('GO!', 'gold');
      this.g.audio.reward(5);
      this.g.hud.setAction(this.g.putting ? 'hold' : 'swing', this.g.fullPower);
    }
    this.paint();
  }

  /** I have hit it. */
  shot(data) {
    if (!this.active) return;
    this.status.set(this.myId, 'busy');
    this.room.send({ t: 'shot', hole: this.g.round.index, ...data });
    this.paint();
  }

  holedOut() { if (this.active) this.room.send({ t: 'holed' }); }

  /** My hole is finished and scored. */
  holeDone(strokes, total) {
    if (!this.active) return;
    this.status.set(this.myId, 'done');
    this.scores.set(this.myId, { total, strokes });
    this.room.send({ t: 'done', strokes, total });
    this.paint();
    this.judge();
  }

  /** NEXT on the result card. */
  pressNext() {
    const everyone = this.players.every((p) => this.status.get(p.id) === 'done');
    if (!everyone) { this.g.hud.callout('WAITING FOR FRIENDS', 'small'); return; }
    if (!this.room.isHost) { this.g.hud.callout('WAITING FOR THE HOST', 'small'); return; }
    this.sayNext();
  }

  sayNext() {
    this.nextT = null;
    this.room.send({ t: 'next', hole: this.g.round.index });
    this.g.nextHole?.();
  }

  /** Names and totals for the summary card, best first. */
  standings(myTotal) {
    return this.players
      .map((p) => ({ name: cleanLook(p.look).name, total: p.id === this.myId ? myTotal : this.scores.get(p.id)?.total ?? 0, me: p.id === this.myId }))
      .sort((a, b) => a.total - b.total);
  }

  /** The pill under the score: who is in the room and what they are doing. */
  paint() {
    this.pill.classList.toggle('hidden', !this.active || this.g.state === 'title');
    if (!this.active) return;
    this.pill.innerHTML = '';
    for (const p of this.players) {
      const row = document.createElement('div');
      row.className = `who ${this.status.get(p.id) || 'aim'}`;
      const score = this.scores.get(p.id);
      row.innerHTML = '<i></i><b></b><span></span>';
      row.querySelector('b').textContent = p.id === this.myId ? 'YOU' : cleanLook(p.look).name;
      row.querySelector('span').textContent = score ? vsPar(score.total) : '';
      this.pill.appendChild(row);
    }
  }

  update(dt) {
    const g = this.g;
    const show = this.active && ['aim', 'swing', 'flight', 'settle', 'holed', 'result', 'fishing'].includes(g.state);
    if (g.world) this.others.update(dt, g.world, g.env, g.camera, show);
    if (!this.active || !this.room.isHost) return;
    if (this.waitT !== null) {
      this.waitT += dt;
      if (this.waitT > WAIT_LIMIT) this.sayGo(this.players.filter((p) => this.status.get(p.id) === 'ready').map((p) => p.id));
    }
    if (this.nextT !== null && g.state === 'result') {
      this.nextT += dt;
      if (this.nextT > NEXT_DELAY) this.sayNext();
    }
  }
}
